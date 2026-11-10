// B3 (fix-bulk 2026-11-10) — a multi-page Print PDF lost the pictures and the webfont of an
// artboard that started OUTSIDE the capture viewport.
//
// LetakA6 (canvas-as-separate): page 3, the first artboard of the second section, came out with
// no `<img>` (group photo, QR) and its colour font fell back to Times; pages 1, 2 and 4 were fine,
// a selection-only export of that artboard was fine, and a warm re-run was fine — a race. Every
// `.dc-artboard-body` carries `content-visibility: auto` (canvas-lib), so an artboard off screen
// is neither laid out nor painted: its pictures are not decoded and its webfont is never
// requested, so the one `document.fonts.ready` the shim awaited after load resolved without it.
// The shim then moved the artboard into view and called `page.pdf()` at once.
//
// This is the END-TO-END guard: the real export route (the same adapters the render service
// runs) against a real canvas-lib canvas whose second section is below the 1440×900 capture
// viewport and is the ONLY place a picture and a webfont are used, then every page of the PDF
// (and every PNG) is read for them. On loopback the assets arrive in microseconds, so this one
// rarely loses the race even without the fix; the deterministic red→green lives in
// `export-shim-offscreen-settle.test.ts`, which serves the same assets with a delay.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import type { Subprocess } from 'bun';
import JSZip from 'jszip';
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

/** A latin face that covers the headline (the studio's own Inter; Chromium names it "Inter-…"). */
const WOFF2 = readFileSync(
  join(import.meta.dir, '..', 'client', 'fonts', 'inter-latin-wght-normal.woff2')
);

/** A 64×64 two-colour PNG, generated so it is unmistakable on a page (no checked-in binary). */
function pngBytes(): Uint8Array {
  const w = 64;
  const h = 64;
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const on = (x >> 3) % 2 === (y >> 3) % 2;
      raw[o] = on ? 220 : 20;
      raw[o + 1] = on ? 40 : 180;
      raw[o + 2] = 60;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

// Section 1 is two tall artboards in the system font with no pictures; section 2 starts below
// the 900 px capture viewport and is the only place the picture and the webfont are used.
const CANVAS_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

const FACE = \`@font-face{font-family:"W4Face";src:url("assets/w4.woff2") format("woff2");font-display:swap;}\`;

function Plain({ n }: { n: string }) {
  return <div style={{ padding: 24, height: "100%", background: "#f4efe4", fontFamily: "Helvetica, Arial, sans-serif" }}>Plain {n}</div>;
}

function Rich({ n }: { n: string }) {
  return (
    <div style={{ padding: 24, height: "100%", background: "#132038", color: "#f2efe6" }}>
      <div style={{ fontFamily: '"W4Face"', fontSize: 40 }}>Gators {n}</div>
      <img src={\`assets/pic-\${n}.png\`} width={160} height={160} alt="" style={{ display: "block" }} />
    </div>
  );
}

export default function Offscreen() {
  return (
    <DesignCanvas>
      <style>{FACE}</style>
      <DCSection id="one" title="One">
        <DCArtboard id="a1" label="A1" width={420} height={1400}><Plain n="a1" /></DCArtboard>
        <DCArtboard id="a2" label="A2" width={420} height={1400}><Plain n="a2" /></DCArtboard>
      </DCSection>
      <DCSection id="two" title="Two">
        <DCArtboard id="b1" label="B1" width={420} height={600}><Rich n="b1" /></DCArtboard>
        <DCArtboard id="b2" label="B2" width={420} height={600}><Rich n="b2" /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** Image XObjects and font names reachable from one resource dict (Form XObjects included). */
function pageInventory(resources: PDFObject | undefined, seen = new Set<string>()) {
  const out = { images: 0, fonts: [] as string[] };
  if (!(resources instanceof PDFDict)) return out;
  const fonts = resources.lookup(PDFName.of('Font'));
  if (fonts instanceof PDFDict) {
    for (const key of fonts.keys()) {
      const f = fonts.lookup(key);
      if (!(f instanceof PDFDict)) continue;
      let name = f.lookup(PDFName.of('BaseFont'));
      const fd = f.lookup(PDFName.of('FontDescriptor'));
      if (!(name instanceof PDFName) && fd instanceof PDFDict)
        name = fd.lookup(PDFName.of('FontName'));
      out.fonts.push(name instanceof PDFName ? name.decodeText() : '(unnamed)');
    }
  }
  const xobjects = resources.lookup(PDFName.of('XObject'));
  if (xobjects instanceof PDFDict) {
    for (const key of xobjects.keys()) {
      const ref = xobjects.get(key);
      const id = ref instanceof PDFRef ? ref.toString() : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const xo = xobjects.lookup(key);
      if (!(xo instanceof PDFStream)) continue;
      const sub = xo.dict.lookup(PDFName.of('Subtype'));
      const width = xo.dict.lookup(PDFName.of('Width'));
      if (sub instanceof PDFName && sub.decodeText() === 'Image') {
        if (width instanceof PDFNumber && width.asNumber() >= 32) out.images += 1;
      } else {
        const inner = pageInventory(xo.dict.lookup(PDFName.of('Resources')), seen);
        out.images += inner.images;
        out.fonts.push(...inner.fonts);
      }
    }
  }
  return out;
}

/** Decoded RGB of a PNG (8-bit, colour type 2 or 6, no interlace) — enough for Chromium's shots. */
function pngPixels(png: Uint8Array): { w: number; h: number; at(x: number, y: number): number[] } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Uint8Array[] = [];
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = new DataView(data.buffer, data.byteOffset).getUint32(0);
      h = new DataView(data.buffer, data.byteOffset).getUint32(4);
      ct = data[9] as number;
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d))));
  const stride = w * bpp;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x += 1) {
      const rawV = raw[y * (stride + 1) + 1 + x] as number;
      const a = x >= bpp ? (px[y * stride + x - bpp] as number) : 0;
      const b = y > 0 ? (px[(y - 1) * stride + x] as number) : 0;
      const c = x >= bpp && y > 0 ? (px[(y - 1) * stride + x - bpp] as number) : 0;
      let v = rawV;
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
      px[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, at: (x, y) => [...px.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
}

let proc: Subprocess | null = null;
let port = 0;
let root = '';

beforeAll(async () => {
  const box = makeSandbox();
  root = box.root;
  mkdirSync(join(box.designRoot, 'assets'), { recursive: true });
  writeFileSync(join(box.designRoot, 'assets', 'w4.woff2'), WOFF2);
  const png = pngBytes();
  writeFileSync(join(box.designRoot, 'assets', 'pic-b1.png'), png);
  writeFileSync(join(box.designRoot, 'assets', 'pic-b2.png'), png);
  writeFileSync(join(box.designRoot, 'ui', 'offscreen.tsx'), CANVAS_TSX);
  port = nextPort();
  proc = await bootServer(root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    HOME: `${root}-home`,
    XDG_CONFIG_HOME: `${root}-xdg`,
  });
}, 30_000);

afterAll(async () => {
  if (proc) await killProc(proc);
});

async function exportCanvas(format: 'pdf' | 'png'): Promise<Uint8Array> {
  const r = await fetch(`http://localhost:${port}/_api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      format,
      scope: 'canvas-as-separate',
      options: { canvasFile: '.design/ui/offscreen.tsx' },
    }),
    signal: AbortSignal.timeout(110_000),
  });
  const body = new Uint8Array(await r.arrayBuffer());
  if (r.status !== 200) throw new Error(`export ${r.status}: ${new TextDecoder().decode(body)}`);
  return body;
}

