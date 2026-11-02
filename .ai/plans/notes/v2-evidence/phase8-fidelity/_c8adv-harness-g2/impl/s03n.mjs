import { alligators } from './fx3.mjs';
export const fixture = alligators;
export const page = { w: 1440, h: 900 };
const D = '03-ai-chat';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-combine-kampan', 3500);
  await page.mouse.click(780, 138);
  await h.click('panel-icon-assistant');
  await sleep(1000);
  const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
  await input.click();
  await page.keyboard.type('Three story variants');
  await page.keyboard.press('Enter');
  await sleep(2500);
  await h.step(`${D}/ai-not-ready`, 'signed out: first send opens "Connect your Claude account?"', 'claude stub answers loggedIn:false; first send', async () => {});
  await h.click('ai-connect-cancel').catch(() => {});
  await sleep(1500);
  await h.step(`${D}/ai-not-ready-after`, 'after Cancel: the ask is kept, panel says so', 'Cancel on the sheet', async () => {});
}
