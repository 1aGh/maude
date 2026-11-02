// edit-ops/duplicate-at-width.ts — S2.10 `artboard.duplicate` (⌘D, ⌥-drag, the artboard menu) and
// `artboard.duplicate-at-width` (the menu's "Duplicate at another width ▸"). Both wrap
// `applyDuplicateArtboard` (canvas-edit.ts): the copy is spliced right after its source, carries a fresh
// artboard id, a fresh label ("Desktop" → "Desktop 2", "Příběh" → "Příběh 2") and NO element id or lock
// (V2-1.4 §5.2) — the same bytes the v1 `/_api/duplicate-artboard` writes, plus those three rules.
//
//   params { items: [{ artboard, at?: { x, y }, width? }], pin?: [{ id, x, y }] }
//
//   items[].at     where the copy lands (world px, the layout lane). The canvas computes the gap rhythm
//                  (editing/duplicate-rhythm.ts); an absent `at` leaves the copy on the default grid.
//   items[].width  `duplicate-at-width` only: 64 … 8192 (the range `/_api/resize-artboard` takes).
//   pin            artboards that have no layout entry yet, at the position they are drawn at: splicing a
//                  copy shifts every later default-grid slot, so the canvas pins them in the same request.
//
// One request = one TSX write + one layout write (the layout lane first: an entry for a copy that was never
// written is inert). `created` names each copy as `{ artboard: <new id>, element: <new id> }` — an artboard
// is its own element ref. Annotations are NOT copied with an artboard (S2-S4-artboard-motion-ids §2/§5.1).
//
// Same result by hand: `canvas-tsx.md` § "Duplicate an artboard". Registry actions: `artboard.duplicate`,
// `artboard.duplicate-at-width`.

import { applyDuplicateArtboard, CanvasEditError } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import { ARTBOARD_ID_RE, MAX_ARTBOARD, MIN_ARTBOARD } from './artboard-resize.ts';
import { isCoord, MAX_LAYOUT_ENTRIES } from './layout-patch.ts';
import type { EditOp, EditOpOutput, ElementRef, LayoutPatch, ResolvedEditOp } from './types.ts';

/** Artboards one request may copy (a marquee of a whole canvas is fine; a runaway body is not). */
export const MAX_COPIES = 50;
const LABEL_MAX = 80;

// ── names ────────────────────────────────────────────────────────────────────────────────────

/** "Desktop" → "Desktop 2", "Desktop 2" → "Desktop 3" (the first number not taken). Accents are kept. */
export function copyName(label: string, taken: ReadonlySet<string>): string {
  const base = label.replace(/\s+\d+$/, '').trim() || label.trim() || 'Artboard';
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${base.slice(0, LABEL_MAX - suffix.length)}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

/** "desktop" → "desktop-2", "desktop-390" → "desktop-2" (the first number not taken); ≤ 64 characters. */
export function copyId(id: string, taken: ReadonlySet<string>): string {
  const base = id.replace(/-\d+$/, '') || id;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const name = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

const unescapeAttr = (v: string): string =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Every `<DCArtboard label="…">` in `source`, by artboard id → label (quote-aware, no parser). */
export function artboardLabels(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const open = /<DCArtboard\b/g;
  for (let m = open.exec(source); m; m = open.exec(source)) {
    const attrs = openingTagAttrs(source, m.index + m[0].length);
    if (attrs === null) continue;
    // the string props only: `id="…"`/`label="…"` at brace depth 0 (a `label` inside `print={{…}}` is not it)
    const top = stripBraces(attrs);
    const id = /\bid=(?:"([^"]*)"|'([^']*)')/.exec(top);
    const label = /\blabel=(?:"([^"]*)"|'([^']*)')/.exec(top);
    const key = id?.[1] ?? id?.[2];
    if (key !== undefined) out.set(key, unescapeAttr(label?.[1] ?? label?.[2] ?? key));
  }
  return out;
}

/** The attribute text of an opening tag from `from` up to its closing `>`: string- and brace-aware (a
 *  `>` inside a quote or a `{…}` expression, however nested, does not end the tag). Null when unclosed. */
export function openingTagAttrs(source: string, from: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const c = source[i] as string;
    if (quote) {
      if (c === '\\' && depth > 0) i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || (c === '`' && depth > 0)) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return source.slice(from, i);
    else if (c === '<' && depth === 0) return null; // a malformed tag runs into the next one
  }
  return null;
}

