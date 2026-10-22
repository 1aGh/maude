# design-critic — 10 Share and Collaboration · V2-8.5 stage B

_2026-10-22 · board `.design/ui/v2/10 Share and Collaboration.tsx` (+ `.css`, `_kit.css`) · DS `maude-v2` · pairs from `full-size-path.txt` (30 PNG, all read; light/dark cropped at 1:1 where detail mattered) · opt-out scope `palette`._

Lens: layout, spacing, sizes, typography, colour/tokens, material, iconography, drawn states.
Read-only review. Nothing was edited and no server was booted.

**How to read the tables.** `d+l` means the difference shows in both themes the same way. It is counted once. A row is a blocker when it is visibly different from the board or when a drawn state is missing. A row is a warning when it is near the board, or when the board itself drifts from the CONTRACT or from 04 Modes. **Not a finding** covers fixture or harness differences: content, canvas names ("Print", "Smoke"), counts, "Michal" in place of "You" (the faked `/me` e-mail does not match the people list), an empty invite field, and A · přední drawn selected in every frame.

## TL;DR

**Blockers: 56 · Warnings: 29 · Verdict: fix-and-retry**

The Share, sync and access surfaces exist and their words match the board. They do not look like it yet, and most of that comes from four shared causes:

- The canvas shell still resolves the **v1 `.maude` token ladder**: accent hue 268 instead of 238, and smaller radii.
- Buttons use the **v1 `.maude .btn` anatomy**.
- Several **kit primitives are re-made locally**: the select, the tone avatar, the segment and the icons.
- The canvas iframe's toolbar and comment pins are still on **v1 geometry**.

---

## Per artboard

### co-share-sheet

| id · theme | difference | spec | impl | owner file:line | sev |
|---|---|---|---|---|---|
| d+l | Accent hue / lightness (Share, Invite, focus) | `--accent` oklch(0.53 0.175 238) azure | oklch(0.68 0.18 268) dark / 0.52 0.195 268 light (periwinkle / indigo) | `client/styles/1-tokens-maude.css:41,154` (shell mounts `.maude`, not `.maude-v2`) | blocker |
| d+l | Sheet radius | `--radius-xl` 20 px | v1 `--radius-xl` 14 px | `1-tokens-maude.css` ladder; `v2/share/share.css:24` | blocker |
| d+l | Scope segment track and pressed cell | `.seg` track bg-3; pressed bg-2 + shadow-sm + inset 1 px accent; `.k-seg-b` type-xs | track bg-1; pressed bg-3, no accent edge; type-sm | `v2/share/share.css:83-103` | blocker |
| d+l | Role select in the invite row | `.select.k-in-select` 140×28, tokened, chevron Icon | native `<select>` with the OS chevron | `v2/share/invite-row.jsx:45-57`, `share.css:115-124` | blocker |
| d+l | Invite button | `.btn--primary`, filled azure, 32 px, radius-md, semibold | disabled v1 `.btn` (bg-1 + 1 px border, so it reads as outlined) | `styles/4-components-maude.css:43-47`; `invite-row.jsx:58-65` | warning (the board draws the typed / enabled state; the disabled look is still v1) |
| d+l | Person avatars | `k-av k-av--<tone>` filled (You yellow, Tereza sky, Jonas green, Petra lilac) | grey bg-3 disc, fg-1 initial | `v2/share/people-list.jsx:53-55`, `share.css:160-171` | blocker |
| d+l | Role chevron glyph | `Icon chevron` 12 px | text "⌄" | `people-list.jsx:83-85` | warning |
| d+l | "Resend" colour | `--accent-text` | fg-0 (v1 `.maude .btn--ghost` in the later `components` layer beats `.v2sh-pp-act` in `shell`) | `4-components-maude.css:62-66` vs `share.css:189-192` | blocker |
| d+l | Team row "Everyone in Alligators brand · 9 people · change it in Whole project" | drawn, with a 24 px people tile | absent | `people-list.jsx` (no team row); `share-model.js:171` `peopleRows` | blocker (state missing) |
| d+l | Count line right half "+ 9 in Alligators brand" | drawn | absent | `share-model.js:204-209` `countLine` | blocker (state missing) |
| d+l | Link row icon tile | 24 px bg-3 tile, `Icon link` | none | `v2/share/link-row.jsx:18-22` | blocker |
| d+l | Link row subline | "Can view" | "Opens it for people who already have access" | `share-model.js:258-261` | warning (deliberate: a team link grants nothing; the board needs the new words) |
| d+l | Advanced row label | `.k-adv-btn` type-sm semibold fg-1; count "Links, link rules, sync" | type-xs regular fg-2; "Link rules, other ways in, where it syncs" | `v2/fold/fold.css:12-25`; `share-model.js` `advancedView` hint | blocker |
| d+l | Close × in the header | none drawn | "×" text button | `share-sheet.jsx:374-384` | warning |
| d+l | Sheet top offset | 64 px (`.co-pop`) | 56 px | `share.css:16` | warning |
| d+l | Share button "open" ring | `box-shadow 0 0 0 3px --accent-tint` | none | `v2/shell/share-cluster.css:191-197` | warning |
| d+l | Comments icon in the cluster | absent (kit draws it only when the canvas has comments) | always drawn | `v2/shell/share-cluster.jsx:147-160` | blocker |
| d+l | Undo · redo · zoom island, bottom left | `ZoomUndo` drawn | absent (the pref defaults off) | `hooks/use-shell-core.jsx:1090` | blocker |
| d+l | AI corner icon | `PanelIcon spark` (vermilion spark) | grey 4-point "sparkle" | `v2/shell/corner-icons.jsx:128` | blocker |
| d+l | Edit toolbar | see co-presence | | | (counted there) |

