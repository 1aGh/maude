// S8.1 — ExportSpec v2 on the EXISTING routes, end to end: a real studio, a real canvas, real
// Chromium captures (through the main origin's 307 to the capture origin — nothing renders on
// the main origin). Proves: `{v:2, spec}` beside the untouched v1 body, JPG output, a world
// `region.rect`, an exact v2 scale, file-name tokens + ` (2)` + no path escape inside the zip,
// one spec = one group job with per-item status, the history row storing the spec, and Export
// again replaying it.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import JSZip from 'jszip';

import { replayExportBody } from '../exporters/replay.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CANVAS_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function Board() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="S8.1">
        <DCArtboard id="a" label="Same" width={400} height={260}>
          <div style={{ background: "#c0392b", height: "100%" }}>A</div>
        </DCArtboard>
        <DCArtboard id="b" label="Same" width={300} height={200}>
          <div style={{ background: "#2c3e50", height: "100%" }}>B</div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

let proc: Subprocess | undefined;
let base = '';

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const pngSize = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
};

async function post(path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const sb = makeSandbox();
  mkdirSync(join(sb.designRoot, 'ui'), { recursive: true });
  writeFileSync(join(sb.designRoot, 'ui', 'Board.tsx'), CANVAS_TSX);
  const port = nextPort();
  proc = await bootServer(sb.root, port);
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  if (proc) await killProc(proc);
});

describe('ExportSpec v2 on /_api/export', () => {
  test('canvas each as JPG: one zip, every file a JPEG, named by the template, deduped', async () => {
    const res = await post('/_api/export', {
      v: 2,
      spec: {
        v: 2,
        scope: 'canvas',
        canvas: 'ui/Board.tsx',
        format: 'jpg',
        options: { nameTemplate: '{artboard} {size}', jpgQuality: 80, size: { scale: 1 } },
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const zip = await JSZip.loadAsync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(['Same 300×200.jpg', 'Same 400×260.jpg']);
    for (const n of names) expect(isJpeg(await zip.files[n]!.async('uint8array'))).toBe(true);
  }, 120_000);

  test('duplicates get (2), and a traversal template never leaves the zip root', async () => {
    const res = await post('/_api/export', {
      v: 2,
      spec: {
        v: 2,
        scope: 'canvas',
        canvas: 'ui/Board.tsx',
        format: 'png',
        options: { nameTemplate: '../../{artboard}', size: { scale: 1 } },
      },
    });
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(['Same (2).png', 'Same.png']);
  }, 120_000);

  test('a selected artboard at an exact 0.5× is one PNG of half its size', async () => {
    const res = await post('/_api/export', {
      v: 2,
      spec: {
        v: 2,
        scope: 'selection',
        canvas: 'ui/Board.tsx',
        selection: { artboards: ['a'] },
        format: 'png',
        options: { size: { scale: 0.5 } },
      },
    });
    expect(res.status).toBe(200);
    // a non-ASCII name rides `filename*` beside an ASCII fallback (RFC 6266)
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Board Same@0.5x.png"; filename*=UTF-8''${encodeURIComponent('Board — Same@0.5x.png')}`
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(isPng(bytes)).toBe(true);
    // artboard `a` is 400×260 plus its 1px frame (402×262, as the v1 capture below measures)
    expect(pngSize(bytes)).toEqual({ w: 201, h: 131 });
  }, 120_000);

  test('a world region.rect captures exactly that rectangle', async () => {
    const res = await post('/_api/export', {
      v: 2,
      spec: {
        v: 2,
        scope: 'canvas',
        canvas: 'ui/Board.tsx',
        region: { rect: { x: 0, y: 0, w: 150, h: 100 } },
        format: 'png',
        options: { size: { scale: 1 } },
      },
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(pngSize(bytes)).toEqual({ w: 150, h: 100 });
  }, 120_000);

  test('the v1 body is untouched', async () => {
    const res = await post('/_api/export', {
      format: 'png',
      scope: 'artboard',
      options: { canvasFile: '.design/ui/Board.tsx', artboardId: 'b', scale: 1 },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="ui-board.png"');
    const v1 = new Uint8Array(await res.arrayBuffer());
    expect(isPng(v1)).toBe(true);
    // the artboard box (its 1px frame included) — the same capture v2 makes of it
    expect(pngSize(v1)).toEqual({ w: 302, h: 202 });
    // a v1 body is never read as v2, and a bad v2 spec never falls back to v1
    const bad = await post('/_api/export', {
      v: 2,
      spec: { v: 2, scope: 'canvas', format: 'png', x: 1 },
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'bad-spec', field: 'x' });
  }, 120_000);
});

describe('ExportSpec v2 on /_api/export-jobs — one group job', () => {
  test('per-item status, the spec on the job and the history row, Export again replays it', async () => {
    const spec = {
      v: 2,
      scope: 'project',
      format: 'jpg',
      options: { size: { scale: 1 }, nameTemplate: '{canvas} {artboard}' },
    };
    const queued = await post('/_api/export-jobs', { v: 2, spec });
    expect(queued.status).toBe(202);
    const { jobId } = (await queued.json()) as { jobId: string };
    let job: Record<string, unknown> | undefined;
    for (let i = 0; i < 240; i++) {
      const list = (await (await fetch(`${base}/_api/export-jobs`)).json()) as {
        jobs: Array<Record<string, unknown>>;
      };
      job = list.jobs.find((j) => j.id === jobId);
      if (job?.status === 'done' || job?.status === 'failed') break;
      await Bun.sleep(500);
    }
    expect(job?.status).toBe('done');
    expect(job?.spec).toEqual(spec);
    expect(job?.items).toEqual([
      { id: 'u1', name: 'Board', status: 'ok', files: ['Board Same.jpg', 'Board Same (2).jpg'] },
    ]);
    const { history } = (await (await fetch(`${base}/_api/export-history`)).json()) as {
      history: Array<Record<string, unknown>>;
    };
    const row = history.find((h) => h.id === jobId);
    expect(row?.spec).toEqual(spec);
    expect(replayExportBody(row ?? {})).toEqual({ v: 2, spec });
  }, 180_000);
});

describe('POST /_api/export-estimate on a real studio', () => {
  test('counts from the index', async () => {
    const res = await post('/_api/export-estimate', {
      spec: { v: 2, scope: 'canvas', canvas: 'ui/Board.tsx', format: 'jpg' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.counts).toEqual({ selection: null, canvas: 2, folder: 2, project: 2 });
    expect(body.files).toBe(2);
  });
});
