# design-critic — 11 Projects and Navigation · V2-8.5 stage B

_2026-10-22 · canvas: `.design/ui/v2/11 Projects and Navigation.tsx` (+ `.css`, `_kit.css`) · DS `.design/system/maude-v2/` · pairs: `.claude/worktrees/agent-a0a73ec7448623bcc/.scr/pairs/11-projects-and-navigation/` (all 16 paired ids read, dark full-size and light full-size for tab-b / home / organise / history; the other light pairs checked against the stage-A jpgs) · opt_out_scope: palette_

Lens: layout, spacing, sizes, type (family/size/weight/leading), colour/tokens, material, iconography, and every state the artboard draws. Fixture-only differences (content, seed names, people, the signed-out lane, the stubbed native tab-strip page) are **not findings**, and they're left out of the tables unless they hide a state.

## TL;DR

**Blockers: 38** · Warnings: 27 · Verdict: **fix-and-retry**

Every in-project artboard (pn-ds … pn-deeplink) inherits one root cause: the project shell still resolves the **v1 `maude` token ladder** (indigo accent at hue 268, Inter, radii 3/5/7/10/14, darker blue-grey bg) instead of maude-v2 (azure at hue 238, system-ui, radii 4/6/10/14/20). The lead's decision `v2-p8-c0-supersedes-a11y-no-v2-mount` already plans the fix. After that, the biggest structural gaps are these:

- Home has no docked Ask AI / Search palette.
- Toasts are one bottom-centre card with a left stripe, not the kit's one-line pill.
- Account tones are hashed in two different ways, so they don't match across surfaces.
- The jump list is 30 px where the board draws 22 px.
- The tab strip page uses hand-picked hex values and system chrome geometry, not the board's floating-pill tabs.

---

## pn-tab-b (strip.html stub; native chrome not in lane)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-tab-b · dark | strip background | `--bg-3` (dark oklch 0.300) | `--strip-bg #1c1c1f` (much darker) | apps/desktop/src/strip.html:52 | blocker |
| pn-tab-b · both | palette is hand-written hex/oklch, not DS tokens | DS tokens (`--bg-3`, `--fg-2`, `--accent`, `--canvas-bg`) | own `:root` vars | strip.html:19-75 | blocker |
| pn-tab-b · both | tab geometry | floating 30 px pill, `--radius-md`, inside a 40 px titlebar, name centred (`justify-content:center`) | 38 px row, tab full height with `7px 7px 0 0` top radius, name left-aligned | strip.html:92-124 · _kit.css:47-79 | blocker |
| pn-tab-b · both | active tab | `--canvas-bg` + `--shadow-sm` + inset hairline, **semibold** | flat `#2b2b30` / `#f8f8f9`, weight 400 | strip.html:128-131 | blocker |
| pn-tab-b · both | close × position | left of the square (`.k-tab-x` absolute left) | right end, after the mark | strip.js:219-235 | warning (decision may have moved it; the board was not updated) |
| pn-tab-b · both | separators between inactive tabs | 1 px `--border-default` hairline (`.k-tab + .k-tab::before`) | none (`--tab-sep` is used only on the bottom border) | strip.html:104-124 | warning |
| pn-tab-b · both | needs-you "?" | 16 px circle, `--accent` (azure 238), `--type-xs` semibold | 14 px, `#2f6bff` (saturated blue), 10 px | strip.html:31,156-169 | blocker |
| pn-tab-b · both | working spark | 18 px circle on `--spark-muted` | bare 12 px glyph in `#e8553a`, no bubble | strip.html:170-173 | blocker |
| pn-tab-b · both | account face W | Work = `sky` (ACCT.work.tone) | tone `b` = yellow (hue 80): `account_tone("work") → "b"` | src-tauri/src/tabs.rs:179 · strip.html:41-42,265 | blocker (see RC-3) |
| pn-tab-b · both | type | `--type-sm` 12 px, DS `--font-body` | 12 px system font: matches by value, not by token | strip.html:86 | warning |
| pn-tab-b · both | project square | 18 px Avatar sm, `--radius-xs` | 16 px, radius 4 | strip.html:227-237 | warning |

