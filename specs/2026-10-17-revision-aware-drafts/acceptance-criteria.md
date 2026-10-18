# Phase 13 acceptance criteria

1. Current validated reads return one consistent draft/revision/progress/milestone snapshot. Metadata reads do not load the draft. Unsupported/unvalidated drafts fail closed and owner recovery retains original data.
2. Content and progress share atomic CAS. Concurrent saves have one winner. Staging changes nothing canonical until commit and retries return confirmed acknowledgements.
3. Setup closure rejects old/new setup writes. Content saves and explicit recovery/cleanup work after handoff without changing frozen progress or milestone.
4. Attempts remain owner/session/context scoped. Lost replies, session transfer, expiry, revocation, deletion, stalled input and D1 failures never falsely report saved state.
5. Strict schemas reject extra fields, owner/milestone flags, unsafe paths, invalid UTF-8/JSON, oversized wire bodies and invalid subtrees. All MVP components and approved byte boundaries retain support.
6. Bounded legacy validation agrees with the reference schema for valid/invalid fixtures, including structural/refinement/depth/version checks and long free text. Explicit corrections remain staged, restart validation, and cannot bless unchecked content.
7. Saves never change claims, published versions, public assets or connected-service rows. Two owners can save the same unclaimed candidate.
8. Workspace checks, actual binding/API integration, persistence, bounded saves, auth/browser and runtime regressions pass. Isolated provider CPU/startup and row/query evidence are recorded with resource cleanup receipts.
9. Documentation records exact results and limitations. The roadmap checkbox changes only after explicit completion approval. The owner gave that approval on October 18, 2026.
