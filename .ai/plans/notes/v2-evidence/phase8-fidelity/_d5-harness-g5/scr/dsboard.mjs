// IMPL for ds-board-*: the converted system's own Design system canvas rendered 1:1 (all artboards, like the spec),
// through the capture origin, in each app theme. The in-app frame of the same state is the plain `<id>-<theme>.png`.
import { boot, playwright, scratchProject, sleep, REPO } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(REPO, '.scr/impl/13-design-system');
mkdirSync(OUT, { recursive: true });
const { scratch, project } = scratchProject(join(REPO, '.scr/fx-cache/ds-converted'), true);
const s = await boot(project, scratch, {}, { theme: 'light' });
await sleep(9000); // c7: the usage index warms ~1 s after boot and persists after a 2 s debounce
const browser = await playwright.chromium.launch();
const JOBS = [
  ['ds-board-studio', 'system/maude-v2/design-system.tsx', false],
  ['ds-board-dark', 'system/maude-v2/design-system.tsx', true],
  ['ds-board-gator', 'system/maude/design-system.tsx', false],
];
try {
  for (const theme of ['light', 'dark']) {
    for (const [id, rel, sysDark] of JOBS) {
      const ctx = await browser.newContext({ viewport: { width: 3100, height: 3000 } });
      const page = await ctx.newPage();
      await page.goto(`${s.url}/_canvas-shell.html?canvas=${encodeURIComponent(rel)}`);
      await page.waitForSelector('[data-dc-screen]', { timeout: 40000 });
      await sleep(5000);
      if (theme === 'light') { await page.evaluate(() => { document.documentElement.dataset.maudeTheme = 'light'; }); await sleep(2500); }
      if (sysDark) { await page.locator('[data-testid="ds-bar-mode-dark"]').first().click().catch(() => {}); await sleep(2000); }
      await page.evaluate(() => { window.__g5orig = document.querySelector('.dc-world').style.cssText; });
      const box = await page.evaluate(() => {
        const world = document.querySelector('.dc-world');
        const z = parseFloat(world.style.zoom) || 1;
        const vp = window.__maudeViewport();
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const a of document.querySelectorAll('[data-dc-screen]')) {
          const r = a.getBoundingClientRect();
          x0 = Math.min(x0, (r.x - vp.x) / z); y0 = Math.min(y0, (r.y - vp.y) / z - 30);
          x1 = Math.max(x1, (r.right - vp.x) / z); y1 = Math.max(y1, (r.bottom - vp.y) / z);
        }
        world.style.zoom = '1'; world.style.setProperty('--dc-zoom', '1');
        world.style.transform = `translate(${40 - x0}px, ${40 - y0}px)`;
        return { w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
      });
      await sleep(900);
      await page.screenshot({ path: join(OUT, `${id}-${theme}.crop.png`), clip: { x: 40, y: 40, width: Math.min(box.w, 3000), height: Math.min(box.h, 2900) } });
      console.log('board', id, theme, JSON.stringify(box));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  s.stop();
}
process.exit(0);
