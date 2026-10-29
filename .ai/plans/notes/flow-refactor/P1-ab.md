# P1 A/B — small repo (2026-10-25, Claude Code 2.1.307, Sonnet lead in both arms)

Same scratch repo (Node, 3-task plan: slugify / truncate / wordCount + node:test), same prompt
`/flow:execute .ai/plans/feature-text-utils.md`, run in parallel with `--plugin-dir`:
A = flow from `origin/main` (v1.9.1), B = this branch.

| Arm | Turns | Lead peak | Read+write | Cost | Tests |
| --- | --- | --- | --- | --- | --- |
| A (old) | 10 | 66k | 0.6M | $0.28 | 8 pass |
| B (new) | 8 | 61k | 0.5M | $0.22 | 7 pass |

B did the three tasks inline — the new "Do it yourself when the task is a few lines" rule — so no
worker was spawned. **Small repo: not worse (−20 % cost, same pass).** Both arms also fixed the plan's
broken `node --test test/` command (Node 24 wants a glob).

Monorepo arm not run: a real monorepo plan costs several % of the week. The baseline it compares
against is in `T0b-baseline.md` (lead 84–100 % of spend, peaks up to ~975k); measure the first real
monorepo `/flow:execute` after release with `maude flow usage <sessionId>` and append the row here.