### co-share-roles

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Role menu clipped | the whole menu shows (Can edit · Can comment · Can view │ Make owner · Remove from …) | cut off below Can view: the sheet's `overflow:auto; max-height` clips the absolute menu, so Make owner and Remove are hidden | `share.css:18-19` + `share.css:223-237` | blocker |
| d+l | Check mark | `Icon check` 14 px, accent-text | text "✓" | `v2/share/role-menu.jsx:70-72` | warning |
| d+l | Selected row fill / menu radius | `.co-rm[data-hl]` bg-3, `k-menu` radius-lg 14 | bg-3 on `aria-checked`, v1 radius-lg 10 | `share.css:232,251-254` + RC1 | warning |
| d+l | Scope column ("This canvas — Petra sees one canvas" / "Whole project — Lukáš sees all 93") | drawn | not reached | Canvases panel read-only share (`.co-ro`) is not shot | — unverified |
| d+l | Segment, select, avatars, Invite, accent | as co-share-sheet | | | (counted once) |

### co-browser-view

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Project pill | "Alligators brand / Combine-kampan" with chevron | the mark tile only (folded pill) | `bridge/mode-shows.ts:76` (`folded-pill` in Preview) | warning (RC5: the board conflicts with the 04 what-shows table) |
| d+l | "Previewing Print · esc for Viewing" bar, top centre | not on this board | drawn | `v2/preview/preview.css:26-30` (04 `md-pbar`) | warning (RC5) |
| d+l | Panel-left corner icon | none (a viewer has no panels) | drawn | `corner-icons.jsx:94` | blocker |
| d+l | Access word "Can view" | `.co-trw[data-access] .k-saved` fg-1, w-medium | fg-2 regular | `share-cluster.css:86-96` | blocker |
| d+l | Comments icon in the cluster | absent | drawn | `share-cluster.jsx:147` | (RC9, counted once) |
| d+l | "Ask to edit" | `.btn--primary` 32 px, type-sm semibold, azure | `btn--sm` type-xs, v1 accent | `share-cluster.jsx:195`; RC1/RC2 | blocker |
| d+l | Presence faces (T, J) and cursors | drawn | none (no peers) | — | not a finding (harness) |
| d+l | Zoom readout | `co-zoom-only` island, ghost "27%" | "100%" island | `v2/preview/zoom-only.jsx:18` | not a finding (value) |

### co-presence

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Edit toolbar size | `.dock` 40 px buttons, 18 px icons, padding 8, radius-xl 20 | 32 px buttons, 16 px icons, padding 4, radius 14, mono font | `apps/studio/toolbars/toolbar-css.ts:16-60` | blocker |
| d+l | Pressed tool | `icon-btn[aria-pressed]` accent-muted + accent-text, no bar | tint + accent underbar (v1 DDR-046) in HUD hue 268 | `toolbar-css.ts:73-80`; `canvas-hud-tokens.gen.ts:13,33` | blocker |
| d+l | Tool set and order | select · hand · frame · shapes · pen · text · image · component │ more | select · hand │ frame · rectangle · pen · text · image · component · more (divider after hand; rectangle in place of the shapes glyph) | `tool-palette.tsx` slots | warning |
| d+l | Faces | tone-FILLED discs (`k-av--sky/green/lilac`, "+4" grey), 2 px bg-1 ring | accent-tinted fill with the tone only as a ring; "YO" two letters | `v2/presence/presence.css:3,13-21`; `share-cluster.css:51-64` (`.st-face` bg accent-mix) | blocker |
| d+l | Face menu, other cursors, AI tags | drawn | not reachable (one local user) | needs a second presence peer | blocker (state not reached) |
| d+l | ZoomUndo / AI spark corner | drawn | absent / grey sparkle | RC6 | (counted once) |
| d+l | Share button outline | none | 1 px accent border (v1 `.btn--primary` border-color) | `4-components-maude.css:49-53` | warning |

