# canvas-annotations-figjam

**Persona:** Designer reviewing a canvas. Wants to circle a button, type "needs more padding" inside the circle, click an existing arrow to recolor it, and drag a stroke to a better position — all while panning/zooming the canvas mid-stream without losing the draw tool.

**Canvases under test:** `.design/ui/Canvas Viewport.tsx` (multi-artboard surface, exercises selection + drag + reload persistence at non-zero zoom).

**Hypothesis:** Phase 5.1 ships:
- a portal-rendered annotation SVG inside `.dc-world` (zero-latency transform under pan/zoom),
- a transparent input overlay that bails on space-held / middle-mouse / Cmd-modifier (viewport gestures unbroken),
- an ellipse tool (`O`) + thin/thick stroke chip + fill picker for rect/ellipse,
- a parallel `AnnotationSelectionProvider` so Move-tool clicks on a stroke select it (Shift adds, bare-click empty world clears),
- a contextual floating toolbar (recolor, fill, thickness, font-size, delete) anchored above the union bbox,
- text-in-shape edit via double-clicking a selected rect/ellipse (`<foreignObject>` + `contenteditable`),
- a dev-server menubar bridge: View → Annotations toggles visibility; Selection → Deselect all / Select all annotations; Tools → V/H/C/B/R/O/A/E,
- a centered bottom canvas chrome (icon toolbar absorbing zoom + presentation), restyled minimap.

Supersedes Phase 5's `canvas-annotations` scenario (Phase 5.1 expands every dimension exercised there).

## Platform matrix

| Platform | Viewport | Required |
| --- | --- | --- |
| web-desktop | 1440×900 | ✓ |

Native iOS / Android + web-mobile intentionally **skipped** — Phase 5.1's input model (modifier-aware pointer routing, doc-level keyboard nudge, foreignObject text edit) is pointer-and-keyboard centric and the dev-server doesn't render in native shells.

## Preconditions

- Dev server running on a high port (`bun apps/studio/server.ts --root . --port 4399`).
- `<designRoot>/ui-canvas_viewport.annotations.svg` cleared at scenario start.
- Active tool resets to `move` on canvas open.

## Steps

1. **Open canvas; verify empty load + new chrome.**
   - Open `/Canvas%20Viewport.tsx` in the iframe; capture full-page screenshot.
   - Assert centered bottom toolbar present: `.dc-tool-palette` exists; CSS `transform` contains `translateX(-50%)`; bottom offset = 16 px.
   - Assert toolbar contains 8 icon buttons (V/H/C + B/R/O/A/E) plus presentation toggle + zoom display.
   - Assert minimap `.dc-mm` rendered bottom-right with new chrome (border-radius: 8px, box-shadow `0 6px 24px ...`).
   - Assert `DCZoomToolbar` is NOT rendered (`document.querySelectorAll('.dc-zoom-tb').length === 0`).
   - Assert no SVG strokes under `.dc-annot-svg`.

2. **Pen-circle while space-held mid-gesture pans (coexistence).**
   - `keydown M` → Marker active with the pen tip (toolbar button "Marker (M)" aria-pressed).
   - Pointerdown at (640, 320), draw a half-circle stroke.
   - Mid-stroke, hold Space + drag 80 px right → viewport pans (assert `.dc-world` style.transform translate changed).
   - Release space; resume drawing. Pointerup.
   - Assert: exactly one `<path data-tool="pen">` rendered.
   - Wait 300 ms; GET `/_api/annotations?file=.design/ui/Canvas%20Viewport.tsx` → body contains `data-mdcc-annotations="1"`.

3. **Draw an ellipse, then give it a fill.** (S4.8 retired the `.dc-annot-chrome` swatch tray: the shape kind is a toolbar popover, the fill lives on the small toolbar above a selection.)
   - `keydown R` → Shape active; open the shape-kind popover (`toolbar-popover-shape-kinds`, aria-label "Shape type") and pick Ellipse.
   - Drag from (220, 320) → (380, 420) → release.
   - The new ellipse is selected: in the small toolbar above it (`.dc-annot-ctx`), click the fill swatch (`aria-label="Fill #e6f4ea"`).
   - Assert: one `<ellipse data-tool="ellipse">` rendered with `fill="#e6f4ea"`.
   - Reload page; assert ellipse persists with same fill.

4. **Switch to thick pen + draw an arrow.**
   - `keydown M` → Marker (its tip is the pen); the Marker popover (`toolbar-popover-marker-tips`) opens with the tool.
   - In that popover, click the thick radio (`toolbar-thickness-thick`) → next pen stroke uses width 6.
   - Draw a 60-px pen stroke; assert `stroke-width="6"` on the new `<path>`.
   - `keydown A` → arrow. Draw arrow (200, 500) → (340, 500); assert arrow rendered.

