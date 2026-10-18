# S10 — Design system canvas: slice plan

Package **S10** (plan § Phase 6 row S10, § Reuse row S10). Lane **L2**, last (S1 → S11 → S8 → **S10**).
Topic canvas `13 Design System` (30 artboards). Canvas `14 Editing` is S2's (26 rows, all `package: "S2"`); S10
touches it only through the entry contract in §2.2. Contracts built on: `V2-1.6-ds-storage.md` (storage,
revisions, pins, reviews, routes, verbs) and `V2-1.13-ds-schema.md` (schema, `ds-check`, `ds-upgrade`, S-rules).
Written on `spike-S10` from `feat/maude-v2` @ `16d88cb4`.

## 1. Scope recap

S10 makes each design system one real canvas, `<ds.path>/design-system.tsx`, with seven section artboards
(Brand · Colour · Type · Space & shape · Motion · Components · Patterns) and Light | Dark per token. Once a system
is **converted** (`revisions/head.json` exists), the canvas is the source and the CSS is generated (A15 phase β).
Edits wait as `dsPending` and publish through one "Update N canvases" review with ticks; a canvas left out keeps
`dsRev`. Outside file edits arrive as a review (Keep / Undo), and a clash is a pick. AI makes a system (three
inputs → three directions → pick / mix → sections fill in). Several systems per project (A12): pinned group,
default for new canvases, switch with a Scope, preview in another system, drafts, folder migration. "Bring it up
to the schema" completes V2-2.15's `ds-upgrade` (prove / apply / codemods). Plus team libraries over the hub, the
contrast fix, token to the trash, the off-system colour question, and Advanced with Check the system.

**Already shipped (do not redo):**

- **V2-2.15:** registry `schema/ds-schema-v1.json` + fallbacks; `ds-check` (levels, S-rules, `--emit`, `--fix`,
  `--hook`, `--cheatsheet`); `ds-upgrade --analyse/--plan-mechanical/--validate/--stage/--apply` (system files
  only, `ds/upgrade.ts`); `@maude/ds` + `<DSRoot>` (`ds/default-components.tsx`, `ds/ds-resolver.ts`). Both
  in-repo systems are at schema level 0.
- **V2-2.14 / V2-2.18:** C1 Plane-B classifier entries (`tokens.json`, `components.json`, `revisions/head.json`,
  `revisions/<64hex>.json`) in both `file-membership` copies; `dsRev` / `dsPending` / `dsPinned` / `dsPairing`
  reserved (`migrate/steps.ts`, `schema/canvas-meta.v2.schema.json`); `check/meta.ts` refuses a hand edit of
  `dsRev`.
- **V2-2.17:** the index service (`index/service.ts`). V2-1.17 says it hosts `ds-usage`, which is not built.
- **Phase 4:** a one-line pinned DS row (`left-panel/canvases-pinned.jsx` `DsPinnedRows`, testid
  `canvases-ds-row`) that opens today's v1 design-system view; `view.design-system` (⌘K); and the
  Canvases › Advanced files group (`canvases-advanced.jsx`).
- **S2:** token chips (`inspector/token-chip.jsx` over v1 `inspector/ds-tokens.js`); `GET /_api/ds/components`
  (S2.16, in `routes/edit.ts`); append-only `registerKind` in `inspector/kinds/index.js`.

## 2. Open questions resolved

