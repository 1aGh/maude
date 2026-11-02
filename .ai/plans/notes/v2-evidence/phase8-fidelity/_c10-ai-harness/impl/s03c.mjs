// Round 5 (p8-c5-aichat): the 03 ids this round changed, each driven from a clean chat (nothing else running).
import { alligators } from './fx3.mjs';
import { REPO } from './lib.mjs';
import { readFileSync } from 'node:fs';
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
  // a long chat, then the pin with nothing selected. c10 (board ai-long-pinned): the first ask carries three photos and
  // changed the canvas (a real run: Undo · Compare), the next a PDF, the next a folder and an answer with four steps.
  const composerNow = () => page.locator('[data-testid="chat-composer"]:visible').last();
  const png = readFileSync(join(REPO, '.scr/attach/Combine-foto.png'));
  // an earlier real change first, so the story run has a version before it
  await newChat(POST);
  await send('Make the badge rounder', 3200, { mode: 'done', target: 'post', ms: 600, text: 'Done — the badge is a pill now.' });
  await newChat(POST);
  await composerNow().locator('[data-testid="ai-attach-input"]').setInputFiles([1, 2, 3].map((n) => ({ name: `kravi-hora-0${n}.png`, mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from(`c10-${n}`)]) })));
  await sleep(1800);
  await send('Make a story from these three, same look as the post', 3600, { mode: 'done', target: 'post', steps: 3, ms: 600, text: 'Done — Story 9:16 uses the three photos in Club green, like Post 1:1. The logo stays white.' });
  await composerNow().locator('[data-testid="ai-attach-input"]').setInputFiles([join(REPO, '.scr/attach/Combine-brief-2026.pdf')]);
  await sleep(1500);
  await send('Check the poster against the brief', 2600, { mode: 'tell', text: "Two things differ from the brief: the date should read “So 14. 3. 2026”, and the sponsor strip is missing. The canvas didn't change." });
  await page.evaluate((dir) => {
    const inv = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (c, a) => (c === 'pick_attach_folder' ? dir : inv(c, a));
  }, join(h.project, 'Combine 2026 fotky'));
  await composerNow().locator('[data-testid="ai-attach-clip"]').click({ timeout: 4000 });
  await sleep(500);
  await page.locator('[data-testid="ai-attach-menu-folder"]:visible').first().click({ timeout: 4000 }).catch(() => console.log('NO folder row'));
  await sleep(1400);
  await page.locator('[data-testid="ai-attach-consent-allow"]:visible').first().click({ timeout: 3000 }).catch(() => console.log('NO consent card'));
  await sleep(1200);
  await send('Pick the six sharpest action shots for the recap', 3000, { mode: 'tell', steps: 4, text: "Six shots picked — they're in Assets › Combine recap, sharpest first. Two more were close; they're marked." });
  // the recap is being cut right now: the running row sits at the foot of the long chat (board ai-long-pinned)
  await send("Now cut a 15 s recap for Reels from the six shots — fast cuts on the beat, end on the ZAPIŠ SE card, and use the music from last year's recap.", 2600, { mode: 'hang', text: 'Placing shots — ', title: '4 of 6 shots placed · music next' });
  await page.mouse.click(700, 460); // empty canvas: nothing selected, so no Inspector in the column
  await sleep(700);
  await h.step(`${D}/ai-long-pinned`, 'pinned to the side', 'ai-chat-pin', async () => { await h.click('ai-chat-pin'); await sleep(1800); });
}

// the folder the long chat's third ask reads: 48 photos inside the project, so the consent card names no outside path
export async function prepare(project) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const d = join(project, 'Combine 2026 fotky');
  mkdirSync(d, { recursive: true });
  for (let i = 0; i < 48; i++) writeFileSync(join(d, `foto-${String(i).padStart(2, '0')}.jpg`), 'x'.repeat(40));
}
