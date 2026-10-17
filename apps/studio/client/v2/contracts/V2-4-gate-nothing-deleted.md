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

## Numbers (2026-10-17, feat/maude-v2 @ ac1acf9a + V2-4.gate-b, committed bundle)

| Check | Spike | After V2-4.gate-b |
| --- | --- | --- |
| entries mapped | 1379 mapped, 61 excluded, 2 open | 1401 mapped, 63 excluded, **0 open** |
| rows with a home | 94 / 144 open | 91 / 144 open (rows are filled by V2-4.5–4.10 builders, not by this task) |
| rows reachable | 38 / 144 | **50 / 144** (94 open: 91 without a home + 3 unreached) |
| kept targets reachable | 133 / 384 | **231 / 401** (170 open) |

The two `contextmenu` entries are `INFRA_IDS` (map-rules.mjs), excluded by name with the reason "infrastructure:
suppresses the browser's own context menu; not a feature". A new entry of the same shape stays open until someone
signs it. Every row that has a home is reached except three (below).

## State openers (V2-4.gate-b)

Openers and the worlds they run in are DATA in `scripts/v2-manifest/openers.mjs`; `probe-reach.mjs` only drives
them. A state is `{ config, routes, invoke, extends }`: `/_config` keys, canned server answers, answers to the
desktop's Tauri commands, and another state to build on. Stubs are the probe's own, never a real hub or cloud.

| State | What it makes appear |
| --- | --- |
| `linked-project` | Settings › Advanced › This project (sync switches, first-link rule, hand over / take back), Diagnostics › Sync |
| `linked-rich` / `-failed` | the file plane: progress, rate limit or failure line, held deletion, delivery rows, trash, assets, notices, a held AI edit |
| `cloud-in` / `cloud-signing-in` | Settings › Connections: account, sign out, cloud projects, the device-code dialog |
| `github-in`, `figma-in` | GitHub identity rows (desktop), Figma connected card |
| `git-dirty` | the repo status with files, `behind` and `unpushed` |
| WS `git-lifecycle` | Diagnostics › Server "Repo state changed — reload?" |

Other openers: `dialog-report-bug` (⌘K run → describe → preview), `dialog-figma-import(-in)`, `selection-multi`,
`preview-shape-options`, `preview-comment`, `settings-team-server`, `diag-sync-files` (clicks Prune and Resolve).
`run` steps use ⌘K to pick one action by its row testid.

**⌘K as V2-4.6 draws it.** The probe types an action's label and looks for `palette-row-action:<id>` or
`palette-row-tool:<id>` (the exact id), falling back to the row's `.st-pal-ltxt` text.

**The "?" sheet is a surface for key-only actions.** ⌘K leaves out nudge, annotation, `object.*` and `*-hold`
by design (search-model `NOT_SEARCHABLE`). Such an action is reached when its `shortcuts-row-<id>` row is on the
"?" sheet. The lead decides whether that counts (default: yes, it is where a person finds the key).

**Tool reach.** The registry keeps every `tool.*` key resolvable for every role so a denied key reaches the shell's
denial line, so its `visible` over-promises tools to viewers. `toolRoles()` derives who a tool is for from
`MODE_TOOLS` `minRole` (Hand = view, Comment = comment, the rest = edit; a Marker tip inherits its slot). A
`tool.*` action or `toolbar-slot-*` hook is required only where `PROBE_SLOT_ROLE` (owner/member = edit, hub viewer =
comment) reaches that role. Result: no tool is a gap any more; the viewers reach Hand and Comment.

**Native-only hooks.** `HOOK_SHELLS` (reach-rules.mjs) names hooks that one kind of shell draws, by what the code
gates on and what the probe saw: GitHub sign-in, the team-server dialog, Ask AI and the ACP chat are desktop only;
"Open in app" is not in the desktop shell. A match beats the v1-golden default. Reasons are in the table.

## The gap after V2-4.gate-b

