// edit-ops/set-gap.ts — `layout.set-gap` (S2.11c, ed-lay-auto: "⌥ every gap at once").
//
// One gap value for several auto layouts, in ONE write: the ruler drag with ⌥ held changes every gap
// of the same size in the frame, and that is one request, one snapshot, one undo step (not one per
// frame). Targets are the layout containers; each gets `gap` in its inline style. Plain CSS, never
// `data-cd-*` (V2-1.4), so a v1 peer reads the file as it always did.
//
// params: `gap` — `{ token: '--space-N' }` (what the ruler's stop is) or `{ px: n }` (⌘ any number, a
// system with no space scale). The same two spellings the inspector's Gap row writes (`words-css.ts`
// `lengthToCss`), so the drag and the row can never disagree. A raw CSS string is not accepted.
//
// Refused (nothing written, the whole request): no target, a bad value, an object whose inline
// `display` says it is not a layout, a style the file computes. A locked or AI-held target is
// refused by the dispatcher before this runs.

import { readAttributeState } from '../canvas-edit.ts';
import { refuse, writeStyle } from './constraints.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';
import { type Length, lengthToCss } from './words-css.ts';

const MAX_GAP_PX = 10_000;
const SPACE_TOKEN = /^--space-[a-z0-9-]{1,48}$/;
const LAYOUT_DISPLAY = /^(flex|inline-flex|grid|inline-grid)$/;

function gapOf(req: ResolvedEditOp): Length {
  const raw = (req.params as Record<string, unknown>).gap;
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (typeof o.token === 'string') {
    if (!SPACE_TOKEN.test(o.token)) refuse(req, 'That is not a space token of the system.');
    return { token: o.token, px: null };
  }
  if (typeof o.px === 'number' && Number.isFinite(o.px) && o.px >= 0 && o.px <= MAX_GAP_PX)
    return { px: o.px };
  return refuse(req, 'Pick a gap: a space token or a number of pixels.');
}

export const layoutSetGap: EditOp = {
  id: 'layout.set-gap',
  apply(source, req) {
    if (req.targets.length === 0) refuse(req, 'Select a frame first.');
    const css = lengthToCss(gapOf(req));
    // check every target before the first write: the request lands whole or not at all
    for (const t of req.targets) {
      const display = readAttributeState(
        req.file,
        source,
        t.element,
        'style.display',
        t.occurrence
      );
      if (display.kind === 'expression')
        refuse(
          req,
          `${t.element} is laid out by a computed value; change it in the code.`,
          t.element
        );
      if (display.kind === 'literal' && !LAYOUT_DISPLAY.test(display.value.trim()))
        refuse(req, `${t.element} is not an auto layout.`, t.element);
    }
    let out = source;
    for (const t of req.targets) out = writeStyle(out, req, t, { gap: css });
    return { source: out };
  },
};
