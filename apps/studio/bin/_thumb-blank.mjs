// _thumb-blank.mjs — "is this cover a blank card?" for the thumbnail renderer (2.0.5 W5).
//
// A cover that is one flat colour (an empty viewport, a canvas that drew nothing, the page's own
// background) is worse than no cover: Home would cache it as a fresh hit and never look again.
// The renderer asks this of every JPEG it is about to hand back; the server treats `blank: true` as
// a retryable miss (thumbs/service.ts), so Home keeps its placeholder instead.
//
// The check runs on a BLANK page (`about:blank`) — never on the canvas page, whose code is untrusted
// (DDR-054) — by decoding the JPEG in the browser (the shim has no image library), shrinking it to
// 64 px wide and counting how much of it is the single most common colour (4 bits per channel, so
// JPEG noise on a flat area still counts as flat). It is "blank" only when that colour is white or the
// canvas's own background (what an unpainted viewport shows): a design that is one deliberate colour
// (a dark hero, a brand-colour poster) is a cover.

/** more than this share of one colour = blank. A text-only slice of a white page stays well under. */
export const BLANK_SHARE = 0.99;

/** Runs in the page: base64 JPEG → { share of the most common colour (0..1), its rgb }, or null when it cannot decode. */
export async function dominantShare(b64) {
  try {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
    const w = Math.min(64, bmp.width);
    const h = Math.max(1, Math.round((w * bmp.height) / bmp.width));
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const counts = new Map();
    let top = 0;
    let topKey = 0;
    for (let i = 0; i < px.length; i += 4) {
      const k = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      if (n > top) {
        top = n;
        topKey = k;
      }
    }
    // the bucket's centre
    const rgb = [(topKey >> 8) & 15, (topKey >> 4) & 15, topKey & 15].map((v) => v * 16 + 8);
    return { share: top / (w * h), rgb };
  } catch {
    return null;
  }
}

const NEAR = 24;
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= NEAR);

/**
 * `page` must be on about:blank; `bg` = the canvas page's background colour as [r, g, b] (or null).
 * true = blank, false = has content, null = could not tell (kept).
 */
export async function isBlankCover(page, b64, bg = null) {
  const r = await page.evaluate(dominantShare, b64).catch(() => null);
  if (!r || typeof r.share !== 'number') return null;
  if (r.share <= BLANK_SHARE) return false;
  return near(r.rgb, [255, 255, 255]) || (Array.isArray(bg) && near(r.rgb, bg));
}

/** "rgb(22, 24, 29)" / "rgba(…)" → [22, 24, 29]; a transparent or unparsable value → null. */
export function parseRgb(css) {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(String(css));
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
