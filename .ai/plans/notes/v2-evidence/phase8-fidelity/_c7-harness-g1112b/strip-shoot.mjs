// Renders apps/desktop/src/strip.html (the real tab strip page) with a stubbed Tauri bridge that feeds it a TabStripState.
// usage: node strip-shoot.mjs   → .scr/impl/11-projects-and-navigation/strip-<state>-<theme>.png (1440 x 40 strip; 1440x860 overview)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, playwright, sleep } from './lib.mjs';

const OUT = join(REPO, '.scr/impl/11-projects-and-navigation');
mkdirSync(OUT, { recursive: true });
const tabs = (specs) => specs.map(([label, name, tone, extra = {}]) => ({ label, kind: 'project', name, dot: null, resting: false, closing: false, initial: name[0].toUpperCase(), tone, account: null, place: 'mac', ...extra }));
const W = { initial: 'W', tone: 'b', label: 'Work' };
const states = {
  b: { tabs: tabs([['p-1', 'Studio site', 'yellow'], ['p-2', 'Alligators brand', 'lilac', { account: W }], ['p-3', 'Matchday 2026', 'green', { account: W, dot: 'working' }], ['p-4', 'Open studio', 'coral', { dot: 'needs-you' }]]), home: { label: 'home' }, active: 'p-2', overview: false, renaming: null },
  b20: {
    tabs: tabs(Array.from({ length: 20 }, (_, i) => [`p-${i + 1}`, ['Alligators brand', 'Studio site', 'Matchday 2026', 'Portfolio 2026', 'Sponzoři 2027', 'Nábor 2027', 'Open studio', 'Pricing lab', 'Liga ČAAF 2027', 'Plakát-finále'][i % 10] + (i >= 10 ? ' ' + (i - 8) : ''), ['lilac', 'yellow', 'sky', 'green', 'coral', 'grey'][i % 6], i === 4 ? { dot: 'needs-you' } : i === 7 ? { dot: 'done' } : i > 5 ? { resting: true } : {}])),
    home: { label: 'home' }, active: 'p-2', overview: false, renaming: null,
  },
  ai: { tabs: tabs([['p-1', 'Studio site', 'yellow'], ['p-2', 'Alligators brand', 'lilac', { account: W }], ['p-3', 'Matchday 2026', 'green', { account: W, dot: 'working' }], ['p-4', 'Open studio', 'coral', { dot: 'needs-you' }], ['p-5', 'Portfolio 2026', 'sky', { dot: 'done' }]]), home: { label: 'home' }, active: 'p-2', overview: false, renaming: null },
  relaunch: {
    tabs: tabs(Array.from({ length: 20 }, (_, i) => [`p-${i + 1}`, ['Alligators brand', 'Studio site', 'Matchday 2026', 'Portfolio 2026', 'Sponzoři 2027'][i % 5] + (i >= 5 ? ' ' + (i - 3) : ''), ['lilac', 'yellow', 'sky', 'green', 'coral', 'grey'][i % 6], i === 0 ? {} : { resting: true }])),
    home: { label: 'home' }, active: 'p-1', overview: false, renaming: null,
  },
};
const stubFor = (state) => `
  window.__TAURI__ = { core: {
    Channel: class { constructor() { window.__ch = this; } },
    invoke: async (cmd, args) => { if (cmd === 'tabs_state') { setTimeout(() => window.__ch.onmessage(${JSON.stringify(state)}), 50); } return null; },
  }, event: { listen: async () => () => {} } };`;

const browser = await playwright.chromium.launch();
for (const theme of ['dark', 'light']) {
  for (const [name, st] of Object.entries(states)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: name === 'b20' ? 860 : 60 }, colorScheme: theme });
    await ctx.addInitScript(stubFor(st));
    const page = await ctx.newPage();
    await page.goto('file://' + join(REPO, 'apps/desktop/src/strip.html'));
    await sleep(700);
    await page.screenshot({ path: join(OUT, `strip-${name}-${theme}.png`), clip: { x: 0, y: 0, width: 1440, height: 40 } });
    console.log('shot', name, theme);
    if (name === 'b20') {
      // the tab list ("N more")
      await page.evaluate((s) => window.__ch.onmessage({ ...s, overview: true }), st);
      await sleep(600);
      await page.screenshot({ path: join(OUT, `strip-b20-overview-${theme}.png`) });
      // overflow: how many tabs remain visible
      console.log(await page.evaluate(() => ({ more: document.getElementById('more')?.textContent, tabs: document.querySelectorAll('#tabs .tab').length })));
    }
    await ctx.close();
  }
}
await browser.close();
