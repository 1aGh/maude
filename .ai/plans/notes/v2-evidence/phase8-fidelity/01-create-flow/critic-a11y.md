# a11y-critic — 01 Create Flow (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/01 Create Flow.tsx` · impl frames `.claude/worktrees/agent-af49de751057c2ee5/.scr/impl-raw/01/` (lossless PNG) · standard: WCAG 2.1 AA. There is no project a11y-rules skill, so the WCAG defaults apply. · opt_out_applied: n/a — a11y enforces at every scope_

**How this was measured.** Contrast comes from the impl PNG pixels. For each text box the background is the modal colour and the foreground is the strongest-contrast colour that covers at least 3 px. Every value is cross-checked against the token maths (oklch → sRGB). On 11 px text, anti-aliasing reads about 0.3–0.6 low, so a measured value inside 0.5 of a threshold whose token passes is not listed. Dark SPEC is the host re-theme (INDEX), not a designed dark board, so dark impl is judged against the app's own tokens. Rows marked (fixture) are not findings. Keyboard and ARIA findings come from the impl JSX/CSS at `feat/maude-v2` HEAD.

**Severity.** A blocker is either visibly different from the board (in this lens) or a missing or unreachable state. A warning is near the threshold, code-only, or unverified. Each root cause counts once for this canvas.

## Root causes (these hit several artboards)