### 2.1 Decisions (one line each)

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| Q1 | How does publish (Plane A metas + Plane B files) become one ⌘Z? V2-1.5 Q6 left this to S10 | **One kernel action for the Plane-A effects** (`dsRev`, `dsPending`, `data-ds-rev` strips). The `head.json` log entry records that `actionId`. A registered **post-undo / post-redo hook** in `routes/project-undo.ts` moves `head`/`base` back to the entry's `parent`. It re-materialises the working files from that immutable revision, then logs `restore`. No new kernel effect kind; DS files stay on Plane B | Revisions are content-addressed, so the undo needs ids, not blobs. Moving DS files onto kernel lanes would reopen V2-1.6 §5.15 and the hub kernel (shared, one builder at a time). |
| Q2 | Do `ui/v2/*` canvases get the maude-v2 codemod (V2-2.15 "16 canvases")? | **No, not during the run.** The codemod is proven on `maude`'s 37 canvases plus fixtures. The `ui/v2` codemod is a post-Phase-8 item | Measured: all 16 maude-v2 canvases are the `ui/v2` spec canvases. `scripts/v2-ledger.mjs` marks every verified row "evidence is stale — canvas changed since" when a canvas's sha256 moves. The inverted aliases already render them identically. |
| Q3 | Convert `maude` / `maude-v2` during the run? | **No** (V2-1.6 Q7 default). Conversion is verified on fixtures, and `scripts/gen-tokens.mjs` keeps reading the working CSS (phase α) | Under β the working files are still generated, so gen-tokens never needs a change. |
| Q4 | Rule for S2.2–S2.5 / S2.8 token work while phase α holds (e.g. S2.8's `--guide`) | **Edit `colors_and_type.css` → `node scripts/gen-tokens.mjs` → `maude design ds-check maude-v2 --emit` → `ds-check maude-v2` exits 0**, all in one commit. A new name must be a registry Tier-1 / Tier-2 name or `--x-*` | Otherwise `manifest-stale` (level 10) turns the `tokens` gate red. S10 adds `ds-check maude maude-v2` to that gate in S10.13. |
| Q5 | Specimen → section mapping at conversion: AI or rule? | **A deterministic prefix rule** (`ds/convert-map.ts`): `logo/iconography/textures` → Brand; `colors-*`, `selection`, `focus`, `opacity` → Colour; `type-*` → Type; `spacing/radii/borders/elevation/grid` → Space & shape; `motion` → Motion; `components-*`, `empty-state`, `skeletons` → Components; anything else → its own `ds-own-<slug>` artboard. Patterns start empty | Measured on both systems (scratch `s10/map.mjs`). maude has 39 specimens, maude-v2 has 38. Everything maps except `ui_kits-desktop-{index,showcase}`, which become own artboards (canvas 29: "showcases stay as their own artboards"). |
| Q6 | What does the pinned row open for an **unconverted** system? | **Today's v1 design-system view**, plus one banner: "Turn this folder into a Design system canvas" → the conversion dialog (25/29). After conversion it opens `design-system.tsx` | Nothing deleted (`A-design-system-view-s-key-picker`, `A-token-and-type-ladders-preview-galleries`); conversion needs consent (V2-1.6 §5.4). |
| Q7 | Section state while AI makes a system (16): a new meta field? | **Derived, no field.** `done` = the section's registry groups pass `ds-check` for that group; `drawing` = a run holds that `ds-<section>` artboard (V2-1.15 run objects); `waiting` = otherwise | Rule 15: no new versioned key. The run registry already carries per-artboard holds. |
| Q8 | Directions (14) | Each direction is a **draft revision** (`head.json` `drafts[]`) drawn as a `ds-dir-<x>` artboard. Use A = materialise draft A into the working files; Mix = deterministic merge by registry group (`type`, `colour`, `radius`, …) from the named drafts | V2-1.6 §5.2. The engine stays deterministic; AI only writes drafts through verbs. |
| Q9 | "Check the system" (30) = critic panel headless? | **Deterministic first:** `maude design ds check-system <ds> --json` = `ds-check` + a contrast matrix (both themes) + completeness (7 sections, both modes, reduced motion), written to `_state/ds-check/<ds>.json`. "Ask AI to review" starts an AI run with `/design:critic --system-only` (the keeper and completeness-critic as S12 reshapes them) | The drawn card is all measurable. Agents are optional depth and never block the card. |
| Q10 | Contrast pairs: a new registry field? | **No. A rule in `ds/contrast.ts`** over registry groups: `--fg-0..2` on `--bg-0..4` (4.5:1); `--fg-3` on `--bg-*` (3:1); `--accent-fg` on `--accent`; `--accent-on-soft` on `--accent-soft`; `--accent-text` on `--bg-0/1`; `--status-X-fg` on `--status-X`; `--status-X-text` on `--status-X-soft` and `--bg-0`. Value resolution goes through a var / `color-mix` / `oklch` resolver; maths from `draw/palette.ts` `contrastRatio` | Adding to the registry would bump a versioned schema. The rule sits next to the code that reads it. |
| Q11 | Reach view rings (7): where do element positions come from? | The `ds-usage` cache records **element ids** (`data-cd-id`, V2-1.4) per place. The reach view asks each preview frame for those ids' rects (`__maudeCanvasRects`), rendered with `?dsPreview=<ds>@pending` | The cache is derived and per Mac, so the extra field is free (not versioned). Rects come only from live renders. |
| Q12 | Off-system colour (28): AI or rule? | **Rule:** an S1 literal finding on the changed lines (`ds-check --changed`) → nearest system colour by OKLab ΔE → one quiet question. "Add to the system" writes a `dsPending` `add` entry | V2-1.13 §5.9 says `ds-edge-suggest` is S1 at edit time. "AI spots" is voice only. |
| Q13 | S10 ↔ S12 (plugin) split | **Accepted as plan-s12 proposed:** S10 owns what the DS flow *produces*: `plugins/design/commands/setup-ds.md`, `plugins/design/skills/design-system/**`, `--upgrade-schema`, and the `maude design ds …` verbs + skill sections (rule 14, inside S10 slices). S12 owns the agents (`design-system-keeper`, `design-system-completeness-critic`, `brand-critic` → `maude.agent-handoff/1`; the new `ds-migrator`), the thin `/design:system` command, and a final words pass on `setup-ds.md` | One owner per file. The interface is the verbs' `--json` shapes (§2.4). |
| Q14 | `GET /_api/ds/components` (S2.16) vs S10's `routes/ds.ts` | **S2 keeps it in `routes/edit.ts`.** S10 never declares it (`checkRouteTable` fails on a duplicate). Every other `/_api/ds/*` lives in `routes/ds.ts` | No cross-package moves mid-run. |
| Q15 | Permissions | Read routes: any member who can open the project (Can view). `pending`: Can edit on the DS canvas. publish / keep / undo / pick / convert / switch / make / upgrade / library: **Can edit on the whole project**. Clearing a token tombstone: owner. Enforced in `routes/ds.ts` via `apps/studio/access` (rule 12) | V2-1.6 §5.12. |

### 2.2 Contract S10 → S2 / S8 / S1 / S5 / S6: entries into the DS review (write first: S10.0 → `S10-ds-review-entry.md`)

S10.0 freezes this section verbatim as `apps/studio/client/v2/contracts/S10-ds-review-entry.md` and registers the
ids below as **pending** (so S2.12 / S2.17 can render their rows hidden and pin them with a test, per S2 Q13).

| Entry | Registry id / route | Params | Effect | Caller |
| --- | --- | --- | --- | --- |
| Push an override into the system | `ds.review-update` | `{ canvas, elementId, target: { kind: 'typeRole', role } \| { kind: 'component', name, variant? } }` | Turns the element's overrides into `dsPending` entries (`tokens` for a type role, `components[name][selector][prop]` for a master), then opens "Update N canvases" with the change listed. Pending until S10.8 lands: the row is hidden | S2.12 "Update <Heading> for every canvas…", S2.17 |
| Go to the master / token | `ds.go-to` | `{ ds?, section?: 'brand'\|'colour'\|'type'\|'space'\|'motion'\|'components'\|'patterns', token?: '--name', component?: 'Button' }` | Opens `<ds.path>/design-system.tsx` (or the v1 view if unconverted), focuses artboard `ds-<section>`, and selects `[data-ds-token="--name"]` or `[data-ds-master="Button"]` | S2.17 "Go to main component", the inspector "Uses <name>" link, ⌘K token hits |
| Update-available block (10) | inspector slot `updateAvailable` (S2 instance kind renders `<DsUpdateAvailable canvas elementId/>` from `client/v2/ds/update-available.jsx`) | — | Shows "Update available" + the diff line + **Update** (`ds.instance-update`) + **Detach** (S2's `component.detach`) | S2.17 mounts, S10.8 provides |
| Propose tokens from an import | `POST /_api/ds/pending` | `{ ds, tokens: {"--name": {light, dark?, valueNames?, add?}}, components?, by: {kind:'import', name} }` | Converted system: merged into `dsPending` ("N changes waiting"). Unconverted: 409 `ds-not-converted` (S8 keeps today's `import-brand` file write) | S8 brand import |
| Instance placed on a left-out canvas | — | — | ⇧I adds `data-ds-rev="head"` when `meta.dsRev` is set (V2-1.6 §5.8). S10 exports `dsRevForPlacement(meta)` from `client/v2/ds/pins.js` | S2.16 |
| Token tombstones in Trash | `GET /_api/ds/state` → `trashed[]` `{kind:'token', system, css, label, replacement, at, by}` | — | S1's Trash index lists them; **Restore** = `ds.restore-token` | S1 (Trash) |
| Version history labels | `head.json` `log[].summary` + `actionId` | — | S1 shows `summary` for DS actions | S1 |
| AI runs | `askAI(text, { send: true, origin })`, `origin` += `'ds-make' \| 'ds-upgrade' \| 'ds-restyle' \| 'ds-review'` | — | The run is the person's gesture; it goes through every composer gate | S5 (composer) |
| Home starter / empty row door | `ds.make` | `{ project? }` | Opens the three-input sheet (13) | S6 Home starters, S10.13 empty row |

### 2.3 Cross-lane patch requests (all through the lead)

| To | Patch | Needed by |
| --- | --- | --- |
| lead: registry `actions/defs/ds.ts` (new area) | ids per slice §3. Every one has `minRole` and `agent` (`cli` → `maude design ds <sub>`; `human` only for `ds.show-reach`, `ds.preview` and `ds.set-theme-preview`) | most slices |
| lead: `routes/index.ts` `allSpecs` | += `dsRoutes` (`routes/ds.ts`), main origin, privileged, **never** `origin: 'canvas'` | S10.3 |
| lead: `cli/commands/design.mjs` + `plugin-cli-reachability` + ACP tier table (P-10) + `actions.manifest.json` regen | verb `ds` (subs §2.4); tiers: `status`, `usage`, `revisions list`, `check-system`, `--dry-run` = auto; the rest = card | S10.3 |
| lead: `api.ts` `buildIndexData` | `canvasDsRevs` (canvas → `dsRev`), `systemHeads` (system → head), `dsConverted` (system → bool) | S10.4 |
| lead: `bridge/dgn-protocol.ts` | s2c `ds-css {tokens, components}` (follower swap); s2c `ds-pins {revs: {[id]: {tokens, components}}}`; c2s `ds-select {kind: 'token'\|'master', css?, component?, rect}`; s2c `ds-update-dots {ids}`; s2c/c2s `ds-rects {ids}` ↔ `{rects}` | S10.4, S10.7, S10.8, S10.9 |
| L1: `plugins/design/templates/_shell.html` + `canvas-shell.tsx` | handle `ds-css` (swap `#canvas-tokens` / `#canvas-components` hrefs); load `ds-pins` siblings and rewrite them through the CSSOM with `ds/pin-scope.ts` (S10 owns the pure function); draw the update dot on `ds-update-dots` ids; emit `ds-select` when the selection carries `data-ds-token` / `data-ds-master` | S10.4, S10.7, S10.8 |
| S5 owner: `routes/project-undo.ts` | `registerUndoHook(kind, fn)`, called after a successful undo / redo with the action rows (Q1) | S10.2 |
| S5: `client/v2/search/search-env.js` | `askAI` `origin` += the four ds origins | S10.15b, S10.16b |
| S1: `client/v2/canvases/row-slots.js` | `Source` += `'ds'`; S10 publishes `meta {word: 'update', tone: 'quiet', title: 'Update available'}` for left-out canvases | S10.8 |
| S1: search providers | DS hits by `tokens.json` `label` / `valueNames` and component labels (Czech too) → `ds.go-to` | S10.13 |
| S8: Handoff sheet | target `tokens` ("Hand off tokens", 30) = `tokens.json` + `colors_and_type.css` | S10.19 |
| S11: Tauri reveal command | reuse `project_reveal_path` for "Reveal in Finder" | S10.19 |
| L4 hub (S10.18a owns the files; lead reviews) | `apps/hub` `ds-library` capability + routes + scoped read grant | S10.18a |
| runtime-state lists (DDR-115) | **none**. New paths sit under the existing `_state/` (`ds-outside/`, `ds-upgrade/`, `ds-check/`), `_cache/index/ds-usage.json` and `_trash/ds-revisions/` (V2-1.6 §5.17) | — |
| V2-1.12 format rules | `head.json` `log[].actionId` (additive, R1); no new meta keys (Q7) | S10.2 |

### 2.4 Verb `--json` shapes (the S10 ↔ S12 interface; keeper, completeness-critic and `/design:system` read these)

`maude design ds <sub>`. The verb calls the live studio's loopback route when `_server.json` names one, and
otherwise runs `ds/engine.ts` in-process. Every `--json` output carries `format` + `v` and is frozen by a golden
in `test/ds-verb-json.test.ts`.

| Sub | `--json` format | Body |
| --- | --- | --- |
| `status [<ds>]` | `maude.ds-state/1` | `{systems: [{name, path, label, converted, head, base, drafts[], level, reasons[], waiting[], outside: {files[], changes[], otherChanges[]}\|null, conflicts[], leftOut: {count, canvases[]}, library\|null, trashed[]}]}` (V2-1.6 §5.10) |
| `publish <ds> [--leave-out <canvas>…] [--dry-run]` (alias `update`) | `maude.ds-review/1` | the V2-1.6 §5.11 c body + `{result: {rev, updated, leftOut, actionId}\|null}` |
| `keep <ds>` · `undo <ds>` · `pick <ds> <css> --use canvas\|file` | `maude.ds-result/1` | `{action, rev\|null, actionId}` |
| `pending <ds> --set <file.json>` | `maude.ds-result/1` | the merge result; refusals as `{code}` |
| `canvas update\|leave <canvas>` | `maude.ds-result/1` | — |
| `convert <ds>… [--dry-run]` (alias `migrate`) | `maude.ds-convert/1` | `{systems: [{name, path, canvases, to: 'design-system'\|'draft', sections: {brand: [...specimens]…}, own: [...] }]}` |
| `switch <canvas\|folder\|--all> --to <ds> [--dry-run]` | `maude.ds-switch-review/1` | `{to, scope, canvases: [{path, from, state, ticked, reason?, pins}], pairing, refused: {code: 'ds-level-11'}\|null}` |
| `make <ds> --label <l>` · `draft <ds> --direction <x> --tokens <file>` · `use <ds> <x>` · `mix <ds> <x> --take <group>=<y>…` | `maude.ds-result/1` | — |
| `usage <ds> [--css <name>] [--component <name>]` | `maude.ds-usage/1` | V2-1.6 §5.13, + `elements[]` per place (Q11) |
| `check-system <ds>` | `maude.ds-system-check/1` | `{ranAt, level, reasons[], contrast: {pairs, pass, fails: [{fg, bg, theme, ratio, need}]}, complete: {sections: {...}, themes, reducedMotion}, schema: {follows: bool}}` |
| `revisions list <ds>` · `revisions --prune [--dry-run]` | `maude.ds-revisions/1` | `[{id, at, by, summary, referencedBy}]` |
| `trash <ds> <css> --replacement <css>` · `restore <ds> <css>` | `maude.ds-result/1` | — |
| `library link <url>` · `update [--dry-run]` · `unlink` | `maude.ds-library/1` | `{library, changes[]}` |
| (existing) `ds-check --json` · `ds-upgrade --json` | `maude.ds-check-report/1` · `maude.ds-upgrade-plan/1` + `review.json` | V2-1.13 §5.6 / §5.10 |

## 3. Slices

Model key: **S** = sonnet, **O** = opus (reason). `∥` = no S10 dependency; can start in parallel now.
Registry ids are lead patch requests (§2.3). "Evidence" = the ledger rows the slice makes verifiable.

| id | title | evidence (ledger rows) | files owned | lead patch requests | model | deps | done-when (observable) | red-first tests | e2e / scenario | turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **S10.0** ∥ | Entry contract + pending ids | — | `contracts/S10-ds-review-entry.md` (§2.2 verbatim) | `PENDING_MENU_IDS` += `ds.review-update`, `ds.go-to`, `ds.instance-update` (→ S10.8 / S10.6) | S | — | The note is merged. S2's hidden rows are pinned by the pending-ids test | `project-menu-model` pending pin | — | 20 |
| **S10.1** ∥ | Revisions + generator | — | new `ds/revision.ts` (canonical JSON, sha256 id, verify, siblings, 2 MiB cap), `ds/generate.ts` (`generateTokensCss` patching per DDR-172 D7, `generateComponentsCss`, `emitTokensJson`, `parseSystem` over `css-scan.ts` + `emit.ts`), `schema/ds-revision-v1.schema.json`, `schema/ds-head-v1.schema.json` | none | **O** (versioned formats) | — | G1 and G2 hold on maude, maude-v2 and fixtures. An empty publish writes 0 bytes. The same input gives the same id twice | `ds-revision-hash.test.ts`, `ds-generator-roundtrip.test.ts` (single theme, `@media` duplicates, `}` in comments, grouped preludes, a missing block → `ds-generate-block`) | — | 140 |
| **S10.2** | Engine flows + `head.json` + one ⌘Z | — (substrate for 6–12, 27) | new `ds/engine.ts` (publish c, keep/undo a, pick b, canvas update/leave d, trash/restore e, pending merge), `ds/head.ts` (sole `head.json` writer, `expectHead`, "published in two places"), `ds/undo-hook.ts` (Q1) | `registerUndoHook` in `project-undo.ts`; registry `ds.publish`, `ds.cancel-pending`, `ds.keep-outside`, `ds.undo-outside`, `ds.pick`, `ds.canvas-update`, `ds.canvas-leave`, `ds.trash-token`, `ds.restore-token`, `ds.clear-token` (owner) | **O** (undo/kernel concurrency, versioned file writer) | S10.1, S5.1b local kernel | An unticked canvas gets `dsRev` = old head. ⌘Z after Update restores files, metas, pending and `head.json`; redo re-applies. The three 409 preconditions hold. Two Macs publishing from one head end in a pick, with nothing lost | `ds-publish.test.ts`, `ds-conflict-pick.test.ts`, `ds-undo-hook.test.ts` (undo across Plane A + B, redo, a foreign action refused), `ds-trash-token.test.ts` | — | 150 |
| **S10.3** | Routes, `maude design ds`, outside watcher | — (substrate) | new `routes/ds.ts` (§5.12 routes + `pending`, `usage`, `check-system`; role gates Q15), `ds/outside.ts` (W = 5 s quiet window, attribution to `_state/ds-outside/<ds>.json`), `ds/ds-verb.ts`, `bin/ds.sh` + `bin/_ds.mjs`, `test/ds-verb-json.test.ts` goldens (§2.4) | `allSpecs` += `dsRoutes`; verb `ds` + tiers; hook (V2-1.18) refuses hand edits of `head.json` / `revisions/*` (check dispatcher entry) | **O** (sync planes, route semantics, roles) | S10.2 | A Claude Code edit to the CSS shows as a review, attributed "Claude Code", after ≤ 5.3 s. With Plane B reordered both ways the receiving peer shows no review. Can view gets 403 on every write. UI and verb give the same result | `ds-outside-review.test.ts`, `ds-no-spurious-review.test.ts` (two peers, both orders), `ds-routes-roles.test.ts`, `ds-verb-json.test.ts`, the parity contract test (route ≡ verb) | — | 140 |
| **S10.4** | Render the right revision: `dsRev`, follower swap, element pins | — (substrate for 8, 10) | `client/canvas-url.js` (§5.8 matrix + `?dsPreview=`), new `ds/pin-scope.ts` (pure CSSOM rewrite), `client/v2/ds/pins.js` (`dsRevForPlacement`), `client/v2/ds/follower-swap.js` (defer to the next look; Present defers) | `buildIndexData` fields; dgn `ds-css`, `ds-pins`; L1 `_shell.html` swap + pin loader | S | S10.2 | An unconverted system's URLs are byte-identical to today. A left-out canvas renders its revision. A `data-ds-rev` subtree keeps the old corners while its sibling renders head. Specificity beats `.btn.btn--primary:hover`. A missing revision falls back to head with "Waiting for <peer>'s Mac" | `canvas-url-ds-rev.test.ts`, `ds-element-pin.test.ts` (headless lane), `ds-follower-defer.test.ts` | — | 120 |
| **S10.5** ∥ | Usage index `ds-usage` | — (substrate for 7, 8, 21, 23, 27) | new `index/ds-usage.ts` (extractor hosted by `index/service.ts`; `places` = direct + via components; artboard attribution by `DCArtboard` line ranges; element ids, Q11; incremental) | none (`_cache` is already classified) | S | — (reads `ds-check` canvas mode) | `usage <ds> --css --accent` matches a hand count on fixtures. One canvas save re-scans only that canvas in ≤ 50 ms. A canvas-scoped checkout never counts canvases it doesn't hold | `ds-usage-index.test.ts` (direct + via components, attribution, incremental, ACL subset) | — | 110 |
| **S10.6** | The Design system canvas: `@maude/ds/board`, sections, DsBar | 13/ds-board-studio, 13/ds-board-dark, 13/ds-board-gator, 00/rule/the-design-system-lives-on-a-board | new `ds/board/{index.tsx,section-*.tsx,specimen.tsx,ds-bar.tsx,board.css}` (DSSection kinds from 13's `SECS`; swatches Light \| Dark with words + "used in"; `locked` shows the lock; the system's own Dark as a section class, never the app theme); `ds/ds-resolver.ts` += `@maude/ds/board`; DS canvas source template `ds/design-system.tsx.tpl` | registry `ds.open`, `ds.set-theme-preview` | S | S10.1, S10.5 | A fixture "Studio site" and an "Alligators"-like system (locked brand colours, condensed type) render 3/4/5 at 100 %. Light · Dark switches every section and never the app chrome. `dsPending` values show "as edited" through the board-scoped `<style>` | `ds-board-render.test.tsx` (sections from model, pending overlay, lock flag, dark class), `ds-check` canvas mode clean on the template | ledger evidence 3/4/5 | 150 |
| **S10.7** | Edit tokens in place | 13/ds-edit-colour | new `client/v2/ds/kinds/token.jsx` (`registerKind('ds-token')`: Light/Dark values, picker, "Dark follows" + the override, value names, live contrast both modes, "Used in N canvases · Show"), `client/v2/ds/use-ds-model.js`, `client/v2/ds/contrast.js` + `ds/contrast.ts` (Q10) | dgn `ds-select`; L1 emits it; registry `ds.set-token`, `ds.set-dark-follows` | S | S10.3, S10.6 | Dragging the picker updates contrast live and writes no dialog. "1 change waiting" appears in the DsBar. Two Macs on different tokens merge; the same token → the later one re-reads. Locked tokens refuse | `ds-pending-merge.test.ts`, `ds-contrast.test.ts` (pairs rule, var / `color-mix` resolution, both themes), `v2-ds-token-kind.test.tsx` | — | 140 |
| **S10.8** | "Update N canvases" review + update-available | 13/ds-edit-review, 13/ds-edit-instance | new `client/v2/ds/review-sheet.jsx` (ticks, By folder, Before/After, "Fine in Light and Dark", Cancel puts the swatch back), `client/v2/ds/update-available.jsx` (the S2 slot), `client/v2/ds/row-dots.js` (S1 row slot `ds`) | dgn `ds-update-dots`; L1 draws the dot; S1 `Source` += `ds`; registry `ds.instance-update`, `ds.review-update` (pending → live) | S | S10.2, S10.4, S10.5, S2.17 (slot) | Untick Landing page → it keeps Azure with a dot. ⌘Z after Update takes all four back. Selecting a left-out instance shows the diff line, Update / Detach. A new ⇧I instance arrives current. Words per CONTRACT §3 ("Update 4 canvases") | `v2-ds-review-sheet.test.tsx` (defaults: followers ticked, left-out unticked, pinned/blocked with reason), copy goldens from 13 | `apps/desktop/e2e/scenarios/ds-review.e2e.ts` part 1 (edit → review → untick → Update → dot → ⌘Z) | 140 |
| **S10.9** | Reach view "Show" | 13/ds-edit-reach | new `client/v2/ds/reach-view.jsx` (preview frames with `?dsPreview=<ds>@pending`, ringed places, lines from the swatch, "N patterns · M places") | dgn `ds-rects`; registry `ds.show-reach` (human) | S | S10.5, S10.7, S10.8 | "Used in 5 canvases · Show" draws every place ringed, then opens the same review list | `ds-reach-model.test.ts` (places → rings per artboard, cap 500) | — | 110 |
| **S10.10** | Component masters | 13/ds-edit-master | `ds/board/section-components.tsx` (variants × states × sizes from `components.json` + `_components.css`), new `client/v2/ds/kinds/master.jsx` (`registerKind('ds-master')`; edits = `dsPending.components` declaration patches) | registry `ds.set-master` | S | S10.6, S10.8 | Corners 2 → 6 on Tlačítko. The review groups by folder; unticking 2026/combine leaves its 6 canvases at 2 px with dots | `ds-component-patch.test.ts` (patch in the matching top-level rule, append, missing rule appended at the end) | `ds-review.e2e.ts` part 2 (folder untick) | 120 |
| **S10.11** | Outside change + conflict pick UI | 13/ds-truth-outside, 13/ds-truth-conflict | new `client/v2/ds/outside-banner.jsx` (marked values, Keep / Undo, attribution words), `client/v2/ds/conflict-pick.jsx` (side by side; also "Published in two places") | none | S | S10.3, S10.6 | 11 and 12 match. Undo writes the old bytes back. Picking "file" keeps the file and drops the pending entry. Canvases render head throughout | `v2-ds-truth.test.tsx` (attribution words: agent / git / peer / unknown) | `ds-review.e2e.ts` part 3 (agent edit → Keep) | 110 |
| **S10.12** | Convert `system/<ds>/` folders | 13/ds-multi-migrate, 13/ds-edge-migrate | new `ds/convert.ts` + `ds/convert-map.ts` (Q5), `client/v2/ds/convert-dialog.jsx` (one question: default + drafts; "Nothing is thrown away") | registry `ds.convert`; banner on the v1 view (Q6) | **O** (writes versioned files in bulk, one action) | S10.2, S10.6 | On fixtures (3 folders: 87 canvases / 6 / 0) conversion writes design-system.tsx ×2 + one draft, with R0 siblings byte-equal to the working CSS. Every canvas renders pixel-identically. Version-history Restore returns to α (revisions stay unreferenced) | `ds-convert.test.ts` (mapping golden on maude + maude-v2 specimens, refusal outside canvas groups, R0 byte-equality, restore), the nothing-deleted test | — | 130 |
| **S10.13** | Pinned rows, several systems, default, ⌘K, "Uses …" | 11/pn-ds (reassigned by S1 Q11), 13/ds-where-studio, 13/ds-where-gator, 13/ds-multi-panel, 13/ds-multi-menu | `left-panel/canvases-pinned.jsx` (two lines: name + "N canvases · default"; grouped when > 1 in use; amber dot for 11 and for 10 with reasons other than `missing-functional`; empty row "Make a design system"; testid `canvases-ds-row` kept + `canvases-ds-row-sub`), new `client/v2/ds/system-menu.jsx` (Default for new canvases, Switch canvases…, Preview in…, Check the system, Advanced), `client/v2/ds/uses-link.jsx`, `client/v2/ds/new-canvas-default.js` (24's folder rule) | registry `ds.set-default`, `ds.go-to` (pending → live), `ds.make` (door); S1 search provider; `tokens` gate += `ds-check maude maude-v2` (Q4) | S | S10.5, S10.6 | 1, 2, 21, 24 match. ⌘K "design system" opens it. Token hits by Czech label → `ds.go-to`. ⌘N inside 2026/combine uses Combine 2026. A mixed folder falls back to the default | `v2-left-panel-model.test.ts` (extended: two-line rows, group, amber dot rule, empty row), `ds-default-rule.test.ts`, nothing-deleted rows `A-design-system-view-s-key-picker` flip | — | 130 |
| **S10.14** | Switch canvases + preview another system | 13/ds-multi-switch, 13/ds-many-switch | new `ds/switch.ts` (V2-1.13 §5.7: rewrite `meta.designSystem`, drop `dsRev` + attrs, write `dsPairing`; refuse an 11 → offer Bring-up), `client/v2/ds/switch-sheet.jsx` (Scope: This canvas · Folder · Whole project; primary "Switch N canvases"; "AI restyles … own tokens" toggle → `askAI` origin `ds-restyle`), `client/v2/ds/preview-mode.js` (↑↓ in the row menu, ↵ → review, esc) | registry `ds.switch`, `ds.preview` (human) | S | S10.13, S10.4 | 23: one review, nothing to map; with AI off, the own tokens keep their look marked off-system. 18: ↑↓ re-renders every open canvas through `?dsPreview` and stores nothing | `ds-switch.test.ts` (pairing by kind counts, blocked / pinned unticked, 11 refused), `ds-preview-session-only.test.ts` | — | 130 |
| **S10.15a** | Bring-up engine: prove / discard / apply + codemods | — (substrate for 22) | `ds/upgrade.ts` + `ds/upgrade-cli.ts` (`--prove`: two headless studios `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1` on staged `before/` / `after/`, ΔE gate in the page; `--discard`; `--apply` as one action through S10.2's hook; canvas-codemod items; **V4** `newHue` check), new `test/ds-fallbacks-no-shadow.test.ts` | registry `ds.upgrade`; route `POST /_api/ds/upgrade {ds, step}` (P-8, in `routes/ds.ts`) | **O** (multi-process headless proof, one-action apply over many files) | S10.2, S10.3 | `maude`'s 37 canvases codemodded on a staged copy prove 0 failing artboards and apply as one ⌘Z. A planted literal new hue without `newHue` + a pick is refused (V4). A system-file pixel change refuses the whole apply. `ui/v2/**` is untouched (Q2) | `ds-upgrade-prove.test.ts` (fixture: one passing, one failing codemod), `ds-upgrade-invariants.test.ts` += V4, `ds-fallbacks-no-shadow.test.ts` (headless lane) | — | 150 |
| **S10.15b** | "Bring it up to the schema" UI + `--upgrade-schema` skill | 13/ds-multi-schema | new `client/v2/ds/upgrade-sheet.jsx` (amber dot / switch entry; "✦ Bring it up" → `askAI` origin `ds-upgrade`; the review = the four SCHEMA_FIX lines; "N canvases can't be updated yet"); `plugins/design/skills/design-system/SKILL.md` § upgrade-schema + `commands/setup-ds.md` `--upgrade-schema` wired to the verbs (Q13) | S5 `askAI` origins | S | S10.15a | A fixture pre-schema system opens 22. A scripted fixture agent (the verbs only) produces a proven stage; the primary button applies it as one undo step | `v2-ds-upgrade-sheet.test.tsx`; skill section lint (verbs named exist: `plugin-cli-reachability`) | — | 110 |
| **S10.16a** | Make engine + verbs | — (substrate for 13–17) | `ds/make.ts` (`make`: config entry + folder + DS canvas with outlines + `head.json {head: null}`; `draft` → `drafts[]`; `use`; `mix` by registry group; `done` → publish `make` + `defaultDesignSystem` + the switch review for existing canvases), section-state derivation (Q7) | registry `ds.make`, `ds.use-direction`, `ds.mix` | S | S10.2, S10.3 | A fixture agent script making three drafts, mixing B's type + C's colour and finishing yields a level-0 system and a `make` log entry | `ds-make.test.ts` (head null renders working files; mix golden; section states derived from `ds-check` groups + a run hold) | — | 120 |
| **S10.16b** | Make UI + setup-ds app mode | 13/ds-make-inputs, 13/ds-make-directions, 13/ds-make-mix, 13/ds-make-filling, 13/ds-make-done | new `client/v2/ds/make-sheet.jsx` (three inputs: sentence required; references; name), `ds/board/directions.tsx` (`ds-dir-*` DirTile artboards), `client/v2/ds/direction-bar.jsx` (Use A · Mix with…), done card; `plugins/design/commands/setup-ds.md` + `skills/design-system/{SKILL.md,_bootstrap.md}` app mode: the brief from the sheet, Stage-3 directions written with `ds draft`, the gate = the in-app pick, sections filled through the working files (Q13) | S5 `askAI` origin `ds-make`; S6 Home starter door | S | S10.16a, S10.6, S5.8 | With the scripted agent: 13 → 17 render as drawn; outlines wait; Brand and Colour are editable while Type draws; Stop keeps what landed. With the real AI: a smoke run on a scratch project produces three drafts | `v2-ds-make.test.tsx` (sentence only is enough; Stop; done words list what's missing) | `ds-review.e2e.ts` part 4 (make via the scripted agent) | 140 |
| **S10.17** | Edges: contrast fix, token to the trash, off-system colour | 13/ds-edge-contrast, 13/ds-edge-trash, 13/ds-edge-suggest | new `client/v2/ds/contrast-warning.jsx` ("Lighten to 4.5:1" = an OKLCH lightness search in `ds/contrast.ts`; Show walks the canvases), `client/v2/ds/trash-token-sheet.jsx` ("40 canvases use it", nearest replacement by OKLab ΔE), `client/v2/ds/off-system.jsx` (Q12) | registry `ds.fix-contrast`, `ds.add-colour`, `ds.use-nearest` | S | S10.7, S10.8, S10.5 | 26: the fix reaches ≥ 4.5:1 in one step and changes only L. 27: no canvas breaks; Restore puts the value back everywhere. 28: one quiet question; "Add" creates a pending `add` | `ds-contrast-fix.test.ts`, `ds-nearest.test.ts`, `ds-trash-token.test.ts` (extended: tombstone CSS `var(--replacement)`) | — | 130 |
| **S10.18a** | Hub: `ds-library` | — (substrate for 19, 20) | `apps/hub/src/ds-library.mjs` (`GET /api/projects/:id/v1/ds/:system/head` (last 20 log entries), `…/revisions/:rev`; read grant scoped to that system's `revisions/**` + `head.json`; "used by N projects" = distinct fetchers in 90 days), `/health` capability `ds-library`, hub tests | lead review of `apps/hub/src/server.mjs` route mount; V2-1.16 matrix row | **O** (hub ACL, a grant to non-members) | S9.10 (access filters) | A non-member with the grant reads head + revisions and nothing else (a probe of other paths → 404). Old cells without the capability fail closed | `apps/hub/test/ds-library-grant.test.mjs` (leak probes per V2-1.16), the capability test | — | 120 |
| **S10.18b** | Studio: link / update / unlink, view only | 13/ds-many-library, 13/ds-many-linked | `ds/library.ts` (copy by id, verify before writing, materialise, `library` record, 30-min check), `client/v2/ds/library-card.jsx` ("Team library · <hub>", "Used by 3 projects", "N changes waiting" review), view-only board state ("Linked library — view only" + "Open <home>") | registry `ds.library-link`, `ds.library-update`, `ds.library-unlink` | **O** (untrusted upstream revisions) | S10.18a, S10.2 | An invalid upstream revision is never written. A linked system refuses publish / pending / keep / pick (403 / 409). Update brings the changes, then this project's own review | `ds-library.test.ts` (hub stub), `ds-library-viewonly.test.ts` | — | 120 |
| **S10.19** | Advanced + Check the system | 13/ds-advanced, 06/ad-ds (reassigned by S11 Q1) | new `client/v2/ds/advanced.jsx` (Tokens · files CSS \| JSON read-only, Files list + Reveal in Finder, Hand off tokens ⇧⌘H, "Which way changes flow", system history from `log` + Restore…), `client/v2/ds/check-card.jsx`, `ds/check-system.ts` (Q9) | registry `ds.check`, `ds.reveal-files`, `ds.handoff-tokens`; S8 handoff target `tokens`; S11 reveal command | S | S10.3, S10.6 | 30 matches: "41 of 42 text pairs pass" style lines computed, not typed. "Check the system" writes `_state/ds-check/<ds>.json`. "Ask AI to review" starts an AI run. Mono only inside the fold | `ds-check-system.test.ts` (contrast matrix, completeness), `v2-ds-advanced.test.tsx` (nothing-deleted `A-design-system-folder-path`) | — | 120 |
| **S10.20** ∥ | Icon vocabulary gaps (V2-2.15 open item) | — | `.design/system/maude-v2/assets/icons/*` (12 missing glyphs), `.design/system/maude/assets/icons/*` (1), the `components.json` icon maps | none | S | — | `ds-check` reports maude-v2 40/40 and maude 40/40, no declared gaps. `/design:draw` verify ladder passes | `ds-check-levels` fixture: a null icon stays valid (decision `v2-2.15-icon-null-declared-gap`) | — | 80 |
| **S10.21** | ds-review e2e + agent-path parity + close-out | rule row + all §4 rows' evidence audit | `apps/desktop/e2e/scenarios/ds-review.e2e.ts` (assembles parts 1–4 on a fixture project, unlinked, `NO_OPEN=1`), `test/ds-agent-parity.test.ts` (each `ds.*` action: UI route ≡ verb ≡ file edit, rule 14), the format doc `schema/ds-formats.md` (`tokens.json`, `dsPending`, revisions, `head.json`) | `actions.parity.json` ratchet | S | all | The scenario is green 3 consecutive runs on the debug build. The parity coverage count drops (never rises). Every §4 row has evidence | — | `ds-review` (V2-8.3) | 100 |

Total ≈ 3,040 turns over 25 slices. The package is the largest in wave B (32 artboard rows plus a whole engine).

## 4. Ledger coverage check

### 4.1 Rows with `package: "S10"` (canvas 13, 30 rows) — each in exactly one slice

| Row | Slice | Row | Slice |
| --- | --- | --- | --- |
| ds-where-studio | S10.13 | ds-make-mix | S10.16b |
| ds-where-gator | S10.13 | ds-make-filling | S10.16b |
| ds-board-studio | S10.6 | ds-make-done | S10.16b |
| ds-board-dark | S10.6 | ds-many-switch | S10.14 |
| ds-board-gator | S10.6 | ds-many-library | S10.18b |
| ds-edit-colour | S10.7 | ds-many-linked | S10.18b |
| ds-edit-reach | S10.9 | ds-multi-panel | S10.13 |
| ds-edit-review | S10.8 | ds-multi-schema | S10.15b |
| ds-edit-master | S10.10 | ds-multi-switch | S10.14 |
| ds-edit-instance | S10.8 | ds-multi-menu | S10.13 |
| ds-truth-outside | S10.11 | ds-multi-migrate | S10.12 |
| ds-truth-conflict | S10.11 | ds-edge-contrast | S10.17 |
| ds-make-inputs | S10.16b | ds-edge-trash | S10.17 |
| ds-make-directions | S10.16b | ds-edge-suggest | S10.17 |
| — | — | ds-edge-migrate | S10.12 |
| — | — | ds-advanced | S10.19 |

30 of 30.

### 4.2 Rows reassigned to S10 by neighbours

- **11/pn-ds** (`package: "S1 (+P3)"`) → **S10.13**, per S1-slices Q11 (the lead should update the row's package
  field).
- **06/ad-ds** (`package: "S11 (+P4)"`) → **S10.19**, per S11-slices Q1 / §4.1 (superseded by 13 ds-advanced).

### 4.3 Rows S10 does not own

- Canvas **14** (26 rows) stays **S2**. S10 supplies `ds.review-update`, `ds.go-to` and the update-available slot
  (§2.2) for ed-text-style, ed-comp-pick and ed-comp-instance.
- **04/md-edit-component** stays S2 (+S10 via §2.2).

### 4.4 Rule and home rows

| Row | Closed by |
| --- | --- |
| `00/rule/the-design-system-lives-on-a-board` | S10.6 (evidence), audited in S10.21 |
| `G0-D/D4` (DS → pinned row) | S1 closes it. S10.13 keeps `CAPABILITY_HOMES` green when the row changes |
| nothing-deleted `A-design-system-view-s-key-picker`, `A-token-and-type-ladders-preview-galleries` | S10.13 (Q6: v1 view kept for unconverted systems) |
| nothing-deleted `A-design-system-folder-path` | S10.19 |

## 5. Risks and run order

**Risks:**

1. **One ⌘Z across planes (Q1).** If `registerUndoHook` can't land in `project-undo.ts`, publish stays two-step:
   the kernel undo plus the DS "Undo" in Version history. S10.2 must prove the hook red-first, including a redo
   and an undo refused by a concurrent meta edit (the DS part must then not run).
2. **The L1 bridge patches** (`_shell.html`, `canvas-shell.tsx`) land through the lead while L1 runs S7. Batch
   them into one lead patch before S10.4. S10.6 and S10.7 need `ds-select`.
3. **S12 ordering.** The real-AI paths (make, bring-up, Ask AI to review) depend on agents S12 reshapes. S10 tests
   them with a scripted fixture agent driving the same verbs, so ledger evidence never waits on S12. The real-AI
   smoke goes in S10.16b / S10.15b hand-backs.
4. **The ledger hash trap (Q2).** Any builder touching `.design/ui/v2/**` makes verified evidence stale. S10.15a's
   codemod must exclude it, and the test asserts that.
5. **The `dist/` rebuild rule** applies to every client slice; run `git status apps/studio/dist/` before and after
   each `bun test`.
6. **Hub grant to non-members (S10.18a)** goes through the V2-1.16 leak matrix review before merge.

**Order (parallel where files don't overlap):**

```
now ∥   S10.0 · S10.1 · S10.5 · S10.20           (new files only; S10.0 unblocks S2.12/S2.17)
then    S10.2 → S10.3                            (engine spine, opus, serial)
then ∥  S10.4 · S10.6 · S10.12 · S10.15a · S10.16a · S10.18a
then ∥  S10.7 → {S10.9, S10.10, S10.17}     S10.8 → S10.11      S10.13 → S10.14      S10.15b · S10.16b · S10.18b · S10.19
last    S10.21
```

Conflicts to avoid inside a wave: S10.8 and S10.10 both touch the review sheet, so S10.10 goes after S10.8.
S10.6, S10.10 and S10.16b all edit `ds/board/`; each owns its own `section-*` / `directions.tsx` file, and only
S10.6 edits `ds/board/index.tsx`. S10.13 and S10.14 share `system-menu.jsx`, so S10.14 goes after S10.13.

## Decisions

- `decision:maude/v2-S10-undo-hook-across-planes`: Q1. A publish is one kernel action. The `head.json` log entry
  records its `actionId`, and an undo/redo hook moves the pointers back and re-materialises the files from
  immutable revisions. Rejected: moving DS files onto kernel lanes, and a new hub-kernel effect kind.
- `decision:maude/v2-S10-no-ui-v2-codemod-during-run`: Q2/Q3. The maude-v2 spec canvases are not codemodded and
  the in-repo systems are not converted during the run. Reason: ledger sha256 staleness plus V2-1.6 Q7. Rejected:
  running the codemod and re-stamping the ledger.
- `decision:maude/v2-S10-deterministic-conversion-map`: Q5. The specimen → section prefix rule, measured on 77
  specimens (all but `ui_kits-*` map). Rejected: AI mapping.
- `decision:maude/v2-S10-derived-make-states`: Q7/Q8. Section states are derived from `ds-check` groups plus run
  holds, and directions are draft revisions. Rejected: a `dsMake` meta key.
- `decision:maude/v2-S10-check-system-deterministic`: Q9/Q10. Check the system is deterministic, with contrast
  pairs as a code rule; agents are optional. Rejected: a registry `pairsWith` field, and a critic-only card.
- `decision:maude/v2-S10-S12-split`: Q13 as plan-s12 proposed. The interface is §2.4's `--json` formats.
