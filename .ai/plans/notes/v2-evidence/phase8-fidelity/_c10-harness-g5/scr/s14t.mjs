// ed-edge-tereza: a SECOND browser on the same studio, named "Tereza" (its /_api/git-user answer), selects See pricing;
// the first browser then selects the same button — her ring + name sit on it and the inspector says she is editing it.
import { TAURI_STUB, playwright } from './lib.mjs';
import { studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => studioSite();
export const keepState = true;
export const page = { w: 1440, h: 900 };
const D = '14-editing';
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const hp = (s) => `[data-dc-screen="desktop"] ${s}`;
  await h.open('ui-homepage', 3000);
  await k.fold();
  // Tereza's browser
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: h.theme });
  await ctx.addInitScript(TAURI_STUB);
  const store = { 'mdcc-theme': h.theme, 'mdcc-usage-tour-seen': '1', 'mdcc-collab-tour-seen': '1', 'mdcc-whatsnew-seen': '99.0.0', 'maude-mode-hint-seen': '1' };
  await ctx.addInitScript(`try{const s=${JSON.stringify(store)};for(const k in s)localStorage.setItem(k,s[k]);}catch(e){}`);
  const p2 = await ctx.newPage();
  await ctx.route('**/_api/git-user*', (r) => r.fulfill({ json: { name: 'Tereza' } }));
  await p2.goto(h.url);
  await sleep(4000);
  if (!(await p2.locator('[data-testid="canvas-row-ui-homepage"]').first().count())) { await p2.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(800); }
  await p2.locator('[data-testid="canvas-row-ui-homepage"]').first().click().catch(() => console.log('p2 no row'));
  await sleep(4500);
  const k2 = kit({ page: p2, sleep, project: h.project });
  await p2.locator('[data-testid="panel-fold-left"]').first().click().catch(() => {}); await sleep(700);
  const sel = hp('[data-cd-id="see-pricing"]');
  await k2.deep(sel, 4);
  for (let i = 0; i < 3 && !/See pricing/.test(await p2.locator('[data-testid="inspector-panel"]').first().innerText().catch(() => '')); i++) await k2.dbl(sel);
  await sleep(2500);
  // the first browser: zoom in on the button's neighbourhood, then select the same button
  await k.fit();
  await h.step(`${D}/ed-edge-tereza`, 'Tereza is editing the same button', 'a second browser (named Tereza) selects See pricing; this one selects it too', async () => {
    await k.deep(sel, 4);
    await sleep(3000);
  });
  await browser.close();
}
