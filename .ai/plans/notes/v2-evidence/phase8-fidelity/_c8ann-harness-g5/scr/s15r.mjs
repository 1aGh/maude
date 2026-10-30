import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kit } from './g5.mjs';
import { base } from './fx.mjs';
export const fixture = async () => base();
export const page = { w: 1440, h: 900 };
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  await h.open('ui-print', 3000);
  await k.fold();
  const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
  const rects = await f.evaluate(() => window.__maudeCanvasRects());
  const ab = rects.artboards[0];
  console.log('AB', JSON.stringify(ab));
  console.log('KINDS', JSON.stringify(await f.evaluate(() => [...document.querySelectorAll('[data-dc-screen]')].map((e) => [e.getAttribute('data-dc-screen'), e.getAttribute('data-dc-kind')]))));
  const r = await k.seed('ui/Print.tsx', [{ op: 'create', type: 'sticky', text: 'Check the bleed', x: ab.x + 60, y: ab.y + 60, w: 200, h: 130 }]);
  console.log('SEED', JSON.stringify(r));
  const { execSync } = await import('node:child_process'); const fl = execSync('find ' + join(h.project, '.design') + ' -name "*annot*" -not -path "*/system/*"', { encoding: 'utf8' }); console.log('FILES', fl); for (const p of fl.split('\n').filter((x) => x.endsWith('ui-print.annotations.json'))) console.log('BOARD', readFileSync(p, 'utf8').slice(0, 600));
  await page.keyboard.press('n'); await sleep(1500); await page.keyboard.press('Escape'); await sleep(800);
  console.log('PIN', JSON.stringify(await f.evaluate(() => [...document.querySelectorAll('.dc-annot-pintag')].map((e) => [e.outerHTML.slice(0, 80), getComputedStyle(e).display, JSON.stringify(e.getBoundingClientRect())]))));
  console.log('EL', JSON.stringify(await f.evaluate(() => [...document.querySelectorAll('.dc-annot-el')].map((e) => [e.getAttribute('data-type'), e.getAttribute('data-pin'), e.className]))));
  await h.step('probe/r1-print', 'print', '', async () => {});
}
