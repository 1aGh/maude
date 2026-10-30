// The words half of `describeChanges` (V2-1.9 §5.5.2) — pure string helpers, no parser.
//
// English only (A20); CONTRACT §3–§4 voice: no "we", no monospace, quotes are curly, counts use the
// real noun. Everything here is deterministic and side-effect free, so S1.10's CSS / meta / annotation
// lanes reuse the same property words, value words and quoting as the TSX lane.

import { canvasWords, externalDisplay, parseLinkTarget } from '../bridge/link-target.ts';

/**
 * S3.10a — where a `data-cd-link` goes, in words: another canvas by name ("Pricing", "Pricing › desktop"),
 * an artboard of this canvas by id ("artboard desktop"), a website by host + path ("cal.com/studio"). An
 * invalid value is quoted; a formula is "a formula".
 */
export function linkTargetWords(raw: string): string {
  if (raw === '{expr}') return 'a formula';
  const t = parseLinkTarget(raw);
  if (!t) return quote(raw, 40);
  if (t.kind === 'artboard') return `artboard ${quote(t.artboard, 40)}`;
  if (t.kind === 'canvas')
    return t.artboard === null ? canvasWords(t.canvas) : `${canvasWords(t.canvas)} › ${t.artboard}`;
  return externalDisplay(t.url);
}

/** "Link to <target> added / changed / removed on <element>" (lead decision v2-lead-link-changes-in-tsx-lane). */
export function linkChangeWords(before: string | null, after: string | null, who: string): string {
  if (before === null && after !== null) return `Link to ${linkTargetWords(after)} added on ${who}`;
  if (before !== null && after === null)
    return `Link to ${linkTargetWords(before)} removed on ${who}`;
  return `Link to ${linkTargetWords(after ?? '')} changed on ${who}`;
}

/** A source value: a literal (string form) or a computed expression (its normalised source). */
export interface Val {
  lit: boolean;
  v: string;
}

// ── small text helpers ──────────────────────────────────────────────────────────────────────

