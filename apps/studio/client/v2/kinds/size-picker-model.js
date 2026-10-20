// client/v2/kinds/size-picker-model.js — S7.20: the F size picker's rules, pure (so a test drives every one
// without a browser). The panel (SizePicker.jsx) only draws what these return.
//
//   viewGroups(data, open, query)   what to draw: Recent chips, the groups with their up-front or all tiles, or — with
//                                   a query — one flat list of matches ("A5", "story", "1920")
//   flatTiles(view)                 every tile in reading order (what ↑ ↓ walk)
//   ghostMessage(tile)              the `size-ghost` the shell sends a canvas for a hovered tile (null clears it)
//   placeMessage(tile | custom)     the `run-action artboard.insert-preset` the canvas answers with ONE edit-op
//   tileShape(tile)                 the tile's little picture: closed box = fixed size, open = grows, play = timeline
//   custom fields                   mm text → numbers, Portrait / Landscape swap, the line under the fields
//
// The data is `GET /_api/kinds/presets` (routes/kinds.ts); the search is the catalogue's own (`searchPresets`), so
// the words a person types find exactly what the server and the agent path know.

import { runActionMessage } from '../../actions/shell-key-handlers.js';
import { CUSTOM_PRINT_ID, searchPresets } from '../../../kinds/presets.ts';
import { nearestLargerPreset } from '../../../kinds/print-custom.ts';
import { getPaperPreset } from '../../../print/units.ts';

export const SEARCH_PLACEHOLDER = 'Search sizes — “A5”, “story”, “1920”';
export const FOOT_LINE = 'Or press F and drag to draw any size.';
export const NOTHING_LINE = (q) =>
  `No size matches “${q.trim()}”. Press F and drag to draw any size.`;
export const CUSTOM_TITLE = 'Custom print size';

/**
 * @param data the `GET /_api/kinds/presets` body: `{ groups, custom, recent, kinds }`
 * @param open the group id whose "All N" is open, or null
 * @param query the search text
 * @returns `{ search: tile[] | null, recent: tile[], groups: [{ id, title, icon, badge, kind, tiles, more, open, custom }] }`
 */
export function viewGroups(data, open, query) {
  const groups = data?.groups ?? [];
  const q = String(query ?? '').trim();
  if (q) {
    const byId = new Map(
      groups.flatMap((g) => g.presets.map((p) => [p.id, { ...p, group: g.id }]))
    );
    const search = searchPresets(q)
      .map((p) => byId.get(p.id))
      .filter(Boolean);
    return { search, recent: [], groups: [] };
  }
  return {
    search: null,
    recent: data?.recent ?? [],
    groups: groups.map((g) => {
      const tops = g.presets.filter((p) => p.top);
      const expanded = open === g.id;
      const tiles = (expanded ? g.presets : tops).map((p) => ({ ...p, group: g.id }));
      return {
        id: g.id,
        title: g.title,
        icon: g.icon,
        badge: g.badge,
        kind: g.kind,
        tiles,
        // "All 7" only where there is more than the up-front three; "Fewer" once it is open
        more: g.presets.length > tops.length ? g.presets.length : 0,
        open: expanded,
        // the Custom size… tile closes the Print group's open list
        custom: g.id === 'print' && expanded ? data?.custom : null,
      };
    }),
  };
}

/** Every tile in reading order — Recent chips excluded (they are chips, not tiles). Custom last in its group. */
export function flatTiles(view) {
  if (view.search) return view.search;
  return view.groups.flatMap((g) => (g.custom ? [...g.tiles, g.custom] : g.tiles));
}

/** The `size-ghost` for a hovered tile; `null` clears the outline (the pointer left, or the tile is Custom size…). */
export function ghostMessage(tile) {
  if (!tile || tile.id === CUSTOM_PRINT_ID) return { dgn: 'size-ghost', preset: null };
  return {
    dgn: 'size-ghost',
    preset: {
      id: tile.id,
      label: tile.label ?? tile.name,
      sizeText: String(tile.sizeText ?? ''),
      w: tile.widthPx,
      h: tile.heightPx,
    },
  };
}