**A. Owned by the builders in flight (V2-4.8a / 4.8b).** Their rows get a home and their hooks move; nothing to do
here until they land, then re-run the mapper and the probe.

**B. Rows with no home (91).** `v2.action` and `v2.testid` both empty. Owned by V2-4.5–4.10.

**C. Rows with a home that the probe does not reach (3).**
- `A-open-the-cloud-dashboard` and `A-panel-positions-left-right` need the viewers: **viewer and cloud-viewer
  have no Settings at all** (⌘, does nothing, the sheet never opens). Lead decision: viewers get Settings › General (personal view
  prefs). **Product gap for V2-4.9 (shells): not built.**
- `A-get-latest` (`diag-get-latest`) is reached in the local shells, not in the three cloud shells: a cloud
  project saves through the hub, so there is no git "behind". Needs `v2.reach: ['desktop','browser']` on the row
  (a row field the owning package sets; patch request).

**D. Kept targets not reached (170).**

| Group | Count | What it needs | Owner |
| --- | --- | --- | --- |
| ACP chat (`chat-*`, `acp-*`, `.chat-input`, `dock-ai-*`) | 43 | a connected ACP agent: a stub agent transport in the probe | later package, interim home = the chat panel |
| Canvas states (`.dc-annot-*`, `annot-*`, peers, `.dc-dragging`, snap guides, text editing, video comp, photo, brand-up, canvas-load-*) | 49 | a drawn annotation + selection, a peer, a drag, a video artboard in the fixture, an upload | next probe step (see Continue) |
| Changes panel (`git-save-all`, `git-commit-message`, `publish`, `pull`, `save-local`, `git-history-*`, `project-history-*`) | 21 | ⇧⌘G now opens Version history; **nothing opens the old Changes panel** (GitPanel). Either a product gap or a state the probe has not found | V2-4.9 to confirm |
| Dialog internals (`team-cloud-*`, `cloud-deeplink-*`, `file-deeplink-*`, `report-bug-error/-shot/-redact/-issue-link`, `source-conflict-*`, `comment-edit*`, `figma-*-error/-summary`) | ~40 | more states: a signed-in cloud inside the team dialog, a `maude://` deep link, a failing `/_api/report`, a source-conflict body, an existing comment | next probe step |
| Tool options (`toolbar-popover-*`, `toolbar-tip-*`, `tool-panel-*`) | 3 | the preview toolbar's Shape/Marker/Sticker popovers did not open from `frameClick` in the probe | next probe step |
| Actions | 3 | `app.check-updates`, `export.rerun-last`, `help.ai-readiness` have no menu row and no ⌘K row in any probe | **product gap** (registry says visible; no surface draws it) |
| Viewers | 3 | `share-cluster-faces/-status`, `share-open-app` are not drawn in the viewer shells | V2-4.9 shells |
| `cloud-owner`/`member` | 2 | `figma-connect-input/-save` hidden in a cell (local-only by design, DDR-209 D1): needs `HOOK_SHELLS` or the hook's `v2` note | decide |

## V2-4.gate-c: every open row gets its v2 home

**Numbers (2026-10-17, rebuilt client, 7 probes):**

| Check | After gate-b | After gate-c |
| --- | --- | --- |
| entries mapped | 0 open (1401) | **0 open (1422; 104 late entries)** |
| rows with a home | 91 / 144 open | **2 / 144 open** |
| rows reachable | 50 / 144 | **134 / 144** (10 open) |
| kept targets reachable | 231 / 401 | **228 / 377** (149 open; 24 targets became rows) |

A row's `v2.action` / `v2.testid` / `v2.where` names the control a person reaches TODAY; "until S<n>" in `where`
means the final home is that package. `v2.reach` is set where the rule chain gets the shells wrong: the draft
switcher and the Changes panel's save / publish / discard are desktop only (`['desktop']`); the unsaved badges,
the saved-version sha and the Share links are local (`['desktop','browser']`); the trash clear-out is not offered
to a viewer; the ACP chat is desktop only; `A-get-latest` (a cloud project saves through the hub, so nothing is
"behind") is local only.

