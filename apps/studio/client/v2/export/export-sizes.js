// client/v2/export/export-sizes.js — S8.8: an artboard's own export sizes (09 Export › ex-inspector).
//
// "The inspector keeps this artboard's own export sizes — set once, one click from then on."
//
// The sizes live in the versioned canvas meta: `artboardMeta[id].exports` = `[{ format, scale? }]`
// (decision maude/v2-S8-artboard-export-presets-in-meta). Reading is `GET /_api/canvas-meta?file=` (every role
// that can read the canvas); writing is `PATCH /_api/present-meta { file, exports: { [id]: sizes|null } }`
// (Can edit and up; the server refuses a read-only session). An artboard with nothing stored shows its kind's
// default (08's buttons); the first change stores the whole list. Element presets are NOT stored (PNG 2× · SVG).
//
// Two halves, both without React: the words and the pure model (`defaultSizes`, `nextSize`, `specFor`), and a
// small store the section body and the section's "+" both read, so neither needs the other's state.

import { buildSpec } from './use-export-spec.js';

// ── the words (CONTRACT §3–§4; 09 Export ex-inspector) ───────────────────────────────────────────
export const SIZES_WORDS = Object.freeze({
  rowPreset: 'Presets',
  add: 'Add a size',
  remove: 'Remove this size',
  keepOne: 'An artboard keeps at least one size.',
  scale: 'Size',
  format: 'Format',
  copyPng: 'Copy as PNG',
  copyKeys: '⇧⌘C',
  more: 'Export… — every option',
  moreKeys: '⇧⌘E',
  saveFailed: 'Not saved — the sizes stay as they were.',
  readOnly: 'Your role can’t change the sizes.',
  needId: 'Give this object an id first (Advanced › Element id).',
});

export const exportWord = (n) => `Export ${n} ${n === 1 ? 'file' : 'files'}`;

export const SCALES = Object.freeze([0.5, 1, 2, 3, 4]);
export const FORMATS = Object.freeze([
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
  { value: 'svg', label: 'SVG' },
]);
export const MAX_SIZES = 8;

export const scaleWord = (s) => `${s}×`;

/** `PNG · 2×`, `SVG` — the chip a size is told as. */
export const sizeWords = (s) =>
  s.format === 'svg' ? 'SVG' : `${s.format.toUpperCase()} · ${scaleWord(s.scale)}`;

export const sameSize = (a, b) =>
  a.format === b.format && (a.format === 'svg' || a.scale === b.scale);

// ── what an artboard / an object offers before anything is stored ───────────────────────────────
/** Object presets: never stored (PNG 2× · SVG). */
export const OBJECT_SIZES = Object.freeze([
  Object.freeze({ format: 'png', scale: 2 }),
  Object.freeze({ format: 'svg' }),
]);

/**
 * The kind an artboard element wears: `data-dc-kind`, `digital` when it says nothing (08).
 * Print and video artboards carry their own formats (the sheet's print and video sections), so their
 * defaults are a word, not a size.
 */
export const artboardKindOf = (el) => el?.attrs?.['data-dc-kind'] || 'digital';
export const KIND_CHIP = Object.freeze({ print: 'Print PDF', video: 'MP4' });
export const KIND_FORMAT = Object.freeze({ print: 'pdf', video: 'mp4' });

/** Does this artboard have sizes the inspector can set? (digital and web: PNG/JPG/SVG at a scale.) */
export const hasSizes = (kind) => !(kind in KIND_CHIP);

export function defaultSizes(kind) {
  return hasSizes(kind) ? [{ format: 'png', scale: 1 }] : [];
}

/** The "+" adds the next size not already there: PNG 2×, 1×, 3×, 4×, JPG 1×, 2×, SVG. */
const ADD_ORDER = [
  { format: 'png', scale: 2 },
  { format: 'png', scale: 1 },
  { format: 'png', scale: 3 },
  { format: 'png', scale: 4 },
  { format: 'jpg', scale: 1 },
  { format: 'jpg', scale: 2 },
  { format: 'svg' },
];
export function nextSize(sizes) {
  return ADD_ORDER.find((c) => !sizes.some((s) => sameSize(s, c))) ?? null;
}

