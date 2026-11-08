/**
 * @file declared-background.ts
 * @purpose #168 F4: the shape a canvas-reported `background` shorthand (`declared.background`, dom-selection.ts)
 *          may have. Pure. The canvas applies it when it reads the value; the shell (css-write.js `declaredOf`)
 *          applies it again, because the canvas is untrusted. At most 512 characters, one or more comma-separated
 *          layers that are each a colour (hex, keyword or colour function), a `var()` or a gradient; never a
 *          `url()`, an image function, or anything that could close the declaration.
 */

export const DECLARED_BACKGROUND_MAX = 512;

const BG_LAYER =
  '(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var|(?:repeating-)?(?:linear|radial|conic)-gradient)\\([^;{}<>\\\\"\'`]*\\))';
const BG_SHAPE = new RegExp(`^${BG_LAYER}(?:\\s*,\\s*${BG_LAYER})*$`, 'i');
const BG_REFUSED = /url\s*\(|image\s*\(|image-set|element\s*\(|expression/i;

export function declaredBackgroundOk(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= DECLARED_BACKGROUND_MAX &&
    BG_SHAPE.test(v) &&
    !BG_REFUSED.test(v)
  );
}
