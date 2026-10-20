// editing/finder-drop-model.ts — what a drop of files from Finder is, before anything is written (S8.14; 12 · ia-drop-photos).
//
// The pure half of editing/finder-drop.tsx: which files are photos, how many a drag in flight carries (only the type list is
// readable during dragover), how many empty frames the artboard under the pointer holds, and the one `image.place` ask a drop
// ends in. Nothing here trusts the files: the server sniffs the bytes (`POST /_api/asset`) and resolves the written path
// (`assets/<sha8>.<ext>`); a drop never names a path itself.

import { type PlaceTargetKind, planPlacement } from '../edit-ops/place-plan.ts';
import { ASSET_DRAG_MIME } from './asset-drag.ts';
import type { EditOpAsk } from './edit-op.ts';
import { isLockedDom } from './selection.tsx';

export const FINDER_PLACE_ACTION = 'image.place' as const;
/** One drop places at most this many (the op's own cap, `MAX_ASSETS` in edit-ops/image-fit.ts — not imported: that module carries the parser into the canvas). */
export const MAX_PHOTOS = 50;

const IMAGE_EXT = /\.(avif|gif|heic|heif|jpe?g|png|svg|tiff?|webp|psd)$/i;

type Typed = { type?: string; name?: string };

/** Is this file a picture? The type says so; a file the system could not type is judged by its extension. */
export function isPhoto(f: Typed): boolean {
  if (typeof f.type === 'string' && f.type !== '') return f.type.startsWith('image/');
  return typeof f.name === 'string' && IMAGE_EXT.test(f.name);
}

/** The photos of a drop, in the order Finder handed them over, capped at {@link MAX_PHOTOS}. */
export function photosOf<T extends Typed>(files: readonly T[]): { photos: T[]; over: number } {
  const all = files.filter(isPhoto);
  return { photos: all.slice(0, MAX_PHOTOS), over: Math.max(0, all.length - MAX_PHOTOS) };
}

/** A drag from the desktop (files), and not a tile from the Assets tab (that is image-drop's). */
export function isFinderDrag(types: readonly string[] | DOMStringList | null | undefined): boolean {
  if (!types) return false;
  const list = Array.from(types as ArrayLike<string>);
  return list.includes('Files') && !list.includes(ASSET_DRAG_MIME);
}

interface ItemLike {
  kind?: string;
  type?: string;
}

/**
 * How many photos a drag in flight carries. During dragover a browser shows the item list but not the files; some hide even
 * that (0 = not known, and the hint stays honest without a number).
 */
export function dragPhotoCount(items: ArrayLike<ItemLike> | null | undefined): number {
  if (!items) return 0;
  let n = 0;
  for (const it of Array.from(items)) {
    if (it.kind !== 'file') continue;
    if (it.type === '' || it.type === undefined || it.type.startsWith('image/')) n += 1;
  }
  return Math.min(n, MAX_PHOTOS);
}

/** Empty picture frames inside `el`: an `<img>` with no `src` that is not locked — what the server's `auto` fills. */
export function emptyFramesIn(el: Element): number {
  let n = 0;
  for (const img of Array.from(el.querySelectorAll('img[data-cd-id]'))) {
    if (img.getAttribute('src')) continue;
    if (isLockedDom(img as HTMLElement)) continue;
    n += 1;
  }
  return n;
}

export interface Landing {
  kind: PlaceTargetKind;
  empty: number;
}

/** The ask a drop ends in: `image.place` in `auto` mode — the studio picks with the same plan the hint was drawn from. */
export function askForFinderDrop(
  assets: string[],
  target: { ref: { artboard: string; element: string } | null; artboard: string },
  natural: { w: number; h: number } | null
): EditOpAsk {
  const params: Record<string, unknown> = { assets, mode: 'auto' };
  if (!target.ref) params.artboard = target.artboard;
  if (assets.length === 1 && natural) params.natural = natural;
  return { op: FINDER_PLACE_ACTION, targets: target.ref ? [target.ref] : [], params };
}

/** What to select after the write: a grid is selected as the one wrapper, everything else as the pictures it made. */
export function selectionRefs<T>(landing: Landing, count: number, created: readonly T[]): T[] {
  if (planPlacement(landing.kind, count, landing.empty).mode === 'grid') return created.slice(0, 1);
  return [...created];
}

/** "Placed 6 photos in Fotky ze zápasu. They're in Assets too." — what is said after the write. */
export function placedLine(count: number, artboardLabel: string): string {
  const what = count === 1 ? 'the photo' : `${count} photos`;
  return artboardLabel
    ? `Placed ${what} in ${artboardLabel}. ${count === 1 ? "It's" : "They're"} in Assets too.`
    : `Placed ${what}. ${count === 1 ? "It's" : "They're"} in Assets too.`;
}
