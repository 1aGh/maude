// Round 7b (p8-c7-ai2): the chat list grouped by canvas (seeded earlier chats across canvases) and a long chat
// seeded with an older day (the day divider), opened in the panel (grows to full height on its own).
//   ai-chat-list - Running (1) + Earlier grouped by canvas with "N more"
//   ai-long      - the seeded "Combine recap" chat
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture as g, env as genv } from './s03g.mjs';
export const fixture = g;
export const env = genv;
export const page = { w: 1440, h: 900, channel: true };
const D = '03-ai-chat';
const MIN = 60_000;
const HOUR = 60 * MIN;

const turn = (ts, q, a) => [
  { role: 'user', text: q, ts },
  { role: 'agent', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: a } } },
  { role: 'stop' },
];

function seed(chatDir, id, title, canvas, artboards, ageMs, turns) {
  const lines = turns.flat().map((l) => JSON.stringify(l)).join('\n') + '\n';
  writeFileSync(join(chatDir, `${id}.jsonl`), lines);
  writeFileSync(join(chatDir, `${id}.meta.json`), JSON.stringify({ title, canvas, ...(artboards ? { artboards } : {}) }));
  const t = new Date(Date.now() - ageMs);
  utimesSync(join(chatDir, `${id}.jsonl`), t, t);
}

export async function prepare(project) {
  (await import("node:fs")).rmSync(join(project, ".design/_comments"), { recursive: true, force: true });
  const dir = join(project, '.design/_chat');
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const q = (t) => turn(now - 3 * HOUR, t, 'Done.');
  const C = 'ui/Combine-kampan.tsx';
  const U = 'ui/Uniformy-2027.tsx';
  const V = 'ui/video-hype.tsx';
  seed(dir, 'c01', 'Translate the poster', C, ['poster'], 40 * MIN, [q('Translate the poster to English')]);
  seed(dir, 'c02', 'Is the poster readable?', C, ['poster'], 2 * HOUR, [q('Is the poster readable?')]);
  seed(dir, 'c03', 'Three Story variants', C, ['story'], 26 * HOUR, [q('Three Story variants')]);
  for (const [i, t] of ['Check the poster against the brief', 'Pick the six sharpest shots', 'Which green does the Post use?', 'Is the date line too small?', 'Does the logo stay white?', 'Headline in one word'].entries())
    seed(dir, `c1${i}`, t, C, null, (30 + i) * HOUR, [q(t)]);
  seed(dir, 'u01', 'Helmet side view in green and gold', U, ['u2'], 5 * HOUR, [q('Helmet side view')]);
  seed(dir, 'u02', "Dres venku from Tereza's sketch", U, ['u1'], 27 * HOUR, [q('Dres venku')]);
  seed(dir, 'u03', 'Darker green for Dres doma', U, ['u0'], 52 * HOUR, [q('Darker green')]);
  seed(dir, 'u04', 'Pants in the away colours', U, ['u3'], 53 * HOUR, [q('Pants')]);
  seed(dir, 'u05', 'Numbers on the back', U, null, 54 * HOUR, [q('Numbers')]);
  seed(dir, 'v01', 'Czech captions, word by word', V, null, 20 * 24 * HOUR, [q('Czech captions')]);
  seed(dir, 'v02', 'Beat-cut the intro', V, null, 21 * 24 * HOUR, [q('Beat-cut')]);
  seed(dir, 'v03', 'Reel for the camp', V, null, 22 * 24 * HOUR, [q('Reel')]);
  // the long chat: the first ask is from yesterday evening, the rest from today
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  y.setHours(18, 20, 0, 0);
  const YT = y.getTime();
  const TURNS = [
    turn(YT, 'Make a story from these three, same look as the post', 'Done — Story 9:16 uses the three photos in Club green, like Post 1:1. The logo stays white.'),
    turn(now - 5 * HOUR, 'Check the poster against the brief', "Two things differ from the brief: the date should read “So 14. 3. 2026”, and the sponsor strip is missing. The canvas didn't change."),
    turn(now - 4 * HOUR, 'Pick the six sharpest action shots for the recap', "Six shots picked — they're in Assets › Combine recap, sharpest first. Two more were close; they're marked."),
    turn(now - 3 * HOUR, 'Which green does the Post use?', "Club green on the Post and the Story; the poster has its own. The canvas didn't change."),
    turn(now - 2 * HOUR, 'Is the date line too small on the story?', "On Story 9:16 it is 11 pt — fine on a phone. The canvas didn't change."),
    turn(now - 1 * HOUR, 'Does the logo stay white everywhere?', "Yes — white on all four artboards. The canvas didn't change."),
    turn(now - 40 * MIN, 'Check the poster against the brief once more', 'Both fixes are in. The sponsor strip sits under the date line.'),
    turn(now - 20 * MIN, 'Cut a 15 s recap for Reels', 'Done — Reels 9:16 recap is a 15 s cut of the six shots, fast cuts on the beat.'),
  ];
  seed(dir, 'long1', 'Combine recap', C, ['reel'], 2 * MIN, TURNS);
}

export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const pick = async (re) => {
    const loc = f.getByText(re).first();
    const b = await loc.boundingBox({ timeout: 6000 });
    await page.mouse.click(b.x + Math.min(14, b.width / 2), b.y + b.height / 2);
    await sleep(450);
  };
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
  await h.click('panel-fold-left').catch(() => {});
  await sleep(500);
  await h.click('panel-icon-assistant');
  await sleep(1000);
  await pick(/^Post 1:1/);
  await send('Make it greener, keep the logo white', 2600, { mode: 'hang', text: 'Making it greener — ' });
  await h.step(`${D}/ai-chat-list`, 'chat list grouped by canvas', 'click the chat title', async () => {
    await page.locator('[data-testid="ai-chat-header"]').first().click({ position: { x: 90, y: 14 } });
    await sleep(1100);
  });
  await h.step(`${D}/ai-long`, 'a long chat: day divider, full height', 'open the seeded "Combine recap" chat', async () => {
    await page.locator('[data-testid="ai-chat-row-long1"]').first().click({ timeout: 5000 });
    await sleep(2200);
    await page.mouse.move(1210, 400);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -600); await sleep(120); }
    await sleep(900);
  });
}
