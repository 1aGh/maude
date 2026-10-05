# DDR-244 — Annotations v2: the Stroke view is the editing end state

- **Status:** Accepted
- **Date:** 2026-10-05
- **Scope:** `repo:maude`, `dept:dev`
- **Extends:** [DDR-242](./DDR-242-annotations-v2-element-model.md)
- **Closes:** `followup-annotations-v2.md` F1, F2, F3 (and records F4/F5 as not pursued)

## Context

DDR-242 shipped in v1.5.0. Its plan's Task 26 said to delete the `Stroke` union, `strokesToSvg` and the v1 adapter. The
execution kept them instead: the editing tools (select, snap, marquee, handles, eraser, connectors, context toolbar —
about 10k lines) work on a world-space `Stroke` VIEW projected per element and cached by record identity
(`ui/world.ts` → `elementStrokes`); a commit diffs the view back into element ops. Tasks 23/24 were partial and the
Task 30 AI-read gate missed (2.86× vs ≥ 3×). The follow-up plan asked the owner to decide each.

## Decision

1. **The Stroke view stays — it is the intended end state, not a temporary adapter.** Persistence, sync and undo are
   element-native: minimal op batches, peer-safe inverse-batch undo, per-node re-render (Task 30: one node per drag
   tick, 174–176 B per edit at 200–5000 elements). The view is only an editing projection. Rewriting 10k lines of
   tool code onto element ops buys nothing measurable and risks the behaviour both suites guard. `strokesToSvg` /
   `svgToStrokes` stay in `annotations-model.ts` for migration, legacy fixtures and pre-v2 paste. The
   `// v2-adapter: removed in Task 26` markers are stale and should not be read as a pending removal.
2. **The rest of Tasks 23/24 is rejected.** The palette, input router, tool mode and cursors list *tools*, a palette
   concept, not element types — driving them from the element registry conflates the two. A capability-driven context
   toolbar is deferred until a registered type without a stroke form needs toolbar controls; until then it switches
   on the stroke kind. New types already work end to end through `ElementStroke` (Task 25 conformance + `stamp`).
3. **The AI-read gate is re-baselined from ≥ 3× to ≥ 2.8×.** The remaining bytes are the computed endpoints of bound
   arrows. Dropping them would clear 3× but force agents to resolve geometry themselves, which changes the AI contract
   for a token saving that doesn't matter. Measured 2.85–2.87× across 200/1000/5000.
4. **F4 (surface rig in accepted-revision mode and on the cloud backend) and F5 (one full `/flow:validate` pass for
   v2) are not pursued and not carried to a backlog.** Owner decision, 2026-10-05. v2 has been in production since
   v1.5.0 through eight releases; the L09/L10 rig showed 0 regressions vs the v1 baseline in legacy mode, and each
   gate already ran individually.

## Consequences

- No further work is owed on the annotations v2 plan; the follow-up is archived.
- A future change that does want to remove the view needs its own plan and DDR superseding §1.
