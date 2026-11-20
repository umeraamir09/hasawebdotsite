import { expect, it } from "vitest";
import { createFixtureSql } from "./fixture-sql.mjs";

const lost = () =>
  new Response("Error: Network connection lost.", { status: 500 });
const ok = () => Response.json({ results: [{ ok: 1 }] });

function fixture(responses) {
  const queries = [];
  const sql = createFixtureSql(
    async (body) => {
      queries.push(body.query);
      return responses.shift()();
    },
    { delayMs: 0 },
  );
  return { sql, queries };
}

it("retries reads after a lost connection", async () => {
  const { sql, queries } = fixture([lost, ok]);
  expect(await sql("SELECT 1")).toEqual([{ ok: 1 }]);
  expect(queries).toHaveLength(2);
});

it("retries writes marked idempotent", async () => {
  const { sql, queries } = fixture([lost, lost, ok]);
  await sql("DELETE FROM portfolio WHERE user_id='a'", [], {
    idempotent: true,
  });
  expect(queries).toHaveLength(3);
});

it("does not retry unmarked writes", async () => {
  const { sql, queries } = fixture([lost, ok]);
  await expect(sql("INSERT INTO t VALUES(1)")).rejects.toThrow(
    "fixture sql 500: Error: Network connection lost.",
  );
  expect(queries).toHaveLength(1);
});

it("does not retry other errors or beyond the attempt limit", async () => {
  const other = () => new Response("constraint failed", { status: 500 });
  const a = fixture([other]);
  await expect(a.sql("SELECT 1")).rejects.toThrow("constraint failed");
  const b = fixture([lost, lost, lost, lost, ok]);
  await expect(b.sql("SELECT 1")).rejects.toThrow("Network connection lost");
  expect(b.queries).toHaveLength(4);
});
