# a11y-critic — 11 Projects and Navigation (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/11 Projects and Navigation.tsx` · impl = stage A frames · standard: WCAG 2.1 AA (no project a11y-rules skill; the DS token notes are the only project rules)_

Method: every pair read full-size, both themes. Contrast was **measured on the raw impl frames** (`.scr/impl/11-projects-and-navigation/*.png`, 1440 px). The pair images for `pn-ds`, `pn-ds-search` and `pn-k-close` scale the impl half down, which made a first pass read fg-2 as 3.2–3.6:1. Re-measured on the raw frames it is 5.4–5.9:1. Use the raw frames for any pixel check. The tab-strip pages (`apps/desktop/src/strip.html` + `strip.js`) were measured from the `strip-*` frames.

Global facts:
- The **project shell** paints on the v1 indigo ladder (`client/styles/1-tokens-maude.css`). **Home** (`client/home/home-app.jsx:727`, `class="maude-v2"`) paints on the v2 azure ladder: measured #a1a5a9 / #39b0f1 / #60656a / #0062ad, the exact v2 values. The **tab strip** uses its own hard-coded hexes (`strip.html:8-40`: `--dot-needs:#2f6bff`, `--dot-working:#e8553a`, `--strip-fg-dim:#77777e/#7d7d85`, `--focus:#4a7dff`). That gives three palettes in one window.
- Shell text fg-1 / fg-2 measured 8.7–9.4 / 5.4–5.9:1 (dark) and 8.9–9.2 / 5.6–5.8:1 (light). Passes except the rows below.
- Focus: shell ring `3-shell-maude.css:4880` (passes 3:1). Strip ring `inset 2px #4a7dff` gives 4.59:1 dark, **3.06:1 light** (passes narrowly). Palette, shortcuts and Home dialogs are `role=dialog aria-modal` with a focus trap (`command-palette.jsx:80,397`, `shortcuts-overlay.jsx:82`).
- Reduced motion: the shell collapses `--dur-*`. The strip gates its spark pulse and transitions behind `prefers-reduced-motion: no-preference` (`strip.html:74,174,442,448`). Passes.

## pn-tab-b (strip page, partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | The "AI working" spark fails 3:1 as a graphic, and there is no tinted disc behind it | spark on a spark-muted disc | bare `#e8553a` glyph on #e9e9eb = **2.99:1**, pulsing to opacity 0.45 (≈1.75:1) | `apps/desktop/src/strip.html:32,170-182` | blocker |
| dark | same spark | disc | 4.69:1 at rest, ≈2.0:1 at the bottom of the pulse | same | warning |
| dark · light | "?" needs-you: white 10 px/600 on #2f6bff = 4.50:1 (at the limit); the fill is 3.7–3.8:1 against the strip | azure badge | as described | `strip.html:31,166-169` | warning |
| dark · light | Account badge, squares, close × | W badge sky | W amber, dark ink 5.2 / 7.1:1; × 12.5 / 17.8:1 | — | — |

ARIA: `nav aria-label=Tabs` › `role=tablist` › `role=tab` + `aria-selected`, roving keys, Enter/Space, ContextMenu/⇧F10 opens the tab menu (`strip.js:201,223,261-271`). Dots carry `aria-label`. Good.

## pn-tab-b20 (strip page, partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Resting tabs dim their **name text** below AA | names in the same tone as other inactive tabs (spec inactive 4.9 / 4.45:1) | `.tab.resting .name{color:var(--strip-fg-dim)}`: **4.16:1 dark, 3.67:1 light** (13 px) | `strip.html:22,54,137-139` | blocker |
| light | Done dot #3fa35b on #e9e9eb = **2.62:1**, and the spark as in pn-tab-b | ≥3:1 marks | fails 1.4.11 | `strip.html:29,152` | blocker |
| dark · light | Resting ring: a 1.5 px stroke, 3.67:1 as specified, renders ≈2.9–3.3:1 | — | thin stroke | `strip.html:268-275` | warning |
| dark · light | "10 more" vs "»" list; `aria-haspopup=listbox` + the overview `role=dialog` with a labelled find field (`strip.html:485-507`) | » | text button (better for a11y) | — | — |

## pn-switch-ai-strip (strip page)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Spark 2.99:1 and done dot 2.62:1 (same cause as pn-tab-b/b20) | — | — | `strip.html:29,32` | blocker |
| dark | none in lens | — | marks 4.7 / 5.3:1, "?" 4.5:1 | — | ✓ |

## pn-relaunch-strip (strip page)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | 19 resting tabs, every name at **4.05:1 dark / 3.61:1 light** | plain names like the other tabs | `.tab.resting .name` dim | `strip.html:137-139` | blocker |

