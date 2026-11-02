import { base } from './fx.mjs';
export const fixture = base;
const D = '02';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-smoke', 3000);
  await h.step(`${D}/ob-local-first`, 'A canvas in a local project (status: Local project)', 'open Smoke', async () => {});
  await h.step(`${D}/ob-local-share`, 'Local — Share offers the cloud', 'share cluster › Share', async () => { await h.click('share-cluster-share'); });
  await h.esc(2);
  await h.step(`${D}/ob-settings`, 'Settings — General', '⌘K › Settings', async () => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('Settings'); await sleep(800);
    await page.locator('[data-testid="palette-row-action:settings.open"]').first().click(); await sleep(1500);
  });
  const tabs = await page.$$eval('[data-testid^="settings-"]', (e) => e.map((x) => x.getAttribute('data-testid')).slice(0, 25));
  console.log('settings ids', tabs.join(','));
  await page.getByText('Connections', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await sleep(1000);
  await h.step(`${D}/ob-settings.connections`, 'Settings — Connections', 'Settings › Connections', async () => {});
  await h.esc(3);
  await h.step(`${D}/ob-ai-connect`, 'First send — connect Claude, just in time', 'AI panel › type › Enter', async () => {
    await h.click('panel-icon-assistant');
    await sleep(1200);
    await h.tid('chat-composer').locator('textarea, [contenteditable]').first().click({ timeout: 4000 });
    await page.keyboard.type('Make the headline bigger');
    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(1800);
  });
}
