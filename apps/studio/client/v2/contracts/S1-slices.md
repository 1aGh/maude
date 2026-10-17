# S1 — Navigation & history: slice plan

Package `S1` (lane L2, first on L2). Canvases: `11 Projects and Navigation` (topic owner for Version history, Trash,
⌘K, tabs, navigation), nav empties in `05`, find in `01`. Contracts consumed: V2-1.9 (version history), V2-1.17
(index + thumbnails), V2-1.1 (Home + cross-project index), V2-1.7 / V2-1.16 (roles, L18 Trash), V2-1.5 via
`S5-kernel-foundation.md` (agreed with plan-s5, see §2). This file is the plan only. No product code.

## 1. Scope recap

S1 makes finding and going back work at scale. It covers five areas.

- **Canvases panel at 93 canvases:** folders, pins, sort, inline rename, drag-move, search with accent folding, typos and artboards, and an artboard jump list with a camera glide.
- **⌘K:** grouped across projects, with word marks, close matches, "Nothing called …" and the day-one empty state.
- **Version history ⌥⌘H:** pictures, named versions, a words diff, Viewing, Compare, and restore of the whole canvas, one artboard or one object.
- **Trash:** holds canvases and artboards; clear-out is owner-only on the server.
- **States:** a project whose folder moved, access removed, now Can view; stable deep links to an artboard.

The Phase 3 tab rows (`S1 (+P3)`) were built by V2-3.x. S1 captures their evidence and closes their gaps.

**Already shipped (do not redo):**
- V2-4.4a:
  - left panel Canvases · Layers · Assets on the dock slot (`client/v2/left-panel/*`);
  - pinned DS row and Trash row with today's `/_api/sync/trash` list;
  - Canvases › Advanced (hidden files, refresh, count, Trash link);
  - the `CAPABILITY_HOMES` table for D4/D5.
- V2-4.6:
  - ⌘K render model (`client/v2/search/search-model.js`) over the registry, MODE_TOOLS, Settings and `/_api/index?q=`;
  - the "?" sheet (`help-model.js`).
- V2-2.17:
  - index service and `index/match.ts`, the one matcher (`fold`, every word, one-edit typos);
  - thumbnails `thumb({at})` on the capture origin.
- V2-3.3: `home/user-state.ts`, the only writer of `_pins.json` / `_recent.json`, with `/_api/pins`.
- V2-3.x Rust:
  - `index_search` for project windows, scoped to the same profile minus the caller;
  - `relink_project`, Home-only.
- V2-3.x tabs:
  - own tab strip, relaunch restoring the tabs, notifications, deep links parked per tab;
  - "?" with ⌘1–⌘9 tab keys.
- V2-2.4b: verbs `maude design history list|show|diff|restore|undo` (synced rows plus a git fallback).
- `history.open` ⌥⌘H already opens today's Git panel.

## 2. Open questions resolved, and cross-lane contracts

