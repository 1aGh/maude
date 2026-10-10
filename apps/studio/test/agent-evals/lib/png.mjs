// agent-evals/lib/png.mjs — dependency-free "is this screenshot blank?" for 8-bit RGB/RGBA PNGs.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let ctype = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || ![2, 6].includes(ctype))
    throw new Error(`unsupported PNG (depth ${depth}, colour ${ctype}, interlace ${interlace})`);
  const bpp = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

/** → { blank, w, h, fgShare, colours } — blank = (almost) one colour, i.e. nothing rendered. */
export function pngStats(path) {
  const { w, h, bpp, px } = decode(readFileSync(path));
  const step = Math.max(1, Math.floor((w * h) / 40000));
  const counts = new Map();
  let n = 0;
  for (let i = 0; i < w * h; i += step) {
    const o = i * bpp;
    const key = ((px[o] >> 3) << 10) | ((px[o + 1] >> 3) << 5) | (px[o + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    n++;
  }
  const top = Math.max(...counts.values());
  const fgShare = 1 - top / n;
  return {
    blank: fgShare < 0.01 || counts.size < 4,
    w,
    h,
    fgShare: +fgShare.toFixed(4),
    colours: counts.size,
  };
}
