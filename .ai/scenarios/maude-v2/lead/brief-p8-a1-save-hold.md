# Brief: p8-a1-save-hold (Opus, sync/undo risk class)

Michal's ruling 2026-10-29 (kg `maude/v2-michal-a1-hold-save-during-interpreter`, EXTENDS
`maude/v2-p8-a1-claims-bytes-not-time`). Read both with `kg search "a1 hold save"` before starting.

## The gap
After p8-a1-claims, every AI write that can name its bytes claims them. A Bash call that cannot claim (S7
interpreter: `python3`, `node -e`, `sed -i`, `bash -c`, a terminal-lane verb) opens a **window** over the canvases its
command names (`sync/action-stage.ts` `shellWindow` / `takesUnclaimed`, `SHELL_SETTLE_MS = 1_000`; opened from
`acp/index.ts` `shellWindow` and the design hook's `POST /_api/agent/bash/window` → `ai/write-claim.ts`
`hookClaims().window`). Inside that window, an unclaimed write to a named canvas joins the AI run — so a PERSON's
save landing in the window is attributed to the AI run. That is the residual this task closes.

## What to build: hold the save
- A person's save (any studio write path the person drives — canvas edit ops, TSX source save, board/annotation
  writes, meta/layout writes; find them all, list them in the hand-back) to a file that a currently OPEN interpreter
  window names is **not refused** and **not written yet**: it is HELD.
- The hold ends when that call's window closes **+ SHELL_SETTLE_MS** (so the AI's last bytes settle first); then the
  held save lands **as the person's write** (person actor, its own undo step, never joined to the AI run, never
  bound by `bindBashWrites`).
- **Merge:** repeated saves to the same file during a hold collapse into the last one (no input lost — the last
  state contains every edit the person made, since each save is a full state; if any path is a delta/op rather than
  a full state, compose the ops in order instead and say which).
- **Cap:** a hold lasts at most ~10 s (constant, e.g. `SAVE_HOLD_CAP_MS = 10_000`) or until the call ends, whichever
  comes first. At the cap it lands as the person's write with a **warning** (toast/line: the AI may still be changing
  this file), never discarded.
- **Close finishes the save:** closing the tab or the app during a hold lands the held save immediately (as the
  person's): server-side flush on shutdown (SIGTERM / shell close / reap — `routes/shell.ts` busy state should report
  a pending hold as busy so the close confirm/rest logic doesn't reap mid-hold), and the client's unload path.
- **Interpreter crash/kill:** a killed or crashed call must still close its window (ACP tool_call failed/cancelled,
  session end — `acp/index.ts:565` closes all; the hook path needs a PostToolUse/timeout equivalent). If no close
  ever arrives, the cap still lands the save. Prove both.
- **Notice:** while held, the person sees a short notice on that canvas: "AI is changing this file… your change
  saves when it's done". CONTRACT §3/§4 words; check `skills/contract-voice`. No new chrome — use the existing
  notice/toast surface. Clears when the save lands.
- The held save's position in sync/outbox: it enters the outbox only when it lands (never two copies). Hub-linked
  projects: same rule, the accepted-revision proposal is made at landing time.

## Fail-first tests (revert the fix, watch each go red — memory maude-verify-regression-tests-fail-first)
1. Attribution: a person save inside an open window lands as person (not AI run) after the close + settle; the AI
   run's own unclaimed write in the window still joins the run.
2. Merge: three saves during one hold → one write with the last content, one person undo step.
3. Cap: a window that never closes → the save lands at ~10 s as the person's with the warning.
4. Crash/kill: the interpreter call is cancelled/failed/killed mid-hold → the window closes and the save lands.
5. Close: shutdown during a hold → the held bytes are on disk as the person's.
6. A save to a file the call does NOT name is never held.

## Rules
- Worktree isolation (you have one). Run suites only via `scripts/v2-test-lane.sh --wait 3600 -- <cmd>`, bun paths
  prefixed `./`. `FARM_LOCAL=1` before heavy commands and before commits whose message contains "test".
- Never touch ~/.config/maude, the real keychain, Michal's apps or the :4420 server. NO_OPEN=1, MAUDE_NO_AUTOBUILD=1,
  temp MAUDE_INDEX_DIR for any boot. tsc never under a timeout.
- After client edits rebuild release-minified (`cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts
  --release`) and commit dist; run `node scripts/check-client-boots-source.mjs` after any app.jsx edit.
- Small commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Hand-back: commits, the list of person save paths and how each is held, test names, and what you could not cover.
