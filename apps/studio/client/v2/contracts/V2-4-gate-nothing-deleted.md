# V2-4 gate: the nothing-deleted test, made runnable

**Decision.** The Phase 4 gate test has two halves. Both are now code, and both run.

1. **Mapper** (`scripts/v2-manifest/map-entries.mjs` + data in `map-rules.mjs`). It resolves every v1 manifest entry
   to ONE target. A target is a §A/§B row, a registry action (`action:<id>`), or a testids.json hook that v2
   re-emits (`testid:<hook>`). The mapper writes `map` and `excluded` into `nothing-deleted.json`.
2. **Probe** (`scripts/v2-manifest/probe-reach.mjs` + pure rules in `reach-rules.mjs`). It boots the source studio
   headlessly in 7 probes (one per shell and role) and opens 24 short, data-driven paths ("openers") in each probe.
   It records every hook on screen in the shell and in the canvas iframe, and writes `reachability.json`.

`scripts/check-v2-nothing-deleted.mjs` reads both files. It is green only when every entry is mapped, every row has a
home, and every row and kept target is reached in every probe where it must be.

## Question

From the plan's Phase 4 gate: "the frozen v1 manifest (V2-2.0c), the 124-row ledger and the G0-D rows each resolve
to a reachable v2 element (`scripts/check-v2-nothing-deleted.mjs` walking the registry + DOM in a headless boot per
shell and role) — this is the first time that test goes green."

## What exists today

- The manifest: `client/v2/v1-manifest.json`, 1326 frozen entries, written by `scan-v1.mjs`.
- The ledger: `client/v2/nothing-deleted.json`, 144 rows (124 §A + 20 §B). Before this task its `map` was empty.
- The registry: `actions/index.ts`, `ACTIONS_BY_ID`, 152 actions. Each action's `visible` field is a predicate
  (`Pred`) over shell, role and facts, evaluated by `actions/resolve.ts` `isVisible`.
- testids.json: each hook's `v2` field is `stable` (re-emit the same hook, plan rule 5), `moves` (the region is
  replaced in Phase 4), `new`, or `historical` (no live element).
- `client/v2/settings/settings-model.js` `SETTINGS_ROWS`: each settings row carries `nd` (its row id) and
  `local` (absent in a cloud tab, DDR-209 D1).
- The v1 characterization goldens `test/characterization/v1/<shell>__<state>.txt` record which hooks v1 showed in
  which shell.
- kg: `decision:maude/v2-V2-2.0c-v1-manifest`, and `maude/v2-nothing-deleted-hide-only` (principle 0: hide, never
  remove).

## Mapping method

The rules are applied in order. The first match wins.

1. **HAND**: exact entry id → target. Used only where labels are ambiguous inside one component (app.jsx's three
   "Dismiss" buttons) or a palette row belongs to a §B row (D17).
2. **Continuation.** A late entry with the same kind, file and key (or testid) as a frozen entry that is gone from
   the code inherits that entry's target. Example: `App/…` was re-keyed `ShellTree/…` by a refactor. 18 entries.
3. **Same hook.**
   - A testid entry whose hook is `stable` or `new` maps to itself, `testid:<hook>`. If a row's `v2.testid` names
     that hook, it maps to the row instead.
   - A `historical` hook is **excluded**: it has no live element in v1 either.
4. **Registry label.** Only in the menu, palette and native-menu files (`menubar.jsx`, `use-palette-and-panels.jsx`,
   `menu.rs`). The entry's label is normalised and matched against `legacy.menu`, `legacy.palette` or `label`.
   If a row's `v2.action` is that action, the target is the row. Otherwise it is `action:<id>`. 92 entries.
5. **RULES.** An ordered list matched on file, scope, key, label, testid and kind. These map a surface to its row or
   kept element: a whole panel such as Timeline, ClipInspector or DiffView goes to its §B row, and one button goes
   to its §A row. 941 entries.

Every target is validated: the row must exist, the action must be registered, and the hook must be in testids.json.
`--write` refuses to write if any target is invalid.

**Late entries that are v2 code are excluded, by path or by a named id, never by marker.** Paths:
`client/v2/`, `client/home/`, `client/panels/chat-header.jsx`, `toolbars/`. Named ids: the FormatGateBanner button
(V2-1.12) and the `use-action-keys` listener (V2-2.4). A late entry in a shared v1 file is handled differently:
`dock.jsx` PanelTabs, the `tool-palette.tsx` slots and the new SettingsPanel/IdentityBar/CloudBar hooks are mapped
like v1 entries, because each one maps cleanly. Why paths and not a marker: a marker is one more convention for
every builder to remember, and a missed marker silently turns v2 code into a v1 gap.