## pn-home (Home page, partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Projects shelf has no "Find a project" field and no sort control (Recent ▾), so neither control is keyboard-reachable | field + Recent ▾ in the Projects header | absent | `client/home/home-app.jsx:943-990` | blocker |
| dark · light | "Shared with you" shelf (role chips Can edit / Can comment / Can view, in words) and the Pinned shelf not on screen | drawn | lane is signed out / nothing pinned. The code exists (`home/Shelves.jsx:145`, `home-app.jsx:826`) | lane: a signed-in hub fake + one pinned canvas | blocker (state not shown) |
| dark · light | Board defect: project meta "93 canvases · in a tab" measures 4.16:1 dark / 2.99:1 light on the board | — | impl fg-2 6.67 / 5.81:1 | board Projects list | warning (spec-side) |

Landmarks: `header`, `main aria-label=Home`, visually hidden `h1`, `section aria-labelledby` + `h2` per shelf (`home-app.jsx:728-947`). Good.

## pn-home-search (Home ⌘K)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | ⌘K on Home focuses the top-bar field and shows a one-line hint. No palette dialog, no listbox of Recent searches / Open tabs / Recent canvases, no ↑↓/↵ footer | modal palette with 3 groups | `role=combobox` field + hint only (`home-app.jsx:1358-1431`; options appear only after typing) | Home search | blocker |

Hint 5.97 / 5.89:1, field placeholder 6.6 / 5.8:1.

## pn-ds ✓ · pn-ds-search ✓
Two compact DS rows instead of one card (structure, other critic). In lens: meta 5.86 / 5.77:1, "2 in use" 5.4 / 5.2:1. Palette rows: unselected meta 5.41 / 5.56:1, selected meta switches to fg-1 (6.81 / 7.47:1, `search.css:86`). Options `role=option` + `aria-activedescendant`. No differences in lens.

## pn-organise ✓
Sort menu `role=menu` + `menuitemradio aria-checked`, focus to the checked item, ↑↓ (`canvases-panel.jsx:385-391,626-649`). The Sort button sits outside `role=tree` (axe-clean). Text 5.2–8.9:1, pin glyph 4.66 / 4.87:1. The missing avatar badge on the pinned row is (fixture: no peers).

## pn-move (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | The rename hint "↵ rename · esc keep" is absolutely positioned over the next row (VideoTranscript is hidden under it) | hint below the field, the next row pushed down | `.cv-rename-hint{position:absolute;top:calc(100% - 2px)}` | `client/v2/canvases/canvases.css:496-504` | warning |
| dark · light | Hint not tied to the input (only the error gets `aria-describedby`) | — | `inline-rename.jsx:91-93` | same | warning |
| dark · light | Drag "Move here" target not driven; keyboard path "Move to…" exists (`move-sheet.jsx`) | — | — | — | — |

## pn-trash (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Restore is invisible until hover/focus (`opacity:0`). The board shows it on the row; a pointer user without hover cannot see it | visible primary Restore | hidden | `client/v2/left-panel/left-panel.css:272-280` | blocker |
| dark · light | "Clear out the trash?" confirm + owner-only tip not shot (code: `trash-view.jsx:193` `role=alertdialog`) | drawn | unverified | — | warning |
| dark | Board defect: "Clear out" white on #f2696a = **3.00:1** | — | impl `btn--danger` text 4.94:1 (outlined) | board confirm | warning (spec-side) |

Row meta 5.86 / 5.77:1, Undo 13.6 / 9.3:1. The empty canvas ("No canvas open") is (fixture).

## pn-jump ✓
Jump rows 9.4 / 9.2:1, frame glyphs 3.8 / 3.4:1 (non-text ≥3), foot 5.6 / 5.5:1. No differences in lens.

## pn-k-across · pn-k-close

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light (both) | The field's key hint shows `⌘K`, not `esc`, so the way out is not shown | `esc` keycap | `<Kbd>⌘K</Kbd>` | `client/dialogs/command-palette.jsx:444` | warning |
| dark · light | "This tab" group absent | — | (fixture: no match in this project) | — | — |

Meta 5.41 / 5.56:1, path chip 4.85 / 5.05:1, selected row fg-1 6.8 / 7.5:1, close-match notice `role=status` (`command-palette.jsx:321`).