5. **Switch to Move; click ellipse → halo + context toolbar.**
   - `keydown V` → move.
   - Click on the ellipse outline.
   - Assert: `.dc-annot-svg` contains exactly one `<rect>` halo (dashed accent stroke).
   - Assert: `.dc-annot-ctx` (context toolbar) exists at `position:fixed`, anchored above the ellipse bbox.
   - Assert: toolbar contains color row (6 swatches), fill row (none + 6), delete button.

6. **Recolor + refill the ellipse via context toolbar.**
   - Click color swatch `#1a8f3e` in the context toolbar.
   - Click fill swatch `#e3edff`.
   - Assert: rendered ellipse `stroke="#1a8f3e"` + `fill="#e3edff"`.
   - Wait 300 ms; reload; assert persisted.

7. **Drag the selected ellipse 40 units right.**
   - Read the ellipse's `cx` via `document.querySelector('[data-tool="ellipse"]').getAttribute('cx')` — call it `cx0`.
   - Pointerdown on ellipse, pointermove +40 px right, pointerup.
   - Assert: `cx` increased by ≈ 40 / zoom (allow ±2 px).
   - Reload; position persists.

8. **Arrow nudge + delete via keyboard.**
   - Click on the arrow (Step 4) → halo appears.
   - `keydown ArrowRight` × 3 → arrow `x1` + `x2` each increased by 3.
   - `keydown Shift+ArrowDown` → each y coord increased by 10.
   - `keydown Backspace` → arrow removed; halo gone; context toolbar disappears.

9. **Text-in-shape via double-click.**
   - Click on the ellipse → halo + toolbar.
   - Double-click the ellipse.
   - Assert: a `<foreignObject>` exists inside the SVG with a focused `[contenteditable]` div.
   - Type `needs padding`; `keydown Escape` → editor closes.
   - Assert: a `<text data-tool="text" data-anchor-id="...">` exists in the SVG with content `needs padding`.
   - Reload; text persists.

10. **Font-size step via context toolbar.**
    - Click the text once (clicking inside the host shape selects it because text inherits the host's bbox; selection of text-only requires clicking text glyphs — accept either path).
    - In `.dc-annot-ctx`, click `L` (large).
    - Assert: `<text>` `data-font-size="20"` (and visual size grows).

11. **Menubar bridge — toggle annotations off, then back on.**
    - In the dev-server menubar: View → Annotations.
    - Assert: `<svg class="dc-annot-svg">` is unmounted (or has `display:none` parent); all strokes hidden visually.
    - View → Annotations again → strokes visible.
    - Assert: View dropdown's Annotations row has a check-mark active state when visible.

12. **Menubar bridge — Tools → Pen activates the canvas iframe pen.**
    - Switch tool to `move` (V); confirm.
    - In menubar: Tools → Pen.
    - Assert (inside iframe): `.dc-tool-palette button[aria-pressed="true"]` belongs to pen.
    - Confirm draw resumes via mouse-drag.

13. **Menubar bridge — Selection → Deselect all clears both stores.**
    - Click the ellipse to select it (halo on).
    - Cmd-click an artboard element (selects a DOM element via the element-selection path).
    - In menubar: Selection → Deselect all.
    - Assert: no annotation halos rendered; no `.dc-cv-halo--selected` element halos rendered.

14. **Reload — every primitive persists.**
    - Reload `/Canvas%20Viewport.tsx`.
    - Assert: pen stroke, ellipse (with stroke + fill at the dragged position), thick pen, the text annotation all render. (The arrow was deleted in step 8.)

## Acceptance

- All 14 steps pass on web-desktop.
- No console errors visible in iframe; no React reconciliation warnings about portal mounts.
- Persistence: every PUT-side mutation survives a reload.
- Coexistence: every step that touches the world (space-pan, wheel zoom — verify via pinch in step 2 manual addendum) leaves the annotation set intact and visually in lockstep.
- A11y smoke (not blocking but reported): all canvas-chrome buttons keyboard-reachable; focus rings visible; ARIA labels carry the shortcut letter; context-toolbar role=toolbar.

## Notes

- The web-mobile + native skip rationale is documented in the platform matrix above. Phase 5.1 is intentionally pointer-keyboard-only; touch/native coverage is out of scope for this iteration.
- Phase 5's `canvas-annotations` scenario gap (smoke-piloted but not formally authored) is **subsumed** by this scenario. Do not run both.
