# Implementation plan

October 27, 2026 supersession: the owner approved [Workers Paid at launch and local development now](../../docs/deployment-policy.md). Free-only CPU/quota fit and prohibitions on planning a paid launch no longer block local implementation. Preserve original measurements, phase approvals, renderer/security/content contracts and S-9 withdrawal requirements. Use the integrated S-8 local milestone; final native paid verification is a release gate. No subscription change occurs during local development.

1. Define bounded synthetic fixtures for the 1 MiB draft ceiling, covering all MVP component shapes, large rich text, case-study images, and a resume page.
2. Bundle the React server renderer in production mode and execute it in local workerd. Capture first-use and warm synchronous timings and inspector CPU profiles without deploying anything.
3. Compare whole-page rendering with independently rendered fragments. Record input/output sizes, distributions, overhead exclusions, and a bounded fallback if a page exceeds the budget.
4. Run checks, retain reproducible evidence, and record the S-1 decision before publication implementation. Ask the owner before checking off Phase 02.

## Outcome

All four task groups are complete. The original whole-page assumption failed locally. Results and the revised approach are recorded in results.md. No publication implementation was added. The owner approved Phase 02 completion on October 15, 2026. The roadmap checkbox is checked.