## pn-tab-b20

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-tab-b20 · both | "N more" control | 28 px chip, `--radius-md`, `--type-xs` medium, **chevron**, hover/open `--bg-4` | plain text "10 more", no chevron, top-rounded tab shape | strip.html:298-317 · strip.js:375 | blocker |
| pn-tab-b20 · both | dense tab | `flex: 0 1 116px`, left-aligned | `min-width:120px` | strip.html:112-124 | warning |
| pn-tab-b20 · both | resting ring | 8 px, 1.5 px `--fg-2` ring | 8 px, 1.5 px `--strip-fg-dim`: matches | — | ✓ |
| pn-tab-b20 · both | all the pn-tab-b rows above repeat here | | | | (counted once) |

## pn-switch-ai-strip · pn-relaunch-strip

The board draws these in **Variant A** (native titles only, `»`, no marks), while impl ships B (decision v2-3.7-own-tab-bar). That isn't an impl finding. **The board is stale**: sections 2-5 still draw A everywhere (`NativeWindow` in every Stage after line 1056). Compare the strip against pn-tab-b / pn-tab-b20 instead. Impl marks (spark, "?", done dot, ring) are present, with the pn-tab-b colour and size findings.

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-switch-ai-strip / pn-relaunch-strip · both | the board doesn't draw the variant that was picked | Variant A strip | Variant B strip | .design/ui/v2/11 Projects and Navigation.tsx:1056-1458 (NativeWindow) | warning (board debt) |

## pn-home (Home server, `.maude-v2` scope → v2 tokens resolve correctly)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-home · both | the scrolled page keeps Ask AI + "Start with an empty canvas ⌘N" docked at the top (`pn-askrow`, 560 px askbar) | present | HomeAsk is in the flow and scrolls away; the top bar has only pill + search | home/home-app.jsx:728-790 · home.css:205-215 | blocker |
| pn-home · both | Search in the top bar | icon-button island + ⌘K kbd (`.k-home-tr`) | 320 px search field island | home-app.jsx:737-742 · home.css:231-240 | blocker |
| pn-home · both | Home pill | ProjectPill with caret (the one menu, CONTRACT §1) | "Home" without caret | home-app.jsx:729-732 | blocker |
| pn-home · both | Recent canvases | 6 columns capped at one row + "See all" ghost button | auto-fill grid, wraps to 8 cards, no See all | home-app.jsx:862-925 · home.css:577-581 | blocker |
| pn-home · both | Projects header | aside + 180 px "Find a project" field + "Recent ▾" sort | aside only | home-app.jsx:943-952 | blocker |
| pn-home · both | project row | 44×30 thumb · name semibold sm · meta xs · trailing project square (or "Open" for cloud) | no trailing square (RowLive instead) | home-app.jsx:1236-1252 | blocker |
| pn-home · both | account face tones | Work = sky "W", Personal = yellow "P" | 5-tone hash: Work yellow, Personal lilac | home/home-model.js:394-403 · home-app.jsx:1170 | blocker (RC-3) |
| pn-home · both | Projects next to Shared with you | `.pn-two` 5fr/6fr | Projects full-width (Shared is hidden while signed out) | home.css:1385-1390 | fixture (lane is signed out). Shared/Pinned states are unverified |
| pn-home · both | project list foot | "15 more" · Open project… ⌘O | "New project… ⇧⌘N" + "Open project… ⌘O" | home-app.jsx:964-990 | warning (extra action not on the board) |
| pn-home · both | What's new line under the composer | none | `WhatsNewLine` pill | home-app.jsx:780-786 | warning (not on the board) |

## pn-home-search

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-home-search · both | ⌘K surface | centred 620 px palette over a Veil, field `--type-md` + esc | dropdown under the 320 px top-bar field, no veil | home-app.jsx:1348-1410 | blocker |
| pn-home-search · both | empty state groups | Recent searches · Open tabs · Recent canvases + Ask AI row + `↑↓ move ↵ open` foot | one line "Search every project on this Mac, open or not." + aside | home-app.jsx:1379-1405 | blocker (Recent searches exist when there is history. Open tabs / Recent canvases / Ask AI / foot are missing) |

