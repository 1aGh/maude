// edit-ops/clip/title-style.ts — `video.title.style` (S7.11b; 07 ve-text "Font" and "Colour").
//
// A title is the element that holds its words — the parent of the clip's first `{"…"}` string literal, the same
// literal `clip.set-text` rewrites. Its look is that element's `style` object literal:
//   Font    `fontFamily: "var(--font-display)"`   a design-system font token, never a family name typed in
//   Colour  `color: "var(--accent)"`              a token, or a plain CSS colour (hex, rgb(), oklch(), …)
// `null` takes one off again; the last property off takes the empty `style` off with it; the same value writes
// nothing. A `style` that is not an object literal (written in code) is not rewritten. When the title sits in a
// `<Place>` and a `<TitleMotion>`, the words — not the wrappers — are styled (those carry position and motion).
// Pure: no IO.

import MagicString from 'magic-string';

import {
  attrNode,
  bad,
  finish,
  jsxElements,
  type Node,
  parseProgram,
  resolveClip,
  setProp,
} from './jsx.ts';

/** A DS font token and nothing else: the family stays a decision of the design system. */
const FONT_RE = /^var\(--font-[a-z0-9][a-z0-9_-]*\)$/;
/** A DS colour token, or one plain CSS colour. No `url()`, `calc()`, `;`, `!important`, no free text. */
const COLOR_RE =
  /^(?:var\(--[a-z0-9][a-z0-9_-]*\)|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([0-9a-z.,%/+\- ]{1,80}\)|transparent|currentcolor|white|black)$/i;

export interface TitleStylePatch {
  /** a `var(--font-…)`; null takes the font off; undefined leaves it */
  font?: string | null;
  /** a token or a CSS colour; null takes the colour off; undefined leaves it */
  color?: string | null;
}

const KEYS = [
  ['font', 'fontFamily'],
  ['color', 'color'],
] as const;

export function titleStylePatch(
  file: string,
  p: Record<string, unknown>,
  id: string
): TitleStylePatch {
  const out: TitleStylePatch = {};
  if (p.font !== undefined) {
    if (p.font !== null && (typeof p.font !== 'string' || !FONT_RE.test(p.font)))
      bad(file, 'The font is one of the design system’s fonts, written var(--font-…).', id);
    out.font = p.font as string | null;
  }
  if (p.color !== undefined) {
    if (p.color !== null && (typeof p.color !== 'string' || !COLOR_RE.test(p.color)))
      bad(file, 'The colour is one of the design system’s colours or a plain CSS colour.', id);
    out.color = p.color as string | null;
  }
  if (out.font === undefined && out.color === undefined)
    bad(file, 'Pick a font or a colour for the title.', id);
  return out;
}

const isString = (n: Node) =>
  (n?.type === 'Literal' || n?.type === 'StringLiteral') && typeof n.value === 'string';

/** The element holding the clip's first `{"…"}` literal: the title's words. Null when it has none. */
export function titleTextElement(els: ReturnType<typeof jsxElements>, start: number, end: number) {
  let best: { el: Node; at: number } | null = null;
  for (const { el } of els) {
    if (el.start < start || el.end > end) continue;
    for (const c of el.children ?? []) {
      if (c?.type !== 'JSXExpressionContainer' || !isString(c.expression)) continue;
      if (!best || c.start < best.at) best = { el, at: c.start };
      break; // later children of this element start later
    }
  }
  return best?.el ?? null;
}

const keyName = (p: Node): string | null => {
  if (p?.type !== 'Property' && p?.type !== 'ObjectProperty') return null;
  if (p.computed) return null;
  if (p.key?.type === 'Identifier') return p.key.name;
  return isString(p.key) ? p.key.value : null;
};

export function applyTitleStyle(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined,
  patch: TitleStylePatch
): { source: string } {
  const { clip } = resolveClip(file, source, artboard, stableId, hash);
  const program = parseProgram(file, source);
  const el = titleTextElement(jsxElements(program), clip.start, clip.end);
  if (!el) return bad(file, 'This clip has no text to style (a title has).', stableId);

  const wanted = KEYS.flatMap(([k, prop]) =>
    patch[k] === undefined ? [] : [{ prop, value: patch[k] as string | null }]
  );
  const attr = attrNode(el, 'style');
  const s = new MagicString(source);

  if (!attr) {
    const set = wanted.filter((w) => w.value !== null);
    if (!set.length) return { source };
    setProp(
      s,
      el,
      'style',
      `{{ ${set.map((w) => `${w.prop}: ${JSON.stringify(w.value)}`).join(', ')} }}`
    );
    return { source: finish(file, s, stableId) };
  }

  const expr = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null;
  if (expr?.type !== 'ObjectExpression')
    return bad(file, 'This title’s style is written in code; change it in the file.', stableId);

  const props: Node[] = expr.properties ?? [];
  // the properties as they will be: each one's source text, with the asked-for values applied
  let changed = false;
  let removed = false;
  const texts: string[] = props.map((p) => source.slice(p.start, p.end));
  for (const w of wanted) {
    const i = props.findIndex((p) => keyName(p) === w.prop);
    if (w.value === null) {
      if (i < 0) continue;
      texts[i] = '';
      removed = true;
      changed = true;
      continue;
    }
    const next = `${w.prop}: ${JSON.stringify(w.value)}`;
    if (i < 0) {
      texts.push(next);
      changed = true;
    } else if (texts[i] !== next && !sameString(props[i], w.value)) {
      texts[i] = next;
      changed = true;
    }
  }
  if (!changed) return { source };

  const kept = texts.filter(Boolean);
  if (!kept.length) {
    setProp(s, el, 'style', null); // the last property is off: so is the empty style
    return { source: finish(file, s, stableId) };
  }
  if (removed) {
    // a property came off: say the object again, which keeps every remaining property's own text
    s.overwrite(expr.start, expr.end, `{ ${kept.join(', ')} }`);
  } else {
    // only values changed or were added: touch just those, so the author's layout stays
    for (const w of wanted) {
      if (w.value === null) continue;
      const i = props.findIndex((p) => keyName(p) === w.prop);
      if (i >= 0 && texts[i] !== source.slice(props[i].start, props[i].end))
        s.overwrite(props[i].value.start, props[i].value.end, JSON.stringify(w.value));
    }
    const added = texts.slice(props.length);
    if (added.length) {
      const last = props[props.length - 1];
      if (last) s.appendLeft(last.end, `, ${added.join(', ')}`);
      else s.overwrite(expr.start, expr.end, `{ ${added.join(', ')} }`);
    }
  }
  return { source: finish(file, s, stableId) };
}

/** Does the property's value already say `value` (a string literal)? */
function sameString(prop: Node, value: string): boolean {
  return isString(prop?.value) && prop.value.value === value;
}
