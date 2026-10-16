# Implementation plan

1. Read S-2, authentication, persistence and onboarding contracts. Establish the scoped experiment and acceptance checks.
2. Share the proven authentication implementation between web and jobs. Add a named internal Hono entry and a web Worker adapter which forwards the original request before OpenNext parses it.
3. Add an isolated runtime experiment with revision-conditional content/progress persistence and representative draft fixtures. Keep experiment routes absent from the product entry.
4. Run workerd access-control, validation, boundary, concurrent-identity and atomic-write checks. Run repository regression checks.
5. Measure deployed startup and CPU through the internal binding with cold candidates, ten warmups and 100 warm samples per workload. Record provider telemetry limitations and remove experiment sessions/resources.
6. Record results and any required runtime revision. Ask the owner whether to check off Phase 11A; leave its checkbox unchanged until approval.

## Recorded outcome

The implementation, local/deployed measurements, regression checks and experiment cleanup are recorded in [results.md](results.md). Full-body 1 MiB validation/saves fail the CPU target. The bounded-save revision is concrete and ready for owner review; it remains unapproved and unimplemented. Phase 11A stays unchecked until owner agreement and explicit completion approval.