## pn-ds

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-ds · both | DS row icon | `system` glyph (4-square grid), `--accent-text` on `--accent-muted` | `sliders` glyph, `--fg-0` | v2/left-panel/canvases-pinned.jsx:80 · left-panel.css:108-117 | blocker |
| pn-ds · both | DS row separation | `inset 0 -0.5px 0 var(--border-default)` hairline under the row | none | left-panel.css (lp-ds) | warning |
| pn-ds · both | panel width | 264 (PnPanel) / 248 (kit `.k-cp`) | ≈236 inside the 252 px sidebar | styles/3-shell-maude.css:257-258 | warning |
| pn-ds · both | panel extras not on the board | — | "+ / new folder" row, kind-filter chip row (All N · 📱 · web · print · video), Advanced fold, project-switch footer | v2/canvases/canvases-panel.jsx:141ff | warning |
| pn-ds · both | panel search hint | "Search" + ⌘K | "Search canvases…" + `/` | canvases panel search | warning |
| pn-ds · both | inspector "Uses …" link (way 3) | drawn | not shot | — | unverified |

## pn-ds-search · pn-k-across · pn-k-close (⌘K palette)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| all three · both | field trailing key | `esc` | `⌘K` | dialogs/command-palette.jsx:442 | blocker |
| all three · both | field size / icon colour | `--type-md` 17 px, search icon `--accent-text` | `--type-lg` 20 px, icon `--fg-2` | styles/3-shell-maude.css:1265-1282 | warning |
| all three · both | palette width | 620 | 640 | v2/search/search.css:7-9 | warning |
| all three · both | row | min-height 36, `--radius-md`, selected `--accent-muted` | ≈42 (`padding: --space-3`), `--radius-sm`, selected `--accent-tint` | 3-shell-maude.css:1307-1326 | warning |
| all three · both | selected row icon | stays `--bg-3` tile | fills `--accent` + `--accent-fg` | 3-shell-maude.css:1344-1347 | blocker |
| all three · both | row icon tile | 24 px `--bg-3` | 26 px `--bg-4` | 3-shell-maude.css:1335-1343 | warning |
| pn-k-across / pn-k-close · both | canvas thumbnail | 32×22 (`.k-thumb--pal`) | 26×26 square, or the doc glyph when there is no cover (stub had no covers) | v2/search/search.css (st-pal-thumb) | warning |
| pn-k-across · both | "where" breadcrumb | `.chip` | bg-3 pill: matches | search.css:90-111 | ✓ |
| pn-k-close · both | close-match note | `.pn-pal-note`: `--bg-3` box, `--radius-md`, search icon, `--type-xs` `--fg-1` | plain `--type-sm` `--fg-2` line, no box, no icon | v2/search/search.css:182-188 · command-palette.jsx:321-327 | blocker |
| pn-k-close · both | artboard row glyph | the artboard's KIND icon (print → printer) | generic artboard square | search model row icon | blocker |
| pn-ds-search · both | DS result row | `system` glyph | `sliders` glyph | v2/search/search-ds.js | blocker |

## pn-organise

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-organise · both | current row | DS `row-item[aria-current]`: `--accent-muted` + **semibold** | `--accent-tint`, regular weight | v2/canvases/canvases.css:76-79 | blocker |
| pn-organise · both | canvas row thumb | 28×20 (`.k-thumb--row`) | 20×20 square, empty `--bg-3` box when there is no cover | canvases.css:182-189 · canvases-panel.jsx:992-1005 | warning (no-cover fallback is an empty square, so every row reads as blank) |
| pn-organise · both | row radius | `--radius-sm` | `--radius-xs` | canvases.css:69 | warning |
| pn-organise · both | Sort menu rows | `.k-mi` min-height 28, highlighted row `--accent-muted` | padding `--space-1` ≈24 px, no highlight on the checked row | canvases.css:346-366 | warning |
| pn-organise · both | Sort menu anchor | opens leftward over the tree | opens rightward past the panel edge | canvases-panel.jsx:349-352 | warning |

