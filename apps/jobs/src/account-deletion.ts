import { authSettings } from "@hasaweb/auth";
import {
  accountDeletionRequestSchema,
  DEADLINE_MS,
  type DeletionWake,
  privateJson,
  requestAccountDeletion,
  SaveError,
  type Wake,
  withdrawPrivateActivity,
} from "@hasaweb/db";
import type { Hono } from "hono";
import { z } from "zod";
import { readBody } from "./draft-routes";
import { background, startCleanup } from "./github-routes";
import type { OwnerBindings } from "./owner-api";
import {
  type PublicationCacheEnv,
  purgePublicationHosts,
  verifyPublicationUrl,
} from "./publication-cache";

export type DeletionEnv = PublicationCacheEnv & {
  APP_ENV?: string;
  ASSET_ORIGIN: string;
  DB: D1Database;
  SITES_BUCKET: R2Bucket;
  PUBLIC_ASSETS_BUCKET: R2Bucket;
  // The web Worker's PublicationAssets entry, which alone can reach the
  // private draft bucket.
  PRIVATE_SOURCE: Pick<Fetcher, "fetch">;
  PUBLICATION_QUEUE: {
    send(
      body: DeletionWake | Wake,
      options?: { delaySeconds?: number },
    ): Promise<unknown>;
  };
};
type Stage =
  | "public"
  | "purge"
  | "verify"
  | "candidates"
  | "draft"
  | "rows"
  | "final";
type Deletion = {
  id: string;
  user_id: string;
  portfolio_id: string | null;
  address: string | null;
  stage: Stage;
  cursor: string;
  attempts: number;
};

// An upload streams for at most 30 seconds (`apps/web/lib/assets/stream.ts`)
// and settles its row afterwards. Wait this long after the last upload
// activity before removing the private prefix.
export const UPLOAD_QUIET_MS = 120_000;
const WAIT_SECONDS = 5;

const publicReceipts = `SELECT DISTINCT json_extract(f.value,'$.key') AS key,json_extract(f.value,'$.path') AS path
  FROM publication_candidate c JOIN publication_candidate_index x ON x.candidate_id=c.id
  JOIN json_each(x.value,'$.receipts') f
  WHERE c.portfolio_id=? AND json_extract(f.value,'$.bucket')='assets' AND json_extract(f.value,'$.key')>?
  ORDER BY key LIMIT 8`;

/**
 * Phase 49 cleanup after the deletion request. Public and owner access ended
 * in the request batch; this removes what is left, one bounded step per
 * queue message, and records every step in D1 so the cron sweep resumes it:
 *
 * 1. `public`: delete every public object any candidate of the portfolio
 *    recorded, checking each is gone.
 * 2. `purge` and `verify`: purge the portfolio and asset hosts, then verify
 *    the removed upload URLs under the S-9 policy (deployed only).
 * 3. `candidates`: drop the version index and hand every candidate to the
 *    dispatcher's prefix cleanup, which deletes both buckets' prefixes and
 *    leaves an anonymous tombstone that rechecks late writes. Waits until
 *    none is linked to the portfolio.
 * 4. `draft`: once uploads are quiet, the web entry deletes the private
 *    `draft/{portfolio}/` prefix.
 * 5. `rows`: queue revocation of any grant still active, then delete the
 *    portfolio and the user (cascading sessions, accounts, assets, GitHub,
 *    contact and publication rows). A released hold and an ownerless claim
 *    follow from the request batch and the foreign keys.
 * 6. `final`: recheck the private prefix, verify the address serves nothing,
 *    then delete this record.
 */