| # | Decision | Why |
| --- | --- | --- |
| Q1 | **Owner of the op-log foundation is S5.1** (plan-s5 agreed 2026-10-18). This covers the local in-process kernel plus store over `bun:sqlite` at `_state/project-store.sqlite`, the V2-1.9 §5.3 four conditions (machine stamp with a foreign store opened read-only, `project-store.lock`, a baseline `migration.import` per canvas, the gzip codec), the same `acceptedHistory/acceptedVersion/acceptedRestore/acceptedUndo` surface on `ctx.syncControl.current()` for local projects, and watcher writes as `kind 'outside'`. S1 builds none of it. | One kernel serves S1, S2 and S5. S5 runs first on L3. |
| Q2 | **Trash is derived from the store, not a new store.** A canvas in the trash is a `docs` entry with `retired=1 AND moved_to IS NULL`; its delete effect gives who and when. An artboard in the trash is an action of `kind 'trash'` that removed it; the item is `(actionId, artboardId)`. | V2-1.9 already lists `trash` rows. A second store would drift from history. L18 filtering then equals history visibility. |
| Q3 | **Restoring a canvas from the trash is a new additive kernel op, `trash.restore { entry }`.** It revives the same `entry` (its links, history and pins continue) at the original path. If that path is taken it uses "<name> 2", the same rule as today's `restoreFromTrash`. Restoring an artboard is V2-1.9 §5.8 "Restore only <artboard>", taken from the revision before the trash action. | A plain `doc.create` would mint a new entry, which breaks deep links (Q6) and history. One splice path for both. |
| Q4 | **Clear-out is the additive kernel op `trash.clear { items }`** plus the additive table `trash_cleared (entry, artboard, rev, by, at)`. It needs `delete` (owner) and the hub checks it per op. The studio has `POST /_api/trash/clear`: local project = owner; linked = propose. The hub door `POST /api/trash/clear` (V2-1.7 §5.6) is the same op. Cleared items leave the Trash for everyone, and Restore is refused with `cleared`. **The per-Mac `_trash/` copies and the hub quarantine for those items are deleted. Store lane bodies stay** until the pruning DDR, which must prune cleared items first. | V2-1.9 §5.15: "v2.0 deletes no version". The dialog promise "Restore can't bring them back" holds in every surface. **Ask Michal** whether "go for good" must also purge store bodies. Default: no, as above. |
| Q5 | **Today's per-Mac `_trash/` list** (conflict losers, sync quarantine, migration copies) is not in the shared Trash. It moves to Canvases › Advanced › "Kept on this Mac", with today's Restore and the ≥ 1-day prune unchanged. | It is not shared state (L18: "reflects only that Mac's own copy"). Nothing is deleted from the UI. |
| Q6 | **The stable canvas link id is the kernel `entry`**, which survives a move or rename (`store-core.mjs` `docs.entry`). The link shape is `…/c/<entry>#<artboardId>`; `maude://open?project=<pid>&c=<entry>&a=<artboardId>` is the app link. | Rejected: a new `id` in `.meta.json`. That is a versioned field, needs the migrator, and risks a peer write race. The entry already exists in every project once S5.1 lands. |
| Q7 | **Pins** use the existing `/_api/pins` (per user, cross-project, V2-3.3). **Sort and "Folders on top"** are a per-project, per-Mac UI pref in `ui-prefs.ts`, keyed by project id and never by port (inventory: the prefs-follow-port bug). | The pins owner exists. Sort is a view pref (`agent: human view-pref`). |
| Q8 | **Panel search** calls the server matcher `/_api/index?q=` (debounced like ⌘K), with a scope of this project's canvases and artboards. | One matcher (V2-1.17 §5.7). Marks come from the same `scoreRow`. |
| Q9 | **⌘K from a project tab opens a result in another project** through a new caller-checked Tauri command, `open_search_result({pid, canvas, artboard?})`. It accepts only a `pid` that is in `index_scope(caller)`, and it switches to the tab or opens one (open-once). | Rejected: routing through Home. Home may not be front, the hop costs a window flash, and the scope check already lives next to `index_search`. |
| Q10 | **Viewing a version** = the shell loads `?sha=<ref>` into the canvas iframe and holds the mode at `viewing` with `at: ref`. Esc returns to now. | V2-1.9 §5.6, reusing the `viewing` mode that already exists. It needs the S3 mode-store hold (patch request below). |
| Q11 | **`pn-home` and `pn-home-search` belong to S6** (Home page design). **`pn-ds` belongs to S10** (its scope names the pinned DS row: two lines, empty "Make a design system", the inspector "Uses …" link). S1 keeps the slot and ⌘K hits. | Each package builds its own topic owner's surface, and the evidence lands with the code that draws it. |