## pn-move

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-move · both | rename field + "↵ rename · esc keep" hint | ring, kbd chips | matches (token ladder aside, RC-1) | v2/canvases/inline-rename.jsx | ✓ |
| pn-move · both | drag ghost + "Move here" drop tag (`accent-muted` + accent ring) | drawn | not driven in the lane (`canvases-drop-tag` exists) | canvases.css:87-90 | unverified |
| pn-move · both | "Double-click a name" tooltip | drawn | not shot | — | unverified |

## pn-trash

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-trash · both | Today / Earlier headings | sentence case, `--type-xs` semibold `--fg-2` | **UPPERCASE** + 0.04em tracking | v2/left-panel/left-panel.css:264-271 | blocker |
| pn-trash · both | trash row | thumbnail + name + "root · You, just now", Restore on the selected row | no thumbnail. Restore shows only on hover (the hover state matches the board) | v2/left-panel/trash-view.jsx:159-185 | blocker (thumb) |
| pn-trash · both | header | "‹ Trash" + "3 canvases · 1 artboard" | "‹ Trash" + "1 canvas": matches | — | ✓ |
| pn-trash · both | toast | one-line kit Toast: trash icon · text · Undo in `--accent-text`, min-height 40, centred above the dock | 360 px card, 3 px accent left rule, title 600, Undo on its own line, × close | apps/studio/notifications.tsx:224-240 | blocker (RC-2) |
| pn-trash · both | row menu, "Clear out the trash?" confirm, owner-only tooltip | drawn | not shot | trash-view.jsx:190-215 | unverified |

## pn-jump

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-jump · both | artboard row height | 22 px (`.row-item.pn-ab` min-height 22) | 30 px (shared `ROW_H`) | v2/canvases/tree-model.js:23 | blocker (6 rows visible where the board shows 19) |
| pn-jump · both | artboard row type | `--type-xs`, `--fg-1`. Current row `--fg-0` + kind icon `--accent-text` | `--type-sm`. Current weight 500, icon `--accent` | canvases.css:601-609 | blocker |
| pn-jump · both | expanded canvas row | 28×20 thumb + count "21" | no count | canvases-panel.jsx:1099-1105 | warning |

