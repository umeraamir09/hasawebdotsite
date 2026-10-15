# Phase 06 acceptance criteria

- Sign-in and activity permissions remain separate; absent consent, insufficient scopes, wrong login, and wrong stable ID cannot enable private activity.
- A matching authorized fixture produces the expected date/count graph, including a successful zero graph, without repository details, tokens, or raw errors.
- Public baseline fixtures with restricted counts fail closed rather than leaking anonymized private activity after disconnect.
- A 401, scope loss, identity change, or local disconnect removes private data without Publish. A simulated six-hour visit refresh and daily sweep detect revocation.
- Rate limits, network failures, server errors, malformed responses, and GraphQL partial errors preserve last good data and its timestamp without leaking raw errors.
- AES-GCM decrypts only with the correct key and binding; D1 conditional writes reject a refresh from a superseded grant.
- Evidence records the runtime, checks, and limits. A live protocol covers real public-only and authorized private accounts, visibility settings, scope inspection, and revocation. Do not claim fixture results satisfy the live account check.
- Leave the roadmap checkbox unchanged until the owner explicitly approves completion.
