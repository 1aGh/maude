// S8.1b — the real capture (a booted studio + Chromium): a past version and Display P3.
//
//   1. `at:{sha}` exports that version's CSS — the old colour, while the export of now shows the
//      new one — and the version comes from the server's own history store: the working tree,
//      the index and HEAD are exactly as they were. The main origin still 307s the shell, sha
//      intact, to the capture origin (V2-2.8 L21).
//   2. `colorProfile: 'display-p3'` renders in P3 (an sRGB red becomes P3's (234, 51, 35) — the
//      pixels are converted, not re-tagged) and the PNG / JPG carries a Display P3 ICC profile.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { iccProfileOf, isDisplayP3Icc } from '../exporters/png.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const BASE_ENV = { MAUDE_NO_AUTOBUILD: '1' };

const BOX_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import "./Box.css";

export default function Box() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Box">
        <DCArtboard id="box" label="Box" width={400} height={300}>
          <div className="box" style={{ width: 400, height: 300 }} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const css = (colour: string) => `.box { background: ${colour}; }\n`;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function repo(): { root: string; designRoot: string; sha: string } {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'Box.tsx'), BOX_TSX);
  writeFileSync(join(designRoot, 'ui', 'Box.css'), css('#ff0000'));
  // the studio's own runtime files (`_server.json`, `_canvas-state/`, …) stay out of the comparison
  writeFileSync(join(root, '.gitignore'), '.design/_*\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'red');
  const sha = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(designRoot, 'ui', 'Box.css'), css('#0000ff')); // today: blue, uncommitted
  return { root, designRoot, sha };
}

async function exportV2(port: number, spec: Record<string, unknown>) {
  const r = await fetch(`http://localhost:${port}/_api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      v: 2,
      spec: { v: 2, scope: 'canvas', canvas: 'ui/Box.tsx', unit: 'one', ...spec },
    }),
  });
  const body = new Uint8Array(await r.arrayBuffer());
  if (r.status !== 200) throw new Error(`export ${r.status}: ${new TextDecoder().decode(body)}`);
  return body;
}

/** The RGB of the pixel at the image centre (8-bit RGB/RGBA PNG, every filter type). */
function centrePixel(bytes: Uint8Array): [number, number, number] {
  const buf = Buffer.from(bytes);
  let o = 8;
  let w = 0;
  let h = 0;
  let bpp = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bpp = data[9] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  let line = Buffer.alloc(stride);
  for (let y = 0; y <= Math.floor(h / 2); y++) {
    const p = y * (stride + 1);
    const ft = raw[p];
    line = Buffer.from(raw.subarray(p + 1, p + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const up = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (ft === 1) add = a;
      else if (ft === 2) add = up;
      else if (ft === 3) add = (a + up) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(up - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + up - 2 * c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    prev = line;
  }
  const x = Math.floor(w / 2) * bpp;
  return [line[x], line[x + 1], line[x + 2]];
}

const near = (got: number[], want: number[], tol = 3) =>
  got.every((v, i) => Math.abs(v - want[i]) <= tol);

describe('S8.1b — exporting a past version and Display P3, captured for real', () => {
  test("a past version exports its own CSS on the capture origin; the tree, index and HEAD don't move", async () => {
    const { root, designRoot, sha } = repo();
    const port = nextPort();
    const proc = await bootServer(root, port, BASE_ENV);
    try {
      const statusBefore = git(root, 'status', '--porcelain');
      const indexBefore = git(root, 'ls-files', '-s');

      // the main origin still sends the shell, sha intact, to the capture origin
      const shell = await fetch(
        `http://localhost:${port}/_canvas-shell.html?canvas=ui/Box.tsx&sha=${sha}&hide-chrome=1`,
        { redirect: 'manual' }
      );
      expect(shell.status).toBe(307);
      const loc = new URL(shell.headers.get('location') ?? '');
      expect(loc.origin).not.toBe(`http://localhost:${port}`);
      expect(loc.searchParams.get('sha')).toBe(sha);

      const now = centrePixel(await exportV2(port, { format: 'png' }));
      const then = centrePixel(await exportV2(port, { format: 'png', at: { sha } }));
      expect(near(now, [0, 0, 255])).toBe(true);
      expect(near(then, [255, 0, 0])).toBe(true);

      // nothing was written back: today's file, the working tree and the index are untouched
      expect(readFileSync(join(designRoot, 'ui', 'Box.css'), 'utf8')).toBe(css('#0000ff'));
      expect(git(root, 'status', '--porcelain')).toBe(statusBefore);
      expect(git(root, 'ls-files', '-s')).toBe(indexBefore);
      expect(git(root, 'rev-parse', 'HEAD')).toBe(sha);
    } finally {
      await killProc(proc);
    }
  }, 180_000);

  test('Display P3: P3 pixels, and the PNG and the JPG carry a Display P3 profile', async () => {
    const { root, designRoot } = repo();
    writeFileSync(join(designRoot, 'ui', 'Box.css'), css('#ff0000'));
    const port = nextPort();
    const proc = await bootServer(root, port, BASE_ENV);
    try {
      const srgb = await exportV2(port, { format: 'png' });
      expect(iccProfileOf(srgb, 'png')).toBeNull(); // the default stays an untagged sRGB file
      expect(near(centrePixel(srgb), [255, 0, 0])).toBe(true);

      const p3 = await exportV2(port, { format: 'png', options: { colorProfile: 'display-p3' } });
      const profile = iccProfileOf(p3, 'png');
      expect(profile).not.toBeNull();
      expect(isDisplayP3Icc(profile as Uint8Array)).toBe(true);
      // converted, not re-tagged: sRGB red is (234, 51, 35) in Display P3
      expect(near(centrePixel(p3), [234, 51, 35])).toBe(true);

      const jpg = await exportV2(port, { format: 'jpg', options: { colorProfile: 'display-p3' } });
      const jprofile = iccProfileOf(jpg, 'jpeg');
      expect(jprofile).not.toBeNull();
      expect(isDisplayP3Icc(jprofile as Uint8Array)).toBe(true);
    } finally {
      await killProc(proc);
    }
  }, 180_000);
});
