// r1 (Michal's rc.1 findings, package D1) — the canvas tools in a REAL browser: Chromium's own hit-testing, focus and
// pointer travel, which happy-dom cannot model (every one of these bugs was green in unit tests).
//
//   node --test apps/studio/test/e2e/canvas-tools.e2e.mjs
//
//   T8a  the Pen closes on a press on its first point (the anchor square used to swallow it) → a `Z` path
//   T8b  …and on "Click here to close"; the finished path has a visible stroke on a canvas with no --accent
//   T11  F's size picker stays open while the pointer travels from the toolbar into it; a canvas click still closes it
//   T12  an object dragged off its artboard (clipped there) is dragged back by its box
//   T15  ⌥-drag drops a copy where it lands, the original stays; ⌘D copies; each is one ⌘Z

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';

import { e2eProjectConfig, sleep, startServer } from './harness.mjs';

const CANVAS = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";
export default function Board() {
  return (
    <DesignCanvas>
      <DCArtboard id="a4" label="A4" width={595} height={842} fixed kind="print" print={{ paper: 'a4' }}>
        <div data-cd-id="body" style={{ position: "relative", width: 595, height: 842 }}>
          <div data-cd-id="rect" data-shape="rect" style={{ position: "absolute", left: "100px", top: "100px", width: "120px", height: "80px", background: "var(--accent, currentColor)" }} />
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

let server;
let browser;
let root;

async function open() {
  root = mkdtempSync(join(tmpdir(), 'maude-canvas-tools-e2e-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), JSON.stringify(e2eProjectConfig('tools')));
  writeFileSync(join(root, '.design', 'ui', 'Board.tsx'), CANVAS);
  writeFileSync(
    join(root, '.design', 'ui', 'Board.meta.json'),
    JSON.stringify({ layout: { artboards: [{ id: 'a4', x: 0, y: 0 }] } })
  );
  server = await startServer(root);
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mdcc-usage-tour-seen', '1');
      localStorage.setItem('mdcc-collab-tour-seen', '1');
    } catch {}
  });
  await page.goto(`http://localhost:${server.port}/?open=ui/Board.tsx`, {
    waitUntil: 'domcontentloaded',
  });
  const frame = () => page.frames().find((f) => f.url().includes('_canvas-shell'));
  await waitFor(
    () => frame()?.evaluate(() => !!document.querySelector('[data-cd-id="rect"]')),
    'the canvas mounted'
  );
  await sleep(1200);
  const fb = await page.locator('[data-testid="canvas-frame"]').boundingBox();
  const box = (sel) =>
    frame().evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return {
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      };
    }, sel);
  const P = (x, y) => ({ x: fb.x + x, y: fb.y + y });
  const src = () => readFileSync(join(root, '.design', 'ui', 'Board.tsx'), 'utf8');
  return { page, frame, box, P, src, close: () => ctx.close() };
}

async function waitFor(fn, what, ms = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve()
      .then(fn)
      .catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(150);
  }
}

const rects = (s) => (s.match(/data-shape="rect"[^>]*/g) ?? []).map((l) => l);
const leftOf = (s, id) =>
  new RegExp(`data-cd-id="${id}"[^>]*left: "(-?[\\d.]+)px"`).exec(s)?.[1] ?? null;

async function click(c, x, y) {
  const p = c.P(x, y);
  await c.page.mouse.click(p.x, p.y);
}

async function drag(c, from, to, { alt = false } = {}) {
  const a = c.P(from.x, from.y);
  const b = c.P(to.x, to.y);
  if (alt) await c.page.keyboard.down('Alt');
  await c.page.mouse.move(a.x, a.y);
  await c.page.mouse.down();
  await c.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 10 });
  await c.page.mouse.move(b.x, b.y, { steps: 10 });
  await c.page.mouse.up();
  if (alt) await c.page.keyboard.up('Alt');
}

/** Arm the Pen and lay three points; resolves the first point (frame px). */
async function drawThree(c) {
  const slot = await c.box('[data-testid="toolbar-slot-el-pen"]');
  await click(c, slot.cx, slot.cy);
  await waitFor(
    () => c.frame().evaluate(() => !!document.querySelector('[data-testid="edit-pen-input"]')),
    'the Pen armed'
  );
  await sleep(600);
  const body = await c.box('[data-dc-screen="a4"] .dc-artboard-body');
  const pts = [
    { x: body.x + 300, y: body.y + 300 },
    { x: body.x + 400, y: body.y + 300 },
    { x: body.x + 400, y: body.y + 400 },
  ];
  // the first press can land while the frame settles: lay the first point until it is drawn
  await waitFor(async () => {
    await click(c, pts[0].x, pts[0].y);
    await sleep(200);
    return c.frame().evaluate(() => document.querySelectorAll('.ed-pen-pt').length >= 1);
  }, 'the first point');
  for (const p of pts.slice(1)) {
    await click(c, p.x, p.y);
    await sleep(150);
  }
  assert.equal(
    await c.frame().evaluate(() => document.querySelectorAll('.ed-pen-pt').length),
    3,
    'three points drawn'
  );
  return pts[0];
}

