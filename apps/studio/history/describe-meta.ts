// `describeChanges` — the meta lane (V2-1.9 §5.5.1 step 7, S1.10).
//
// `<canvas>.meta.json`: `layout.artboards[]` by id → moved / resized; the top-level keys V2-1.12 §5.1 reserves
// (`present`, `artboardMeta`, `links`, `dsRev`/`dsPins`, `video`) → canvas or artboard level words.
// `last_modified`, `created` and every viewport key never count (the viewport lives in
// `_canvas-state/<slug>.view.json` since DDR-115; older files still carry one). A float that moved less than
// half a pixel is no move.
//
// A canvas-only session's words never name another canvas: this lane reads one canvas's meta and names only
// its own artboards. `links` (reserved, interactions between artboards and canvases) is therefore said by
// count — "2 links added" — never by target, so the cached words are the same for every viewer.

import {
  artboardLabel,
  type Change,
  type LaneContext,
  type LaneDescriber,
  type TsxModel,
} from './describe';
import { nameInWords, plural, quote, quotePair } from './describe-words';

type Json = unknown;
type Obj = Record<string, Json>;

const isObj = (v: Json): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);
const num = (v: Json): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Keys that are not content: stamps, the camera, the mirror lists the TSX lane already owns. */
const IGNORED = new Set([
  'last_modified',
  'created',
  'viewport',
  'layout',
  'artboards',
  'sections',
  'title',
  'subtitle',
  'brief',
  'present',
  'artboardMeta',
  'links',
  'dsRev',
  'dsPins',
  'video',
]);

function parse(text: string | null | undefined): Obj | null | 'broken' {
  if (!text?.trim()) return null;
  try {
    const v = JSON.parse(text);
    return isObj(v) ? v : 'broken';
  } catch {
    return 'broken';
  }
}

const meta = (
  artboards: string[],
  words: string,
  kind: Change['kind'] = 'meta',
  grade: Change['grade'] = 'W1',
  prop?: string
): Change => ({
  artboards,
  grade,
  kind,
  words,
  ...(prop ? { prop } : {}),
});

const NOTE_KEYS: Record<string, string> = {
  notes: 'Note',
  note: 'Note',
  poster: 'Cover',
  maxFrames: 'Frame limit',
  madeBy: 'Made by',
};