| # | cause | spec | impl (measured) | owner | sev |
|---|---|---|---|---|---|
| R1 | Shell surfaces render on the v1 `.maude` ladder (indigo 268, opaque `--accent-muted`), not maude-v2 (azure 238, 12–18 % soft). Only Home wears `.maude-v2`. Most pairs still pass: v1 accent buttons are white on #3a5ad7 = 5.69 L, and dark ink on #698fff = 6.38 D where the spec has white on azure (4.89 / 4.74). The dark opaque tint is what fails (R2). | `colors_and_type.css` | `--accent` oklch(.52 .195 268) L / (.68 .18 268) D | `client/styles/1-tokens-maude.css:21-48,138-160`; v2 scope only `client/home/home-app.jsx:727`, `client/v2/annotations/v2-scope.js:21` | (cause) |
| R2 | The dark search-match `<mark>` is an opaque `--accent-muted` under `--fg-1` text | `.k-mark` = `--accent-tint` (22 % azure) → fg-1 6.95 D / 6.12 L | **3.74 D** (#b7bbc0 on #3e5495); 6.72 L | `client/v2/canvases/canvases.css:622-627` | blocker |
| R3 | The canvas dock's buttons are 32 × 32 px ("Geometry is v1's on purpose"). Every canvas stage shows it. 32 px clears the 24 px floor, but it is visibly smaller than the board. | `.dock .icon-btn` 40 × 40 (`preview/_components.css:102`) | 32 × 32 in 4 px padding | `apps/studio/toolbars/toolbar-css.ts:8,48-62` | blocker |
| R4 | The bottom-left undo / redo / zoom % pill is not on screen. ⌘Z and ⌘0 still work. | `ZoomUndo` drawn on every stage | absent (Settings › Zoom controls is off by default) | `client/v2/shell/menu-runner.js:468` | warning |
| R5 | The artboard menu opens on right-click only. The router listens for `contextmenu` and there is no Shift+F10 or ContextMenu-key path. Once open, the menu is keyboard-operable. "Duplicate at another width" is `search.hidden` in ⌘K, but the inspector's add-width reaches it. | menu reachable | pointer-only opener | `apps/studio/input-router.tsx:1009-1077`; `apps/studio/actions/defs/edit.ts:734-739`; menu keys `apps/studio/context-menu.tsx:377-403` | warning |
| R7 | The on-canvas AI language is missing: the dashed spark outline round the artboard being drawn, the "AI is drawing Tablet" tag (`--spark-fg` on spark = 5.38), the Mobile ghost and the "Made by AI" label tag. Progress is said only in the panel ("AI is working · Stop", spark-text on spark-muted 5.64 L / 5.85 D) and to screen readers through the live region. | `_kit.css:456-462,481-482` (`.k-ab-ai`, `.k-ab-aitag`, `.k-cur-tag--ai`) | none on the canvas | panel only: `client/v2/ai/Working.jsx:70`, `client/v2/ai/row-slots-lane.js:24` | blocker |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| cf-home-prompt | L/D | None in this lens. Home is on the v2 ladder: aside 5.52 L / 7.24 D, target chip spark-text 6.50 / 6.07, Sign in white on azure 4.90 / 4.75, placeholder fg-2 5.5+. The ask field shows a focus-within ring. The missing Recent-projects row is a design/copy finding. | — | — | `client/home/home.css:402-407,956-961` | ✓ |
| cf-ai-drafting | L/D | R7: no on-canvas drafting state. Also R3 and R4. | outline + tag + ghost | panel row only | see R7 | (root) |
| cf-ai-done | L/D | R7: "Made by AI" tags are missing. The toast passes: title fg-0 on bg-2, "Show" accent-text 9.34 L / 13.6 D, and motion is removed under reduced motion. The toast's × is about 21 × 27 px (18 px glyph, 0 6 px padding). | pill toast | × under 24 px wide | `apps/studio/notifications.tsx:235-236,243` | warning |
| cf-select-tweak | L/D | The click selects the page `div`, not the artboard, so the artboard inspector (Preset / W / H / Fill / Corners / Clip / Export) is never reached. Keyboard selection of an artboard was not verified. Inspector labels pass (9.22 / 9.41). | compact artboard card | element column | selection: `apps/studio/input-router.tsx` | warning |
| cf-sticky-comment | L | The sticky bar's List glyph renders at **2.44:1** on the light chrome; the bar's other icons are 8–10:1. It is a thin r=1.1 / 1 px glyph. | ≥ 3:1 (1.4.11) | 2.44 L / 3.36 D | `apps/studio/annotations-context-toolbar.tsx:1500-1517`, `apps/studio/canvas-icons.tsx:482-490` | blocker (L) |
| cf-sticky-comment | L/D | The comment composer's Cancel × is about 15 × 16 px (11 px mono, 0 4 px padding). Its focus is a box-shadow ring (fine). The textarea has an aria-label ✓. | bubble, no × | small target | `client/comments-overlay.css:279-300`; `apps/studio/comments-overlay.tsx:1471-1480` | warning |
| cf-sticky-comment | L/D | Tereza's comment bubble (avatar + "Could the button say…?") and the written, coloured stickies are not reachable. This needs a second person on the canvas. | drawn | own sticky only | hub + collab peer | blocker |
| cf-undo-before | L/D | The chips pass: accent-text on accent-muted 7.06 / 5.86, meta fg-2 5.51 / 5.64, "Because you last asked" 5.05 / 4.85. R3 and R4 apply. | — | — | — | (root) |
| cf-undo-ai | L/D | **Unreachable.** Neither ⌘Z nor ⌘K › Undo reverts the agent's edit, because the agent writes the canvas file directly. There is no "Undone — the dark hero by AI · Redo" toast. Product work: route agent writes through the edit-op / undo stack, or record one file-level undo entry per AI turn, then show the toast. | toast + revert | no revert | `apps/studio/edit-op-relay.ts` (bypassed by ACP file writes) | blocker |
| cf-blank | L/D | Ask AI passes (white on #3a5ad7 5.69 L; dark ink on #698fff 6.38 D; spec spark button). "New artboard" passes (8.58 / 9.96). R3 and R4 apply. | — | — | `client/v2/empty/empty.css:143-178` | (root) |
| cf-add-artboard | L/D | The size picker differs from the board (Preset list in the inspector) but holds up: dialog "New artboard", a labelled search, ↑/↓ roving, grouped tiles, selected tile 7.06 / 5.86, group heads fg-2 5.05 / 4.85. R3 applies. | — | — | `client/v2/kinds/SizePicker.jsx:370-428` | (root) |
| cf-duplicate-width | L/D | The menu's Copy ⌘C / Paste ⌘V rows are missing; the artboard clipboard does not exist yet. R5 applies. The rows that are there pass (danger 4.97 / 4.92, hover 14.05 / 11.95). | Copy · Paste rows | absent | `apps/studio/editing/artboard-menu.tsx:13-15` | blocker |
| cf-duplicate-done | L/D | The "Duplicated at Laptop — 1280 wide. · Undo" toast and the selected label (7.06 / 5.86) pass. Placement is a design finding (S6.16). | — | — | — | (root) |
| cf-frames-text | L/D | The Style row reads "No style" at **2.93 L / 3.74 D**. That is a disabled button: the fixture has no text roles, so contrast is exempt. It is still the only statement of the text's style. The Layers frame tree is not shown (fixture: the drafted page is flat). | Font / Size / Weight card | disabled row | `client/v2/inspector/kinds/text.jsx:139-153` | warning |
| cf-big-tree | L/D | Truncated canvas names have no tooltip. Screen readers get the full `aria-label` on the treeitem, but sighted keyboard users get no way to read the rest. The disabled Share (2.23) is exempt (`aria-disabled` + title). | truncated-name tooltip | none | `client/file-tree.jsx:139-148` | warning |
| cf-panel-search | D | R2 fails (3.74). | 6.95 | 3.74 | `client/v2/canvases/canvases.css:622` | blocker |
| cf-panel-search | L | The mark passes (6.72; spec 6.12). | — | — | — | ✓ |
| cf-search-k | L/D | The rows pass (11.8 / 9.05, meta 7.47 / 6.81) and so does the foot (5.56 / 5.41). For "camp", the "Tools and settings" section and the "Ask AI — describe what you want" row are not on screen. They may sit below the 29 results; not verified. | three sections | Canvases only | `client/dialogs/command-palette.jsx:440-470` | warning |
| cf-open-big | L/D | The "Panels hidden. Press ⌘\ to bring them back" toast never appears. The key exists, but the screen never says so. Artboard labels drop the kind icon and the size. | toast + kind/size | none | `client/v2/shell/panel-layout.js` | warning |
| cf-busy | L/D | **Unreachable.** It needs peers on a hub (presence cursors, objects in their colours, two AI chats, Tereza in Preview). The board's legend names each person in text, so colour is not the only cue. | — | — | hub + collab | blocker |
| cf-status-words | L/D | Partial. Only "Local project" is reached (fg-2 5.77 / 5.86, `role=status aria-live`). "Saved", "Syncing…" and "Offline — kept on this Mac" need a hub-linked project. Their tokens pass (warn-text 6.15 L / 9.59 D). | four words | one | `client/v2/shell/share-cluster.jsx:119-133` | blocker |
| cf-render-error | L/D | The card is smaller than the board's: there is no dimmed last-good picture, no "Go back to 14:05" verb and no "Last good version · …" line. Broken has no good version, so that part needs a canvas with one. The card is a `section` with `aria-labelledby` and an h2 ✓. | three parts + verb | title + Ask AI | `client/v2/code/canvas-error-card.jsx:169-212` | blocker |
| cf-render-error | L/D | When an open canvas breaks live, the v1 dev bar "⏸ build error — držím poslední funkční verzi" shows instead. It is Czech text in a `role=status aria-live` with no `lang`, so it fails 3.1.2. Its contrast passes (8.9 / 7.98). | v2 card | Czech dev bar | `apps/studio/canvas-comment-mount.tsx:670` | blocker |
| cf-offline-create | L/D | "AI is back when this Mac is online." passes (status-warn-text 5.73 L / 10.16 D) and Ask AI stays on. The queued prompt was not sent (procedure). The status word is "Local project" (fixture: no hub). R3 applies. | — | — | `client/v2/empty/empty.css:377-384` | (root) |

## Verdict

```json
{"canvas":"01 Create Flow","critic":"a11y-critic","blockers":11,"warnings":9,"verified_ids":["cf-home-prompt·light","cf-home-prompt·dark"],"opt_out_applied":"n/a — a11y enforces at every scope"}
```

Every canvas frame carries R3 (and R4), so only the Home artboard is clean in both themes.
