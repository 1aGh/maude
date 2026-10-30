// usage: node run.mjs <scenario.mjs> [dark,light]
// A scenario exports: fixture(scratch) -> project root (a dir that holds .design/), env?, run(h)
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, openPage, scratchProject, shots, sleep, snap } from './lib.mjs';

const [scn, themesArg] = process.argv.slice(2);
const themes = (themesArg || 'dark,light').split(',');
const mod = await import(pathToFileURL(resolve(scn)).href);
const NOTES = join(import.meta.dirname, 'index-rows.jsonl');

for (const theme of themes) {
  const src = await mod.fixture();
  const { scratch, project } = scratchProject(src, !!mod.keepState);
  if (mod.prepare) await mod.prepare(project, scratch);
  const s = await boot(project, scratch, mod.env || {}, { theme, ...(mod.prefs || {}) });
  const { browser, page, logs } = await openPage(s.url, { theme, ...(mod.page || {}) });
  await sleep(2500);
  // dismiss the one-time notices the server remembers
  for (const t of mod.keepNotices ? [] : ['notice-whats-new-1.9.1']) {
    const x = page.locator(`[data-testid="${t}"] button`).last();
    if (await x.count()) await x.click({ timeout: 1500 }).catch(() => {});
  }
  const h = {
    page, theme, sleep, project, scratch, url: s.url, logs, server: s,
    open: async (slug, ms = 3500) => {
      const cx = page.locator('[data-testid="export-cancel"]').first();
      if (await cx.count()) await cx.click().catch(() => {});
      const row = page.locator(`[data-testid="canvas-row-${slug}"]`).first();
      if (!(await row.count())) {
        const ic = page.locator('[data-testid="panel-icon-left"]').first();
        if (await ic.count()) { await ic.click().catch(() => {}); await sleep(700); }
        const tab = page.locator('[data-testid="panel-tab-tree"]').first();
        if (await tab.count()) { await tab.click().catch(() => {}); await sleep(400); }
      }
      if (!(await row.count())) {
        const inp = page.locator('[data-testid="canvas-search"] input').first();
        if (await inp.count()) { await inp.fill(''); await page.keyboard.press('Escape'); await sleep(500); }
      }
      if (await row.count()) await row.click();
      else {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Meta+k');
        await sleep(500);
        await page.keyboard.type(slug.replace(/^ui-/, ''));
        await sleep(800);
        await page.keyboard.press('Enter');
      }
      await sleep(600);
      await page.locator('[data-testid="canvas-loading"]').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await sleep(ms);
    },
    ftid: (id) => page.frameLocator('[data-testid="canvas-frame"]').locator(`[data-testid="${id}"]`).first(),
    tid: (id) => page.locator(`[data-testid="${id}"]`).first(),
    click: async (id) => {
      const main = page.locator(`[data-testid="${id}"]`).first();
      const loc = (await main.count()) ? main : page.frameLocator('[data-testid="canvas-frame"]').locator(`[data-testid="${id}"]`).first();
      await loc.click({ timeout: 4000 });
      await sleep(500);
    },
    board: async (x = 900, y = 470, ms = 1800) => {
      await page.mouse.click(x, y);
      await sleep(700);
      const c = page.locator('[data-testid="inspector-crumb-0"]').first();
      if (await c.count()) await c.click().catch(() => {});
      await sleep(ms);
    },
    esc: async (n = 2) => { for (let i = 0; i < n; i++) { await page.keyboard.press('Escape'); await sleep(150); } },
    mode: (o) => writeFileSync(join(scratch, 'next-mode'), JSON.stringify(o)),
    // wait for the AI finish moment (the ring's data-fresh, 1.8 s) inside the canvas frame
    fresh: async (timeout = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        for (const fr of page.frames()) {
          if (fr === page.mainFrame()) continue;
          if (await fr.locator('.dc-ai-ring[data-fresh]').count().catch(() => 0)) return true;
        }
        await sleep(60);
      }
      return false;
    },
    step: async (name, state, how, fn, opt = {}) => {
      try {
        if (fn) await fn();
        if (opt.fresh) { const ok = await h.fresh(); if (!ok) console.log('NO FRESH WINDOW', name); }
        else if (!opt.now) await sleep(500);
        const before = shots.length;
        await snap(page, `${name}-${theme}`, state, how);
        appendFileSync(NOTES, JSON.stringify({ name, theme, state, how }) + '\n');
      } catch (e) {
        console.log('FAIL', name, String(e.message).split('\n')[0]);
        appendFileSync(NOTES, JSON.stringify({ name, theme, fail: String(e.message).split('\n')[0] }) + '\n');
      }
    },
  };
  try {
    await mod.run(h);
  } catch (e) {
    console.log('RUN ERROR', e.stack);
  }
  const errs = logs.filter((l) => /pageerror/.test(l));
  if (errs.length) console.log('pageerrors:', errs.slice(0, 5).join(' | '));
  await browser.close().catch(() => {});
  s.stop();
  await sleep(400);
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
}
process.exit(0);
