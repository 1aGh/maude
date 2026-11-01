/**
 * @file       annotations/ui/sticker-preview.ts — a picked sticker shows its picture at once (r4 #16)
 * @scope      apps/studio/annotations/ui/sticker-preview.ts
 * @purpose    A gallery sticker is uploaded to a project asset before the canvas hears about it, and the
 *             canvas then fetched `assets/<name>` again from its own origin: the ghost under the pointer was
 *             an empty box, and the placed sticker stayed blank until that second load finished. The shell
 *             already holds the bytes (the gallery loaded them), so it sends them along as a small image
 *             data URL (`preview`); this module keeps the last few and answers "what do I draw for this
 *             asset path while the real file is not loaded yet". Pure, no DOM. The data URL is never
 *             written to the board: the stroke keeps its `assets/…` href, peers load that.
 */

/** A preview rides in one postMessage: bigger than this is not a sticker picture. */
export const MAX_PREVIEW_CHARS = 400_000;

const IMAGE_DATA_URL = /^data:image\/(?:png|webp|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** True for a small base64 raster-image data URL (never svg, html or a remote address). */
export function isImageDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_PREVIEW_CHARS && IMAGE_DATA_URL.test(v);
}

const KEEP = 48;
const previews = new Map<string, string>();

/** Remember the picture for an asset path (the newest {@link KEEP} stay). */
export function rememberStickerPreview(path: string, dataUrl: string): void {
  if (!path || !isImageDataUrl(dataUrl)) return;
  previews.delete(path);
  previews.set(path, dataUrl);
  while (previews.size > KEEP) {
    const oldest = previews.keys().next().value;
    if (oldest === undefined) break;
    previews.delete(oldest);
  }
}

/** The remembered picture for this asset path, or null. */
export function resolveStickerHref(path: string): string | null {
  return previews.get(path) ?? null;
}
