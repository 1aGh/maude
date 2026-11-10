// B3 (fix-bulk 2026-11-10) — the capture shims settle EACH artboard before they shoot it.
//
// A multi-page Print PDF of LetakA6 came out with page 3 (the first artboard of the second
// section) missing its photos and with its colour font fallen back to Times; a warm re-run was
// fine. The canvas mounts after `load`, every `.dc-artboard-body` is `content-visibility: auto`,
// so an artboard outside the viewport is not laid out: its webfont is never requested (the one
// `document.fonts.ready` the shim awaited resolved without it) and its pictures were still on
// the wire when the shim moved it into view and called `page.pdf()` / `page.screenshot()` at
// once.
//
// `export-offscreen-artboard-assets.test.ts` drives the same thing through the real studio, but
// on loopback a font and a 64 px picture arrive in microseconds and the race almost never loses.
// This fixture makes it lose every time: a canvas-shaped page that mounts its artboards after
// `load` (as React does), with the second section below the 900 px viewport and the ONLY user
// of a webfont and a picture, both served with a delay.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFNumber, type PDFObject, PDFStream } from 'pdf-lib';

import { resolveExportRuntime } from '../exporters/_runtime.ts';

const BIN = join(import.meta.dir, '..', 'bin');
const WOFF2 = readFileSync(
  join(import.meta.dir, '..', 'client', 'fonts', 'inter-latin-wght-normal.woff2')
);
/** A real 8-px-wide PNG (the same bytes export-e2e-lanes uses); it paints saturated blue. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR42mNkYPhfz0BFwDiq' +
    'YVTDsNAAAOKcA/3fzWvKAAAAAElFTkSuQmCC',
  'base64'
);
/** Long enough that no shot taken "at once" can have the asset; short enough for a fast test. */
const ASSET_DELAY_MS = 4000;

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face { font-family: "SlowFace"; src: url("/slow.woff2") format("woff2"); font-display: swap; }
  body { margin: 0; background: #222; }
  .dc-world { position: relative; }
  .dc-artboard { position: absolute; width: 400px; background: #132038; color: #f2efe6; }
  .dc-artboard-body { content-visibility: auto; contain-intrinsic-size: 400px 500px; height: 500px;
    padding: 20px; box-sizing: border-box; font-family: Helvetica, Arial, sans-serif; }
  .slow { font-family: "SlowFace"; font-size: 40px; }
</style></head><body><div class="dc-world" id="world"></div>
<script>
  // Mount after load, as the canvas runtime does — nothing below can delay the load event.
  addEventListener('load', () => setTimeout(() => {
    // kind: plain · rich (webfont + picture) · photo (picture only, the slowest asset)
    const boards = [
      ['a1', 0, 0, 'plain'], ['a2', 440, 0, 'plain'],
      ['b1', 0, 1400, 'rich'], ['b2', 440, 1400, 'rich'], ['b3', 880, 1400, 'photo'],
    ];
    const world = document.getElementById('world');
    for (const [id, left, top, kind] of boards) {
      const art = document.createElement('article');
      art.className = 'dc-artboard';
      art.dataset.dcScreen = id;
      art.style.left = left + 'px';
      art.style.top = top + 'px';
      const pic = '<img src="/slow-' + id + '.png" width="160" height="160" alt="">';
      art.innerHTML = '<div class="dc-artboard-body">' + (kind === 'rich'
        ? '<div class="slow">Gators ' + id + '</div>' + pic
        : kind === 'photo' ? pic : 'Plain ' + id) + '</div>';
      world.appendChild(art);
    }
  }, 0));
</script></body></html>`;

let server: ReturnType<typeof Bun.serve> | null = null;
let out = '';

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'maude-b3-'));
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === '/') return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
      if (pathname === '/slow.woff2' || pathname.startsWith('/slow-')) {
        // b3's picture arrives last, after the font every earlier shot may have waited on.
        await Bun.sleep(pathname === '/slow-b3.png' ? 2 * ASSET_DELAY_MS : ASSET_DELAY_MS);
        return pathname.endsWith('.woff2')
          ? new Response(WOFF2, { headers: { 'content-type': 'font/woff2' } })
          : new Response(PNG, { headers: { 'content-type': 'image/png' } });
      }
      return new Response('nope', { status: 404 });
    },
  });
});

afterAll(() => {
  server?.stop(true);
  rmSync(out, { recursive: true, force: true });
});

async function runShim(shim: string, dir: string): Promise<void> {
  const runtime = resolveExportRuntime();
  const proc = Bun.spawn(
    [
      runtime.cmd,
      join(BIN, shim),
      '--url',
      `http://127.0.0.1:${server?.port}/`,
      '--multi',
      '1',
      '--out-dir',
      dir,
      '--timeout',
      '30',
    ],
    { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_OPEN: '1' } }
  );
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`${shim} exited ${code}: ${stderr}`);
}

