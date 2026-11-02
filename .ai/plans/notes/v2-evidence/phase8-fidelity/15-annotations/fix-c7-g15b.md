# P8 stage C · round 7 · c7-g15b — 15 Annotations (continuation of fix-c7-oboard.md "Open") + 04 md-edit-image

Branch `p8-c7-g15b` (from feat/maude-v2 e4c1a2164). Budget-capped: the shell->canvas panel state + the cheap fixes + the gesture harness first, then the re-shoot.

## Done — product (fail-first tests)

| change | ids | files | test |
| --- | --- | --- | --- |
| New parent->canvas dgn `shell-panels {v:1, open:'stickers'\|'assets'\|null}` (parent-gated, enum-validated, no route); the shell relays which tool panel is up (Stickers gallery request / Assets panel), again to a frame that just loaded; the dock's panel-only slots press while theirs is up (`aria-pressed` only while open) and Hand (the resting Browse tool) lets go while a panel is up | an-stk-gallery · an-stk-search · an-stk-drop (E pressed); 04 md-edit-image (Image pressed) | `bridge/dgn-protocol.ts` (own commit), `toolbars/shell-panels.ts`, `tool-palette.tsx`, `canvas-shell.tsx` (shared), `client/v2/shell/shell-panels-relay.js`, `client/app.jsx` (shared: one hook call + `assetsOpen` in ShellTree's destructure) | `dgn-protocol-gates.test.ts` (reverted: 3 red), `p8-c7-g15b-shell-panels.test.tsx` (+ the Hand case reverted: red), `p8-c7-g15b-shell-panels-relay.test.ts`, `dgn-protocol-coverage.test.ts` (sender + handler found) |
| Sticker result tiles take `--bg-3` (the picker is a `.st-dialog` = `--bg-1`; a `--bg-1` tile vanished in light) | an-stk-search | `client/v2/annotations/stickers-gallery.css` | `p8-c7-g15-css-pins.test.ts` (reverted: red) |
| "Not printed" pill sits just under the note (left + 12, 4 px below, as the board's `.an-noprint`), not inside it on the text | an-print | `annotations/ui/time-pins.tsx` | `annotations-pin-tags.test.tsx` (spec updated) |

## Done — harness (`_c7g15b-harness-g5`)

- `Shift+p` never fired the shift-P handler (the key arrives as `P`): an-visibility now shows the hidden state + the "Annotations hidden. Press shift-P to bring them back. Show" toast.
- an-arrow-bind: a held Arrow drag from a note onto the button (candidate outlines + snap ring + "Button · See the work" tag). an-arrow-kinds: an arrow selected, the Arrowhead menu open. an-convert: one note turned into a comment, the menu open on the next, the toast up. an-video: a note placed on the video artboard (right fixture). an-stamps: the running vote bar. 04 md-edit-image: Image slot pressed with the Assets panel open.

## Still open

- an-arrow-kinds / an-arrow toolbar order: the board puts [Straight|Curved|Elbow] + head menu first, inks after; the product bar is inks · widths · kind · head · two-way · dash · lock · trash (a reorder of the arrow section of `annotations-context-toolbar.tsx`, not done).
- an-convert: the converted thread card on the canvas is not opened in the shot (the pin is drawn, the card needs a click on the pin; comments overlay is shell-side).
- an-follow (elbow re-route + position bubble), an-dangling ("Point to…" card), an-video "0:12" chip + timeline marks (the fixture has no footage: the note pins to the playhead, 0:00), running vote ballots/result (needs a second person), an-plan kanban tint, an-ai-write spark edge + AI chip, an-today text/link/media states, an-crowd section counts + hover card: not touched this round (content/product states, no budget).
- Unreachable (unchanged): an-ai-read, an-ai-apply, an-ai-stickers, an-rebind, an-viewer, an-figjam.

## Decisions
- `decision:maude/v2-c7-g15b-shell-panels-dgn`: the open shell panel reaches the canvas as one enum state (`stickers`|`assets`|null) on the existing parent->canvas lane, relayed by a small shell hook; rejected: the canvas inferring it from `tool-panel-open` (it never learns the panel closed), a polling route, a wider payload (the canvas must not learn what the panel shows).
- `decision:maude/v2-c7-g15b-aria-pressed-only-while-open`: a panel-only slot carries `aria-pressed` only while its panel is open (absent otherwise, as the existing "a panel, not a tool" pins require) — rejected: always-boolean (breaks the pinned contract), `aria-expanded` (the dock's pressed style keys on `aria-pressed`).
- `decision:maude/v2-c7-g15b-not-printed-below-note`: the print pill sits below the note like the board's `.an-noprint`; rejected: shrinking/offsetting the note text (the note content is the user's).