## pn-history

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-history · both | panel width | 372 (`.pn-vh`) | ≈281–304 (right dock) | styles/3-shell-maude.css:230-232 | blocker |
| pn-history · both | **Now row while viewing a version** | column: "Now" sm medium over "Uniformy-2027 · Saved" xs fg-2 | the row loses its layout. `.vh-row`'s `font: inherit` / `display:flex` (declared later) beat `.vh-now-t`, so "Now" floats centred and the status renders at body size and wraps | v2/history/history.css:83-104 vs 126-140 | blocker |
| pn-history · both | selected version | `--accent-muted` (row-item aria-current) | `--accent-tint` | history.css:145-148 | warning |
| pn-history · both | row thumbnails | rendered pictures 72×54 | empty `--bg-2` boxes (dark) / white (compare): pictures not rendered in the lane | history.css:207-215 | warning (size matches. The ready state was never seen) |
| pn-history · both | sub line clipped mid-word at the panel edge | ellipsis | "changed outside the a|" | history.css:179-183 (fix noted "P8 B1", check it's in the shot build) | warning |
| pn-history · both | Compare button | ghost + eye icon | bordered, no icon | v2/history/history-panel.jsx:146 | warning |
| pn-history · both | Named / Made by AI / Restored chips, author faces | drawn | none (all rows are "You · changed outside the app") | — | fixture |

## pn-compare

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-compare · both | A/B marks | 18 px `--accent` **circle** on the thumbnail's left edge (`.pn-vh-mark`) | 16 px rounded-square chip inline before the title. "B" floats above "Now" | history.css:415-428 | blocker |
| pn-compare · both | stage | the canvas stays. A/B are the artboard label row (B as an accent pill), and the change list is a 660 px floating island | split panes with framed copies (`.cmp-frame` border) and a semibold caption that clips at the top | history.css:497-525 · compare-view.jsx | blocker |
| pn-compare · both | change list rows | plain rows: 7 px accent dot · board · change · author right | every row on an accent-tint band, "changed in between" in place of the author | history.css:615-630 · change-list.jsx | blocker |
| pn-compare · both | Restore sentence + 3 buttons | present | present (Stop comparing / Restore only … / Restore this version) | — | ✓ |

## pn-switch-ai

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-switch-ai · both | keys sheet | 460 px single column, title `--type-md` + find field, **Tabs and windows** first, then Finding a canvas | ≈880 px, 3 flowing columns, 92 keys. Tabs and windows is below the fold | dialogs/shortcuts-overlay.jsx · v2/search/search.css:270-272 | blocker (06 ad-search draws the full sheet, so the two boards disagree. Pick one) |
| pn-switch-ai · both | key caps | `Kbd` chips | right-aligned plain glyph strings | shortcuts-overlay.jsx | warning |
| pn-switch-ai · both | Mac notification, AI "done" dot | drawn | native, not in the lane | — | unverified |

## pn-relaunch

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-relaunch · both | toast placement / form | **top**-centre (`k-toast--top`), one line, tabs icon, no × | bottom-centre 360 px card, accent left rule, 600 weight, wraps to 2 lines, × | notifications.tsx:224-240, 293-297 · hooks/use-tabs.jsx:138 | blocker (RC-2) |

## pn-deeplink

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| pn-deeplink · both | "Opened from Tereza's link — Pozvánka · story." top toast | drawn | not in the shot (words exist: shell-events.js:40-53). When it fires it takes the RC-2 form | shell-events.js:122-140 · notifications.tsx | blocker |
| pn-deeplink · both | landing comment popover on the artboard | drawn | needs a comment fixture | — | unverified |
| pn-deeplink · both | selected-artboard ring | 2 px `--accent` (azure) | periwinkle (v1 accent, RC-1) | — | (RC-1) |

## In-shell rows shared by pn-ds … pn-deeplink (counted once)

| ids · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| 12 in-shell ids · both | token ladder | maude-v2: `--accent` oklch(0.53/0.54 0.17 238) azure, `--font-body` system-ui, radii 4/6/10/14/20, bg ladder hue 250 (dark bg-0 0.205) | v1 `maude`: accent oklch(0.68 0.18 268) indigo, Inter, radii 3/5/7/10/14, bg-0 0.165 hue 255. Visible on Share, Restore, the selected ring, chips and the kind filter | app.jsx:2984 (`className='maude'`, no `maude-v2`) · styles/1-tokens-maude.css:23-94 · styles/_index.css (v2 ladder inert) | blocker (RC-1) |
| same · both | left panel | floats (`.k-cp` top 68, ends above the Zoom/Undo island) | full height to the bottom, project-switch footer. Zoom/Undo island not visible bottom-left | styles/3-shell-maude.css:257-270 | warning (owned with 04/14) |

## Not reachable (findings: the state does not exist yet)

| id | product work that makes it reachable |
|---|---|
| pn-tab-a, pn-tab-a20 | none. Superseded by v2-3.7-own-tab-bar. Retire them or mark them on the board |
| pn-ab | a decision board, no UI. Update it to record the B pick |
| pn-tab-menu | the tab menu is a native NSMenu (`tab_menu_rows`, tabs.rs). Needs a native-e2e screenshot lane (apps/desktop/e2e) to verify |
| pn-windows | drag-out / merge are not shipped (decision). Open-once exists in Rust. Needs native e2e |
| pn-accounts | build the account card by the faces (S1.21-accounts GAP) and a second-account fixture |
| pn-cant-open | Rust shell detection of a moved root + hub access-removed / downgraded-to-Can-view states. Home already has a "isn't where it was · Find the folder…" row (home-app.jsx:1208-1225) that was not shot |

---

## Root causes hitting several artboards

1. **RC-1: the shell is still on the v1 `maude` ladder.** `.maude` without `.maude-v2` (app.jsx:2984). 1-tokens-maude-v2.css is inert in the shell, and 1-tokens-maude-v2-shell.css only fills the gaps. Wrong accent hue, font, radii and bg on all 12 in-shell ids. Decision `v2-p8-c0-supersedes-a11y-no-v2-mount` covers the flip.
2. **RC-2: one notification card for every toast.** notifications.tsx:224-240 is a sonner card (360 px, 3 px left rule, title 600, action on its own line, ×, always bottom-centre). The kit `Toast` is a one-line pill with an icon, an inline `--accent-text` action and `at="top"` for shell events. Hits pn-trash, pn-relaunch, pn-deeplink.
3. **RC-3: account tones are hashed in three ways.** Home uses 5 tones (home-model.js:394), the strip and account card use 2 (account-card-model.js:40 + tabs.rs:179), and the board uses a fixed one (Work sky / Personal yellow). The same account changes colour between Home and the strip, which breaks CONTRACT "One form everywhere".
4. **RC-4: the strip page has its own palette and geometry.** strip.html:19-131 uses hex/system values and top-rounded full-height tabs instead of the board's floating pill tabs on `--bg-3`. Hits pn-tab-b, pn-tab-b20 and both strip pairs.
5. **RC-5: the palette and panel rows come from the v1 kit.** Shell `.st-pal-*` and `.cv-*` rows use `--accent-tint` / `--radius-xs|sm` / 20×20 thumbs, where DS `row-item` + kit `k-pal-row` / `k-thumb--row` use `--accent-muted` + semibold, `--radius-sm|md`, 36 / 22 px rows and 28×20 / 32×22 thumbs. Hits pn-ds-search, pn-k-*, pn-organise, pn-jump, pn-history.
6. **RC-6: missing thumbnails read as blank boxes.** The no-cover fallback in the panel, trash, history and palette is an empty square, so in a lane without renders every row looks broken. The board never draws a no-picture state. Propose the kind glyph.
7. **RC-7: Home's top bar was built for the un-scrolled hero only.** There is no docked Ask AI, Search is a field rather than a palette, and the pill has no caret. Hits pn-home and pn-home-search.
8. **RC-8: the board is stale for the tab pick.** Sections 2-5 still draw Variant A. pn-switch-ai-strip and pn-relaunch-strip compare A against B.

---

## Verdict

```json
{
  "canvas": "11 Projects and Navigation",
  "critic": "design-critic",
  "agent": "design-critic",
  "iter": 1,
  "blockers": 38,
  "warnings": 27,
  "top_blockers": [
    { "category": "ds-tokens", "line": 2984, "summary": "Shell resolves the v1 maude ladder (indigo 268, Inter, radii 3/5/7) on every in-project artboard (app.jsx:2984)", "fix": "Mount maude-v2 on the shell (decision C0)." },
    { "category": "ds", "line": 224, "summary": "Toasts are a bottom-centre left-ruled card, not the kit one-line pill; relaunch/deeplink belong at the top (notifications.tsx:224)", "fix": "Restyle the notice as the kit Toast with a top placement for shell events." },
    { "category": "ux", "line": 728, "summary": "Home scrolled has no docked Ask AI; Search is a field + dropdown, not the centred palette (home-app.jsx:728-790,1348)", "fix": "Dock the askbar; open the shared palette from ⌘K." },
    { "category": "ds-tokens", "line": 179, "summary": "Account tones are hashed in two different ways (5-tone Home vs 2-tone strip); Work/Personal change colour (tabs.rs:179, home-model.js:394)", "fix": "Use one tone source per account." },
    { "category": "ds", "line": 23, "summary": "Jump-list artboard rows are 30px/type-sm instead of 22px/type-xs (tree-model.js:23, canvases.css:601)", "fix": "Give board rows their own height and xs type." }
  ],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false,
  "verified_ids": []
}
```
