// client/v2/assets/copy-asset.js — "Copy ⌘C" on an Assets tile (12 · ia-assets-keys `Menu` rows).
//
// A picture goes to the clipboard AS a picture (a PNG, which is the one image type every clipboard takes), so it pastes into
// a canvas, a chat or another app. Anything that is not a picture, or any refusal of the clipboard, answers `false` and the
// caller says so in words; nothing throws.

/** @returns {Promise<boolean>} */
export async function copyAssetImage(url, { fetchImpl, clipboard } = {}) {
  try {
    const cb = clipboard ?? globalThis.navigator?.clipboard;
    const Item = globalThis.ClipboardItem;
    if (!cb?.write || !Item) return false;
    const res = await (fetchImpl ?? fetch)(url);
    if (!res.ok) return false;
    const blob = await res.blob();
    const png = blob.type === 'image/png' ? blob : await toPng(blob);
    if (!png) return false;
    await cb.write([new Item({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

/** Redraw any decodable picture as a PNG blob (null when the browser cannot decode it). */
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')?.drawImage(bmp, 0, 0);
  bmp.close?.();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** The line a failed copy says. */
export const COPY_FAILED_LINE = 'Could not copy that picture.';
