import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev({ persist: { path: "../../.wrangler/state" } });
}
const config: NextConfig = {
  transpilePackages: ["@hasaweb/config"],
  images: { unoptimized: true },
};
export default config;
