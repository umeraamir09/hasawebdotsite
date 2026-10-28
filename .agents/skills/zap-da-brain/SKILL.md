---
name: zap-da-brain
description: Explain a specified hasaweb.site roadmap phase in plain language, including what it implements and which part of the app it develops.
---

# Zap da brain

Require a phase number from the user, including any letter suffix such as 22A. If it is missing, ask for it and wait. Do not pick a phase yourself. If the number does not match an entry in `docs/roadmap.md`, say so and ask for a valid number.

Read the requested phase in `docs/roadmap.md` and its relevant context in `docs/implementation-status.md`. Follow the phase's links to current requirements, acceptance criteria, contracts and implementation results as needed to explain the work accurately. Current contracts supersede historical experiments. Distinguish planned work from completed and owner-approved work, and mention prerequisites or remaining work only when necessary to understand the phase. Do not infer approval or implementation from a plan alone.

Explain the phase in a neat, easy-to-scan format for a nontechnical reader. Include the phase number and name, what it implements, which part of the app it develops and what a user or owner can do or notice as a result. Explain necessary technical terms in everyday words. If the phase is infrastructure or feasibility work, explain what it enables without implying it is already a visible feature. Link to the roadmap entry and any essential sources, and say when the sources leave something unclear.

Include a brief complexity and severity/risk evaluation, each rated low, medium or high with a short reason grounded in the phase and its documented constraints. Distinguish implementation complexity from the severity or likelihood of harm if the work fails; do not present an unsupported rating as fact.

Keep the response short: aim for a brief opening and a few concise bullets. Include only details needed to understand the phase; avoid exhaustive feature lists and over-description. Read and apply the `unslop` skill to the explanation. This skill explains the phase; it does not implement it or change its approval status.