**New hooks** (no control had one; each is in testids.json and TESTIDS.md as `new`): `canvases-count`,
`canvas-row-unsaved`, `git-compare`, `git-discard`, `export-png-resolution`, `export-pdf-quality`,
`export-pdf-marks`, `inspector-custom-css`, `inspector-html-attrs`, `inspector-grid-tracks`,
`inspector-body-layout`, `canvas-menu-item-<id>` (every row of the canvas right-click menu).

**Probe additions** (data in openers.mjs unless noted): step kinds `frameContext` (right-click in the canvas),
`dblclick`, `wait`, `unless`; states `git-dirty` (now with saved versions and a branch list), `git-on-draft`,
`trash-full`; openers for the saved-version list, the draft switcher (on the shared version and on a draft),
hidden files, the canvas menu (element, container, artboard), the Inspector (Advanced, Inspect, Layers, a grid
element, an artboard, a photo), the Export sheet per format and with no render service, and a video comp's
Timeline and clip inspector. The fixture gained a `Reel` video comp, a grid element and a content-addressed photo
on every artboard, and `Home.meta.json` (the Layers panel reads its artboard count from it).
`probe-reach.mjs --merge <evidence.json>` overlays a partial run onto an earlier run's evidence and writes the
merged reachability.json, so a few openers can be re-run without the ~45 min full pass. Three actions whose v2
home is a control in a sheet got an `ACTION_SURFACE` entry: `export.rerun-last` (Export again),
`help.ai-readiness` (its Diagnostics twin), `app.check-updates` (Settings › Update).

**Still open (10 rows):**

- Product gaps, no entry point left: `A-pull-a-local-copy` and `A-invite-by-github-username`. Their only door was
  the sidebar avatar's menu (IdentityBar `variant="rail"`), which V2-4.7a no longer draws. Smallest fix: two File
  menu rows ("Pull a local copy…", "Share on GitHub…", desktop) that fire the event IdentityBar's host listener
  already answers for `project.new`, opening its `'get'` / `'share'` views. It needs two registry actions, so it
  waits on the `humanMax` (84) decision.
- Viewers have no Settings: `A-open-the-cloud-dashboard`, `A-panel-positions-left-right` (V2-4.9).
- ACP chat (6 rows, 33 kept hooks): needs a stub agent in the probe (`/_api/acp/status` answering available, then
  the `/_ws/acp` JSON-RPC handshake: initialize, session/new with config options, a canned turn with a tool call
  and a permission request). The rows are homed; only the state is missing.

## Tests

- `scripts/test/v2-nothing-deleted-map.test.mjs` (8 tests): precedence, historical exclusion, label-file scope,
  continuation, v2-code exclusion, invalid targets, named infrastructure exclusion.
- `scripts/test/v2-nothing-deleted-reach.test.mjs` (14 tests): settings-local, registry predicate, editor-only
  homes, explicit reach / §B defaults, kept action and kept hook rules, hook matchers, evidence → doc,
  failed-step evidence, tool reach by slot minRole (3), the "?" sheet, native-only hooks.
- `scripts/test/v2-nothing-deleted-openers.test.mjs` (5 tests): a state folds into routes and `/_config`, `extends`
  overrides only what it names, every opener resolves, an unknown state or answer is a loud error.

All three files went red when the branches under test were disabled (continuation, v2-code, historical; settings-local,
editor-only, failed-step evidence).

## Open questions (default if unanswered)

1. Do kept targets count toward the gate? Default: **yes**, reported on their own line.
2. The infra `contextmenu` entry: exclude or keep open? Default: keep open, and list it.
3. Should the viewers have Settings › General? Default: the rows stay red until a product decision.
4. Is the §B default of the local shells as owner right? Default: yes, until an owner adds `v2.reach`.
5. Should the gate require state openers for the remaining state-dependent hooks, or accept "reachable after a
   documented state"? Default: add state openers (follow-up items 1–3). A hook stays red until one exists.
