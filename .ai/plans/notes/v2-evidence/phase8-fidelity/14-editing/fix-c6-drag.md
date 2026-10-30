# P8 stage C · round 6 · c6-drag — fix report (done vs open)

Branch `p8-c6-drag` (from feat/maude-v2 4fc89c1a4). Scope: the drag states of 14 Editing (critic-final-d3 rows): the live inspector during an artboard resize, arrange (guides, gap chips, X·Y pill), Tidy-up (preview + tip), reorder (lifted card + slot), and the tab-order pills over a pointer selection.

## Done (code, each with a fail-first test, reverted once together)

| change | ids | files | test |
| --- | --- | --- | --- |
| **The inspector follows an artboard edge drag.** New canvas → shell message `artboard-live-size { id, w, h, preset }` (null `id` = over) posted from `ArtboardHandles` `run()` and cleared in `finish()`; the shell believes it only from the ACTIVE canvas (dgn row, gate `active`), clamps it, and `use-shell-core.jsx` hands the inspector the selection with `worldW/worldH` replaced while it lasts — the Width row reads "Laptop · 1280" the moment the width clicks onto it, and "1052 now" | ed-ab-resize | `bridge/dgn-protocol.ts`, `editing/artboard-handles.tsx`, `client/v2/inspector/live-size.js` (new), `client/hooks/use-shell-core.jsx` | `p8-c6-live-size.test.ts` |
| The two resize hints are **two pills** (one per key), not one box | ed-ab-resize | `editing/preset-ruler.tsx` (+ TESTIDS.md / testids.json meaning) | `p8-c6-resize-hints.test.tsx` |
| **Tab-order pills + the focus ring belong to Tab / F6 only.** `isNavigationKey` was "any key that is not a modifier", so a tool letter, Esc, ⌘Z, ⌘/ or an ARROW (which nudges the object the pointer selected) flipped the modality and painted `1.2.1.1 …` over a pointer selection | ed-edge-ask, ed-edge-undo, every shot where the harness pressed ⌘Z / Esc / arrows before the frame | `editing/focus-model.tsx` | `v2-edit-keyboard.test.tsx` (new case) |
| **Reorder: the card is lifted** — tilted (-2°), 1.03×, accent ring, deep shadow, opaque (`rotate` / `scale` individual properties, so the drag's own `translate()` is still the only `transform`); the **slot is the card's own size** (`cardBox`, the tilted bounds no longer inflate it) | ed-lay-reorder | `editing/reorder-slot.tsx` (`LIFT`, `liftCard`, `cardBox`), `canvas-shell.tsx` | `p8-c6-reorder-lift.test.ts` |
| **Tidy-up bar clears the artboard name labels** (it sat on them) | ed-ab-tidy | `editing/align-bar.tsx` (`clearLabels`) | `p8-c6-tidy-bar.test.ts` |
| No **"Δ0"** pill on a snap that moved the board by under half a pixel | ed-ab-arrange | `canvas-lib.tsx` (shared file, own commit) | `p8-c6-snap-pill.test.ts` |

## Done (harness — `.scr/` copies are in `_d6-harness-g5/`)
Most of the drag rows were the shot, not the product: the guides, "80" chips, X·Y pill, dashed Tidy preview, "One row, even gaps" tip and the slot all existed and were simply never on screen.
- `s14a` ed-ab-arrange: the 4th post is steered (two readings of the X·Y pill give the pointer → layout scale, then fine steering) to land EXACTLY left of the row at the row's gap and line, so the magenta guide and the three "80" chips draw; ed-ab-tidy: a loose layout first (the 2nd story slid down), the three artboards marquee'd and the pointer RESTS on "Tidy up" (dashed one-row preview + tip), the undo toast dismissed.
- `s14b` ed-lay-reorder: pinch in on Services, double-click INTO the card (so a drag reorders it), grab it high and left (the middle of a small card is its own gap grip) and drag it to the front.

## Open
1. Names in the reorder tag: "Frame · moves to 1 of 3", the board says "Small apps" (14 R4, c3-inspect: an unnamed frame is "Frame"; the fixture's cards carry no designer name).
2. ed-ab-arrange: the leftmost "80" chip is half under the dragged board's selection handle; the board draws it clear.
3. ed-ab-tidy: the fixture has three artboards on two lines (the board: four stories), the bar says "3 artboards"; the board's inspector shows Story 9:16 · 1080 values — the multi-artboard card is `04`/`08`'s.
4. ed-lay-reorder: the board is zoomed on the row with the Layers slot panel and the 220 ms film strip beside it (specimen content); the app is the page at the zoom a pinch gave. The "Services → Auto layout" parent chip is not drawn.
5. ed-ab-resize: the inspector card is 08's web card (Width / Height / Other widths), not 14's Preset / Size W·H rows (round 5 open #1).
6. `test/characterization/v1/keys.txt` records the v1 `v` key putting a focus ring on a pointer selection; with this change it does not — `node scripts/check-v1-characterization.mjs --update` on the merged tip.

## Decisions
- `decision:maude/v2-p8-c6-pills-follow-tab-only`: the keyboard modality (order pills, focus ring, aria-live) is set by Tab / F6 only — rejected: keeping "any non-modifier key" with an exclusion list (every new tool key would need adding), including arrows (they nudge an object the pointer picked; a keyboard user always arrives by Tab first).
- `decision:maude/v2-p8-c6-live-size-overlay`: the live resize size reaches the inspector as an overlay on the shell's `selected` (`overlayLiveSize`), not as a new inspector prop — rejected: a second prop threaded through app.jsx (shared file), and writing the drag size into the real selection state (it would reach the ws `select` broadcast).
- `decision:maude/v2-p8-c6-lift-by-individual-properties`: the lifted card uses CSS `rotate` / `scale`, leaving `transform: translate()` to the drag — rejected: composing a transform string (`translateOf` / `slotRect` and the drop's un-float read `transform`).
