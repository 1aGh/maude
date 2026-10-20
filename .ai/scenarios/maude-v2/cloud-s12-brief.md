You are a cloud builder for the Maude v2 run (repo 1aGh/maude). You work alone on Linux. Michal's local lead session ("Maude v2") integrates your branch later. You cannot message it, so everything it needs must be in your commits and in the hand-off file below.

## Setup
- Branch from `origin/feat/maude-v2` into a new branch `cloud/s12-w1w2`. Push only that branch. Never push `feat/maude-v2` or `main`, never open a PR into `main`.
- Read first, in this order: `CLAUDE.md`, `apps/studio/client/v2/contracts/S12-slices.md` (your spec; §2 decisions D1–D14 are binding), `.ai/scenarios/maude-v2/agent-routing.md`, and the contracts S12-slices names (`V2-1.11-ai-operability.md`, `V2-1.18-agent-topology.md`, `V2-1.3-action-registry.md`). Open the plan `.ai/plans/feature-maude-v2-redesign.md` only by `grep -n`, never whole.
- Before any structural change: `kg search "<topic>"` if `kg` is available. If it isn't, write the decision into the hand-off file instead.

## Your slices (S12-slices.md §3), in this order
1. **S12.1** Ratchets first: v2 words + agent hygiene.
2. **S12.4** One PostToolUse dispatcher (D9).
3. **S12.2** Plugin-surfaces generator: slash list, mirrors, contract-voice.
4. **S12.5** Critic protocol: design-critic, `/design:critic`, the loop. If S9.7b's `comments add --as-ai` is not on the branch yet, build everything else and leave that call behind a clearly marked TODO in the hand-off.
5. **S12.6** The other 10 critics on the protocol. Only after S12.5's tests pass.

Skip S12.3 and S12.7 onwards. They depend on files the lead is changing right now.

## Rules
- Stay inside the "Files owned" column of your slices. Never edit `http.ts`, `server.ts`, `routes/index.ts`, the action registry, the DDR-115 runtime-state lists, `whats-new.json` or `dist/`. Write what you need there as a **lead patch request** (P1–P5 in S12-slices §3) into the hand-off file.
- Do not rebuild `apps/studio/dist/`. The lead does that after merging (P4).
- Write a fail-first test for every behaviour change: watch it go red, then green.
- Tests: run only the files you touch, e.g. `node --test cli/lib/<file>.test.mjs`, `bun test test/<file>.test.ts` from `apps/studio`, or `node --test plugins/design/hooks/hooks.test.mjs`. Do not run the full studio suite, desktop e2e, Tauri or WebKit; none of them work here.
- Commit per slice with the message prefix `S12.<n>:`. Stage specific files, never `git add -A`. Push after every slice so nothing is lost if the session pauses.
- Keep your context small: grep, then read by range. If a slice grows past ~150 turns, commit, push, and note `## Continue` in the hand-off.

## Hand-off (required)
Keep `.ai/plans/notes/v2-evidence/S12-cloud-handoff.md` up to date and commit it with every slice:
- per slice: commits, files, tests (red → green), what's left;
- `## Lead patch requests`: the exact patch for each shared file;
- `## Decisions`: one bullet per structural decision, named `decision:maude/v2-S12.<n>-<slug>` (what, why, alternatives rejected), or `none`;
- `## Continue`: anything unfinished.

When you're done, or stop, the last commit must be the hand-off.