### co-follow · co-bring · co-spotlight · co-twelve — not reachable (findings)

The code exists for these: `v2/presence/faces.jsx:121-206` (Follow, Bring everyone here, the people list), `presence/canvas-presence.tsx:455` ("Everyone here is following you"), `v2/present/follow-view.jsx:330` (`st-follow-frame`). **What makes them reachable:** a second awareness peer in the lane. Two clients on one hub would do it, or a scripted awareness peer injected through the presence bridge. Twelve needs 11 of them. Until then their frame, pill, wake and idle-grey cursors cannot be checked. **4 blockers (state not reached).**

### co-comment-thread

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Comment pin | `k-cpin-dot` 28 px, pill radius with a 2 px tail, the author's tone fill, rounded font, initial | 24 px square (5/5/5/2 radius), HUD accent indigo, mono, sequence number "1" | `client/comments-overlay.css:30-50`; `comments-overlay.tsx:1351-1368` | blocker |
| d+l | Comments panel side and filters | floating island, LEFT, 272 px; Open · Mine · Resolved | right panel; Open · Mine · Resolved · All; grouped by canvas | `v2/comments/comments-panel.jsx:215-246` | warning (RC5-like: CONTRACT §6 says right + four filters; the board is stale) |
| d+l | Filter count spacing | "Open 4" | "Mine0" (label and number touch) | `comments-panel.jsx:246` `.cmp-n` | warning |
| d+l | Panel close × | `icon-btn` × | not visible | `comments-panel.jsx:225` | warning |
| d+l | Row avatar | tone-filled `k-av` | grey "?" outlined | `comments-panel.jsx:300` `.cmp-av` | blocker (no tone) — the "?" itself is the fixture's missing author |
| d+l | Composer under the pin with the @ suggestion "Tereza · Can edit"; thread with Resolve | drawn | not reached in the shot (mention picker closed, no other authors) | `comments-overlay.tsx:1221-1243` | blocker (state not reached) |
| d+l | Cluster in Preview | faces + "Saved" + comments + modes | compact: no faces and no status | `share-cluster.css:503-505`; `mode-shows.ts:71` | warning (RC5) |
| d+l | Preview toolbar | see co-comment-video | | | (counted there) |

### co-mention-notify — not reachable (finding)

The Mac banner and Dock count exist (`v2/comments/native-mention-notice.js:57`, `desktop/src-tauri/src/notify.rs:744`) but only in the native shell. **What makes them reachable:** a Tauri build lane, plus **product work for the e-mail**: there is no "mentioned you" mail template anywhere in `apps/hub/src`. The in-app toast comes through the generic notice host, so RC7 applies. **1 blocker.**

### co-comment-video

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Timeline strip with comment markers and "2 comments on this video" | drawn under the clip | absent in this frame | `v2/timeline/Timeline.jsx:2009` (comment tool); no marker row shown | blocker (state missing) |
| d+l | Thread header and time chip | `Icon video` + "Reels · nábor"; chip with `Icon clock` "at 0:12" | "Clip · 320×180" with no glyph; chip "at 0:00" with no clock | `comments-overlay.tsx:1464-1486` | blocker (glyphs) |
| d+l | Composer field | `.co-th-comp` bg-3, radius-md, one line, 26 px azure send | bordered textarea, the hint wraps to two lines, lavender disabled send | `comments-overlay.css:97-190` | warning |
| d+l | Preview toolbar glyphs | yellow sticky swatch, pen with an ink underline, comment as a rounded square, 20 px icons | monochrome outline glyphs, ~16 px, carets, comment as a circle | `tool-palette.tsx`, `toolbar-css.ts` | blocker |
| d+l | Toolbar geometry | dock 56 px | 40 px | RC4 | (counted in co-presence) |

