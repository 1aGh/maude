import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { empty } from './fx.mjs';
export const fixture = empty;
const D = '05';
export async function run(h) {
  const { page, sleep } = h;
  await page.waitForTimeout(500);
  // landing filmstrip: open a new canvas through the palette, then snap quickly
  await page.keyboard.press('Meta+k');
  await sleep(500);
  await page.keyboard.type('new canvas');
  await sleep(800);
  const out = join(process.env.SHOTS_OUT, D);
  mkdirSync(out, { recursive: true });
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < 6000 && n < 60) {
    await page.screenshot({ path: join(out, `es-landing.f${String(n).padStart(2, '0')}-${h.theme}.png`), clip: { x: 380, y: 200, width: 840, height: 520 } });
    n++;
  }
  console.log('landing frames', n, Date.now() - t0);
}
