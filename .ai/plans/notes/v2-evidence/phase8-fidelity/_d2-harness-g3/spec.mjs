// usage: node spec.mjs "<NN Name>" id1,id2,...   (ids empty => read from canvas source)
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { boot, playwright, sleep, TAURI_STUB } from './lib.mjs';
const REPO = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a595be579d5cc0243';
const [name, idsArg, outDir = join(REPO, '.scr/spec'), theme = 'light'] = process.argv.slice(2);
const src = readFileSync(join(REPO, '.design/ui/v2', name + '.tsx'), 'utf8');
const ids = idsArg ? idsArg.split(',') : [...src.matchAll(/<DCArtboard id="([^"]+)"/g)].map((m) => m[1]);
const project = join(REPO, '.scr/design-copy');
const scratch = mkdtempSync(join(tmpdir(), 'maude-spec-'));
const s = await boot(project, scratch, {}, { theme });
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const rel = encodeURIComponent('.design/ui/v2/' + name + '.tsx');
await page.goto(`${s.url}/_canvas-shell.html?canvas=${rel}`, { waitUntil: 'networkidle', timeout: 60000 });
await sleep(4000);
if (theme === 'light') await page.evaluate(() => document.documentElement.setAttribute('data-maude-theme', 'light'));
await sleep(2500);
console.log('url now', page.url());
mkdirSync(outDir, { recursive: true });
for (const id of ids) {
  try {
    const loc = page.locator(`[data-dc-screen="${id}"]`).first();
    await loc.waitFor({ state: 'attached', timeout: 15000 });
    const rect = await page.evaluate((id) => {
      for (const e of window.__hid || []) e.style.visibility = '';
      window.__hid = [];
      for (const [e, l, t] of window.__moved || []) { e.style.left = l; e.style.top = t; }
      window.__moved = [];
      const ab = document.querySelector(`[data-dc-screen="${id}"]`);
      window.__moved.push([ab, ab.style.left, ab.style.top]);
      const world = ab.closest('.dc-world') || document.querySelector('.dc-world');
      if (world) { world.style.zoom = '1'; world.style.transform = 'none'; world.style.willChange = 'auto'; }
      document.documentElement.style.setProperty('--dc-zoom', '1');
      for (const e of document.querySelectorAll('.dc-canvas, .dc-world')) e.style.setProperty('--dc-zoom', '1');
      for (let n = ab; n && n !== document.documentElement; n = n.parentElement) for (const sib of n.parentElement.children) if (sib !== n) { sib.style.visibility = 'hidden'; window.__hid.push(sib); }
      ab.style.left = '0px'; ab.style.top = '0px';
      let r = ab.getBoundingClientRect();
      if (r.left || r.top) { ab.style.left = -r.left + 'px'; ab.style.top = -r.top + 'px'; }
      window.scrollTo(0, 0);
      r = ab.getBoundingClientRect();
      return { w: Math.ceil(r.width), h: Math.ceil(r.height), world: !!world };
    }, id);
    await page.setViewportSize({ width: Math.max(1, rect.w), height: Math.max(1, rect.h) });
    await sleep(600);
    // re-pin (resize may re-run the camera)
    await page.evaluate((id) => {
      const ab = document.querySelector(`[data-dc-screen="${id}"]`);
      const world = document.querySelector('.dc-world');
      if (world) { world.style.zoom = '1'; world.style.transform = 'none'; }
      ab.style.left = '0px'; ab.style.top = '0px';
      const r = ab.getBoundingClientRect();
      if (r.left || r.top) { ab.style.left = -r.left + 'px'; ab.style.top = -r.top + 'px'; }
    }, id);
    await sleep(300);
    const out = join(outDir, `${id}-${theme}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: rect.w, height: rect.h }, animations: 'disabled' });
    console.log('ok', id, JSON.stringify(rect));
  } catch (e) { console.log('FAIL', id, String(e.message).split('\n')[0]); }
}
if (errs.length) console.log('pageerrors', errs.slice(0, 5));
await browser.close();
s.stop();
await sleep(500);
rmSync(scratch, { recursive: true, force: true });
process.exit(0);