### co-comment-print

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Print guides (trim, safe, coral bleed wash) + "Bleed 3 mm · trim · safe margin 5 mm" | drawn | off (per-canvas toggle, default false) | `hooks/use-shell-core.jsx:1096` `printGuidesVisible=false` | blocker |
| d+l | Position chip wording | "14 mm from the left · 2 mm above the trim" | "47 mm from the left · 70 mm from the top" (top, not trim) | `comments-overlay.tsx:1483` (place chip) | warning |
| d+l | Artboard selected with a px size badge while in Preview | not drawn | blue frame + "422 × 584" | — | not a finding (harness selection) |

### co-sync-offline

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Canvases panel material and shape | content-height floating island (kit CanvasesPanel); tree with thumbnails; Search ⌘K; "93 canvases"; New canvas row | full-height pane; empty thumbnail squares; kind-filter chips; Make a design system; Trash; Advanced; project switcher | `v2/canvases/canvases-panel.jsx` (canvas 11's surface) | blocker (big; also canvas 11's) |
| d+l | Per-row "not sent" words | on three rows | none | `v2/canvases/row-slots.js:25` (needs per-canvas pending) | warning (the faked outbox has no per-canvas data) |
| d+l | Panel foot colour | `.k-cp-foot` fg-2 | warn amber | `v2/sync-states/sync-states-model.js:45` (`tone:'warn'`) → `canvases-panel.jsx:619` | blocker |
| d+l | Tooltip "Invites send when this Mac is online." under Share | drawn | absent (no code) | `share-cluster.jsx:204` | blocker (state missing) |
| d+l | Queued comment card ("Queued — sends when this Mac is online.") | drawn | not reached (copy exists, `v2/empty/empty-copy.js:87`) | — | warning |
| d+l | Edit vs Preview mode | Preview (comment tool) | Edit | — | not a finding (harness) |

### co-sync-back

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Back-online toast placement and material | `Toast at="top"`: island pill top centre, sync icon, regular weight, ghost "Show" | bottom centre above the toolbar; v1 sonner card (1 px border, 3 px accent left stripe, radius-md, 16 px padding, 13 px bold title, ×); no icon | `apps/studio/notifications.tsx:217-240,292-297`; `v2/sync-states/back-online.jsx:30-46` | blocker |
| d+l | "Tereza changed this · 09:15" tag on the artboard | drawn | not in the product (no code) | — | blocker (state missing) |
| d+l | "2 versions" mark beside the sticky | on the canvas at the sticky, tone avatars, warn ring | (not raised in this frame) `.sy-mark` is fixed top centre, grey `sy-face` | `v2/sync-states/sync-states.css:6-42` | blocker |
| d+l | "0 sent" vs "9 sent" | | | — | not a finding (fixture) |

### co-conflict

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Where the card sits | on the canvas next to the sticky (`co-twin` at the sticky) | fixed shell overlay, top centre | `sync-states.css:6-13` | blocker |
| d+l | The two versions | real `Sticky` (object-yellow) side by side | grey boxes: `--sticky-yellow` is undefined in the shell, so they fall back to bg-2 | `sync-states.css:89-98` | blocker |
| d+l | Type sizes | type-sm 12 / type-xs 11 | `--text-sm` / `--text-xs` undefined, so 13 / 12 px | `sync-states.css:21,58,76,87,105` | warning |
| d+l | Who line | avatar + "Yours · yesterday 21:40 · this Mac" | text only "Yours · this Mac" | `conflict-card.jsx:132` | warning |
| d+l | Keep buttons | v2 `.btn--sm` (bg-3, radius-md, borderless) under each sticky; Keep both with `Icon duplicate` | v1 outlined small buttons; Keep both with no glyph | RC2; `conflict-card.jsx:101` | blocker |
| d+l | Version history card beside it ("this sticky", Restore rows, ⌥⌘H) | drawn | absent | — | blocker (state missing) |

### co-trashed

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Banner position | top centre at `--space-4` (16 px) | `top: 56px`, under the Preview bar | `v2/access/access.css:101-104` | blocker |
| d+l | Banner icon | 28 px pill chip bg-3, trash 16 | bare glyph | `access.css:113-115` | blocker |
| d+l | Banner title size and padding | type-sm / lh-sm; padding `2 2 2 3` | inherits (larger); symmetric `2 3` | `access.css:101-121` | warning |
| d+l | Ghost row "In the trash · open here" | thumbnail, dimmed two-line row | one dim line with no thumbnail, above a duplicate live row | `canvases-panel.jsx` | warning (the duplicate is fixture) |
| d+l | Zoom pill overlaps the panel's project switcher ("ligators brand" clipped) | — | overlap | `v2/preview/zoom-only.jsx:18` (no left-panel occlusion offset) | blocker |
| d+l | Toolbar and cluster mode | Edit toolbar, Edit cluster | Viewing (Hand + Comment) | `mode-shows.ts:58` | warning (the board note says "editing stops", which contradicts its own Edit toolbar) |

