# Free-tier owner-save implementation plan

1. Preserve the measured thin-runtime baseline in Git. Record scope and acceptance before changes.
2. Remove repeated JSON scans inside validated draft trees, retain the existing standalone contracts, add a bounded HTTP JSON parser, and test equivalent acceptance/rejection. Measure optimized full-size validation/save separately from the historical baseline.
3. If full-body saves still fail, implement a bounded server-validated save protocol with small revision-aware updates, private immutable staging for large strings/trees, and an atomic D1 canonical/progress commit. Preserve the 1 MiB ceiling and all cross-document rules.
4. Run adversarial workerd/D1 correctness, concurrency, revocation, size and interruption tests. Measure provider CPU for every supported request class through the web/named-jobs binding, with realistic 1 MiB and highly structured fixtures.
5. Verify additional request/D1/storage budgets and startup/cold observations. Remove temporary Cloudflare resources. Record measured limits, migration/integration requirements and rollback commits. Ask before checking off Phase 11A.
