# Phase 8 test round — close the 84 unreachable artboards with real tests (lead brief, 2026-10-28)

Michal (via the keeper, 2026-10-28): "pojďme to dotáhnout všechno teď, ať to máme pokryté testy a zároveň důkladně
otestované … chci mít production-ready appku." Goal: production-ready, not minimal. Every artboard below ends either
**driven by a test that asserts what the board draws** or, when that truly cannot be done locally, with a one-line
reason it goes to the rc soak.

## Inputs

- `.ai/plans/notes/v2-evidence/V2-8.5-unreachable-84.md`: the 84 rows, grouped by how they are covered today.
- The board: `.design/ui/v2/<NN> …/*.tsx`. Find the `<DCArtboard id="<id>"` block. Read it as SOURCE TEXT ONLY and
  never boot a server on this repo's `.design/`. Its labels, words, states and layout are the spec.
- Why it is not verified: `.ai/plans/notes/v2-evidence/phase8-fidelity/<NN>-*/critic-bar5.md` (or bar4 / bar4b /
  final), the last critic that judged the row.
- `apps/studio/client/v2/contracts/CONTRACT.md` wins over a board where they disagree (decision
  `maude/v2-8.5-contract-over-board`).

## What to build, per row in your group

1. Drive the exact state the artboard draws. Where it exists, use the harness the repo already has:
   - desktop e2e: `apps/desktop/e2e/` (WebdriverIO + vendored tauri webdriver; `helpers/`, lanes in
     `apps/desktop/e2e/package.json` and `wdio.*.conf.ts`).
   - browser e2e: `apps/studio/test/e2e/*.e2e.mjs`; multi-peer desktop specs live in `apps/desktop/e2e/multiplayer/`.
   - local cell: `scripts/dev/local-cell.mjs`; hub in workspace mode plus a studio child, a second person through a
     minted session or a second profile/sidecar. The team-project and share-roles lanes show how.
   - fake AI: the scripted fake ACP agent that runs the design plugin's real hook (decision
     `maude/v2-8.5-g2-fake-acp-hook-agent`; see `apps/desktop/e2e` acp-fake and the fidelity `_c10-ai-harness`).
   - stub generation and Figma providers, and the import-figma / generate-takes fixtures.
2. Assert what the board shows: the words (exact strings from CONTRACT / the board), which controls are present or
   absent, the state word, and the order. Use testids (`apps/studio/client/TESTIDS.md` + `testids.json`). A new hook
   means a new testid registered in BOTH files in the same commit.
3. Take a screenshot per state through `helpers/evidence.ts` `capture()` (desktop) or the browser lane's shot helper.
   The lead re-checks rows from those shots.
4. If a test finds a **product bug**, fix it in the same branch with a fail-first test: revert the fix, watch the
   test go red, restore it. Say so in the hand-back. A client change means
   `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`, then commit `dist/client.bundle.js` +
   `dist/styles.css` and run `node scripts/check-client-boots-source.mjs` (memory: app.jsx edits need
   the boot check).
5. A row that truly cannot be driven locally (an OS banner from a real notification centre, an e-mail from a real
   provider, a second physical display, a page served only by cloud.maude.sh) gets one line in your hand-back:
   `<row> — soak: <why>`. Drive every part of it that CAN be driven (the in-app half of a notification, the invite
   page the local cell serves) and say which part is left.

## Running

- Every suite or e2e goes through `scripts/v2-test-lane.sh --wait 3600 -- <cmd>`. That is one machine-wide lock shared
  with the other builders; never run a suite outside it.
- A desktop lane needs the debug test build of YOUR worktree, also under the lock:
  `scripts/v2-test-lane.sh --wait 3600 -- bash -c 'cd apps/desktop && MAUDE_SKIP_RUNTIME_BUILD=1 npx --no-install tauri build --debug --config src-tauri/tauri.e2e.conf.json'`.
  Each new spec must be green **twice in a row, run alone**, on this Mac's screen. The MacBook is free for the whole
  round and Michal will not touch it.
- Env for every spawn: `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, a throwaway HOME/XDG, and a stub `claude` first on PATH
  (`printf '#!/bin/sh\necho {"loggedIn":false}\n'`). Confirm `~/.config/maude/prefs.json` mtime is unchanged before
  and after a desktop run.
- Never: the real keychain, a system dialog, a real or production hub/cell/render/Stripe/Cloudflare, `git push`,
  `~/.config/maude`, this repo's own `.design/` as a served project, killing processes you did not start.

## Hand-back

Small commits on your branch, ending with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. The final message
is a table: row · test (file + `it` title) · asserts (what) · green ×2 (yes/no) · shot path. Then the soak lines, any
bugs fixed (fail-first proof), and any decision you had to make as a proposal (`decision: maude/<slug> — <one line>`).
The lead records decisions and merges. Budget: ≤150 turns, keep context lean, never read `http.ts` or the plan whole
(grep and range-read).
