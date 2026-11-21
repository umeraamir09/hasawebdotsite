// Phase 51 operator commands. No product UI: `pnpm ops <command>` runs these
// against D1 through `wrangler d1 execute` (scripts/operator.mjs), and the
// tests run the same functions against the migrated schema. Every command
// takes an executor `sql(query, values) => rows` and validates its input
// here, at the boundary.

const DAY_MS = 86_400_000;
export const AUDIT_RETENTION_MS = 90 * DAY_MS;

export class OperatorError extends Error {}

/**
 * One SQL literal for `wrangler d1 execute --command`, which takes no bound
 * parameters. SQLite string literals escape only `'`; NUL is refused.
 */
export function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && !value.includes("\0"))
    return `'${value.replaceAll("'", "''")}'`;
  throw new OperatorError(`Unexpected SQL value ${typeof value}`);
}

// Lookup audits must never hold an email, so neither identifier may contain
// "@": the operator is a handle, the case a ticket reference.
const OPERATOR = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CASE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,63}$/;
const ADDRESS = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function caseReference(value) {
  if (typeof value !== "string" || !CASE.test(value))
    throw new OperatorError(
      "--case must be a ticket reference (3-64 letters, digits or ._:/#-, no @)",
    );
  return value;
}
export function operatorId(value) {
  if (typeof value !== "string" || !OPERATOR.test(value))
    throw new OperatorError(
      "--operator must be your operator handle (lowercase letters, digits or ._-, no @)",
    );
  return value;
}
function reasonText(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejects them
    /[\u0000-\u001f\u007f@]/.test(value)
  )
    throw new OperatorError(
      "--reason must be up to 200 printable characters without @",
    );
  return value.trim();
}

/**
 * The portfolio an operator names: `{ address }` (a bare name or any URL on
 * `name.hasaweb.site`), `{ account }` (a user ID) or `{ portfolio }`.
 */
export function target({ address, account, portfolio }) {
  const given = [address, account, portfolio].filter((v) => v !== undefined);
  if (given.length !== 1)
    throw new OperatorError(
      "Name exactly one of --address, --account or --portfolio",
    );
  if (address !== undefined) {
    let name = String(address).toLowerCase();
    if (name.includes("/") || name.includes("."))
      name = new URL(name.includes("://") ? name : `https://${name}`).hostname
        .replace(/\.hasaweb\.site$/, "")
        .replace(/^www\./, "");
    if (!ADDRESS.test(name))
      throw new OperatorError(`Not a portfolio address: ${address}`);
    return { address: name };
  }
  const id = String(account ?? portfolio);
  if (!ID.test(id)) throw new OperatorError(`Not an ID: ${id}`);
  return account !== undefined ? { account: id } : { portfolio: id };
}

const portfolioColumns = `p.id AS portfolio_id,p.user_id AS account_id,p.status,p.subdomain,p.published_version,
  p.suspended_at,p.suspended_reason,u.deleting_at,
  (SELECT c.name FROM subdomain_claim c WHERE c.portfolio_id=p.id) AS claim_name,
  (SELECT c.state FROM subdomain_claim c WHERE c.portfolio_id=p.id) AS claim_state`;

