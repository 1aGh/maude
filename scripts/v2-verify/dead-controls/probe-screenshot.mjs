// Focused probe (p8-sweep-leftovers): what does Attach › "Paste a screenshot" do in the crawler's Tauri mode?
// node scripts/v2-verify/dead-controls/probe-screenshot.mjs [--browser]
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tauriStub } from './crawl.mjs';
import { bootRig, STUDIO } from './rig.mjs';

const { chromium } = createRequire(join(STUDIO, 'package.json'))('playwright');
const tauri = !process.argv.includes('--browser');
const rig = await bootRig({ portBase: 48799 });
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  if (tauri) await ctx.addInitScript(tauriStub(null));
  const page = await ctx.newPage();
  page.on(
    'console',
    (m) => m.type() === 'error' && console.log('console.error', m.text().slice(0, 200))
  );
  await page.goto(rig.projectUrl);
  await page.waitForTimeout(4000);
  await page
    .click('[data-testid="panel-icon-assistant"]')
    .catch((e) => console.log('no assistant', e.message));
  await page.waitForTimeout(1500);
  await page
    .click('[data-testid="ai-attach-clip"]')
    .catch((e) => console.log('no clip', e.message));
  await page.waitForTimeout(500);
  const t0 = Date.now();
  const read = page.evaluate(async () => {
    const t = performance.now();
    try {
      const it = await navigator.clipboard.read();
      return { ok: true, n: it.length, ms: performance.now() - t, types: it.map((i) => i.types) };
    } catch (e) {
      return { ok: false, err: String(e), ms: performance.now() - t };
    }
  });
  await page
    .click('[data-testid="ai-attach-menu-screenshot"]')
    .catch((e) => console.log('no row', e.message));
  for (const ms of [100, 400, 750, 1500, 3000, 6000]) {
    await page.waitForTimeout(ms - (Date.now() - t0) > 0 ? ms - (Date.now() - t0) : 0);
    const s = await page.evaluate(() => ({
      notice: document.querySelector('[data-testid="ai-attach-notice"]')?.textContent ?? null,
      menuOpen: !!document.querySelector('[data-testid="ai-attach-menu"]'),
      statuses: document.querySelectorAll('[role=status]').length,
      composer: !!document.querySelector('.ai-ask-chips-wrap'),
    }));
    console.log(`t+${ms}ms`, JSON.stringify(s));
  }
  // the SAME pick again while its notice still shows (what the crawler hits when the line is already up)
  await page.click('[data-testid="ai-attach-clip"]').catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__muts = 0;
    // count only mutations that add or drop the notice line itself
    new MutationObserver((l) => {
      for (const m of l)
        for (const n of [...m.addedNodes, ...m.removedNodes])
          if (
            n.nodeType === 1 &&
            (n.matches?.('[data-testid="ai-attach-notice"]') ||
              n.querySelector?.('[data-testid="ai-attach-notice"]'))
          )
            window.__muts += 1;
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    window.__statusBefore = document.querySelectorAll('[role=status]').length;
  });
  await page
    .click('[data-testid="ai-attach-menu-screenshot"]')
    .catch((e) => console.log('no row 2', e.message));
  await page.waitForTimeout(750);
  console.log(
    'second pick',
    JSON.stringify(
      await page.evaluate(() => ({
        noticeMuts: window.__muts,
        notice: document.querySelector('[data-testid="ai-attach-notice"]')?.textContent ?? null,
      }))
    )
  );
  console.log(
    'direct clipboard.read',
    JSON.stringify(
      await Promise.race([read, new Promise((r) => setTimeout(() => r('pending>6s'), 100))])
    )
  );
} finally {
  await browser.close();
  await rig.stop();
}
