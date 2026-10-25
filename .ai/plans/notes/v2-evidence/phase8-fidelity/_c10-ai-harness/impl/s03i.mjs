// Round 7b (p8-c7-ai2): ai-needs-hidden on the board's canvas. The ask that needs you is on Uniformy-2027 (four photo
// artboards, Claude asks before replacing them); the person is on Combine-kampan with the AI panel hidden, so the
// Canvases row of Uniformy-2027 says "Needs you", the folded spark is azure, one toast offers Open.
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
  const pick = async (re, mod) => {
    const loc = f.getByText(re).first();
    const b = await loc.boundingBox({ timeout: 6000 });
    if (mod) await page.keyboard.down(mod);
    await page.mouse.click(b.x + Math.min(14, b.width / 2), b.y + b.height / 2);
    if (mod) await page.keyboard.up(mod);
    await sleep(450);
  };
  const send = async (text, wait = 2500, mode) => {
    if (mode) h.mode(mode);
    const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
    await input.click({ timeout: 6000 });
    await page.keyboard.type(text);
    await sleep(200);
    await page.keyboard.press('Enter');
    await sleep(wait);
  };
  await h.open('ui-uniformy-2027', 3500);
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(900);
  await pick(/^Foto · obrana/);
  for (const n of ['Foto · útok', 'Foto · speciální týmy', 'Foto · trenéři']) await pick(new RegExp(`^${n}`), 'Shift');
  await send('Replace the 4 team photos', 2800, { mode: 'permission' });
  // back to Combine-kampan (the canvas row), the panel hidden while the question waits
  await h.open('ui-combine-kampan', 3000);
  await h.step(`${D}/ai-needs-hidden`, 'needs you on another canvas, panel hidden', 'ask on Uniformy-2027, go to Combine-kampan, hide the panel', async () => {
    await h.click('ai-chat-hide').catch(() => {});
    await sleep(1500);
  });
}