export function operatorCommands({ sql, now = () => Date.now() }) {
  async function find(input) {
    const named = target(input);
    const where = named.address
      ? "(p.subdomain=? OR p.id=(SELECT c.portfolio_id FROM subdomain_claim c WHERE c.name=?))"
      : named.account
        ? "p.user_id=?"
        : "p.id=?";
    const values = named.address
      ? [named.address, named.address]
      : [named.account ?? named.portfolio];
    const [row] = await sql(
      `SELECT ${portfolioColumns} FROM portfolio p JOIN user u ON u.id=p.user_id WHERE ${where}`,
      values,
    );
    if (!row) {
      if (named.address) {
        const [claim] = await sql(
          "SELECT name,state,portfolio_id FROM subdomain_claim WHERE name=?",
          [named.address],
        );
        if (claim)
          throw new OperatorError(
            `${named.address} is an ownerless ${claim.state} name: its account was deleted and nothing is served`,
          );
      }
      throw new OperatorError("No portfolio matches");
    }
    return row;
  }

  return {
    find,

    /**
     * What an abuse report needs to act on: the portfolio, its account ID,
     * state and public address, plus any withdrawal still running. Read-only;
     * never includes the account email (see `emailLookup`).
     */
    async abuseReport(input) {
      const row = await find(input);
      const [withdrawal] = await sql(
        "SELECT id,version,attempts,completed_at FROM publication_withdrawal WHERE portfolio_id=? ORDER BY created_at DESC LIMIT 1",
        [row.portfolio_id],
      );
      const [versions] = await sql(
        "SELECT count(*) AS n,max(created_at) AS last FROM publish_version WHERE portfolio_id=?",
        [row.portfolio_id],
      );
      return {
        ...row,
        url: row.subdomain ? `https://${row.subdomain}.hasaweb.site` : null,
        served: row.status === "published",
        versions: versions?.n ?? 0,
        lastPublishedAt: versions?.last ?? null,
        withdrawal: withdrawal ?? null,
      };
    },

    /**
     * Suspends a portfolio. One guarded update moves it to `suspended`, and
     * `site` serves only `published` portfolios, so its pages, case studies,
     * resume and live endpoints stop at once and the owner cannot publish
     * (start and commit refuse `suspended`). A portfolio that was ever
     * published also gets the Phase 48 withdrawal, which the jobs cron runs
     * within a minute: delete every public upload copy of its versions, purge
     * both hosts and verify absence. Repeating it changes nothing more. The
     * draft, the address claim and the account stay.
     */
    async suspend({ reason, case: ref, ...input }) {
      const note = `${caseReference(ref)}: ${reasonText(reason)}`;
      const row = await find(input);
      if (row.status === "deleting" || row.deleting_at)
        throw new OperatorError("The account is being deleted");
      const at = now();
      await sql(
        `UPDATE portfolio SET status='suspended',suspended_at=?,suspended_reason=?,updated_at=?
         WHERE id=? AND status IN ('draft','published','unpublished')`,
        [at, note, at, row.portfolio_id],
      );
      // Written after the status change, so a lost statement can only leave
      // a suspended portfolio without its withdrawal, which a repeat adds.
      await sql(
        `INSERT INTO publication_withdrawal(id,portfolio_id,address,version,created_at)
         SELECT ?,p.id,p.subdomain,p.published_version,? FROM portfolio p
         WHERE p.id=? AND p.status='suspended' AND p.published_version IS NOT NULL AND p.subdomain IS NOT NULL
           AND NOT EXISTS(SELECT 1 FROM publication_withdrawal w WHERE w.portfolio_id=p.id
             AND w.version>=p.published_version AND (w.completed_at IS NULL OR w.created_at>=p.suspended_at))`,
        [crypto.randomUUID(), at, row.portfolio_id],
      );
      return find({ portfolio: row.portfolio_id });
    },

    /**
     * Lifts a suspension. Public files were withdrawn, so the portfolio does
     * not return to serving: a published one becomes `unpublished` (same
     * claimed address, served again after the owner's next Publish), one
     * that never published returns to `draft`.
     */
    async unsuspend({ case: ref, ...input }) {
      caseReference(ref);
      const row = await find(input);
      if (row.status !== "suspended")
        throw new OperatorError(`The portfolio is ${row.status}`);
      await sql(
        `UPDATE portfolio SET status=CASE WHEN published_version IS NULL THEN 'draft' ELSE 'unpublished' END,
           suspended_at=NULL,suspended_reason=NULL,updated_at=? WHERE id=? AND status='suspended'`,
        [now(), row.portfolio_id],
      );
      return find({ portfolio: row.portfolio_id });
    },

    /**
     * Contact outbox state without message content: totals per status and
     * the most recent rows (never `payload`, which holds the visitor's
     * message until delivery ends).
     */
    async outbox({ portfolio, status, limit = 20 } = {}) {
      if (
        status !== undefined &&
        !["queued", "sending", "sent", "failed"].includes(status)
      )
        throw new OperatorError(
          "--status must be queued, sending, sent or failed",
        );
      if (portfolio !== undefined) target({ portfolio });
      const count = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const filters = [];
      const values = [];
      if (portfolio !== undefined) {
        filters.push("portfolio_id=?");
        values.push(portfolio);
      }
      if (status !== undefined) {
        filters.push("status=?");
        values.push(status);
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      return {
        totals: await sql(
          `SELECT status,count(*) AS n,min(next_attempt_at) AS next_attempt_at FROM contact_outbox ${where} GROUP BY status ORDER BY status`,
          values,
        ),
        rows: await sql(
          `SELECT id,portfolio_id,status,is_test,attempts,next_attempt_at,accepted_at,deadline_at,finished_at,last_error,notice,notice_attempts,notice_next_at
           FROM contact_outbox ${where} ORDER BY accepted_at DESC LIMIT ${count}`,
          values,
        ),
      };
    },

    /**
     * Reads an account's email for a case. The audit row (operator, account,
     * case, time; never the email) is written first, and the email is read
     * only if that write landed. Audits are kept 90 days (`auditCleanup`)
     * and cascade away with the account's deletion.
     */
    async emailLookup({ operator, case: ref, ...input }) {
      const by = operatorId(operator);
      const reference = caseReference(ref);
      const row = await find(input);
      const id = crypto.randomUUID();
      const [audit] = await sql(
        `INSERT INTO operator_email_audit(id,operator_id,account_id,case_reference,accessed_at)
         SELECT ?,?,u.id,?,? FROM user u WHERE u.id=? RETURNING id`,
        [id, by, reference, now(), row.account_id],
      );
      if (!audit) throw new OperatorError("The lookup could not be audited");
      const [account] = await sql(
        "SELECT u.email FROM user u WHERE u.id=? AND EXISTS(SELECT 1 FROM operator_email_audit a WHERE a.id=? AND a.account_id=u.id)",
        [row.account_id, id],
      );
      if (!account) throw new OperatorError("The account is gone");
      return { accountId: row.account_id, email: account.email, auditId: id };
    },

    /** Deletes every lookup audit older than 90 days, in bounded pages. */
    async auditCleanup() {
      let removed = 0;
      for (let page = 0; page < 1000; page++) {
        const rows = await sql(
          "DELETE FROM operator_email_audit WHERE id IN (SELECT id FROM operator_email_audit WHERE accessed_at<? LIMIT 64) RETURNING id",
          [now() - AUDIT_RETENTION_MS],
        );
        removed += rows.length;
        if (rows.length < 64) break;
      }
      return { removed };
    },

    /**
     * What a rerender would publish: the saved revision, only when it is the
     * revision the live version was built from, so no unpublished draft
     * change becomes public. Throws when the portfolio is not served or has
     * changed since its last Publish (the owner's next Publish rerenders it).
     */
    async rerenderPlan(input) {
      const row = await find(input);
      if (row.status !== "published" || row.deleting_at)
        throw new OperatorError(
          `The portfolio is ${row.status}, not published`,
        );
      const [live] = await sql(
        `SELECT p.draft_rev,c.source_revision,c.renderer_version FROM portfolio p
         JOIN publish_version v ON v.portfolio_id=p.id AND v.n=p.published_version
         JOIN publication_candidate c ON c.id=v.candidate_id WHERE p.id=?`,
        [row.portfolio_id],
      );
      if (!live) throw new OperatorError("The live version has no candidate");
      if (live.draft_rev !== live.source_revision)
        throw new OperatorError(
          "The draft changed since the live version; only the owner's Publish can rerender it",
        );
      return {
        accountId: row.account_id,
        portfolioId: row.portfolio_id,
        address: row.subdomain,
        revision: live.draft_rev,
        rendererVersion: live.renderer_version,
      };
    },
  };
}

/**
 * Purges both public hosts of an address from the Cloudflare cache. Serving
 * already sends no-store (S-9); this covers anything cached before that.
 */
export async function purgeHosts({
  zoneId,
  token,
  address,
  fetch = globalThis.fetch,
}) {
  if (!zoneId || !token)
    throw new OperatorError(
      "Set CLOUDFLARE_ZONE_ID and CLOUDFLARE_CACHE_PURGE_TOKEN",
    );
  const hosts = [
    `${target({ address }).address}.hasaweb.site`,
    "assets.hasaweb.site",
  ];
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hosts }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success)
    throw new OperatorError(`Purge failed with ${response.status}`);
  return { hosts };
}