// The capture shims need Playwright's Chromium; a CI shard without it skips (the shims answer exit 3).
const HAS_CHROMIUM = await (async () => {
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

describe.skipIf(!HAS_CHROMIUM)(
  'canvas-as-separate export — an artboard that starts off screen keeps its pictures and webfont',
  () => {
    test('PDF: every page of the second section has its image and the webfont', async () => {
      const doc = await PDFDocument.load(await exportCanvas('pdf'));
      expect(doc.getPageCount()).toBe(4);
      const pages = doc.getPages().map((p) => pageInventory(p.node.Resources()));
      // Pages 3 and 4 are B1 and B2 (document order). Both draw the same picture and the same face.
      const summary = pages.map((p, i) => ({
        page: i + 1,
        // the 64×64 picture, not Chromium's 14×16 broken-image glyph
        picture: p.images > 0,
        webfont: p.fonts.some((f) => /Inter/.test(f)),
        fallback: p.fonts.some((f) => /Times|Serif/i.test(f)),
      }));
      expect(summary.slice(2)).toEqual([
        { page: 3, picture: true, webfont: true, fallback: false },
        { page: 4, picture: true, webfont: true, fallback: false },
      ]);
    }, 120_000);

    test('PNG: the second section’s first artboard has its picture painted', async () => {
      const zip = await JSZip.loadAsync(await exportCanvas('png'));
      const name = Object.keys(zip.files).find((n) => /b1/.test(n));
      expect(name).toBeDefined();
      const img = pngPixels(
        await (zip.file(name as string) as JSZip.JSZipObject).async('uint8array')
      );
      // The picture sits at (24, 24 + headline) in CSS px; probe its centre band at any scale.
      const sx = img.w / 420;
      let hits = 0;
      for (
        let y = Math.round(90 * sx);
        y < Math.round(260 * sx);
        y += Math.max(1, Math.round(4 * sx))
      ) {
        const [r, g] = img.at(Math.round(100 * sx), y) as number[];
        if (
          ((r as number) > 180 && (g as number) < 90) ||
          ((r as number) < 60 && (g as number) > 140)
        )
          hits += 1;
      }
      expect(hits).toBeGreaterThan(5);
    }, 120_000);
  }
);
