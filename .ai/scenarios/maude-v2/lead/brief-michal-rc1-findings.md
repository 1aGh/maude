# Brief — Michal's findings on the 2.0.0-rc.1 .app (2026-10-31, freeze 20b4215eb)

Michal tried the packaged `.app` 2.0.0-rc.1 and sent 20 findings. His standing rule (kg
`maude/v2-michal-before-merge-everything-works`): **every button must do something, nothing may fail — all of this is
before the merge.**

Screenshots, local files (open them with Read):
`/private/tmp/claude-501/-Users-iagh-git-personal-maude/76c768b0-3621-4292-9775-893e7a3cb749/images/`

| image | shows |
| --- | --- |
| `6.png` | new project |
| `7.png` | Home menu |
| `8.png` | Home pill |
| `9.png` | chat Advanced |
| `10.png`, `12.png` | Inspector Fill dropdown |
| `11.png` | chat collapse vs Inspect icon |
| `13.png` | maude DS canvas + View only banner |
| `14.png` | path |
| `15.png` | Assets |
| `16.png` | object off the artboard |
| `17.png` | image dropped in Edit |
| `18.webp` | whole window scrolled up; Layers shows "Lane/Card" labels; a duplicate "maude" tab without a close button |

Michal's words (Czech, verbatim) are in the package each builder gets; the numbers are the keeper's.

## Rules for every builder (binding)

**Branch and context**
- Cut from feat/maude-v2 at the current tip. First run `git log --oneline -1`. If HEAD is a `main` commit (`d3a5029b0`), run `git checkout -b <your-branch> origin/feat/maude-v2`.
- Symlink missing `node_modules` from `/Users/iagh/git/personal/maude` (root, `apps/studio`, `apps/hub`, `apps/desktop`, `apps/desktop/e2e`).
- Read the repo `CLAUDE.md` sections for the areas you touch. Words, voice and the menu tree are in `apps/studio/client/v2/contracts` (CONTRACT.md). UI actions and shortcuts are action-registry entries (`apps/studio/actions/`), never ad-hoc key handlers. Testids are an API: update `apps/studio/client/TESTIDS.md` + `testids.json` with any change. Use design tokens, never hard-coded colours.
- Query kg before re-deciding anything: `kg search "<topic>"`. Several of these behaviours were deliberate decisions. If a finding contradicts a recorded decision, do not silently flip it. Say so in the hand-back with the decision id, and propose the change.

**Tests**
- **Fail-first for every fix.** Revert it and watch the test go red. Say so in the hand-back.
- Every fixed item also gets a regression guard that would catch it coming back:
  - a desktop e2e step (`apps/desktop/e2e/scenarios/`, DOM-driven via `data-testid`, never computer-use), and/or
  - a browser e2e (`apps/studio/test/e2e/*.e2e.mjs`), and/or
  - a dead-control crawler rule.
  Use a unit/happy-dom test where e2e can't reach.
- New desktop specs must be run once alone after writing (memory: specs written, not run, were broken). That needs a debug build (`pnpm test:e2e:desktop:build`, ~15 GB), an unlocked visible screen and `MAUDE_E2E_KEEP_FRONT=1`. Desktop e2e runs share this Mac's one screen, so coordinate: run your desktop e2e only after your unit/browser work is done, and keep the run short (your lane only). If another builder's e2e is running (`pgrep -f wdio`), wait.
- Test suites only through `scripts/v2-test-lane.sh -- <cmd>`; `apps/studio` uses `bun test --isolate`.

**Before hand-back**
- `bunx biome format` + `bunx biome lint` on touched files.
- `bunx tsc --noEmit` in `apps/studio`. Check the exit code; never pipe it through `timeout … | grep`.
- After any `app.jsx`/client shell edit: `node scripts/check-client-boots-source.mjs` and `node apps/studio/test/e2e/opening-card-clears.mjs`. Both need a release build of dist: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`. Revert `dist/` afterwards and never commit it.
- `git status apps/studio/dist/` is clean.

**Safety**
- Throwaway HOME/XDG and a temp `MAUDE_INDEX_DIR`.
- A stub `claude` on PATH. Never the real keychain, and never trigger system dialogs.
- `NO_OPEN=1`, `MAUDE_NO_AUTOBUILD=1`, `FARM_LOCAL=1`.
- Never touch `~/.config/maude`. Check that the mtime of `~/.config/maude/prefs.json` is unchanged before and after any desktop e2e.
- Never touch `~/Maude/*` or Michal's projects. Make APFS clones (`cp -c -R`) and unlink them: strip `linkedHub`, `_sync.json`, `_state`.
- No real hub, cells, Stripe or Cloudflare.
- Never kill processes you didn't start. Port :4420 is Michal's.

**Shared files**
- Other builders touch `apps/studio/canvas-lib.tsx`, `apps/studio/input-router.tsx`, `client/app.jsx` and `actions/` in parallel. Keep diffs there minimal and local, and say loudly in the hand-back if you touch `canvas-lib.tsx` or `input-router.tsx`, because that forces a WebKit re-measure.

**Commits and budget**
- Stage specific files only. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push or merge.
- Remove your `target/` when you're done if it is over 5 GB.
- Budget ≤150 turns. Use `sed -n` ranges, no whole-file reads of `http.ts`/`app.jsx`.

## Hand-back

For each item:
- product bug, or expected behaviour plus the kg decision;
- the cause;
- the fix and its commit;
- the red→green evidence;
- the guard you added.

Also hand back:
- what you could not fix, and why;
- copy or taste decisions for Michal, as 2–3 options;
- one-line kg proposals for structural decisions.
