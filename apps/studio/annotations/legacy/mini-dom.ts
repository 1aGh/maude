/**
 * @file       annotations/legacy/mini-dom.ts — DOM-free parse of a legacy annotation SVG
 * @scope      apps/studio/annotations/legacy/mini-dom.ts
 * @purpose    The v1 parser (`strokesFromDocument` in annotations-model.ts)
 *             reads through a tiny slice of the DOM API. The hub runs on Node
 *             (no DOMParser) yet must upconvert legacy SVG history blobs, and
 *             the migration must give the SAME result on every host — so every
 *             v2 consumer parses legacy SVG through this one tree, never a
 *             browser DOMParser.
 *
 *             Supports exactly what the fixed annotation vocabulary needs:
 *             elements, quoted attributes, text, the five XML entities plus
 *             numeric references, comments / processing instructions (skipped),
 *             and the selectors `[data-tool]`, `[attr]` and bare tag names.
 *             Malformed input yields a document containing `<parsererror>`, which
 *             the v1 parser already treats as "no strokes".
 *
 *             `outerHTML` only matters for elements WITHOUT a `data-id` (the
 *             v1 `stableAnnotationId` fallback). Its bytes may differ from a
 *             browser's serializer; ids of such hand-authored elements are
 *             therefore stable across v2 hosts, not necessarily equal to what a
 *             v1 browser tab computed. Canonical v1 output always carries data-id.
 */

import type { SvgDocLike, SvgElLike } from '../../annotations-model.ts';

const MAX_DEPTH = 64;
const MAX_NODES = 200_000;

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, ent: string) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    const cp = ent.startsWith('#x')
      ? Number.parseInt(ent.slice(2), 16)
      : Number.parseInt(ent.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

type Node = MiniElement | string;

export class MiniElement implements SvgElLike {
  readonly tagName: string;
  readonly attrs: Array<[string, string]>;
  readonly children: Node[] = [];

  constructor(tagName: string, attrs: Array<[string, string]>) {
    this.tagName = tagName;
    this.attrs = attrs;
  }

  getAttribute(name: string): string | null {
    for (const [k, v] of this.attrs) if (k === name) return v;
    return null;
  }

  private matches(selector: string): boolean {
    const attr = /^\[([\w:-]+)\]$/.exec(selector);
    if (attr) return this.getAttribute(attr[1] as string) !== null;
    const local = this.tagName.split(':').pop()?.toLowerCase();
    return local === selector.toLowerCase();
  }

  private *walk(): Generator<MiniElement> {
    for (const c of this.children) {
      if (typeof c === 'string') continue;
      yield c;
      yield* c.walk();
    }
  }

  querySelector(selector: string): MiniElement | null {
    for (const el of this.walk()) if (el.matches(selector)) return el;
    return null;
  }

  querySelectorAll(selector: string): MiniElement[] {
    const out: MiniElement[] = [];
    for (const el of this.walk()) if (el.matches(selector)) out.push(el);
    return out;
  }

  get textContent(): string {
    let out = '';
    for (const c of this.children) out += typeof c === 'string' ? c : c.textContent;
    return out;
  }

  get outerHTML(): string {
    const attrs = this.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
    if (!this.children.length) return `<${this.tagName}${attrs}/>`;
    const inner = this.children
      .map((c) => (typeof c === 'string' ? escText(c) : c.outerHTML))
      .join('');
    return `<${this.tagName}${attrs}>${inner}</${this.tagName}>`;
  }
}

function errorDoc(): MiniElement {
  const root = new MiniElement('#document', []);
  root.children.push(new MiniElement('parsererror', []));
  return root;
}

/**
 * Parse SVG text into a document-like tree. Never throws.
 *
 * A single forward scan with `indexOf` — never a regex that can re-scan the
 * input: an unterminated `<!--`, `<?`, CDATA or tag is a parse error found in
 * one pass (the defender review measured the earlier all-in-one regex at
 * quadratic time on `<!--` repeated — minutes of a blocked event loop on a
 * 4 MB body, reachable from the canvas origin and from peers).
 */
export function parseMiniDom(text: string): SvgDocLike & MiniElement {
  const root = new MiniElement('#document', []);
  const stack: MiniElement[] = [root];
  const top = () => stack[stack.length - 1] as MiniElement;
  const closeRe = /^<\/\s*([\w:-]+)\s*>$/;
  const openRe = /^<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/;
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const len = text.length;
  let i = 0;
  let nodes = 0;
  while (i < len) {
    const lt = text.indexOf('<', i);
    const chunk = text.slice(i, lt < 0 ? len : lt);
    if (chunk) top().children.push(decodeEntities(chunk));
    if (lt < 0) break;
    if (++nodes > MAX_NODES) return errorDoc();
    const skipTo = (terminator: string, from: number): number => {
      const end = text.indexOf(terminator, from);
      return end < 0 ? -1 : end + terminator.length;
    };
    if (text.startsWith('<!--', lt)) {
      i = skipTo('-->', lt + 4);
      if (i < 0) return errorDoc();
      continue;
    }
    if (text.startsWith('<?', lt)) {
      i = skipTo('?>', lt + 2);
      if (i < 0) return errorDoc();
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) return errorDoc();
      top().children.push(text.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      i = skipTo('>', lt + 2);
      if (i < 0) return errorDoc();
      continue;
    }
    // A tag: scan to its closing '>' honouring quoted attribute values.
    let j = lt + 1;
    let quote = '';
    while (j < len) {
      const ch = text[j] as string;
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      else if (ch === '<') return errorDoc();
      j++;
    }
    if (j >= len) return errorDoc();
    const tag = text.slice(lt, j + 1);
    i = j + 1;
    const close = closeRe.exec(tag);
    if (close) {
      const open = stack.pop();
      if (!open || open === root || open.tagName !== close[1]) return errorDoc();
      continue;
    }
    const m = openRe.exec(tag);
    if (!m) return errorDoc();
    const attrs: Array<[string, string]> = [];
    let a: RegExpExecArray | null;
    attrRe.lastIndex = 0;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
    while ((a = attrRe.exec(m[2] ?? '')) !== null) {
      attrs.push([a[1] as string, decodeEntities(a[2] ?? a[3] ?? '')]);
    }
    const el = new MiniElement(m[1] as string, attrs);
    top().children.push(el);
    if (!m[3]) {
      if (stack.length > MAX_DEPTH) return errorDoc();
      stack.push(el);
    }
  }
  if (stack.length !== 1) return errorDoc();
  return root;
}
