// ed-edge-ai: AI (fake agent through the design hook) holds the footer while you type in the headline.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => studioSite();
export const page = { w: 1440, h: 1000 };
export const env = {
  MAUDE_ACP_ADAPTER_ENTRY: join(REPO, '.scr/h/fake-acp/g14-agent.mjs'),
  MAUDE_ACP_RUNTIME: execFileSync('which', ['bun'], { encoding: 'utf8' }).trim(),
  MAUDE_CLAUDE_BIN: join(REPO, '.scr/h/fake-acp/claude-stub.sh'),
  FAKE_ACP_SDK: join(REPO, 'apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js'),
};
const D = '14-editing';
// the footer moves out of the shared Hero component into the Desktop artboard itself, so an edit of it is an edit of ONE element of one artboard
export async function prepare(project) {
  const f = join(project, '.design/ui/Homepage.tsx');
  let src = readFileSync(f, 'utf8');
  const m = src.match(/(    <div data-cd-id="footer"[\s\S]*?\n    <\/div>\n)(  <\/div>\n\);)/);
  if (!m) throw new Error('footer block not found');
  src = src.replace(m[1], '');
  src = src.replace('<Hero w={1440} />', `<div style={{ width: 1440, background: "#fff", color: "#16181d", fontFamily: "system-ui, sans-serif" }}>\n            <Hero w={1440} />\n${m[1].replace(/^/gm, '    ')}          </div>`);
  writeFileSync(f, src);
}
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const hp = (s) => `[data-dc-screen="desktop"] ${s}`;
  await h.open('ui-homepage', 3000);
  await k.fold();
  await k.ai(true);
  const c = page.locator('[data-testid="chat-composer"] textarea, [data-testid="chat-composer"] [contenteditable]').first();
  await c.click({ timeout: 4000 });
  await page.keyboard.type('Add a footer: links, our address, and a newsletter signup.');
  await page.keyboard.press('Enter');
  await sleep(5000);
  await h.step(`${D}/ed-edge-ai.chat`, 'AI is adding the footer (nothing selected): the chat row with Stop', 'AI panel, ask, 5 s in', async () => {});
  await h.step(`${D}/ed-edge-ai`, 'AI edits the footer, you edit the headline', 'AI panel, ask (fake agent through the design hook), then double-click the headline and type', async () => {
    await k.deep(hp('[data-cd-id="headline"]'), 3).catch(() => {});
    await k.dbl(hp('[data-cd-id="headline"]')).catch(() => {});
    if (await k.fr.locator('.dc-text-editing').count()) { await page.keyboard.press('End'); await page.keyboard.type(' v Brně'); }
    await sleep(1500);
  });
}
