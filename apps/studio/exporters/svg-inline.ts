// svg-inline.ts — issue #150 §1: keep an inline <svg>'s own box out of the bitmap
// @remotion/web-renderer draws for it.
//
// `turnSvgIntoDrawable` (web-renderer) serializes the LIVE <svg> element — its
// inline `style` attribute included — into a standalone `data:image/svg+xml`
// document, loads that as an Image and draws it into the frame. In the standalone
// document the <svg> is the ROOT, so an inline `position:absolute; left:300px;
// top:80px` (the usual way a logo / flying shape / divider is placed on a comp)
// moves the artwork 300 × 80 px out of the image's own viewport: the image loads,
// `onload` fires, nothing throws, and the bitmap is empty. The renderer already
// neutralizes `transform` and the margins around that serialization; it forgets
// the rest of the box. The page's CSP is not involved (`img-src` allows `data:`
// and `blob:`, probed live) and is NOT widened by this fix.
//
// This module lives in the capture shim, not in node_modules: the guard patches
// `XMLSerializer.prototype.serializeToString` for the duration of one render, so
// the library stays unpatched (no per-workspace patchedDependencies entry, DDR-176)
// and a renderer upgrade that fixes this itself just makes the guard a no-op.
//
// Browser-safe and React-free; imported by `video-render-lib.ts` (runs inside the
// capture Chromium) and unit-tested under happy-dom.

/**
 * Inline-style properties that place an element inside ITS PARENT — meaningless
 * (or harmful) once the <svg> is the root of its own image document. `margin*`
 * and `transform*` are already reset by the renderer itself.
 */
export const SVG_POSITIONAL_PROPS: readonly string[] = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-block',
  'inset-inline',
  'translate',
  'rotate',
  'scale',
];

interface SavedProp {
  prop: string;
  value: string;
  priority: string;
}

/**
 * Clear the positional inline style on `svg`, run `fn`, put it back exactly as it
 * was (value AND `!important`). Synchronous on purpose: the renderer reads the
 * serialization in the same tick, and the live element must never be left
 * mutated for a frame the Player (or the next measurement) could observe.
 */
export function withSvgBoxNeutralized<T>(svg: SVGSVGElement, fn: () => T): T {
  const style = svg.style;
  const saved: SavedProp[] = [];
  for (const prop of SVG_POSITIONAL_PROPS) {
    const value = style.getPropertyValue(prop);
    if (value === '') continue;
    saved.push({ prop, value, priority: style.getPropertyPriority(prop) });
    style.removeProperty(prop);
  }
  try {
    return fn();
  } finally {
    for (const { prop, value, priority } of saved) style.setProperty(prop, value, priority);
  }
}

/**
 * Wrap `XMLSerializer.prototype.serializeToString` so an <svg> ROOT is serialized
 * without its own box. Anything else (every other node, every other caller)
 * passes straight through. Returns the restore function — call it in a `finally`.
 */
export function installSvgSerializeGuard(): () => void {
  const proto = XMLSerializer.prototype;
  const original = proto.serializeToString;
  proto.serializeToString = function guardedSerializeToString(this: XMLSerializer, node: Node) {
    if (typeof SVGSVGElement !== 'undefined' && node instanceof SVGSVGElement) {
      return withSvgBoxNeutralized(node, () => original.call(this, node));
    }
    return original.call(this, node);
  };
  return () => {
    proto.serializeToString = original;
  };
}