function inventory(resources: PDFObject | undefined): { images: number; fonts: string[] } {
  const res = { images: 0, fonts: [] as string[] };
  if (!(resources instanceof PDFDict)) return res;
  const fonts = resources.lookup(PDFName.of('Font'));
  if (fonts instanceof PDFDict) {
    for (const key of fonts.keys()) {
      const f = fonts.lookup(key);
      if (!(f instanceof PDFDict)) continue;
      const fd = f.lookup(PDFName.of('FontDescriptor'));
      const name =
        f.lookup(PDFName.of('BaseFont')) ??
        (fd instanceof PDFDict ? fd.lookup(PDFName.of('FontName')) : undefined);
      res.fonts.push(name instanceof PDFName ? name.decodeText() : '(unnamed)');
    }
  }
  const xobjects = resources.lookup(PDFName.of('XObject'));
  if (xobjects instanceof PDFDict) {
    for (const key of xobjects.keys()) {
      const xo = xobjects.lookup(key);
      if (!(xo instanceof PDFStream)) continue;
      const sub = xo.dict.lookup(PDFName.of('Subtype'));
      if (sub instanceof PDFName && sub.decodeText() === 'Image') {
        // the 8×8 picture; Chromium's broken-image glyph is 14×16
        const w = xo.dict.lookup(PDFName.of('Width'));
        if (w instanceof PDFNumber && w.asNumber() === 8) res.images += 1;
      } else {
        const inner = inventory(xo.dict.lookup(PDFName.of('Resources')));
        res.images += inner.images;
        res.fonts.push(...inner.fonts);
      }
    }
  }
  return res;
}

describe('capture shims settle an off-screen artboard before the shot', () => {
  test('_pdf-playwright: the second section’s pages carry the picture and the webfont', async () => {
    const dir = join(out, 'pdf');
    await runShim('_pdf-playwright.mjs', dir);
    const got: Record<string, { picture: boolean; webfont: boolean }> = {};
    for (const id of ['b1', 'b2', 'b3']) {
      const doc = await PDFDocument.load(readFileSync(join(dir, `${id}.pdf`)));
      const inv = inventory(doc.getPage(0).node.Resources());
      got[id] = { picture: inv.images > 0, webfont: inv.fonts.some((f) => /Inter/.test(f)) };
    }
    expect(got).toEqual({
      b1: { picture: true, webfont: true },
      b2: { picture: true, webfont: true },
      b3: { picture: true, webfont: false },
    });
  }, 90_000);

  test('_png-playwright: every off-screen artboard has its picture painted', async () => {
    const dir = join(out, 'png');
    await runShim('_png-playwright.mjs', dir);
    // The picture is the only saturated blue on a navy board: find it in each decoded shot.
    // (`page.screenshot` waits for webfonts by itself, which hides the race on b1/b2; b3's
    // picture arrives after that wait, so only a settle before the shot catches it.)
    const got: Record<string, boolean> = {};
    for (const id of ['b1', 'b2', 'b3']) {
      const shot = Bun.file(join(dir, `${id}.png`));
      const { picturePixels } = await countPicturePixels(new Uint8Array(await shot.arrayBuffer()));
      got[id] = picturePixels > 1000;
    }
    expect(got).toEqual({ b1: true, b2: true, b3: true });
  }, 90_000);
});

/** Count the fixture picture's saturated-blue pixels in a decoded PNG shot (8-bit RGB/RGBA). */
async function countPicturePixels(png: Uint8Array): Promise<{ picturePixels: number }> {
  const { inflateSync } = await import('node:zlib');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      const d = new DataView(data.buffer, data.byteOffset);
      w = d.getUint32(0);
      h = d.getUint32(4);
      ct = data[9] as number;
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let picturePixels = 0;
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x += 1) {
      const v = raw[y * (stride + 1) + 1 + x] as number;
      const a = x >= bpp ? (cur[x - bpp] as number) : 0;
      const b = prev[x] as number;
      const c = x >= bpp ? (prev[x - bpp] as number) : 0;
      let p = v;
      if (f === 1) p += a;
      else if (f === 2) p += b;
      else if (f === 3) p += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = p & 0xff;
    }
    for (let x = 0; x < w; x += 1) {
      const r = cur[x * bpp] as number;
      const g = cur[x * bpp + 1] as number;
      const bl = cur[x * bpp + 2] as number;
      if (bl > 120 && r < 80 && g < 80) picturePixels += 1;
    }
    prev.set(cur);
  }
  return { picturePixels };
}
