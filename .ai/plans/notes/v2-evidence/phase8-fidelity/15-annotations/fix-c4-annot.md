# P8 stage C · round 4 · c4-annot — fix report (done vs open)

Branch `p8-c4-annot` (from feat/maude-v2 1ed20a976). Scope: 15 Annotations (stage-D critic rows) + the 14 Editing R3 "marks at rest" rows + Layers not listing the page root.
Rows for 14 are in this one file (`14-editing/fix-c4-annot.md` points here).

## Done (code, each with a fail-first test, reverted once)

| change | ids | files | test |
| --- | --- | --- | --- |
| A sticky / sticker / stamp / template pick is placeable **by keyboard** (a11y A2): arrows walk the ghost (⇧ = 4 steps), ↵ / Space put it down where the pointer last was, else the middle of the view; a chord (⌘↵) is left alone | an-enter · an-place · an-stk-gallery · an-stk-search · an-stk-drop · an-stamps · an-plan · an-arrow-bind · an-templates | `annotations/ui/placement.tsx` | `annotations-sticker-drop.test.tsx` (3 new) |
| **Layers does not list the artboard page root as a row**: the one filling root IS the artboard (decision `v2-c3-page-root-is-the-artboard`); its objects are the top level. A lone card smaller than the artboard stays a row | 14 ed-obj-* · 15 an-layers | `canvas-shell.tsx` `serializeArtboardTree` | `page-root-is-the-artboard.test.ts` (3 new) |
| AI connectors / pointer arrows are born **Curved** like a drawn arrow (`NEW_ARROW`), not a straight chord | an-follow · an-plan · an-ai-write · an-arrow-bind | `annotations/ai-write.ts` (`connect`, `pointer`) | `annotate-write.test.ts` (2 assertions) |
| Layers (annotation list): a **resolved** sticky is marked beyond colour — a tick, a strike and a "Resolved" word for a screen reader (a11y A3) | an-layers · an-ai-apply | `client/v2/annotations/annotation-list.{jsx,css}` | `annotation-list-render.test.tsx` |
| A **section title stays at full ink in Edit** (the quiet fade skips a section; its body is already a 7 % wash). Was 0.45 → 1.5:1 | an-section | `annotations-layer.tsx` (ANNOT_CSS) | `annotations-mode-render.test.tsx` |
| 14 R3: **gap / padding grips are not drawn at rest** — a transparent hit zone (the band's chip is the grip), the ring shows on hover / drag only | 14 ed-lay-auto · ed-obj-* · ed-lay-free · ed-shape · ed-text-style … | `use-spacing-handles.tsx` | `p8-c4-annot-rest-chrome.test.ts` |
| 14 ed-text-edit: typing in place draws **only the edit ring + its tint halo** (no resize handles, size tag, bands, badges) | ed-text-edit | `canvas-shell.tsx` (CSS) | `p8-c4-annot-rest-chrome.test.ts` |
| 14 ed-edge-keys: the **keyboard focus ring replaces the selection chrome** (handles, tag, halo) while it shows — focus ring ≠ selection ring | ed-edge-keys | `editing/focus-model.tsx` | `p8-c4-annot-rest-chrome.test.ts` |
| 14 ed-pen: the pen key hints are **light pills** (the board's `.ed-hint`), one per key, not one dark bar | ed-pen | `editing/pen/overlay.tsx` | `p8-c4-annot-rest-chrome.test.ts` |
| Sticker gallery opens on the search: **no header, no ×** (Esc / press outside close it) | an-stk-gallery · an-stk-search | `client/v2/annotations/stickers-gallery.jsx` | `stickers-gallery.test.tsx` |
| Templates panel: **no ×** | an-templates | `client/v2/annotations/templates-panel.jsx` | `templates-panel.test.tsx` |
| "Not printed" is a **dark pill inside** the note (was a white pill outside above) | an-print | `annotations/ui/time-pins.tsx` | `annotations-pin-tags.test.tsx` |

## Not a defect (checked, no change)
- **Free text / shape label / kanban column in mono** (stage-D R2): `TEXT_FONT` is already the rounded face since C5 round 2 (`text-style.ts:14`); the seeded text in the re-shot is rounded.
- **Preview dock key letters** (H N C M A R T E S): the board's `Toolbar keys` prop is "key letters in each button's corner (close-ups, key charts)" and is passed only to the an-enter *rule inset*; the live dock draws its tooltip with the key (board `tip`). Not added to the live dock.
- **Tab-order numbered pills over a pointer selection** (14 R3): `OrderBadges` is gated on the keyboard modality (`useKeyboardModality`); on this tip a pointer pick draws none (checked in the re-shot).

## Open (budget-capped)
- 15 R5 states never drawn in a real run: snap ring + "Button · See the work" tag, elbow re-route around Mobile, dangling card ("Point to…"), "0:12" time pin on a video artboard, stamp row / ballot clusters / count popover, vote running + result section. The code exists; the harness fixture does not reach them (needs a video artboard, a trashed target, a running vote).
- Arrow rest drawing for hand-drawn arrows (2 px curve with a filled head is the new-arrow default; the seeded fixture arrows are AI-made and now Curved, but rest-route/elbow around artboards not re-checked).
- Marker popover as a one-row pill (segment · inks · +4 · 3 width dots): still the 3-row card (`annotations-context-toolbar.tsx` / `tool-palette.tsx` marker popover).
- Sticker / sticker-drop selection: edge connection dots (`dc-annot-conn-dot`) still show beside the 4 corner squares; the board shows none until a connector is dragged.
- Layers in Preview as an island (hug-height) instead of the docked full-height column — the left panel is the shell's (11 navigation); the annotation list inside matches (grouping, lock row, filter footer already exist, shots lack sections/authors in the fixture).
- AI read/apply/rewrite states (signed-out AI), an-viewer (share-grant role), an-figjam arrival, an-visibility ⇧P toast / ⌘K resolved commands, an-crowd LOD blocks.
- 14: corner-radius dots at rest on a frame (board shows them on shapes only), U island (Undo · Redo · zoom) per 14 critic-d "U" (not built here), inspector sections order (R5, c3-inspect), context menu icons (M).

## Decisions
- `decision:maude/v2-c4-annot-placement-by-keyboard`: ↵/Space place a picked item at the last pointer point, else the view middle; arrows walk the ghost — rejected: a separate "place" button in the gallery (a second route to the same thing, and the pointer lane stays the primary), auto-placing at the centre on pick (loses the "follow the pointer" feel).
- `decision:maude/v2-c4-annot-grips-hidden-at-rest`: spacing grips stay as invisible hit zones (the chip is the grip) rather than a new chip-as-button — rejected: making the band chip pointer-active (would need the drag logic moved into gap-bands.tsx; the grips already carry it).
- `decision:maude/v2-c4-annot-focus-ring-replaces-selection`: while the keyboard focus ring shows, the selection chrome is hidden by the ring's own stylesheet — rejected: gating each chrome component on the modality (eight call sites).
- `decision:maude/v2-c4-annot-ai-arrows-curved`: AI connectors default to `line:'curved'` at write time — rejected: changing the schema default (`arrow.model.ts` `line` default 'straight' is back-compat for stored boards).
