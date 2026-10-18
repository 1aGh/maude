# S11 slices: Advanced, Diagnostics, Settings, empty states

Status: **slice plan** (Phase 6 wave B planning spike, 2026-10-18, branch `spike-S11` from `feat/maude-v2` at
df99cd8f). Lane **L2** (S1 → **S11** → S8 → S10). Canvases: `06 Advanced` (25 artboards), `05 Empty States`
(20 artboards). Inventories: `.ai/plans/notes/v2-inventory/C-advanced-share.md` § 06 (lines 9–271) and
`B-ai-modes-empty.md` § 05 (lines 327–421). Gate 0 rows: C34, C37, D10–D14, D19, D20. Read code only. No
prototype was needed: every open question below was settled from the tree, the contracts and the canvases.

## 1. Scope recap

S11 fills the **bodies** that Phase 4 left as v1 stand-ins, and every empty state nobody else builds:

- **06 Advanced:**
  - the panel folds that S11 owns: Inspector (element half), Canvases and Layers, Version history (git);
  - Menu › Diagnostics: Logs, Server, AI setup, Sync details (the SyncPanel rewritten, not mounted whole),
    and the Resync trace;
  - Settings › Advanced and Settings › Connections (C34, D14);
  - the read-only code view with artboard → line mapping, and the broken-canvas card with "Ask AI to fix it";
  - the context matrix (`ad-edge-where`), the sync callout, the remembered folds.
- **05 Empty States:** one shared empty kit (what's missing · why it's fine · one next step), the empty canvas
  and empty artboard, the "arriving" and "not on this Mac" states, every artboard moved to the trash, and a
  sweep that puts the kit into the panels other packages built.
- **C37 errors and recovery:** crash relaunch line, full disk "Not saved".
- **The sweep:** Phase 4's carried warnings (13 a11y, 4 shell design), a words lint, fidelity evidence.

**Already shipped. Do not redo it; S11 replaces the stand-ins named here.**

| Area | Shipped by | What is there | Stand-in S11 replaces |
| --- | --- | --- | --- |
| Fold component | V2-4.10 | `client/v2/fold/*`. One quiet "› Advanced" row. Remembered per Mac in prefs.json `fold`. ⌘K `view.advanced-open-all` / `close-all`. Toast "All Advanced sections are open." Settings › Reset › Reset Advanced sections. | — (S11 extends `FOLD_PANELS`) |
| Settings sheet | V2-4.7a/c | `client/v2/settings/*`: General · Connections · Advanced. `SETTINGS_ROWS` is the gate. Check for updates (D19). Sync settings and ownership. Auto-setup. Copy commands. Engine cards. | Connections hosts the v1 `CloudBar`, `IdentityBar`, `FigmaConnectCard` and `ProviderKeys`. Advanced lacks Runtime, Use my own plugin copy, Decision memory, Privacy, Experimental, Reset panel layout and Reset all settings…. |
| Diagnostics | V2-4.7b | `client/v2/diagnostics/*`. Menu rows are registry `diag.*`, `sync.resync` and `sync.download-all`. A sheet with Logs, Server, AI setup and Sync tabs. Logs read V2-2.9's day files (7-day retention). | The Sync tab mounts `panels/SyncPanel.jsx` whole. AI setup mounts `ReadinessList` whole. Logs has no Show in Finder and no "Kept 7 days" foot. |
| Inspector › Advanced | S2.2 (on feat) | `client/v2/inspector/advanced.jsx`: selector, element id, tokens, Copy CSS, and **the v1 raw editor unchanged** (D18). | It does not have the 06 layout (Element · Used in · Tokens bound · CSS with Edit as text · Copy code). |
| Canvases › Advanced | V2-4.4a | `left-panel/canvases-advanced.jsx`: hidden files, active path, Trash link, count, Refresh. | It lacks file names, folder, DS Open and the row-menu Advanced items. Layers › Advanced does not exist. |
| Callouts | V2-4.8 | `shell/callouts-*`: sync-diverged / rejected / offline, update, repo-changed, role, tours. | No crash or disk-full callout. The sync callout has no fold. |
| Save status | V2-4.x / S9 | `shell/save-status.js` has the fifth word **Not saved** with Retry. | No disk-full reason. |
| ⌘K / "?" | V2-4.6, S1.4 | Where-paths, Ask AI row, `subscribeAskAI` (fills the composer, never sends). | Hidden actions are missing: Copy code, Copy file path, Copy logs, View code, Reveal in Finder, Open in editor. |

## 2. Open questions resolved, and the cross-lane contracts

