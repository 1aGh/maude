// edit-ops/clip/formats.ts — `video.format.add` and `video.format.unlink` (S7.6c; S7-slices Q4, 07
// ve-formats "Three formats, one edit").
//
// A link between formats is DERIVED, never stored (decision maude/v2-S7-linked-formats-derived):
// video artboards whose `<VideoComp component={X}>` name the same comp share one cut.
//   - add: copies the artboard right after itself with a new id and size, mounting the SAME comp —
//     a linked format. A second artboard of an aspect the cut already has is refused: per-format
//     data (`<Reframe formats>`, `<Place formats>`) is keyed by the reduced W:H, so two linked
//     artboards of one aspect could never be framed apart.
//   - unlink: "Make an unlinked copy" — forks the comp declaration under a new name next to the
//     original and points this artboard at it, so from now on it has its own cut.
// Neither touches `.meta.json` (no new versioned key; the new artboard's position is the layout's
// default until someone moves it). Pure: no IO.

import MagicString from 'magic-string';
import { collectConsts, resolveNum } from '../../ripple.ts';
import { aspectKey } from '../../video/derive.ts';
import { compDeclaration, type VideoArtboard, videoArtboard, videoArtboards } from './comp.ts';
import { attrNode, bad, finish, type Node, parseProgram, setProp } from './jsx.ts';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const IDENT_RE = /^[A-Z][A-Za-z0-9_]{0,63}$/;
export const MIN_SIDE = 16;
export const MAX_SIDE = 8192;

/** A numeric prop that is a literal or a top-level numeric const, else null. */
export function sizeOf(source: string, el: Node, name: string): number | null {
  const a = attrNode(el, name);
  const v = a?.value;
  if (!v) return null;
  const text =
    v.type === 'JSXExpressionContainer' ? source.slice(v.expression.start, v.expression.end) : null;
  if (text === null) return typeof v.value === 'string' ? Number(v.value) || null : null;
  return resolveNum(text, collectConsts(source));
}

export function aspectOf(source: string, a: VideoArtboard): string | null {
  const w = sizeOf(source, a.artboard, 'width') ?? sizeOf(source, a.videoComp, 'width');
  const h = sizeOf(source, a.artboard, 'height') ?? sizeOf(source, a.videoComp, 'height');
  return w && h ? aspectKey(w, h) : null;
}

function side(file: string, v: unknown, what: string): number {
  if (!Number.isInteger(v) || (v as number) < MIN_SIDE || (v as number) > MAX_SIDE)
    bad(file, `The ${what} is ${MIN_SIDE} to ${MAX_SIDE} px.`);
  return v as number;
}

export function applyFormatAdd(
  file: string,
  source: string,
  artboard: string | undefined,
  p: Record<string, unknown>
): { source: string; artboard: string; aspect: string } {
  const width = side(file, p.width, 'width');
  const height = side(file, p.height, 'height');
  const program = parseProgram(file, source);
  const all = videoArtboards(file, program);
  const from = videoArtboard(file, program, artboard);
  if (!from.comp)
    bad(file, 'This video’s composition is not named; edit the JSX by hand.', from.id);
  const aspect = aspectKey(width, height);
  const linked = all.filter((a) => a.comp === from.comp);
  if (linked.some((a) => aspectOf(source, a) === aspect))
    bad(file, `This video already has a ${aspect} format.`, from.id);

  const taken = new Set(
    (source.match(/\bid=(?:"([^"]*)"|'([^']*)')/g) ?? []).map((m) =>
      m.replace(/^id=["']|["']$/g, '')
    )
  );
  let id: string;
  if (p.id !== undefined) {
    if (typeof p.id !== 'string' || !ID_RE.test(p.id))
      bad(file, 'The new artboard’s id is not readable.');
    if (taken.has(p.id as string)) bad(file, `An artboard “${p.id}” is already here.`);
    id = p.id as string;
  } else {
    const base = `${from.id}-${aspect.replace(':', 'x')}`;
    id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  }

  // The copy, edited in its own MagicString over the artboard's text.
  const off = from.artboard.start;
  const text = source.slice(off, from.artboard.end);
  const c = new MagicString(text);
  const shift = (el: Node): Node => ({
    ...el,
    openingElement: {
      ...el.openingElement,
      name: { ...el.openingElement.name, end: el.openingElement.name.end - off },
      attributes: el.openingElement.attributes.map((a: Node) => ({
        ...a,
        start: a.start - off,
        end: a.end - off,
      })),
    },
  });
  const ab = shift(from.artboard);
  const vc = shift(from.videoComp);
  setProp(c, ab, 'id', `"${id}"`);
  setProp(c, ab, 'width', `{${width}}`);
  setProp(c, ab, 'height', `{${height}}`);
  const lv = attrNode(from.artboard, 'label')?.value;
  const label = lv?.type === 'Literal' || lv?.type === 'StringLiteral' ? lv.value : null;
  if (typeof label === 'string') {
    const next = `${label.replace(/ · \d+:\d+$/, '')} · ${aspect}`;
    setProp(c, ab, 'label', /["\\{}]/.test(next) ? `{${JSON.stringify(next)}}` : `"${next}"`);
  }
  setProp(c, vc, 'width', `{${width}}`);
  setProp(c, vc, 'height', `{${height}}`);

  const lineStart = source.lastIndexOf('\n', off - 1) + 1;
  const indent = /^[ \t]*/.exec(source.slice(lineStart, off))?.[0] ?? '';
  const s = new MagicString(source);
  s.appendLeft(from.artboard.end, `\n${indent}${c.toString()}`);
  return { source: finish(file, s, from.id), artboard: id, aspect };
}

export function applyFormatUnlink(
  file: string,
  source: string,
  artboard: string | undefined,
  p: Record<string, unknown>
): { source: string; comp: string } {
  const program = parseProgram(file, source);
  const all = videoArtboards(file, program);
  const target = videoArtboard(file, program, artboard);
  if (!target.comp)
    bad(file, 'This video’s composition is not named; edit the JSX by hand.', target.id);
  if (!all.some((a) => a.id !== target.id && a.comp === target.comp))
    bad(file, 'This format already has its own cut.', target.id);
  const decl = compDeclaration(program, target.comp as string);
  if (!decl) bad(file, 'This video’s composition is not in the canvas file.', target.id);
  const d = decl as NonNullable<typeof decl>;
  if (d.decl.type === 'VariableDeclaration' && d.decl.declarations.length !== 1)
    bad(file, 'The composition shares its declaration; edit the JSX by hand.', target.id);

  const used = new Set(source.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []);
  let name: string;
  if (p.name !== undefined) {
    if (typeof p.name !== 'string' || !IDENT_RE.test(p.name))
      bad(file, 'The copy’s name is not a component name.', target.id);
    if (used.has(p.name as string))
      bad(file, `“${p.name}” is already used in this canvas.`, target.id);
    name = p.name as string;
  } else {
    const base = `${target.comp}Unlinked`;
    name = base;
    for (let n = 2; used.has(name); n++) name = `${base}${n}`;
  }

  // The copy is the declaration alone (an `export` stays on the original), renamed.
  const text = source.slice(d.decl.start, d.decl.end);
  const copy =
    text.slice(0, d.id.start - d.decl.start) + name + text.slice(d.id.end - d.decl.start);
  const s = new MagicString(source);
  s.appendLeft(d.statement.end, `\n\n${copy}`);
  const cv = attrNode(target.videoComp, 'component');
  s.overwrite(cv.start, cv.end, `component={${name}}`);
  return { source: finish(file, s, target.id), comp: name };
}
