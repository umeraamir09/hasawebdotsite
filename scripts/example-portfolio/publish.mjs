// Publishes the internal example portfolio (Phase 50) through the product's
// own owner routes, exactly as the editor would: private uploads, revisioned
// draft patches, the setup handoff on the first run, then publication start,
// status and commit. Nothing writes the draft, candidate or public files
// directly. The only operator step is a short-lived session for the internal
// account (migration 0022_internal_example.sql), created here and deleted
// when the run ends.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { exampleContent, exampleImages, readExampleImage } from "./content.mjs";

const OWNER = "internal-example";
const PORTFOLIO = "internal-example";
const SESSION_MS = 15 * 60 * 1000;
const PUBLISH_LIMIT_MS = 10 * 60 * 1000;

export class ExamplePublishError extends Error {}

/** The Better Auth session cookie for a token, signed with the app secret. */
export function sessionCookie(token, secret, name) {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `${name}=${encodeURIComponent(`${token}.${signature}`)}`;
}

/**
 * @param {{
 *   origin: string,
 *   secret: string,
 *   sql: (query: string, values?: unknown[]) => Promise<unknown>,
 *   cookieName?: string,
 *   headers?: Record<string, string>,
 *   log?: (message: string) => void,
 *   pollMs?: number,
 * }} options
 * @returns {Promise<{ operation: object, site: { status: string, url: string | null } }>}
 */
export async function publishExample({
  origin,
  secret,
  sql,
  cookieName = new URL(origin).protocol === "https:"
    ? "__Host-hasaweb.session_token"
    : "hasaweb-local.session_token",
  headers = {},
  log = () => {},
  pollMs = 750,
}) {
  if (!secret || secret.length < 32)
    throw new ExamplePublishError("BETTER_AUTH_SECRET is required");
  const token = randomBytes(24).toString("hex");
  const sessionId = `example-publish-${randomBytes(8).toString("hex")}`;
  const now = Date.now();
  await sql(
    "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    [sessionId, token, OWNER, now + SESSION_MS, now, now],
  );
  const cookie = sessionCookie(token, secret, cookieName);
  async function call(path, { method = "POST", body, extra = {} } = {}) {
    const response = await fetch(new URL(path, origin), {
      method,
      redirect: "manual",
      headers: {
        ...headers,
        Cookie: cookie,
        Origin: origin,
        "X-Expected-Owner-Id": OWNER,
        ...(body === undefined || body instanceof Uint8Array
          ? {}
          : { "Content-Type": "application/json" }),
        ...extra,
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (!response.ok)
      throw new ExamplePublishError(
        `${method} ${path}: ${response.status} ${result?.error ?? text.slice(0, 200)}`,
      );
    return result;
  }
  try {
    let current = await call("/api/owner/draft", { method: "GET" });
    if (current.portfolioId !== PORTFOLIO)
      throw new ExamplePublishError(
        "The internal example portfolio is missing",
      );
    const assets = {};
    for (const [key, { purpose }] of Object.entries(exampleImages)) {
      const bytes = await readExampleImage(key);
      const receipt = await call("/api/assets", {
        method: "PUT",
        body: bytes,
        extra: {
          "Content-Type": "image/webp",
          "X-Asset-Purpose": purpose,
          "X-Asset-Bytes": String(bytes.byteLength),
        },
      });
      if (receipt?.status !== "ready")
        throw new ExamplePublishError(`Upload ${key} did not become ready`);
      assets[key] = receipt.id;
    }
    log(`Uploaded ${Object.keys(assets).length} images`);
    const content = exampleContent(assets);
    let revision = current.revision;
    let setup = current.firstEditorEnteredAt === null;
    async function set(path, value) {
      const change = { op: "set", path, value };
      ({ revision } = await call(
        "/api/owner/draft/patch",
        setup
          ? {
              body: {
                context: "setup",
                revision,
                progress: { schemaVersion: 1, step: "review" },
                change,
              },
            }
          : { body: { context: "content", revision, change } },
      ));
    }
    // Required setup first: an unfinished setup ends with the real handoff.
    await set(["profile"], content.profile);
    await set(["links"], content.links);
    if (setup) {
      const handoff = await call("/api/owner/setup/handoff", {
        body: { portfolioId: PORTFOLIO, revision },
      });
      if (handoff.kind !== "editor")
        throw new ExamplePublishError(
          `Setup is incomplete: ${handoff.issues?.join(", ") ?? handoff.kind}`,
        );
      // Entering the editor is itself a revision of the draft.
      revision = handoff.revision;
      setup = false;
      log("Setup handoff complete");
    }
    await set(["components"], content.components);
    await set(["appearance"], content.appearance);
    current = await call("/api/owner/draft", { method: "GET" });
    if (current.revision !== revision)
      throw new ExamplePublishError("The draft changed during the run");
    log(`Saved revision ${revision}`);

    const operationId = randomUUID();
    const end = Date.now() + PUBLISH_LIMIT_MS;
    let operation = await call("/api/owner/publication/start", {
      body: { portfolioId: PORTFOLIO, operationId, revision },
    });
    while (operation.stage !== "published") {
      if (operation.stage === "failed")
        throw new ExamplePublishError(
          `Publication failed: ${operation.error ?? "unknown"}`,
        );
      if (Date.now() >= end)
        throw new ExamplePublishError("Publication did not finish in time");
      if (operation.stage === "ready") {
        operation = await call("/api/owner/publication/commit", {
          body: { portfolioId: PORTFOLIO, operationId },
        });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      operation = await call("/api/owner/publication/status", {
        body: { portfolioId: PORTFOLIO, operationId },
      });
    }
    const site = await call("/api/owner/publication/site", {
      body: { portfolioId: PORTFOLIO },
    });
    if (site.status !== "published")
      throw new ExamplePublishError(`The example is ${site.status}`);
    log(`Published ${site.url}`);
    return { operation, site };
  } finally {
    await sql("DELETE FROM session WHERE id=?", [sessionId]);
  }
}