### 2.1 Decisions (one line each)

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| Q1 | Which 06 rows does S11 build, and which does it only verify? | S11 **builds** ad-inspector (element half), ad-left, ad-history, ad-diag, ad-logs, ad-trace, ad-syncd, ad-settings, ad-edge-*, ad-code. It **verifies** ad-ai (S5.12) and ad-share (S9.20); both are wave A and land first. It **reassigns** ad-timeline → S7, ad-export → S8 and ad-ds → S10. | Each canvas note says the other canvas wins ("07 · ve-advanced wins", "09 is the source of truth", "Superseded by 13"). Those packages run after S11, so S11 could not capture the evidence. |
| Q2 | Who captures evidence for an artboard whose parts several packages build? | **The package that lands the last part.** S11 verifies only artboards whose parts are all wave A or S11. | Otherwise S11 waits for S7, S8 and S10. That breaks the "one row, one slice" rule. |
| Q3 | Where does the empty kit live? | `client/v2/empty/` (new, S11.1). It lifts the DS specimen `.design/system/maude-v2/preview/empty-state.tsx` (Tier-0 prior). It has a copy table holding every 05 line verbatim. Other packages import it. They never copy the markup. | One look and one voice across 20 artboards and six packages. |
| Q4 | May S11.1 start before S1 finishes, even though the lane order is S1 → S11? | **Yes.** S11.1, S11.6, S11.11, S11.13 and S11.16 touch only new files or files S1 never edits. | The kit must exist before wave-A builders write more ad-hoc empties. |
| Q5 | Where is the empty-artboard hint (es-artboard-new) drawn? | **Shell side.** It is a floating hint anchored to the selected artboard's screen rect. The canvas posts a new c2s `artboard-empty {artboardId, rect\|null}` when the selected artboard has zero children. | It keeps 05 copy in one table. S11 adds no canvas-lib UI, only one emitter block (L1 patch). |
| Q6 | How are the ghost artboards for es-all-trashed drawn? | **Canvas side** (they live in world space): canvas-lib draws `GhostArtboard` outlines from a s2c `trashed-artboards {canvas, items:[{id,label,x,y,w,h}]}`. The shell draws only the card and **Restore 4 artboards**. | The camera stays in the canvas. The trash items carry their original position (S1.7). |
| Q7 | What does "Keep both" mean for a **file-level** conflict in Sync details? | Theirs becomes the canvas. Mine is written as a sibling canvas "<name> (this Mac)". The copy has a fresh slug and its `.meta.json` re-keyed. Mine is also recorded with `history.aside` (V2-1.9 §4.9). This is a new `resolution: 'keep-both'` on `POST /_api/project/conflict`. | DDR-116 ("keep both"). S9.24's Keep both is per element (S9 Q10), so the two do not overlap. No merge engine. |
| Q8 | Who may call the code-view route? | `GET /_api/canvas-source` is **main origin only**. It is refused for **Can view** (observer: no download or export, V2-1.7). It is allowed for Can comment and up. It passes S9.10's canvas-scope filter. A cloud browser tab keeps it, read-only, with no editor door. | The matrix gives Jonas (Can comment) read-only CSS. Source text is a download for Can view. The cloud browser keeps "View code" in its row menu (ad-edge-where). |
| Q9 | Where do Reveal in Finder / Open in editor / Show in Finder run? | **Native Tauri commands**, caller-project-checked. The path is confined to that tab's project root (logs: the app's log dir). There is no studio spawn route. In a browser they are hidden or swapped to "Open in the Mac app". | Follows `decision:maude/v2-S5-open-in-terminal-native`. A studio route that spawns an editor is a confused-deputy surface. |
| Q10 | What does C34 mean for the rows it lists? | "Local server port": display only (`location.port`). "Faster canvas engine" and "Send anonymous usage data": **not drawn** (no row, no switch). "Decision memory": `N decisions · kgai` when the kg is active for the project, else "Not set up". The count comes from a new read-only `GET /_api/kg/summary` that shells out to nothing: it reads the resolver's cached count, or answers `null`. | Gate 0 C34. No-telemetry DDR (T23). Hidden is better than a dead switch. |
| Q11 | How is crash recovery detected (C37)? | Rust writes `<app data>/running.json {pid, startedAt}` at launch and deletes it on a clean quit. When the next launch finds the file, it emits `app://crashed` to each restored project tab. The studio answers `lastWorkAt` from the kernel's last accepted action (`_state/`). | The studio cannot tell a crash from a quit. The kernel knows the real "work up to 14:05". |
| Q12 | Full disk (C37) | `atomic-write.ts` maps `ENOSPC` to a typed `DiskFullError`. The write lane holds the content in memory (the outbox for synced projects) and retries when `statfs` reports room, or on the next write. Save status becomes `not-saved` with `reason: 'disk-full'`. A callout appears with **Show in Finder** (the project folder). | CONTRACT §6 C37: "changes wait here until there's room". The same outbox semantics as offline (V2-1.14). |
| Q13 | es-arriving granularity | **Per canvas.** A canvas that is listed on the hub (`sync/hub-listing.ts` / `remote-docs.ts`) but not materialised shows as a pulsing row. Opening it shows skeletons sized from the hub's project index **when the index carries artboard sizes**. Otherwise it shows one centred card: "<name> is on its way." The foot reads "Getting <project> · 41 of 93 canvases" from `seed-progress.ts`. | A canvas is one TSX file on the file plane, so per-artboard streaming does not exist. The builder measures first whether the hub index carries `{id, kind, w, h}`, and records the answer. |
| Q14 | Who owns the Phase 4 carried warnings? | S11.18 takes the shell ones: 13 a11y items (minus Present exit focus → S3); design W5 (toast copy), W6 (menu separators), W7 (empty state door → S11.2), W8 (Settings clip); "?"-sheet W1, W2, W5, W6. S3 takes Preview W1–W3. S1.4 takes ⌘K wording W4. "?"-sheet W3 (⇧⌘A alias) goes to the lead (registry). | They are L2 shell surfaces. |
| Q15 | Words rules nobody closes (`no-we-no-i`, `one-verb-per-dialog-one-action-per-toast`, `lower-elevation`) | S11.18 adds `test/v2-words-lint.test.ts`, a ratchet over string literals in `client/v2/**`. It bans "we", "I ", "Oops", "!", board, screen, sidebar, Pro, Debug and Delete for trash things, with an allowlist that only Advanced bodies use. It also checks that a dialog's title verb equals its primary button. A CSS check bans a raw `box-shadow` on `.island` outside the elevation tokens. S4 and S2 add evidence. | The plan row gives S11 "all (sweep)". |

### 2.2 Contract S1 ↔ S11: the Version history › Advanced slot (S1.15 mounts, S11.10 fills)

