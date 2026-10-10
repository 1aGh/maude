# Maude v2 run — agent routing and context budget

Added 2026-10-10 (Michal: "a compromise between high output quality and cost"). Applies to the lead of the `/goal` run and to every sub-agent / teammate it spawns. Plan: `.ai/plans/feature-maude-v2-redesign.md` § "How this plan runs".

## Why

Measured on the run's first 40 hours (`node scripts/v2-hooks/v2-usage.mjs`): every agent ran on Opus 5.5; sub-agents were ~80 % of spend; the six biggest (V2-2.4, V2-1.18, V2-2.14+2.16, V2-2.8, L1, V2-0.1) were over half of it. The driver was **context size, not model**: those agents reached 600–830k tokens of context over 280–370 turns, and every turn re-reads the whole context. Recurrent bloat: the full plan (~145 kB) read 23×, `http.ts` (~330 kB) read 39×, whole-file `sed`/`cat`.

## Who runs what

| Work | Agent type | Model · effort | Notes |
| --- | --- | --- | --- |
| Lead / integrator | the `/goal` session | Opus 5.5 · **xhigh** | orchestrates, reviews diffs, integrates shared files; does not do bulk mechanical work itself. Effort is cheap here (lead thinking/output was ~7 % of the lead's spend at xhigh); its context size is not — see rule 4 |
| Open question, Phase 1-style spike, cross-lane contract | `v2-spike` | Opus · high | output is a decision others build on |
| Implement a task against a merged contract | `v2-builder` | **Sonnet · high** | default for lane work |
| Same, but a **risk class** (below) | `v2-builder` + `model: "opus"` | Opus · high | |
| Inventory, leak matrix, "where is X", CI mining, checking a hand-back's claims | `v2-scout` | Sonnet · medium | read-only; replaces Explore / general-purpose for v2 sweeps |
| Verifier: screenshots, fidelity evidence vs artboards, e2e, test lane | `v2-builder` (brief: "verifier — reports only, no product code") | Sonnet · high | |
| Design critics (`design:*-critic`), `flow:a11y-auditor`, `flow:scenario-runner` | as is, spawned with `model: "sonnet"` | Sonnet | rubric judgement |
| Security pair (`flow:security-auditor` + `flow:ethical-hacker`) | as is | Opus (inherits) | cheap in absolute terms; misses are expensive |
| Bulk mechanical writes (kg backfill from a list, ledger `set` sweeps, renames across files) | `v2-builder` | Sonnet · high | keep it out of the lead's context |

**Risk classes → builder on Opus:** auth / roles / ACL / invites (S9, standing rule 12) · sync planes, versioned-file formats, the migrator and outbox (standing rule 15, V2-2.14/2.16) · security fixes · native Rust / Tauri (L4, Phase 3) · hub + cloud (additive, v1-compatible) · undo / kernel / run-registry concurrency (S2/S5) · anything touching the lead-owned shared files' *semantics* (registry, dgn bridge, route tables).

**Escalate a Sonnet task to Opus** when (a) its first hand-back fails review or tests on a non-trivial point, or (b) it hands back a "contract is silent" question twice. Re-spawn on Opus with the review notes; do not let Sonnet loop.

## Context budget (rules the briefs and the SubagentStart hook enforce)

1. **Brief carries the slice.** The lead pastes the task's plan row(s), the contract path(s), the owned files and a kg digest into the brief. Sub-agents never Read the whole plan or `ledger.json`.
2. **Large files by range only:** `http.ts`, `server.ts`, `app.jsx`, plan, ledger — `grep -n`, then Read with `offset`/`limit`.
3. **One task ≈ one fresh context.** Size tasks so a builder finishes in roughly ≤ 150 turns / ≤ 300k context. A package bigger than that is split by the lead (or by the spike that designed it) into sequential builder runs; a builder that finishes a coherent sub-step with much left commits and hands back with `## Continue`. `v2-usage.mjs` flags any agent with peak > 300k — treat a flag as a sizing miss to fix in the next brief.
4. **Lead context.** Background agents return conclusions only (hand-backs ≤ ~60 lines). At every phase boundary — and whenever the lead passes ~600k — the lead checkpoints (Progress log + ledger + task-list snapshot committed) and continues in a fresh session via `/flow:pause` → `/flow:resume`, rewriting the marker's `sessionId`.

## Rollout (staged, so a regression shows up on one task, not a phase)

| Step | What | Done when |
| --- | --- | --- |
| R0 | Agent files `.claude/agents/v2-{builder,spike,scout}.md`, this note, `v2-usage.mjs`, context rules in the SubagentStart hook | committed by the lead with the next checkpoint; `node --test scripts/v2-hooks/v2-hook.test.mjs` green |
| R1 | Lead context reset: finish (or hand to a `v2-builder`) the in-flight kg backfill, checkpoint, pause → resume in a fresh session (new agent types load only at session start) | new session owns the marker; `TaskList` rebuilt from the ledger |
| R2 | **Pilot:** the next two non-risk builder tasks on `v2-builder` (Sonnet); the next research sweep on `v2-scout`. The lead reviews each diff as usual and records in the Progress log: review findings, red→green evidence, turns/peak from `v2-usage.mjs` | both pilots pass review without an Opus re-run, or the escalation rule fired and is noted |
| R3 | Default: route by the table above for the rest of the run; re-check `v2-usage.mjs` at each phase gate (any peak > 300k → split rule missed; any Sonnet task escalated twice in one package → move that package to Opus) | phase-gate note lists spend split + escalations |

If R2 shows Sonnet builders missing things Opus would have caught (review defects, red e2e after integration), stop R3 and keep builders on Opus — the context-budget rules alone carry most of the saving.
