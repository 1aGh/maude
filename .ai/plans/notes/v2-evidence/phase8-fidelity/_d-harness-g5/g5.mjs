import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { annotate } from './ann.mjs';
// Helpers shared by the G5 scenarios. `h` is the run.mjs harness.
export function kit(h) {
  const { page, sleep } = h;
  const fr = page.frameLocator('[data-testid="canvas-frame"]');
  const k = {
    fr,
    fold: async () => { await h.click('panel-fold-left').catch(() => {}); await sleep(600); },
    inspector: async (on = true) => {
      const has = (await page.locator('[data-testid="inspector-panel"]').count()) > 0;
      if (has !== on) { await page.locator('[data-testid="panel-icon-right"]').first().click().catch(() => {}); await sleep(700); }
    },
    ai: async (on = true) => { const vis = await page.locator('[data-testid="ai-chat-island"]').first().isVisible().catch(() => false); if (vis !== on) { await page.locator('[data-testid="panel-icon-assistant"]').first().click().catch(() => {}); await sleep(900); } },
    box: async (sel) => fr.locator(sel).first().boundingBox(),
    ctr: async (sel) => { const b = await fr.locator(sel).first().boundingBox(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, b } : null; },
    label: async (id) => { await fr.locator(`[data-dc-screen="${id}"] .dc-artboard-label`).first().click(); await sleep(900); },
    click: async (sel, opts = {}) => { const c = await k.ctr(sel); await page.mouse.click(c.x, c.y, opts); await sleep(700); return c; },
    dbl: async (sel) => { const c = await k.ctr(sel); await page.mouse.dblclick(c.x, c.y); await sleep(800); return c; },
    drag: async (from, to, steps = 10, hold = 600) => {
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
      await page.mouse.move(to.x, to.y, { steps });
      await sleep(hold);
    },
    deep: async (sel, n) => {
      await k.click(sel);
      for (let i = 1; i < n; i++) { await k.dbl(sel); }
    },
    seed: async (rel, ops, wait = 2500) => {
      let f; for (let i = 0; i < 40 && !f; i++) { f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url())); if (!f) await sleep(500); }
      const rects = await f.evaluate(() => window.__maudeCanvasRects());
      const rf = join(h.project, '.design', '_rects.json');
      writeFileSync(rf, JSON.stringify(rects));
      const r = annotate(h.project, rel, ops, ['--rects', rf]);
      await sleep(wait);
      try { return JSON.parse(r.stdout).refs || {}; } catch { return {}; }
    },
    fit: async () => { await page.keyboard.press('Meta+0'); await sleep(1000); },
    clipOf: async (b, pad = 0) => ({ x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 }),
  };
  return k;
}
