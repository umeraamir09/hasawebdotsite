import { UPLOAD_UNREFERENCED_MS } from "@hasaweb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryBucket, sqliteD1 } from "../../../packages/db/test/sqlite-d1";
import { uploadCollection } from "../../web/lib/assets/collection";
import { logDatabaseSize, runMaintenance } from "./maintenance";

const DAY = 86_400_000;
// 12:05 UTC: a collection minute that is not the hourly size check.
const NOW = Date.UTC(2027, 0, 4, 12, 5);
const OLD = NOW - UPLOAD_UNREFERENCED_MS - DAY;

function world() {
  const db = sqliteD1();
  const draft = memoryBucket();
  const woken: unknown[] = [];
  const failures = { source: 0 };
  const run = (query: string, ...values: (string | number | null)[]) =>
    db.sqlite.prepare(query).run(...values);
  const env = {
    DB: db,
    PRIVATE_SOURCE: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (failures.source > 0) {
          failures.source--;
          return new Response(null, { status: 503 });
        }
        vi.setSystemTime(NOW);
        return uploadCollection(new Request(input, init), {
          DB: db,
          DRAFT_BUCKET: draft,
        });
      },
    },
    PUBLICATION_QUEUE: { send: async (body: unknown) => void woken.push(body) },
  };
  function owner(id: string, entered: boolean) {
    run(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      id,
      id,
      `${id}@example.test`,
      OLD,
      OLD,
    );
    run(
      "INSERT INTO portfolio(id,user_id,status,draft,first_editor_entered_at,created_at,updated_at) VALUES(?,?,'draft','{}',?,?,?)",
      `${id}-portfolio`,
      id,
      entered ? OLD : null,
      OLD,
      OLD,
    );
    return `${id}-portfolio`;
  }
  async function upload(portfolio: string, id: string, at = OLD) {
    run(
      "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES(?,?,'avatar','image/webp',1,'ready',?,?)",
      id,
      portfolio,
      at,
      at,
    );
    await object(`draft/${portfolio}/${id}`, at);
  }
  async function object(key: string, at = OLD) {
    await draft.put(key, "x");
    draft.uploaded.set(key, new Date(at));
  }
  return { db, draft, env, run, owner, upload, object, woken, failures };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduled maintenance", () => {
  it("runs only on collection minutes", async () => {
    const w = world();
    expect(await runMaintenance(w.env, NOW + 60_000)).toBeNull();
  });

  it("removes abandoned uploads and orphans but never setup or draft assets", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = world();
    const setup = w.owner("setup", false);
    const editor = w.owner("editor", true);
    await w.upload(setup, "setup-avatar");
    await w.upload(editor, "used");
    await w.upload(editor, "abandoned");
    w.run(
      "UPDATE portfolio SET draft=json_object('profile',json_object('avatar',json_object('assetId','used'))) WHERE id=?",
      editor,
    );
    // A finished deletion left an object; a fresh object may belong to an
    // upload whose row commits next.
    await w.object("draft/deleted-portfolio/left");
    await w.object(`draft/${editor}/fresh`, NOW - 60_000);
    const result = await runMaintenance(w.env, NOW);
    expect(result?.uploads).toEqual({ abandoned: 1, orphans: 1 });
    expect([...w.draft.objects.keys()].sort()).toEqual([
      `draft/${editor}/fresh`,
      `draft/${editor}/used`,
      `draft/${setup}/setup-avatar`,
    ]);
  });

  it("pages through the draft listing with a stored cursor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = world();
    for (let n = 0; n < 120; n++)
      await w.object(`draft/gone/${String(n).padStart(3, "0")}`);
    const counts: unknown[] = [];
    for (let tick = 0; tick < 3; tick++)
      counts.push((await runMaintenance(w.env, NOW))?.uploads);
    // Deleting shifts the memory listing; every orphan is still reached.
    for (let tick = 0; tick < 3 && w.draft.objects.size; tick++)
      await runMaintenance(w.env, NOW);
    expect(counts[0]).toEqual({ abandoned: 0, orphans: 50 });
    expect(w.draft.objects.size).toBe(0);
  });

  it("keeps the other tasks running when one fails", async () => {
    const w = world();
    w.failures.source = 1;
    w.run(
      "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,last_error,created_at,updated_at) VALUES('66666666-6666-4666-8666-666666666666','','',1,NULL,'failed','[]',0,0,'cleanup:exhausted',?,?)",
      NOW - 2 * DAY,
      NOW - 2 * DAY,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runMaintenance(w.env, NOW);
    expect(result).toMatchObject({
      uploads: "failed",
      staging: { pieces: 0, attempts: 0 },
      github: { grants: 0, consents: 0 },
      audits: 0,
      tombstones: 1,
    });
    expect(w.woken).toEqual([
      { candidateId: "66666666-6666-4666-8666-666666666666" },
    ]);
    expect(error).toHaveBeenCalledWith(
      "maintenance failed",
      "uploads",
      "Error",
    );
  });

  it("logs the database size from the hourly check", async () => {
    const w = world();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const hour = Date.UTC(2027, 0, 4, 13, 0);
    const collected = await runMaintenance(w.env, hour);
    expect(collected).not.toHaveProperty("size");
    expect(JSON.stringify(log.mock.calls)).not.toContain("d1_size");
    expect(JSON.stringify(error.mock.calls)).not.toContain("d1_size");
    await expect(logDatabaseSize(w.env)).resolves.toEqual({
      bytes: null,
      alert: false,
    });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "d1_size", bytes: null }),
    );
    log.mockRestore();
    error.mockRestore();
  });
});