/** `fontSize` / `font-size` / `FONT_SIZE` / `StickyNote` → "font size" (lower-case words). */
export function wordsOf(name: string): string {
  const spaced = name
    .replace(/^--/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_.:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced.toLowerCase();
}

/** "font size" → "Font size". */
export function sentence(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** `fontSize` → "Font size"; `MINI_TOOLS` → "Mini tools". */
export function nameInWords(name: string): string {
  return sentence(wordsOf(name));
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function collapseSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const MAX_QUOTE = 30;

/** Curly-quoted, shortened with an ellipsis past `max` characters. */
export function quote(s: string, max = MAX_QUOTE): string {
  const t = collapseSpace(s);
  return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`;
}

/** The first `n` words of a text, for an element name. */
export function firstWords(s: string, n = 5): string {
  const parts = collapseSpace(s).split(' ');
  return parts.length > n ? `${parts.slice(0, n).join(' ')}…` : parts.join(' ');
}

/**
 * Long text: the changed words with two words of context ("…od 10 let" → "…od 9 let").
 * Short texts (both ≤ `MAX_QUOTE`) are quoted whole.
 */
export function quotePair(a: string, b: string): [string, string] {
  const ta = collapseSpace(a);
  const tb = collapseSpace(b);
  if (ta.length <= MAX_QUOTE && tb.length <= MAX_QUOTE) return [quote(ta), quote(tb)];
  const wa = ta.split(' ');
  const wb = tb.split(' ');
  let pre = 0;
  while (pre < wa.length && pre < wb.length && wa[pre] === wb[pre]) pre++;
  let suf = 0;
  while (
    suf < wa.length - pre &&
    suf < wb.length - pre &&
    wa[wa.length - 1 - suf] === wb[wb.length - 1 - suf]
  )
    suf++;
  const cut = (w: string[]): string => {
    const from = Math.max(0, pre - 2);
    const to = Math.min(w.length, w.length - suf + 2);
    let s = w.slice(from, to).join(' ');
    if (s.length > 48) s = `${s.slice(0, 47).trimEnd()}…`;
    return `“${from > 0 ? '…' : ''}${s}${to < w.length ? '…' : ''}”`;
  };
  return [cut(wa), cut(wb)];
}

// ── names of things ─────────────────────────────────────────────────────────────────────────

const ROLE: Record<string, string> = {
  img: 'Image',
  picture: 'Image',
  image: 'Image',
  button: 'Button',
  a: 'Link',
  div: 'Frame',
  section: 'Section',
  header: 'Header',
  footer: 'Footer',
  nav: 'Navigation',
  main: 'Main area',
  aside: 'Side panel',
  article: 'Article',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  input: 'Field',
  textarea: 'Field',
  select: 'Menu',
  option: 'Option',
  label: 'Label',
  form: 'Form',
  table: 'Table',
  tr: 'Row',
  td: 'Cell',
  th: 'Cell',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  p: 'Text',
  span: 'Text',
  b: 'Text',
  i: 'Text',
  em: 'Text',
  strong: 'Text',
  small: 'Text',
  code: 'Code',
  pre: 'Code',
  svg: 'Icon',
  path: 'Shape',
  circle: 'Shape',
  rect: 'Shape',
  line: 'Shape',
  polygon: 'Shape',
  g: 'Group',
  video: 'Video',
  audio: 'Audio',
  hr: 'Divider',
  br: 'Line break',
  iframe: 'Embed',
  figure: 'Figure',
  canvas: 'Drawing',
  dl: 'List',
  dt: 'Term',
  dd: 'Definition',
};

/** The role word for a lower-case tag; a component tag gets its name in words. */
export function roleOf(tag: string): string {
  const t = tag.includes('.') ? (tag.split('.').pop() as string) : tag;
  if (/^[a-z]/.test(t)) return ROLE[t] ?? sentence(wordsOf(t));
  return nameInWords(t);
}

// ── properties ──────────────────────────────────────────────────────────────────────────────

const PROP: Record<string, string> = {
  background: 'Fill',
  backgroundColor: 'Fill',
  backgroundImage: 'Background image',
  backgroundSize: 'Background size',
  backgroundPosition: 'Background position',
  color: 'Text colour',
  fill: 'Fill',
  stroke: 'Stroke',
  fontSize: 'Font size',
  fontWeight: 'Font weight',
  fontFamily: 'Font',
  fontStyle: 'Font style',
  lineHeight: 'Line height',
  letterSpacing: 'Letter spacing',
  textAlign: 'Text alignment',
  textTransform: 'Text case',
  textDecoration: 'Text decoration',
  borderRadius: 'Corner',
  border: 'Border',
  borderColor: 'Border colour',
  borderWidth: 'Border width',
  borderStyle: 'Border style',
  borderTop: 'Top border',
  borderBottom: 'Bottom border',
  borderLeft: 'Left border',
  borderRight: 'Right border',
  left: 'X',
  top: 'Y',
  right: 'Right',
  bottom: 'Bottom',
  width: 'Width',
  height: 'Height',
  minWidth: 'Minimum width',
  maxWidth: 'Maximum width',
  minHeight: 'Minimum height',
  maxHeight: 'Maximum height',
  gap: 'Gap',
  rowGap: 'Row gap',
  columnGap: 'Column gap',
  padding: 'Padding',
  paddingTop: 'Top padding',
  paddingBottom: 'Bottom padding',
  paddingLeft: 'Left padding',
  paddingRight: 'Right padding',
  margin: 'Margin',
  marginTop: 'Top margin',
  marginBottom: 'Bottom margin',
  marginLeft: 'Left margin',
  marginRight: 'Right margin',
  opacity: 'Opacity',
  display: 'Display',
  flexDirection: 'Direction',
  flexWrap: 'Wrapping',
  flex: 'Flex',
  alignItems: 'Align',
  alignSelf: 'Align self',
  justifyContent: 'Justify',
  gridTemplateColumns: 'Columns',
  gridTemplateRows: 'Rows',
  boxShadow: 'Shadow',
  textShadow: 'Text shadow',
  filter: 'Filter',
  transform: 'Transform',
  transition: 'Transition',
  animation: 'Animation',
  overflow: 'Overflow',
  position: 'Position',
  zIndex: 'Layer',
  cursor: 'Cursor',
  objectFit: 'Image fit',
  aspectRatio: 'Aspect ratio',
};

/** CSS property → words (the reverse of S2's panel words). Unknown ones in sentence case. */
export function propLabel(key: string): string {
  return PROP[key] ?? nameInWords(key);
}

const ATTR: Record<string, string> = {
  src: 'Image',
  href: 'Link',
  alt: 'Alt text',
  title: 'Title',
  label: 'Label',
  'aria-label': 'Label',
  placeholder: 'Placeholder',
  name: 'Name',
  type: 'Type',
  value: 'Value',
  variant: 'Variant',
  size: 'Size',
  disabled: 'Disabled',
  checked: 'Checked',
  target: 'Opens in',
  role: 'Role',
  id: 'Name',
  'data-dc-element': 'Name',
};

export function attrLabel(name: string): string {
  return ATTR[name] ?? nameInWords(name);
}

// ── values ──────────────────────────────────────────────────────────────────────────────────

const UNITLESS = new Set([
  'opacity',
  'zIndex',
  'fontWeight',
  'lineHeight',
  'flex',
  'order',
  'flexGrow',
  'flexShrink',
  'scale',
  'aspectRatio',
  'zoom',
]);

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  gray: '#808080',
  grey: '#808080',
  brown: '#a52a2a',
  teal: '#008080',
  navy: '#000080',
};

function parseColour(v: string): [number, number, number, number] | null {
  const s = v.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  const named = NAMED[s];
  const hex = named ?? (s.startsWith('#') ? s : null);
  if (hex) {
    const m = /^#([0-9a-f]{3,8})$/.exec(hex);
    if (!m) return null;
    let h = m[1] as string;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (rgb) {
    const a = rgb[4]
      ? rgb[4].endsWith('%')
        ? Number.parseFloat(rgb[4]) / 100
        : Number(rgb[4])
      : 1;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), a];
  }
  const hsl =
    /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (hsl) {
    const h = Number(hsl[1]) / 360;
    const sat = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const f = (t0: number) => {
      let t = t0;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const a = hsl[4]
      ? hsl[4].endsWith('%')
        ? Number.parseFloat(hsl[4]) / 100
        : Number(hsl[4])
      : 1;
    return [
      Math.round(f(h + 1 / 3) * 255),
      Math.round(f(h) * 255),
      Math.round(f(h - 1 / 3) * 255),
      a,
    ];
  }
  return null;
}

/** A colour in words: "black", "light grey", "dark blue", "transparent"; null when not a colour. */
export function colourWord(v: string): string | null {
  const c = parseColour(v);
  if (!c) return null;
  const [r, g, b, a] = c;
  if (a < 0.04) return 'transparent';
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const faint = a < 0.5 ? 'faint ' : '';
  if (l < 0.08) return `${faint}black`;
  if (l > 0.95) return `${faint}white`;
  if (s < 0.12) {
    if (l < 0.3) return `${faint}dark grey`;
    if (l > 0.72) return `${faint}light grey`;
    return `${faint}grey`;
  }
  let hue: string;
  if (h < 15 || h >= 345) hue = 'red';
  else if (h < 40) hue = 'orange';
  else if (h < 65) hue = 'yellow';
  else if (h < 165) hue = 'green';
  else if (h < 195) hue = 'teal';
  else if (h < 255) hue = 'blue';
  else if (h < 290) hue = 'purple';
  else hue = 'pink';
  if (hue === 'orange' && l < 0.35) hue = 'brown';
  const tone = l < 0.28 ? 'dark ' : l > 0.78 ? 'light ' : '';
  return `${faint}${tone}${hue}`;
}

export interface WordsOptions {
  /** Token display name (`tokens.json`, V2-1.13) for a `var(--name)`; falls back to the name in words. */
  tokenName?: (name: string) => string | undefined;
}

const NUM = /^(-?\d*\.?\d+)\s*(px|%|em|rem|vh|vw|deg|s|ms)?$/;

function numberUnit(v: string, prop: string): [number, string] | null {
  const m = NUM.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? (UNITLESS.has(prop) ? '' : 'px');
  return [n, unit];
}

function unitText(n: number, unit: string): string {
  if (unit === '') return String(n);
  if (unit === '%' || unit === 'deg') return `${n}${unit}`;
  return `${n} ${unit}`;
}

function tokenWords(v: string, opts: WordsOptions): string | null {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(v.trim());
  if (!m) return null;
  const name = m[1] as string;
  return opts.tokenName?.(name) ?? wordsOf(name);
}

/** One value alone, in words. `null` ⇒ computed (caller says "a formula"). */
function oneValue(prop: string, val: Val, opts: WordsOptions): string | null {
  if (!val.lit) return null;
  const v = collapseSpace(val.v);
  const tok = tokenWords(v, opts);
  if (tok) return tok;
  const nu = numberUnit(v, prop);
  if (nu) return unitText(nu[0], nu[1]);
  const col = colourWord(v);
  if (col) return col;
  if (v.length > 32) return `${v.slice(0, 31).trimEnd()}…`;
  return v;
}

export interface ValuePair {
  /** "120 → 150 px" form, ready after the property label. */
  text: string;
  /** True when a side is a computed expression (grade W2). */
  computed: boolean;
}

/** `a → b` in words: "120 → 150 px", "black → white", "block → flex", "Bg 1 → Bg 2". */
export function valuePair(prop: string, a: Val, b: Val, opts: WordsOptions = {}): ValuePair {
  if (!a.lit || !b.lit) {
    const wa = a.lit ? oneValue(prop, a, opts) : 'a formula';
    const wb = b.lit ? oneValue(prop, b, opts) : 'a formula';
    return { text: `${wa} → ${wb}`, computed: true };
  }
  const na = numberUnit(a.v, prop);
  const nb = numberUnit(b.v, prop);
  if (na && nb && na[1] === nb[1]) {
    const tail = nb[1] === '' || nb[1] === '%' || nb[1] === 'deg' ? '' : ` ${nb[1]}`;
    const sep = nb[1] === '%' || nb[1] === 'deg' ? nb[1] : '';
    return { text: `${na[0]}${sep} → ${nb[0]}${sep || tail}`, computed: false };
  }
  let wa = oneValue(prop, a, opts) as string;
  let wb = oneValue(prop, b, opts) as string;
  if (wa === wb) {
    // Two colours with the same word (a subtle shade) — the exact values say it.
    wa = collapseSpace(a.v).toUpperCase();
    wb = collapseSpace(b.v).toUpperCase();
    if (wa === wb) {
      wa = collapseSpace(a.v);
      wb = collapseSpace(b.v);
    }
  }
  return { text: `${wa} → ${wb}`, computed: false };
}

/** One value for "set to …" / "(was …)". */
export function valueText(prop: string, v: Val, opts: WordsOptions = {}): string {
  return oneValue(prop, v, opts) ?? 'a formula';
}

/** The same value written two ways (`88` and `"88px"`, `"#FFF"` and `"#fff"`) is no change. */
export function sameValue(prop: string, a: Val, b: Val): boolean {
  if (a.lit !== b.lit) return false;
  if (a.v === b.v) return true;
  if (!a.lit) return false;
  const na = numberUnit(a.v, prop);
  const nb = numberUnit(b.v, prop);
  if (na && nb) return na[0] === nb[0] && na[1] === nb[1];
  return collapseSpace(a.v).toLowerCase() === collapseSpace(b.v).toLowerCase();
}
