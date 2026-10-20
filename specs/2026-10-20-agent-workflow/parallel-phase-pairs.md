# Parallel phase pair map

**Status:** analysis artifact for the October 20, 2026 agent-workflow branch.
**Visualizer:** [parallel-phase-pairs.html](parallel-phase-pairs.html) — static, self-contained view of the frontiers, pair counts and reference schedule.
**Source:** [docs/roadmap.md](../../docs/roadmap.md) at `7a40c1c`, plus the workflow rules in [docs/agent-workflow.md](../../docs/agent-workflow.md).
**Scope:** all 45 pending phases after Phase 16: 17–54, 22A and 42A–42F. Completed phases 01–16 and 11A–11E are collapsed.
**Authority:** this is a derived analysis, not an approved schedule. It does not check off a phase, approve a reusable milestone, authorize deployment or activate a feature.

## Certainty contract

The roadmap can prove dependency order. It cannot prove file-level write disjointness for phases that have not been scoped or implemented. This artifact therefore separates the two claims instead of overstating either.

**Proven from the roadmap:**

1. Every pending phase appears exactly once in Table 1.
2. Table 1 transcribes each `Dependencies:` line, summarizing the all-through sets for Phases 52–54. Phrase prerequisites that name a phase are included as that phase, most importantly Phase 26 for Phase 41's "verified withdrawal/cache-purge boundary from 26".
3. The start-dependency graph is acyclic.
4. A pair is dependency-independent when neither phase is in the other's transitive start-dependency closure. Table 3 lists every same-frontier independent pair: **82 pairs**. The appendix lists every independent pair: **561 unordered pairs**.
5. Table 4 is dependency-valid at every round: no phase starts before all of its start dependencies are complete.
6. Table 4 uses the minimum possible **24 rounds** for two workers. Phase 52 depends on all 42 other pending phases; 53 depends on 52; 54 depends on 53. The final three rounds are therefore single-worker rounds, and the first 42 phases need at least 21 two-worker rounds: `21 + 3 = 24`.

**Not proven by the roadmap:**

1. **File-level disjointness.** No future phase has a file/package assignment yet. The `Shared` column is a conservative intersection of the write surfaces named in each phase's scope. It is a coordination warning, not proof that two branches touch the same file.
2. **Equal phase duration.** The 24-round minimum is structural. It is not a time estimate and does not account for review, approval or verification waits.
3. **Approval.** A dependency being complete does not approve the dependent phase. Every phase still needs explicit owner approval.
4. **Boundary safety.** The workflow's existing rule still applies: one owner implements overlapping code or interface changes, and that prerequisite lands before consumers depend on it.

The only pairs with **no shared declared surface** are the strict-independent pairs. Within Table 3 they are **17 + 43**, **36 + 43** and **25 + 42C**. Of these, **17 + 43** is completion-ordered because 43's completion gate includes 17; the other two are independent at both start and completion. The reference schedule also uses two strict-independent cross-frontier pairs: **48 + 42D** and **51 + 42F**. Everything else is parallelizable only through the workflow's one-owner rule for the named shared contract.

## What "parallel" means here

- **Two implementation workers** are the default. Each gets its own worktree and branch from the approved shared base.
- **Co-start pair** means two phases in the same readiness frontier with no dependency path between them. They can be launched together without first completing a phase from a later frontier or holding an already-completed phase open.
- **Frontier** is the longest path over start dependencies. Frontier `0` can start now; frontier `n` becomes fully start-ready after frontier `n-1` completes. A phase can become ready earlier than its frontier if its own dependency chain is shorter; the frontier is the conservative scheduling point.
- **Start dependencies** exclude `Integration before full completion:` lines. Those lines gate completion and checkoff, not the start of implementation.

## Table 1: start dependencies and frontiers

Completed phases are omitted from the dependency column. For example, Phase 40's completed dependencies 06, 11C–11D, 13–16 are not repeated; Phase 41's completed 06, 11D and 15 are not repeated.

