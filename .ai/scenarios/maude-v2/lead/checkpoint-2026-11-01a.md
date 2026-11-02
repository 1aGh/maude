# Lead checkpoint — 2026-11-01 morning: r2 round merged, gate loop

feat = bc8cffb9e + .ai commits (pushed). Freeze worktree `.claude/worktrees/freeze` at bc8cffb9e.

## Merged since checkpoint-2026-10-31c
P1 (Image picker, TD3 defaults), P2, P3 (modes/keys/toasts/focus), P5, P6 (Inspector colour popover) + P6b (e2e,
focus fix); r2-sec-fixes (V2-8.9 delta: M1 callout opens Share Connect, C1 canvas-triggered notices, C2 location
markers + runGit fsmonitor/ceiling, L1, F4, F5, upload pin — closure 0 blockers, 6 lows in pr-followups); docs (15
stale lines); r2-e2e-fix (git-user single answer, size picker leaves with Edit, Pen ⌫ window capture); shell-panels
spec; r2-export-size-race (canvas-lib never re-fits a foreign world — real export bug); lease-home after close;
r2-first-canvas-inspector (restore yields to a pick < 500 ms); r2-first-canvas-home-intent (Rust: navigate wait bound
to tab instance). All decisions in kg.

## Gates at bc8cffb9e
- 8.1 PASS, 8.2 PASS, 8.3 PASS (3×, chain4 05:20–06:55, 0 locked, prefs untouched), 8.4 attested (18/18, 14/18
  v1fmt, mini), 8.9 + 8.15 attested, full studio suite on mini 21465/0 at 2f6f40d74 (only Rust since).
- 8.5 browser e2e on mini 14/14 at bc8cffb9e (attest after the final freeze; note cites 8.3).
- **8.18 FAIL 15/16**: `desktop.selfhost-entry` uses the old brief hooks ("New brief board name"); P2 renamed them
  but not the 3 multiplayer specs. Builder `r2-mp-brief-hooks` (Opus) fixing selfhost-entry, cloud-entry, surface.
- Any non-.ai change after the freeze stales every gate (v2-done.sh diff check): after that merge → refreeze →
  pre.sh (gated) → re-attest 8.9/8.15 → chain4 again → 8.4/8.5 on the mini → attest.

## Still to do
- 8.8 WebKit: the Mac mini screen is locked (Michal asleep; keeper told him). Keeper: run WebKit here after 8.3 if
  this screen is unlocked, else leave it last for the morning. Chromium 8.8 + 8.14 index bench here (Alligators
  clone `$S/allig/a`, strip `_state`), after chain4, machine idle.
- 8.7: a11y matrix in one pass on the final head — `.ai/plans/notes/v2-evidence/V2-8.7-a11y-final-matrix/`
  (build.sh / up.sh / final.sh; worktree `.claude/worktrees/a11y-run` at cbd0fd69d → move to the final head).
- 8.10 .app + bundle-completeness --smoke + client-boots + opening card; 8.16 re-attest (pre-check coverage).
- PR.md + PR body (draft #160), READY TO TRY (11), report to keeper.

## Lessons this round (memories written)
- no local test-lane run while chain4 records (dist revert mid-build);
- a builder must not symlink the shared src-tauri target (stale build-script paths) — `cargo clean -p maude-desktop
  -p tauri-plugin-wdio-webdriver` if it happens;
- pre.sh output must be gated (a 2-s 8.1 FAIL was my own biome format slip);
- site docs/test-count changes re-date site/lib/stats.json → commit gen:stats before the freeze.
