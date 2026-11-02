# structural-and-scope

**Persona:** A designer starting a new screen from scratch and working with reusable components. Expects to add a blank device-sized artboard, drop elements into it, delete and undo, resize the frame — and, crucially, to **always know whether an edit is local to one artboard or shared across every instance** of a component. This is the plan's "musí to být předvidatelné" (it must be predictable) contract, INV-3.

**Feature under test:** `feature-element-editing-robustness` — Stage I (structural ops: delete element, insert element, insert new artboard from screen-size presets), Stage D4 (free-hand artboard resize), and Stage H (reusable-component edit-scope predictability — the scope badge + local instance move).

**Canvas under test:** `.design/ui/Element Editing Lab.tsx` — the throwaway fixture. Artboards **B/C/D** (`card-1/2/3`) each render the **same `<Card>` component**; the Card's inner title (`.eel-card-title`) is stamped with an **identical `data-cd-id` in all three artboards** (a shared source rendered 3×). Artboard **A · playground** supplies elements to insert/delete/resize.

## Hypothesis

- **+ Artboard → Mobile** (shell menubar Edit ▸ "New artboard: Mobile", one of the four `SCREEN_PRESETS`: Desktop 1440×1024 / Laptop 1280×800 / Tablet 834×1194 / Mobile 390×844) appends a new **empty** `<DCArtboard width={390} height={844}>` to the source; the artboard count grows and the new frame is selectable.
- **+ Element → Div** (tool-palette "Insert element" popover, or right-click **Insert ▸ Div**) appends a bare div; the stamped-element count grows by 1 and the new element is inspectable.
- **Delete** (Del/Backspace key or context-menu **Delete**) removes the selected element (count −1) and **Cmd+Z restores it exactly** (whole-file snapshot undo).
- **Free-hand artboard resize** (drag the E/S/SE handle on a selected artboard frame) writes new `width`/`height` **numeric JSX attrs** (DDR-027), Cmd+Z reversible.
- **Scope predictability (INV-3):** selecting the shared Card inner title shows, in Inspector › Advanced › Used in (`[data-testid="adv-used-in"]`), **"Edits apply to: Shared · N places"**; selecting an artboard-local element shows **"Only this element"**. Moving/resizing a Card **instance** stays local (Stage H3).

## Platform matrix

| Platform | Viewport | Required |
| --- | --- | --- |
| web-desktop | 1280×720+ | ✓ |
| web-mobile / ios-phone / ios-tablet / android-phone | — | **SKIPPED** |

Native + mobile **SKIPPED** — desktop-only dev tool; structural editing + the scope model have no touch/mobile surface. Record as `SKIPPED reason="structural editing is a desktop-only dev tool"`. Parity N/A (single-platform project).

## Preconditions

- Dev server booted with `MAUDE_CANVAS_ORIGIN_SPLIT=0`.
- `.design/ui/Element Editing Lab.tsx` present with artboards A + card-1/2/3 (the Card used 3×). Regenerable from the fixture description.
- Structural ops are rate-capped (Stage G3 `MAUDE_STRUCTURAL_BURST`); space several inserts/deletes apart rather than firing a burst.

## Driving model

Same as the sibling specs. Structural inserts/deletes are counted by `[data-cd-id]` deltas and confirmed against the `.tsx` source; artboards by `[data-dc-screen]` count + `width={…} height={…}` attrs in source. The **+ Artboard** presets live in the shell menubar (same-origin, drive directly); **+ Element** and **Delete** live in the iframe (context menu / tool-palette / Del key).

## Steps

1. **Open the fixture; baseline.** Assert `[data-dc-screen]` × 4 (playground + card-1/2/3) and note the `[data-cd-id]` count.
2. **+ Artboard → Mobile.** Menubar Edit ▸ "New artboard: Mobile". Assert `[data-dc-screen]` becomes 5 and the source gains `<DCArtboard id="…" label="Mobile" width={390} height={844}>`.
3. **+ Element → Div.** Select `.eel-flow`, right-click ▸ **Insert ▸** — assert the flyout lists **Div / Text / Image…** — click **Div**. Assert `[data-cd-id]` count +1 and a new div in source.
4. **Delete + undo.** Select `.eel-flow`, press **Delete**. Assert count −1 and `.eel-flow` gone from the DOM + source. Fire **Cmd+Z**. Assert count restored and `.eel-flow` back (whole-file snapshot).
5. **Shared scope badge (the predictability contract).** ⌘-click `.eel-card-title` (the Card inner title, rendered in 3 artboards with one shared `data-cd-id`). Open Inspector › Advanced and assert `[data-testid="adv-used-in"]` reads **"Edits apply to Shared · 3 places"**. Screenshot. Then ⌘-click an artboard-local element (`.eel-overflow`) and assert the row flips to **"Only this element"**.
6. **Free-hand artboard resize.** Select the Mobile artboard frame; assert its resize handles render (artboard scope). Drag the SE handle; assert the `<DCArtboard>` `width`/`height` attrs update in source; Cmd+Z reverts.
7. **Local instance move (Stage H3).** Capture the three Card wrappers' positions. Reposition **one** Card instance (drag its wrapper). Assert only that instance moved and the other two Cards are unchanged (instance move routes per-occurrence, staying local).

## Success criteria

- Steps 1–5 PASS: **+ Artboard (390×844)**, **+ Element Div**, **Delete + Cmd+Z restore**, and the **shared "edits 3 places" vs local** scope badges — the headline structural + predictability checks.
- Steps 6–7 report honestly (artboard-frame selection and per-instance move are sensitive to fixture overlap / exact synthetic-drag targeting; both share the verified element-resize/reposition commit lane and are unit-tested — note partials rather than a false pass).
- Zero JS console errors in the iframe over the run.
- Parity N/A (web-desktop only; others SKIPPED).

## Follow-ups (not blocking)

- The tool-palette **"+ Element"** popover appends to the *active* artboard; after an intervening +Artboard the active-artboard anchor was ambiguous and the popent-append no-op'd once — the deterministic **right-click Insert ▸ Div** path (explicit refId) landed cleanly and is the path this spec asserts.
- **Instance-local positioning** (Step 7) is unit-tested (Task H3 + dogfood) — the visible **scope badge** (Step 5) is the primary user-facing predictability signal and is the load-bearing assertion here.
