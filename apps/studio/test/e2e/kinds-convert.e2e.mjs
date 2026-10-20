// S7.25 — Change kind makes a copy + one warning style (08 ak-convert, ak-convert-after, ak-warnings) — browser E2E (node --test).
// Real studio server + real canvas in headless Chromium; assertions on the DOM AND on the canvas file on disk.
//
//   node --test apps/studio/test/e2e/kinds-convert.e2e.mjs
//
//   K1 a layer across the cut puts a mark ("1 thing to check") beside the print artboard's label and stamps the warning on it
//   K2 a hand-typed 1144 A4 landscape is "1 px narrower … (1145 × 816)" with Fix size; a clean A6 has no mark
//   K3 Change kind (artboard.convert-kind through the one edit-op route) makes the A6 BESIDE the post: the post's bytes do not
//      move, the copy renders at the paper's px size, and a layer that lands across its cut puts a mark on it too
//   K4 the same ask with the switch off changes the artboard itself (one request, still a print)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { makeProject, openCanvas, sleep, startServer } from './harness.mjs';

const POST = `<DCArtboard id="ig" label="Oznámení" width={1080} height={1350} fixed kind="digital" background="#16181d">
          <div style={{ position: 'relative', width: 1080, height: 1350, color: '#fff' }}>
            <div style={{ position: 'absolute', left: 80, top: 80, fontSize: 96 }}>COMBINE 1. 10.</div>
            <div style={{ position: 'absolute', left: 940, top: 1200, width: 120, height: 120, background: '#e5484d' }}>QR</div>
          </div>
        </DCArtboard>`;
const CANVAS = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function Board() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Kinds">
        ${POST}
        <DCArtboard id="flag" label="A · přední" width={419} height={581} fixed kind="print" print={{ paper: 'a6', bleedMm: 3 }}>
          <div style={{ position: 'relative', width: 419, height: 581 }}>
            <div style={{ position: 'absolute', left: 332, top: 480, width: 84, height: 84, background: '#222', color: '#fff' }}>QR</div>
            <div style={{ position: 'absolute', left: 40, top: 40 }}>Leták</div>
          </div>
        </DCArtboard>
        <DCArtboard id="clean" label="Čistý" width={419} height={581} fixed kind="print" print={{ paper: 'a6', bleedMm: 3 }}>
          <div style={{ position: 'absolute', left: 60, top: 60 }}>Uvnitř</div>
        </DCArtboard>
        <DCArtboard id="karta" label="Arch 1" width={1144} height={816} fixed kind="print" print={{ paper: 'a4', orientation: 'landscape', bleedMm: 3 }}>
          <div style={{ position: 'absolute', left: 80, top: 80 }}>Karta</div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

let server;
let c;
const canvasFile = () => join(server.root, '.design', 'ui', 'Board.tsx');

before(async () => {
  const root = makeProject();
  writeFileSync(join(root, '.design', 'ui', 'Board.tsx'), CANVAS);
  writeFileSync(
    join(root, '.design', 'ui', 'Board.meta.json'),
    JSON.stringify({ layout: { artboards: [] } })
  );
  server = await startServer(root);
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

const frame = () => c.page.frames().find((f) => f.url().includes('_canvas-shell'));
async function marked(id) {
  return frame().evaluate((artboard) => {
    const el = document.querySelector(`[data-dc-screen="${artboard}"]`);
    if (!el) return null;
    const mark = el.querySelector('[data-testid="artboard-warn-mark"]');
    const raw = el.getAttribute('data-dc-warnings');
    return {
      count: mark ? Number(mark.getAttribute('data-count')) : 0,
      title: mark?.getAttribute('title') ?? null,
      warnings: raw ? JSON.parse(raw) : [],
      width: el.querySelector('.dc-artboard-body')?.offsetWidth ?? 0,
      kind: el.getAttribute('data-dc-kind'),
    };
  }, id);
}
async function until(fn, ms = 10_000) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < ms) {
    v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return v;
}
async function ask(params) {
  return c.page.evaluate(async (p) => {
    const r = await fetch('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: '.design/ui/Board.tsx',
        op: 'artboard.convert-kind',
        targets: [],
        params: p,
      }),
    });
    return r.json();
  }, params);
}

describe('one warning style on the canvas', () => {
  test('K1 a layer across the cut puts the mark on the label and stamps the warning', async () => {
    const m = await until(async () => {
      const x = await marked('flag');
      return x && x.count > 0 ? x : null;
    });
    assert.ok(m, 'the print artboard never got its mark');
    assert.equal(m.count, 1);
    assert.equal(m.title, '1 thing to check');
    assert.equal(m.warnings[0].code, 'crosses-cut');
    assert.equal(m.warnings[0].verb, 'Move inside');
  });

  test('K2 a hand-typed 1144 gets Fix size; a clean A6 has no mark', async () => {
    const karta = await until(async () => {
      const x = await marked('karta');
      return x && x.count > 0 ? x : null;
    });
    assert.ok(karta, 'the 1144 px artboard never got its mark');
    assert.equal(karta.warnings[0].verb, 'Fix size');
    assert.match(
      karta.warnings[0].text,
      /^1 px narrower than A4 landscape with bleed \(1145 × 816\)\.$/
    );
    assert.equal((await marked('clean')).count, 0);
  });
});

describe('Change kind makes a copy', () => {
  test('K3 the A6 lands beside the post; the post keeps every byte', async () => {
    const before = readFileSync(canvasFile(), 'utf8');
    assert.ok(before.includes(POST));
    const r = await ask({ artboard: 'ig', paper: 'a6' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.detail.copy, true);
    const after = readFileSync(canvasFile(), 'utf8');
    assert.ok(after.includes(POST), 'the post changed');
    assert.match(after, /id="ig-a6"[^>]*kind="print"|kind="print"[^>]*id="ig-a6"/);
    const copy = await until(async () => {
      const x = await marked('ig-a6');
      return x && x.width > 0 ? x : null;
    }, 15_000);
    assert.ok(copy, 'the copy never rendered');
    assert.equal(copy.kind, 'print');
    assert.equal(copy.width, 419);
    // the QR sat 120 px from the post's right edge: scaled to the A6 it lands across the cut and the copy says so
    const warned = await until(async () => {
      const x = await marked('ig-a6');
      return x && x.count > 0 ? x : null;
    });
    assert.ok(warned, 'the copy has no mark');
    assert.equal(warned.warnings[0].code, 'crosses-cut');
    assert.equal((await marked('ig')).kind, 'digital');
  });

  test('K4 with the switch off the artboard itself changes', async () => {
    const r = await ask({ artboard: 'clean', paper: 'a5', keepOriginal: false });
    assert.equal(r.ok, false, 'a print is not a fixed size: refused in words');
    assert.match(r.message, /Only a fixed size/);
    const flat = await ask({ artboard: 'ig', paper: 'a5', keepOriginal: false });
    assert.equal(flat.ok, true, JSON.stringify(flat));
    assert.match(readFileSync(canvasFile(), 'utf8'), /<DCArtboard[^>]*id="ig"[^>]*kind="print"/);
  });
});
