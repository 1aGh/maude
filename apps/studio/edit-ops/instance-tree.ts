// edit-ops/instance-tree.ts — S2.17: the plain markup a Detach writes.
//
// Detach turns an instance into "a plain frame with the identical look". Only the canvas knows what the
// instance renders to (a system may override a component in its own `_ds.tsx`), so the canvas MEASURES
// the rendered subtree (editing/instance-tree.ts) and sends it as `tree`. The canvas is untrusted
// (DDR-054): everything here is a validator + a printer. A tag, an attribute or a style value this file
// does not know is dropped (or, for a style value that is not a value, refuses the whole detach); no
// text from the tree is ever printed as code (`jsxText`). The look is class-driven — the classes the
// system's CSS styles by stay, so its tokens keep coming from `var(--…)` in that CSS — and the instance's
// own inline `style` is printed as it was authored, token references and all, never as computed px.

import { imageUrlOk } from './words-paint.ts';

/** One rendered element; `kids` interleaves text and elements in document order. */
export interface TreeNode {
  tag: string;
  attrs: Record<string, string>;
  kids: Array<TreeNode | string>;
}

export const MAX_DEPTH = 12;
export const MAX_NODES = 240;
export const MAX_TEXT = 2000;

const HTML_TAGS = new Set(
  `a abbr article aside b blockquote button caption code div em figure figcaption footer h1 h2 h3 h4 h5 h6
   header hr i img input label li main nav ol p section small span strong sub sup table tbody td th thead tr u ul`.split(
    /\s+/
  )
);
const SVG_TAGS = new Set('svg g path circle rect line polyline polygon ellipse title'.split(' '));
const VOID_TAGS = new Set(['hr', 'img', 'input']);

/** attribute (as the DOM spells it) → how JSX spells it */
const JSX_NAME: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  viewbox: 'viewBox',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-opacity': 'strokeOpacity',
  'fill-opacity': 'fillOpacity',
  tabindex: 'tabIndex',
  maxlength: 'maxLength',
};
const PLAIN_ATTRS = new Set(
  `type role href alt title lang dir width height placeholder name value disabled checked readonly
   required rel target src srcset viewbox d fill stroke stroke-width stroke-linecap stroke-linejoin
   fill-rule clip-rule stroke-miterlimit stroke-opacity fill-opacity opacity cx cy r rx ry x y x1 y1 x2 y2
   points transform xmlns focusable tabindex maxlength for`.split(/\s+/)
);
const BOOLEAN_ATTRS = new Set(['disabled', 'checked', 'readonly', 'required', 'focusable']);
const SAFE_VALUE = /^[^<>`{}\\\n\r]{0,500}$/;
const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DATA_OK = /^data-(?:tone|theme|state|size|side|variant|kind|shape|ds-missing)$/;
const CLASS_RE = /^[A-Za-z0-9_:/.\- ]{1,400}$/;
const PROP_RE = /^(?:--[A-Za-z0-9_-]{1,64}|[a-z][a-z-]{0,48})$/;
const VALUE_OK = /^[^;{}<>`$\\\n\r]{1,300}$/;
const INPUT_TYPES = new Set([
  'text',
  'checkbox',
  'radio',
  'button',
  'submit',
  'email',
  'number',
  'search',
  'password',
]);

export class TreeRefusal extends Error {}

const refuse = (m: string): never => {
  throw new TreeRefusal(m);
};

/** `background-image: url(…)` and friends: every url must be one a fill may name. */
function urlsOk(v: string): boolean {
  for (const m of v.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    if (!imageUrlOk((m[1] ?? m[2] ?? m[3] ?? '').trim())) return false;
  }
  return !/(?:expression\s*\(|@import|javascript:|behavior\s*:)/i.test(v);
}

/** `a: b; c: d` → declarations, or a refusal when one is not a declaration. */
function parseStyle(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of css.split(';')) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    const prop = i < 0 ? '' : t.slice(0, i).trim().toLowerCase();
    const value = i < 0 ? '' : t.slice(i + 1).trim();
    if (!PROP_RE.test(prop) || !VALUE_OK.test(value) || !urlsOk(value))
      return refuse('That is not a look the instance can have.');
    out.push([prop, value]);
  }
  return out;
}

