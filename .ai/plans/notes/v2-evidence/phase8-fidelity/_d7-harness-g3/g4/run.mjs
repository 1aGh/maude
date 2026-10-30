// usage: node run.mjs <scenario.mjs> [dark,light]
// A scenario exports: fixture() -> project root (a dir that holds .design/), env?, prefs?, page?, prepare?(project, scratch), run(h)
import { readFileSync, rmSync, writeFileSync, cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, openPage, scratchProject, shots, sleep, snap, OUT } from './lib.mjs';

const [scn, themesArg] = process.argv.slice(2);
const themes = (themesArg || 'dark,light').split(',');
const mod = await import(pathToFileURL(resolve(scn)).href);

/** Harness-only: make the fixture read like the board's project (config name + a canvas called Combine-kampan). */
export function alligators(project) {
  const cfgPath = join(project, '.design/config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.name = 'Alligators brand';
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

for (const theme of themes) {
  const src = await mod.fixture();
  const { scratch, project } = scratchProject(src, !!mod.keepState);
  if (!mod.noRename) alligators(project);
  if (mod.prepare) await mod.prepare(project, scratch, theme);
  const s = await boot(project, scratch, mod.env || {}, { theme, ...(mod.prefs || {}) });
  const { browser, page, logs, ctx } = await openPage(s.url, { theme, w: 1440, h: 860, ...(mod.page || {}) });
  await sleep(2500);
  for (const t of mod.keepNotices ? [] : ['notice-whats-new-1.9.1']) {
    const x = page.locator(`[data-testid="${t}"] button.maude-notice-close`).first();
    if (await x.count()) await x.click({ timeout: 1500 }).catch(() => {});
  }
  const h = {
    page, ctx, theme, sleep, project, scratch, url: s.url, logs, server: s, browser,
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
    esc: async (n = 2) => { for (let i = 0; i < n; i++) { await page.keyboard.press('Escape'); await sleep(150); } },
    /** shot <id> for the current theme: full viewport (1440x860) unless {clip} */
    step: async (id, dir, how, fn, opts = {}) => {
      try {
        if (fn) await fn();
        await sleep(500);
        if (!opts.notice) {
          for (const b of await page.locator('[data-testid^="notice-"] button.maude-notice-close, [data-testid^="callout-"][data-testid$="-dismiss"]').all()) await b.click({ timeout: 800 }).catch(() => {});
          await sleep(1200);
          for (const b of await page.locator('[data-testid^="notice-"] button.maude-notice-close, [data-testid^="callout-"][data-testid$="-dismiss"]').all()) await b.click({ timeout: 800 }).catch(() => {});
          await sleep(300);
        }
        await snap(page, `${dir}/${id}-${theme}`, '', how, opts);
        console.log('ROW', JSON.stringify({ id, theme, how }));
      } catch (e) {
        console.log('FAIL', id, String(e.message).split('\n')[0]);
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
