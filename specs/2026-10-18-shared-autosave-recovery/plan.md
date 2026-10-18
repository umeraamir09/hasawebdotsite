# Phase 14 implementation plan

1. Establish scoped controller, typed transport, recovery journal and coordination. Pin Zustand and idb-keyval. Keep editor/account routing unchanged.
2. Add schema-aware changed-subtree planning, two-second coalescing, direct/progress saves and bounded staged batches. Preserve exact values, progress, limits and canonical acknowledgements.
3. Implement durable checkpoints, explicit restore/resume/discard, lost-reply reconciliation, bounded cleanup and legacy validation. Fail closed on conflicts, account changes and frozen setup.
4. Add expected-owner guards and accessible shared React controls. Read Figma without changes. Exercise controls through an isolated browser fixture, never a production route.
5. Verify planner/controller, real API/browser failures, account isolation, quota counts and provider CPU. Run relevant regressions sequentially with new evidence directories.
6. Search current/historical guidance for changed assumptions, update dependent phases and record documentation impact/results. Leave the roadmap checkbox pending owner approval.

October 18, 2026 completion record: the owner explicitly approved the implemented phase and requested a pull request. Phase 14 is now checked in the roadmap; the approval requirement above describes the original implementation gate.
