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
const POSTER = [760, 562];
export async function run(h) {
  const { page, sleep } = h;
  const send = async (text, wait = 2500) => {
    const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
    await input.click({ timeout: 6000 }).catch(async (e) => { await h.step(`${D}/dbg-${Date.now()%100000}`, 'send failed', text, async () => {}); throw e; });
    await page.keyboard.type(text);
    await sleep(200);
    await page.keyboard.press('Enter');
    await sleep(wait);
  };
  const newChat = async (at) => {
    await h.click('ai-chat-new').catch(() => {});
    await sleep(500);
    if (at) { await page.mouse.click(...at); await sleep(400); }
  };
  await h.open('ui-combine-kampan', 3500);
  await page.mouse.click(...POST);
  await h.click('panel-icon-assistant');
  await sleep(1000);
  await page.mouse.click(...POST);
  await sleep(500);
  // several turns first -> a long chat (nothing else runs yet, so nothing waits)
  for (const t of ['Tell me about the greens', 'Tell me about the date', 'Tell me what is on the story', 'Tell me about the poster', 'Tell me what you would adjust', 'Tell me the club green']) await send(t, 2600);
  await h.step(`${D}/ai-long`, 'a long chat', 'six turns in one chat', async () => {});
  await h.step(`${D}/ai-long-pinned`, 'pinned to the side', 'ai-chat-pin', async () => { await h.click('ai-chat-pin'); await sleep(1200); });
  await h.click('ai-chat-pin').catch(() => {});
  await sleep(500);
  await newChat(POSTER);
  await send('Translate it hang', 2200); // chat 1 keeps working on the poster
  await newChat(POST);
  await send('Make it greener', 5000);
  await h.step(`${D}/ai-done`, 'Done: result line, Undo, Keep going; the poster chat still works', 'chat 1 hangs on A4, chat 2 asks on Post and finishes', async () => {});
  await h.step(`${D}/ai-hero`, 'the finish next to a second AI still working', 'same frame as ai-done', async () => {});
  await h.step(`${D}/ai-history`, 'Version history (⌥⌘H)', 'press ⌥⌘H', async () => { await page.keyboard.press('Alt+Meta+h'); await sleep(1500); });
  await page.mouse.click(1405, 94);
  await sleep(700);
  await h.step(`${D}/ai-panel-closed`, 'panel hidden while the poster chat works', 'ai-chat-hide', async () => { await h.click('ai-chat-hide'); await sleep(1000); });
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(700);
  await newChat(POST);
  await send('Replace the photos permission', 2500);
  await h.step(`${D}/ai-permission`, 'permission card: asks before replacing', 'prompt with "permission"', async () => {});
  await h.step(`${D}/ai-needs-hidden`, 'needs you, panel hidden', 'hide the panel while the ask is open', async () => { await h.click('ai-chat-hide'); await sleep(1200); });
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(700);
  await h.click('ai-permission-allow').catch(() => {});
  await sleep(1200);
  await newChat(POST);
  await send('A question please', 2500);
  await h.step(`${D}/ai-question`, 'a question back', 'prompt with "question"', async () => {});
  await page.locator('[data-testid^="chat-elicit-option-"]').first().click().catch(() => {});
  await sleep(1200);
  await newChat(POST);
  await send('It will fail', 2500);
  await h.step(`${D}/ai-choice-fail`, 'a failure card', 'prompt with "fail"', async () => {});
  // slash menu + advanced
  await newChat(POST);
  await page.locator('[data-testid="chat-composer"] .chat-input:visible').last().click({ timeout: 5000 }).catch(() => {});
  await page.keyboard.type('/');
  await sleep(900);
  await h.step(`${D}/ai-adv-edges`, 'slash commands in the field, Advanced closed', 'type /', async () => {});
  await page.keyboard.press('Escape');
  // quit dialog
  await page.evaluate(() => { const c = (window.__chs || []).slice(-1)[0]; if (c && c.onmessage) c.onmessage({ kind: 'quit://ask', payload: { nonce: 1, chats: 2 } }); });
  await sleep(900);
  await h.step(`${D}/ai-quit`, 'Quit while AI is working?', 'a quit://ask message on the shell channel', async () => {});
}