describe('r1 D1 — canvas tools in a real browser', () => {
  before(async () => {
    browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
  });
  after(async () => {
    await browser?.close();
  });

  test('T8a/T8b — the Pen closes on its first point and on its hint; the path has a visible stroke', async () => {
    const c = await open();
    try {
      // a press ON the first point's square
      const first = await drawThree(c);
      const hit = await c
        .frame()
        .evaluate(
          ([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-testid'),
          [first.x, first.y]
        );
      assert.equal(hit, 'edit-pen-input', 'the press on the first point reaches the input layer');
      await click(c, first.x, first.y);
      await waitFor(() => /data-shape="path"/.test(c.src()), 'the closed path reached the file');
      assert.match(c.src(), /<path d="M[^"]*Z"/, 'the path is closed (Z)');
      const stroke = await waitFor(
        () =>
          c.frame().evaluate(() => {
            const s = document.querySelector('svg[data-shape="path"]');
            return s ? getComputedStyle(s).stroke : null;
          }),
        'the path rendered'
      );
      assert.notEqual(stroke, 'none', 'a stroke is drawn on a canvas with no --accent');
      assert.doesNotMatch(stroke, /rgba\(0, 0, 0, 0\)/);

      // the hint: hover the first point, travel onto "Click here to close", press it
      const again = await drawThree(c);
      const p = c.P(again.x + 1, again.y + 1);
      await c.page.mouse.move(p.x, p.y, { steps: 3 });
      const chip = await waitFor(() => c.box('[data-testid="edit-pen-chip-close"]'), 'the hint');
      const onChip = c.P(chip.cx, chip.cy);
      await c.page.mouse.move(onChip.x, onChip.y, { steps: 8 });
      await sleep(150);
      assert.ok(
        await c.box('[data-testid="edit-pen-chip-close"]'),
        'the hint stays under the pointer'
      );
      await c.page.mouse.down();
      await c.page.mouse.up();
      await waitFor(
        () => (c.src().match(/data-shape="path"/g) ?? []).length === 2,
        'the second path reached the file'
      );
      assert.equal((c.src().match(/<path d="M[^"]*Z"/g) ?? []).length, 2, 'both paths closed');
    } finally {
      await c.close();
      server.stop();
    }
  });

  test('T11 — the F size picker stays open while the pointer moves into it; a canvas click closes it', async () => {
    const c = await open();
    try {
      await click(c, 200, 600);
      await sleep(300);
      const slot = await c.box('[data-testid="toolbar-slot-frame"]');
      await click(c, slot.cx, slot.cy);
      const tile = () =>
        c.page.evaluate(() => {
          const t = document.querySelector('[data-testid^="size-picker-tile-"]');
          const r = t?.closest('.sz')?.getBoundingClientRect();
          return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
        });
      const box = await waitFor(tile, 'the size picker opened');
      await c.page.mouse.move(box.x + box.w / 2, box.y + box.h - 30, { steps: 25 });
      await sleep(600);
      assert.ok(await tile(), 'the picker is still open with the pointer inside it');
      await click(c, 300, 500);
      await waitFor(async () => !(await tile()), 'a click on the canvas closed the picker');
    } finally {
      await c.close();
      server.stop();
    }
  });

  test('T12 — an object dragged off its artboard is dragged back by its box', async () => {
    const c = await open();
    try {
      let r = await c.box('[data-cd-id="rect"]');
      await click(c, r.cx, r.cy);
      await sleep(400);
      await drag(c, { x: r.cx, y: r.cy }, { x: r.cx - 350, y: r.cy });
      await waitFor(() => leftOf(c.src(), 'rect') === '-250', 'the object left the artboard');
      r = await c.box('[data-cd-id="rect"]');
      // the artboard clips it: the browser's own hit-test finds the canvas there
      const hit = await c
        .frame()
        .evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [r.cx, r.cy]);
      assert.match(String(hit), /dc-canvas|dc-world/);
      await drag(c, { x: r.cx, y: r.cy }, { x: r.cx + 350, y: r.cy });
      await waitFor(() => leftOf(c.src(), 'rect') === '100', 'the object came back');
    } finally {
      await c.close();
      server.stop();
    }
  });

  test('T15 — ⌥-drag drops a copy, ⌘D copies, each is one ⌘Z', async () => {
    const c = await open();
    try {
      const r = await c.box('[data-cd-id="rect"]');
      await click(c, r.cx, r.cy);
      await sleep(400);
      await drag(c, { x: r.cx, y: r.cy }, { x: r.cx + 150, y: r.cy + 120 }, { alt: true });
      await waitFor(() => rects(c.src()).length === 2, '⌥-drag made a copy');
      const after = c.src();
      assert.equal((after.match(/<DCArtboard/g) ?? []).length, 1, 'the artboard was not copied');
      assert.equal(leftOf(after, 'rect'), '100', 'the original stayed put');
      assert.match(rects(after)[1], /left: "250px", top: "220px"/, 'the copy landed at the drop');
      await c.page.keyboard.press('Meta+z');
      await waitFor(() => rects(c.src()).length === 1, '⌘Z took the copy back in one step');

      const r2 = await c.box('[data-cd-id="rect"]');
      await click(c, r2.cx, r2.cy);
      await sleep(400);
      await c.page.keyboard.press('Meta+d');
      await waitFor(() => rects(c.src()).length === 2, '⌘D made a copy');
      await c.page.keyboard.press('Meta+z');
      await waitFor(() => rects(c.src()).length === 1, '⌘Z took the ⌘D copy back in one step');
    } finally {
      await c.close();
      server.stop();
    }
  });
});