export async function runAccountDeletion(env: DeletionEnv, id: string) {
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT id,user_id,portfolio_id,address,stage,cursor,attempts FROM account_deletion WHERE id=? AND next_attempt_at<=?",
  )
    .bind(id, now)
    .first<Deletion>();
  if (!row) return false;
  const local = env.APP_ENV === "local" || env.APP_ENV === "test";
  const wake = (delaySeconds?: number) =>
    env.PUBLICATION_QUEUE.send(
      { deletionId: id },
      delaySeconds ? { delaySeconds } : undefined,
    );
  const advance = async (stage: Stage, cursor = "") => {
    await env.DB.prepare(
      "UPDATE account_deletion SET stage=?,cursor=?,attempts=0,next_attempt_at=0 WHERE id=? AND stage=? AND cursor=?",
    )
      .bind(stage, cursor, id, row.stage, row.cursor)
      .run();
    await wake();
    return stage;
  };
  // Not a failure: the step waits for other work to settle.
  const wait = async () => {
    await env.DB.prepare(
      "UPDATE account_deletion SET next_attempt_at=? WHERE id=? AND stage=?",
    )
      .bind(now + WAIT_SECONDS * 1000, id, row.stage)
      .run();
    await wake(WAIT_SECONDS);
    return row.stage;
  };
  const purgeDraft = async () => {
    const response = await env.PRIVATE_SOURCE.fetch(
      "https://private-source/account-deletion",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletionId: id }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Private upload removal failed");
    }
    return z.object({ remaining: z.boolean() }).parse(await response.json())
      .remaining;
  };
  try {
    switch (row.stage) {
      case "public":
      case "verify": {
        if (!row.portfolio_id) return await advance("candidates");
        const files = await env.DB.prepare(publicReceipts)
          .bind(row.portfolio_id, row.cursor)
          .all<{ key: string; path: string }>();
        for (const file of files.results) {
          if (row.stage === "public") {
            await env.PUBLIC_ASSETS_BUCKET.delete(file.key);
            if (await env.PUBLIC_ASSETS_BUCKET.head(file.key))
              throw new Error("Deleted object still present");
          } else if (
            !local &&
            row.address &&
            file.path.startsWith("/assets/")
          ) {
            // Platform files are served only by the portfolio host, which
            // the final check covers. Uploads have their own asset URLs.
            const url = `${env.ASSET_ORIGIN}/${file.key}`;
            await verifyPublicationUrl(env, url, { status: 404 });
            await verifyPublicationUrl(env, `${url}?variant=warm`, {
              status: 404,
            });
          }
        }
        const last = files.results.at(-1);
        if (last) return await advance(row.stage, last.key);
        return await advance(row.stage === "public" ? "purge" : "candidates");
      }
      case "purge":
        // Only a published address was ever served, so only it can be cached.
        if (!local && row.address)
          await purgePublicationHosts(env, [
            `${row.address}.hasaweb.site`,
            new URL(env.ASSET_ORIGIN).host,
          ]);
        return await advance("verify");
      case "candidates": {
        if (!row.portfolio_id) return await advance("draft");
        const portfolio = row.portfolio_id;
        // Removing the version index releases the retained candidates for
        // cleanup. A candidate under a live lease waits for it to expire; its
        // late writes are caught by the cleaned tombstone's recheck. Clearing
        // `source` keeps a failed cleanup linked to this portfolio (the
        // dispatcher sweep anonymizes only exhausted ones that still have a
        // source), so the next pass retries it after its backoff. Admission
        // slots, which the version trigger hands back, are released too.
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM publish_version WHERE portfolio_id=?",
          ).bind(portfolio),
          env.DB.prepare(
            "UPDATE publication_candidate SET status='cleaning',source=NULL,facts=NULL,cursor='[]',attempts=0,deadline_at=?,next_attempt_at=?,lease_token=NULL,lease_until=0,updated_at=? WHERE portfolio_id=? AND status NOT IN ('cleaning','cleaned') AND lease_until<=? AND (status!='failed' OR next_attempt_at<=?)",
          ).bind(now + DEADLINE_MS, now, now, portfolio, now, now),
          env.DB.prepare(
            "DELETE FROM publication_candidate_pending WHERE candidate_id IN (SELECT id FROM publication_candidate WHERE portfolio_id=? AND source IS NULL)",
          ).bind(portfolio),
        ]);
        const linked = await env.DB.prepare(
          "SELECT id,status FROM publication_candidate WHERE portfolio_id=? ORDER BY id LIMIT 16",
        )
          .bind(portfolio)
          .all<{ id: string; status: string }>();
        if (!linked.results.length) return await advance("draft");
        for (const candidate of linked.results)
          if (candidate.status === "cleaning")
            await env.PUBLICATION_QUEUE.send({ candidateId: candidate.id });
        return await wait();
      }
      case "draft": {
        if (!row.portfolio_id) return await advance("rows");
        const busy = await env.DB.prepare(
          "SELECT EXISTS(SELECT 1 FROM asset WHERE portfolio_id=? AND ((status='pending' AND created_at>?) OR updated_at>?)) AS busy",
        )
          .bind(row.portfolio_id, now - UPLOAD_QUIET_MS, now - UPLOAD_QUIET_MS)
          .first<{ busy: number }>();
        if (busy?.busy) return await wait();
        return await advance((await purgeDraft()) ? "draft" : "rows");
      }
      case "rows": {
        const portfolio = row.portfolio_id ?? "";
        await env.DB.batch([
          // The request withdrew private GitHub access. A consent that
          // completed in between left an active grant: queue its revocation
          // before its connection row goes with the portfolio.
          env.DB.prepare(
            `UPDATE github_grant SET state='pending',
              token_enc=(SELECT token_enc FROM github_connection WHERE portfolio_id=?),
              token_binding=(SELECT token_binding FROM github_connection WHERE portfolio_id=?),
              retry_at=0,last_error=NULL,provider_rejected=0
            WHERE state='active' AND EXISTS(SELECT 1 FROM github_connection c WHERE c.portfolio_id=?
              AND c.token_enc IS NOT NULL AND c.token_binding IS NOT NULL AND c.app_id=github_grant.app_id
              AND c.github_user_id=github_grant.github_user_id AND c.grant_operation=github_grant.operation_id)`,
          ).bind(portfolio, portfolio, portfolio),
          env.DB.prepare("DELETE FROM portfolio WHERE id=?").bind(portfolio),
          env.DB.prepare(
            "DELETE FROM user WHERE id=? AND deleting_at IS NOT NULL",
          ).bind(row.user_id),
        ]);
        return await advance("final");
      }
      case "final":
        if (row.portfolio_id && (await purgeDraft()))
          return await advance("final");
        if (!local && row.address)
          await verifyPublicationUrl(
            env,
            `https://${row.address}.hasaweb.site/`,
            { status: 404 },
          );
        await env.DB.prepare(
          "DELETE FROM account_deletion WHERE id=? AND stage='final'",
        )
          .bind(id)
          .run();
        return "done";
    }
  } catch (error) {
    await env.DB.prepare(
      "UPDATE account_deletion SET attempts=attempts+1,next_attempt_at=? WHERE id=?",
    )
      .bind(now + Math.min(300000, 1000 * 2 ** Math.min(row.attempts, 8)), id)
      .run();
    throw error;
  }
}

