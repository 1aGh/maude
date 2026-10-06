// _region.mjs — region capture for the PNG / PDF playwright shims (issue #125).
//
// The per-artboard path pins ONE artboard to (0,0) and crops to it. A region
// capture instead keeps the world-plane layout intact and crops to the union
// bounding box of several things: every artboard + annotation element
// (`--region canvas`, the `canvas-whole` scope) or a list of selected elements
// (`--region '{"selectors":[…]}'`, the `selection-bounds` scope). Annotations
// that fall inside the box come along for free — they live in `.dc-world`
// too (annotations/ui/scene.tsx), visible when the shell was loaded with
// `annotations=1`.

/** Gap between the content and the image edge, in CSS px. */
export const REGION_PADDING = 32;

/** Parse the shim's `--region` value: `canvas` or `{"selectors":[...]}`. */
export function parseRegionArg(raw) {
  if (raw === undefined) return null;
  if (raw === 'canvas') return { kind: 'canvas' };
  try {
    const v = JSON.parse(raw);
    if (v && Array.isArray(v.selectors) && v.selectors.every((s) => typeof s === 'string')) {
      return { kind: 'selectors', selectors: v.selectors };
    }
  } catch {
    /* fall through */
  }
  throw new Error(`invalid --region value (expected "canvas" or {"selectors":[…]})`);
}

/**
 * Lay the region out at the viewport origin and return its size in CSS px.
 *
 * Resets the world plane's pan/zoom (CSS `zoom` shrinks layout, so rects lie
 * under it), measures the union box, then translates `.dc-world` so the box's
 * top-left — minus the padding — sits at (0,0). The caller sizes the viewport
 * to the returned box and captures from the origin.
 */
export async function layoutRegion(page, region, padding = REGION_PADDING) {
  const box = await page.evaluate(
    ({ region, padding }) => {
      const world = document.querySelector('.dc-world');
      if (world) {
        world.style.zoom = '1';
        world.style.transform = 'none';
      }
      // The active-artboard ring (`aria-current` → accent box-shadow) paints
      // OUTSIDE the artboard box: a per-artboard crop cut it off, a region
      // keeps it. Editor state, not design — drop it (throwaway shim page).
      for (const ab of document.querySelectorAll('[data-dc-screen][aria-current]')) {
        ab.removeAttribute('aria-current');
      }
      const els = [];
      if (region.kind === 'canvas') {
        els.push(...document.querySelectorAll('[data-dc-screen]'));
        // Annotation elements count only when they are actually painted —
        // without `annotations=1` the scene is display:none and measures 0×0.
        for (const scene of document.querySelectorAll('[data-mdcc-annotations]')) {
          els.push(...scene.children);
        }
      } else {
        for (const sel of region.selectors) {
          try {
            els.push(...document.querySelectorAll(sel));
          } catch {
            /* an unparsable selector contributes nothing */
          }
        }
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        minX = Math.min(minX, r.left);
        minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.right);
        maxY = Math.max(maxY, r.bottom);
      }
      if (!Number.isFinite(minX)) return null;
      if (world) {
        world.style.transform = `translate(${padding - minX}px, ${padding - minY}px)`;
      }
      window.scrollTo(0, 0);
      return { width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
    },
    { region, padding }
  );
  if (!box) throw new Error('region capture: nothing to export — no visible element matched');
  return { width: Math.ceil(box.width), height: Math.ceil(box.height) };
}
