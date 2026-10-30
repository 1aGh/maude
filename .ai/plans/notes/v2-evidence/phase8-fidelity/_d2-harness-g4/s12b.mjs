import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { photos } from './fx.mjs';
export const fixture = photos;
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
  await h.open('ui-photos', 2500);
  // Figma: a pasted link, not connected yet → the "Connect once" step
  await palette('Figma');
  await h.tid('figma-import-url').fill('https://www.figma.com/design/AbCdEf123456/Alligators-brand?node-id=1-2').catch(() => {});
  await page.keyboard.press('Enter');
  await sleep(2500);
  await h.step('ia-figma-sheets-connect', D, '⌘K › Import from Figma… › paste a link › Enter (Figma not connected: the Connect step)', async () => {});
  await page.reload();
  await sleep(3500);
  await h.open('ui-photos', 2500);
  // Brand: a logo + a website → Reading… → the site does not answer
  await palette('brand');
  const p = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
  await h.click('brand-up-pick-file').catch(() => {});
  const fc = await p;
  if (fc) await fc.setFiles([join(project, 'studio-brno-logo.svg')]);
  await h.page.getByText("studio-brno-logo.svg").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => console.log("logo not shown")); await sleep(1500);
  await h.tid('brand-website').fill('studio-brno.cz').catch(() => {});
  await sleep(500);
  await h.step('ia-brand-steps-1', D, 'Import a brand: logo chosen (file chooser) + website typed', async () => {});
  await h.click('brand-import').catch(() => {});
  await sleep(1200);
  await h.step('ia-brand-steps-2', D, '… Import pressed: Reading…', async () => {});
  await sleep(14000);
  await h.step('ia-brand-steps-3', D, '… the site does not answer (no network in the lane)', async () => {});
}
