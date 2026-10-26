# S3 — Modes & Present: slice plan

Phase 5 planning spike, wave A, lane L1 (runs first on L1). Plan row: `.ai/plans/feature-maude-v2-redesign.md`
§ Phase 5 "S3 Modes & Present". Canvas: `.design/ui/v2/04 Modes.tsx` (26 artboards). Inventory:
`.ai/plans/notes/v2-inventory/B-ai-modes-empty.md` § 04 Modes. Contracts built on: `V2-1.2-mode-toolbars.md` (mode
state machine, §5.4 table, A8 hold, `present-*` messages), `V2-1.12-file-formats.md` (R6, reserved `present` /
`artboardMeta` / `links` keys), `V2-1.4-element-ids.md` (`data-cd-*` canvas-only namespace), `V2-4.9-shell-parity.md`.
Gate 0 rows: A7 (switch + keys), **A8 (override: AI live in Preview, also under the pointer; Present lands on
move-on)**, B1 (links, presenter view, presentation link, notes + order in), C30 (no AI panel for viewers), C31
(order: canvas order unless set; notes + order + skip in `.meta.json`, versioned).

## 1 · Scope recap and what Phase 4 already ships

S3 builds: the Present half of the mode state machine (Present · Artboards one by one; Present · Canvas restyled),
Preview's own chrome (PreviewBar, ZoomOnly, folded pill, Edit → Preview camera ease), Preview link playback
between artboards and canvases with back, Inspect (⌘-click in Preview, plain click in Viewing) + ⌥ measure gating,
the kind-aware Present stage (video autoplay, fit rules, skipped excluded from the counter), presenter view on a
second display, Order and notes…, the presentation link with Live / Catch up / watchers, offline presenting, the
what-shows-per-mode table, the esc ladder end to end, and the A8 hold in Present.

**Already on `feat/maude-v2` (do not redo):**
- `bridge/canvas-modes.ts`: `CanvasModeV2`, `PresentSpec`, `ModeCaps`, `baseMode`/`initialMode`/`clampMode`,
  `MODE_TOOLS` (Present = hidden, no slots), `escStep` (Present → `back`), `homeModeOfTool`, `V1_TOOL_BRIDGE`
  (`inspect → move`, S3 retires it), `pendingSlots` (S2 only). **Missing:** `holdsModuleUpdates`, `pointer` slot.
- `bridge/dgn-protocol.ts`: `set-mode` / `mode-changed` / `mode-request` live (V2-4.3b); `present-position` (c2s)
  and `present-step` (s2c) declared `status: 'proposed', owner: 'S3 present'`.
- Shell: `client/v2/shell/canvas-mode.js` (store, caps, `modeSegments`), `mode-switch.jsx` (Present ⌄ menu with
  only "Present the canvas"), `share-cluster*.jsx` (compact in Preview), `panel-layout.js` (`folded` in Preview),
  `use-canvas-mode-lane.js` (insets flushed before `set-mode`), toolbars + `ToolbarMorph` (`tool-palette.tsx`).
- Present today = DDR-117 shell Present: a **second** mode source (`use-shell-core.jsx` `presentMode` boolean,
  `togglePresent`/`exitPresent` in `use-photo-and-timeline.jsx`, `.maude.is-present`, the `pv-present-exit` button
  in `app.jsx` ~2970, `view-chrome {present}` broadcast). Canvas posture `present → preview/browse` (`V1_POSTURE`).
- Registry: `mode.preview` (⌥⌘P), `present.canvas` (no key, View menu), agent `maude design open --mode present`.
- `measure-overlay.tsx` (⌥ hover distance, one selection), v1 Inspect tab (`client/inspector/inspector-panel.jsx`),
  `participants-chrome.tsx` Follow over collab awareness, `client/embed-view.jsx` (separate root, `NO_CAPS` preview).
- **Not built:** PreviewBar, ZoomOnly, Present · Artboards, presenter view, Order and notes, presentation link,
  links, the Inspect panel, the A8 hold. `04 Modes` still carries the pre-A8 wording (md-model row, md-edge-ai).

## 2 · Open questions resolved here

