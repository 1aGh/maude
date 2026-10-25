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
    // C7: the left panel open on one of its tabs (layers | assets | tree) — the boards draw Layers beside an object
    leftTab: async (id = 'layers') => {
      if (!(await page.locator(`[data-testid="panel-tab-${id}"]`).count())) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(700); }
      await page.locator(`[data-testid="panel-tab-${id}"]`).first().click().catch(() => {}); await sleep(700);
    },
    // C7: the page taller for ONE shot (a close-up of the whole inspector card), then back
    tall: async (h2 = 1500) => { const s = page.viewportSize(); await page.setViewportSize({ width: s.width, height: h2 }); await sleep(900); return s; },
    short: async (s) => { await page.setViewportSize(s); await sleep(700); },
    inspector: async (on = true) => {
      const has = (await page.locator('[data-testid="inspector-panel"]').count()) > 0;
      if (has !== on) { await page.locator('[data-testid="panel-icon-right"]').first().click().catch(() => {}); await sleep(700); }
    },
    ai: async (on = true) => { const vis = await page.locator('[data-testid="ai-chat-island"]').first().isVisible().catch(() => false); if (vis !== on) { await page.locator('[data-testid="panel-icon-assistant"]').first().click().catch(() => {}); await sleep(900); } },
    box: async (sel) => fr.locator(sel).first().boundingBox(),
    ctr: async (sel) => { const b = await fr.locator(sel).first().boundingBox(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, b } : null; },
    // D3: pressed by coordinates (a Playwright .click() on the label can wait out its actionability check)
    label: async (id) => { const c = await k.ctr(`[data-dc-screen="${id}"] .dc-artboard-label`); await page.mouse.click(c.x - c.b.width / 2 + 12, c.y); await sleep(900); },
    click: async (sel, opts = {}) => {
      const c = await k.ctr(sel);
      const mods = opts.modifiers || [];
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.click(c.x, c.y, opts.button ? { button: opts.button } : {});
      for (const m of mods) await page.keyboard.up(m);
      await sleep(700);
      return c;
    },
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
    // c3-inspect: a point on the artboard's PAGE itself (the hit is the root element, nothing deeper) — a press there
    // is a press on the artboard: it selects it, and its drag moves it.
    pageHit: async (id) => {
      const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
      const pt = await f.evaluate((id) => {
        const art = document.querySelector(`[data-dc-screen="${id}"]`);
        const body = art && art.querySelector('.dc-artboard-body');
        if (!body) return null;
        const r = body.getBoundingClientRect();
        for (let gy = 0.02; gy < 1; gy += 0.03) for (let gx = 0.02; gx < 1; gx += 0.03) {
          const x = r.x + r.width * gx, y = r.y + r.height * gy;
          const el = document.elementFromPoint(x, y);
          if (!el || !body.contains(el)) continue;
          const st = el.closest('[data-cd-id]');
          if (!st) continue;
          const above = st.parentElement && st.parentElement.closest('[data-cd-id]');
          if (!above || !body.contains(above)) return { x, y };
        }
        return null;
      }, id);
      const fb = await page.locator('[data-testid="canvas-frame"]').boundingBox();
      return pt && { x: fb.x + pt.x, y: fb.y + pt.y };
    },
    fit: async () => { await page.keyboard.press('Meta+0'); await sleep(1000); },
    clipOf: async (b, pad = 0) => ({ x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 }),
  };
  return k;
}
