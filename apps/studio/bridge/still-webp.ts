// apps/studio/bridge/still-webp.ts — #212 §5 (T2.2): is this buffer a still WebP of an overview still?
//
// The bytes come from the untrusted canvas origin (DDR-054) and are stored by the shell across sessions
// (client/v2/shell/still-store.js), so they are checked by what they ARE, never by what the frame says:
// the RIFF container, the first chunk's bitstream header, and the size it encodes. Nothing is decoded.
// Leaf module (no imports): the dgn table (both documents) and the shell store share it.
//
// Contract: client/v2/contracts/212-still-cache.md §5 "Bytes".

/** The most bytes one persisted still may have (measured: ~18 kB at 400 px). */
export const STILL_PERSIST_MAX_BYTES = 256 * 1024;
/** The largest still the overview draws: `stillWidthPx` (400) × `RASTER_MAX_HEIGHT_PX` (1600), +1 px rounding. */
export const STILL_PERSIST_MAX_W = 401;
export const STILL_PERSIST_MAX_H = 1601;

export type StillWebpCheck =
  | { ok: true; w: number; h: number }
  | {
      ok: false;
      reason:
        | 'not-bytes'
        | 'empty'
        | 'too-large'
        | 'not-webp'
        | 'bad-size'
        | 'bad-chunk'
        | 'animated'
        | 'too-big';
    };

const u8 = (v: unknown): Uint8Array | null => {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  // a buffer from another realm (a structured clone keeps the class name)
  if (v && typeof v === 'object' && Object.prototype.toString.call(v) === '[object ArrayBuffer]')
    return new Uint8Array(v as ArrayBuffer);
  return null;
};
const tag = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const le32 = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** Check a candidate still: a real, single-frame WebP no bigger than the overview ever draws. */
export function checkStillWebp(v: unknown): StillWebpCheck {
  const b = u8(v);
  if (!b) return { ok: false, reason: 'not-bytes' };
  if (b.length === 0) return { ok: false, reason: 'empty' };
  if (b.length > STILL_PERSIST_MAX_BYTES) return { ok: false, reason: 'too-large' };
  if (b.length < 30 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WEBP')
    return { ok: false, reason: 'not-webp' };
  // the RIFF size names exactly this buffer (+ one pad byte at most): nothing trails the image
  const riff = le32(b, 4);
  if (riff + 8 !== b.length && riff + 9 !== b.length) return { ok: false, reason: 'bad-size' };
  const chunk = tag(b, 12);
  const len = le32(b, 16);
  if (len < 10 || 20 + len > b.length) return { ok: false, reason: 'bad-chunk' };
  let w = 0;
  let h = 0;
  if (chunk === 'VP8 ') {
    // frame tag (3 bytes, bit 0 = 0 for a key frame), then the start code 9d 01 2a, then 14-bit width / height
    if ((b[20] & 1) !== 0 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a)
      return { ok: false, reason: 'bad-chunk' };
    w = (b[26] | (b[27] << 8)) & 0x3fff;
    h = (b[28] | (b[29] << 8)) & 0x3fff;
  } else if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return { ok: false, reason: 'bad-chunk' };
    const bits = le32(b, 21);
    w = (bits & 0x3fff) + 1;
    h = ((bits >>> 14) & 0x3fff) + 1;
    if (bits >>> 29 !== 0) return { ok: false, reason: 'bad-chunk' }; // version 0 only
  } else if (chunk === 'VP8X') {
    // flags: bit 1 = animation — a still is one frame
    if ((b[20] & 0x02) !== 0) return { ok: false, reason: 'animated' };
    w = le24(b, 24) + 1;
    h = le24(b, 27) + 1;
  } else return { ok: false, reason: 'bad-chunk' };
  if (!(w > 0 && h > 0)) return { ok: false, reason: 'bad-chunk' };
  if (w > STILL_PERSIST_MAX_W || h > STILL_PERSIST_MAX_H) return { ok: false, reason: 'too-big' };
  return { ok: true, w, h };
}

/** The buffer when it is a still WebP (a fresh copy, so a later write to the sender's view cannot change it), else null. */
export function stillWebpBytes(v: unknown): ArrayBuffer | null {
  if (!checkStillWebp(v).ok) return null;
  const b = u8(v) as Uint8Array;
  return b.slice().buffer;
}
