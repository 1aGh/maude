import { studio } from './fx4.mjs';
import { REPO } from './lib.mjs';
import { join } from 'node:path';
export const fixture = studio;
export const page = { w: 1440, h: 900, channel: true };
export const env = {
  MAUDE_ACP_ADAPTER_ENTRY: join(REPO, '.scr/impl/fake-agent.mjs'),
  MAUDE_ACP_RUNTIME: '/Users/iagh/.bun/bin/bun',
  MAUDE_CLAUDE_BIN: join(REPO, 'apps/desktop/e2e/fixtures/fake-acp/claude-stub.sh'),
  FAKE_ACP_SDK: join(REPO, 'apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js'),
};
const D = '04-modes';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-combine-kampan', 3500);
  await page.mouse.click(780, 138);
  await sleep(500);
  await h.click('panel-icon-assistant');
  await sleep(1000);
  await h.click('palette-mode-preview');
  await sleep(1500);
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(900);
  const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
  await input.click({ timeout: 6000 });
  await page.keyboard.type('Make it greener');
  await page.keyboard.press('Enter');
  await sleep(900);
  await h.step(`${D}/md-edge-ai`, 'AI changing the artboard being previewed (mid change)', 'Preview, ask AI from the panel, shot 0.9 s in', async () => {});
  await sleep(3500);
  await h.step(`${D}/md-edge-ai-after`, 'after the change landed, still previewing', '+3.5 s', async () => {});
}