/** Re-drives due cleanups whose wake was lost or failed. */
export async function sweepAccountDeletions(env: DeletionEnv) {
  const rows = await env.DB.prepare(
    "SELECT id FROM account_deletion WHERE next_attempt_at<=? ORDER BY next_attempt_at LIMIT 4",
  )
    .bind(Date.now())
    .all<{ id: string }>();
  for (const row of rows.results)
    await env.PUBLICATION_QUEUE.send({ deletionId: row.id });
}

// Better Auth's cookies under the product prefix (`packages/auth`): the
// session token, the 300-second cookie cache and the remember flag.
const AUTH_COOKIES = ["session_token", "session_data", "dont_remember"];

export function addAccountRoutes(app: Hono<OwnerBindings>) {
  app.post("/api/owner/account/delete", async (c) => {
    // A stale tab must not delete another account.
    const expected = c.req.header("X-Expected-Owner-Id");
    if (!expected) return privateJson({ error: "invalid_input" }, 400);
    const identity = c.get("identity");
    if (expected !== identity.user.id)
      return privateJson({ error: "owner_changed" }, 409);
    try {
      accountDeletionRequestSchema.parse(await readBody(c.req.raw, 256));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SaveError)
        return privateJson({ error: "invalid_input" }, 422);
      throw error;
    }
    // Private activity goes first, through the Phase 41 withdrawal, while
    // the session still authorizes it. If it cannot commit, nothing else
    // has changed and the owner retries.
    if (!(await withdrawPrivateActivity(c.env.DB, identity)))
      return privateJson({ error: "conflict" }, 409);
    const started = await requestAccountDeletion(c.env.DB, identity);
    if (!started) return privateJson(null, 401);
    await startCleanup(c);
    // A lost wake is recovered by the cron sweep.
    if (c.env.PUBLICATION_QUEUE)
      background(
        c,
        c.env.PUBLICATION_QUEUE.send({
          deletionId: started.deletionId,
        }).catch(() => {}),
      );
    const response = privateJson({ deleted: true });
    const { secure } = authSettings(c.env);
    const prefix = secure ? "__Host-hasaweb" : "hasaweb-local";
    for (const name of AUTH_COOKIES)
      response.headers.append(
        "Set-Cookie",
        `${prefix}.${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
      );
    return response;
  });
  app.all("/api/owner/account/delete", () =>
    privateJson({ error: "invalid_input" }, 405),
  );
}
