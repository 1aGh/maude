// r4 #16 - decode the sticker pictures when the gallery opens, so a thumbnail is never an empty box and the
// bytes the pick then fetches are already in the cache. A few at a time (143 stickers, ~8 MB): never a burst.

const BATCH = 8;

/**
 * Load and decode every sticker picture. Resolves when all are done (a failed one is skipped).
 * @param stickers `{url}` rows of the gallery
 * @param opts.ImageCtor injected for tests; defaults to the page's `Image`
 * @param opts.alive () => boolean - stop early once the gallery has closed
 */
export async function preloadStickers(stickers, opts = {}) {
  const ImageCtor = opts.ImageCtor ?? (typeof Image === 'undefined' ? null : Image);
  if (!ImageCtor) return;
  const alive = opts.alive ?? (() => true);
  const urls = [...new Set((stickers ?? []).map((s) => s?.url).filter(Boolean))];
  for (let i = 0; i < urls.length && alive(); i += BATCH) {
    await Promise.all(urls.slice(i, i + BATCH).map((url) => preloadOne(url, ImageCtor)));
  }
}

/** The sticker's bytes as a data URL for the canvas to draw at once; null when it is not a small raster image. */
export function blobToDataUrl(blob, max = 400000) {
  return new Promise((resolve) => {
    if (!blob || !/^image\/(png|webp|jpeg|gif)$/.test(blob.type) || blob.size * 1.4 > max) {
      resolve(null);
      return;
    }
    const r = new FileReader();
    r.onload = () =>
      resolve(typeof r.result === 'string' && r.result.length <= max ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

/** One picture: start the load, and wait for the decode so the first paint is the real picture. */
export function preloadOne(url, ImageCtor = typeof Image === 'undefined' ? null : Image) {
  if (!ImageCtor || !url) return Promise.resolve();
  const img = new ImageCtor();
  img.decoding = 'async';
  img.src = url;
  return typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
}
