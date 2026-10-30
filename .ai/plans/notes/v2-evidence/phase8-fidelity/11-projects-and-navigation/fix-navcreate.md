# C8 nav (rest) + C11 create/onboarding/empty — fix report, stage C round 2 (branch p8-c2-navcreate)

Budget stop (stage C round 2 order). **Stage D (re-shoots) was NOT done**: no artboard is marked fixed here and
the pairs/INDEX are unchanged — the shared test lane was held by a full-suite run for the whole session, and the
harness boots a project server per shot. Everything below is code + tests; the lead's critic re-check needs a
re-shoot of `11 pn-*`, `02 ob-*`, `05 es-*`, `01 cf-*` from the stage-A harnesses.

## Done (commits on p8-c2-navcreate)

| area | item | where |
|---|---|---|
| C8 Home | slim ask row is `position: fixed` in the header's row (never scrolls away); search = icon + ⌘K island; ⌘K opens a centred 620 palette over a veil (field type-md + `esc`, Recent searches · Open tabs (with AI) · Recent canvases, Ask AI row ⌘↵, ↑↓ ↵ foot, close-match note box) | `home/home-app.jsx` `HomeSearch`, `home.css` |
| C8 Home | Recent = one row of six + **See all**; Projects header has **Find a project** + **Recent/Name** sort; trailing project square on every local row; Pinned aside says "from its row or its menu"; signed-in account face (circle) top right | `home-app.jsx`, `home.css` |
| C8 tones | ONE account-tone function (`client/shell/account-tone.js`): Work sky, Personal/default yellow, others hashed; used by Home face, Share chip + card, and `tabs.rs account_tone(id, label)` (strip badge); table pinned on both sides | `account-tone.js`, `home-model.js`, `account-card-model.js`, `share-cluster.css`, `tabs.rs`, `strip.js/html` |
| C8 tab strip | strip variables are the DS ladder (`scripts/gen-tokens.mjs` STRIP_NAMES grew: bg-3/4, fg-0..2, borders, shadow-sm, canvas-bg, spark-muted, accent-text/muted); floating radius-md pill tabs, active = canvas-bg + shadow-sm + hairline + semibold, separators, × at the left, 16 px `?` circle, 18 px spark disc, 18 px squares, **"N more" chip with chevron**, 28 px | `apps/desktop/src/strip.html`, `strip.js` |
| C8 panel | artboard (jump) rows 22 px / type-xs, current board fg-0 + accent-text icon (`BOARD_H`); current canvas row accent-muted + semibold on radius-sm; row thumb 28×20 with a drawn page when there is no picture | `tree-model.js`, `canvases.css` |
| C8 ⌘K | 620 wide, field type-md + accent-text glyph, **`esc`** key (was ⌘K), rows 36 px radius-md, selected accent-muted + semibold with the tile staying bg-3, close-match note = bg-3 box + search glyph, artboard rows wear their KIND glyph (print → printer), DS rows the `system` glyph, Start-here rows plus/folder/insert/help (no chevron fallback), situation line Rounded type-md | `search.css`, `command-palette.jsx`, `search-model/ds/recent.js`, `shell/icons.jsx` (+frame, print, system, insert) |
| C8 trash | headings sentence case (no uppercase), Restore on every row without hover, a thumbnail leads the name; empty line = the kit block | `left-panel.css`, `trash-view.jsx` |
| C8 history | Now-row cascade clash fixed (`button.vh-now-t.vh-row` keeps its column), panel 372 wide, selected/focus rows accent-muted, A/B marks are 18 px circles on the picture's edge, Compare = ghost + eye | `history.css`, `history-panel.jsx`, `app.jsx` |
| C8 deep link | a `shell://navigate` to an artboard toasts "Opened from a link — Canvas · artboard." (thread landings keep their own line) | `shell-events.js` |
| C11 copy | "Enter a code instead"; the app does not name itself ("cloud.maude.sh could not be reached…", Settings › Connections row title); "Yours · Owner" instead of "You's · Can edit"; Advanced flyout foot has a `Kbd` ⌘K; the held-render bar is English | `signin-model.js`, `invite-flow.js`, `home-app.jsx`, `home-model.js` (`ownerWord`), `connections-section.jsx`, `SignInCard.jsx`, `canvas-comment-mount.tsx` |
| C11 material | sheet fields = bg-3 well on radius-md, pressed segment has the accent ring; offline line is `--status-warn-text`; in-panel empty block type-base over xs fg-2; Exports glyph arrow points down; render-error card 460 wide, radius-xl, 36 px icon tile, type-md title | `onboarding.css`, `home.css`, `empty.css/jsx`, `code.css` |

