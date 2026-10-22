// @ts-expect-error OpenNext generates this module at build time.
import handler from "./.open-next/worker.js";
import { privateAssetRequest } from "./lib/assets";
import { forwardOwnerRequest } from "./lib/owner-forward";

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    return (
      (await privateAssetRequest(request, env, ctx)) ??
      (await forwardOwnerRequest(request, env)) ??
      handler.fetch(request, env, ctx)
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
