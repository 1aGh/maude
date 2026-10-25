# T0b — baseline usage and cost (2026-10-25)

## Census, last 30 days (`~/.claude/projects`, 347 transcripts; no Codex sessions on this machine)

| Typed `/flow:<cmd>` | n | | Skill-tool loads `flow:<skill>` | n |
| --- | --- | --- | --- | --- |
| done | 24 | | debate-protocol | 21 |
| execute | 20 | | done | 9 |
| plan | 12 | | plan | 9 |
| bug-rca | 7 | | validate | 5 |
| bug-fix | 6 | | release | 5 |
| release | 5 | | setup-prd | 3 |
| quick | 4 | | init | 3 |
| maintain-docs | 2 | | bug-fix | 3 |
| validate | 1 | | agent-browser | 2 |
| everything else | 0 | | bug-rca, record-ddr, kgai-backend, execute, agent-device | 1 each |

Every command the plan retires or merges has 0–2 direct uses in 30 days. `quick` (4) and
`setup-prd` (3 skill loads) are the only merged ones with use — they keep working as `execute --quick`
and `plan --prd`, and their old names stay as stubs for one release.

## Spend of today's `/flow:execute` (18 sessions that typed it, scanned with the v2-usage method)

| Repo | Sessions | Lead peak context | Lead share of spend |
| --- | --- | --- | --- |
| maude (monorepo) | 8 | 374k – 975k | 84 – 100 % |
| AI-StudyMate (monorepo) | 3 | 625k – 854k | 70 – 100 % |
| orbit (small repo) | 7 | 245k – 515k | 91 – 100 % |

Sub-agent peaks stayed ≤ 150k (except one annotations-v2 run: 3 agents > 300k).

**Finding — the lever differs from v2.** In v2 the sub-agents were 80–91 % of spend; in ordinary flow runs
the **lead** is 84–100 %, because `/flow:execute` implements every task inline in one growing context
(peaks up to ~975k). So for P1 the saving comes from (1) execute handing each task to a fresh
`flow:worker` with a slice brief, and (2) the lead checkpoint rule — not from model routing alone.

## P1 comparison point

Per session: lead peak context and lead share. Target after P1 on a monorepo plan: lead peak under
~300k and most read+write in workers at the same pass rate; small repo: total read+write not higher.
The real A/B is measured on the next plans run with the released P1 (`maude flow usage <sessionId>`),
recorded in `P1-ab.md` — running throwaway plans only to measure was skipped to save budget.