| Phase | Title | Start dependencies (pending) | Frontier |
| --- | --- | --- | --- |
| 17 | Editor and live preview | — | 0 |
| 18 | Private upload storage | — | 0 |
| 19 | Upload controls and cropping | 17, 18 | 1 |
| 20 | Profile and provider suggestions | 17, 18, 19 | 2 |
| 21 | Social and contact identity | 17 | 1 |
| 22 | Unreserved address selection | 17 | 1 |
| 22A | Setup-aware account entry | 17, 18, 19, 20, 21, 22 | 3 |
| 23 | Publication validation | 17, 18, 20, 21, 22, 22A | 4 |
| 24 | Immutable publication versions | 18, 23 | 5 |
| 25 | Commit and serve a version | 22, 23, 24 | 6 |
| 26 | Republish primitives | 23, 24, 25 | 7 |
| 27 | Component picker and ordering | 17 | 1 |
| 28 | Project cards | 19, 27 | 2 |
| 29 | Rich text and text sections | 17, 27 | 2 |
| 30 | Project case studies | 18, 19, 28, 29 | 3 |
| 31 | Skills and categories | 17, 27 | 2 |
| 32 | Work experience | 17, 27 | 2 |
| 33 | Social links component | 21, 27 | 2 |
| 34 | Resume download | 17, 18, 27 | 2 |
| 35 | Preset appearance controls | 17 | 1 |
| 36 | Custom color generation | — | 0 |
| 37 | Decorations and Face Reveal setup | 19, 35, 36 | 2 |
| 38 | Face Reveal interaction | 37 | 3 |
| 39 | Full-page draft preview | 17, 30, 34, 35, 38 | 4 |
| 40 | Public GitHub graph | 17, 27 | 2 |
| 41 | Private activity consent | 40, 26 | 8 |
| 42 | GitHub refresh | 40, 41 | 9 |
| 42A | Guide shell and Address | 17, 22, 22A | 4 |
| 42B | Profile and Links screens | 19, 20, 21, 42A | 5 |
| 42C | Skills and Projects adapters | 27, 28, 31, 42B | 6 |
| 42D | GitHub onboarding | 22A, 40, 41, 42, 42B, 42C | 10 |
| 42E | Review and handoff | 17, 22A, 23, 24, 25, 26, 35, 40, 41, 42, 42A, 42B, 42C, 42D | 11 |
| 42F | Onboarding verification | 42E, 42 | 12 |
| 43 | Email adapters | — | 0 |
| 44 | Contact submissions | 25, 43 | 7 |
| 45 | Message delivery | 44 | 8 |
| 46 | Sharing metadata | 17 | 1 |
| 47 | Connected-provider settings | 22A, 41 | 9 |
| 48 | Unpublish and restore | 25, 26 | 8 |
| 49 | Account deletion | 18, 24, 25, 26, 41, 48 | 9 |
| 50 | Discovery and example | 17, 35 | 2 |
| 51 | Operator controls | 18, 25, 26, 41, 45, 49 | 10 |
| 52 | Production delivery | all pending phases through 51, plus 22A and 42A–42F | 13 |
| 53 | Acceptance review | all pending phases through 52 | 14 |
| 54 | Journey validation and launch | 50, 52, 53, 42F | 15 |

Phase 41 is frontier 8 rather than an early frontier because its `Dependencies:` line explicitly includes the verified withdrawal/cache-purge boundary from Phase 26. Phase 26 is frontier 7, so 41 is frontier 8. This is the most consequential dependency that is easy to miss when reading the phase order alone.

## Table 2: completion gates excluded from start readiness

These are the roadmap's `Integration before full completion:` requirements. They do not block starting the phase, but they do block checking it off. Omitting them from start readiness is why the frontiers below are earlier than a naive read of every phase bullet would suggest.