### co-local-cloud

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Two headings | the offer title only | "Share Smoke" + × above "Move … to the cloud?" | `share-sheet.jsx:374-388` | blocker |
| d+l | Body copy style | `.co-card-b` type-sm fg-1 | `.v2sh-hint` type-xs fg-2 | `move-to-cloud.jsx:35` | blocker |
| d+l | Cancel | `.btn` (bg-3 filled) | `btn--ghost` | `move-to-cloud.jsx:45` | warning |
| d+l | Advanced fold on a local project | absent | drawn | `share-sheet.jsx` `<ShareAdvanced>` always rendered | blocker |
| d+l | Steps 2 (browser sign-in) and 3 (Share on Invite + "Moved to the cloud" toast) | drawn | not shot | — | unverified |

### co-ask-edit

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | View-only dark tip ("You can look at …, not change it") | `co-callout` (fg-0 fill, bg-2 text) | not triggered (`v2ac-tip` exists, `access.css:6-25`) | — | blocker (state not reached) |
| d+l | Mode switch | Viewing pressed | Preview pressed + Preview bar | `mode-shows.ts` | warning (the board conflicts with co-browser-view and CONTRACT §2 "Can view opens in Preview") |
| d+l | Owner side: request block on top of Share, "Petra asks to edit" toast | drawn | not shot (`RequestBlocks`, `share-sheet.jsx:424`) | — | unverified |
| d+l | Pill folded to mark / no faces | full pill, face T | | RC5 | (counted) |

### co-access-ends

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Card padding | `--space-5` (20 px) | `--space-4` | `access.css:74` | warning |
| d+l | Card radius | radius-xl 20 | v1 14 | RC1 | (counted) |
| d+l | Lock chip | 36 px pill bg-3 | 28 px radius-md square | `access.css:83-91` | blocker |
| d+l | Card title | type-md / lh-md semibold | inherits type-sm, 600 | `access.css:92-95` | blocker |
| d+l | "Back to Home" | `.btn--primary` with `Icon home` 14 | v1 primary in hue 268, no glyph | `v2/access/access-card.jsx`; RC2 | blocker |
| d+l | Card size | 340 px | 340 px (the INDEX's "≈210 px" is the pair's downscale) | — | ok |
| d+l | Remove-Lukáš confirm; link-off card | drawn | not shot (exist: `share-sheet.jsx:48-80`, `link-off-card.jsx`) | — | unverified |
| d+l | What's new toast in the frame | — | — | — | not a finding (harness) |

### co-share-advanced

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| d+l | Link-rule pickers | `InSelect` 140×28 with a chevron Icon | `<select class="input">`, no chevron, width follows the value | `v2/share/share-advanced.jsx:83-95`; `share.css:374-377` | blocker |
| d+l | Row keys | `.co-arow` key type-sm fg-1, 28 px rows | type-xs fg-2 | `share.css:307-310` | blocker |
| d+l | Other ways in: app link / this Mac | inline mono value + 22 px copy icon | stacked: label, full-width input, text "Copy", hint line | `share-advanced.jsx:47-75` | blocker |
| d+l | GitHub row and Where it syncs | visible | clipped under the sheet's max-height scroll | `share.css:18-19` | warning |
| d+l | Roles matrix column (owner caps) | 440 island, 4 role columns, check icons | not reached | `share-advanced.jsx:169-197` | unverified |
| d+l | Advanced header style | as co-share-sheet | | | (counted) |

---

## Root causes that hit several artboards

1. **RC1. The shell runs on the v1 token ladder.** The canvas shell mounts `.maude[data-theme]` (`client/styles/1-tokens-maude.css:21,138`). The generated v2 ladder applies only under `.maude-v2` (`1-tokens-maude-v2.css`), which today only Home and the annotations have. Effects:
   - accent oklch(0.68/0.52 … 268), where the board has 0.53–0.54 … 238;
   - radius sm/md/lg/xl 5/7/10/14, where the board has 6/10/14/20;
   - bg-0..3 about 0.04 L darker in dark;
   - fg-2 0.66 instead of 0.72;
   - `--font-body` Inter first instead of system-ui;
   - the iframe HUD copies the same hue (`canvas-hud-tokens.gen.ts:13,33`).

   This hits every artboard and both themes.
