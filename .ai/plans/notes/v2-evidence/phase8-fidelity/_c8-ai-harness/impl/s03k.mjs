// ai-question: an element of the A4 poster picked, asked about with cmd-slash; the AI answers and points (spark ring, chip = its size in pt on a print artboard)
import { fixture as g, env as genv } from './s03g.mjs';
export const fixture = g;
export const env = genv;
export const page = { w: 1440, h: 900, channel: true };
const D = '03-ai-chat';
export async function prepare(project) {
  (await import('node:fs')).rmSync(project + '/.design/_comments', { recursive: true, force: true });
}
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  await h.open('ui-combine-kampan', 3500);
  await h.click('panel-fold-left').catch(() => {});
  await h.click('panel-icon-assistant');
  await sleep(900);
  await f.locator('[data-dc-screen="poster"]').getByText('So 14. 3. · Kraví hora').first().click({ timeout: 5000 });
  await sleep(600);
  await page.keyboard.press('Meta+/');
  await sleep(900);
  h.mode({ mode: 'tell', text: "Mostly. COMBINE 2026 reads from five metres; the date line is 9 pt and fades past two. The canvas didn't change." });
  await page.keyboard.type('Is the A4 poster readable from three metres?');
  await sleep(300);
  await page.keyboard.press('Enter');
  await page.getByText(/^Mostly\. COMBINE 2026/).first().waitFor({ timeout: 15000 }).catch(() => console.log('NO answer'));
  await sleep(800);
  await h.esc(2); // nothing stays picked: the spark ring is the only mark
  await sleep(900);
  await h.step(`${D}/ai-question`, 'a question answered; the ring points at the date line', 'element picked, cmd slash, question asked', async () => {});
}