## Tests (fail-first where behaviour changed)
`p8-c2-account-tone.test.ts` (tone table both sides, 3 surfaces), `p8-c2-nav-panels.test.ts` (rows, trash, history, ⌘K words/glyphs, deep-link toast, strip pins), `p8-c2-nav-home.test.tsx` (palette, See all, Find/sort, docked ask CSS), `p8-c2-create-copy.test.ts` (words + materials). Edited: `home-page.test.tsx` (the field is in the palette now), `desktop-strip.test.ts` (tone `sky`).
Red→green: see the hand-back (run in the shared lane).

## Board fixes (rule: owning board wins / contract over board)
- 02 `ob-first-launch/-signin-browser/-adv-open/-edge-timeout/-local-name` chip: "a new project" → "a project on this Mac" when signed out (05 es-home-local + the S6.4 contract own the chip; "a new project" is signed-in + online only).

## Still open (in priority order)
- **Stage D** for all four canvases (see top).
- Home: `WhatsNewLine` text/version, Home sheets other than Create (InviteSheet, WhatsNewDialog, connect modal) without the Tab trap, projects "15 more" foot, profile group order (Work first), InviteSheet team badge (02 ob-edge-accounts), Shared/Projects stacked-vs-two-column (11 wins: boards 05/02 need the two-column draw), "Nothing shared with you yet." beside a shared project (copy ruling), target chip default for a cloud project not on this Mac.
- Board debt (11 wins, not edited): 01/02/05 draw Home 880 wide with a dot grid; 11 pn-home is 1080, no dots (`_kit.css:802` `.k-home`, `Canvas dots`). Sections 2-5 of board 11 still draw tab Variant A (`NativeWindow`); retire pn-tab-a/pn-tab-a20/pn-ab or mark them.
- Panel: kind chips / "+ New canvas" row / floating island (owned with 04/14), DS card "used by N projects", ⌘K group caps (3 canvases → Tools → Ask AI), thumbnails in ⌘K rows 32×22, panel-search flattening (01 cf-panel-search).
- History: stage = canvas stays with A/B label row + 660 px change island (compare view still two framed panes), human version titles + Named / Made by AI chips need real data, keys sheet "Tabs and windows" first (06 ad-search draws the full sheet — ruling needed).
- Create (01): AI rims (spark dashed ring, "Made by AI" label row — chrome/chat builders), duplicate-at-width placement + measure pill, menu icon column, ⌘0 fit clips the last row, Recent block + opening the last canvas in a big project, Share enabled in a local project, status words beyond "Local project", undo of an AI edit through the shared stack (`cf-undo-ai` unreachable).
- Onboarding (02): Connect sheet as a centred modal over a strong veil (AI-chat builder owns `ConnectSheet`), Connect-AI radio list, Figma sheet link field, Settings › Account block + Connections rows + "AI — your Claude account" row, invite landing on the comment's thread (`ob-invite-landed`, `ob-sig-draw`, `ob-local-moved` unreachable).
- Empty (05): Assets drop-zone frame, AI chat empty spot + chips (chat builder), `SkeletonArtboard` / `AllTrashed` never mounted, new-artboard selection for the hint card + empty Layers line, empty timeline structure (timeline builder), dark `es-landing` re-capture, `st-not-local` stand-in paints v1 `--u-bg-0` (dot grid), arriving progress bar, comments panel (no filter segment on "none", confetti density, share glyph).
- Toast pill (RC-2) is C1-kit's; `Restore` uses `btn--primary` on every row (the board shows it on the selected row only).

## Decisions
- `decision:maude/v2-8.5-c8-account-tone-one-function` — a shared `accountTone(id, label)` (named accounts fixed, rest hashed over the object palette) with a Rust twin pinned by a shared fixture table; rejected: keeping a/b on the strip and mapping per surface; reading the tone from the server.
- `decision:maude/v2-8.5-c8-home-palette-modal` — Home ⌘K is a modal dialog (veil, one tab stop, arrows walk rows, ⌘↵ = Ask AI) replacing the field+dropdown; rejected: restyling the dropdown (board draws a centred palette).
- `decision:maude/v2-8.5-c8-strip-height-stays-38` — pills fit the 38 px native row; the board's 40 px would move `STRIP_H` and the desktop e2e geometry; rejected for this round.
- `decision:maude/v2-8.5-c11-chip-word-follows-05` — the Home target chip says "a project on this Mac" signed out (impl + 05 + S6.4); board 02 was edited.
