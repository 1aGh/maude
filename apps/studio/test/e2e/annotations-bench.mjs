// Annotations v2 benchmarks (plan Task 30) — the acceptance gates, measured.
//
//   node apps/studio/test/e2e/annotations-bench.mjs [--sizes 200,1000,5000]
//        [--old-reader <path to the pre-v2 read-annotations.mjs>] [--out <file.json>]
//
// On the same mixed boards (every element kind, nested sections, bound arrows,
// groups — test/fixtures/perf-annotations-mixed.mjs):
//
//   AI read   — `read-annotations` output bytes vs the pre-v2 reader on the same
//               board as legacy SVG (`--old-reader`; extract it with
//               `git show c18014b5:apps/studio/bin/read-annotations.mjs`).
//   AI write  — bytes of a single-element `annotate update` op.
//   Canvas    — load (navigation → every element node drawn), a 30-step drag of
//               one sticky: frame-interval p95, React renders of the layer and
//               of element nodes during the gesture, bytes sent per edit.
//
// Headless timings are noisy; compare deltas against the spread, never one run.
// Servers start with NO_OPEN=1 (no browser window) via the E2E harness.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProject, openCanvas, sleep, startServer } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = join(HERE, '..', '..');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const SIZES = opt('--sizes', '200,1000,5000').split(',').map(Number);
const OLD_READER = opt('--old-reader', null);
const OUT = opt('--out', null);

const { buildMixedStrokes } = await import('../fixtures/perf-annotations-mixed.mjs');
const { v1ToV2 } = await import('../../annotations/migrate-v1.ts');
const { strokesToSvg } = await import('../../annotations-model.ts');

/** ~tokens: the usual 4 bytes/token rule of thumb for JSON-ish text. */
const tokens = (bytes) => Math.round(bytes / 4);

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function readerBytes(script, root) {
  const r = spawnSync('bun', [script, 'ui/Board.tsx', '--root', root], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`${script}: ${r.stderr}`);
  return Buffer.byteLength(r.stdout);
}

function aiBench(n, elements, strokes) {
  const v2root = makeProject({ board: elements });
  const out = { v2ReadBytes: readerBytes(join(STUDIO, 'bin', 'read-annotations.mjs'), v2root) };
  if (OLD_READER) {
    const v1root = mkdtempSync(join(tmpdir(), 'maude-ann-bench-v1-'));
    mkdirSync(join(v1root, '.design', 'ui'), { recursive: true });
    writeFileSync(join(v1root, '.design', 'ui-board.annotations.svg'), strokesToSvg(strokes));
    out.v1ReadBytes = readerBytes(OLD_READER, v1root);
    out.readRatio = +(out.v1ReadBytes / out.v2ReadBytes).toFixed(2);
  }
  const sticky = elements.find((e) => e.type === 'sticky');
  const update = JSON.stringify({ op: 'update', id: sticky.id, text: 'Ship it' });
  out.writeOpBytes = Buffer.byteLength(update);
  out.writeOpTokens = tokens(out.writeOpBytes);
  console.error(`[bench ${n}] AI read ${out.v2ReadBytes} B (v1 ${out.v1ReadBytes ?? '—'} B)`);
  return out;
}

async function canvasBench(n, elements) {
  const root = makeProject({ board: elements });
  const server = await startServer(root);
  const c = await openCanvas(server);
  try {
    const nodes = () => c.frame.evaluate(() => document.querySelectorAll('.dc-annot-el').length);
    // Load: a fresh navigation until every element node is drawn.
    await c.frame.evaluate(() => {
      window.__benchStale = true;
    });
    const t0 = Date.now();
    await c.page.reload({ waitUntil: 'domcontentloaded' });
    let frame = null;
    while (Date.now() - t0 < 60_000) {
      frame = c.page.frames().find((f) => f.url().includes('_canvas-shell')) ?? null;
      const count = frame
        ? await frame
            .evaluate(() =>
              window.__benchStale ? -1 : document.querySelectorAll('.dc-annot-el').length
            )
            .catch(() => 0)
        : 0;
      if (count >= elements.length * 0.95) break;
      await sleep(50);
    }
    const loadMs = Date.now() - t0;
    c.frame = frame;
    await sleep(800);
    const frameBox = await c.page.locator('[data-testid="canvas-frame"]').boundingBox();
    await c.page.mouse.dblclick(frameBox.x + 12, frameBox.y + frameBox.height - 12);
    await sleep(800);
    // The biggest visible top-level sticky.
    const target = await frame.evaluate(() => {
      let best = null;
      for (const el of document.querySelectorAll('.dc-annot-el[data-type="sticky"]')) {
        const r = el.getBoundingClientRect();
        if (r.width > 6 && r.top > 0 && r.left > 0 && (!best || r.width > best.w)) {
          best = {
            id: el.getAttribute('data-id'),
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
            w: r.width,
          };
        }
      }
      return best;
    });
    if (!target) throw new Error('no visible sticky to drag');
    const from = [target.x + frameBox.x, target.y + frameBox.y];
    const sent = [];
    c.page.on('request', (req) => {
      if (req.url().includes('/_api/annotations/ops') && req.method() === 'POST') {
        sent.push(Buffer.byteLength(req.postData() ?? ''));
      }
    });
    await frame.evaluate(() => {
      window.__dcPerf = { artboardRenders: 0, annotationRenders: 0, annotationNodeRenders: 0 };
      window.__benchFrames = [];
      let last = performance.now();
      const tick = (t) => {
        window.__benchFrames.push(t - last);
        last = t;
        if (window.__benchOn) requestAnimationFrame(tick);
      };
      window.__benchOn = true;
      requestAnimationFrame(tick);
    });
    await c.page.mouse.move(from[0], from[1]);
    await c.page.mouse.down();
    for (let i = 1; i <= 30; i++) {
      await c.page.mouse.move(from[0] + i * 4, from[1] + i * 2);
      await sleep(16);
    }
    const during = await frame.evaluate(() => ({ ...window.__dcPerf }));
    await c.page.mouse.up();
    const frames = await frame.evaluate(() => {
      window.__benchOn = false;
      return window.__benchFrames.slice(1);
    });
    await sleep(1500);
    return {
      nodes: await nodes(),
      loadMs,
      dragP95FrameMs: +(pct(frames, 95) ?? 0).toFixed(1),
      dragLayerRenders: during.annotationRenders,
      dragNodeRenders: during.annotationNodeRenders,
      bytesPerEdit: sent.length ? sent[sent.length - 1] : null,
      editsSent: sent.length,
    };
  } finally {
    await c.close();
    server.stop();
  }
}

const results = [];
for (const n of SIZES) {
  const strokes = buildMixedStrokes(n);
  const elements = v1ToV2(strokes).elements;
  const row = { size: n, elements: elements.length, ...aiBench(n, elements, strokes) };
  Object.assign(row, await canvasBench(n, elements));
  console.error(`[bench ${n}]`, JSON.stringify(row));
  results.push(row);
}
const report = { date: new Date().toISOString(), results };
console.log(JSON.stringify(report, null, 2));
if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
