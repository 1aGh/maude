// Round 5 (p8-c5-aichat): the 03 ids this round changed, each driven from a clean chat (nothing else running).
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
  const newChat = async (at) => {
    await h.click('ai-chat-new').catch(() => {});
    await sleep(500);
    if (at) { await page.mouse.click(...at); await sleep(400); }
  };
  await h.open('ui-combine-kampan', 3500);
  await h.click('panel-icon-assistant');
  await sleep(1200);
  await page.mouse.click(1000, 450); // nothing picked: the board's main scope case is "Whole canvas"
  await sleep(500);
  // the two menus over the field
  await h.step(`${D}/ai-scope`, 'scope chip menu', 'click the scope chip', async () => { await h.click('ai-scope-chip'); });
  await h.esc(1);
  await page.mouse.click(...POST);
  await sleep(500);
  await h.step(`${D}/ai-attach-menu`, 'the paperclip menu', 'click the paperclip', async () => { await h.click('ai-attach-clip'); });
  await h.esc(1);
  await h.step(`${D}/ai-advanced`, 'Advanced fold open', 'click › Advanced', async () => { await h.click('ai-advanced'); });
  await h.click('ai-advanced').catch(() => {});
  await sleep(400);
  // a permission ask with nothing else running
  await send('Swap the 2025 team photos for the new ones in Assets › Foto 2026', 2500, { mode: 'permission' });
  await h.step(`${D}/ai-permission`, 'permission card: asks before replacing', 'prompt with "permission"', async () => {});
  await h.click('ai-permission-allow').catch(() => {});
  await sleep(1500);
  // a failure that names a file
  await newChat(POST);
  await send('Cut the hype reel to 15 s from the training footage', 2500, { mode: 'fail' });
  await h.step(`${D}/ai-choice-fail`, 'a failure card', 'prompt with "fail"', async () => {});
  // a long chat, then the pin with nothing selected
  await newChat(POST);
  const TURNS = [
    ['Is the A4 poster readable from three metres?', "Mostly. COMBINE 2026 reads from five metres; the date line is 9 pt and fades past two. The canvas didn't change."],
    ['Which green does the Post use?', "Club green on the Post and the Story; the poster has its own. The canvas didn't change."],
    ['Is the date line too small on the story?', "On Story 9:16 it is 11 pt — fine on a phone. The canvas didn't change."],
    ['Does the logo stay white everywhere?', "Yes — white on all four artboards. The canvas didn't change."],
  ];
  for (const [q, a] of TURNS) await send(q, 2600, { mode: 'tell', text: a });
  await page.mouse.click(700, 460); // empty canvas: nothing selected, so no Inspector in the column
  await sleep(700);
  await h.step(`${D}/ai-long-pinned`, 'pinned to the side', 'ai-chat-pin', async () => { await h.click('ai-chat-pin'); await sleep(1800); });
}