/** `attrs` with every `{…}` expression (nested) blanked, string props kept. */
export function stripBraces(attrs: string): string {
  let out = '';
  let depth = 0;
  let quote: string | null = null;
  for (const c of attrs) {
    if (quote) {
      if (depth === 0) out += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || (c === '`' && depth > 0)) {
      quote = c;
      if (depth === 0) out += c;
    } else if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out;
}

// ── params ───────────────────────────────────────────────────────────────────────────────────

interface Item {
  artboard: string;
  at: { x: number; y: number } | null;
  width: number | null;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function bad(file: string, msg: string): never {
  throw new CanvasEditError(msg, { canvas: file, id: '' });
}

function parseItems(params: Record<string, unknown>, file: string, withWidth: boolean): Item[] {
  const raw = params.items;
  if (!Array.isArray(raw) || raw.length === 0) bad(file, 'Nothing to duplicate.');
  if (raw.length > MAX_COPIES) bad(file, 'That is too many artboards to copy at once.');
  return raw.map((r) => {
    if (!isRec(r) || typeof r.artboard !== 'string' || !ARTBOARD_ID_RE.test(r.artboard))
      return bad(file, 'That artboard is not on this canvas.');
    let at: Item['at'] = null;
    if (r.at !== undefined && r.at !== null) {
      if (!isRec(r.at) || !isCoord(r.at.x) || !isCoord(r.at.y))
        return bad(file, 'That position is not on the canvas.');
      at = { x: Math.round(r.at.x), y: Math.round(r.at.y) };
    }
    let width: number | null = null;
    if (withWidth) {
      const w = Number(r.width);
      if (!Number.isFinite(w)) return bad(file, 'The width is not a number.');
      width = Math.max(MIN_ARTBOARD, Math.min(MAX_ARTBOARD, Math.round(w)));
    }
    return { artboard: r.artboard, at, width };
  });
}

function parsePin(params: Record<string, unknown>, file: string): NonNullable<LayoutPatch['pin']> {
  const raw = params.pin;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_LAYOUT_ENTRIES)
    return bad(file, 'That layout is too large.');
  return raw.map((r) => {
    if (
      !isRec(r) ||
      typeof r.id !== 'string' ||
      !ARTBOARD_ID_RE.test(r.id) ||
      !isCoord(r.x) ||
      !isCoord(r.y)
    )
      return bad(file, 'That layout is not readable.');
    return { id: r.id, x: Math.round(r.x), y: Math.round(r.y) };
  });
}

// ── the writers ──────────────────────────────────────────────────────────────────────────────

function duplicate(
  source: string,
  file: string,
  params: Record<string, unknown>,
  withWidth: boolean
): EditOpOutput {
  const items = parseItems(params, file, withWidth);
  const pin = parsePin(params, file);
  let out = source;
  const created: ElementRef[] = [];
  const set: NonNullable<LayoutPatch['set']> = [];
  for (const it of items) {
    const walk = walkIdElements(out, file);
    if (!walk.ok) return bad(file, 'This canvas does not parse; fix it before editing.');
    const ids = new Set(
      walk.elements
        .filter((e) => e.tag === 'DCArtboard' && e.artboard)
        .map((e) => e.artboard as string)
    );
    if (!ids.has(it.artboard)) return bad(file, 'That artboard is not on this canvas.');
    const labels = artboardLabels(out);
    const names =
      it.width === null
        ? {
            id: copyId(it.artboard, ids),
            label: copyName(labels.get(it.artboard) ?? it.artboard, new Set(labels.values())),
          }
        : undefined;
    const next = applyDuplicateArtboard(file, out, it.artboard, it.width, names);
    out = next.source;
    created.push({ artboard: next.artboardId, element: next.artboardId });
    if (it.at) set.push({ id: next.artboardId, x: it.at.x, y: it.at.y });
  }
  return {
    source: out,
    created,
    layout: { ...(set.length ? { set } : {}), ...(pin.length ? { pin } : {}) },
    // S2.10b — on an op-log home the copy and its place are ONE action (one ⌘Z)
    action: {
      kind: 'edit',
      label: items.length === 1 ? DUPLICATE_LABEL : `Duplicate ${items.length} artboards`,
    },
  };
}

/** The history row of a copy (the canvas's legacy undo record says the same). */
export const DUPLICATE_LABEL = 'Duplicate artboard';

/** S2.10b — the boards a copy is made of: an AI run holding one refuses the copy. */
const sourcesOf = (req: ResolvedEditOp): string[] =>
  Array.isArray(req.params.items)
    ? req.params.items.flatMap((r) =>
        isRec(r) && typeof r.artboard === 'string' ? [r.artboard] : []
      )
    : [];

export const artboardDuplicate: EditOp = {
  id: 'artboard.duplicate',
  artboards: sourcesOf,
  apply: (source, req) => duplicate(source, req.file, req.params, false),
};

export const artboardDuplicateAtWidth: EditOp = {
  id: 'artboard.duplicate-at-width',
  artboards: sourcesOf,
  apply: (source, req) => duplicate(source, req.file, req.params, true),
};