/** `sizes` with the `i`th replaced by `patch` ({ format } and/or { scale }); an svg carries no scale. */
export function changeSize(sizes, i, patch) {
  return sizes.map((s, j) => {
    if (j !== i) return s;
    const format = patch.format ?? s.format;
    if (format === 'svg') return { format };
    return { format, scale: patch.scale ?? s.scale ?? 1 };
  });
}

// ── the specs a size runs as ────────────────────────────────────────────────────────────────────
/**
 * One ExportSpecV2 per size. `target` is `{ artboardId }` or `{ elementIds }`; the world is the open canvas.
 * ctx: { canvasFile, designRel }.
 */
export function specsFor(sizes, target, ctx) {
  const c = {
    designRel: ctx.designRel,
    activePath: ctx.canvasFile,
    artboards: target.artboardId ? [target.artboardId] : [],
    elements: target.elementIds ?? [],
  };
  return sizes.map((s) =>
    buildSpec(
      {
        scope: 'selection',
        format: s.format,
        scale: s.format === 'svg' ? null : s.scale,
        annotations: false,
        region: null,
        at: null,
      },
      c
    )
  );
}

// ── the store: one entry per (canvas, artboard) ─────────────────────────────────────────────────
// entry = { sizes: Size[] | null (null = the kind's default), loaded: boolean, error: string | null }
const entries = new Map();
const subs = new Set();
let version = 0;
const keyOf = (file, id) => `${file}\u0000${id}`;
const EMPTY = Object.freeze({ sizes: null, loaded: false, error: null });
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

export const getEntry = (file, id) => entries.get(keyOf(file, id)) ?? EMPTY;
export const subscribeSizes = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
export const sizesVersion = () => version;
/** Tests only. */
export function forgetSizes() {
  entries.clear();
  notify();
}

const put = (file, id, patch) => {
  entries.set(keyOf(file, id), { ...getEntry(file, id), ...patch });
  notify();
};

/** Read what the canvas's meta says about this artboard (any role that can read the canvas). */
export async function loadSizes(file, id, fetchImpl = globalThis.fetch) {
  if (!file || !id) return;
  try {
    const r = await fetchImpl(`/_api/canvas-meta?file=${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(String(r.status));
    const meta = await r.json();
    const stored = meta?.artboardMeta?.[id]?.exports;
    put(file, id, {
      sizes: Array.isArray(stored) && stored.length ? stored : null,
      loaded: true,
      error: null,
    });
  } catch {
    // the default stays on screen; a later change still tries to save
    put(file, id, { loaded: true });
  }
}

/**
 * Store `sizes` (null = back to the kind's default). The new list shows at once; if the server refuses, the
 * old one comes back with one plain line. Resolves `{ ok }`.
 */
export async function saveSizes(file, id, sizes, fetchImpl = globalThis.fetch) {
  const before = getEntry(file, id);
  put(file, id, { sizes, error: null });
  try {
    const r = await fetchImpl('/_api/present-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, exports: { [id]: sizes } }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    const kept = body?.exports?.[id];
    put(file, id, { sizes: Array.isArray(kept) && kept.length ? kept : null, loaded: true });
    return { ok: true };
  } catch (e) {
    const refused = /403/.test(String(e?.message));
    put(file, id, {
      sizes: before.sizes,
      error: refused ? SIZES_WORDS.readOnly : SIZES_WORDS.saveFailed,
    });
    return { ok: false };
  }
}

/** The "+" in the section header and the row's "−" both go through here. */
export function addSize(file, id, shown, fetchImpl) {
  if (shown.length >= MAX_SIZES) return Promise.resolve({ ok: false });
  const next = nextSize(shown);
  if (!next) return Promise.resolve({ ok: false });
  return saveSizes(file, id, [...shown, next], fetchImpl);
}
export function removeSize(file, id, shown, i, fetchImpl) {
  if (shown.length <= 1) return Promise.resolve({ ok: false });
  return saveSizes(
    file,
    id,
    shown.filter((_, j) => j !== i),
    fetchImpl
  );
}