2. **RC2. Buttons use v1 anatomy.** `.maude .btn*` lives in `@layer components` (`4-components-maude.css:13-90`), and there is no v2 `.btn` in `3-kit-maude-v2.css`. So buttons get a border, radius-sm, weight 500 and a disabled bg-1 that reads as outlined. Because `components` is the later layer, it overrides every v2 surface rule in `shell`; Resend lost its accent this way.
3. **RC3. Kit primitives are re-made locally.**
   - A native `<select>` replaces `.select.k-in-select`.
   - Avatars are grey or accent-tinted instead of tone-filled `k-av--<tone>`: Share people, presence faces (`presence.css:3` "fill stays the cluster's"), `.sy-face`, `.cmp-av`.
   - Text glyphs "⌄ ✓ ×" stand in for `Icon`.
   - A bespoke `.v2sh-seg` replaces DS `.seg`/`.k-seg-b`.
   - `v2-fold-btn` is type-xs fg-2 where `k-adv-btn` is type-sm semibold.
4. **RC4. The iframe chrome is still on v1 geometry.** The toolbar has 32 px buttons, 4 px padding, radius 14, a mono font and an accent underbar (`toolbars/toolbar-css.ts:16-80`). Comment pins are 24 px squares with a sequence number (`comments-overlay.css:30-50`) where the board draws tone pins with an initial.
5. **RC5. Board 10 disagrees with 04 Modes and the CONTRACT about Preview.** Board 10 draws Preview and Can view frames with the full project pill, faces and Saved, and no Preview bar. The what-shows table (`bridge/mode-shows.ts:67-76`) folds the pill, makes the cluster compact and adds `md-pbar`. The Comments panel is left with three filters on the board, but right with four in CONTRACT §6. The implementation follows the table and the CONTRACT, so the board needs redrawing or the table needs a decision. Counted as warnings.
6. **RC6. Default-off or mis-glyphed corners.** ZoomUndo is hidden by default (`use-shell-core.jsx:1090`). The AI corner is a grey "sparkle" instead of the vermilion spark (`corner-icons.jsx:128`). The Comments button is always in the cluster (`share-cluster.jsx:147`). Print guides are default off (`use-shell-core.jsx:1096`).
7. **RC7. One notice host for every toast.** That host is a v1 sonner card at the bottom centre (`notifications.tsx:217-240,292-297`). There is no `top` placement, no icon slot and no island material. This hits co-sync-back, and the co-mention-notify toast through the same host.
8. **RC8. Undefined tokens in v2 CSS.** `sync-states.css` uses `--text-sm`, `--text-xs` and `--sticky-yellow`, none of which exist. Text falls back to 13/12 px and the conflict stickies come out grey.

Missing product states: the team row and "+ N in project" count, the link-row icon, the offline invite tooltip, "Tereza changed this", Version history beside the conflict, the video comment timeline markers, and the mention e-mail. The presence peers needed by co-follow, co-bring, co-spotlight and co-twelve are harness work.

---

## Verdict

```json
{
  "canvas": "10 Share and Collaboration",
  "critic": "design-critic",
  "blockers": 56,
  "warnings": 29,
  "verified_ids": [],
  "top_blockers": [
    { "category": "ds-tokens", "line": 41, "summary": "Shell resolves v1 .maude ladder: accent hue 268 vs 238, radii 14/10/7 vs 20/14/10 (1-tokens-maude.css)", "fix": "Mount the canvas shell under .maude-v2 or regenerate the shell ladder from maude-v2." },
    { "category": "ds", "line": 13, "summary": "v1 .maude .btn anatomy in @layer components overrides every v2 button (outlined Invite, lost Resend accent)", "fix": "Port the DS .btn/.btn--primary/.btn--ghost/.btn--sm into 3-kit-maude-v2.css and retire 4-components-maude.css buttons for v2 surfaces." },
    { "category": "ux", "line": 18, "summary": "Role menu clipped by the Share sheet's overflow:auto — Make owner / Remove hidden (share.css)", "fix": "Render the role menu in a portal/popover plane or drop overflow on the sheet body." }
  ],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```

Counting rule: one per table row (themes merged) + 5 unreachable-board blockers (co-follow, co-bring, co-spotlight, co-twelve, co-mention-notify). Unverified rows (not shot) are not counted.
