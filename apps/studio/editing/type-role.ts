// editing/type-role.ts — S2.12: what the canvas knows about a text object's style, measured not guessed.
//
// A text object wears a style as a `t-<role>` class. Whether it OVERRIDES the style is a question about
// the rendered text: its computed type properties against what the class alone computes to. The role's
// values are read by taking the element's own inline style away for a moment (the cascade without the
// override is exactly the style), reading, and putting the inline style back — synchronously, with
// transitions off, so nothing paints and nothing animates. No node is added or removed, so Layers'
// structural observer never hears of it.
//
// The result rides the selection (`Selection.textInfo`) to the inspector, and is what `text.detach-style`
// sends as `values`: Detach inlines exactly these.

import { roleClassesOf, type TextInfo, TYPE_PROPS } from '../edit-ops/text-style.ts';

const readType = (el: Element, win: Window): Record<string, string> => {
  const cs = win.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const p of TYPE_PROPS) out[p] = cs.getPropertyValue(p).trim();
  return out;
};

/** The language in force: this element's `lang` or the nearest ancestor's ('' when none). */
export const langIn = (el: Element): string =>
  el.closest?.('[lang]')?.getAttribute('lang')?.trim() ?? '';

/**
 * The style a text object wears and how the object differs from it. null when it is not a text object
 * (no document, or nothing to read). `role` is null for a text with no style.
 */
export function probeTextInfo(el: Element): TextInfo | null {
  const doc = el.ownerDocument;
  const win = doc?.defaultView;
  if (!win || typeof win.getComputedStyle !== 'function') return null;
  const role = roleClassesOf(el.getAttribute('class'))[0] ?? null;
  const now = readType(el, win);
  const info: TextInfo = {
    role,
    values: {},
    differs: [],
    lang: langIn(el),
    upper:
      (win.getComputedStyle(el).getPropertyValue('text-transform') ?? '').trim() === 'uppercase',
  };
  if (!role) return info;
  const html = el as HTMLElement;
  const had = el.hasAttribute('style');
  const saved = el.getAttribute('style') ?? '';
  try {
    // transitions off for the whole probe: a value that moves while we look would animate on screen
    const off = `${saved};transition:none`;
    html.setAttribute('style', off);
    // the style alone
    html.setAttribute('style', 'transition:none');
    info.values = readType(el, win);
    // and back to the look it has, forced once with transitions still off, so the engine's "before"
    // is the real look and restoring the author's inline style changes no value
    html.setAttribute('style', off);
    void win.getComputedStyle(el).getPropertyValue('font-size');
  } finally {
    if (had) html.setAttribute('style', saved);
    else html.removeAttribute('style');
  }
  info.differs = TYPE_PROPS.filter((p) => now[p] !== info.values[p]);
  return info;
}
