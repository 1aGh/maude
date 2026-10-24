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
// the board's state: the prompt is asked in Edit, THEN Preview folds the panels; the AI keeps working under the
// pointer and the spark wears its dot (04 md-edge-ai)
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-combine-kampan', 3500);
  await page.mouse.click(780, 138);
  await sleep(500);
  await h.click('panel-icon-assistant');
  await sleep(1000);
  const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
  await input.click({ timeout: 6000 });
  await page.keyboard.type('Make it greener');
  await page.keyboard.press('Enter');
  await sleep(300);
  await h.click('palette-mode-preview');
  await sleep(700);
  await h.step(`${D}/md-edge-ai`, 'AI changing the artboard being previewed (mid change)', 'ask in Edit, then Preview: panels folded, shot mid change', async () => {});
  await sleep(3500);
  await h.step(`${D}/md-edge-ai-after`, 'after the change landed, still previewing', '+3.5 s', async () => {});
}