| # | Decision | Why (one line) |
| --- | --- | --- |
| D1 | **One mode owner.** `presentMode` stops being state; it is derived from `canvasMode.mode === 'present'` with `present: PresentSpec`. `togglePresent`/`exitPresent` become thin calls into the lane | V2-1.2 rejected two owners; V2-4.3b kept DDR-117 Present only "until S3" |
| D2 | **On-click links are a canvas-only attribute** `data-cd-link="<canvas rel>#<artboardId>" \| "#<artboardId>" \| "https://…"` on an element with a `data-cd-id`. One TSX write (stamp + link) = one undo step. `.meta.json` `links` stays reserved, unused | V2-1.4 namespace (AI keeps it, `stripCanvasOnly` removes it on export); meta keyed by id would need two writes and dangles on rewrites. Agreed with S2 (plan-s2, 2026-10-18) |
| D3 | **Link playback is resolved by the trusted shell.** The canvas posts `link-follow {elementId}`; the shell reads the target from the versioned TSX via a main-origin read route; canvas targets must exist in the project; http(s) only, opened behind a trusted confirm | the canvas origin is untrusted (DDR-054): it never hands the shell a URL |
| D4 | **On hover is S2's** (a style, written by S2's words → CSS writer, format in `S2-interaction-format.md`) | Preview plays real CSS; no S3 runtime |
| D5 | **Present order** = canvas order computed in the iframe from live artboard world rects (rows banded at ½ the smallest artboard height, left → right), overridden by `meta.present.order`; `meta.present.skip[]` drops artboards from the run and the counter | C31; the live rects also cover auto-grid canvases with no stored positions |
| D6 | **Present fit by kind** (pure `present/fit.ts`): `web` fills the width, starts at top, wheel scrolls inside it · `print` fits the trim, bleed off-screen, print guides follow C25 · `digital`/`video` contain on the dark stage (9:16 pillarboxed, banner letterboxed, 1:1 fit height, never cropped) | md-edge-mixed, "no settings, a rule per kind" |
| D7 | **A8 hold = whole-module hold** in `_shell.html`'s HMR applier while `mode==='present' && present.kind==='artboards'`; newest only; applied on `present-position` change or exit, before the next artboard renders. Preview and Present · Canvas apply live | V2-1.2 §5.4; only one artboard is on screen |
| D8 | **Present writes go through their own route**, `PATCH /_api/present-meta` (main origin only, `minRole: edit`, refused read-only, schema-checked), never through `/_api/canvas-meta` | `/_api/canvas-meta` is in `CANVAS_SAFE_API` + `READ_ONLY_ALLOWED_WRITES` (it gates only `layout`), so adding a lane there would hand the untrusted canvas and a viewer a versioned write |
| D9 | **One follower transport.** The presenter's canvas publishes `present {index,total,artboardId,seq,media}` on its collab awareness; the local audience window and remote link viewers are both *followers* rendered by one separate root `client/v2/present/follow-view.jsx` (`?present=follow&open=<rel>`, `&audience=1` locks it). The hub relays awareness as it already does | reuses `participants-chrome` Follow + the hub relay; no new runtime-state path, no new socket |
| D10 | **Presenter view is desktop only** (a second `audience-<pid>` window on the chosen display, no IPC capability). The row is hidden in a browser shell and with one display | no Window Management API in WKWebView/Safari; hidden ≠ greyed for absent hardware follows V2-4.9 decision 2 |
| D11 | **Copy presentation link** shows only in cloud-linked projects (⌘K lists it greyed "in a cloud project" elsewhere); `minRole: edit` to broadcast, any role with Can view on the canvas may follow | a local project has no address others can open; broadcasting is a presenter's act |
| D12 | **No new runtime-state class.** Present session, follow and watchers live in awareness memory; pre-present camera in shell memory | the four DDR-115 lists stay untouched |
| D13 | **Ledger reassignment** (§4): 7 of the 26 rows are built by S2 / S4 / S9 | their content is those packages' scope; S3 supplies only the mode they open in |

**Cross-lane contracts to write first (slice S3.0):**

