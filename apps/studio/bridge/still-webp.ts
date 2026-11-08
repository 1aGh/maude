// apps/studio/bridge/still-webp.ts — #212 §5 (T2.2): is this buffer a still (WebP or PNG) of an overview still?
//
// The bytes come from the untrusted canvas origin (DDR-054) and are stored by the shell across sessions
// (client/v2/shell/still-store.js), so they are checked by what they ARE, never by what the frame says:
// for WebP the RIFF container, the first chunk's bitstream header and the size it encodes; for PNG (WebKit encodes
// no WebP) a structural chunk walk and the IHDR size. Nothing is decoded.
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

// ─── PNG (WebKit has no WebP encoder: `toBlob(cb, 'image/webp')` answers `image/png` on Safari / Tauri) ───────

export type StillPngCheck =
  | { ok: true; w: number; h: number }
  | {
      ok: false;
      reason:
        | 'not-bytes'
        | 'empty'
        | 'too-large'
        | 'not-png'
        | 'bad-size'
        | 'bad-chunk'
        | 'animated'
        | 'too-big';
    };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const be32 = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
/** The chunks a canvas encoder writes (WebKit: IHDR sRGB eXIf IDAT… IEND); any other chunk refuses the still. */
// Kept to what a canvas encoder writes: no iCCP (an untrusted compressed ICC profile the decoder would inflate and
// parse), no text chunks. Interlace is refused too — a canvas encoder never writes Adam7.
const PNG_ANCILLARY = new Set(['sRGB', 'gAMA', 'cHRM', 'pHYs', 'sBIT', 'bKGD', 'tRNS', 'eXIf']);
/** APNG: a still is one image. */
const PNG_ANIMATION = new Set(['acTL', 'fcTL', 'fdAT']);
/** Bit depths allowed per colour type (PNG spec, table 11.1). */
const PNG_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/**
 * Check a candidate still: a single-image PNG no bigger than the overview ever draws. A structural walk, CRC-free
 * (nothing here decodes, the canvas does in its own origin): the signature; IHDR first, 13 bytes, its size within the
 * caps and a valid depth / colour type / method triple; every chunk's length within what is left of the buffer (an
 * integer compare against the remaining bytes, never `off + len`); only the chunks a canvas encoder writes, one IDAT
 * run; no APNG chunk; IEND empty and the very last bytes — nothing trails the image.
 */
