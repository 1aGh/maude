// edit-ops/clip/jsx.ts — the AST reading the S7.6c video ops share (reframe, fit, duck, captions,
// place, formats, take swap).
//
// The ops write the V2-1.10 §5.3 comp vocabulary (`<Reframe>`, `<Duck>`, `<Captions>`, and S7 Q5's
// `<Place>`) as LITERAL props, so the Timeline enumerator and the inspector read them back as text
// (DDR-150's two-tokenizer rule). Values are read here from the AST — a prop that is not a literal
// (a const, a call) is refused rather than guessed, so a hand-written expression is never clobbered.
// Writes are text-surgical through MagicString on the spans this module finds. Pure: no IO.

import type MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import {
  assertCompSemantics,
  CanvasEditError,
  type ClipInfo,
  enumerateClips,
} from '../../canvas-edit.ts';
import { assertParses } from '../../clip-ops.ts';

// biome-ignore lint/suspicious/noExplicitAny: oxc's ESTree nodes are walked structurally
export type Node = any;

export const bad = (file: string, message: string, id = ''): never => {
  throw new CanvasEditError(message, { canvas: file, id });
};

export function parseProgram(file: string, source: string): Node {
  const parsed = parseSync(file, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0)
    bad(file, 'The canvas does not parse; fix the JSX first.');
  return parsed.program;
}

/** The tag of a JSXElement (`Reframe`, `TransitionSeries.Sequence`), or null. */
export function tagOf(el: Node): string | null {
  const n = el?.openingElement?.name;
  if (!n) return null;
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression' && n.object?.type === 'JSXIdentifier')
    return `${n.object.name}.${n.property?.name}`;
  return null;
}

/** Every JSXElement in document order, each with its nearest JSX parent (element or fragment). */
export function jsxElements(program: Node): Array<{ el: Node; parent: Node | null }> {
  const out: Array<{ el: Node; parent: Node | null }> = [];
  const visit = (node: Node, parent: Node | null): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c, parent);
      return;
    }
    if (typeof node.type !== 'string') return;
    const isJsx = node.type === 'JSXElement' || node.type === 'JSXFragment';
    if (node.type === 'JSXElement') out.push({ el: node, parent });
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k], isJsx ? node : parent);
    }
  };
  visit(program, null);
  return out;
}

/** The JSXAttribute `name` on an element's opening tag, or null. */
export function attrNode(el: Node, name: string): Node | null {
  for (const a of el?.openingElement?.attributes ?? [])
    if (a?.type === 'JSXAttribute' && a.name?.type === 'JSXIdentifier' && a.name.name === name)
      return a;
  return null;
}

const NOT_LITERAL = Symbol('not-literal');

/** A literal expression's value (numbers, strings, booleans, null, arrays and plain objects of
 *  them, unary minus). Anything else is NOT_LITERAL. */
function literalOf(n: Node): unknown {
  if (!n || typeof n !== 'object') return NOT_LITERAL;
  switch (n.type) {
    case 'Literal':
    case 'NumericLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return n.value;
    case 'NullLiteral':
      return null;
    case 'UnaryExpression': {
      if (n.operator !== '-') return NOT_LITERAL;
      const v = literalOf(n.argument);
      return typeof v === 'number' ? -v : NOT_LITERAL;
    }
    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const e of n.elements ?? []) {
        const v = literalOf(e);
        if (v === NOT_LITERAL) return NOT_LITERAL;
        out.push(v);
      }
      return out;
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const p of n.properties ?? []) {
        if (p.type !== 'Property' && p.type !== 'ObjectProperty') return NOT_LITERAL;
        if (p.computed) return NOT_LITERAL;
        const k = p.key?.type === 'Identifier' ? p.key.name : literalOf(p.key);
        if (typeof k !== 'string' && typeof k !== 'number') return NOT_LITERAL;
        const v = literalOf(p.value);
        if (v === NOT_LITERAL) return NOT_LITERAL;
        out[String(k)] = v;
      }
      return out;
    }
    default:
      return NOT_LITERAL;
  }
}

/** A prop's literal value: `undefined` when the prop is absent; refuses a non-literal value. */
export function literalProp(file: string, el: Node, name: string, id = ''): unknown {
  const a = attrNode(el, name);
  if (!a) return undefined;
  const v = a.value;
  if (v == null) return true; // a bare attribute
  const value =
    v.type === 'JSXExpressionContainer' ? literalOf(v.expression) : literalOf(v as Node);
  if (value === NOT_LITERAL)
    bad(file, `${tagOf(el)} ${name} is not a literal value; edit the JSX by hand.`, id);
  return value;
}

