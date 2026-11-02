import { studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = studioSite;
export const page = { w: 1440, h: 900 };
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  await h.open('ui-homepage', 3000);
  await k.fold();
  const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
  const rects = await f.evaluate(() => window.__maudeCanvasRects());
  console.log(JSON.stringify(rects.artboards), JSON.stringify(rects.elements.slice(0, 6)), rects.elements.length);
  const r = await k.seed('ui/Homepage.tsx', [
    { op: 'create', type: 'sticky', ref: '@a', text: 'Tighter, please', to: 'ab:desktop' },
    { op: 'create', type: 'sticky', ref: '@b', text: 'Is this the right CTA?', to: 'el:desktop/see-work' },
  ]);
  console.log(r.stdout.slice(0, 700), r.stderr.slice(0, 500));
  await h.step('x/seeded', 'seeded', 'x', async () => {});
  await page.mouse.click(1000, 150); await sleep(300);
  await page.keyboard.press('n'); await sleep(1200);
  await h.step('x/n', 'n pressed', 'x', async () => {});
}