**Kept targets (`action:` / `testid:`): the plan wording allows them.** The gate asks that the manifest "resolve to
a reachable v2 element". It does not say "to a row". Plan rule 5 says a stable hook is re-emitted on the v2
element with the same meaning. §A only holds things that *left the default view*, so a feature that stays in view
(Undo, the zoom keys, the inspector's knobs, the canvas list) has no row and can never get one. Without kept
targets, about 600 entries could never map. **The lead decides whether kept targets count toward green.** The
audit counts them now, and reports them on their own line ("kept actions/hooks reachable"), so making them not
count is a one-line change.

## Reachability probe

**Probes** (`reach-rules.mjs` `PROBES`):

| Probe | Shell | Role |
| --- | --- | --- |
| desktop | Tauri stub | owner |
| browser | local browser | owner |
| cloud-owner | cloud | owner |
| cloud-member | cloud | member |
| cloud-viewer | cloud | viewer |
| viewer | local read-only link | viewer |
| embed | `?embed=1` | — |

Hub roles map onto registry roles: owner → owner, member → edit, viewer → comment.

**Openers** (`OPENERS`). Each is a short path from boot, written as steps (click, frameClick, key, expandMenu,
expand, palette):

- the shell alone, and a canvas open;
- the menu with every submenu and nested submenu expanded;
- Settings › General, Connections, Advanced, and Advanced on a linked project;
- Diagnostics › Server, Logs, AI, Sync, and Sync on a linked project;
- the Canvases tab with its Advanced section, the Layers tab, the Assets tab;
- the inspector after a click on an element in the canvas;
- Preview mode;
- ⌘K, typing every needed action's label;
- the "?" sheet, Export ⇧⌘E, Share, Comments, AI chat ⇧⌘A, Version history ⇧⌘G, Inspector ⇧⌘I.

A hook counts as reached when it is on screen (it has client rects) after any step of any opener in that probe.
Evidence collected before a step failed still counts.

**An action counts as reached** when its `project-menu-row-<id>` is on screen, or ⌘K lists its label, or its v2
surface is on screen. `ACTION_SURFACE` is a small table: tools → `toolbar-slot-*`, `view.layers` →
`panel-tab-layers`, `ai.chat` → `ai-chat-header`, and similar.

**Where something must be reachable: a rule, not per-row code** (`rowProbes`, `actionProbes`, `hookProbes`).
Rows are checked in this order:

1. An explicit `v2.reach: [probe ids]` on the row wins. No row has one yet. It is the escape hatch for the owning
   package.
2. §B rows default to desktop + browser as owner. `B_REACH` overrides this: D19 (native menu) is desktop only.
3. A settings row marked `local: true` in `SETTINGS_ROWS` is required only in the local shells.
4. A row that names an action follows the registry's `visible` predicate (rule 12: predicates name shells).
5. §A homes `insp lay assets ds tl ai vh exp` are editor-only, so the viewer probes are exempt.
6. Embed is never implied.

For kept targets:

- A kept action is required wherever the registry shows it.
- A kept hook is required in every shell where a v1 golden showed it. A hook that no golden showed is required in
  the local shells only.

**Output: `client/v2/reachability.json`** (`maude.reachability/1`):

- `{ taken, bundle, probes, openers }`: when the probe ran, which client bundle it served, and the status of each
  opener per probe;
- `rows` and `targets`: `true`, or a reason such as "testid X not reached in browser, cloud-owner";
- `perShell[probe].rows` and `perShell[probe].targets`: `ok: <opener>`, `missing` or `n/a`.

## How to run

```sh
node scripts/v2-manifest/map-entries.mjs [--write|--gaps]        # mapping (pure, ~3 s)
scripts/v2-test-lane.sh --wait 1800 -- node scripts/v2-manifest/probe-reach.mjs [--build] [--only browser] [--evidence /tmp/ev.json]   # ~15 min
node scripts/check-v2-nothing-deleted.mjs                         # the gate
scripts/v2-test-lane.sh -- node --test scripts/test/v2-nothing-deleted-map.test.mjs scripts/test/v2-nothing-deleted-reach.test.mjs
```

The probe serves the committed `dist/client.bundle.js` by default. `--build` rebuilds the client release-minified,
and dist/ is restored afterwards. It never touches this repo's `.design`: it uses a throwaway fixture and a
throwaway HOME, with `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`.

## Numbers (2026-10-17, feat/maude-v2 @ dc603470 + this task, committed bundle)

| Check | Before | After |
| --- | --- | --- |
| entries mapped | 0 / 1442 | 1379 mapped, 61 excluded, **2 open** |
| rows with a home | 94 / 144 open | 94 / 144 open (unchanged: owned by V2-4.5–4.10) |
| rows reachable | probe not built | **38 / 144** |
| kept targets reachable | — | **133 / 384** |

The 61 excluded entries are 6 historical hooks and 55 late v2-code entries. Of the 1379 mapped entries, 781 go to a
row, 241 to an action and 357 to a hook.

## The gap

**A. Entries that fit nothing (2).** Both are `contextmenu …app.jsx#App/div` and its `ShellTree` continuation. They
suppress the browser's own menu over the chrome, which is infrastructure, not a feature. Recommendation: an
`excluded: "infra"` reason that the lead signs, or let it stay as the only known open entry.

**B. Rows with no home (94).** `v2.action` and `v2.testid` are both empty. These belong to V2-4.5–4.10. The probe
already reaches the right element for 19 of them (see Patch requests).

**C. Rows with a home that the probe does not reach (12).** They split into four groups:

- **Settings in the viewer shells.** viewer and cloud-viewer have no Settings at all (the ⌘, opener fails). This
  affects `A-light-dark-toggle`, `A-open-the-cloud-dashboard` and `A-panel-positions-left-right`.
  Recommendation: either the viewer gets Settings › General, or those rows get `v2.reach` without the viewers.
  This is a product decision.
- **Linked-project settings.** `sync-setting-*` and `sync-ownership-adopt` do not appear in Settings › Advanced
  even with a linked `/_sync-status`. This affects 4 rows (A-sync-*, A-first-link…, A-hand-design…). Either the
  section needs `linkedHub` in `/_config` (a probe state opener), or it is a real gap in V2-4.7.
- **Signed-in cloud account.** This needs a signed-in-cloud state opener: `cloud-account`,
  `settings-hub-address`, `settings-cloud-projects` (A-cloud-account…, A-team-hub…, D11).
- **Event state.** `diag-get-latest` needs "team has new versions" and `diag-repo-changed` needs a git lifecycle
  event. Both need event-state openers.

**D. Kept targets not reached (251).** Most are state-dependent. Grouped by producer:

| Producer | Count | State it needs |
| --- | --- | --- |
| SyncPanel | 37 | held / conflict / transfer states |
| app.jsx selectors | 20 | |
| ChatPanel | 18 | a connected ACP agent |
| GitPanel / TeamProjects / CloudBar / Elicitation / report-bug | 12–15 each | an open dialog or a flow state |
| canvas-iframe selectors | | a selection, a drag, a comment, a video comp |

A second group is real registry findings:

- `tool.*` and `view.trash` have no `minRole`, so the registry says the viewers must reach them. Neither viewer
  shell shows them.
- `ai.chat` has no `shell: ['desktop']`, but the chat header only renders in the desktop app.
- `ai.draw-mark`, `app.check-updates`, `export.rerun-last`, `share.copy-link` and `object.nudge` have neither a
  menu row nor a ⌘K hit in any probe.

## Tests

- `scripts/test/v2-nothing-deleted-map.test.mjs` (7 tests): precedence, historical exclusion, label-file scope,
  continuation, v2-code exclusion, invalid targets.
- `scripts/test/v2-nothing-deleted-reach.test.mjs` (9 tests): settings-local, registry predicate, editor-only
  homes, explicit reach / §B defaults, kept action and kept hook rules, hook matchers, evidence → doc,
  failed-step evidence.

Both files went red when the branches under test were disabled (continuation, v2-code, historical; settings-local,
editor-only, failed-step evidence).

## Open questions (default if unanswered)

1. Do kept targets count toward the gate? Default: **yes**, reported on their own line.
2. The infra `contextmenu` entry: exclude or keep open? Default: keep open, and list it.
3. Should the viewers have Settings › General? Default: the rows stay red until a product decision.
4. Is the §B default of the local shells as owner right? Default: yes, until an owner adds `v2.reach`.
5. Should the gate require state openers for the remaining state-dependent hooks, or accept "reachable after a
   documented state"? Default: add state openers (follow-up items 1–3). A hook stays red until one exists.
