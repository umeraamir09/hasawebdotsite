import { describe, expect, it, vi } from "vitest";
import {
  sweepUnpublishWithdrawals,
  withdrawUnpublished,
} from "./publication-unpublish";
import type { WithdrawalEnv } from "./publication-withdrawal";

type Withdrawal = {
  portfolio_id: string;
  address: string;
  version: number;
  cursor: string;
  attempts: number;
  status: string;
  completed_at: number | null;
};
const ID = "6f0d7a52-0d36-4c1c-9a0e-0f5d4c3b2a10";
const files = [
  { key: "candidate/a/assets/avatar", path: "/assets/avatar" },
  { key: "candidate/a/platform/abc.css", path: "/platform/abc.css" },
  { key: "candidate/b/assets/avatar", path: "/assets/avatar" },
];

// A D1 stand-in that answers the cleanup's statements from one record and a
// receipt list ordered by key, as the version join would.
function harness(
  record: Partial<Withdrawal> = {},
  { appEnv = "production", pageStatus = 404, hit = false } = {},
) {
  const row: Withdrawal = {
    portfolio_id: "portfolio",
    address: "owner",
    version: 2,
    cursor: "",
    attempts: 0,
    status: "unpublished",
    completed_at: null,
    ...record,
  };
  const objects = new Set(files.map((file) => file.key));
  const bucket = {
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    head: vi.fn(async (key: string) => (objects.has(key) ? {} : null)),
  };
  const sent: unknown[] = [];
  const fetched: string[] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              return sql.includes("FROM publication_withdrawal w") &&
                row.completed_at === null
                ? row
                : null;
            },
            async all() {
              if (sql.includes("SELECT id FROM publication_withdrawal"))
                return { results: row.completed_at ? [] : [{ id: ID }] };
              const after = String(values[2]);
              const version = Number(values[1]);
              return {
                results: files
                  .filter((file) => file.key > after)
                  .filter((file) => version >= 2 || file.key < "candidate/b")
                  .slice(0, 8),
              };
            },
            async run() {
              if (sql.includes("SET cursor=?")) {
                if (values[2] === row.cursor) row.cursor = String(values[0]);
              } else if (sql.includes("SET completed_at=?")) {
                if (values[2] === row.cursor) {
                  row.completed_at = Number(values[0]);
                  row.attempts = 0;
                }
              } else if (sql.includes("attempts=attempts+1")) {
                row.attempts++;
              }
              return {};
            },
          };
        },
      };
    },
  };
  const env = {
    APP_ENV: appEnv,
    DB,
    PUBLIC_ASSETS_BUCKET: bucket,
    PUBLICATION_QUEUE: { send: async (body: unknown) => sent.push(body) },
    ASSET_ORIGIN: "https://assets.hasaweb.site",
    CLOUDFLARE_ZONE_ID: "0".repeat(32),
    CLOUDFLARE_CACHE_PURGE_TOKEN: "fixture-only",
    CACHE_HTTP: {
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (url.startsWith("https://api.cloudflare.com/"))
          return Response.json({ success: true });
        const status = url.startsWith("https://owner.") ? pageStatus : 404;
        return new Response(null, {
          status,
          headers: {
            "Cache-Control": "no-store",
            ...(hit ? { "CF-Cache-Status": "HIT" } : {}),
          },
        });
      },
    },
  } as unknown as WithdrawalEnv;
  async function drain() {
    for (let step = 0; step < 10 && row.completed_at === null; step++)
      await withdrawUnpublished(env, ID);
  }
  return { env, row, objects, bucket, sent, fetched, drain };
}

describe("unpublish withdrawal", () => {
  it("deletes every public object, purges both hosts, then verifies absence", async () => {
    const { row, objects, sent, fetched, drain } = harness();
    await drain();
    expect(row.completed_at).not.toBeNull();
    expect(objects.size).toBe(0);
    expect(sent).toContainEqual({ withdrawalId: ID });
    const purge = fetched.indexOf(
      "https://api.cloudflare.com/client/v4/zones/00000000000000000000000000000000/purge_cache",
    );
    expect(purge).toBeGreaterThanOrEqual(0);
    // Uploads are verified on the asset host with a query variant; platform
    // files only through the portfolio host's final check.
    expect(fetched.slice(purge + 1)).toEqual([
      "https://assets.hasaweb.site/candidate/a/assets/avatar",
      "https://assets.hasaweb.site/candidate/a/assets/avatar?variant=warm",
      "https://assets.hasaweb.site/candidate/b/assets/avatar",
      "https://assets.hasaweb.site/candidate/b/assets/avatar?variant=warm",
      "https://owner.hasaweb.site/",
    ]);
  });

  it("never touches versions published after the unpublish", async () => {
    const { objects, drain } = harness({ version: 1 });
    await drain();
    expect([...objects]).toEqual(["candidate/b/assets/avatar"]);
  });

  it("skips the page check once a republish owns the host", async () => {
    const { row, fetched, drain } = harness(
      { status: "published" },
      { pageStatus: 200 },
    );
    await drain();
    expect(row.completed_at).not.toBeNull();
    expect(fetched).not.toContain("https://owner.hasaweb.site/");
  });

  it("keeps retrying with backoff while a cached copy is still observable", async () => {
    const { row, env } = harness({ cursor: "verify:" }, { hit: true });
    await expect(withdrawUnpublished(env, ID)).rejects.toThrow(
      "not yet observable",
    );
    expect(row.attempts).toBe(1);
    expect(row.completed_at).toBeNull();
    expect(row.cursor).toBe("verify:");
  });

  it("fails a delete that leaves the object in place", async () => {
    const { row, env, bucket } = harness();
    bucket.delete.mockImplementation(async () => {});
    await expect(withdrawUnpublished(env, ID)).rejects.toThrow("still present");
    expect(row.attempts).toBe(1);
    expect(row.cursor).toBe("");
  });

  it("deletes locally without purge or remote verification", async () => {
    const { row, objects, fetched, drain } = harness({}, { appEnv: "local" });
    await drain();
    expect(row.completed_at).not.toBeNull();
    expect(objects.size).toBe(0);
    expect(fetched).toEqual([]);
  });

  it("re-wakes unfinished cleanups from the cron sweep", async () => {
    const { env, sent } = harness();
    await sweepUnpublishWithdrawals(env);
    expect(sent).toEqual([{ withdrawalId: ID }]);
  });
});