export function checkStillPng(v: unknown): StillPngCheck {
  const b = u8(v);
  if (!b) return { ok: false, reason: 'not-bytes' };
  if (b.length === 0) return { ok: false, reason: 'empty' };
  if (b.length > STILL_PERSIST_MAX_BYTES) return { ok: false, reason: 'too-large' };
  // signature + IHDR (12 + 13) + IEND (12)
  if (b.length < 8 + 25 + 12 || PNG_SIG.some((x, i) => b[i] !== x))
    return { ok: false, reason: 'not-png' };
  let off = 8;
  let first = true;
  let w = 0;
  let h = 0;
  let palette = false;
  let plte = false;
  let idat: 'none' | 'in' | 'done' = 'none';
  for (;;) {
    const left = b.length - off;
    if (left < 12) return { ok: false, reason: 'bad-chunk' }; // a chunk is at least length + type + CRC
    const len = be32(b, off);
    if (len > left - 12) return { ok: false, reason: 'bad-chunk' };
    const type = tag(b, off + 4);
    const d = off + 8;
    if (!/^[A-Za-z]{4}$/.test(type)) return { ok: false, reason: 'bad-chunk' };
    if (first) {
      if (type !== 'IHDR' || len !== 13) return { ok: false, reason: 'bad-chunk' };
      w = be32(b, d);
      h = be32(b, d + 4);
      const depth = b[d + 8];
      const color = b[d + 9];
      if (!(PNG_DEPTHS[color] ?? []).includes(depth)) return { ok: false, reason: 'bad-chunk' };
      // compression 0, filter 0, interlace 0 (none — a canvas encoder never writes Adam7)
      if (b[d + 10] !== 0 || b[d + 11] !== 0 || b[d + 12] !== 0)
        return { ok: false, reason: 'bad-chunk' };
      if (!(w > 0 && h > 0)) return { ok: false, reason: 'bad-chunk' };
      if (w > STILL_PERSIST_MAX_W || h > STILL_PERSIST_MAX_H)
        return { ok: false, reason: 'too-big' };
      palette = color === 3;
      first = false;
    } else if (type === 'IEND') {
      if (len !== 0 || idat === 'none' || (palette && !plte))
        return { ok: false, reason: 'bad-chunk' };
      if (d + 4 !== b.length) return { ok: false, reason: 'bad-size' };
      return { ok: true, w, h };
    } else if (type === 'IDAT') {
      if (idat === 'done') return { ok: false, reason: 'bad-chunk' };
      idat = 'in';
    } else if (PNG_ANIMATION.has(type)) {
      return { ok: false, reason: 'animated' };
    } else if (type === 'PLTE' || PNG_ANCILLARY.has(type)) {
      if (idat === 'in') idat = 'done';
      if (type === 'PLTE') {
        if (plte || idat !== 'none' || len === 0 || len > 768 || len % 3 !== 0)
          return { ok: false, reason: 'bad-chunk' };
        plte = true;
      }
    } else return { ok: false, reason: 'bad-chunk' }; // a second IHDR, text, an unknown or private chunk
    off = d + len + 4;
  }
}
// ─── either format ─────────────────────────────────────────────────────────────────────────────────────────────

export type StillFormat = 'webp' | 'png';
export type StillImageCheck =
  | { ok: true; format: StillFormat; w: number; h: number }
  | {
      ok: false;
      reason: Exclude<StillWebpCheck, { ok: true }>['reason'] | 'not-image' | 'not-png';
    };

/**
 * Check a candidate still in the format its first bytes name — WebP (Chromium, Firefox) or PNG (WebKit) — and
 * report that format, so the canvas decodes it with the right MIME. Bytes that are neither are `not-image`.
 */
export function checkStillImage(v: unknown): StillImageCheck {
  const b = u8(v);
  if (b && b.length >= 8 && PNG_SIG.every((x, i) => b[i] === x)) {
    const r = checkStillPng(b);
    return r.ok ? { ok: true, format: 'png', w: r.w, h: r.h } : r;
  }
  if (b && b.length >= 12 && tag(b, 0) === 'RIFF' && tag(b, 8) === 'WEBP') {
    const r = checkStillWebp(b);
    return r.ok ? { ok: true, format: 'webp', w: r.w, h: r.h } : r;
  }
  if (!b) return { ok: false, reason: 'not-bytes' };
  if (b.length === 0) return { ok: false, reason: 'empty' };
  if (b.length > STILL_PERSIST_MAX_BYTES) return { ok: false, reason: 'too-large' };
  return { ok: false, reason: 'not-image' };
}

/** The MIME of a still's bytes (`image/webp` | `image/png`), or null when they are not a still. */
export function stillMime(v: unknown): 'image/webp' | 'image/png' | null {
  const r = checkStillImage(v);
  return r.ok ? (r.format === 'png' ? 'image/png' : 'image/webp') : null;
}

/** The buffer when it is a still (WebP or PNG; a fresh copy, so a later write to the sender's view cannot change it), else null. */
export function stillImageBytes(v: unknown): ArrayBuffer | null {
  if (!checkStillImage(v).ok) return null;
  const b = u8(v) as Uint8Array;
  return b.slice().buffer;
}

/** The buffer when it is a still WebP (a fresh copy), else null. WebP only; the bridge uses `stillImageBytes`. */
export function stillWebpBytes(v: unknown): ArrayBuffer | null {
  if (!checkStillWebp(v).ok) return null;
  const b = u8(v) as Uint8Array;
  return b.slice().buffer;
}
