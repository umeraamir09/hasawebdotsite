// Test-only SQL against the fixture D1. Miniflare occasionally drops the
// connection to its D1 service under CI load ("Network connection lost").
// Reads, and writes the caller marks idempotent (cleanup DELETEs, upserts with
// fixed values), are safe to repeat, so retry them. Other writes fail loudly
// because a dropped write may already have applied.
import { setTimeout } from "node:timers/promises";

const readOnly = /^\s*(select|with|pragma)\b/i;

export function createFixtureSql(post, { attempts = 4, delayMs = 250 } = {}) {
  return async function sql(query, values = [], { idempotent = false } = {}) {
    const repeatable = idempotent || readOnly.test(query);
    for (let attempt = 1; ; attempt++) {
      const response = await post({ query, values });
      if (response.status === 200) return (await response.json()).results;
      const text = await response.text();
      if (
        attempt < attempts &&
        repeatable &&
        response.status === 500 &&
        text.includes("Network connection lost")
      ) {
        await setTimeout(delayMs * attempt);
        continue;
      }
      throw new Error(`fixture sql ${response.status}: ${text}`);
    }
  };
}
