# Phase 05 plan

1. Inspect Better Auth 1.7.7 provider and linking behavior. Create an isolated spike branch and write the scope and acceptance checks before implementation.
2. Configure GitHub and Google sign-in, verified-only linking, D1 sessions, and host-only secure cookies. Keep fixture machinery outside product routes.
3. Exercise real Better Auth OAuth callbacks against controlled provider HTTP responses in workerd with local D1. Cover ownership, failed callbacks, cookie cache, and session lifecycle.
4. Record reproducible evidence, supported settings, and any remaining live-provider or browser checks. Ask the owner before checking off Phase 05.