| Contract file | Neighbour | Freezes |
| --- | --- | --- |
| `apps/studio/client/v2/contracts/S3-links-format.md` | S2 (Interaction section), S1 (canvas move/rename), S12 (skill doc) | `data-cd-link` grammar, `applySetLink`/`applyClearLink` signatures, `element.set-link` action, dangling-target state, `maude design check` rule, http(s) confirm + opener posture |
| `apps/studio/client/v2/contracts/S3-present-session.md` | L4 (S9 hub, Tauri), S9 (link auth, roles) | awareness `present` field + validator, follower root URL grammar, hub `GET /present/<canvas>` → studio child mapping + ACL (Can view on that canvas, signed in), watchers count, the three Tauri commands + audience window posture, offline behaviour |

## 3 · Slices

Model column: **opus** = risk class per `.ai/scenarios/maude-v2/agent-routing.md`. "Lead" = patch requests the
builder lists in its hand-back instead of editing (registry, dgn table semantics, `routes/index.ts`, `http.ts`,
`app.jsx` residue, runtime-state lists, `whats-new.json`, `dist/`, the 04 canvas + ledger hashes).

| id | title | artboards made verifiable | files owned | lead patch requests | model | deps | done-when (observable) | red-first tests | e2e / scenario | turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **S3.0** | Contracts: links format + present session | — | `client/v2/contracts/S3-links-format.md`, `client/v2/contracts/S3-present-session.md` | **Canvas 04 A8 amendment** (md-model row "What AI changes · Preview" → "Shows live, under your pointer too"; md-edge-ai note → the Present case: "lands when the presenter moves on") + ledger re-pin of `04`; V2-1.12 note: `links` reserved-unused | opus (v2-spike) | — | both contracts merged; S2 and L4 lead sign off on the team channel; kg decisions recorded | — | — | 50 |
| **S3.1** | Present in the one mode owner + A8 hold | md-edge-ai | `client/v2/shell/canvas-mode.js` (present spec, `returnTo`), `client/v2/shell/use-canvas-mode-lane.js`, `client/v2/shell/mode-switch.jsx` (menu rows: from selection, from the start, the canvas; later rows hidden until their slice), `bridge/canvas-modes.ts` (`holdsModuleUpdates`, `PresentSpec.kind` honoured, `pointer` slot data), `plugins/design/templates/_shell.html` (hold in the applier), `bridge/canvas-mode-store.ts` (snapshot exposes `present`) | registry: `present.from-selection` ⌥⌘↵, `present.from-start` ⇧⌥⌘↵ (both `when: mode ∈ edit/viewing/preview`), `present.canvas` re-pointed; View menu rows "Present ⌥⌘↵", "Present from the start ⇧⌥⌘↵" (CONTRACT §1); dgn: `present-position` + `present-step` → `live`; `use-shell-core.jsx`/`use-photo-and-timeline.jsx`: `presentMode` derived (D1) | opus (dgn + state-machine semantics) | S3.0 | ⌥⌘↵ from a selected artboard enters `present/artboards` with `from` = that id; esc returns to `returnTo`; an AI write to the canvas during Present·Artboards does not reach the screen until `present-position` changes; in Preview it lands at once | T11 `present-hold.test.ts` (happy-dom applier: held in Present·Artboards, newest only, applied on position change/exit, live in Preview and Present·Canvas); `mode-lane.test.tsx` rows for present enter/back/role clamp; a test that `presentMode` and the store can never disagree (fails against today's two sources) | — | 120 |
| **S3.2a** | Present · Artboards in the canvas: order, fit, lift, step | md-present-lift | new `present/order.ts`, `present/fit.ts` (pure), new `present/present-stage.tsx` (stage mask, lift tween `--dur-route` 280 ms, click/→/←/space step, esc → `mode-request back`, exact camera + selection restore), hooks into `canvas-lib.tsx` viewport controller only through a `usePresentStage` mount; reads `meta.present.{order,skip}` | dgn payload confirmed: `present-position {index,total,artboardId}` echo per step; `present-step {to}` honoured | sonnet | S3.1 | Present from "Post 1:1" lifts that artboard to the stage in 280 ms (1 ms with reduced motion), others sink to dark; → ← space walk canvas order, skipping `skip[]`; esc settles it back with zoom/selection/panels as before | `present-order.test.ts` (row banding, explicit order, skip, stale ids dropped); `present-fit.test.ts` (each kind of D6); `present-stage.test.tsx` (camera restored byte-equal after esc; click = next) | — | 130 |
| **S3.2b** | Present chrome in the shell: controls, canvas pill, pointer L | md-present-full, md-present-canvas, md-keys | new `client/v2/present/present-controls.jsx` (‹ · "3 / 14" · › · label · presenter-view slot · "esc to leave"; appear on move, fade after 2 s, reduced motion = hide), `client/v2/present/canvas-pill.jsx` ("Presenting the canvas · 21 % · esc to leave"), `client/v2/present/present.css`; pointer tool in `bridge/canvas-modes.ts` data + `present/pointer-dot.tsx` (ringed dot in presence colour + trail, published on awareness `pointer`) | `app.jsx` residue: mount both; retire the `pv-present-exit` button, **re-emit its testid on the pill** (testids are an API); registry `present.next`/`present.prev` (→ ← space, scope present), `tool.pointer` L (`when: mode present`) | sonnet | S3.1, S3.2a | counter excludes skipped ("of 14" for 15 with one skipped); controls are shell DOM (DDR-117) and work with the iframe focused; Present the canvas shows the pill, no chrome, no pins, esc back to the same view; L toggles the dot, peers see it | `present-controls.test.tsx` (counter math from `present-position`, fade timer, reduced motion); `shell-parity` regenerated (present row); key-uniqueness: L/→/←/space only in `present` scope | rewrite the DDR-117 present assertions in `shell-parity.e2e.ts` | 110 |
| **S3.3** | Present media and kinds | md-present-video, md-edge-mixed | `video-comp.tsx` (play on arrival with sound, click pauses, → / space move on mid-clip, 16:9 holds last frame), `present/fit.ts` web scroll + print trim wiring, `client/v2/present/present-controls.jsx` transport (pause · 0:06 / 0:15 · sound) | dgn new: `present-media {playing,t,duration,muted}` (c2s, active), `present-media-cmd {op:'play'\|'pause'\|'mute'\|'unmute'}` (s2c, parent); **L4 patch if measured needed:** wry/WKWebView autoplay-with-sound setting for project webviews | sonnet | S3.2a, S3.2b | a 9:16 reel starts with sound when its turn comes, pillarboxed; a web artboard scrolls with the trackpad inside the stage; an A4 print shows the trim only; the shell transport mirrors the clip | `present-media.test.tsx` (state echo, space skips mid-clip, last-frame hold); fit snapshot per kind | `modes-present` e2e step "video plays" (measure autoplay on WKWebView first; record the result) | 110 |
| **S3.5** | Order and notes… (format + route + sheet) | — (not drawn; exercised by md-presenter, md-present-full) | new `client/v2/present/order-notes-sheet.jsx` + `order-notes-model.js`, new `routes/present.ts` (`PATCH /_api/present-meta {file, present?, notes?}`), `present/meta-schema.ts` (strict for our writers, preserving for peers; R1/R2/R6), design-skill file-format section for `present` + `artboardMeta.<id>.notes`, `maude design check` rule (unknown ids, dup order) | `routes/index.ts` registration (`minRole: edit`, `origin: 'main'`); registry `present.order-notes` ("Order and notes…", edit); `test/format-field-rules.test.ts` fixture rows for `present` | opus (versioned format + minRole route) | S3.0 | the sheet reorders, skips and annotates; a v1 peer (H/I/J fixtures) keeps the keys; a Can comment session gets 403; the canvas origin gets 404 for the route | `present-meta-route.test.ts` (read-only refused, canvas origin absent from both allowlists, unknown key rejected, other meta keys preserved); parity test `canvas-origin-parity` still green | — | 120 |
| **S3.6a** | Tauri: displays + audience window (L4 lane) | — | `apps/desktop/src-tauri/src/present.rs` (`present_displays` → `{id,name,primary}[]`, `present_audience_open {displayId, url}`, `present_audience_close`), `windows.rs` navigation guard entry for `audience-<pid>` (pinned to its project origin + follower route), capability: **none** for the audience webview | `lib.rs` command registration; `capabilities/default.json` grants the 3 commands to project webviews only (caller label + origin re-checked in Rust); `check-bundle-completeness` unchanged | opus (Rust/Tauri, security) | S3.0 | from a project tab the commands open a full-screen window on the chosen display that only renders the follower root; a page in it has no IPC; closing the project, End, or unplugging the display closes it | Rust tests: `every_granted_command_checks_its_caller` covers the three; `audience_has_no_capability`; navigation guard refuses any other URL | `presenter-view.e2e.ts` (debug build; skips with a reason when one display) | 120 |
| **S3.6b** | Presenter view UI | md-presenter | new `client/v2/present/presenter-view.jsx` + `order-map.jsx` (order drawn as the canvas layout, numbered, current highlighted, skipped dimmed with eye-off, click to jump via `present-step {to:n}`), clock (elapsed + wall time), "Audience on <display>", End (esc), Now / Next boxes, Notes; menu row "Presenter view on another display ✓ (<name>)" | registry `present.presenter-view` (toggle, desktop only, hidden with one display; agent: human-only — needs a person and a second display); `app.jsx` residue mount | sonnet | S3.2b, S3.5, S3.6a, S3.7a | with two displays the Mac shows the presenter UI and the audience window follows each step; clicking an order-map cell jumps both; End closes both | `presenter-view.test.tsx` (order map = layout positions, skip shown, jump posts `present-step`); `present-clock.test.ts` | extends `presenter-view.e2e.ts` | 120 |
| **S3.7a** | Follow the presenter: awareness field + follower root | — (local half of md-present-link) | `use-collab.tsx` awareness `present` field + strict validator (bounded ints, id ≤ 128 chars, rejected whole), `present/present-stage.tsx` follow mode (live / drifted / catch up), new `client/v2/present/follow-view.jsx` (separate root like `embed-view.jsx`: `ro=1`, `comments=0`, `set-mode present`), follow bar ("Live" · avatar · "<name> is on 6 of 14 · you're on 5" · Catch up), watchers faces | dgn new: `present-follow-state {live, presenterName, presenterIndex, watchers}` (c2s, active); `client/index` entry routing `?present=follow` to the new root (lead: entry file) | opus (cross-peer awareness schema, untrusted-canvas input) | S3.2a | two local tabs: the follower stays on the presenter's artboard; ← in the follower turns Live off and shows Catch up; Catch up rejoins; `&audience=1` has no bar and ignores keys | `present-awareness.test.ts` (forged / oversized states dropped whole, fails against an unvalidated read); `follow-view.test.tsx` (drift → catch up; audience lock) | — | 130 |
| **S3.7b** | Presentation link on the hub (L4 lane) | md-present-link | `apps/hub/src/present-route.mjs` (`GET /present/<canvas>` → studio child `/?present=follow&open=<rel>`; signed-in only; Can view on that canvas per V2-1.16; unknown or forbidden canvas → the same 404), `client/v2/present/copy-link.js` (URL from `cfg.cloud`; offline: copies and says viewers follow once you're back) | hub route table registration; registry `present.copy-link` ("Copy presentation link", `minRole: edit`, visible in cloud-linked projects, ⌘K greyed "in a cloud project" elsewhere — V2-4.9 decision 2 pattern); agent: `maude design open <canvas> --mode present` prints the link for a linked project (S12 doc) | opus (hub + ACL) | S3.7a, S9 roles slice (V2-1.7/1.16 in hub) | a cloud viewer with Can view on the canvas opens the link, sees the live slide and "6 watching"; without access: the same 404 as a missing canvas; a "Share" link still opens the canvas | hub `present-route.test.mjs` per role (owner/editor/commenter/viewer/none) + no existence oracle; v1 desktop client against the new hub still green | `share-roles` scenario gains a "follow the presentation" step (with S9) | 110 |
| **S3.8** | Offline presenting | md-edge-offline | `client/v2/present/presenter-view.jsx` status ("Offline — kept on this Mac" replaces "Audience on …"), Now-box notice "Clip isn't on this Mac — the audience sees its first frame" + Skip, `present/media-presence.ts` (which assets are local: existing asset routes, no new endpoint) | — | sonnet | S3.3, S3.6b, S3.7b | with the network off, local media plays, a missing clip holds its first frame on the audience screen, the presenter sees why + Skip; Copy presentation link waits | `media-presence.test.ts`; `presenter-offline.test.tsx` | — | 70 |
| **S3.9** | Preview chrome and motion | md-motion, md-preview, md-preview-combine | new `client/v2/preview/preview-bar.jsx` ("Previewing **<canvas>**" · "esc to edit" / "esc for Viewing"; back slot used by S3.10a), `client/v2/preview/zoom-only.jsx` (zoom % only), folded pill (mark only) via a prop on the existing pill, camera ease onto the artboard in view on Edit ⇄ Preview (`--dur-panel`, `--ease-out`, reduced motion 1 ms) in `canvas-lib.tsx`; Hand rests: click uses the design, drag on empty canvas pans (V2-1.2 Q3) | `app.jsx` residue mounts; `project-pill.jsx` `folded` prop (P4 file, lead); home row G0-D/D1 evidence | sonnet | S3.1 | Edit → Preview: panels fold, the toolbar morphs, faces/status step aside, the camera eases, the PreviewBar fades in, all inside 220 ms; on a canvas without links videos play with sound, a web artboard scrolls inside itself, nothing moves | `preview-bar.test.tsx` (words per role); `preview-motion.test.tsx` (one camera move, none on inset change alone); `input-router` row: `browse` drag on empty canvas = pan | — | 110 |
| **S3.10a** | Links: engine, playback, back, chip | md-preview-follow | `canvas-edit.ts` `applySetLink` / `applyClearLink` (stamp `data-cd-id` + `data-cd-link` in one write; grammar from S3-links-format), new `routes/links.ts` (`GET /_api/links?file=` → `{elementId: target}` parsed server-side, main origin only), input-router + CanvasRouter **Preview branch only** (`link-follow {elementId}`), new `link-chip-overlay.tsx` (Edit, read-only: "Go to Pricing" / "Opens cal.com/studio"), `client/v2/preview/preview-history.js` (per-window back stack; "‹ Homepage"), dangling target toast, `maude design check` dangling-link rule, design-skill section | registry `element.set-link` / `element.clear-link` (edit, agent: file-format doc `data-cd-link`), `preview.back` (no key; esc order unchanged); `routes/index.ts` registration; dgn new `link-follow` (c2s, active) | opus (versioned TSX format + route) | S3.0, S3.9 | in Preview, clicking "See pricing" opens Pricing in Preview on its Desktop artboard and the bar shows "‹ Homepage"; back returns to the same place; a link to a removed canvas says so and stays put; the chip shows while a linked element is selected in Edit; export output carries no `data-cd-link` | `apply-set-link.test.ts` (one write, one undo entry, id stamped once, refused schemes: javascript:, data:, file:, relative paths outside designRoot); `links-route.test.ts` (canvas origin absent; read-only allowed to read); `preview-history.test.ts` | `modes-present` e2e step "follow a link and back" (drive by coordinates — canvas iframe is not DOM-reachable) | 140 |
| **S3.10b** | External link targets (http/https) | — (14 ed-inspector row belongs to S2) | `client/v2/preview/external-link-confirm.jsx` (trusted shell confirm with the host, once per host per session), browser: `window.open(url,'noopener')` from the confirm click | **DDR-054 amendment** (lead + security pair): desktop opener `open_link_external` — https/http only, called only from the trusted shell confirm, caller-checked, rate-limited; named fallback if refused: desktop shows the URL + "Copy link", opens nothing (Progress-log exception) | opus (security) | S3.10a | in a browser the confirm opens the page in a new tab; on desktop either the system browser opens it or the fallback shows; a `javascript:` target never reaches the shell | `external-link.test.tsx` (scheme gate, host shown, once-per-host); Rust caller-check test if the opener lands | — | 80 |
| **S3.11** | Inspect and measure | md-inspect | `inspect` tool descriptor (retire `V1_TOOL_BRIDGE.inspect`), CanvasRouter Viewing/Preview inspect branch (outline without handles + size tag; ⌘-click in Preview instead of following a link), new `client/v2/inspect/inspect-panel.jsx` (right, 300 w: name + kind chip, Size and spacing incl. gap to neighbour, Colour and type with token names, Export PNG 1×/2×/SVG/Handoff… → S8's sheet actions, **Copy code** primary, **Edit ↵**, Advanced CSS; content lifted from the v1 Inspect tab), `measure-overlay.tsx` gated on via a pure `modeShows()` (Edit/Preview/Viewing on, Present off) | registry `inspect.copy-code`, `inspect.edit` (↵ while an inspect selection exists → `mode-request {mode:'edit', cause:'inspect'}`); agent path: PREF ("read the element's JSX") | sonnet | S3.9 | Preview ⌘-click "Book a call" → outline + panel with the drawn rows; ⌥ measures; ↵ switches to Edit with it selected; in Viewing a plain click does the same and no editing control appears | `inspect-panel.test.tsx` (rows from a fixture element; no edit controls for `view`); `tool-mode` test: the bridge entry is gone and `inspect` arms itself; measure off in Present | — | 130 |
| **S3.12** | Viewing, view-only link, esc ladder, the what-shows table | md-model, md-esc, md-edge-viewer | new `bridge/mode-shows.ts` (pure: the §5.4 "what each mode shows" table as data, A8 applied) consumed by shell + canvas where they branch today; esc ladder fixes found by a table-driven sweep; Viewing: access word in the status slot, **Ask to edit** button calling S9's action (S9 owns the flow), view-only link opens in Preview with Viewing one click away | rule-row evidence (§4); S1 dependency: Version history read-only (no Restore) | sonnet | S3.2b, S3.9, S3.11 | every cell of the md-model table holds in a running shell per mode; every md-esc row takes exactly one step; a Can view link in a browser shows only the allowed menu rows | `mode-shows.test.ts` (every table cell; fails if a consumer branches outside the table); `esc-ladder.test.tsx` (every md-esc row incl. half-written reply kept, mid-drag set down, esc never stops AI) | `shell-parity.e2e.ts` viewer/embed rows re-run | 110 |
| **S3.13** | `modes-present` scenario + 04 fidelity sweep (verifier) | md-present-menu (+ evidence for every S3 row) | `apps/desktop/e2e/scenarios/modes-present.e2e.ts`, `.ai/scenarios/maude-v2/` evidence files for canvas 04 | ledger `set` for the S3 rows; whats-new entry (pending) | sonnet (verifier: reports only, no product code) | all above | all 19 S3 rows `verified` with hash-pinned evidence; design-critic ≥ 4.0 on 04 surfaces, a11y 0 blockers; the Present ⌄ menu shows every drawn row with its key and note | — | `modes-present` (Edit → Preview → follow link → back → Present from selection → step → video → presenter view (if two displays) → esc ladder) | 90 |

## 4 · Ledger coverage

**S3 rows (19), each in exactly one slice:** md-edge-ai → S3.1 · md-present-lift → S3.2a · md-present-full,
md-present-canvas, md-keys → S3.2b · md-present-video, md-edge-mixed → S3.3 · md-presenter → S3.6b ·
md-present-link → S3.7b · md-edge-offline → S3.8 · md-motion, md-preview, md-preview-combine → S3.9 ·
md-preview-follow → S3.10a · md-inspect → S3.11 · md-model, md-esc, md-edge-viewer → S3.12 · md-present-menu → S3.13.

**Reassigned (lead edits the ledger `package` field; S3 supplies only the mode each opens in):**

| Row | To | Why |
| --- | --- | --- |
| 04/md-edit | S2 | the Interaction section (On click / On hover rows) is S2's; S3.10a supplies `element.set-link` + the chip |
| 04/md-edit-image | S2 (+S8 Assets tab) | Image tool I and fill-cropped placement are S2 Edit tools |
| 04/md-edit-component | S2 (+S10) | ⇧I picker, linked instances, variants |
| 04/md-annotate | S4 | Preview toolbar tools (sticky colours, Marker tips); the toolbar shell is V2-4.5's |
| 04/md-draw | S4 (+S5 section scope chip) | annotation layer + AI reading it |
| 04/md-comment | S9 | pins, threads, @mentions with roles, Comments panel filters (C7/C8) |
| 04/md-comment-only | S9 | Can comment toolbar + composer + Ask to edit flow |

**Rule / home rows S3 closes:**
- `00/rule/the-mode-switch-lives-in-the-share-cluster`: S3.12 (Phase 4 evidence plus the Present menu).
- `00/rule/keys-for-the-modes`: S3.2b (⌥⌘P from V2-4.5b; ⌥⌘↵ ⇧⌥⌘↵ from S3.1; L from S3.2b).
- `00/rule/ai-holds-still-under-your-pointer`: S3.1. It closes as **amended by A8**: live in Preview, held in
  Present · Artboards. The lead rewords the rule row with the canvas amendment.
- `G0-D/D1` (Browse tool → Preview Hand, listed in "?"): S3.9.
- Not S3: `00/rule/two-toolbars-one-per-mode` closes when S2/S4 fill their pending slots. S3 adds `pointer` and
  retires the `inspect` bridge. `00/rule/space` belongs to S7.

## 5 · Risks and run order

**Run order.**
- **L1 (canvas iframe, serial):** S3.1 → S3.2a → S3.3 → S3.7a → S3.9 → S3.10a → S3.11. These all touch
  `canvas-lib.tsx`, `canvas-shell.tsx`, `input-router.tsx` or `_shell.html`, so none of them run in parallel.
- **Beside L1 on their own worktrees** (none of them touch L1 files):
  - S3.0 first, alone;
  - S3.5 (routes + sheet) right after S3.0;
  - S3.6a (L4, Rust) right after S3.0;
  - S3.2b once S3.2a's message payloads are merged;
  - S3.10b after S3.10a;
  - S3.6b after S3.6a + S3.7a;
  - S3.7b (L4) after S3.7a and S9's hub roles slice;
  - S3.8, S3.12, S3.13 at the end.
- **Shared files** (`client/v2/present/present-controls.jsx`, `presenter-view.jsx`): S3.2b → S3.3 → S3.6b → S3.8
  must merge in that order.

**Risks.**
1. **Autoplay with sound in WKWebView.** The Present gesture happens in the shell, not the iframe. S3.3 measures it
   before it builds anything. If sound is blocked, the fix is a wry autoplay setting (L4 patch), not a workaround in
   the canvas.
2. **A planted canvas can fake its own presenter state.** It can only lie about its own artboards, and the validator
   drops malformed states whole (S3.7a). The follower root stays `ro=1` and its canvas door has no write capability.
3. **Second display.** The e2e can't assume one exists, so it skips with a recorded reason. A display unplugged
   mid-talk closes the audience window, and presenting continues on the Mac.
4. **The DDR-054 opener (S3.10b)** may be refused. The named fallback keeps S2's row honest.
5. **Two mode sources (D1)** must collapse in one commit together with the `pv-present-exit` testid re-emit.
   Otherwise the characterization golden and e2e-mp break silently.
6. **Locked screen and an unreachable canvas DOM (memories).** WebKit runs are invalid on a locked screen. Canvas
   e2e steps drive coordinates or a structural route, never iframe selectors.
7. **Context.** S3.10a and S3.7a are the largest slices. A builder commits each sub-step (engine → route →
   playback → chip) and hands back with `## Continue` when it would pass 300k.

**Open questions (recommended default in bold):**
- Who may Copy presentation link? **Editors and owners; any role with Can view on the canvas may follow.**
- Anonymous presentation links? **No: signed in with Can view (S9 owns links).**
- Cross-canvas links after a canvas move or rename? **They dangle with a clear state; `maude design check` reports
  them. S1's move rewrites them later (note in S3-links-format).**
- Sound with presenter view on? **Only the audience window plays sound.**
- Present by Can view? **Allowed locally, no broadcast.**
