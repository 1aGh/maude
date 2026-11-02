# Maude v2 — contract notes

One note per Phase 1 spike (and per lane-to-lane agreement later), named `<task-id>-<topic>.md`
(e.g. `V2-1.3-action-registry.md`). A note is the interface both sides code against; the lead
merges it before anyone builds on it. Plan: `.ai/plans/feature-maude-v2-redesign.md`.

Precedence when sources disagree: Gate 0 register (plan) → `.design/system/maude-v2/CONTRACT.md`
→ the topic-owning canvas → other canvases → `_kit.tsx` → inventories. Gate 0 A13 holds everywhere:
**files are the API** — Claude drives every capability by editing readable files in `.design/` or by
a `maude` verb; no MCP layer.

## Sections (in this order)

1. **Question** — the spike's "Must answer" from the plan, verbatim.
2. **What exists today** — with file paths and symbol names (no line numbers — code moves), and the
   kg decisions / DDRs that constrain it (`kg search`).
3. **Options** — each with its cost and what it breaks; the plan's default approach is option 1.
4. **Decision (DDR draft)** — Context · Decision · Consequences · Rejected alternatives, written so
   the lead can record it with `/flow:record-ddr` as-is.
5. **Contract** — the concrete interface: types, message tables, file formats / JSON Schema, route
   shapes, verbs, invariants, budgets. Precise enough to write a test against.
6. **Evidence** — what the prototype measured or proved (commands, numbers, outputs). Prototype
   code stays in the spike worktree unless it is a reusable tool with its own test.
7. **Tests that will prove it** — red-first: what fails today and passes once built.
8. **Feeds** — the plan tasks / work packages that build on it, and what they must not do.
9. **Open questions** — only what the Gate 0 register, CONTRACT.md and the canvases leave silent,
   each with the most conservative default the run will take if nobody answers.
