// `describeChanges` — the annotations lane (V2-1.9 §5.5.1 step 8, S1.10).
//
// `<canvas>.annotations.json` (the DDR-242 board): by element id — "Sticky added", "Sticky: “old…” → “new…”",
// "Arrow moved" — parented to `parentArtboard` (V2-1.12) when set. Several elements of one kind that did the
// same thing at once are one line with the real noun ("3 stickies moved"). Z-order (`index`), authorship,
// groups and the lock-free housekeeping fields never count. The file belongs to one canvas, so the lane can
// only ever name that canvas's own parts.

import { parseBoard } from '../annotations/schema';
import type { AnnotationElement } from '../annotations/types';
import type { Change, LaneContext, LaneDescriber, TsxModel } from './describe';
import { nameInWords, quote, quotePair, valuePair, valueText } from './describe-words';

interface TypeWords {
  one: string;
  many: string;
}

const TYPES: Record<string, TypeWords> = {
  sticky: { one: 'Sticky', many: 'stickies' },
  text: { one: 'Text box', many: 'text boxes' },
  shape: { one: 'Shape', many: 'shapes' },
  arrow: { one: 'Arrow', many: 'arrows' },
  pen: { one: 'Drawing', many: 'drawings' },
  image: { one: 'Picture', many: 'pictures' },
  link: { one: 'Link', many: 'links' },
  mediaref: { one: 'Media item', many: 'media items' },
  section: { one: 'Section', many: 'sections' },
  stamp: { one: 'Stamp', many: 'stamps' },
  vote: { one: 'Vote', many: 'votes' },
};

/** Housekeeping: never a visible change of the element. */
const QUIET = new Set(['index', 'groups', 'author', 'source', 'timeRange', 'id', 'type', 'parent']);
const GEOMETRY = new Set([
  'x',
  'y',
  'start',
  'end',
  'points',
  'parentArtboard',
  'startAnchor',
  'endAnchor',
]);
const SIZE = new Set(['w', 'h']);
const TEXT_SLOT: Record<string, string> = {
  sticky: 'text',
  text: 'text',
  shape: 'label',
  section: 'label',
};

const typeOf = (t: string): TypeWords =>
  TYPES[t] ?? { one: nameInWords(t), many: `${nameInWords(t).toLowerCase()}s` };
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function boardOf(text: string | null | undefined): AnnotationElement[] | null | 'broken' {
  if (!text?.trim()) return null;
  const r = parseBoard(text);
  if (
    !r.elements.length &&
    r.dropped.some((d) =>
      /not a board document|unknown board format|newer than this client|byte cap/.test(d.reason)
    )
  )
    return 'broken';
  return r.elements;
}

const line = (artboards: string[], words: string): Change => ({
  artboards,
  grade: 'W1',
  kind: 'annotation',
  words,
});

