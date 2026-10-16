# Shared authentication

Web provider routes and the named jobs owner API use this package's Better Auth configuration. It retains the verified-only GitHub/Google linking rules, host-only cookies, exact apex origin and persisted session/deletion checks established in Phase 11.

`productAuth` caches library configuration in a WeakMap keyed by the binding environment. `currentOwner` resolves identity for each request with the cookie cache disabled, then constructs repositories which recheck persisted session and deletion state. Do not retain identities or repositories globally.

Configure the same `APP_ORIGIN`, signing secret and provider credentials in web and jobs. The local example files document these values. Secrets are never forwarded as request headers. The named `OwnerApi` binding receives the original request cookie, and jobs independently authenticates it. Jobs' default HTTP entry does not expose owner routes.
