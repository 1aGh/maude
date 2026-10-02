# Follow-up: annotations v2 — what the v1.5.0 close left open

Successor to [`archive/feature-annotations-v2-element-model.md`](archive/feature-annotations-v2-element-model.md). The v2 element model shipped in v1.5.0 (`731c64ca` #138, `2dd5fd83` #139, fix `87dac924`), and DDR-242 is recorded. This file carries the residue that plan's acceptance criteria left unchecked. Archived 2026-10-02 after a git-history audit.

## Tasks

- [ ] **F1 — decide the adapter.** It survives as the editing view instead of being removed (Task 26 deviation, see the parent's Execution Log). Either record a DDR that it is the intended end state, or remove it along with the dead v1 paths.
- [ ] **F2 — finish Tasks 23/24.** Both are partial; the parent's Execution Log says what is missing.
- [ ] **F3 — AI-read perf gate.** Measured 2.86× against the ≥ 3× target (Task 30). Close the gap or re-baseline the target with a reason.
- [ ] **F4 — surface rig, remaining matrix.** Run it in accepted-revision mode and on the cloud backend; only legacy save mode on a local hub was run (L09/L10, `L09.v2.*` 28/28).
- [ ] **F5 — full `/flow:validate`.** Static, tests (studio alone + sync lane + hub + harness + CLI), build, `scenario-runner`, `design-system-guard`, `a11y-auditor` — never run as one pass for v2.
- [ ] **F6 — DDR amendments.** DDR-100 §3 and the DDR-054 table still describe the v1 model; amend them to point at DDR-242, then `maude kg import`.

## Acceptance Criteria

- [ ] F1–F6 done, or each explicitly rejected with a recorded reason.