/** The ask a click sends the canvas: ONE `artboard.insert-preset` (it picks the place, writes, selects). */
export function placeMessage(tile, custom) {
  if (tile.id === CUSTOM_PRINT_ID)
    return runActionMessage('artboard.insert-preset', { presetId: CUSTOM_PRINT_ID, custom });
  return runActionMessage('artboard.insert-preset', { presetId: tile.id });
}

/**
 * The tile's picture in a 64 × 34 box. `grows` draws the open box that fades (a web page); `fixed` and `plain`
 * are closed boxes; `play` marks a video; `bleed` a dashed inner line (print).
 */
export function tileShape(tile, kind) {
  const MW = 64;
  const MH = 34;
  const w0 = tile.widthPx;
  const h0 = tile.heightPx;
  let w;
  let h;
  if (kind === 'web') {
    w = Math.max(10, Math.round((w0 / 1440) * MW));
    h = 26;
  } else {
    const r = w0 / h0;
    if (r >= MW / MH) {
      w = MW;
      h = Math.max(8, Math.round(MW / r));
    } else {
      h = MH;
      w = Math.max(8, Math.round(MH * r));
    }
  }
  return { w, h, grows: kind === 'web', play: kind === 'video', bleed: kind === 'print' };
}

/** The badge's tone: web "grows", digital is "fixed", the rest plain (08 `ak-badge`). */
export const badgeTone = (kind) =>
  kind === 'web' ? 'grow' : kind === 'digital' ? 'fixed' : 'plain';

// ── Custom size… ─────────────────────────────────────────────────────────────────────────────

export const CUSTOM_DEFAULTS = Object.freeze({
  width: '99',
  height: '210',
  bleed: '3',
  margin: '5',
});

/** "99", "99,5", " 210 mm " → a number, or null when it is not one. */
export function parseMm(text) {
  const t = String(text ?? '')
    .trim()
    .replace(/mm$/i, '')
    .trim()
    .replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Portrait = taller than wide. */
export const orientationOf = (f) => {
  const w = parseMm(f.width);
  const h = parseMm(f.height);
  return w !== null && h !== null && w > h ? 'Landscape' : 'Portrait';
};

/** Choosing the other orientation swaps the two sides (a typed 99 × 210 becomes 210 × 99). */
export function withOrientation(f, orientation) {
  if (orientationOf(f) === orientation) return f;
  return { ...f, width: f.height, height: f.width };
}

/** The numbers an Add artboard click sends, or the one line that says why not. */
export function customInput(f) {
  const widthMm = parseMm(f.width);
  const heightMm = parseMm(f.height);
  const bleedMm = parseMm(f.bleed);
  const marginMm = parseMm(f.margin);
  if (widthMm === null || heightMm === null)
    return { ok: false, line: 'Give the width and height in millimetres.' };
  if (bleedMm === null || marginMm === null)
    return { ok: false, line: 'Bleed and safe margin are millimetres too.' };
  return { ok: true, value: { widthMm, heightMm, bleedMm, marginMm } };
}

/** The quiet line under the fields: which paper it is, and what the bleed is for. */
export function customNote(f) {
  const w = parseMm(f.width);
  const h = parseMm(f.height);
  const b = parseMm(f.bleed);
  const bleed = b === null ? 'the bleed' : `${b} mm`;
  const tail = `The artboard is drawn ${bleed} larger on every side so colour can run past the cut.`;
  if (w === null || h === null) return tail;
  const near = nearestLargerPreset(w, h);
  const paper = getPaperPreset(near.paper);
  const exact =
    paper &&
    paper.unit === 'mm' &&
    ((paper.width === w && paper.height === h) || (paper.width === h && paper.height === w));
  return exact ? `${paper.label} size. ${tail}` : tail;
}
