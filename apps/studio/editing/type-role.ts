// editing/type-role.ts — S2.12: what the canvas knows about a text object's style, measured not guessed.
//
// A text object wears a style as a `t-<role>` class. Whether it OVERRIDES the style is a question about
// the rendered text: its computed type properties against what the class alone computes to. The role's
// values are read by taking the element's own inline style away for a moment (the cascade without the
// override is exactly the style), reading, and putting the inline style back — synchronously, with
// transitions off, so nothing paints and nothing animates. No node is added or removed, so Layers'
// structural observer never hears of it.
//
// The result rides the selection (`Selection.textInfo`) to the inspector. Detach inlines the style's
// values AS THE DESIGN SYSTEM WROTE THEM (`declaredTypeValues`: `var(--type-xl)`, not 28px) so a detached
// text still follows the tokens; a property the style's rule does not declare falls back to `values`.

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

/** The class selector a rule list names as `.t-heading` — `.t-heading, .t-poster` counts, `.t-heading:hover` does not. */
const namesRole = (selectorText: string, role: string): boolean =>
  selectorText.split(',').some((sel) => sel.trim() === `.${role}`);

type RuleLike = {
  selectorText?: string;
  style?: { getPropertyValue(p: string): string };
  cssRules?: ArrayLike<RuleLike>;
  media?: { mediaText?: string };
  conditionText?: string;
};

/**
 * What the design system's rule for a style declares, as written: `{ 'font-size': 'var(--type-xl)' }`.
 * Read from the document's stylesheets (the cascade's last matching `.t-<role>` rule wins per property,
 * through `@layer` / `@supports` groups and `@media` ones that apply now). A shorthand (`font: …`) or a
 * sheet the page may not read declares nothing here — the caller falls back to the computed value.
 */
export function declaredTypeValues(doc: Document, role: string): Record<string, string> {
  const out: Record<string, string> = {};
  const win = doc.defaultView;
  const applies = (rule: RuleLike): boolean => {
    const cond = rule.media?.mediaText ?? rule.conditionText;
    if (rule.media === undefined) return true;
    if (!cond || cond === 'all') return true;
    try {
      return !!win?.matchMedia?.(cond).matches;
    } catch {
      return false;
    }
  };
  const walk = (rules: ArrayLike<RuleLike> | undefined) => {
    for (let i = 0; i < (rules?.length ?? 0); i++) {
      const rule = (rules as ArrayLike<RuleLike>)[i] as RuleLike;
      if (typeof rule.selectorText === 'string') {
        if (!rule.style || !namesRole(rule.selectorText, role)) continue;
        for (const p of TYPE_PROPS) {
          const v = rule.style
            .getPropertyValue(p)
            .replace(/!important\s*$/i, '')
            .trim();
          if (v) out[p] = v;
        }
      } else if (rule.cssRules && applies(rule)) walk(rule.cssRules);
    }
  };
  for (let i = 0; i < doc.styleSheets.length; i++) {
    try {
      walk((doc.styleSheets[i] as unknown as { cssRules: ArrayLike<RuleLike> }).cssRules);
    } catch {
      /* a sheet from another origin cannot be read; its values come from the computed fallback */
    }
  }
  return out;
}
