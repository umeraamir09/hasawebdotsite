# Acceptance criteria

- Hot owner requests pass through a web adapter and named jobs binding without OpenNext body conversion. Direct jobs HTTP requests cannot invoke the internal API.
- Both Workers reuse the same proven Better Auth rules. Only configuration is cached; interleaved owners and concurrent requests cannot share identities.
- Valid signed sessions work. Missing/tampered/expired/revoked sessions and deleting owners fail. Exact authority, Origin, method and JSON checks apply. Failures return private, no-store responses.
- Representative component drafts validate. Malformed JSON, unsafe content, unknown fields, oversized UTF-8 bodies and stale revisions fail without writes. A complete 1 MiB draft remains accepted with bounded envelope overhead.
- Content and separate progress update together under an owner/session/revision condition. Concurrent stale saves cannot overwrite the winner. Another owner's records remain unchanged. Revocation/deletion between authorization and write blocks the mutation.
- Evidence distinguishes local elapsed measurements, provider CPU and deployed startup. Cold candidates and warm distributions remain separate, with sample counts, Worker versions and failures recorded. Both web and jobs costs are accounted for.
- Measured warm CPU p95 is below 10 ms and startup below 1,000 ms, or the failed result and revised compatible approach are explicitly presented for owner agreement before dependent phases. No inferred approval or paid-plan assumption.
- Existing auth, persistence and runtime checks pass. The roadmap remains unchecked pending explicit completion approval.

## Verification outcome

The implementation and access/validation/atomic-write criteria pass the local groups and deployed correctness checks described in [results.md](results.md). Startup passes at 49/98 ms. The maximum-size CPU criterion fails at 44.337 ms validation p95 and 59.874 ms save p95 in the incomplete distribution, with a confirmed save `exceededCpu` outcome. The compatible-revision alternative awaits owner agreement to [revision.md](revision.md). Phase completion is pending; no checkbox approval has been inferred.