## pn-history

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Filter segment (All / Named / Made by AI / People): the pressed segment has no accent ring. Fill vs track ≈1.1:1, so the state shows only through text weight | kit `.k-seg-b[aria-pressed]` with an accent hairline | `.vh-seg-b[aria-pressed=true]{background:var(--bg-1)}` | `client/v2/history/history.css:35-49` | blocker |
| dark · light | Row text clipped mid-word with no ellipsis ("changed outside the ap") | ellipsis | hard clip | `history.css` row meta | warning |
| dark · light | Thumbnails empty, no Named / Made by AI chips | — | (fixture: no renders / no AI versions) | — | — |

## pn-compare

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Unpressed "Overlay" segment text fails | fg-1 on the segment | `.vh-seg-b{color:var(--fg-2)}` on its track = **4.22:1 dark / 4.22:1 light** (11 px) | `history.css:35-39` + `compare-view.jsx:158-170` | blocker |
| dark | "changed in between" (fg-3 on the accent-tint row) 4.48:1 | — | `.cmp-who.is-none{color:var(--fg-3)}` | `history.css:612-614` | warning (near) |

Change list: `ul aria-label=Changes`, real buttons per line, focus outline inset (`history.css:577`).

## pn-switch-ai (keys sheet)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Sheet rows paint through and below the sticky foot. "close with esc" overlaps "New project…" / "Hide panels", and rows continue past the sheet edge | foot sits on an opaque edge | overlap | `client/v2/search/search.css:211-219,284-291` (`.so-overlay--v2` sticky foot) | blocker |
| dark · light | "Tabs and windows" / "Finding a canvas" groups not in the first screen (3-column sheet; they need a scroll) | the sheet opens on them | Edit tools first | `client/v2/search/help-model.js` group order | warning |
| dark · light | Find field shows the UA focus rectangle inside the pill | pill focus | visible (OK) but off-style | `search.css:239-248` | warning |

Mac "AI is done" banner is native (unreachable in this lane).

## pn-relaunch ✓
Toast words exact, 14.7 / 16.5:1, sonner live region, labelled ×, pauses on hover/focus (`notifications.tsx:126-131,280-290`). Position (bottom-centre card vs top pill) is not an a11y difference.

## pn-deeplink (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | No "Opened from Tereza's link — Pozvánka · story." announcement and no comment landing: the arrival is silent for a screen reader | top toast + the comment popover | artboard selected only | deep-link landing (`take_pending_navigate` consumer, shell) | blocker |

## Unreachable
- **pn-tab-menu**: native NSMenu (`tabs.rs` `tab_menu_rows`). Reachable only through the desktop e2e harness (`apps/desktop/e2e`). Native menus are accessible by construction, but the rows are unverified. Blocker ×2.
- **pn-windows**: drag-out / merge not shipped. Needs the multi-window work, or the board marked as not-planned. Blocker ×2.
- **pn-accounts**: the account card by the faces is not built (S1.21-accounts GAP). Blocker ×2.
- **pn-cant-open**: needs a moved-root state in the Rust shell plus hub removal / role-change. The access-ended card shares `access-card.jsx`, which has the modal gaps found on canvas 10. Blocker ×2.
- **pn-tab-a · pn-tab-a20 · pn-ab**: superseded variant A + a decision board (decision v2-3.7-own-tab-bar). No product work makes them reachable. Not counted; the board could drop them.

## Root causes
1. **The tab strip has its own palette.** Its hard-coded hexes (`strip.html:8-60`) put resting names at 3.6–4.2:1 and the spark/done marks at 2.6–3.0:1 in light. Generate the strip vars from the v2 tokens (spark-text / status-success-text / fg-2).
2. **Segments without the kit's pressed ring.** `history.css:46` (and share's `share.css:99`) re-implement `.seg` and drop `inset 0 0 0 1px var(--accent)`. The unpressed text is also fg-2 on a tinted track (4.22:1).
3. **Hover-only primary actions.** Trash Restore at `opacity:0` (`left-panel.css:274`).
4. **Sticky foot over a scroller.** The shortcuts sheet foot does not mask the rows (`search.css:284`).
5. **Home lacks the board's Projects controls and the ⌘K palette.** Find a project, sort, and Home's palette groups are absent.
6. **Silent arrival states.** The deep-link landing has no announcement.
7. **Three palettes in one window.** Shell v1 indigo, Home v2 azure, strip hex. Contrast holds in shell and Home, but the focus ring and accent hue change between them.

```json
{"canvas":"11 Projects and Navigation","critic":"a11y-critic","blockers":31,"warnings":25,"verified_ids":["pn-ds·dark","pn-ds·light","pn-ds-search·dark","pn-ds-search·light","pn-organise·dark","pn-organise·light","pn-jump·dark","pn-jump·light","pn-relaunch·dark","pn-relaunch·light","pn-switch-ai-strip·dark"]}
```
