// Value-type productions of the DS schema (V2-1.13 §5.3.1). STRUCTURE ONLY: a value is
// classified by its form ("a colour function", "a dimension"), never judged by magnitude,
// ordering or hue (A14, DDR-043).

import { splitTopLevel } from './css-scan.ts';
import type { ValueForm, ValueTypeName } from './registry.ts';

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const LENGTH_UNITS =
  'px|em|rem|ex|rex|cap|rcap|ch|rch|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|svi|svb|svmin|svmax|lvw|lvh|lvi|lvb|lvmin|lvmax|dvw|dvh|dvi|dvb|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pt|pc';
const RE = {
  hex: /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  colorFn: /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i,
  lightDark: /^light-dark\(/i,
  zero: /^[+-]?0+(?:\.0+)?$/,
  dimension: new RegExp(`^${NUM}(?:${LENGTH_UNITS})$`, 'i'),
  percentage: new RegExp(`^${NUM}%$`),
  math: /^(?:calc|min|max|clamp|round|mod|rem|abs|sign)\(/i,
  time: new RegExp(`^${NUM}(?:ms|s)$`, 'i'),
  number: new RegExp(`^${NUM}$`),
  cubicBezier: /^cubic-bezier\(/i,
  steps: /^steps\(/i,
  linearFn: /^linear\(/i,
  varRef: /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([\s\S]*))?\)$/,
  ident: /^-?[A-Za-z_][A-Za-z0-9_-]*$/,
};

const EASING_KEYWORDS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
]);

// CSS Color 4 named colours + the two special keywords.
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace ' +
    'olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred ' +
    'papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
    'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey ' +
    'snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen transparent currentcolor'
  ).split(' ')
);

export function isNamedColor(word: string): boolean {
  return NAMED_COLORS.has(word.toLowerCase());
}

/** True when the parens of `v` close exactly at its last character (one function call). */
function wholeCall(v: string): boolean {
  if (!v.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0 && i !== v.length - 1) return false;
    }
  }
  return depth === 0;
}

/** Strip a trailing `!important`. */
export function cleanValue(raw: string): string {
  return raw.replace(/\s*!important\s*$/i, '').trim();
}

/** The `var(--name …)` of a value that is exactly one var() call, or null. */
export function exactVarRef(v: string): { name: string; fallback: string | null } | null {
  const s = cleanValue(v);
  if (!s.startsWith('var(') || !wholeCall(s)) return null;
  const m = RE.varRef.exec(s);
  if (!m) return null;
  return { name: m[1], fallback: m[2] !== undefined ? m[2].trim() : null };
}

/** Every `var(--name)` reference in a value, fallbacks included (recursively). */
export function varRefs(v: string): { name: string; hasFallback: boolean; index: number }[] {
  const out: { name: string; hasFallback: boolean; index: number }[] = [];
  const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;
  for (let m = re.exec(v); m; m = re.exec(v)) {
    out.push({ name: m[1], hasFallback: Boolean(m[2]), index: m.index });
  }
  return out;
}

/** The single forms a value matches (var-ref is reported, not resolved, here). */
export function formsOf(raw: string): Set<ValueForm> {
  const v = cleanValue(raw);
  const forms = new Set<ValueForm>();
  if (!v) return forms;
  const lower = v.toLowerCase();
  if (exactVarRef(v)) forms.add('var-ref');
  if (RE.hex.test(v)) forms.add('hex');
  if (RE.colorFn.test(v) && wholeCall(v)) forms.add('color-function');
  if (RE.lightDark.test(v) && wholeCall(v)) forms.add('light-dark');
  if (isNamedColor(v)) forms.add('named-color');
  if (RE.zero.test(v)) forms.add('zero');
  if (RE.dimension.test(v)) forms.add('dimension');
  if (RE.percentage.test(v)) forms.add('percentage');
  if (RE.math.test(v) && wholeCall(v)) forms.add('math');
  if (lower === 'none') forms.add('none');
  if (lower === 'normal') forms.add('normal');
  if (RE.time.test(v)) forms.add('time');
  if (RE.number.test(v)) forms.add('number');
  if (RE.cubicBezier.test(v) && wholeCall(v)) forms.add('cubic-bezier');
  if (RE.steps.test(v) && wholeCall(v)) forms.add('steps');
  if (RE.linearFn.test(v) && wholeCall(v)) forms.add('linear-function');
  if (EASING_KEYWORDS.has(lower)) forms.add('easing-keyword');
  if (isFamilyList(v)) forms.add('family-list');
  if (isShadowLayers(v)) forms.add('shadow-layers');
  return forms;
}

function isFamilyList(v: string): boolean {
  const parts = splitTopLevel(v, ',');
  if (!parts.length) return false;
  return parts.every((p) => {
    if (/^"[^"]*"$|^'[^']*'$/.test(p)) return true;
    if (exactVarRef(p)) return true;
    return p.split(/\s+/).every((w) => RE.ident.test(w)) && !/^(?:initial|inherit|unset)$/i.test(p);
  });
}

function isLengthToken(t: string): boolean {
  return (
    RE.zero.test(t) ||
    RE.dimension.test(t) ||
    (RE.math.test(t) && wholeCall(t)) ||
    Boolean(exactVarRef(t))
  );
}

function isColorToken(t: string): boolean {
  return (
    RE.hex.test(t) ||
    (RE.colorFn.test(t) && wholeCall(t)) ||
    (RE.lightDark.test(t) && wholeCall(t)) ||
    isNamedColor(t) ||
    Boolean(exactVarRef(t))
  );
}

function isShadowLayers(v: string): boolean {
  const layers = splitTopLevel(v, ',');
  if (!layers.length) return false;
  return layers.every((layer) => {
    const toks = splitTopLevel(layer, ' ');
    let lengths = 0;
    let color = 0;
    let inset = 0;
    let vars = 0;
    for (const t of toks) {
      if (t.toLowerCase() === 'inset') inset++;
      else if (exactVarRef(t)) vars++;
      else if (isLengthToken(t)) lengths++;
      else if (isColorToken(t)) color++;
      else return false;
    }
    if (inset > 1 || color > 1) return false;
    // var() tokens may stand for a length or the colour: 2–4 lengths, at most one colour.
    return lengths <= 4 && lengths + vars >= 2 && lengths + vars <= 5;
  });
}

/** Does the value's own form (var-ref aside) satisfy the type? */
export function matchesType(
  raw: string,
  type: ValueTypeName,
  typeForms: Record<ValueTypeName, { forms: ValueForm[] }>
): boolean {
  const forms = formsOf(raw);
  return typeForms[type].forms.some((f) => f !== 'var-ref' && forms.has(f));
}
