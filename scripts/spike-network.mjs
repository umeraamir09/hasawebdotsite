import dns from "node:dns/promises";
import { createRequire } from "node:module";

// Real public recursive DNS, not injected Host headers or fixed edge IPs.
// This avoids stale OS answers during the new nameserver delegation.
export function publicNetwork() {
  const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
  resolver.setServers(["1.1.1.1"]);
  function lookup(host, options, callback) {
    resolver.resolve4(host).then((addresses) => {
      if (options.all)
        callback(
          null,
          addresses.map((address) => ({ address, family: 4 })),
        );
      else callback(null, addresses[0], 4);
    }, callback);
  }
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(require.resolve("wrangler"));
  const { Agent } = wranglerRequire("undici");
  return { resolver, lookup, dispatcher: new Agent({ connect: { lookup } }) };
}
