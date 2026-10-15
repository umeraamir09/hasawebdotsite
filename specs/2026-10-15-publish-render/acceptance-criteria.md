# Acceptance criteria

- One command bundles and runs the production React renderer in local workerd without credentials or deployment.
- Deterministic portfolio, case-study, and resume fixtures remain within the 1 MiB draft ceiling. Byte sizes and node counts are recorded.
- Evidence includes first-render and warm timing distributions, output sizes, runtime versions, raw samples, and sampled CPU profiles with an explicit measurement method.
- The experiment compares full-page and bounded fragment rendering. The report records whether one-page-per-step is supported and defines a fallback before publication implementation if necessary.
- Unit checks verify fixture boundaries, meaningful output, escaping, fragment ordering/equivalence, and oversized-fragment rejection. Relevant type and lint checks pass.
- Results state the limits of local evidence. Check the roadmap checkbox only after owner approval.

## Evidence

Implemented and measured on October 15, 2026. See [results.md](results.md) and its archived raw samples and profiles.

- Reproducible command, production bundle, all three near-limit page fixtures, first-use and warm distributions, runtime versions, CPU profiles and output sizes are recorded.
- Whole-page rendering and whole-snapshot preparation do not support the 10 ms assumption. The revised incremental approach is recorded before publication implementation.
- Exact whole-page/fragment HTML equivalence, escaping, input/fragment bounds, ordering, PDF fallback and oversized-atom failure pass in unit tests.
- `pnpm check`, `pnpm --filter @hasaweb/render build`, and the workerd benchmark pass. Timing results are observations, not a hard performance assertion in CI.
- Production CPU and the revised end-to-end pipeline remain unverified. S-8 must establish Workflow/assembly feasibility. The owner approved Phase 02 completion on October 15, 2026, and the roadmap checkbox is checked.
