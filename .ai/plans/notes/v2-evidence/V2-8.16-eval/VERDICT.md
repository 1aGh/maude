# V2-8.16 eval — topology A, pass^3, final (2026-10-29, lead)

The run had 90 trials (30 tasks × 3), with 0 infra failures. The agent and judge cost ≈ $85 at list price. The full
table is in `report.txt` and `summary.md`. Trials set aside before the final rounds are in `invalid-task/` (e5/e7
prompts fixed, 0daad8f6b) and `invalid-format1/` (fixtures rebuilt at formatVersion 2).

## pass^3 (invariants and quality held on all three trials)

**22 of 30 pass:** b1 b3 b4 b5 b6 b7 · d1 d2 d3 · e1 e2 e6 e7 e8 · n2 n3 n5 · x1 x2 x3 x4 x6.

**8 do not pass:**

| task | inv | qual | cause |
| --- | --- | --- | --- |
| **e4** | 0/3 | 3/3 | **product.** See below. |
| **e5** | 0/3 | 3/3 | **product.** See below. The requested change itself was right in all three trials: one `partneri-akce` line on the IG post. |
| n4 | 0/3 | 3/3 | agent. It writes an `artboards` field into `GitPanel.meta.json`, which the gate refuses, and it changes existing artboards. |
| d4 | 2/3 | 1/3 | agent (scope; ds-review instead of apply), as classified at the regrade |
| x5 | 3/3 | 1/3 | agent (quality), as classified at the regrade |
| b2 | 3/3 | 2/3 | agent (quality, one trial) |
| e3 | 3/3 | 2/3 | agent (quality, one trial) |
| n1 | 3/3 | 2/3 | agent (quality, n1.A.1) |

## The product cause behind e4 and e5

The marketing21 fixture's `Combine-kampan.tsx` generates seven artboards with
`` DISCIPLINY.map(d => <DCArtboard id={`disc-${d.id}`} …>) ``, which is valid v1 canvas code. The post-edit gate
(`cli/lib/design-hook.mjs`, PostToolUse → `maude design check --strict --tier fast`, rule `artboard-id-expression`
in `apps/studio/check/index.ts`) fails the whole file on that pre-existing id. It restores the file and blocks the
agent's edit, however small. The agent's only way through is to unroll the map into seven literal artboards. That
touches all seven `disc-*` artboards, so the artboard-scope invariant fails. It happened in every trial of both
tasks.

The gate does not separate errors already in the file from errors the edit introduced. Any AI edit to a canvas with a
mapped artboard id is therefore refused until the AI rewrites the map.

Not fixed tonight: plan A (2026-10-29) starts no new builders, and Michal decides in the morning. The candidate fix
is to block only on errors the edit introduced (diff the findings against the pre-edit snapshot) and pass the
pre-existing ones on as `additionalContext`. A fail-first test would be a mapped-id canvas, a one-line edit, and no
block.
