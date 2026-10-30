# element-editing-resize-and-position

**Persona:** A designer refining a mockup. Expects Figma/Webflow-grade direct manipulation — Cmd-click selects and the properties panel is already where the eye is, corner handles resize, a Position inset nudges an element, spacing drags on-canvas, multi-select aligns/distributes/tidies, and every edit is Cmd+Z reversible. Above all, the camera never jumps out from under them.

**Feature under test:** `feature-element-editing-robustness` — Stages A (camera bug fixes), B/C (curated Position/Transform/Media knobs + auto-open), D (on-canvas resize, element + artboard), J (on-canvas padding/gap drag), L5/L6/L7 (align/distribute/tidy, deep-select + "Select layer", Alt-hover measure + resize readout), M (Fixed/Hug/Fill + auto-layout).

**Canvas under test:** `.design/ui/Element Editing Lab.tsx` — a **throwaway verification fixture** authored for this pass (`@opt_out full`, `@ds maude`). Artboard **A · playground** (600×420) carries: one in-flow block (`.eel-flow`), one absolutely-positioned element that **overflows** its frame (`.eel-overflow`, `left:500` in a 600-wide artboard → `right:-84`), an authored `<img>` (`.eel-img`), three absolutely-positioned boxes (`.eel-box`) for align/distribute/tidy, and a nested container (`.eel-outer` › `.eel-inner` › `.eel-leaf`) for deep-select/select-layer/measure. Regenerable — delete and re-author from this spec if absent.

## Hypothesis

After Stages A–M land, artboard A behaves as a coherent direct-manipulation surface:

- A Cmd-click on a stamped `[data-cd-id]` element paints a selected halo (`.dc-cv-halo--selected`), the 8 resize + 4 rotate handles (`.dc-el-resize-handle[data-corner]`), the contextual toolbar (`.dc-elem-ctx-tb`), and (for a padded/flex box) the spacing handles (`.dc-spacing-handle`).
- Selecting a single element with no right panel open **auto-opens the Inspector on the CSS tab** (Stage C), and Inspector › Advanced › Used in (`[data-testid="adv-used-in"]`) says whether an edit is local or shared.
- Dragging a corner handle resizes the element; the commit persists `width`/`height` (+`left`/`top` on a top/left-edge drag) to the `.tsx` and each is Cmd+Z reversible (per-property records).
- The **Position** section renders an inset widget (`.insp-cp-box--inset`, inputs `aria-label="top|right|bottom|left"`) that writes `top`/`left`/… on commit.
- **Bug A/B are gone:** moving an absolutely-positioned element (or selecting an overflowing one) does **not** scroll the `.dc-canvas` host or change the `.dc-world` transform — the camera stays put.
- Multi-select (Cmd+Shift+click) paints a group bbox (`.dc-cv-group-bbox`) and the toolbar exposes align (≥2), distribute (≥3), and tidy-up buttons; clicking Align top converges the selected elements.
- Double-click drills selection one level deeper (deep-select); right-click exposes a "Select layer" submenu of stacked elements; Alt-hover paints a measure guide + distance pill.

## Platform matrix

| Platform | Viewport | Required |
| --- | --- | --- |
| web-desktop | 1280×720+ | ✓ |
| web-mobile | — | **SKIPPED** |
| ios-phone | — | **SKIPPED** |
| ios-tablet | — | **SKIPPED** |
| android-phone | — | **SKIPPED** |

Native iOS / Android + web-mobile intentionally **SKIPPED** — the Maude Studio dev-server is desktop-development tooling with no touch / mobile-responsive product surface; Cmd/Shift-modifier gestures, corner-handle drags and hover-only overlays have no parity story on touch. Same rationale as `canvas-figjam-feel`. Document in the run report as `SKIPPED reason="canvas editor is a desktop-only dev tool; no touch/mobile parity story"`. Project `platforms` in `.ai/workflows.config.json` is `["web-desktop"]`, so parity is single-platform (N/A, not a gap).

## Preconditions

- Dev server running. **Boot in same-origin mode** so the harness can reach the canvas iframe:
  `MAUDE_CANVAS_ORIGIN_SPLIT=0 bun run apps/studio/server.ts --root . --port <N>`
  The origin split (DDR-054) only affects the CSRF/untrusted-canvas trust boundary — element-editing behavior is identical, and the boundary itself is covered by `test/canvas-origin-gate.test.ts` + the security review (G3). Splitting it off lets `agent-browser` reach the iframe via `iframe.contentDocument` (a cross-origin OOPIF is unreachable to page JS).