- **S1.15** renders `<AdvancedFold id="history">` at the foot of the Version history panel. In it, it renders
  `HistoryAdvanced` from `client/v2/history/git-advanced.jsx` (S11 owns the file; S1.15 creates a stub that
  renders today's GitPanel body, so nothing is lost before S11.10).
- Props:
  ```ts
  { canvas: string; version: VersionRow | null; role: Role; shell: Shell; onCompare(a, b): void; onRestored(): void }
  ```
- The fold id `history` joins `FOLD_PANELS`.
- "Compare pictures" (DiffView) stays S1.15's. S11 never opens a second compare.

### 2.3 Contract S2 ↔ S11: Inspector › Advanced handover

- After **S2.5** merges, `client/v2/inspector/advanced.jsx` passes to S11 (S2 lists it only in S2.2).
- S11.8 adds `registerAdvancedRow(group, entry)` (append-only, same shape as `slots.js`; a duplicate id
  throws). Groups: `element`, `used-in`, `tokens`, `css`, `artboard`, `in-code`. Three packages fill it
  without editing S11's file:
  - **S2.8**: artboard Theme, Reset position, Convert to absolute…, Body layout, Grid tracks;
  - **S7**: 08 ak-advanced, print bleed and trim;
  - **S8**: Exports at 2×.

### 2.4 Contract S6 ↔ S11: one canvas error card

- `client/v2/code/canvas-error-card.jsx` (S11.7):
  ```ts
  CanvasErrorCard({ canvas, kind: 'syntax' | 'render', error: { message, file, line?, column?, excerpt? }, lastGood?: VersionRef, onAskAi(text), onOpenInEditor?, onGoBack? })
  ```
- S11 uses `kind: 'syntax'` (ad-edge-syntax). **S6** uses `kind: 'render'` for cf-render-error (C5), with S1.13's
  `history.go-back`.
- Copy lives in the S11 copy table. "Ask AI to fix it" calls `askAI(text)`: the `search-env.js` event, which
  fills the composer and never sends.
- The card replaces the `canvas-load-retry` card in `client/shell/viewport.jsx`. The testid is re-emitted on
  "Reload canvas", which stays under the fold.

### 2.5 Contract to every package: the empty kit (S11.1)

- Exports from `client/v2/empty/index.js`:
  - `Empty({ size: 'panel'|'canvas', spot?, quiet?, land?, title, next?, chips?, actions?, foot?, align? })`;
  - `Spot({ name: 'canvas'|'ai'|'none'|'comment'|'image'|'done'|'offline'|'trash', w, quiet, land })`;
  - `AskButton({ children, keys, onClick })` (azure, white spark);
  - `Suggestions`, `Confetti` (behind Comments "All done." only), `SkeletonArtboard`, `ArrivingRow`;
  - `copy(id, vars)` over `empty-copy.js`. Ids are `<artboard>.<part>`, e.g. `es-panels-canvas.comments-none`.
- **Rules the kit enforces in its test:**
  - no button when there is nothing to do (`actions` absent for vh-before-first, trash-empty, home-shared);
  - only one celebration (the Confetti import is allowed only from `client/v2/comments/`);
  - spot art uses token fills only;
  - reduced motion means the final frame in 1 ms.
- Spot SVGs: `canvas` and `ai` lift from `system/maude-v2/assets/organic/spot-*`. `none`, `comment`, `image`,
  `done`, `offline` and `trash` are drawn with `/design:draw` into the same folder (DS asset, Tier 0), then
  imported as JSX like the existing `spot-*.jsx`.

### 2.6 Patch requests that cross lanes (all through the lead)

| To | Patch | Needed by |
| --- | --- | --- |
| lead: `bridge/dgn-protocol.ts` | c2s `artboard-empty {artboardId, rect\|null}` (gate active); s2c `trashed-artboards {canvas, items}`; s2c `select-by-selector {selector}` (canvas answers with the existing `select-by-id` reply) | S11.2, S11.5, S11.9 |
| L1 (active package): `canvas-shell.tsx` / `canvas-lib.tsx` | emit `artboard-empty` on selection change (one block); `GhostArtboard` render from `trashed-artboards` (one component, dashed outline + label, no hit area); handle `select-by-selector` with `querySelectorAll` scoped to artboards, capped at 500 | S11.2, S11.5, S11.9 |
| lead: registry `actions/defs/*` | S11 ids (listed per slice) | most slices |
| lead: `routes/index.ts` `allSpecs` | new factories `routes/{canvas-source,diagnostics,kg-summary,settings}.ts` | S11.6, S11.11, S11.13 |
| lead: `http.ts` | move `/_api/sync/resync` into `routes/sync.ts` and add `summary {checked, sent, fetched, conflicts}` + progress on `/_sync-status`; add `keep-both` to `/_api/project/conflict` | S11.11, S11.12 |
| lead: `cli/commands/design.mjs` verb list + `plugin-cli-reachability` + `actions.manifest.json` regen | `maude design logs`, `sync status\|resync`, `canvas-errors`, `canvas-source` | S11.6, S11.11 |
| L4 review: Tauri capability + `windows.rs` caller-check list | `project_reveal_path`, `project_open_in_editor`, `diagnostics_reveal_logs`, the `running.json` marker | S11.16 |
| S1 | `CanvasesPanel` row field `fileName` (second mono line) + a `menuExtra` group hook in `row-menu.jsx` (`canvasMenuItems(row, { edit, advanced })`) | S11.9 |
| runtime-state lists (DDR-115, four lists) | **none**: `running.json` lives in app data, not `<designRoot>` | — |

## 3. Slices

Model key: **S** = sonnet, **O** = opus (reason given). `∥` = can start before S1 finishes (new files only).

| id | title | artboards made verifiable | files owned | lead patch requests | model | deps | done-when (observable) | red-first tests | e2e / scenario | turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **S11.1** ∥ | Empty kit: Empty, Spot, AskButton, Suggestions, Confetti, Skeleton/ArrivingRow, copy table, landing spring | 05/es-landing | new `client/v2/empty/{index.js,empty.jsx,spot.jsx,ask-button.jsx,suggestions.jsx,confetti.jsx,skeleton.jsx,empty-copy.js,empty.css}`; new spot SVG/JSX under `.design/system/maude-v2/assets/organic/` (drawn with `/design:draw`) | none | S | — | The 05 frames (0 / 90 / 200 / 520 ms) match a rendered Spot `land` (`--dur-spring`, `--ease-spring`, 48 ms stagger). Every 05 string is in `empty-copy.js` verbatim. A DS-keeper pass is clean (lifted from `preview/empty-state.tsx`). | `v2-empty-kit.test.tsx`: no actions when the copy id is "no-door"; Confetti import allowlist; reduced motion → 1 ms; tokens only (no hex in `empty.css`); copy goldens vs a list extracted from `05 Empty States.tsx` | — | 110 |
| **S11.2** | Empty canvas and empty artboard (+ Phase 4 W7 "no door") | 05/es-canvas-ai, 05/es-canvas-three, 05/es-artboard-new | new `client/v2/empty/{empty-canvas.jsx,artboard-hint.jsx,use-empty-canvas.js}`; the Layers tab's empty branch (mount point coordinated with S2.6) | bridge `artboard-empty`; L1 emitter; registry `ai.ask-fill-artboard` (⌘K label "Ask AI to fill <artboard>", pre-fills) | S | S11.1, S5.13 (readiness + queued words), S2.8 (New artboard) | A new canvas shows "Your canvas is ready." / "Ask AI for a first draft, or start drawing." + **Ask AI ⌘/** above the Edit toolbar at 100 %. Offline adds "AI is back when this Mac is online." with the spot quiet. Not connected opens S5's ConnectSheet once. A new empty Tablet shows the hint, which leaves on the first draw. Layers shows "No layers on Tablet yet." | `v2-empty-canvas.test.tsx`: three variants from readiness state; hidden for Can view / Can comment; hint dismissed on the first `layers` change; the copy is the CONTRACT §6 line exactly (`rule/the-empty-canvas-line`) | — | 120 |
| **S11.3** | Empty sweep in panels other packages built | 05/es-panels-canvas, 05/es-search-k, 05/es-search-panel, 05/es-edge-panels, 05/es-viewer | small edits after each owner merges: `client/v2/canvases/*` empty folder + search no hits (S1.1/S1.3), `client/v2/history/*` before first change (S1.14), `client/v2/comments/*` none + All done (S9.22), `client/v2/ai/*` chat search no hits (S5.12), `client/v2/share/*` alone (S9.19), the ⌘K no-results (S1.4) | none (the owners' testids stay) | S | S11.1; S1.1, S1.3, S1.4, S1.14, S5.12, S9.19, S9.22 merged | Each sub-part renders through `Empty` with its 05 copy. Foot lines say what was searched ("Searched 93 canvases and their artboards", "Searched 41 chats in Alligators brand — titles and every message"). "All done." has the only confetti. Viewer Comments says "…Jonas and Tereza see it right away." | One render test per sub-part, asserting copy id + no-door rules, written red against today's ad-hoc markup | — | 130 |
| **S11.4** | Arriving and not on this Mac | 05/es-arriving, 05/es-offline-uncached | new `sync/availability.ts` (read model: listed ∖ materialised, from `hub-listing.ts` / `remote-docs.ts` / `seed-progress.ts`), new `routes/availability.ts` (`GET /_api/sync/availability`), `client/v2/empty/{arriving.jsx,not-local.jsx}`, the Canvases row `dim` + pulse through S1's `row-slots.js` (`source: 'sync'`) | route table entry; `/_sync-status` gains `seed {done,total}` if it is not there | **O** (sync plane: what counts as "local" must not race the file plane or a cold start) | S11.1, S1 `row-slots.js` | A fresh Mac pulling a 93-canvas project never shows an empty project. Arrived rows are normal; pending rows are dimmed and pulsing. Foot: "Getting Alligators brand · 41 of 93 canvases". Offline + uncached shows "Combine-video-AI isn't on this Mac yet." with **Show canvases on this Mac** (filters), and no toolbar and no zoom. The builder records whether the hub index has artboard sizes (Q13). | `sync-availability.test.ts` in both directions (memory: test sync both ways): cold start, partial seed, a doc arriving mid-open, a delete during seed; route refused for a canvas outside the ACL closure | rewrite `cloud-attach.e2e.ts` to assert the arriving foot | 140 |
| **S11.5** | Every artboard moved to the trash | 05/es-all-trashed | `client/v2/empty/all-trashed.jsx` (card + Restore N), the shell side of `trashed-artboards` | bridge `trashed-artboards`; L1 `GhostArtboard` | S | S11.1, S1.7 (artboard trash items with position), S1.13 (`restoreArtboard`) | "LetakA6 has no artboards left." / "Jonas moved all four to the trash 10 min ago. …" + **Restore 4 artboards** puts them back where they were (one undo step). Ghost outlines keep their places. | Render test from a fake trash list; the restore calls S1's route with every id once; hidden for viewers (no restore) | — | 90 |
| **S11.6** ∥ | Canvas source + structured canvas errors (server and verbs) | — (feeds ad-code, ad-edge-syntax, S6 C5) | new `canvas-source/{source-map.ts,errors.ts}` (artboard id → `{startLine,endLine}` by parsing `DCArtboard id=` with the oxc parser S1.9 uses; `CanvasBuildError {message,file,line,column,lineText}` from Bun `BuildMessage.position`); `canvas-build.ts` throws the typed error (one change, coordinated with S1.11); new `routes/canvas-source.ts` (`GET /_api/canvas-source?canvas=`, `GET /_api/canvas-errors[?canvas=]`); `bin/canvas-errors.sh`, `bin/_canvas-errors.mjs` | route table; verb list (`canvas-errors`, `canvas-source`); `test/_role-refusals.ts` rows | **O** (a new read surface for tenant source: origin, role, ACL closure) | S9.9/S9.10 (role gate + canvas filter) or a stub with a TODO the gate test catches | `maude design canvas-errors` prints `Pricing.tsx:212:19 SyntaxError: Expected "}" but found ")"`. The route answers the same JSON. It is 404 from the canvas and capture origins, 403 for Can view, and filtered by the ACL closure. | parity test (route ≡ verb); `canvas-origin-parity` keeps it out of both allowlists; source map goldens over 6 real canvases incl. nested sections; error position for 3 broken fixtures | — | 110 |
| **S11.7** | Code view + broken-canvas card | 06/ad-code, 06/ad-edge-syntax | new `client/v2/code/{code-view.jsx,highlight.js,code.css,canvas-error-card.jsx,use-canvas-source.js}`; replaces the load-error card in `client/shell/viewport.jsx` (re-emit `canvas-load-retry`) | registry `canvas.view-code` (⌘K + row menu), `canvas.copy-error`, `canvas.ask-ai-fix` (pre-fills), `canvas.last-good` (→ S1.13) | S | S11.6, S11.16 (Open in editor), S1.13 | The code island shows "🔒 Read only", Copy and **Open in editor**. The selected artboard's lines are highlighted. The fold holds the terminal and Claude Code commands for this canvas. An external edit that breaks Pricing shows "Pricing can't be drawn right now." + **✦ Ask AI to fix it**. The fold has the error, "Pricing.tsx · line 212, column 19" (copy), lines 210–213 with a caret, Open in editor, Copy error and Last good version. | `v2-code-view.test.tsx` (line marks from the map; no edit affordance; mono only inside); `v2-canvas-error-card.test.tsx` (both kinds — S6's contract; Ask AI pre-fills and never sends) | `sidecar-respawn-canvas-switch.e2e.ts` selectors | 130 |
| **S11.8** | Inspector › Advanced per 06 (element half) + the Advanced row registry | 06/ad-inspector | `client/v2/inspector/advanced.jsx` (from S2, §2.3), new `client/v2/inspector/advanced-rows.js` | registry `inspector.copy-code` (element JSX via `/_api/canvas-source` slice by `data-cd-id`), `inspector.edit-css-as-text`, `inspector.copy-style` / `paste-style` (if not S2's), `element.detach` (reuse `/_api/detach-component`) | S | S2.5 merged, S11.6 | Closed: designer rows plus the hint "Code, tokens, CSS". Open, it **adds** the following under the unchanged plain rows: Element (Tag · Classes · Selector · Element id + copy); Used in ("Edits apply to: Shared · 4 places" + Detach); Tokens bound; CSS with **Edit as text** + Property + Attribute; Copy style · Paste style · Copy CSS · **Copy code**. The v1 raw editor is still reachable inside CSS (nothing deleted). | Rows order golden; `registerAdvancedRow` duplicate throws; Copy code returns the element's JSX for 3 fixtures; read-only (Can comment) shows CSS read-only + Copy CSS only | — | 130 |
| **S11.9** | Canvases and Layers › Advanced | 06/ad-left | `client/v2/left-panel/canvases-advanced.jsx` (after S1.7 adds "Kept on this Mac"), new `client/v2/left-panel/layers-advanced.jsx`, the Advanced group via S1's `menuExtra` hook | registry `canvases.show-file-names`, `canvas.reveal-in-finder`, `canvas.open-in-editor`, `canvas.copy-file-path`, `canvas.rename-file`, `layers.show-tags`, `layers.select-by-selector`; bridge `select-by-selector`; S1 patch (`fileName`, `menuExtra`) | S | S1.1, S1.2, S1.7, S11.7 (View code), S11.16 (native) | Canvases open: Show file names (second mono line), Show hidden files, Folder `~/Maude/alligators` (copy), Design system `system/alligators` + Open, Trash "12 things" + Open, foot "93 of 93 shown · updated just now" + Refresh. The row menu adds Reveal in Finder · Open in editor · View code · Copy file path · Rename file…. Layers open: Show tags and ids, "15 artboards · 214 layers", Select by selector, Element id. One fold per panel follows the active tab (`left.canvases`, `left.layers`). | Render tests per row; selector capped and scoped; native rows hidden in the browser and swapped to "Open in the Mac app" | — | 130 |
| **S11.10** | Version history › Advanced: the git, in plain words | 06/ad-history | `client/v2/history/git-advanced.jsx` (§2.2), `client/v2/history/git-model.js`; retire `panels/GitPanel.jsx` from `hooks/use-palette-and-panels.jsx` and `RepoBranchSwitcher` from `tree/tree.jsx` (old bindings die with new ones) | registry `history.branch-switch`, `history.new-branch`, `history.fetch`, `history.publish`, `history.save-with-note`, `history.open-pr`, `history.discard-file`, `history.continue-draft` (reuse `project.pull-copy`); `/_api/git/*` unchanged | S | S1.14, S1.15 | Closed: versions only, no commit ids, no branch; hint "Branch, git, changed files". Open: Branch select, Drafts + **Continue**, Remote (copy), Changed in this version (SHA, M/A badges, +14 −6, inline diff), "Not in a version yet" + Discard, and the actions "Save a version with a note…", "New branch…", "Fetch", "Publish 2 versions", "Pull a copy to this Mac…", "Add to main · opens a pull request". The chat guard runs before a branch switch (D10). Hidden for Can comment / Can view and in a cloud tab ("cloud versions"). | Model goldens over today's GitPanel fixtures; role hidden + server refuses (`/_api/git/*` writes for viewers); no v1 GitPanel mount remains (grep test) | rewrite `git-branch-switcher.e2e.ts`, `git-lifecycle.e2e.ts`, `git-switch-repos.e2e.ts` onto Version history › Advanced | 150 |
| **S11.11** ∥ | Diagnostics: Logs, Server, AI setup, Reload, Resync trace + verbs | 06/ad-diag, 06/ad-logs, 06/ad-trace | `client/v2/diagnostics/*` (sheet views, model, handlers); new `bin/logs.sh` + `_logs.mjs`, `bin/sync.sh` + `_sync.mjs` (status \| resync) | registry `diag.copy-logs`, `diag.logs-show-in-finder`, `diag.reload-canvas` (⌘R, if absent); `routes/sync.ts` move + resync `summary`/progress (http.ts patch); verb list | S | S11.16 (Show in Finder); the http.ts move by the lead | Logs: All · Sync · Server · AI · Export, Filter, Copy all, Show in Finder, foot "Kept 7 days on this Mac · Help › Report a bug can attach the last 200 lines." Server card: Running · Showing "Canvas · Combine-kampan" · Live connection · Address (copy) · Version. AI setup answers in four ✓ rows (v2 rows over `ReadinessList`'s data, not the whole component). Reload toast "Combine-kampan reloaded.". Resync shows "Resyncing… 1 204 of 1 318", then toast "Resync done — 3 files sent, nothing else differed." and the log line `sync · resync · 1 318 checked · 3 sent · 0 conflicts`. | `v2-diagnostics-render.test.tsx` extended; resync summary from a fake sync; verbs ≡ routes; redaction kept (V2-2.9 test) | new `advanced-diagnostics.e2e.ts` part 1 (Menu › Diagnostics → Logs → Copy all; Resync trace) | 120 |
| **S11.12** | Sync details, rebuilt (SyncPanel retired) + Keep both | 06/ad-syncd | new `client/v2/diagnostics/sync-details/*.jsx`; server `keep-both` resolution in the project-conflict handler (location per the lead's http.ts move) + `sync/keep-both.ts`; retire `SyncPanel.jsx` / `SourceConflictPanel.jsx` mounts (their routes stay) | `http.ts` conflict-route patch or move to `routes/sync.ts`; registry `sync.get-latest`, `sync.keep-mine`, `sync.use-theirs`, `sync.keep-both`, `sync.publish-ai-edit`, `sync.discard-ai-edit`, `sync.sign-in-again`, `sync.cancel-transfer` | **O** (sync plane + a new conflict resolution that writes two canvases) | S11.11, S1.15 (Compare), S9.21 (access word) | Header "Sync · Alligators brand" + "2 need you". **Get latest** row. Needs you holds the conflict card (Keep mine · Use theirs · **Keep both** + Compare) and the unfinished AI edit (Publish · Discard). Moving now: transfers with ✕. Counts. Fold "Hub, commands". The sign-in ran-out card has **Sign in again**. Every ad-syncd nothing-deleted row points at a v2 testid. | `sync-keep-both.test.ts` both directions (desktop-wins and cloud-wins races, memory); the copy's slug/meta re-key; the aside recorded; one undo step; render tests per card | `team-project.e2e.ts` conflict leg → Keep both | 150 |
| **S11.13** ∥ | Settings › Advanced + Reset + remembered folds + prefs migration (C34, D19, D20) | 06/ad-settings, 06/ad-edge-remember | `client/v2/settings/{advanced-section.jsx,settings-model.js,reset-section.jsx}`, `client/v2/fold/fold-store.js` (`FOLD_PANELS` gains `left.layers`, `history`, `code`, `connections`, `ai`, `share`, `timeline`, `export`, `ds` — owners register by id), new `routes/settings.ts` (`GET /_api/kg/summary`), `client/v2/settings/prefs-migrate.js` | registry `settings.reset-panel-layout`, `settings.reset-all` (confirm dialog title = verb), `settings.use-own-plugin-copy`, `settings.experimental-teams` | S | V2-4.7/4.10 (shipped) | This Mac: Version · Update · Local server port (display) · Runtime "Bun x · built in" · Server build `maude-dev-srv` · "Keys are kept in macOS Keychain". Claude Code: Plugins, **Use my own plugin copy** (`MAUDE_NO_PLUGIN_BOOTSTRAP`, read at ACP spawn), Install and sign in automatically, the three Copy commands. Decision memory: switch + "523 decisions · kgai" / "Not set up". Engines: Subtitles / Video keyframes selects (Auto) + model cards (Download / Remove + command). Privacy: "Logs in bug reports" (Ask each time / Always / Never; read by `report-bug.jsx`). Experimental: "AI reviews argue it out (teams)". This project, in 06 words. Reset: Reset panel layout · Close all Advanced sections · the per-fold switch list · **Reset all settings…**. No row for usage data or "Faster canvas engine" (C34). Every v1 `mdcc-*`/`maude-*` pref key has a v2 home or a named retirement (D20); "seen" flags are re-keyed once. | settings-model gate test extended (every 06 row present; C34 rows absent); `prefs-migrate.test.js` (~40 keys, idempotent, a second run is a no-op); per-fold switch list = `FOLD_PANELS` ∪ seen ids | `advanced-diagnostics.e2e.ts` part 2 (fold kept open across projects; Reset closes all) | 140 |
| **S11.14** | Settings › Connections, each with its own Advanced (D11, D12, D14) | 06/ad-edge-hub | `client/v2/settings/connections-section.jsx` + new `client/v2/settings/connection-row.jsx`; retires the v1 `CloudBar` / `IdentityBar` / `FigmaConnectCard` / `ProviderKeys` mounts from Settings (their logic is lifted into hooks; the v1 files stay while another surface uses them) | registry `connections.replace-hub-token`, `connections.figma-test`, `connections.cloud-project-connect` / `disconnect` | **O** (credentials: the hub token display and replace, keychain writes, sign-out per connection) | S9.20 (account block), S9.14 (device code), S1.18 (deep links, D11) | Maude Cloud "Signed in as You" + Sign out, with the cloud projects on this Mac (Connect / Disconnect, D11). "Studio site — your team's own server" reads "Connected · saved 1 min ago" + Sign out; its Advanced has Address (copy), Access token "•••• a91f" + **Replace…**, Signed in as, Hub version. GitHub. AI images, video and voice: "2 keys · Gemini, ElevenLabs" + Manage. Figma: Connected + **Test** + Disconnect (D14). The window says Saved like any cloud project. | Token never rendered beyond its last 4 (DOM + test); Replace writes through the existing keychain route only; hidden for a cloud tab (`local: true` kept, DDR-209) | `team-project.e2e.ts` server-add leg | 130 |
| **S11.15** | Context matrix + the sync callout fold | 06/ad-edge-where, 06/ad-edge-sync | new `client/v2/advanced/where-matrix.js` (10 rows × 5 contexts as data: hidden \| swap:<label> \| greyed:<reason> \| readonly), `test/v2-where-matrix.test.ts`; `client/v2/shell/callouts-model.js` sync-stuck entry + fold | none beyond fixes the test finds (each goes to the row's owner) | **O** (hidden ≠ refused: for every row the matrix hides from a role, the test asserts the server refusal) | S11.8–S11.14, S5.12, S9.20 | The matrix test passes in desktop / browser / Can comment / local / offline for every row. In the browser, Reveal in Finder becomes **Open in the Mac app** and Diagnostics says "Runs in the cloud". Offline greys only what needs the internet. Sync stuck but safe: the cluster says Syncing…, the callout reads "3 changes are waiting to reach the cloud." + **Try now**, and its fold shows Hub · Reply "429 · rate limited" · Next try · Last good sync · Waiting · 3. | The matrix test (red first: today at least the git, terminal and This-Mac-link rows are wrong in some context); callout from a fake `retry-after` status | `shell-parity.e2e.ts` gains the matrix probes | 130 |
| **S11.16** ∥ | Native doors + crash marker | — (feeds S11.7, S11.9, S11.11, S11.17) | `apps/desktop/src-tauri/src/` new `doors.rs` (`project_reveal_path(rel)`, `project_open_in_editor(rel)` with `$VISUAL`/`$EDITOR`/default app, `diagnostics_reveal_logs()`), `lifecycle.rs` (the `running.json` marker + `app://crashed` to restored tabs), client `client/v2/shell/native-doors.js` | capability + caller-check list (L4 review); registry `exec: 'native'` facts | **O** (Rust/Tauri, path confinement) | — | Reveal in Finder selects the file in Finder. Open in editor opens it. Both refuse `..`, absolute paths, symlinks out of the root, and a caller that is not that project's tab. A kill -9 then relaunch emits `app://crashed` once; a clean quit emits nothing. | cargo tests for confinement (traversal, symlink, foreign label) + the marker; `clippy` clean | `relaunch.e2e.ts` gains the crash leg (WebKit window on screen, memory) | 120 |
| **S11.17** | Errors and recovery (C37): crash line, full disk | — (Gate 0 C37) | `client/v2/shell/callouts-model.js` entries `crashed`, `disk-full`; `client/v2/shell/save-status.js` (`reason: 'disk-full'`); `atomic-write.ts` `DiskFullError` + held-write retry in the write lane (`sync/` outbox for linked, an in-memory hold for local) | the studio route answering `lastWorkAt` (in `routes/diagnostics.ts`) | **O** (write path + outbox: a held write must never be lost or applied twice) | S11.16, V2-1.14 outbox | After a crash: "Maude quit unexpectedly. Your work up to 14:05 is here." + **Report a bug…** (opens the dialog with crash logs ticked). On ENOSPC: status "Not saved" + "This Mac is out of space — changes wait here until there's room." + **Show in Finder**. When room returns, the held write lands once and the status goes back to Saved. | `disk-full.test.ts` (a fake fs throws ENOSPC; the hold survives; one write on recovery; a second ENOSPC keeps the first hold); callout copy goldens | `report-bug-dialog.e2e.ts` crash entry | 130 |
| **S11.18** | Sweep: menus, ⌘K hidden actions, "?" fold, pinned, open-all + Phase 4 carried warnings + words lint | 06/ad-menus, 06/ad-search, 06/ad-open-all, 06/ad-pinned | small fixes across `client/v2/shell/*`, `client/v2/settings/*`, `client/v2/diagnostics/*`, `actions/help.ts`; new `test/v2-words-lint.test.ts`, `test/v2-elevation-lint.test.ts` | registry: missing `where` paths; MOVED_KEYS gains "Toggle theme" and "New video…" (design W5); ⇧⌘A alias (W3) to the lead | S | S11.2–S11.14 | ⌘K "copy" lists the 6 hidden tools with their homes + Copy link under Also. The "?" fold shows the advanced keys with paths and every moved key. The menu has the kit's separators and an open state. The 13 a11y warnings (except Present focus) are fixed: `<main>` + h1 + skip link, heading order, Layers `aria-level` + roving tabindex, radio groups one tab stop, Diagnostics info rows not `menuitem`, the palette count = rendered rows, one "Show panels" button, 4.5:1 notes, ⌘, from the canvas iframe, callout buttons inert when hidden. Design W5, W6 and W8 are fixed, plus "?" W1, W2, W5 and W6. | The words lint and the elevation lint (ratchets, red first on today's strings); a11y unit checks per item | — | 140 |
| **S11.19** | Verifier: fidelity evidence for every S11 row + ad-map / ad-why / ad-ai / ad-share | 06/ad-map, 06/ad-why, 06/ad-ai, 06/ad-share (+ evidence for every row in §4 marked S11) | `.ai/scenarios/maude-v2/fidelity/{05,06}/*`, `apps/desktop/e2e/scenarios/advanced-diagnostics.e2e.ts` (assembled), ledger `set` via `scripts/v2-ledger.mjs` | ledger writes go through the lead if the run reserves them | S | every other S11 slice; S5.12, S9.20 merged | One implemented-state screenshot per artboard + the critic report (design-critic + a11y-critic + copy-critic; DS keeper). ad-map: `check-v2-nothing-deleted.mjs` is 100 % and **no row's `v2.where` names a v1 component** (SyncPanel, GitPanel, CloudBar…). ad-why: there is no global "Advanced mode" (no registry id or setting matches `/advanced.?mode/i`, test). Every row in §4 is `verified`. | `v2-no-advanced-mode.test.ts`; a nothing-deleted lint that bans v1 component names in `v2.where` (red first: today Sync details and Settings name them) | `advanced-diagnostics.e2e.ts` green 3 runs (window on screen) | 120 |

Total: 19 slices, ~2 410 turns. Nine are Opus (risk classes named in the model column).

## 4. Ledger coverage check

### 4.1 Artboard rows with `package: "S11 (+P4)"` (canvas 06, 25 rows)

| Row | Slice | | Row | Slice |
| --- | --- | --- | --- | --- |
| 06/ad-map | S11.19 | | 06/ad-diag | S11.11 |
| 06/ad-why | S11.19 | | 06/ad-logs | S11.11 |
| 06/ad-trace | S11.11 | | 06/ad-syncd | S11.12 |
| 06/ad-inspector | S11.8 | | 06/ad-settings | S11.13 |
| 06/ad-left | S11.9 | | 06/ad-pinned | S11.18 |
| 06/ad-ai | S11.19 (built by S5.12) | | 06/ad-search | S11.18 |
| 06/ad-share | S11.19 (built by S9.20) | | 06/ad-open-all | S11.18 |
| 06/ad-history | S11.10 | | 06/ad-code | S11.7 |
| 06/ad-menus | S11.18 | | 06/ad-edge-sync | S11.15 |
| 06/ad-edge-syntax | S11.7 | | 06/ad-edge-hub | S11.14 |
| 06/ad-edge-where | S11.15 | | 06/ad-edge-remember | S11.13 |
| **06/ad-timeline** | **→ S7** (07 ve-advanced wins; S7 lands after S11) | | **06/ad-export** | **→ S8** (09 ex-advanced is the source of truth; S8 runs after S11 in L2) |
| **06/ad-ds** | **→ S10** (superseded by 13 ds-advanced; the canvas says so) | | | |

### 4.2 Artboard rows with `package: "S11 (+ owners)"` (canvas 05, 20 rows)

| Row | Slice | | Row | Slice |
| --- | --- | --- | --- | --- |
| 05/es-canvas-ai | S11.2 | | 05/es-search-k | S11.3 |
| 05/es-landing | S11.1 | | 05/es-search-panel | S11.3 |
| 05/es-canvas-three | S11.2 | | 05/es-viewer | S11.3 |
| 05/es-artboard-new | S11.2 | | 05/es-arriving | S11.4 |
| 05/es-panels-canvas | S11.3 | | 05/es-offline-uncached | S11.4 |
| 05/es-edge-panels | S11.3 | | 05/es-all-trashed | S11.5 |
| **05/es-home-cloud** | **→ S6** (Home; S6's scope names "05 home/first-run empties") | | **05/es-home-local** | **→ S6** |
| **05/es-home-shared** | **→ S6** | | **05/es-project-new** | **→ S6** (the project-create flow; the Canvases panel part uses the S11 kit) |
| **05/es-panels-make** | **→ S8** (Assets + Exports are its last parts; AI chat S5.12 and Trash S1.8 land earlier) | | **05/es-search-more** | **→ S8** (Assets no-hits is the last part; ⌘K day-one is S1.4) |
| **05/es-timeline** | **→ S7** (timeline empty + "Cut 15 s" is the timeline) | | **05/es-filter** | **→ S7** (kind filter chips are in S7's scope) |

S11 verifies 12 of the 20 rows in 05. The other 8 move to S6, S7 or S8, and those packages use the S11.1 kit.
**The lead must re-tag these 11 ledger rows** (3 in 06, 8 in 05) with `scripts/v2-ledger.mjs set … package`
before S6, S7 and S8 plan, so each row sits in exactly one package.

### 4.3 nothing-deleted rows whose v2 home is an Advanced fold (`client/v2/nothing-deleted.json`)

Each slice rewrites `v2.{testid,action,where}` for its own rows only. The lead re-runs
`scripts/v2-manifest/map-entries.mjs --write`.

| drawnAt (rows) | Slice |
| --- | --- |
| ad-inspector, element (11): selected-element-s-selector, tag-and-class, copy-css, copy-data-cd-id, copy-style-paste-style, css-tab-raw-properties, custom-css-property-rows, html-attribute-rows, edit-scope-local-shared-detach, token-popover-per-design-system, inspector-vocabulary-advanced-designer | S11.8 |
| ad-inspector, artboard (5): artboard-theme-ds-default-follow-chrome, body-layout-select, convert-layout-to-absolute, grid-tracks-editor, reset-position-fit-just-this-artboard | **S2.8** (S2 Q12; registered through §2.3) |
| ad-left (12) | S11.9. trash-clear-out-old-files is built by S1.8; S11.9 only points the row at it. |
| ad-history (12) | S11.10 |
| ad-diag (7), ad-logs (5) | S11.11 |
| ad-syncd (7) | S11.12 |
| ad-settings (13) | S11.13 |
| ad-edge-hub (6) | S11.14 |
| ad-menus (14), ad-pinned (2) | S11.18 |
| ad-ai (7) | S5.12 builds; S11.19 checks |
| ad-share (3) | S9.20 builds; S11.19 checks |
| ad-export (5), 09 ex-advanced (1) | S8 |
| ad-timeline (3) | S7 |
| 13 ds-advanced (3) | S10 |
| 02 ob-adv-sheets (1) | S6 |

### 4.4 Rule and home rows

- **S11 closes:**
  - `00/rule/the-empty-canvas-line` (S11.2)
  - `00/rule/no-we-no-i`, `00/rule/one-verb-per-dialog-one-action-per-toast` (S11.18 words lint; S2 and S4
    add evidence)
  - `00/rule/lower-elevation` (S11.18 elevation lint)
- **Home rows S11 closes:**
  - `G0-D/D10`: S11.10, after S1.15.
  - `G0-D/D11`: S11.14, after S1.18 and S9.14.
  - `G0-D/D12`: S11.12 + S11.14, after S9.20 and S9.21.
  - `G0-D/D19`: S11.13 evidence. The native menu is unchanged; Check for updates is in Settings › Advanced.
  - `G0-D/D20`: S11.13, prefs migration.
- **Home rows S11 contributes to; another package closes:**
  - `G0-D/D14`: S11.13 (selects) and S11.14 (Figma Test). **S8** closes it with "Generate model select in
    its Advanced" (12).
  - `G0-D/D13`: S11.17 (Report a bug… from the crash line) and S11.13 (logs-in-reports policy). It closes
    with **V2-7** (tours rewritten) and **S6** (Home first-run line).
- **Gate 0 rows:**
  - C34: S11.13.
  - C37: S11.16 + S11.17.

## 5. Risks and run order

**Risks**

1. **Owners' files under a sweep (S11.3, S11.18).** The edits land in S1, S5 and S9 files after those
   packages merge. If one of them is still open, the sweep slice skips that sub-part and lists it. It never
   forks the file.
2. **SyncPanel and GitPanel retirement (S11.10, S11.12).** These are the two biggest v1 bodies. Before the
   mounts go, every nothing-deleted row and every v1-manifest entry mapped to them must point at a v2 testid.
   The S11.19 lint ("no v1 names in `v2.where`") is the tripwire, and it is red first.
3. **Keep both writes two canvases (S11.12).** It is a new conflict resolution on the sync plane. Test both
   directions (memory: one side wins races the other loses). The copy's slug and meta re-key must not collide
   with an existing canvas.
4. **The code view exposes tenant source (S11.6).** Main origin only, Can view refused, the ACL closure
   applied. A canvas-origin request is a 404 and is pinned by the parity test. If S9.9 or S9.10 have not
   landed, S11.6 ships behind a stub that the role-refusal test marks pending, and it does not turn green.
5. **Disk-full hold (S11.17).** A held write applied twice, or dropped, is data loss. The outbox already has
   idempotency keys (V2-1.14); local projects need the same key on the in-memory hold.
6. **L1 patches (S11.2, S11.5, S11.9)** queue behind the serial canvas lane. Each is one block, specified in
   §2.6, so the active L1 builder can take it in a single commit.
7. **The test lane.** S11.4, S11.12 and S11.17 run sync tests. Run them alone (memory: parallel runs
   contaminate).

**Order and parallelism** (each `∥` group uses separate worktrees with disjoint files):

- **Now, while S1 finishes:**
  - ∥ S11.1 (empty kit);
  - ∥ S11.6 (canvas source server);
  - ∥ S11.13 (Settings › Advanced);
  - ∥ S11.16 (native doors, Rust).
  - Disjoint files: `client/v2/empty/`, `canvas-source/` + `routes/canvas-source.ts`, `client/v2/settings/` +
    `fold/`, and `src-tauri/`.
- **Wave 2:**
  - ∥ S11.11 (diagnostics views; after the lead's `routes/sync.ts` move);
  - ∥ S11.7 (code view; after S11.6 + S11.16);
  - ∥ S11.2 (empty canvas; after S11.1 + S5.13);
  - ∥ S11.14 (Connections; after S9.20).
  - Diagnostics, code, empty and settings/connections files are disjoint. S11.13 and S11.14 share
    `settings-model.js`, so S11.14 starts after S11.13 merges.
- **Wave 3 (needs S1's merges):**
  - ∥ S11.9 (Canvases/Layers; after S1.1, S1.2, S1.7);
  - ∥ S11.10 (Version history git; after S1.14, S1.15);
  - ∥ S11.5 (all trashed; after S1.7, S1.13);
  - ∥ S11.4 (arriving; after S1 `row-slots.js`).
  - S11.12 (Sync details) runs after S11.11 and not beside S11.4: both touch `sync/`, and the test lane
    serialises them.
  - S11.8 (inspector) runs once S2.5 merges (L1 hand-over), beside any of the above.
- **Wave 4:**
  - S11.17 (C37; after S11.16);
  - S11.3 (empty sweep; after the owners merge);
  - S11.15 (matrix; after S11.8–S11.14).
- **Last:** S11.18 (sweep), then S11.19 (verifier).

Critical path: S11.6 → S11.7 → S11.9 → S11.15 → S11.18 → S11.19. The L1 hand-over (S11.8) and the S1 merges
(S11.9, S11.10) are the external waits.
