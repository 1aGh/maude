# 2.1.1 UX builders: shared brief

Read this, then `.ai/scenarios/issues-burndown/builder-preamble.md` (safety rules), then the plan `.ai/plans/archive/feature-accounts-and-connections-2.1.1.md`.

## The spec

- **Approved design (Michal, 2026-11-09):** `.design/ui/v2/17 Accounts and Connections.tsx` (+ `.css`). It is the spec: copy, structure, states.
- **Screenshots of every artboard**, read with the Read tool from the MAIN checkout: `/Users/iagh/git/personal/maude/.ai/scenarios/accounts-2.1.1/design/NN-*.png`:
  - 01 model
  - 02 states
  - 03 toast
  - 04 menu broken
  - 05 menus
  - 06 switch
  - 07 sync
  - 08 general
  - 09 general states
  - 10 connections
  - 11 advanced
  - 12–13 link dialog
  - 14 home
- **Copy decisions:**
  - Use "Maude Cloud" as the name; show the address only on account rows.
  - Offline: "Offline — changes wait on this Mac". Update the CONTRACT §6 wording if you own that string.
  - Toast button: "Sign in" when the sign-in is missing, "Sign in again" when it stopped working.
  - Load the skill `design:contract-voice` before writing UI copy.
- **Today's code map** (scout, 2026-11-09):
  - Avatar: `client/v2/shell/project-account-card.jsx` and `project-account-model.js`. "Sign in as another account" lives in `app.jsx` ~1821 → `github.js:51` → Rust `profiles.rs:609-637`. `bind_profile` in `app_state.rs:911` has no release caller.
  - Sync: `v2/diagnostics/diagnostics-sheet.jsx:375` (testid `diag-sync-solo`).
  - Settings: `v2/settings/{settings-sheet,general-section,connections-section,advanced-section,project-sync-settings}.jsx`, `use-connections.js` and `connections-model.js`.
  - Team-server dialogs: `panels/TeamProjects.jsx` (`serverOnly`) and `v2/onboarding/HubSheet.jsx` (Home, `/_home/hub/*`).
  - Broken-link signal: `/_api/cloud/status` `linkedHub.credentialed`.
  - Home: `client/home/HomeAccounts.jsx`, `home-model.js`, `Shelves.jsx`.

## Rules

- Work only in your worktree. When it starts, check that `git log --oneline -1` is at or after `c56d83352`. If it isn't, `git merge --ff-only main`.
- Stay inside your file set. If you must touch another builder's file, keep the change minimal and say so in the hand-back.
  - Shared hot spots: `app.jsx`, the action registry `apps/studio/actions/defs/*.ts`, and the generated outputs (`node scripts/gen-actions.mjs`, `node scripts/gen-plugin-surfaces.mjs`).
  - Run the generators and commit their output. The lead regenerates after merging.
- **Do NOT commit `apps/studio/dist/*`.** The lead rebuilds the release bundle once after all merges. To check your own UI, build into dist, look, then `git checkout -- apps/studio/dist`.
- A UI action or shortcut is a registry entry (`apps/studio/actions/`), never a new key handler.
- Testids are an API: add them to `apps/studio/client/TESTIDS.md` and `testids.json` in the same commit. Use the design's names where sensible.
- A removed UI hook must be mapped. The nothing-deleted gate is `scripts/check-v2-nothing-deleted*`. Map removals or renames in `scripts/v2-manifest/map-rules.mjs` and `nothing-deleted.json`, and say what moved where.
- Fail-first tests for every behaviour change (client model unit tests + server/Rust where touched). Show red by reverting, then green.
- **Gates on touched files:**
  - `npx biome check <files>`.
  - `cd apps/studio && bunx tsc --noEmit`, with an explicit exit-code check. A killed tsc prints nothing.
  - Rust if touched: `cd apps/desktop/src-tauri && cargo test <module>` plus `cargo clippy` on your crate. The shared target is big; check `df -h` first.
  - `node scripts/gen-actions.mjs --check` and `node scripts/gen-plugin-surfaces.mjs --check`.
  - The nothing-deleted check.
  - `node scripts/check-client-boots-source.mjs` (throwaway HOME, stub claude) after any `app.jsx` edit.
- Suites only through `FARM_LOCAL=1 scripts/v2-test-lane.sh -- <cmd>`. For studio use `bun test --isolate ./test/<file>`.
- Boot a server only with all of: `NO_OPEN=1`, `MAUDE_NO_AUTOBUILD=1`, a throwaway HOME and XDG dirs, and a stub `claude` on PATH. Kill only your own PIDs, by number.
- **Never touch:**
  - real hubs or *.cloud.maude.sh;
  - `~/.config/maude`;
  - the keychain;
  - `~/Library/Application Support/com.maude.app`;
  - `/Applications/Maude.app`;
  - Michal's projects.
  No system dialogs.
- Public repo: keep security detail generic.
- Small commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Hand-back

- Branch + SHAs.
- What you built, per artboard.
- Red→green evidence and gate results.
- Testids added or removed, and nothing-deleted mappings.
- Anything you could not wire because no backend exists. Name it; do not invent a backend silently.
- `## Decisions`, one line each.