- `.design/ui/Element Editing Lab.tsx` present (re-author from this spec's canvas description if not).
- Browser viewport ≥ 1280×720. Use an **isolated agent-browser session** (`--session <name>`) so a concurrent run doesn't scramble the tab.

## Driving model (agent-browser)

The selection chrome (halos, handles, toolbars, context menu, spacing/measure overlays) lives in the **canvas iframe**; the Inspector / scope badge / Position widget / menubar live in the **parent shell**. With `MAUDE_CANVAS_ORIGIN_SPLIT=0` both are same-origin, so from a shell-frame `eval` you reach the iframe via `document.querySelector('iframe').contentDocument`. Dispatch **synthetic pointer/keyboard events** (built with the iframe's own `contentWindow` constructors) on iframe elements — they route through `input-router.tsx` → post to the real parent shell → full round-trip. **Shell inputs commit reliably with real CDP keystrokes** (`agent-browser fill` / `press`); synthetic `input` events on controlled React inputs do not. Pace multi-step selection ≥ ~1 s apart (the `select-set` post debounces 50 ms; rapid synchronous clicks coalesce).

## Steps

1. **Open the fixture; assert load.** Open the shell, click the "Element Editing Lab" tree row, wait for the iframe. Assert `[data-dc-screen]` × 5 and `[data-cd-id]` ≥ 22 inside `iframe.contentDocument`. Screenshot the canvas.
2. **Cmd-click `.eel-overflow` → select + auto-open.** Dispatch a metaKey pointer chain on the element. Assert `.dc-cv-halo--selected` ×1, `.dc-el-resize-handle` present (8 resize + 4 rotate), `.dc-elem-ctx-tb[data-on="true"]`, and — in the shell — `.sh-rpanel[aria-label="Inspector"]` open with `.sh-rp-tab.is-active` text = "CSS" and, with Advanced open, `[data-testid="adv-used-in"]` reading "Only this element". Screenshot.
3. **Resize via the SE handle.** Read the element's `width`/`height` from source. Drag `.dc-el-resize-handle[data-corner="se"]` by +40,+30. Assert the source `width`/`height` grew (world delta = screen delta ÷ zoom) and one coherent render.
4. **Undo the resize.** Fire Cmd+Z into the iframe twice (resize records per-property). Assert `width`/`height` return to their pre-resize values.
5. **Position inset nudge.** With the element selected, `fill` the shell `.insp-cp-box--inset input[aria-label="top"]` with a new value + Enter. Assert the source `top` updates; Cmd+Z reverts.
6. **Bug A — camera stays put.** Capture `.dc-world` `style.transform` and `.dc-canvas` `scrollLeft/scrollTop`. Drag `.eel-overflow` far (+220,+160 screen). Assert the element's `left`/`top` moved in source **and** the world transform is byte-identical + host scroll still 0/0.
7. **Multi-select align.** Escape, then Cmd-click `.eel-box`#0, Cmd+Shift-click #1 (≥1 s apart). Assert `.dc-cv-group-bbox` ×1, the toolbar count pill reads "2 elements", `button[aria-label="Align top"]` enabled, `button[aria-label="Distribute horizontally"]` **disabled** (needs 3), `button[aria-label="Tidy up into a grid"]` enabled. Click Align top; assert the two selected boxes converge to the same `top`. Screenshot.
8. **Deep-select.** Escape, Cmd-click `.eel-outer`, then double-click it. Assert the active selection id (`_active.json#selected.id`) changes to a deeper stamped descendant.
9. **Select-layer + context affordances.** Right-click `.eel-flow`. Assert `.dc-context-menu` lists items including **Select layer ▸**, **Insert ▸**, **Replace image…**, **Duplicate**, **Copy style / Paste style**, **Delete**.
10. **Alt-hover measure.** Select `.eel-box`#0, hold Alt and hover `.eel-box`#2. Assert the measure layer (`.dc-cv-measure-line`) and distance pill (`.dc-cv-measure-pill`) toggle `data-on="true"` with a px value.

## Success criteria

- Steps 1–7 PASS (the core: select, auto-open, resize+undo, position inset, **Bug A camera no-jump**, multi-select align).
- Steps 8–10 report render/wiring state honestly (some overlays activate only under real pointer/keyboard state, not synthetic dispatch — note partials rather than claiming a false pass).
- Zero JS console errors in the canvas iframe over the run.
- Cross-platform parity: N/A (web-desktop only by design; the other 4 documented as SKIPPED).

## Follow-ups (not blocking)

- The resize **readout pill** (`.dc-el-resize-readout`) and the **measure overlay** activation are timing/real-input sensitive and were not cleanly captured under synthetic dispatch — both are unit-tested (L7 `computePairGap`, resize readout) and dogfood-verified in the plan. A future harness using real CDP mouse-with-modifier drags could assert them live.
- Clean 3-element multi-select was flaky under paced synthetic clicks (2 accumulates reliably; the 3rd add races the debounce) — distribute's enable-at-3 is proven only by its disabled-at-2 gate here.
