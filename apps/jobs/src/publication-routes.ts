import {
  ownerCaseStudyAddresses,
  ownerPublicationOperations,
  ownerPublicationSite,
  PublicationCommitError,
  type PublicationPolicy,
  privateJson,
  SaveError,
  UnpublishError,
  type UnpublishWake,
} from "@hasaweb/db";
import {
  caseStudyAddressCommandSchema,
  publicationCommitRequestSchema,
  publicationSiteCommandSchema,
  publicationStatusCommandSchema,
} from "@hasaweb/schema";
import type { Hono } from "hono";
import { ZodError } from "zod";
import { readBody } from "./draft-routes";
import type { OwnerBindings } from "./owner-api";

export type PublicationBindings = {
  ASSET_ORIGIN: string;
  PUBLICATION_QUEUE: PublicationPolicy["queue"] & Queue<UnpublishWake>;
};
export function addPublicationRoutes(app: Hono<OwnerBindings>) {
  app.post("/api/owner/publication/case-studies", async (c) => {
    try {
      const command = caseStudyAddressCommandSchema.parse(
        await readBody(c.req.raw, 1024),
      );
      return privateJson(
        await ownerCaseStudyAddresses(
          c.env.DB,
          c.get("identity"),
          command.portfolioId,
        ),
      );
    } catch (error) {
      if (error instanceof ZodError)
        return privateJson({ error: "invalid_input" }, 422);
      if (error instanceof SaveError)
        return privateJson({ error: error.code }, error.status);
      return privateJson({ error: "publication_unavailable" }, 503);
    }
  });
  app.all("/api/owner/publication/case-studies", () =>
    privateJson({ error: "invalid_input" }, 405),
  );
  // Phase 48. `site` reads the public state; `unpublish` withdraws it.
  for (const action of ["site", "unpublish"] as const) {
    app.post(`/api/owner/publication/${action}`, async (c) => {
      try {
        const command = publicationSiteCommandSchema.parse(
          await readBody(c.req.raw, 1024),
        );
        const site = ownerPublicationSite(c.env.DB, c.get("identity"));
        if (action === "site")
          return privateJson(await site.read(command.portfolioId));
        if (!c.env.PUBLICATION_QUEUE)
          return privateJson({ error: "publication_unavailable" }, 503);
        return privateJson(
          await site.unpublish(command.portfolioId, c.env.PUBLICATION_QUEUE),
        );
      } catch (error) {
        if (error instanceof ZodError)
          return privateJson({ error: "invalid_input" }, 422);
        if (error instanceof SaveError)
          return privateJson({ error: error.code }, error.status);
        if (error instanceof UnpublishError)
          return privateJson({ error: error.code }, 409);
        return privateJson({ error: "publication_unavailable" }, 503);
      }
    });
    app.all(`/api/owner/publication/${action}`, () =>
      privateJson({ error: "invalid_input" }, 405),
    );
  }
  for (const action of ["start", "status", "commit"] as const) {
    app.post(`/api/owner/publication/${action}`, async (c) => {
      if (!c.env.ASSET_ORIGIN || !c.env.PUBLICATION_QUEUE)
        return privateJson({ error: "publication_unavailable" }, 503);
      const policy = {
        assetOrigin: c.env.ASSET_ORIGIN,
        batchSize: 16,
        queue: c.env.PUBLICATION_QUEUE,
      };
      const operations = ownerPublicationOperations(
        c.env.DB,
        c.get("identity"),
        policy,
      );
      try {
        const raw = await readBody(c.req.raw, 1024);
        if (action === "start") return privateJson(await operations.start(raw));
        if (action === "status") {
          const command = publicationStatusCommandSchema.parse(raw);
          return privateJson(
            await operations.status(command.portfolioId, command.operationId),
          );
        }
        const command = publicationCommitRequestSchema.parse(raw);
        return privateJson(
          await operations.commit(command.portfolioId, command.operationId),
        );
      } catch (error) {
        if (error instanceof ZodError)
          return privateJson({ error: "invalid_input" }, 422);
        if (error instanceof SaveError)
          return privateJson({ error: error.code }, error.status);
        if (error instanceof PublicationCommitError)
          return privateJson(
            { error: error.code },
            error.code === "unauthorized" ? 401 : 409,
          );
        return privateJson({ error: "publication_unavailable" }, 503);
      }
    });
    app.all(`/api/owner/publication/${action}`, () =>
      privateJson({ error: "invalid_input" }, 405),
    );
  }
}
