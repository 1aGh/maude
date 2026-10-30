// Round 10 (p8-c10-ai): ai-advanced on a DONE chat (board frame 27: "Make it greener" → Done · Undo / Keep going, then
// Advanced open with the whole lower half: persona, the images / video / voice group, "This chat" meters, Raw log /
// Copy transcript / Open in terminal). The panel is as tall as the page lets it be, so the page is made taller for
// this one shot; the pair is cropped to the panel (pairs-map crop).
import { alligators } from './fx3.mjs';
import { REPO } from './lib.mjs';
import { join } from 'node:path';
export const fixture = alligators;
export const page = { w: 1440, h: 900, channel: true };
export const env = {
  MAUDE_ACP_ADAPTER_ENTRY: join(REPO, '.scr/impl/fake-agent.mjs'),
  MAUDE_ACP_RUNTIME: (process.env.D5_BUN || '/Users/iagh/.bun/bin/bun'),
  MAUDE_CLAUDE_BIN: join(REPO, 'apps/desktop/e2e/fixtures/fake-acp/claude-stub.sh'),
  FAKE_ACP_SDK: join(REPO, 'apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js'),
};
const D = '03-ai-chat';
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  await h.open('ui-combine-kampan', 3500);
  await h.click('panel-fold-left').catch(() => {});
  await h.click('panel-icon-assistant');
  await sleep(1000);
  const b = await f.getByText(/^Post 1:1/).first().boundingBox({ timeout: 6000 });
  await page.mouse.click(b.x + 14, b.y + b.height / 2);
  await sleep(500);
  h.mode({ mode: 'done', usage: true, text: 'Done — Post 1:1 is greener: background, badge and button. The logo stays white.' });
  const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
  await input.click({ timeout: 6000 });
  await page.keyboard.type('Make it greener, keep the logo white');
  await sleep(200);
  await page.keyboard.press('Enter');
  await h.fresh();
  await sleep(2600); // the finish moment settles; the chat stays on its Done card
  await h.click('ai-advanced');
  await sleep(600);
  // tall enough for the whole Advanced fold, then the lower half is in frame
  await page.setViewportSize({ width: 1440, height: 1500 });
  await sleep(1200);
  await h.step(`${D}/ai-advanced`, 'a Done chat with Advanced open, lower half in frame', 'Done chat, › Advanced, page made taller', async () => {}, { now: true });
  await page.setViewportSize({ width: 1440, height: 900 });
}