export function describeAnnotations(ctx: LaneContext): Change[] {
  if ((ctx.before.annotations ?? null) === (ctx.after.annotations ?? null)) return [];
  const b = boardOf(ctx.before.annotations);
  const a = boardOf(ctx.after.annotations);
  if (b === 'broken' || a === 'broken')
    return [{ artboards: [], grade: 'F', kind: 'annotation', words: 'Changed the whiteboard' }];
  const eb = new Map((b ?? []).map((e) => [e.id, e]));
  const ea = new Map((a ?? []).map((e) => [e.id, e]));

  const keyFor = (id: string | undefined): string[] => {
    if (!id) return [];
    for (const m of [ctx.modelAfter, ctx.modelBefore] as Array<TsxModel | null>) {
      if (!m) continue;
      if (m.artboards.some((x) => x.key === id)) return [id];
      for (const f of m.artboards)
        if (f.family) {
          const re = new RegExp(
            `^${f.key
              .split('*')
              .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .join('.+')}$`
          );
          if (re.test(id)) return [f.key];
        }
    }
    return [id];
  };
  const abOf = (e: AnnotationElement): string[] =>
    typeof e.parentArtboard === 'string' ? keyFor(e.parentArtboard) : [];

  const groups = new Map<string, { type: string; verb: string; artboards: string[]; n: number }>();
  const out: Change[] = [];
  const count = (type: string, verb: string, artboards: string[]): void => {
    const k = `${type}\u0001${verb}\u0001${artboards.join(',')}`;
    const g = groups.get(k);
    if (g) g.n++;
    else {
      const ng = { type, verb, artboards, n: 1 };
      groups.set(k, ng);
      out.push({ artboards, grade: 'W1', kind: 'annotation', words: '\u0000', prop: k });
    }
  };

  for (const [id, e] of ea) if (!eb.has(id) && e.type !== 'ballot') count(e.type, 'added', abOf(e));
  for (const [id, e] of eb)
    if (!ea.has(id) && e.type !== 'ballot') count(e.type, 'removed', abOf(e));

  for (const [id, n] of ea) {
    const o = eb.get(id);
    if (!o || n.type === 'ballot') continue;
    const artboards = abOf(n);
    const t = typeOf(n.type);
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter(
      (k) => !QUIET.has(k) && !same(o[k], n[k])
    );
    if (!keys.length) continue;
    const slot = TEXT_SLOT[n.type];
    let geometry = false;
    let size = false;
    for (const k of keys) {
      if (k === 'resolved') {
        count(n.type, n[k] ? 'resolved' : 'reopened', artboards);
      } else if (k === 'locked') {
        count(n.type, n[k] ? 'locked' : 'unlocked', artboards);
      } else if (k === slot && typeof o[k] === 'string' && typeof n[k] === 'string') {
        const [x, y] = quotePair(o[k] as string, n[k] as string);
        out.push(line(artboards, `${t.one}: ${x} → ${y}`));
      } else if (k === slot) {
        const was = o[k];
        const now = n[k];
        if (typeof now === 'string' && now)
          out.push(line(artboards, `${t.one}: Text set to ${quote(now, 40)}`));
        else if (typeof was === 'string' && was)
          out.push(line(artboards, `${t.one}: Text removed (was ${quote(was, 40)})`));
      } else if (GEOMETRY.has(k)) geometry = true;
      else if (SIZE.has(k)) size = true;
      else if (k === 'rot') count(n.type, 'rotated', artboards);
      else {
        const label = k === 'fill' ? 'Fill' : nameInWords(k);
        const va = o[k];
        const vb = n[k];
        const scalar = (v: unknown): v is string | number | boolean =>
          ['string', 'number', 'boolean'].includes(typeof v);
        if (scalar(va) && scalar(vb))
          out.push(
            line(
              artboards,
              `${t.one}: ${label} ${valuePair(k, { lit: true, v: String(va) }, { lit: true, v: String(vb) }, ctx.opts).text}`
            )
          );
        else if (scalar(vb) && va === undefined)
          out.push(
            line(
              artboards,
              `${t.one}: ${label} set to ${valueText(k, { lit: true, v: String(vb) }, ctx.opts)}`
            )
          );
        else out.push(line(artboards, `${t.one}: ${label} changed`));
      }
    }
    if (geometry) count(n.type, 'moved', artboards);
    if (size) count(n.type, 'resized', artboards);
  }

  // settle the counted groups into words
  const seen = new Set<string>();
  const result: Change[] = [];
  for (const c of out) {
    if (c.words === '\u0000') {
      const g = groups.get(c.prop as string) as {
        type: string;
        verb: string;
        artboards: string[];
        n: number;
      };
      const t = typeOf(g.type);
      const words = g.n === 1 ? `${t.one} ${g.verb}` : `${g.n} ${t.many} ${g.verb}`;
      result.push({ artboards: c.artboards, grade: 'W1', kind: 'annotation', words });
    } else result.push(c);
  }
  return result.filter((c) => {
    const k = `${c.artboards.join(',')}\u0001${c.words}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const annotationsLane: LaneDescriber = describeAnnotations;
