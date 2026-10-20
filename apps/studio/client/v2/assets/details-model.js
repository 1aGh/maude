// client/v2/assets/details-model.js — the words of an asset's details (S8.21; 12 · ia-asset-details, ia-advanced). Pure.
//
// The server (`GET /_api/asset-details`, asset-details.ts) says what is true; this file says it in words. Nothing here
// decides what a person may see — the Original path simply is not in the answer for anyone who may not hear it.
//
// Words (CONTRACT §3–§4): "Made by AI" once and plainly; a count is a number with a noun that reads for 1 and many; times are
// relative first, then "6 Oct, 14:05"; mono lives only under Advanced.

import { displayName } from '../../shell/util.js';
import { commentTime } from '../comments/comments-model.js';

const KB = 1024;
const MB = KB * KB;

/** "4 KB" · "2.3 MB" — a size a person can read. */
export function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n >= MB) return `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / KB))} KB`;
}

/** 7 → "0:07" · 75 → "1:15" · 3725 → "1:02:05" */
export function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/**
 * Which sheet the asset gets. Made by AI wins over its kind: a generated picture, clip or sound says what it was made from.
 * @returns {'made' | 'footage' | 'sound' | 'clip' | 'photo'}
 */
export function detailsKind(d) {
  if (!d) return 'photo';
  if (d.madeByAi) return 'made';
  if (d.kind === 'audio') return 'sound';
  if (d.kind === 'video') return d.footage ? 'footage' : 'clip';
  return 'photo';
}

const KIND_NOUN = {
  photo: 'Photo',
  made: 'Made by AI',
  footage: 'Clip',
  clip: 'Clip',
  sound: 'Sound',
};
export const kindNoun = (d) => KIND_NOUN[detailsKind(d)] ?? 'File';

/** `media` — what the browser measured while showing it: { width, height, duration }. */
export function sizeRow(d, media = {}) {
  const ext = String(d.ext || '').toUpperCase();
  const dims = (w, h) => (w > 0 && h > 0 ? `${Math.round(w)} × ${Math.round(h)}` : '');
  const parts = [];
  if (d.kind === 'audio') {
    const len = media.duration > 0 ? clock(media.duration) : '';
    return { k: 'Length', v: [len, sizeText(d.size), ext].filter(Boolean).join(' · ') };
  }
  if (d.kind === 'video') {
    const w = media.width || d.footage?.width || 0;
    const h = media.height || d.footage?.height || 0;
    const len =
      media.duration > 0
        ? clock(media.duration)
        : d.footage?.durationSec
          ? clock(d.footage.durationSec)
          : '';
    parts.push(dims(w, h), len, sizeText(d.size));
    return { k: 'Size', v: parts.filter(Boolean).join(' · ') };
  }
  parts.push(dims(media.width, media.height), sizeText(d.size), ext);
  return { k: 'Size', v: parts.filter(Boolean).join(' · ') };
}

