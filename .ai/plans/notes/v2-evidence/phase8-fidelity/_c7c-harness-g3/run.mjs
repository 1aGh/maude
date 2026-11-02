// usage: node run.mjs <scenario.mjs> [dark,light]
// A scenario exports: fixture(scratch) -> project root (a dir that holds .design/), env?, run(h)
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, openPage, scratchProject, shots, sleep, snap } from './lib.mjs';

const [scn, themesArg] = process.argv.slice(2);
const themes = (themesArg || 'dark,light').split(',');
const mod = await import(pathToFileURL(resolve(scn)).href);
const NOTES = join(import.meta.dirname, process.env.ROWS || 'index-rows.jsonl');

for (const theme of themes) {
  const src = await mod.fixture();
  const { scratch, project } = scratchProject(src, !!mod.keepState);
  if (mod.prepare) await mod.prepare(project, scratch);
  const s = await boot(project, scratch, mod.env || {}, { theme, ...(mod.prefs || {}) });
  const { browser, page, logs } = await openPage(s.url, { theme, ...(mod.page || {}) });
  await sleep(2500);
  // dismiss the one-time notices the server remembers
  for (const t of mod.keepNotices ? [] : ['notice-whats-new-1.9.1']) {
    const x = page.locator(`[data-testid="${t}"] button`).first();
    if (await x.count()) await x.click({ timeout: 1500 }).catch(() => {});
  }
  // stage D: the What's New panel (pending 'next' entries) opens over a fresh project — close it
  if (await page.locator('.help-modal-backdrop').count()) {
    await page.keyboard.press('Escape');
    await sleep(500);
    if (await page.locator('.help-modal-backdrop').count()) await page.locator('.help-modal button[aria-label*="lose" i]').first().click({ timeout: 2000 }).catch(() => {});
    await sleep(400);
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
    skip: (name, why) => { appendFileSync(NOTES, JSON.stringify({ name, theme, reach: 'no', note: why }) + '\n'); console.log('skip', name); },
    esc: async (n = 2) => { for (let i = 0; i < n; i++) { await page.keyboard.press('Escape'); await sleep(150); } },
    step: async (name, state, how, fn, opts = {}) => {
      try {
        if (fn) await fn();
        await sleep(500);
        const before = shots.length;
        const clip = typeof opts.clip === 'function' ? await opts.clip() : opts.clip;
        await snap(page, `${name}-${theme}`, state, how, clip ? { clip } : {});
        appendFileSync(NOTES, JSON.stringify({ name, theme, state, how, reach: opts.reach || 'yes', note: opts.note || '', clip: (typeof opts.clip === 'function' ? 'fn' : opts.clip) || null }) + '\n');
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
