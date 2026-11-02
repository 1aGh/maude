import { gators, studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => (process.env.FX === 'gators' ? gators() : studioSite());
export const page = { w: 1440, h: 2000 };
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const hp = (s) => `[data-dc-screen="desktop"] ${s}`;
  const out = process.env.C6OUT || '.scr/v';
  await h.open(process.env.FX === 'gators' ? 'ui-combine-kampan' : 'ui-homepage', 3000);
  await k.fold();
  await k.inspector(true);
  const shot = async (name) => {
    const p = page.locator('[data-testid="inspector-panel"]').first();
    if (process.env.ADV) { await page.locator('[data-testid="inspector-panel"] button', { hasText: 'Advanced' }).first().click().catch(() => {}); await sleep(600); }
    if (process.env.DBG) console.log(JSON.stringify(await page.evaluate((sel) => { const r = document.querySelector(sel); if (!r) return null; const o = (e) => ({ c: e.className.toString().slice(0, 30), w: Math.round(e.getBoundingClientRect().width), x: Math.round(e.getBoundingClientRect().x) }); return { row: o(r), kids: [...r.querySelectorAll('*')].map(o) }; }, process.env.DBG)));
    await sleep(600);
    await p.screenshot({ path: `${out}/${name}-${h.theme}.png` });
  };
  const T = process.env.T;
  if (T === 'book') { await k.deep(hp('[data-cd-id="book"]'), 3); await shot('book'); }
  if (T === 'brand') { await k.deep(hp('[data-cd-id="services"]'), 2); await k.dbl(hp('[data-cd-id="card-brand"]')); await shot('brand'); }
  if (T === 'services') { await k.deep(hp('[data-cd-id="services"]'), 2); await shot('services'); }
  if (T === 'title') { await k.deep('[data-dc-screen="p2"] [data-cd-id="title"]', 2); await shot('title'); }
  if (T === 'inst') {
    await page.mouse.click(700, 700); await sleep(300);
    await page.keyboard.press('Shift+i'); await sleep(1000);
    const row = page.locator('[data-testid="component-picker-row-Button"]').first();
    if (await row.count()) await row.click();
    await sleep(600);
    const c = await k.ctr(hp('[data-cd-id="hero-art"]'));
    await page.mouse.click(c.x, c.y); await sleep(1200);
    await shot('inst');
  }
  if (T === 'button') { await k.deep(hp('[data-cd-id="see-work"]'), 4); await shot('button'); }
}