/** "Added" — relative first, then "27 Sep, 21:40". */
export function addedText(mtimeMs, now = Date.now()) {
  const t = Number(mtimeMs);
  return Number.isFinite(t) && t > 0 ? commentTime(new Date(t).toISOString(), now) : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Oct" from an ISO time; '' when it is not one. */
export function dayText(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const PROVIDERS = Object.freeze({
  google: 'Google',
  gemini: 'Google',
  fal: 'fal',
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  replicate: 'Replicate',
  stub: 'Test provider',
});
/** "Google · Nano Banana Pro · 5 Oct" — who made it, with what, and when. */
export function madeWith(m) {
  if (!m) return '';
  const id = String(m.provider || '').toLowerCase();
  const who =
    PROVIDERS[id] ?? (m.provider ? m.provider.charAt(0).toUpperCase() + m.provider.slice(1) : '');
  return [who, m.model, dayText(m.at)].filter(Boolean).join(' · ');
}

/** "0:01–0:04 run" · "0:05 celebration" */
export function momentText(m) {
  const span = m.end - m.start >= 1 ? `${clock(m.start)}–${clock(m.end)}` : clock(m.start);
  return m.note ? `${span} ${m.note}` : span;
}

/** "Used in 4 canvases" — the section title. The index's careful words win (older versions, takes not placed yet). */
export function usedTitle(asset, d) {
  const n = new Set((d?.uses ?? []).map((u) => u.canvas)).size;
  if (n) return `Used in ${n} ${n === 1 ? 'canvas' : 'canvases'}`;
  return asset?.usedIn == null ? 'Where it is used is not known here.' : null;
}

/**
 * One row per place the asset shows: the canvas, and the artboard when there is one to open.
 * @returns {Array<{ key: string, canvas: string, name: string, board: string | null, boardId: string | null }>}
 */
export function useRows(d) {
  const rows = [];
  for (const u of d?.uses ?? []) {
    const name = displayName(String(u.canvas).split('/').pop() || u.canvas);
    if (!u.boards?.length)
      rows.push({ key: u.canvas, canvas: u.canvas, name, board: null, boardId: null });
    for (const b of u.boards ?? [])
      rows.push({
        key: `${u.canvas}#${b.id}`,
        canvas: u.canvas,
        name,
        board: b.label,
        boardId: b.id,
      });
  }
  return rows;
}

const stemOf = (rel) =>
  String(rel)
    .replace(/^assets\//, '')
    .split('.')[0];

/** The Edits line of the main view: nothing when the asset has no edit file. */
export function editsLine(d) {
  const files = d?.advanced?.edits ?? [];
  if (!files.length) return '';
  const every = files.includes(`assets/${stemOf(d.rel)}.photo.json`);
  const own = files.length - (every ? 1 : 0);
  const ownText = own === 1 ? '1 use has its own look' : `${own} uses have their own look`;
  if (every && own) return `Changed on every use, and ${ownText}`;
  return every ? 'Changed on every use' : ownText;
}

/**
 * Advanced's rows, only the ones that have something to say. `values` is a list so several edit files read as several lines.
 * @returns {Array<{ id: string, k: string, values: string[], copy: boolean }>}
 */
export function advancedRows(d) {
  const a = d?.advanced;
  if (!a) return [];
  const rows = [{ id: 'stored', k: 'Stored as', values: [a.storedAs], copy: true }];
  if (a.original) rows.push({ id: 'original', k: 'Original', values: [a.original], copy: false });
  if (a.edits?.length) rows.push({ id: 'edits', k: 'Edits', values: a.edits, copy: false });
  if (a.cutOuts?.length) rows.push({ id: 'cutout', k: 'Cut-out', values: a.cutOuts, copy: false });
  rows.push({ id: 'in', k: 'In canvases', values: [a.inCanvases], copy: false });
  return rows;
}

/** The hint after "Advanced" while it is closed: what is inside. */
export function advancedHint(d) {
  const a = d?.advanced;
  if (!a) return '';
  return ['file name', a.original ? 'original path' : null, a.edits?.length ? 'edits' : null]
    .filter(Boolean)
    .join(' · ');
}

/** The Place button's words: "Place in MVP zápasu" when an artboard is selected, else "Place". */
export const placeText = (label) => (label ? `Place in ${label}` : 'Place');

/** The sheet's first title: a generated asset is named by what was asked for; anything else by its file name. */
export function titleOf(d) {
  const p = d?.madeByAi?.prompt;
  if (!p) return d?.name ?? '';
  const first = p.split(/[,.;\n]/)[0].trim();
  return (first.length > 56 ? `${first.slice(0, 55).trimEnd()}…` : first) || d.name;
}

/**
 * What the sheet can say from the Assets tab's own row alone: a studio that does not serve the details route, or one that
 * has not answered yet. No Made by AI, no AI saw, no Original; the uses name their canvas but no artboard.
 */
export function fallbackDetails(asset) {
  const rel = String(asset?.path ?? '');
  const name = asset?.name || rel.split('/').pop() || rel;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const kind = asset?.kind === 'video' || asset?.kind === 'audio' ? asset.kind : 'image';
  const ref =
    kind === 'video'
      ? `<video src="${rel}">`
      : kind === 'audio'
        ? `<audio src="${rel}">`
        : `<img src="${rel}">`;
  return {
    rel,
    name,
    kind,
    ext,
    size: Number(asset?.size) || 0,
    mtimeMs: Number(asset?.mtimeMs) || 0,
    madeByAi: null,
    footage: null,
    uses: (asset?.usedIn ?? []).map((canvas) => ({ canvas, boards: [] })),
    advanced: { storedAs: rel, edits: [], cutOuts: [], inCanvases: ref },
  };
}
