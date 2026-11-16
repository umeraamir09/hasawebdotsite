---
name: zap-da-brain
description: Explain a specified hasaweb.site roadmap phase in plain language, including what it implements and which part of the app it develops.
---

# Zap da brain

Require a phase number from the user, including any letter suffix such as 42F. If it is missing, ask for it and wait. If it does not match an entry in `docs/roadmap.md`, say so and ask for a valid number.

Read the phase in `docs/roadmap.md` (checked phases are in its Done table) and follow its links to the acceptance criteria and [architecture](../../../docs/architecture.md) as needed to explain it accurately. Do not infer that work is done from a plan alone.

Explain the phase for a nontechnical reader: its number and name, what it implements, which part of the app it develops, and what an owner or visitor can do or notice as a result. Explain technical terms in everyday words. For infrastructure work, explain what it enables without implying it is a visible feature. Link to the roadmap entry and essential sources, and say when the sources leave something unclear.

Add a brief complexity and risk rating, each low, medium or high with a short reason grounded in the phase. Keep implementation complexity separate from how much harm a failure would cause.

Keep it short: a brief opening and a few concise bullets. If an `unslop` skill is available, apply it to the explanation. This skill explains a phase; it does not implement it.
