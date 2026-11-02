// Round 11 (p8-r11-03): ai-done. One chat asks on Post 1:1 and finishes; the frame is shot once the 1.8 s finish moment
// (solid ring + Before / After wipe) has settled into the "Made by AI" label under the artboard - the same state in both
// themes (the D7 light frame had neither the ring nor the label: capture timing or a real settle race?). When the label
// does not come the scene says so and dumps what the canvas holds, instead of shooting an unexplained frame.
import { alligators } from './fx3.mjs';
import { REPO } from './lib.mjs';
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
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const pick = async (re) => {
    const loc = f.getByText(re).first();
    const b = await loc.boundingBox({ timeout: 5000 });
    await page.mouse.click(b.x + Math.min(14, b.width / 2), b.y + b.height / 2);
    await sleep(500);
  };
  await h.open('ui-combine-kampan', 3500);
  await h.click('panel-fold-left').catch(() => {});
  await sleep(600);
  await h.click('panel-icon-assistant');
  await sleep(1000);
  await pick(/^Post 1:1/);
  h.mode({ mode: 'done', text: 'Done — Post 1:1 is greener: background, badge and button. The logo stays white.' });
  const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
  await input.click({ timeout: 6000 });
  await page.keyboard.type('Make it greener, keep the logo white');
  await sleep(200);
  await page.keyboard.press('Enter');
  await h.step(`${D}/ai-done`, 'Done: result line, Undo, Keep going; the finish settled into "Made by AI"', 'one chat asks on Post and finishes; shot when the ring has settled into the label', async () => {
    const fresh = await h.fresh();
    console.log(`ai-done ${h.theme}: finish window ${fresh ? 'seen' : 'NOT seen'}`);
    const label = await h.settled();
    console.log(`ai-done ${h.theme}: settled label ${label ? JSON.stringify(label) : 'MISSING'}`);
    if (!label) {
      for (const fr of page.frames()) {
        if (fr === page.mainFrame()) continue;
        const dump = await fr.evaluate(() => [...document.querySelectorAll('.dc-ai-ring')].map((r) => `${r.dataset.artboard}:${r.dataset.state}:${r.dataset.fresh ?? '-'}:${r.style.display}:${(r.textContent || '').trim()}`)).catch(() => []);
        if (dump.length) console.log('rings', JSON.stringify(dump));
      }
    }
    await sleep(600);
  }, { now: true });
}
