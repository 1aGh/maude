// r2-p6b (P6 — Inspector colour picker, T0–T3) — in a REAL browser, with Chromium's own focus and the Popover API:
// happy-dom cannot say which element holds focus after an esc, nor whether a picked token reached the canvas file.
//
//   node --test apps/studio/test/e2e/inspector-colour.e2e.mjs
//
//   IC1  select a shape, open the Fill chip: focus starts in Search; ↓ enters the swatch grid; esc closes the popover
//        and gives focus back to the chip
//   IC2  pick a role token → the canvas file has `var(--fg-1)` (a token reference, never a hex); reopen → Recent shows it
//        first, and picking Recent writes it again
//   IC3  "+" on an empty fill writes `var(--bg-3, #d4d4d8)` — the slot's role token with its literal fallback,
//        never `currentColor`
//
// Isolation: prefs.json (Recent lives there) and the machine file go to a throwaway dir, never ~/.config/maude.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';

import { sleep, startServer } from './harness.mjs';

const CANVAS = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";
export default function Board() {
  return (
    <DesignCanvas>
      <DCArtboard id="mobile" label="Mobile" width={390} height={844} fixed kind="digital">
        <div data-cd-id="filled" data-shape="rectangle" style={{ position: "absolute", left: "40px", top: "286px", width: "120px", height: "80px", background: "var(--bg-2)" }} />
        <div data-cd-id="empty" data-shape="rectangle" style={{ position: "absolute", left: "220px", top: "286px", width: "120px", height: "80px", border: "1px solid var(--border-default)" }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

// A small two-tone system: the schema's own role names, so the picker groups them (Surfaces · Text · Borders · Accent).
const TOKENS = `:root {
  --bg-0: #ffffff; --bg-1: #f4f4f5; --bg-2: #e4e4e7; --bg-3: #d4d4d8; --bg-4: #a1a1aa;
  --fg-0: #18181b; --fg-1: #52525b; --fg-2: #71717a; --fg-3: #a1a1aa;
  --border-subtle: #e4e4e7; --border-default: #a1a1aa; --border-strong: #52525b;
  --accent: #1e6bff; --accent-hover: #1a5ee0; --accent-fg: #ffffff;
}
`;

let server;
let browser;
let root;
let scratch;

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
  root = mkdtempSync(join(tmpdir(), 'maude-inspector-colour-e2e-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  mkdirSync(join(root, '.design', 'system', 'brand'), { recursive: true });
  writeFileSync(
    join(root, '.design', 'config.json'),
    JSON.stringify({
      name: 'colour',
      formatVersion: 2,
      designRoot: '.design',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      designSystems: [
        { name: 'brand', path: 'system/brand', tokensCssRel: 'system/brand/colors_and_type.css' },
      ],
    })
  );
  writeFileSync(join(root, '.design', 'system', 'brand', 'colors_and_type.css'), TOKENS);
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
    () => frame()?.evaluate(() => !!document.querySelector('[data-cd-id="filled"]')),
    'the canvas mounted'
  );
  await sleep(1200);
  const fb = await page.locator('[data-testid="canvas-frame"]').boundingBox();
  const centre = (id) =>
    frame()
      .evaluate((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, `[data-cd-id="${id}"]`)
      .then((p) => ({ x: fb.x + p.x, y: fb.y + p.y }));
  const select = async (id) => {
    const p = await centre(id);
    await page.mouse.click(p.x, p.y);
    await waitFor(
      () => page.locator('[data-testid="insp-chip-fill"], [data-testid="insp-add-fill"]').count(),
      `the Inspector shows ${id}`
    );
  };
  const src = () => readFileSync(join(root, '.design', 'ui', 'Board.tsx'), 'utf8');
  const style = (id, prop) =>
    new RegExp(`data-cd-id="${id}"[^>]*?${prop}: "([^"]*)"`).exec(src())?.[1] ?? null;
  const active = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return {
        testid: a?.getAttribute?.('data-testid') ?? null,
        label: a?.getAttribute?.('aria-label') ?? null,
        cell: a?.hasAttribute?.('data-cell') ?? false,
        search: a?.getAttribute?.('data-search') === 'true',
      };
    });
  const chip = page.locator('[data-testid="insp-ctl-fill"] button.insp-chip');
  const pop = page.locator('[data-testid="insp-menu-fill"]');
  return { page, frame, select, src, style, active, chip, pop, close: () => ctx.close() };
}

describe('r2-p6b — the Inspector colour picker, in a real browser', () => {
  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'maude-inspector-colour-state-'));
    // Recent is per Mac in prefs.json — keep it in the fixture, never ~/.config/maude
    process.env.MAUDE_UI_PREFS_PATH = join(scratch, 'prefs.json');
    process.env.XDG_CONFIG_HOME = scratch;
    process.env.MAUDE_MACHINE_FILE = join(scratch, 'machine.json');
    browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
  });
  after(async () => {
    await browser?.close();
  });

  test('IC1 — focus starts in Search, ↓ enters the grid, esc closes and refocuses the chip', async () => {
    const c = await open();
    try {
      await c.select('filled');
      await c.chip.click();
      await c.pop.waitFor({ state: 'visible' });
      await waitFor(
        async () => (await c.active()).testid === 'insp-pop-search-fill',
        'focus starts in Search'
      );
      await c.page.keyboard.press('ArrowDown');
      await waitFor(async () => (await c.active()).cell, '↓ moved focus into the swatch grid');
      await c.page.keyboard.press('Escape');
      await c.pop.waitFor({ state: 'detached' });
      const a = await c.active();
      assert.equal(a.label, 'Fill', `esc gave focus back to the chip, got ${JSON.stringify(a)}`);
      // the shape itself was not touched
      assert.equal(c.style('filled', 'background'), 'var(--bg-2)');
    } finally {
      await c.close();
      server.stop();
    }
  });

  test('IC2 — a role token is written as var(--…); Recent shows it on reopen', async () => {
    const c = await open();
    try {
      await c.select('filled');
      await c.chip.click();
      await c.pop.waitFor({ state: 'visible' });
      // nothing used yet: no Recent row
      assert.equal(await c.page.locator('[data-testid="insp-pop-recent-fill"]').count(), 0);
      await c.page.locator('[data-testid="insp-color-fill-fg-1"]').click();
      await waitFor(() => c.style('filled', 'background') === 'var(--fg-1)', 'var(--fg-1) written');
      assert.doesNotMatch(c.src(), /data-cd-id="filled"[^>]*background: "#/, 'no raw hex written');
      // the popover puts itself away after a pick; reopen
      await c.pop.waitFor({ state: 'detached' });
      await c.chip.click();
      await c.pop.waitFor({ state: 'visible' });
      const recent = c.page.locator('[data-testid="insp-recent-fill-0"]');
      await recent.waitFor({ state: 'visible' });
      if (process.env.E2E_SHOTS)
        await c.page.screenshot({
          path: join(process.env.E2E_SHOTS, 'inspector-colour-popover.png'),
        });
      assert.match(
        (await recent.getAttribute('aria-label')) ?? '',
        /Fg 1/,
        'Recent names the token the way the system does'
      );
      // …and it is kept per Mac in prefs.json (the throwaway one), not only in the page
      await waitFor(
        () => /var\(--fg-1\)/.test(readFileSync(process.env.MAUDE_UI_PREFS_PATH, 'utf8')),
        'Recent reached prefs.json'
      );
      // picking a different token, then Recent: the new one is newest, and Recent writes the older one again
      await c.page.locator('[data-testid="insp-color-fill-accent"]').click();
      await waitFor(
        () => c.style('filled', 'background') === 'var(--accent)',
        'var(--accent) written'
      );
      await c.chip.click();
      await c.pop.waitFor({ state: 'visible' });
      await c.page.locator('[data-testid="insp-recent-fill-1"]').click();
      await waitFor(
        () => c.style('filled', 'background') === 'var(--fg-1)',
        'Recent #2 wrote var(--fg-1) again'
      );
    } finally {
      await c.close();
      server.stop();
    }
  });

  test('IC3 — "+" on an empty fill writes var(--bg-3, #d4d4d8), never currentColor', async () => {
    const c = await open();
    try {
      await c.select('empty');
      assert.equal(c.style('empty', 'background'), null, 'starts with no fill');
      await c.page.locator('[data-testid="insp-add-fill"]').click(); // r6: "+" writes the slot default and opens the picker
      await waitFor(
        () => c.style('empty', 'background') === 'var(--bg-3, #d4d4d8)',
        `the slot default was written (got ${c.style('empty', 'background')})`
      );
      assert.doesNotMatch(c.src(), /currentColor/i);
    } finally {
      await c.close();
      server.stop();
    }
  });
});