export function describeMeta(ctx: LaneContext): Change[] {
  if ((ctx.before.meta ?? null) === (ctx.after.meta ?? null)) return [];
  const b = parse(ctx.before.meta);
  const a = parse(ctx.after.meta);
  if (b === 'broken' || a === 'broken') return [meta([], 'Changed canvas settings', 'meta', 'F')];
  // a meta file that appears or goes away is the canvas coming or going: the TSX lane says that
  if (!b || !a) return [];

  const out: Change[] = [];
  const seen = new Set<string>();
  const push = (c: Change): void => {
    const k = `${c.artboards.join(',')}\u0001${c.words}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  };

  // ── artboard keys and labels (the models are only parsed when a line needs them) ──
  const families = (m: TsxModel | null): string[] =>
    m ? m.artboards.filter((x) => x.family).map((x) => x.key) : [];
  const keyFor = (id: string): string => {
    for (const m of [ctx.modelAfter, ctx.modelBefore]) {
      if (!m) continue;
      if (m.artboards.some((x) => x.key === id)) return id;
      for (const f of families(m)) {
        const re = new RegExp(
          `^${f
            .split('*')
            .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.+')}$`
        );
        if (re.test(id)) return f;
      }
    }
    return id;
  };
  const labelFor = (key: string, id = key): string => {
    for (const m of [ctx.modelAfter, ctx.modelBefore])
      if (m?.artboards.some((x) => x.key === key)) return artboardLabel(m, key);
    return nameInWords(id) || 'Artboard';
  };

  // ── layout.artboards[] ──
  const layoutOf = (o: Obj): Map<string, Obj> => {
    const m = new Map<string, Obj>();
    const l = isObj(o.layout) ? o.layout.artboards : undefined;
    if (Array.isArray(l))
      for (const e of l) if (isObj(e) && typeof e.id === 'string') m.set(e.id, e);
    return m;
  };
  const lb = layoutOf(b);
  const la = layoutOf(a);
  const moved = new Map<string, number>();
  const sizeOf = (e: Obj): [number, number] | null => {
    const w = num(e.w) ?? num(e.width);
    const h = num(e.h) ?? num(e.height);
    return w !== null && h !== null ? [w, h] : null;
  };
  for (const [id, ea] of la) {
    const eb = lb.get(id);
    if (!eb) continue;
    const key = keyFor(id);
    const dx = Math.abs((num(ea.x) ?? 0) - (num(eb.x) ?? 0));
    const dy = Math.abs((num(ea.y) ?? 0) - (num(eb.y) ?? 0));
    if (dx >= 0.5 || dy >= 0.5) moved.set(key, (moved.get(key) ?? 0) + 1);
    const sa = sizeOf(ea);
    const sb = sizeOf(eb);
    if (sa && sb && (Math.abs(sa[0] - sb[0]) >= 0.5 || Math.abs(sa[1] - sb[1]) >= 0.5))
      push(
        meta(
          [key],
          `${labelFor(key, id)}: size ${sb[0]} × ${sb[1]} → ${sa[0]} × ${sa[1]}`,
          'artboard-resized',
          'W1',
          'size'
        )
      );
  }
  for (const [key, n] of moved)
    push(
      meta(
        [key],
        n === 1
          ? `${labelFor(key)} moved on the canvas`
          : `${labelFor(key)}: ${n} artboards moved on the canvas`,
        'artboard-moved'
      )
    );

  // ── title and friends ──
  if (typeof a.title === 'string' && a.title !== b.title)
    push(meta([], `Canvas renamed to ${quote(a.title, 40)}`));
  if (
    typeof a.subtitle === 'string' &&
    typeof b.subtitle === 'string' &&
    a.subtitle !== b.subtitle
  ) {
    const [x, y] = quotePair(b.subtitle, a.subtitle);
    push(meta([], `Subtitle ${x} → ${y}`));
  }
  if (typeof a.brief === 'string' && typeof b.brief === 'string' && a.brief !== b.brief)
    push(meta([], 'Brief changed'));
  // the mirror list's notes (label and id belong to the TSX lane)
  const notes = (o: Obj): Map<string, string> => {
    const m = new Map<string, string>();
    if (Array.isArray(o.artboards))
      for (const e of o.artboards)
        if (isObj(e) && typeof e.id === 'string' && typeof e.note === 'string') m.set(e.id, e.note);
    return m;
  };
  const nb = notes(b);
  for (const [id, text] of notes(a)) {
    const old = nb.get(id);
    if (old === undefined || old === text) continue;
    const key = keyFor(id);
    const [x, y] = quotePair(old, text);
    push(meta([key], `${labelFor(key, id)}: Note ${x} → ${y}`, 'meta', 'W1', 'note'));
  }

  // ── present ──
  const presentOf = (o: Obj): { order: string[]; skip: string[] } => {
    const p = isObj(o.present) ? o.present : {};
    const strs = (v: Json): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return { order: strs(p.order), skip: strs(p.skip) };
  };
  const pb = presentOf(b);
  const pa = presentOf(a);
  if (!same(pb.order, pa.order)) push(meta([], 'Present order changed'));
  for (const id of pa.skip)
    if (!pb.skip.includes(id)) {
      const key = keyFor(id);
      push(meta([key], `${labelFor(key, id)} left out of Present`));
    }
  for (const id of pb.skip)
    if (!pa.skip.includes(id)) {
      const key = keyFor(id);
      push(meta([key], `${labelFor(key, id)} back in Present`));
    }

  // ── artboardMeta ──
  const amOf = (o: Obj): Obj => (isObj(o.artboardMeta) ? o.artboardMeta : {});
  const ab = amOf(b);
  const aa = amOf(a);
  for (const id of new Set([...Object.keys(ab), ...Object.keys(aa)])) {
    const eb = isObj(ab[id]) ? (ab[id] as Obj) : {};
    const ea = isObj(aa[id]) ? (aa[id] as Obj) : {};
    for (const k of new Set([...Object.keys(eb), ...Object.keys(ea)])) {
      if (same(eb[k], ea[k])) continue;
      const key = keyFor(id);
      const who = labelFor(key, id);
      const label = NOTE_KEYS[k] ?? nameInWords(k);
      const vb = eb[k];
      const va = ea[k];
      const scalar = (v: Json): v is string | number | boolean =>
        ['string', 'number', 'boolean'].includes(typeof v);
      const isNote = k === 'notes' || k === 'note';
      const plain = (v: string | number | boolean): string =>
        typeof v === 'string' ? quote(v, 40) : String(v);
      let rest: string;
      if (va !== undefined && vb !== undefined && scalar(va) && scalar(vb))
        rest =
          isNote && typeof va === 'string' && typeof vb === 'string'
            ? quotePair(vb, va).join(' → ')
            : `${plain(vb)} → ${plain(va)}`;
      else if (va !== undefined && scalar(va)) rest = `set to ${plain(va)}`;
      else if (va === undefined && scalar(vb)) rest = `removed (was ${plain(vb)})`;
      else {
        push(meta([key], `${who}: ${label} changed`, 'meta', 'W1', k));
        continue;
      }
      push(meta([key], `${who}: ${label} ${rest}`, 'meta', 'W1', k));
    }
  }

  // ── links: by count, never by target ──
  const count = (v: Json): number =>
    Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;
  if (!same(b.links, a.links)) {
    const nbLinks = count(b.links);
    const naLinks = count(a.links);
    if (naLinks > nbLinks) push(meta([], `${plural(naLinks - nbLinks, 'link', 'links')} added`));
    else if (naLinks < nbLinks)
      push(meta([], `${plural(nbLinks - naLinks, 'link', 'links')} removed`));
    else push(meta([], 'Links changed'));
  }

  if (!same(b.dsRev, a.dsRev)) push(meta([], 'Design system updated'));
  if (!same(b.dsPins, a.dsPins)) push(meta([], 'Design system pins changed'));
  if (!same(b.video, a.video)) push(meta([], 'Video timeline changed'));

  for (const k of new Set([...Object.keys(b), ...Object.keys(a)]))
    if (!IGNORED.has(k) && !same(b[k], a[k])) {
      push(meta([], 'Changed canvas settings', 'meta', 'W2'));
      break;
    }
  return out;
}

export const metaLane: LaneDescriber = describeMeta;
