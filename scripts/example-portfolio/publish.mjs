// Publishes the internal example portfolio (Phase 50) through the product's
// own owner routes, exactly as the editor would: private uploads, revisioned
// draft patches, the setup handoff on the first run, then publication start,
// status and commit. Nothing writes the draft, candidate or public files
// directly. The only operator step is a short-lived session for the internal
// account (migration 0022_internal_example.sql), created here and deleted
// when the run ends (`scripts/operator/owner-session.mjs`).
import {
  OwnerSessionError as ExamplePublishError,
  publishRevision,
  withOwnerSession,
} from "../operator/owner-session.mjs";
import { exampleContent, exampleImages, readExampleImage } from "./content.mjs";

const OWNER = "internal-example";
const PORTFOLIO = "internal-example";

export { ExamplePublishError };

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
  cookieName,
  headers,
  log = () => {},
  pollMs = 750,
}) {
  return withOwnerSession(
    {
      origin,
      secret,
      sql,
      owner: OWNER,
      label: "example-publish",
      cookieName,
      headers,
    },
    async (call) => {
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
      const { operation, site } = await publishRevision(call, {
        portfolioId: PORTFOLIO,
        revision,
        pollMs,
      });
      if (site.status !== "published")
        throw new ExamplePublishError(`The example is ${site.status}`);
      log(`Published ${site.url}`);
      return { operation, site };
    },
  );
}