/** Set (`text` = the JSX value, `{…}` or `"…"`) or remove (`text` = null) one prop. */
export function setProp(s: MagicString, el: Node, name: string, text: string | null): void {
  const a = attrNode(el, name);
  if (text === null) {
    if (a) s.remove(a.start - 1, a.end); // with the space before it
    return;
  }
  if (a) s.overwrite(a.start, a.end, `${name}=${text}`);
  else {
    // a new prop goes after the last one, so a reader sees the tag grow at its end
    const attrs = el.openingElement.attributes ?? [];
    const after = attrs.length ? attrs[attrs.length - 1].end : el.openingElement.name.end;
    s.appendRight(after, ` ${name}=${text}`); // on what follows: survives removing that last prop
  }
}

/** `{<json>}` — the studio writes literal props with JSON.stringify (V2-1.10 §5.3 escaping rule). */
export const jsonProp = (v: unknown) => `{${JSON.stringify(v)}}`;

/** The text inside an element (between its opening and closing tags); '' when self-closing. */
export function innerText(source: string, el: Node): string {
  if (!el.closingElement) return '';
  return source.slice(el.openingElement.end, el.closingElement.start);
}

/** Add `name` to the `@maude/canvas-lib` import (or add the import after the last one). */
export function ensureCanvasLibImport(s: MagicString, program: Node, name: string): void {
  const imports = (program.body ?? []).filter((st: Node) => st.type === 'ImportDeclaration');
  const lib = imports.find((st: Node) => st.source?.value === '@maude/canvas-lib');
  if (lib) {
    const specs = (lib.specifiers ?? []).filter((sp: Node) => sp.type === 'ImportSpecifier');
    if (specs.some((sp: Node) => (sp.local?.name ?? sp.imported?.name) === name)) return;
    const last = specs[specs.length - 1];
    if (last) {
      s.appendLeft(last.end, `, ${name}`);
      return;
    }
  }
  const after = imports[imports.length - 1];
  const line = `import { ${name} } from '@maude/canvas-lib';\n`;
  if (after) s.appendLeft(after.end, `\n${line.trimEnd()}`);
  else s.prepend(line);
}

/** The edited source, gated: it parses and every TransitionSeries stays valid Remotion. */
export function finish(file: string, s: MagicString, id = ''): string {
  const out = s.toString();
  assertParses(file, out, id);
  assertCompSemantics(file, out);
  return out;
}

/** The leading whitespace of the line `at` sits on. */
export function indentAt(source: string, at: number): string {
  const lineStart = source.lastIndexOf('\n', at - 1) + 1;
  const m = /^[ \t]*/.exec(source.slice(lineStart, at));
  return m ? m[0] : '';
}

/** First JSXElement among `els` with one of `tags` inside [start, end). */
export function firstIn(
  els: ReadonlyArray<{ el: Node; parent: Node | null }>,
  start: number,
  end: number,
  tags: ReadonlySet<string>
): { el: Node; parent: Node | null } | null {
  for (const e of els) {
    if (e.el.start < start || e.el.end > end) continue;
    const t = tagOf(e.el);
    if (t && tags.has(t)) return e;
  }
  return null;
}

export const isFrac = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** `"W:H"` with positive integers (a reduced output aspect — `aspectKey` in video/derive.ts). */
export const ASPECT_RE = /^[1-9]\d{0,4}:[1-9]\d{0,4}$/;

/** The clip `stableId` names in the artboard's comp, checked against its fingerprint. */
export function resolveClip(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined
): { clip: ClipInfo; compName: string | null } {
  const cc = enumerateClips(file, source, artboard);
  const clip = cc.clips.find((c) => c.stableId === stableId);
  if (!clip) bad(file, 'That clip is not on the timeline.', stableId);
  const c = clip as ClipInfo;
  if (hash !== undefined && hash !== c.contentHash)
    bad(file, 'The clip changed since it was read; try again.', stableId);
  return { clip: c, compName: cc.compName };
}

/** Source span of the clip `stableId` names, or of a loose bed (`loose:<cdId | index>`, the id
 *  `video/derive.ts compClips` gives a media element outside every clip). */
export function resolveSpan(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined
): { start: number; end: number } {
  if (stableId.startsWith('loose:')) {
    const cc = enumerateClips(file, source, artboard);
    const key = stableId.slice('loose:'.length);
    const m = cc.media.find((x, i) => (x.cdId ?? String(i)) === key);
    if (!m) bad(file, 'That track is not on the timeline.', stableId);
    const media = m as NonNullable<typeof m>;
    if (hash !== undefined && hash !== media.contentHash)
      bad(file, 'The track changed since it was read; try again.', stableId);
    return { start: media.start, end: media.end };
  }
  const { clip } = resolveClip(file, source, artboard, stableId, hash);
  return { start: clip.start, end: clip.end };
}