| Phase | Completion gates |
| --- | --- |
| 28 | 23, 26 |
| 29 | 23, 26 |
| 30 | 23–26 |
| 31 | 23, 26 |
| 32 | 23, 26 |
| 33 | 23, 26 |
| 34 | 23–26 |
| 35 | 25, 30, 34 |
| 36 | 23–25, 35 |
| 37 | 23–26 |
| 38 | 25–26 and the verified S-9 withdrawal/cache policy |
| 40 | 23, 25–26 and the shared private preview/serving path |
| 42E | 39, 45 |
| 43 | 17, 23 |
| 44 | 23, 26 |
| 45 | 17, 39 |
| 46 | 20, 25, 30, 34, 39 |
| 48 | 38, 40–41, 44 |
| 50 | 25, 38–39, 42F, 45–46 and every capability presented in discovery/examples |

## Table 3: all same-frontier co-start pairs

All 82 pairs below are dependency-safe. The `Shared` column tells you what must be coordinated; it does not make the pair invalid. A pair with `none` is independent in both dependency and declared surface. A pair with `schema`, `renderer` or `publication` needs one owner for that shared contract before feature branches diverge.

Three same-frontier pairs are start-safe but completion-ordered: **17 + 43** (43's completion gate includes 17), **26 + 44** (44's completion gate includes 26) and **41 + 48** (48's completion gate includes 41). Start them together only if the prerequisite's shared behavior lands first; approve the prerequisite first. Table 4 uses 26 + 44 with that ordering and avoids 41 + 48; it runs 17 before 43 in separate rounds.

### Frontier 0 (6 pairs)

| Pair | Phases | Shared |
| --- | --- | --- |
| 17 + 18 | Editor and live preview + Private upload storage | schema |
| 17 + 36 | Editor and live preview + Custom color generation | renderer, schema |
| 17 + 43 | Editor and live preview + Email adapters | none |
| 18 + 36 | Private upload storage + Custom color generation | schema |
| 18 + 43 | Private upload storage + Email adapters | ops |
| 36 + 43 | Custom color generation + Email adapters | none |

### Frontier 1 (15 pairs)

| Pair | Phases | Shared |
| --- | --- | --- |
| 19 + 21 | Upload controls and cropping + Social and contact identity | editor, schema |
| 19 + 22 | Upload controls and cropping + Unreserved address selection | editor, schema |
| 19 + 27 | Upload controls and cropping + Component picker and ordering | editor, schema |
| 19 + 35 | Upload controls and cropping + Preset appearance controls | editor, schema |
| 19 + 46 | Upload controls and cropping + Sharing metadata | editor, schema |
| 21 + 22 | Social and contact identity + Unreserved address selection | editor, schema |
| 21 + 27 | Social and contact identity + Component picker and ordering | editor, schema |
| 21 + 35 | Social and contact identity + Preset appearance controls | editor, schema |
| 21 + 46 | Social and contact identity + Sharing metadata | editor, schema |
| 22 + 27 | Unreserved address selection + Component picker and ordering | editor, schema |
| 22 + 35 | Unreserved address selection + Preset appearance controls | editor, schema |
| 22 + 46 | Unreserved address selection + Sharing metadata | editor, schema |
| 27 + 35 | Component picker and ordering + Preset appearance controls | editor, schema, renderer |
| 27 + 46 | Component picker and ordering + Sharing metadata | editor, schema, renderer |
| 35 + 46 | Preset appearance controls + Sharing metadata | editor, renderer, schema |

### Frontier 2 (45 pairs)

| Pair | Phases | Shared |
| --- | --- | --- |
| 20 + 28 | Profile and provider suggestions + Project cards | editor, schema |
| 20 + 29 | Profile and provider suggestions + Rich text and text sections | editor, schema |
| 20 + 31 | Profile and provider suggestions + Skills and categories | editor, schema |
| 20 + 32 | Profile and provider suggestions + Work experience | editor, schema |
| 20 + 33 | Profile and provider suggestions + Social links component | editor, schema |
| 20 + 34 | Profile and provider suggestions + Resume download | editor, schema, storage |
| 20 + 37 | Profile and provider suggestions + Decorations and Face Reveal setup | editor, schema, storage |
| 20 + 40 | Profile and provider suggestions + Public GitHub graph | editor, schema |
| 20 + 50 | Profile and provider suggestions + Discovery and example | editor |
| 28 + 29 | Project cards + Rich text and text sections | editor, schema, renderer |
| 28 + 31 | Project cards + Skills and categories | editor, schema, renderer |
| 28 + 32 | Project cards + Work experience | editor, schema, renderer |
| 28 + 33 | Project cards + Social links component | editor, schema, renderer |
| 28 + 34 | Project cards + Resume download | editor, schema, renderer, publication |
| 28 + 37 | Project cards + Decorations and Face Reveal setup | editor, schema, renderer, publication |
| 28 + 40 | Project cards + Public GitHub graph | editor, schema |
| 28 + 50 | Project cards + Discovery and example | editor, renderer |
| 29 + 31 | Rich text and text sections + Skills and categories | editor, schema, renderer |
| 29 + 32 | Rich text and text sections + Work experience | editor, schema, renderer |
| 29 + 33 | Rich text and text sections + Social links component | editor, schema, renderer |
| 29 + 34 | Rich text and text sections + Resume download | editor, schema, renderer |
| 29 + 37 | Rich text and text sections + Decorations and Face Reveal setup | editor, schema, renderer |
| 29 + 40 | Rich text and text sections + Public GitHub graph | editor, schema |
| 29 + 50 | Rich text and text sections + Discovery and example | editor, renderer |
| 31 + 32 | Skills and categories + Work experience | editor, schema, renderer |
| 31 + 33 | Skills and categories + Social links component | editor, schema, renderer |
| 31 + 34 | Skills and categories + Resume download | editor, schema, renderer |
| 31 + 37 | Skills and categories + Decorations and Face Reveal setup | editor, schema, renderer |
| 31 + 40 | Skills and categories + Public GitHub graph | editor, schema |
| 31 + 50 | Skills and categories + Discovery and example | editor, renderer |
| 32 + 33 | Work experience + Social links component | editor, schema, renderer |
| 32 + 34 | Work experience + Resume download | editor, schema, renderer |
| 32 + 37 | Work experience + Decorations and Face Reveal setup | editor, schema, renderer |
| 32 + 40 | Work experience + Public GitHub graph | editor, schema |
| 32 + 50 | Work experience + Discovery and example | editor, renderer |
| 33 + 34 | Social links component + Resume download | editor, schema, renderer |
| 33 + 37 | Social links component + Decorations and Face Reveal setup | editor, schema, renderer |
| 33 + 40 | Social links component + Public GitHub graph | editor, schema |
| 33 + 50 | Social links component + Discovery and example | editor, renderer |
| 34 + 37 | Resume download + Decorations and Face Reveal setup | editor, schema, renderer, publication, storage |
| 34 + 40 | Resume download + Public GitHub graph | editor, schema |
| 34 + 50 | Resume download + Discovery and example | editor, renderer |
| 37 + 40 | Decorations and Face Reveal setup + Public GitHub graph | editor, schema |
| 37 + 50 | Decorations and Face Reveal setup + Discovery and example | editor, renderer |
| 40 + 50 | Public GitHub graph + Discovery and example | editor |

### Frontier 3 (3 pairs)

| Pair | Phases | Shared |
| --- | --- | --- |
| 22A + 30 | Setup-aware account entry + Project case studies | editor, schema |
| 22A + 38 | Setup-aware account entry + Face Reveal interaction | editor |
| 30 + 38 | Project case studies + Face Reveal interaction | editor, renderer, publication, storage |

### Frontier 4 (3 pairs)

| Pair | Phases | Shared |
| --- | --- | --- |
| 23 + 39 | Publication validation + Full-page draft preview | publication, schema, editor |
| 23 + 42A | Publication validation + Guide shell and Address | schema, editor |
| 39 + 42A | Full-page draft preview + Guide shell and Address | editor, schema |

### Frontier 5 (1 pair)

| Pair | Phases | Shared |
| --- | --- | --- |
| 24 + 42B | Immutable publication versions + Profile and Links screens | storage |

### Frontier 6 (1 pair)

| Pair | Phases | Shared |
| --- | --- | --- |
| 25 + 42C | Commit and serve a version + Skills and Projects adapters | none |

### Frontier 7 (1 pair)

| Pair | Phases | Shared |
| --- | --- | --- |
| 26 + 44 | Republish primitives + Contact submissions | publication, storage, ops |

### Frontier 8 (3 pairs)

| Pair | Phases | Shared |
| --- | --- | --- |
| 41 + 45 | Private activity consent + Message delivery | ops |
| 41 + 48 | Private activity consent + Unpublish and restore | ops |
| 45 + 48 | Message delivery + Unpublish and restore | ops |

### Frontier 9 (3 pairs)

| Pair | Phases | Shared |
| --- | --- | --- |
| 42 + 47 | GitHub refresh + Connected-provider settings | github |
| 42 + 49 | GitHub refresh + Account deletion | ops |
| 47 + 49 | Connected-provider settings + Account deletion | auth |

### Frontier 10 (1 pair)

| Pair | Phases | Shared |
| --- | --- | --- |
| 42D + 51 | GitHub onboarding + Operator controls | github, auth |

## Table 4: reference two-worker schedule

This is one valid schedule, not the only one. Pair order within a frontier is interchangeable. The schedule uses four cross-frontier pairs to keep both workers busy while a longer chain catches up; those pairs are explained below.

| Round | Pair | Shared | Handling |
| --- | --- | --- | --- |
| 1 | 17 + 18 | schema | Roadmap-named. One schema owner for draft asset references. 17 consumes asset IDs; 18 owns storage and owner-authorized routes. |
| 2 | 36 + 43 | none | Strict-independent. Palette generation and email adapters do not share a surface. |
| 3 | 19 + 22 | editor, schema | Roadmap-named. One schema owner for asset references and `requestedSubdomain`. Address selection is not a claim. |
| 4 | 21 + 27 | editor, schema | One schema owner for links and the component registry; separate editor panels. |
| 5 | 35 + 46 | editor, renderer, schema | One renderer/schema owner for the display model and metadata fields. |
| 6 | 20 + 28 | editor, schema | One schema owner for profile fields and the project component; separate editor panels. |
| 7 | 29 + 31 | editor, schema, renderer | One schema/registry owner for text sections and skills; separate editor panels. |
| 8 | 32 + 33 | editor, schema, renderer | One schema/registry owner for work entries and the social-links component; separate editor panels. |
| 9 | 34 + 37 | editor, schema, renderer, publication, storage | Highest coupling in the plan. Land the display-model and publication-manifest shape under one owner, or sequence 37 after 34. |
| 10 | 40 + 50 | editor | Shared editor surface only; separate pages. 40 owns the GitHub graph, 50 owns discovery. |
| 11 | 30 + 38 | editor, renderer, publication, storage | One renderer/publication owner for case-study pages and Face Reveal behavior; both add public-page behavior. |
| 12 | 22A + 39 | editor, schema | Cross-frontier. 22A unblocks 23 and 42A; 39 is ready after 30/34/35/38. Both are ready by this round. |
| 13 | 23 + 42A | schema, editor | Shared address/setup validation. 23 extends setup checks into publication validation; 42A consumes address checks. |
| 14 | 24 + 42B | storage | Coordinate asset readiness. 24 copies reachable assets; 42B creates profile assets. |
| 15 | 25 + 42C | none | Strict-independent. Publication serving and onboarding content adapters do not share a surface. |
| 16 | 26 + 44 | publication, storage, ops | 44's completion gate includes 26. Start together; land 26's publication behavior before 44 completes, and approve 26 first. |
| 17 | 41 + 45 | ops | Shared jobs runtime; separate GitHub and email services. Coordinate bindings and deployment only. |
| 18 | 42 + 47 | github | One GitHub service owner. 47 reuses 41's cleanup; 42 uses 41's generation contracts. |
| 19 | 48 + 42D | none | Cross-frontier. Unpublish/restore and GitHub onboarding do not share a surface; both are ready by this round. |
| 20 | 49 + 42E | auth, schema | Cross-frontier. 49 deletes recovery and prepared-replacement data that 42E uses. One auth/schema owner; test cross-account cleanup. |
| 21 | 51 + 42F | none | Cross-frontier. Operator controls and onboarding verification do not share a surface; both are ready by this round. |
| 22 | 52 | ops | Serial release chain. 52 needs all 42 prior phases plus 42F. |
| 23 | 53 | tests | Serial. 53 needs 52. |
| 24 | 54 | ops, tests | Serial. 54 needs 50, 52, 53 and 42F. |

### Why 24 rounds is minimal

Phase 52's start dependencies include every other pending phase. Phase 53 depends on 52. Phase 54 depends on 53. Therefore the last three rounds are necessarily single-worker rounds. The other 42 phases can occupy at most two workers per round, so they need at least 21 rounds. Table 4 achieves `21 + 3 = 24`. The count is a structural lower bound for two workers, not a duration estimate.

### Cross-frontier pairs used in Table 4

The four pairs below are not in Table 3 because the phases have different frontiers. Each is still dependency-independent and is ready by its round.

| Pair | Frontier | Why it is valid |
| --- | --- | --- |
| 22A + 39 | 3 / 4 | 39 does not depend on 22A. Both are ready after 30, 34, 35 and 38 complete. |
| 48 + 42D | 8 / 10 | 42D does not depend on 48. Both are ready after 42, 41 and 26 complete. |
| 49 + 42E | 9 / 11 | 42E does not depend on 49. Both are ready after 48 and 42D complete. |
| 51 + 42F | 10 / 12 | 51 does not depend on 42F. Both are ready after 49 and 42E complete. |

## How to read the shared surfaces

- `schema`: draft schema, forward migrations, validation, component registry. One owner lands the shared schema/registry change first. Do not let two workers edit the same migration or registry commit.
- `renderer`: shared display model, theme, CSS, asset manifest. One owner lands the shared shape before feature branches diverge.
- `publication`: publication preparation, pointer flip, serving, withdrawal, cache. One owner for the pipeline boundary.
- `storage`: R2/upload/private-asset transfer. One owner for the storage boundary.
- `auth`: session, account entry, linking, deletion. One owner for the auth/account boundary.
- `github`: graph, consent, refresh. One owner for the GitHub service boundary.
- `email`: adapters, submissions, delivery. One owner for the email service boundary.
- `ops`: jobs, runtime, cleanup, release. One owner for the runtime boundary.
- `editor`: editor or onboarding UI shell only. Separate panels/routes; reconcile shared imports at integration.
- `discovery` or `tests`: separate page or test surface.

A `none` pair is independent without a shared owner. A pair with any other tag is parallelizable only through the workflow's one-owner rule; this is a sequencing requirement, not a dependency between the phases.

## Appendix: all 561 dependency-independent pairs

This table lists each unordered pair once, under the earlier phase in frontier order. It is the full dependency-independent graph; Table 3 is the same-frontier subset that can be co-started. Use this appendix when you need to check a cross-frontier overlap.

| Phase | Frontier | Later independent partners |
| --- | --- | --- |
| 17 | 0 | 18, 36, 43 |
| 18 | 0 | 36, 43, 21, 22, 27, 35, 46, 29, 31, 32, 33, 40, 50 |
| 36 | 0 | 43, 19, 21, 22, 27, 35, 46, 20, 28, 29, 31, 32, 33, 34, 40, 50, 22A, 30, 23, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 43 | 0 | 19, 21, 22, 27, 35, 46, 20, 28, 29, 31, 32, 33, 34, 37, 40, 50, 22A, 30, 38, 23, 39, 42A, 24, 42B, 25, 42C, 26, 41, 48, 42, 47, 49, 42D, 42E, 42F |
| 19 | 1 | 21, 22, 27, 35, 46, 29, 31, 32, 33, 34, 40, 50 |
| 21 | 1 | 22, 27, 35, 46, 20, 28, 29, 31, 32, 34, 37, 40, 50, 30, 38, 39 |
| 22 | 1 | 27, 35, 46, 20, 28, 29, 31, 32, 33, 34, 37, 40, 50, 30, 38, 39 |
| 27 | 1 | 35, 46, 20, 37, 50, 22A, 38, 23, 42A, 24, 42B, 25, 26, 44, 45, 48 |
| 35 | 1 | 46, 20, 28, 29, 31, 32, 33, 34, 40, 22A, 30, 23, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51 |
| 46 | 1 | 20, 28, 29, 31, 32, 33, 34, 37, 40, 50, 22A, 30, 38, 23, 39, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 20 | 2 | 28, 29, 31, 32, 33, 34, 37, 40, 50, 30, 38, 39 |
| 28 | 2 | 29, 31, 32, 33, 34, 37, 40, 50, 22A, 38, 23, 42A, 24, 42B, 25, 26, 44, 41, 45, 48, 42, 47, 49, 51 |
| 29 | 2 | 31, 32, 33, 34, 37, 40, 50, 22A, 38, 23, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 31 | 2 | 32, 33, 34, 37, 40, 50, 22A, 30, 38, 23, 39, 42A, 24, 42B, 25, 26, 44, 41, 45, 48, 42, 47, 49, 51 |
| 32 | 2 | 33, 34, 37, 40, 50, 22A, 30, 38, 23, 39, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 33 | 2 | 34, 37, 40, 50, 22A, 30, 38, 23, 39, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 34 | 2 | 37, 40, 50, 22A, 30, 38, 23, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 37 | 2 | 40, 50, 22A, 30, 23, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 40 | 2 | 50, 22A, 30, 38, 23, 39, 42A, 24, 42B, 25, 42C, 26, 44, 45, 48 |
| 50 | 2 | 22A, 30, 38, 23, 39, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 22A | 3 | 30, 38, 39 |
| 30 | 3 | 38, 23, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 38 | 3 | 23, 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 23 | 4 | 39, 42A, 42B, 42C |
| 39 | 4 | 42A, 24, 42B, 25, 42C, 26, 44, 41, 45, 48, 42, 47, 49, 42D, 51, 42E, 42F |
| 42A | 4 | 24, 25, 26, 44, 41, 45, 48, 42, 47, 49, 51 |
| 24 | 5 | 42B, 42C |
| 42B | 5 | 25, 26, 44, 41, 45, 48, 42, 47, 49, 51 |
| 25 | 6 | 42C |
| 42C | 6 | 26, 44, 41, 45, 48, 42, 47, 49, 51 |
| 26 | 7 | 44, 45 |
| 44 | 7 | 41, 48, 42, 47, 49, 42D, 42E, 42F |
| 41 | 8 | 45, 48 |
| 45 | 8 | 48, 42, 47, 49, 42D, 42E, 42F |
| 48 | 8 | 42, 47, 42D, 42E, 42F |
| 42 | 9 | 47, 49, 51 |
| 47 | 9 | 49, 42D, 51, 42E, 42F |
| 49 | 9 | 42D, 42E, 42F |
| 42D | 10 | 51 |
| 51 | 10 | 42E, 42F |
| 42E | 11 | — |
| 42F | 12 | — |
| 52 | 13 | — |
| 53 | 14 | — |
| 54 | 15 | — |

## Reproducing the analysis

The dependency table is a manual transcription of every pending phase's `Dependencies:` line. The frontier is the longest path over pending start dependencies. The pair set is every unordered pair with no transitive dependency path. The 24-round schedule is one valid serialization of that graph; alternatives that preserve the same dependency constraints are equally valid.

If the roadmap changes, re-derive Tables 1–4 and the appendix. Do not edit a pair into the schedule without checking its transitive closure and the shared-surface rule.
