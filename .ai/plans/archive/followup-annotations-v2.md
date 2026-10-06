# Follow-up: annotations v2 — what the v1.5.0 close left open

Successor to [`archive/feature-annotations-v2-element-model.md`](feature-annotations-v2-element-model.md). The v2 element model shipped in v1.5.0 (`731c64ca` #138, `2dd5fd83` #139, fix `87dac924`), and DDR-242 is recorded. This file carries the residue that plan's acceptance criteria left unchecked. Archived 2026-10-02 after a git-history audit.

## Tasks

- [x] **F1 — decide the adapter.** It survives as the editing view instead of being removed (Task 26 deviation, see the parent's Execution Log). Either record a DDR that it is the intended end state, or remove it along with the dead v1 paths.
- [x] **F2 — finish Tasks 23/24.** Both are partial; the parent's Execution Log says what is missing.
- [x] **F3 — AI-read perf gate.** Measured 2.86× against the ≥ 3× target (Task 30). Close the gap or re-baseline the target with a reason.
- [x] **F4 — surface rig, remaining matrix.** Run it in accepted-revision mode and on the cloud backend; only legacy save mode on a local hub was run (L09/L10, `L09.v2.*` 28/28).
- [x] **F5 — full `/flow:validate`.** Static, tests (studio alone + sync lane + hub + harness + CLI), build, `scenario-runner`, `design-system-guard`, `a11y-auditor` — never run as one pass for v2.
- [x] **F6 — DDR amendments.** DDR-100 §3 and the DDR-054 table still describe the v1 model; amend them to point at DDR-242, then `maude kg import`.

## Acceptance Criteria

- [x] F1–F6 done, or each explicitly rejected with a recorded reason.

## Closed 2026-10-05

Every item decided by the owner; full reasoning in [DDR-244](../../archive/decisions/DDR-244-annotations-v2-stroke-view-is-the-editing-end-state.md).

- **F1** — kept. The Stroke view is the editing end state, not an adapter (DDR-244 §1).
- **F2** — rejected. Palette/router/cursors list tools, not element types; the capability-driven toolbar waits for a type that needs it (DDR-244 §2).
- **F3** — re-baselined to ≥ 2.8×; arrow endpoints stay in the AI contract (DDR-244 §3, `notes/annotations-v2/perf.md`).
- **F4, F5** — not pursued, not moved to a backlog (DDR-244 §4).
- **F6** — DDR-100 §3 and the DDR-054 table carry amendment notes pointing at DDR-242; re-ingested with `maude kg import`.