**Cross-lane contracts (write before the slices that need them):**
1. **`S5-kernel-foundation.md`** (S5.1, L3). S1.6, S1.7, S1.12, S1.13 and S1.18 consume it. S1.6 must not touch `kernel.mjs` / `store-core.mjs` while S5.1 or S5.2 is open.
2. **`S1-trash.md`**, written by S1 as the first step of S1.6. It fixes:
   - the artboard-trash action shape (one proposal, `kind: 'trash'`, `label: "Moved “<label>” to the trash"`, the removed artboard id in the action's origin `trashed: [{ artboard, label }]`);
   - `trash.restore` / `trash.clear` and the item ids.

   Consumers:
   - **S2**: ⌫ on an artboard lands this action (C17);
   - **S9**: the `co-trashed` banner and the L18 canvas-only filter;
   - **S12**: the `/design:trash` command.
3. **V2-1.7 access module (S9 hub, L4):** `can()`, `/api/access/me` and the access-change signal. Before it lands, S1.7 gates on `role-matrix.mjs` `delete` (owner-only today). S1.20 waits for the signal.
4. **Bridge `reveal-artboard { artboardId, glide: boolean, flash: boolean }`.** The lead adds it to the `dgn` table; the L1 owner adds the `canvas-lib.tsx` handler (camera glide, flash, reduced motion → jump). S1.3 and S1.18 use it. Until it lands, they fall back to today's `select-by-id {artboardId}` without the glide.

## 3. Slices

Paths are relative to `apps/studio/` unless prefixed. "Lead PR" lists the patch requests (registry ids, routes, bridge,
runtime-state, shared files) the slice sends instead of editing.

| id | title | artboards made verifiable | files owned | lead PR | model | deps | done-when | red-first tests | e2e / scenario | turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1.1 | Canvases panel at scale: tree rows from the index (folders + counts + badges as row meta), Pinned group, hover pin toggle and ⋯, Sort menu (Recently opened / Name / Kind + Folders on top), virtualised for 93+ canvases, keyboard nav kept, empty folder ("Nothing in 2027 yet." + New canvas in 2027) | 11/pn-organise · 01/cf-big-tree | `client/v2/canvases/{canvases-panel.jsx,tree-model.js,sort.js,use-pins.js,canvases.css}`, the Canvases-tab mount in `client/v2/left-panel/*` | registry `canvases.pin`, `canvases.unpin` (minRole view: pins are per user), `canvases.sort` (human view-pref); `ui-prefs.ts` key `canvasesSort` per project id; `nothing-deleted.json` rows for the Files panel | sonnet | — | 93-canvas fixture: rows virtualised (≤ 60 DOM rows), sort persists per project across a relaunch, pin round-trips `/_api/pins`, `CAPABILITY_HOMES` D4/D5 green, testids `canvas-list` / `canvas-row-<slug>` re-emitted | `v2-canvases-tree-model.test.ts` (sort, folders-on-top, counts in words), `v2-canvases-prefs-by-project.test.ts` (fails on port-keyed prefs) | rewrite `file-tree-move.e2e.ts` hooks only if testids change (they must not) | 120 |
| S1.2 | Move and rename in place + row menu: drag onto a folder ("Move here"), double-click inline rename (↵ / esc, CONTRACT copy), Move to… sheet, row menu Open · Pin · Rename · Duplicate · Move to… › · Copy link · Move to trash; toast "“ahoj” moved to the trash." [Undo] | 11/pn-move | `client/v2/canvases/{row-menu.jsx,inline-rename.jsx,move-sheet.jsx,use-move.js}` (reuses `use-tree-drag.js`, `/_api/fs-move`, `DELETE /_api/canvas`) | registry: `canvas.rename` repointed to inline; `canvas.copy-link` (view; uses S1.18's resolver, a stub until then); `canvas.trash` (edit, cap `trash`), plus their agents (`file` move/rename and the S1.17 verbs); remove the `window.prompt` rename binding in the same commit (rule 13) | sonnet | S1.1 | rename refuses a taken name inline; drag into a folder moves canvas + sidecars; Undo of the move-to-trash toast restores; G0-D/D5 closed | `v2-canvases-rename.test.tsx` (↵ / esc / collision), `v2-canvases-trash-toast.test.ts` | `file-tree-move.e2e.ts` → `canvases-move.e2e.ts` (drag + inline rename) | 100 |
| S1.3 | Panel search + artboard jump list: search field (accent folding, typos, artboards, marks in meta "artboard in **LetakA6**"), canvas row disclosure listing artboards with kind glyph + current highlighted, foot "21 artboards · 19 digital, 2 print", click → glide + flash; a big canvas opens fit to view | 11/pn-jump · 01/cf-panel-search · 01/cf-open-big | `client/v2/canvases/{panel-search.js,jump-list.jsx}` | dgn `reveal-artboard` (lead) + the canvas-lib handler (L1); `view.jump-artboard` takes `{artboardId}` | sonnet | S1.1 (+ reveal-artboard, fallback allowed) | typing "treneri" finds "Trenéři"; an artboard hit expands its canvas; the click posts `reveal-artboard`; reduced motion jumps | `v2-canvases-search.test.ts` (marks map back to unfolded text), `v2-jump-list.test.tsx` (counts per kind, `dynamic` canvases say so) | — | 100 |
| S1.4 | ⌘K words: per-word marks incl. meta, close-matches note + quiet weak rows + "4 close matches", "Nothing called “x”." + Did you mean, day-one state (Recent empty line + Start here), Ask AI row text per query, DS hits in canvases/sections | 11/pn-k-close · 01/cf-search-k (builds 05 es-search-k / es-search-more copy, rows stay S11's) | `client/v2/search/*` (S1 owns from now) | registry `search: { hidden }` field (V2-4.6 asked); `help.group` fields | sonnet | — | "unifromy" shows the close-match note for uniformy; zero hits shows the CONTRACT line; ⌘↵ runs Ask AI; rule `nothing-found` evidenced | `v2-search-close.test.ts`, `v2-search-empty.test.ts` (copy pinned to CONTRACT §4) | — | 110 |
| S1.5 | ⌘K across projects: groups by project once 2+ answer (square header, "this tab" / "in another tab" / "not open — opens a tab"); ↵ switches tab or opens it then goes to canvas/artboard | 11/pn-k-across | `apps/desktop/src-tauri/src/home.rs` (`open_search_result`), `client/v2/search/search-projects.js` | Tauri capability + command scan entry; `windows.rs` caller-check list (lead or L4 review) | **opus** (Rust/Tauri, cross-project scope = security) | S1.4 | a pid outside `index_scope(caller)` is refused (test); open-once honoured; results never include the caller's own project twice | `cargo test open_search_result_scope` (planted out-of-scope pid → red), `v2-search-projects.test.ts` | `project-tabs.e2e.ts` + one ⌘K-across step | 80 |
| S1.6 | Kernel additive ops: `history.name` + `names` table, `history.aside`, `trash.restore`, `trash.clear` + `trash_cleared`, per-op role gate (`edit` / `trash` / `delete`); writes `S1-trash.md` first | — (feeds pn-history, pn-trash) | `apps/hub/src/project-transactions/{kernel.mjs,store-core.mjs}` additions only, `apps/hub/test/kernel-history-name.test.mjs`, `…/kernel-trash.test.mjs`, `client/v2/contracts/S1-trash.md` | the hub release train (V2-2.18 pattern: additive, v1-compatible, a hub release before any rc); a v2 studio facing an old hub shows "Naming versions needs the team server to be updated" | **opus** (versioned store + kernel semantics + roles) | S5.1 (and after S5.2: same files) | a v1 client against the new hub passes the team-project lane; `trash.clear` by a member → refused; names snap to the newest revision that changed the doc | kernel conformance corpus with both codecs; `access-trash-clear.test.mjs` (V2-1.7 §7 row) | `team-project.e2e.ts` (v1 client) unchanged green | 130 |
| S1.7 | Trash service + routes: derive items (canvases + artboards, who/when, Today/Earlier), restore (canvas via `trash.restore`, artboard via S1.13's splice), clear-out; legacy-hub fallback; the per-Mac list rehomed under Canvases › Advanced › "Kept on this Mac" | — (feeds pn-trash) | `history/trash.ts`, `routes/trash.ts` (the factory) | route table: `GET /_api/trash`, `POST /_api/trash/restore`, `POST /_api/trash/clear` (main origin only, never canvas-safe); hub `POST /api/trash/clear` + hub manifest; registry `trash.restore` (edit, cap `trash`), `trash.clear` (owner, cap `delete`); `view.trash` unchanged | **opus** (roles/ACL, L18) | S1.6 | an editor's clear → 403 server-side (hidden ≠ refused); canvas-only session sees only its canvases (`acl-l18-trash.test.ts`, project-level until S9's `sees()`); cleared → restore 409 `cleared` | `acl-l18-trash.test.ts`, `trash-derive.test.ts` (retired + trash actions; moves are not trash) | — | 120 |
| S1.8 | Trash view client: "‹ Trash · 3 canvases · 1 artboard", Today / Earlier, row subs ("artboard of Combine-kampan · Jonas, 14:05"), hover Restore (primary), foot "Kept until you clear it out." + Clear out… (owner only), dialog title = verb, empty "Trash is empty." | 11/pn-trash (+ 05 es-panels-make Trash part) | `client/v2/left-panel/{trash-view.jsx,use-trash.js}` rewritten onto `/_api/trash`; `client/v2/canvases/kept-on-this-mac.jsx` | — | sonnet | S1.7 | testids `canvases-trash*` kept; rule `moved-to-the-trash` evidenced; editors see Restore only | `v2-trash-view.test.tsx` (owner vs editor vs viewer controls; copy) | new `trash.e2e.ts` (default lane: move → restore → clear out) | 80 |
| S1.9 | `describeChanges` — TSX lane: parse (oxc, comments blanked), artboards (families), element matching (data-cd-id → identical subtree → LCS → mutual best → move pass), declarations via the reference closure, canvas frame, words grammar §5.5.2 | — | `history/describe.ts`, `history/describe-words.ts`, `history/describe-match.ts`, `test/fixtures/describe-corpus/*` | none | sonnet | — (pure) | the rebuilt corpus scores ≥ 96 % right on the synthetic edits, "Changed this canvas" only for unattributable module code, p95 ≤ 50 ms on the largest v2 canvas (the prototype was never committed: rebuild it from §5.5 + §6) | `describe-tsx.test.ts` (grades W1/W2/F per kind), `describe-budget.test.ts` | — | 140 |
| S1.10 | `describeChanges` — CSS / meta / annotations lanes, collapsing (> 12 lines → "Reworked …"), row titles §5.5.4, the attribution-cache entry per `(actionId, canvas)` | — | `history/describe-css.ts`, `history/describe-meta.ts`, `history/titles.ts`, the cache extractor beside V2-1.17's | runtime-state: confirm the cache path is under an already-classified prefix (V2-2.16), else the four-list patch | sonnet | S1.9 | viewport / `last_modified` never count; a canvas-only session's words never name another canvas | `describe-lanes.test.ts`, `describe-titles.test.ts` (CONTRACT voice) | — | 110 |
| S1.11 | Historical build overlays: `BuildCanvasOptions.overrides` (version's same-name CSS), shell injects `__canvas_meta__` from `metaAt(ref)`, cache key `(path, ref)`, thumbnail key `thumb/2` | — (feeds pn-history pictures, pn-compare) | `canvas-build.ts` (overrides), `thumbs/keys.ts` | `http.ts` `serveHistoricalCanvas` + meta injection (lead); capture-origin behaviour unchanged (307 rule) | **opus** (canvas-origin security, cache keys) | — | a version whose CSS differs renders its own CSS; `?sha=` still refused on the main origin; thumbs of two versions differ | `historical-build-overrides.test.ts` (old CSS used), `acl-l21-capture.test.ts` stays green | — | 70 |
| S1.12 | Versions + changes + name routes: rule G rows reducer, Now row, filters All · Named · Made by AI · People, paging, the §5.2 source table (local, git, linked, cloud tab, legacy git fallback), §5.12 access | — (feeds pn-history) | `history/versions.ts`, `history/changes.ts`, `client/v2/history/rows.ts` (pure reducer shared by both sides), `routes/history.ts` | move `/_api/project/{history,restore,undo}` from the `http.ts` legacy literal into `routes/history.ts`; new `GET /_api/project/versions`, `GET /_api/project/changes`, `POST /_api/project/name`, `POST /_api/project/aside`; registry `history.filter`, `history.view-version`, `history.compare`, `history.name` | **opus** (route-table semantics, access per role) | S1.6, S1.10 | Can view gets rows but `history show` raw source → 403; legacy hub answers git rows; offline answers "Offline — showing versions up to 14:05" | `history-rows-rule-g.test.ts` (10-min / 60-min / name split / other actor), `history-routes-access.test.ts` | — | 130 |
| S1.13 | Restores: one artboard (`restoreArtboard` splice, `sharedKept`, 409 reasons), one object, Go back to `lastGood` (`_state/render-ok.json`), a version not kept (`aside`); the restore toast with Undo | — (feeds pn-compare, S6 cf-render-error) | `history/restore-artboard.ts`, `history/restore-object.ts`, `history/last-good.ts`, the extended restore handler in `routes/history.ts` | registry `history.restore`, `history.restore-artboard`, `history.restore-object`, `history.go-back`; `_state/render-ok.json` is under `_state` (classified) | **opus** (writes canvases through proposals, sync planes) | S1.12 | each restore is a new version; a family artboard → "Can't restore only <label> — restore the whole canvas instead."; p95 ≤ 150 ms splice | `restore-artboard.test.ts` (shared declarations kept + listed), `restore-sync-both-directions.test.ts` (memory: test both directions) | — | 120 |
| S1.14 | Version history panel: ⌥⌘H opens it (repoint `history.open`), header, filters, Today / Yesterday / date groups, rows with pictures (`thumb({at})`, skeletons), chips, Now row + Name this version…, click → Viewing bar "Viewing “…” · 5 Oct, 18:40 · Jonas · esc back to now", Restore this version, empty "Versions appear here as you work." | 11/pn-history (+ 05 es-panels-canvas Version history part) | `client/v2/history/{history-panel.jsx,use-versions.js,view-bar.jsx,name-dialog.jsx,history.css}` | registry `history.open` effect → the new panel; dock panel id kept for testids; S3 mode-store hold `viewing{at}` (patch to S3/lead); `nothing-deleted.json` GitPanel rows → v2 homes | sonnet | S1.11, S1.12, S1.13 | Viewing is read-only (no tools, AI or locks); esc returns; Can view sees no Restore | `v2-history-panel.test.tsx`, `v2-history-viewing.test.ts` (mode held, esc returns) | new `version-history.e2e.ts` (name → view → restore → Undo) | 130 |
| S1.15 | Compare: A/B marks, two read-only iframes Side by side / Overlay, change list in words with who/when (blame), summary line, why-line, Stop comparing · Restore only <artboard> · Restore this version; Version history › Advanced slot = today's git body (S11 rewords) + "Compare pictures" (DiffView) | 11/pn-compare | `client/v2/history/{compare-view.jsx,change-list.jsx,blame.js}`, the Advanced fold mount | registry `history.compare-pictures`; `history.restore-artboard` UI path | sonnet | S1.14 | blame names the newest row in (A, B] with the same change key, else no face; G0-D/D10 rows mapped (closed with S11's Advanced body) | `v2-compare-blame.test.ts`, `v2-compare-view.test.tsx` | `version-history.e2e.ts` + compare + restore-only; `git-lifecycle.e2e.ts` re-pointed to Advanced (with S11) | 120 |
| S1.16 | Object-scoped history: derive by `ElementRef` / annotation id from the cached descriptions, chained matching that stops on ambiguity ("found by matching"), header "· this object", Restore per row; `openHistory({ element })` API for S2's object menu and S4's sticky menu | — (10 co-vh is S9's row) | `history/object-history.ts`, `client/v2/history/object-filter.js` | registry `history.object` (view), the entry points are S2 / S4 menu items calling it | sonnet | S1.12, S1.13 | 100 versions cold ≤ 2 s; a Can view person opening it causes no write (stamp queued only for edit roles) | `object-history.test.ts` (matching stops on no mutual best) | — | 80 |
| S1.17 | Surface = substrate: verbs `maude design history list|show|diff|object|restore --artboard/--element|name`, `maude design trash list|restore|clear`, the skill/format sections and the actions manifest; UI path ≡ verb path contract tests | — | `cli/commands/design.mjs` history/trash family, `bin/history.sh` / `bin/trash.sh`, `plugins/design/skills/design/*` sections | `actions.manifest.json` regen (lead), verb tiers (`clear` destructive → prompt) | sonnet | S1.7, S1.13 | parity coverage test ratchets down; `/design:rollback` still reads `_history/` (S12 rebases it) | `maude-verbs-history.test.ts` extended, `maude-verbs-trash.test.ts` | — | 90 |
| S1.18 | Deep links: `canvasLink(entry, artboard?)` + `GET /_api/link/resolve` (entry → current path, survives move/rename), `#<artboardId>` anchor → glide + flash, comment opened by id, toast "Opened from Tereza's link — Pozvánka · story."; Copy link in the row menu goes live | 11/pn-deeplink | `history/links.ts` (resolver), `client/v2/canvases/open-link.js`, `apps/desktop/src-tauri/src/deep_link.rs` anchor parsing | route `GET /_api/link/resolve` (main origin); `reveal-artboard` + `comment-focus` bridge use | **opus** (deep links, cross-window routing) | S1.3, S5.1 | a link minted before a move opens the moved canvas; an unknown entry → "This canvas isn't in Alligators brand any more."; the parked-link security tests stay green | `link-resolve.test.ts` (move, rename, trashed → Trash), `cargo test deep_link_anchor` | `share-link.e2e.ts` + artboard anchor step | 110 |
| S1.19 | Moved folder: the in-tab card ("Portfolio 2026 isn't where it was." / Find the folder… / "Closing the tab keeps it on Home.") when a tab's root is gone; Find the folder… relinks from that tab (keeps pid binding, profile, recents) | — (first half of pn-cant-open) | `apps/desktop/src-tauri/src/{tabs.rs,home.rs}` root-missing path + an app-local card page (`apps/desktop/src/root-missing.html`) | capability for the card page; `relink_project` caller widened to "the tab whose root is missing" (security review) | **opus** (Rust/Tauri, caller checks) | — | renaming a project folder on disk shows the card instead of a dead tab; relink restores the tab | `cargo test relink_from_missing_tab_only` (other tabs refused) | `home.e2e.ts` + moved-folder step | 90 |
| S1.20 | Access removed + now Can view: card over the dimmed canvas ("You no longer have access to …" / Back to Home), Can view tip card + Ask to edit in the Share cluster + toast "Tereza changed you to Can view. Your changes were saved first." | 11/pn-cant-open | `client/v2/canvases/access-states.jsx`, entries in `client/v2/shell/callouts-model.js` | none (consumes S9's access-change signal + flush-first) | sonnet | S9 hub (V2-1.7 §5.9), S1.19 | role downgrade arrives while a change is unsent → the change lands first, then the card | `v2-access-states.test.tsx` (order: flush, then card) | `team-project.e2e.ts` + downgrade step (with S9) | 70 |
| S1.21 | Phase 3 rows: evidence against V2-3.7 own strip (A/B decision artboards record the pick and decision ids), tab menu, windows, accounts card, relaunch resting, switch-while-AI; "?" sheet groups "Tabs and windows" / "Finding a canvas" + "Find a shortcut" search; gaps found → lead | 11/pn-tab-a · pn-tab-b · pn-tab-a20 · pn-tab-b20 · pn-ab · pn-tab-menu · pn-windows · pn-accounts · pn-switch-ai · pn-relaunch | `client/v2/search/help-model.js` groups, `.ai/plans/notes/v2-evidence/S1.21-*.txt` | registry `help.group` on `tab.*`, `search.open`, `project.open`, `history.open`; rule `project-tabs` evidence | sonnet | — | every listed row `verified` with hash-pinned evidence or a named gap row in the Progress log | `v2-help-groups.test.ts` | relaunch / tabs / tabs-identity lanes as evidence (valid-window probe) | 80 |

## 4. Ledger coverage

**`S1 (+P3)`: 23 rows of canvas 11**
- 20 rows have an S1 slice:
  - S1.1 `pn-organise`
  - S1.2 `pn-move`
  - S1.3 `pn-jump`
  - S1.4 `pn-k-close`
  - S1.5 `pn-k-across`
  - S1.8 `pn-trash`
  - S1.14 `pn-history`
  - S1.15 `pn-compare`
  - S1.18 `pn-deeplink`
  - S1.20 `pn-cant-open`
  - S1.21: `pn-tab-a`, `pn-tab-b`, `pn-tab-a20`, `pn-tab-b20`, `pn-ab`, `pn-tab-menu`, `pn-windows`, `pn-accounts`, `pn-switch-ai`, `pn-relaunch`
- 3 rows are assigned elsewhere (Q11):
  - `pn-home` and `pn-home-search` → **S6**, which redraws Home;
  - `pn-ds` → **S10**, whose scope names the pinned DS row.

**`S6, S1, S5`: 20 rows of canvas 01**
- 4 rows are S1's, all in the "finding" section:
  - S1.1 `cf-big-tree`
  - S1.3 `cf-panel-search`, `cf-open-big`
  - S1.4 `cf-search-k`
- The other 16 rows are not S1's:
  - **S5** (AI runs and the undo of a run): `cf-ai-drafting`, `cf-ai-done`, `cf-undo-before`, `cf-undo-ai`.
  - **S6** (first canvas, working and edges, composed from S2/S4/S9 surfaces): `cf-home-prompt`, `cf-select-tweak`, `cf-sticky-comment`, `cf-blank`, `cf-add-artboard`, `cf-duplicate-width`, `cf-duplicate-done`, `cf-frames-text`, `cf-busy`, `cf-status-words`, `cf-render-error`, `cf-offline-create`.
  - `cf-render-error` uses S1.13's `history.go-back`.

**05 nav empties** (rows `S11 (+ owners)`, so S11 verifies them). S1 builds these parts:
- `es-panels-canvas`: empty folder (S1.1), Version history before the first change (S1.14);
- `es-panels-make`: the Trash part (S1.8);
- `es-search-k` and `es-search-more`: ⌘K parts (S1.4). The Assets no-hits part is S8's.

**Rules S1 closes:**
- `00/rule/moved-to-the-trash` (S1.8)
- `00/rule/nothing-found` (S1.4)
- `00/rule/project-tabs` (S1.21)

**Home rows:**
- **G0-D/D4** (keys: ⇧⌘R, hidden files, DS pinned row, ⌘N new board): S1.1 keeps the `CAPABILITY_HOMES` table green and closes the row.
- **G0-D/D5** (Files panel): S1.2 closes it after S1.1–S1.3.
- **G0-D/D10** (Git panel → Version history + Advanced): S1.15 maps it. It closes with S11's Version history › Advanced body.
- **G0-D/D11**: the deep-link half is S1.18. The row closes with S11 (Settings › Connections) and S9 (sign-in sheet).

## 5. Risks and run order

**Risks**
1. **The foundation is on L3.** History rows for local projects, trash derivation and stable links all wait on S5.1. Mitigation: S1.1–S1.5, S1.9–S1.11, S1.19 and S1.21 need no kernel and run first. S1.12 can be built and tested against the linked runtime and a fake store, then switched on once S5.1 lands.
2. **Kernel file contention.** S5.1, S5.2 and S1.6 all edit `kernel.mjs` / `store-core.mjs`. The lead serialises them: S5.1 → S5.2 → S1.6. The hub-side ops also need a hub release before any v2 rc.
3. **The describer prototype is gone.** V2-1.9 §6 cites an uncommitted `scratch-v2-spike/`. S1.9 rebuilds it from the spec and must re-measure: ≥ 96 % right on the synthetic edits, and the §5.16 budgets.
4. **Clear-out wording vs retention (Q4).** If Michal wants store bodies purged, S1.6 grows a body-purge path behind `delete`. That is still additive.
5. **Camera glide is L1's.** If `reveal-artboard` slips, S1.3 and S1.18 ship the jump without the glide, and their evidence waits.
6. **Viewing hold is S3's.** S1.14 needs the mode store to keep `viewing{at}` against canvas `mode-request`s.
7. **Rust slices** (S1.5, S1.18 part, S1.19) touch `home.rs` / `deep_link.rs` / `tabs.rs`. They run one at a time, each with a security review pass.
8. **Dist and bundles:** every client slice rebuilds release-minified and runs `git status apps/studio/dist/` before and after `bun test` (standing rule 6). Tests run only through the single test lane.

**Run order** (separate worktrees only where the owned files are disjoint):
- **Wave 1, in parallel:**
  - S1.1 (`client/v2/canvases/*`)
  - S1.4 (`client/v2/search/*`)
  - S1.9 (`history/describe*`)
  - S1.11 (`canvas-build.ts`, `thumbs/keys.ts`)
  - S1.19 (Rust)
  - S1.21 (`help-model.js` + evidence). It touches `client/v2/search/help-model.js`, so it runs after S1.4 or rebases onto it. The files differ (`help-model.js` vs `search-model.js`), so it can be parallel with care.
- **Wave 2:**
  - S1.2 → S1.3: serial, same panel files.
  - S1.10 after S1.9.
  - S1.5 after S1.4 and after S1.19 (Rust serial).
- **After S5.1 (→ S5.2):** S1.6 → S1.7 ∥ S1.12. They are disjoint: `history/trash.ts` + `routes/trash.ts` vs `history/versions.ts` + `routes/history.ts`.
- **Then:**
  - S1.13 after S1.12;
  - S1.8 after S1.7 and S1.13 (an artboard restore uses the splice);
  - S1.14 after S1.11, S1.12 and S1.13;
  - S1.15 and S1.16 after S1.14;
  - S1.18 after S1.3 and S5.1;
  - S1.17 last of the server slices.
- **After S9 hub:** S1.20.

Estimated total: ~2,180 builder turns over 21 slices.
- Opus: S1.5, S1.6, S1.7, S1.11, S1.12, S1.13, S1.18, S1.19.
- Sonnet: the remaining 13.
