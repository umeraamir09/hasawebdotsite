# Phase 06 plan

1. Read product section 9, acceptance section 9, architecture sections 8.5 and 13, and current GitHub provider documentation.
2. Build an isolated S-6 adapter and provider fixtures. Keep sign-in and private-activity grants separate. Test matching identities, response projection, scope loss, failures, disconnect, and stale refresh results.
3. Run the fixture suite in local workerd with D1 and Web Crypto. Record evidence and the decisions needed by phases 40 through 42 and 47.
4. Document a live provider protocol and remaining evidence. Request owner review before checking off phase 06.
5. Serve an isolated local OAuth harness using the owner's configured test apps, collect live scope/calendar/revocation observations after browser consent, and update the candidate policies from those observations.
