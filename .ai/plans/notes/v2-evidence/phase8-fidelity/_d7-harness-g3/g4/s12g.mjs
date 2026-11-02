import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { photos } from './fx.mjs';
export const fixture = photos;
export const page = { tauri: false };
export const env = { AGENT_BROWSER_SOCKET_DIR: '/tmp/abg4' };
const D = '12-import-and-assets';
export async function prepare(project) {
  writeFileSync(join(project, 'studio-brno-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><circle cx="30" cy="30" r="20" fill="#f4a08c"/><text x="58" y="38" font-size="20" font-family="sans-serif" fill="#222">studio brno</text></svg>');
}
export async function run(h) {
  const { page, sleep, project } = h;
  const palette = async (q) => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type(q);
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(1500);
  };
  page.on('response', async (r) => { if (/import-(asset|brand)/.test(r.url())) console.log('RESP', r.status(), r.url().split('/').pop(), (await r.text().catch(() => '')).slice(0, 200)); });
  // c8m2: a slow site, so the Reading column is on screen (D5 had no network, the read failed before the shot): the website read is held
  // until released, then answers "did not answer" the way the failed-site column (-3) draws it
  let release = () => {};
  const held = new Promise((r) => { release = r; });
  await page.route('**/_api/import-brand', async (route) => {
    if (!/"url"/.test(route.request().postData() || '')) return route.continue();
    await held;
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'site-unreadable', site: { ok: false, host: 'studio-brno.cz', reason: 'timeout' } }) });
  });
  await h.open('ui-photos', 2500);
  await palette('brand');
  const p = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await h.click('brand-up-pick-file').catch(() => {});
  const fc = await p;
  if (!fc) console.log('no filechooser');
  if (fc) await fc.setFiles([join(project, 'studio-brno-logo.svg')]);
  await page.getByText('studio-brno-logo.svg').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => console.log('logo not shown'));
  await sleep(800);
  await h.tid('brand-website').fill('studio-brno.cz').catch(() => {});
  await sleep(500);
  await h.step('ia-brand-steps-1', D, 'Import a brand: logo chosen (file chooser) + website typed', async () => {});
  await h.click('brand-import').catch(() => {});
  await sleep(1500);
  await h.step('ia-brand-steps-2', D, '… Import pressed: Reading… (the site read is held)', async () => {});
  release();
  await h.tid('brand-site-failed').waitFor({ state: 'visible', timeout: 15000 }).catch(() => console.log('no failed callout'));
  await sleep(700);
  await h.step('ia-brand-steps-3', D, '… the site does not answer', async () => {});
}
