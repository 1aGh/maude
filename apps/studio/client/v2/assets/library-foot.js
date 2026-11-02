// client/v2/assets/library-foot.js — the words the Assets tab keeps in its foot and its kind filter (12 · ia-assets-panel).
//
// "247 assets · 1.4 GB" is the whole library, always there under the list (the board's `CanvasesPanel foot`); "All kinds ▾"
// narrows the list to Photos, Video or Sound. Pure, so the sizes and the words are pinned without a render.

const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;

/** "212 KB" · "2.1 MB" · "1.4 GB" — one decimal under 10, none above; a gigabyte only from 1 GB up. */
export function bytesWords(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / KB))} KB`;
}

/** "247 assets · 1.4 GB" — `null` for an empty library (the empty state speaks there). */
export function libraryFootWords(assets) {
  const list = Array.isArray(assets) ? assets : [];
  if (!list.length) return null;
  const bytes = list.reduce((n, a) => n + (Number(a?.size) || 0), 0);
  return `${list.length} ${list.length === 1 ? 'asset' : 'assets'} · ${bytesWords(bytes)}`;
}

/** @type {ReadonlyArray<{ id: 'all' | 'image' | 'video' | 'audio', label: string }>} */
export const KINDS = Object.freeze([
  { id: 'all', label: 'All kinds' },
  { id: 'image', label: 'Photos' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Sound' },
]);

/** The label the kind chip wears. */
export const kindLabel = (id) => KINDS.find((k) => k.id === id)?.label ?? KINDS[0].label;

/** The list narrowed to one kind ('all' keeps everything; an asset with no kind is a picture). */
export const filterKind = (assets, id) =>
  id === 'all' ? assets : assets.filter((a) => (a.kind || 'image') === id);

/** Tiles a group draws before its count takes over: two rows of three (the board's "120 ›"). */
export const GROUP_CAP = 6;
