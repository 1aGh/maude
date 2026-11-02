// D3: ai-needs-hidden from a clean chat (nothing else running): permission ask open, then the panel hidden
import { alligators } from './fx3.mjs';
import { REPO } from './lib.mjs';
import { join } from 'node:path';
export const fixture = alligators;
export const page = { w: 1440, h: 900, channel: true };
export const env = {
  MAUDE_ACP_ADAPTER_ENTRY: join(REPO, '.scr/impl/fake-agent.mjs'),
  MAUDE_ACP_RUNTIME: '/Users/iagh/.bun/bin/bun',
  MAUDE_CLAUDE_BIN: join(REPO, 'apps/desktop/e2e/fixtures/fake-acp/claude-stub.sh'),
  FAKE_ACP_SDK: join(REPO, 'apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js'),
};
const D = '03-ai-chat';
const POST = [780, 138];
export async function run(h) {
  const { page, sleep } = h;
  const send = async (text, wait = 2500, mode) => {
    if (mode) h.mode(mode);
    const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
    await input.click({ timeout: 6000 });
    await page.keyboard.type(text);
    await sleep(200);
    await page.keyboard.press('Enter');
    await sleep(wait);
  };
  await h.open('ui-combine-kampan', 3500);
  await page.mouse.click(...POST);
  await sleep(600);
  await h.click('panel-icon-assistant');
  await sleep(1200);
  await page.mouse.click(...POST);
  await sleep(500);
  await send('Swap the 2025 team photos for the new ones in Assets › Foto 2026', 2500, { mode: 'permission' });
  await h.step(`${D}/ai-needs-hidden`, 'needs you, panel hidden', 'hide the panel while the ask is open', async () => { await h.click('ai-chat-hide'); await sleep(1500); });
}
