// thumbs/validate.ts — the server's check on every picture before it is stored (V2-2.17, contract
// V2-1.17 §5.8 "Server-side validation", R2/R5).
//
// The renderer runs untrusted canvas code; the page's only output is bytes, and those bytes are
// stored only if they are a baseline/progressive JPEG (SOI … EOI), no larger than 1 MB, whose
// frame header says it is no bigger than the size the SERVER asked for (+ 1 px rounding). The
// dimensions come from the JPEG itself — never from what the shim or the page claims.

export const MAX_THUMB_BYTES = 1024 * 1024;

export type JpegCheck =
  | { ok: true; w: number; h: number }
  | {
      ok: false;
      reason: 'empty' | 'too-large' | 'not-jpeg' | 'truncated' | 'no-frame' | 'too-big';
    };

// SOF markers that carry a frame size: C0–CF except DHT (C4), JPG (C8) and DAC (CC).
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** Frame size from the first SOF segment, or null. Walks marker segments; never reads past the end. */
export function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1] as number;
    // fill bytes
    while (marker === 0xff && i + 2 < b.length) {
      i++;
      marker = b[i + 1] as number;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan before a frame
    const len = ((b[i + 2] as number) << 8) | (b[i + 3] as number);
    if (len < 2 || i + 2 + len > b.length) return null;
    if (isSof(marker)) {
      if (len < 7) return null;
      const h = ((b[i + 5] as number) << 8) | (b[i + 6] as number);
      const w = ((b[i + 7] as number) << 8) | (b[i + 8] as number);
      return w > 0 && h > 0 ? { w, h } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** `px` = the long side the server asked for; the picture may be smaller, never larger than px + 1. */
export function checkJpeg(b: Uint8Array | null | undefined, px: number): JpegCheck {
  if (!b || b.length === 0) return { ok: false, reason: 'empty' };
  if (b.length > MAX_THUMB_BYTES) return { ok: false, reason: 'too-large' };
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff)
    return { ok: false, reason: 'not-jpeg' };
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9)
    return { ok: false, reason: 'truncated' };
  const size = jpegSize(b);
  if (!size) return { ok: false, reason: 'no-frame' };
  if (size.w > px + 1 || size.h > px + 1) return { ok: false, reason: 'too-big' };
  return { ok: true, ...size };
}
