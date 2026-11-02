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
export async function run(h) {
  const { page, sleep } = h;
  const send = async (text, wait = 2500) => {
    const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
    await input.click();
    await page.keyboard.type(text);
    await sleep(200);
    await page.keyboard.press('Enter');
    await sleep(wait);
  };
  await h.open('ui-combine-kampan', 3500);
  // 2 · select Post 1:1, ⌘/
  await page.mouse.click(780, 138);
  await sleep(700);
  await page.keyboard.press('Meta+/');
  await sleep(1500);
  await h.step(`${D}/ai-open-cmdslash`, 'Post 1:1 selected, ⌘/ pressed', 'click the artboard label, ⌘/', async () => {});
  await h.esc(2);
  await page.mouse.click(780, 138);
  await h.click('panel-icon-assistant');
  await sleep(1500);
  await h.step(`${D}/ai-open`, 'Post 1:1 selected, panel opened from the corner icon', 'click the artboard label, click the AI corner icon', async () => {});
  await h.step(`${D}/ai-suggest`, 'the suggestion strip, if any', 'same frame (suggestions follow context)', async () => {});
  await h.step(`${D}/ai-scope`, 'scope chip menu', 'click the scope chip', async () => { await h.click('ai-scope-chip'); });
  await h.esc(1);
  await h.step(`${D}/ai-attach-menu`, 'the paperclip menu', 'click the paperclip', async () => { await h.click('ai-attach-clip'); });
  await h.esc(1);
  // attach a photo via the hidden input
  await h.step(`${D}/ai-attach`, 'a photo chip inside the prompt', 'set a file on the attach input', async () => {
    const f = page.locator('[data-testid="ai-attach-input"]').first();
    await f.setInputFiles(join(REPO, 'apps/desktop/e2e/fixtures/project/.design/assets/pic.png'));
    await sleep(1200);
  });
  // advanced fold
  await h.step(`${D}/ai-advanced`, 'Advanced fold open', 'click › Advanced', async () => { await h.click('ai-advanced'); });
  await h.click('ai-advanced').catch(() => {});
  // working
  await send('Make it greener hang', 2600);
  await h.step(`${D}/ai-working`, 'AI works: ring + tag + working card', 'send "…hang"', async () => {});
  // a second chat on another artboard while the first runs
  await h.click('ai-chat-new').catch(() => {});
  await sleep(700);
  await page.mouse.click(760, 562);
  await sleep(500);
  await send('Translate it hang', 2600);
  await h.step(`${D}/ai-two-artboards`, 'two chats, two artboards', 'second chat on A4', async () => {});
  await h.click('ai-chat-new').catch(() => {});
  await sleep(700);
  await send('Same artboard hang', 2600);
  await h.step(`${D}/ai-same-artboard`, 'third ask on a busy artboard', 'third chat on A4', async () => {});
  await h.step(`${D}/ai-copy`, 'run on a copy', 'click "Run on a copy" in the waiting card', async () => { await page.locator('[data-testid="ai-waiting-copy"]').first().click({ timeout: 4000 }); await sleep(2500); });
  // chat list
  await h.step(`${D}/ai-chat-list`, 'chat list', 'click the chat title', async () => { await page.locator('[data-testid="ai-chat-header"]').first().click({ position: { x: 90, y: 14 } }); await sleep(900); });
}
