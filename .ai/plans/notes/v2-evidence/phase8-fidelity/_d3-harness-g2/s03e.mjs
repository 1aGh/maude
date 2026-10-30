// D3: the s03b sequence, but every artboard is picked by its label chip in the canvas frame (the camera moves when the chat
// is pinned / the panels fold, so fixed coordinates miss) and the chats are kept on their own artboard.
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
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const pick = async (re) => {
    const loc = f.getByText(re).first();
    const b = await loc.boundingBox({ timeout: 5000 });
    await page.mouse.click(b.x + Math.min(14, b.width / 2), b.y + b.height / 2);
    await sleep(500);
  };
  const POST = /^Post 1:1/;
  const POSTER = /^A4/;
  const ASK = 'Make it greener, keep the logo white';
  const send = async (text, wait = 2500, mode) => {
    if (mode) h.mode(mode);
    const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
    await input.click({ timeout: 6000 });
    await page.keyboard.type(text);
    await sleep(200);
    await page.keyboard.press('Enter');
    await sleep(wait);
  };
  const newChat = async (re) => {
    await h.click('ai-chat-new').catch(() => {});
    await sleep(500);
    if (re) await pick(re);
  };
  await h.open('ui-combine-kampan', 3500);
  await pick(POST);
  await h.click('panel-icon-assistant');
  await sleep(1000);
  await pick(POST);
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
  // chat 1 keeps working on the poster
  await newChat(POSTER);
  await send('Translate the poster to English, keep the layout', 2200, { mode: 'hang', poster: true, text: 'Translating — ', title: 'Headline and date done · button next' });
  await newChat(POST);
  // the finish moment (data-fresh, 1.8 s)
  await send(ASK, 0, { mode: 'done', text: 'Done — Post 1:1 · the background is a deeper green, the logo stays white.' });
  await h.step(`${D}/ai-done`, 'Done: result line, Undo, Keep going; the poster chat still works', 'chat 1 hangs on A4, chat 2 asks on Post and finishes; shot in the 1.8 s finish window', async () => {}, { fresh: true });
  await h.step(`${D}/ai-hero`, 'the finish next to a second AI still working', 'same finish window as ai-done', async () => {}, { now: true });
  await sleep(2500);
  // a second finish for Version history
  await send('Make the badge rounder too', 0, { mode: 'done', text: 'Done — the badge on Post 1:1 is a full pill now. Nothing else moved.' });
  await h.step(`${D}/ai-history`, 'Version history (⌥⌘H)', 'press ⌥⌘H inside the finish window', async () => { await h.fresh(); await page.keyboard.press('Alt+Meta+h'); await sleep(350); }, { now: true });
  await page.keyboard.press('Alt+Meta+h');
  await sleep(700);
  await h.step(`${D}/ai-panel-closed`, 'panel hidden while the poster chat works', 'ai-chat-hide', async () => {
    const x = page.locator('[data-testid="ai-chat-hide"]').first();
    await x.click({ timeout: 4000 }).catch(() => x.dispatchEvent('click'));
    await sleep(1000);
  });
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(700);
  await newChat(POST);
  await send(ASK, 2500, { mode: 'question' });
  await h.step(`${D}/ai-choice-q`, 'a question back (Which green?)', 'prompt with the ask, elicitation', async () => {});
  await page.locator('[data-testid^="chat-elicit-option-"]').first().click().catch(() => {});
  await sleep(1200);
  await newChat(POST);
  await send('Is the A4 poster readable from three metres?', 2500, { mode: 'tell', text: "Mostly. COMBINE 2026 reads from five metres; the date line is 9 pt and fades past two. The canvas didn't change." });
  await h.step(`${D}/ai-question`, 'a question answered in the chat; the canvas stays put', 'ask a question', async () => {});
  // slash menu
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
