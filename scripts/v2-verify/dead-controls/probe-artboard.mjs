// Focused probe (p8-sweep-leftovers): an artboard label after Edit › Select all annotations (browser mode).
// node scripts/v2-verify/dead-controls/probe-artboard.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bootRig, STUDIO } from './rig.mjs';

const { chromium } = createRequire(join(STUDIO, 'package.json'))('playwright');
const rig = await bootRig({ portBase: 48839 });
const browser = await chromium.launch({ headless: true });
const snap = async (page) => {
  const canvas = page.frames().find((f) => f !== page.mainFrame() && /_canvas-shell/.test(f.url()));
  const shell = await page.evaluate(() => ({
    inspector: (document.querySelector('[data-testid="inspector"]')?.textContent ?? '').slice(
      0,
      80
    ),
    active: document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName,
  }));
  const frame = canvas
    ? await canvas
        .evaluate(() => ({
          rings: document.querySelectorAll(
            '[data-dc-selected],.dc-sel-ring,.dc-artboard-ring,[data-ring]'
          ).length,
          annotSel: document.querySelectorAll('[data-annot-selected],[data-selected="true"]')
            .length,
          label: !!document.querySelector('.dc-artboard-label'),
          labels: [...document.querySelectorAll('.dc-artboard-label')].map((l) =>
            l.getAttribute('aria-label')
          ),
        }))
        .catch((e) => String(e))
    : 'no canvas frame';
  return { shell, frame };
};
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await page.goto(rig.projectUrl);
  for (let i = 0; i < 30 && !page.frames().some((f) => /_canvas-shell/.test(f.url())); i++) {
    if (i === 6) await page.click('[data-testid^="canvas-row-"]').catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);
  console.log('loaded', JSON.stringify(await snap(page)));
  await page.click('[data-testid="project-pill"]');
  await page.waitForTimeout(300);
  await page.click('[data-testid="project-menu-row-sub-edit"]');
  await page.waitForTimeout(300);
  await page.click('[data-testid="project-menu-row-select.all-annotations"]');
  await page.waitForTimeout(1000);
  console.log('after select-all-annotations', JSON.stringify(await snap(page)));
  const canvas = page.frames().find((f) => f !== page.mainFrame() && /_canvas-shell/.test(f.url()));
  const loc = canvas.locator('.dc-artboard-label[aria-label="Artboard Desktop"]').first();
  console.log('label count', await loc.count());
  const r = await loc.click({ timeout: 3000 }).then(
    () => 'clicked',
    (e) => `click failed: ${String(e.message).split('\n').slice(0, 3).join(' | ')}`
  );
  await page.waitForTimeout(1000);
  console.log(r, JSON.stringify(await snap(page)));
  await loc.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1000);
  console.log('second click', JSON.stringify(await snap(page)));
} finally {
  await browser.close();
  await rig.stop();
}
