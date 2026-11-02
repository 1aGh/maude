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
  const ASK = 'Make it greener, keep the logo white';
  const send = async (text, wait = 2500, mode) => {
    if (mode) h.mode(mode);
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
  const TURNS = [
    ['Is the A4 poster readable from three metres?', "Mostly. COMBINE 2026 reads from five metres; the date line is 9 pt and fades past two. The canvas didn't change."],
    ['Check the poster against the brief', "Two things differ from the brief: the date should read “So 14. 3. 2026”, and the sponsor strip is missing. The canvas didn't change."],
    ['Pick the six sharpest action shots for the recap', "Six shots picked — they're in Assets › Combine recap, sharpest first. Two more were close; they're marked."],
    ['Which green does the Post use?', "Club green on the Post and the Story; the poster has its own. The canvas didn't change."],
    ['Is the date line too small on the story?', "On Story 9:16 it is 11 pt — fine on a phone. The canvas didn't change."],
    ['Does the logo stay white everywhere?', "Yes — white on all four artboards. The canvas didn't change."],
  ];
  for (const [q, a] of TURNS) await send(q, 2600, { mode: 'tell', text: a });
  await h.step(`${D}/ai-long`, 'a long chat', 'six turns in one chat', async () => {});
  await h.step(`${D}/ai-long-pinned`, 'pinned to the side', 'ai-chat-pin', async () => { await h.click('ai-chat-pin'); await sleep(1200); });
  await page.locator('[data-testid="ai-chat-pin"]').first().dispatchEvent('click'); await sleep(1200);
  await h.step(`${D}/dbg-fit`, 'dbg', 'dbg', async () => {});
  await sleep(500);
  await newChat(POSTER);
  await send('Translate the poster to English, keep the layout', 2200, { mode: 'hang', poster: true, text: 'Translating — ', title: 'Headline and date done · button next' }); // chat 1 keeps working on the poster
  await newChat(POST);
  // the finish moment (data-fresh, 1.8 s): shot while it plays
  await send(ASK, 0);
  await h.step(`${D}/ai-done`, 'Done: result line, Undo, Keep going; the poster chat still works', 'chat 1 hangs on A4, chat 2 asks on Post and finishes; shot in the 1.8 s finish window', async () => {}, { fresh: true });
  await h.step(`${D}/ai-hero`, 'the finish next to a second AI still working', 'same finish window as ai-done', async () => {}, { now: true });
  await sleep(2500);
  // a second finish for Version history
  await send('Make the badge rounder too', 0, { mode: 'done', text: 'Done — the badge on Post 1:1 is a full pill now. Nothing else moved.' });
  await h.step(`${D}/ai-history`, 'Version history (⌥⌘H)', 'press ⌥⌘H inside the finish window', async () => { await h.fresh(); await page.keyboard.press('Alt+Meta+h'); await sleep(350); }, { now: true });
  await page.mouse.click(1405, 94);
  await sleep(700);
  await h.step(`${D}/ai-panel-closed`, 'panel hidden while the poster chat works', 'ai-chat-hide', async () => { await h.click('ai-chat-hide'); await sleep(1000); });
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(700);
  await newChat(POST);
  await send('Swap the 2025 team photos for the new ones in Assets › Foto 2026', 2500, { mode: 'permission' });
  await h.step(`${D}/ai-permission`, 'permission card: asks before replacing', 'prompt with "permission"', async () => {});
  await h.step(`${D}/ai-needs-hidden`, 'needs you, panel hidden', 'hide the panel while the ask is open', async () => { await h.click('ai-chat-hide'); await sleep(1200); });
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(700);
  await h.click('ai-permission-allow').catch(() => {});
  await sleep(1200);
  await newChat(POST);
  await send(ASK, 2500, { mode: 'question' });
  await h.step(`${D}/ai-choice-q`, 'a question back (Which green?)', 'prompt with the ask, elicitation', async () => {});
  await page.locator('[data-testid^="chat-elicit-option-"]').first().click().catch(() => {});
  await sleep(1200);
  await newChat(POST);
  await send('Is the A4 poster readable from three metres?', 2500, { mode: 'tell', text: "Mostly. COMBINE 2026 reads from five metres; the date line is 9 pt and fades past two. The canvas didn't change." });
  await h.step(`${D}/ai-question`, 'a question answered in the chat; the canvas stays put', 'ask a question', async () => {});
  await newChat(POST);
  await send('Cut the hype reel to 15 s from the training footage', 2500, { mode: 'fail' });
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
