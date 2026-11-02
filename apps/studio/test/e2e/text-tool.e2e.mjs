// r2-text-tool (UX audit rc.1 blocker U01 · D1 · A1 · M6, and D3 · U11) — in a REAL browser, with Chromium's own
// hit-testing and focus: happy-dom cannot say where a click lands or which frame the keys go to.
//
//   node --test apps/studio/test/e2e/text-tool.e2e.mjs
//
//   TT1  T, a click inside the artboard, type "Sharp pencils", esc → the file has that text at the clicked point
//        (left / top in the artboard's px), the app stayed in Edit and no picker opened
//   TT2  after an object is dragged, the Inspector's X / Y read where it is now, not where it was picked

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
      <DCArtboard id="mobile" label="Mobile" width={390} height={844} fixed kind="digital">
        <div data-cd-id="rect" data-shape="rectangle" style={{ position: "absolute", left: "57px", top: "286px", width: "120px", height: "80px", background: "var(--accent, currentColor)" }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

let server;
let browser;
let root;

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

async function open() {
  root = mkdtempSync(join(tmpdir(), 'maude-text-tool-e2e-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), JSON.stringify(e2eProjectConfig('text')));
  writeFileSync(join(root, '.design', 'ui', 'Board.tsx'), CANVAS);
  writeFileSync(
    join(root, '.design', 'ui', 'Board.meta.json'),
    JSON.stringify({ layout: { artboards: [{ id: 'mobile', x: 0, y: 0 }] } })
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
      const body = e.closest('.dc-artboard-body') ?? e;
      const k = body.offsetWidth ? body.getBoundingClientRect().width / body.offsetWidth : 1;
      return {
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        k,
      };
    }, sel);
  const P = (x, y) => ({ x: fb.x + x, y: fb.y + y });
  const src = () => readFileSync(join(root, '.design', 'ui', 'Board.tsx'), 'utf8');
  const mode = () =>
    page.evaluate(
      () =>
        document
          .querySelector('[data-testid^="palette-mode-"][aria-pressed="true"]')
          ?.getAttribute('data-testid') ?? null
    );
  return { page, frame, box, P, src, mode, close: () => ctx.close() };
}

const px = (s, id, prop) =>
  new RegExp(`data-cd-id="${id}"[^>]*?${prop}: "(-?[\\d.]+)px"`).exec(s)?.[1] ?? null;

describe('r2 — the Text tool types, the Inspector follows', () => {
  before(async () => {
    browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
  });
  after(async () => {
    await browser?.close();
  });

  test('TT1 — T, click, type "Sharp pencils", esc: the text is in the file where the click was; Edit stays Edit', async () => {
    const c = await open();
    try {
      assert.equal(await c.mode(), 'palette-mode-edit', 'starts in Edit');
      const body = await c.box('[data-dc-screen="mobile"] .dc-artboard-body');
      // the keyboard picks the tool the way a person does: focus is on the canvas
      await c.page.mouse.click(
        c.P(body.x + 300, body.y + 700).x,
        c.P(body.x + 300, body.y + 700).y
      );
      await sleep(300);
      await c.page.keyboard.press('t');
      await waitFor(
        () =>
          c
            .frame()
            .evaluate(
              () =>
                document
                  .querySelector('[data-testid="toolbar-slot-el-text"]')
                  ?.getAttribute('aria-pressed') === 'true'
            ),
        'Text armed'
      );
      const at = { x: body.x + 120 * body.k, y: body.y + 500 * body.k };
      const p = c.P(at.x, at.y);
      await c.page.mouse.click(p.x, p.y);
      // no wait for the caret: a person types straight away
      await c.page.keyboard.type('Sharp pencils', { delay: 30 });
      await waitFor(
        () =>
          c.frame().evaluate(() => document.activeElement?.classList.contains('dc-text-editing')),
        'the text is open for typing'
      );
      await c.page.keyboard.press('Escape');
      await waitFor(
        () => /<p [^>]*>Sharp pencils<\/p>/.test(c.src()),
        'the typed words reached the file'
      );
      const s = c.src();
      const id = /<p data-cd-id="([^"]+)"[^>]*>Sharp pencils<\/p>/.exec(s)?.[1];
      assert.ok(id, `a text object holds the words:\n${s}`);
      assert.ok(
        Math.abs(Number(px(s, id, 'left')) - 120) <= 2,
        `left near 120, got ${px(s, id, 'left')}`
      );
      assert.ok(
        Math.abs(Number(px(s, id, 'top')) - 500) <= 2,
        `top near 500, got ${px(s, id, 'top')}`
      );
      assert.equal(await c.mode(), 'palette-mode-edit', 'no letter crossed to Preview');
      assert.equal(
        await c
          .frame()
          .evaluate(() => !!document.querySelector('[data-testid^="toolbar-popover-st"]')),
        false,
        'no sticker / sticky picker opened'
      );
      // GD-10 — never the browser serif
      const family = await c
        .frame()
        .evaluate(
          (sel) => getComputedStyle(document.querySelector(sel)).fontFamily,
          `[data-cd-id="${id}"]`
        );
      assert.doesNotMatch(String(family), /^"?Times/i, `font is ${family}`);
    } finally {
      await c.close();
      server.stop();
    }
  });

  test('TT2 — after a drag the Inspector X / Y read the object where it is now', async () => {
    const c = await open();
    try {
      const r = await c.box('[data-cd-id="rect"]');
      const a = c.P(r.cx, r.cy);
      await c.page.mouse.click(a.x, a.y);
      const xField = () =>
        c.page.evaluate(() => {
          const read = (id) => document.querySelector(`[data-testid="${id}"] input`)?.value ?? null;
          return [read('insp-num-x'), read('insp-num-y')];
        });
      await waitFor(async () => (await xField())[0] === '57', 'the Inspector shows X 57');
      // the audit's move: below the artboard (844 px tall), where the guide read 846
      const dy = 560 * r.k;
      const b = c.P(r.cx, r.cy + dy);
      await c.page.mouse.move(a.x, a.y);
      await c.page.mouse.down();
      await c.page.mouse.move(a.x, (a.y + b.y) / 2, { steps: 10 });
      await c.page.mouse.move(b.x, b.y, { steps: 10 });
      await c.page.mouse.up();
      await waitFor(() => px(c.src(), 'rect', 'top') === '846', 'the move reached the file');
      const [x, y] = await waitFor(async () => {
        const v = await xField();
        return v[1] === '846' ? v : null;
      }, 'the Inspector Y follows the drag');
      assert.equal(x, '57');
      assert.equal(y, '846');
      // a nudge (⇧↓ = 10 px) and its undo: the Inspector follows both
      await c.page.keyboard.press('Shift+ArrowDown');
      await waitFor(async () => (await xField())[1] === '856', 'the Inspector Y follows the nudge');
      await waitFor(() => px(c.src(), 'rect', 'top') === '856', 'the nudge reached the file');
      await c.page.keyboard.press('Meta+z');
      await waitFor(async () => (await xField())[1] === '846', 'the Inspector Y follows the undo');
    } finally {
      await c.close();
      server.stop();
    }
  });
});