/** A clean copy of the tree, or a refusal. `rootId` is the id the replacement keeps. */
export function sanitizeTree(raw: unknown, rootId: string): TreeNode {
  let nodes = 0;
  const walk = (n: unknown, depth: number): TreeNode => {
    if (!n || typeof n !== 'object' || Array.isArray(n))
      return refuse('The canvas did not say what the instance looks like.');
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES)
      return refuse('This instance is too large to detach in one go.');
    const o = n as Record<string, unknown>;
    const tag = typeof o.tag === 'string' ? o.tag.toLowerCase() : '';
    if (!HTML_TAGS.has(tag) && !SVG_TAGS.has(tag))
      return refuse(`A <${tag.slice(0, 20)}> cannot be written as a plain frame.`);
    const attrs: Record<string, string> = {};
    const rawAttrs =
      o.attrs && typeof o.attrs === 'object' ? (o.attrs as Record<string, unknown>) : {};
    for (const [k0, v] of Object.entries(rawAttrs)) {
      const k = k0.toLowerCase();
      if (typeof v !== 'string') continue;
      if (k === 'class') {
        const c = v.trim().replace(/\s+/g, ' ');
        if (c && !CLASS_RE.test(c)) return refuse('A class on this instance is not readable.');
        if (c) attrs.class = c;
      } else if (k === 'style') {
        const decl = parseStyle(v);
        if (decl.length) attrs.style = decl.map(([p, val]) => `${p}: ${val}`).join('; ');
      } else if (k === 'data-cd-id') {
        // nested authored ids stay (their comments and board items follow them); the root's is the instance's
        if (depth > 0 && ID_RE.test(v) && v.length <= 48) attrs['data-cd-id'] = v;
      } else if (DATA_OK.test(k) || /^aria-[a-z]+$/.test(k)) {
        if (SAFE_VALUE.test(v)) attrs[k] = v;
      } else if (PLAIN_ATTRS.has(k)) {
        if (k === 'type' && tag !== 'svg' && !INPUT_TYPES.has(v)) continue;
        if (
          (k === 'href' || k === 'src') &&
          !/^(?:https:\/\/[^\s]+|#[\w-]*|mailto:[^\s]+|tel:[^\s]+|[^:\s]+)$/i.test(v)
        )
          continue;
        if (k === 'srcset') continue;
        if (SAFE_VALUE.test(v) && (BOOLEAN_ATTRS.has(k) || v.length > 0 || k === 'alt'))
          attrs[k] = v;
      }
    }
    if (depth === 0) attrs['data-cd-id'] = rootId;
    const kidsRaw = Array.isArray(o.kids) ? o.kids : [];
    const kids: Array<TreeNode | string> = [];
    for (const k of kidsRaw) {
      if (typeof k === 'string') {
        if (k.length > MAX_TEXT || /\p{Cc}/u.test(k.replace(/[\t\n\r]/g, ' ')))
          return refuse('Some of the words in this instance are not readable.');
        kids.push(k);
      } else kids.push(walk(k, depth + 1));
    }
    return { tag, attrs, kids };
  };
  return walk(raw, 0);
}

// ── printing ─────────────────────────────────────────────────────────────────────────────────

const camel = (p: string) => p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** JSX text that survives any character: plain when it is safe, a string expression otherwise. */
export const jsxTextOf = (s: string): string => (/[{}<>&]/.test(s) ? `{${JSON.stringify(s)}}` : s);

/** text with its edge spaces kept: JSX trims them on a line of its own, so those go in an expression. */
const textJsx = (t: string): string => (t !== t.trim() ? `{${JSON.stringify(t)}}` : jsxTextOf(t));

const attrJsx = (name: string, value: string): string => {
  const jsx = JSX_NAME[name] ?? name;
  if (BOOLEAN_ATTRS.has(name)) return jsx;
  return /["{}&\\\n]/.test(value) ? `${jsx}={${JSON.stringify(value)}}` : `${jsx}="${value}"`;
};

function styleJsx(css: string): string {
  const parts = parseStyle(css).map(([p, v]) => {
    const key = p.startsWith('--') ? JSON.stringify(p) : camel(p);
    return `${key}: ${JSON.stringify(v)}`;
  });
  return `style={{ ${parts.join(', ')} }}`;
}

/** The tree as JSX at `indent`, one element per line while it holds only elements. */
export function printTree(node: TreeNode, indent: string, unit: string): string {
  const attrs: string[] = [];
  // the id first, then the look, then the rest — the order a person would write them
  if (node.attrs['data-cd-id']) attrs.push(`data-cd-id="${node.attrs['data-cd-id']}"`);
  if (node.attrs.class) attrs.push(attrJsx('class', node.attrs.class));
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'data-cd-id' || k === 'class' || k === 'style') continue;
    attrs.push(attrJsx(k, v));
  }
  if (node.attrs.style) attrs.push(styleJsx(node.attrs.style));
  const open = `<${node.tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
  if (VOID_TAGS.has(node.tag) || node.kids.length === 0) return `${open} />`;
  const onlyText = node.kids.every((k) => typeof k === 'string');
  if (onlyText) {
    const t = (node.kids as string[]).join('').replace(/\s+/g, ' ');
    return t.trim() ? `${open}>${textJsx(t)}</${node.tag}>` : `${open} />`;
  }
  const inner = `${indent}${unit}`;
  const lines: string[] = [];
  for (const k of node.kids) {
    if (typeof k === 'string') {
      const t = k.replace(/\s+/g, ' ');
      if (!t) continue;
      // a space between two elements is real (React printed it): keep it as an expression
      lines.push(`${inner}${t.trim() ? textJsx(t) : '{" "}'}`);
    } else lines.push(`${inner}${printTree(k, inner, unit)}`);
  }
  return `${open}>\n${lines.join('\n')}\n${indent}</${node.tag}>`;
}
