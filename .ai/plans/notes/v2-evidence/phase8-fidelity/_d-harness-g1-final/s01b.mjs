import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { base } from './fx.mjs';
import { REPO } from './lib.mjs';
export const fixture = base;
const D = '01';
export const env = {
  MAUDE_ACP_ADAPTER_ENTRY: join(REPO, '.scr/h/fake-acp/g1-agent.mjs'),
  MAUDE_ACP_RUNTIME: execFileSync('which', ['bun'], { encoding: 'utf8' }).trim(),
  MAUDE_CLAUDE_BIN: join(REPO, '.scr/h/fake-acp/claude-stub.sh'),
  FAKE_ACP_SDK: join(REPO, 'apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js'),
  G1_AGENT_STEP_MS: '300',
};
export async function run(h) {
  const { page, sleep, ctx } = h;
  const fr = page.frameLocator('[data-testid="canvas-frame"]');
  const act = async (id, q) => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type(q); await sleep(800);
    await page.locator(`[data-testid="palette-row-action:${id}"]`).first().click(); await sleep(1500);
  };
  await act('canvas.new', 'new canvas');
  await sleep(5500);
  await h.step(`${D}/cf-blank`, '⌘N — a blank canvas', '⌘K › New canvas', async () => {});
  await h.click('panel-icon-assistant');
  await sleep(1000);
  await h.tid('chat-composer').locator('textarea, [contenteditable]').first().click({ timeout: 4000 });
  await page.keyboard.type('A calm landing page for Studio site — hero, three services, a pricing teaser');
  await page.keyboard.press('Enter');
  await sleep(300);
  await h.click('ai-chat-hide').catch((e) => console.log('hide fail'));
  await sleep(6000);
  await h.step(`${D}/cf-ai-done.toast`, 'Done — AI panel folded, the result toast', 'send the sentence, fold the AI panel, wait for the draft', async () => {});
  await h.click('panel-icon-left').catch(() => {});
  await sleep(600);
  // select
  await fr.locator('[data-cd-id="desktop-headline"]').first().click({ timeout: 6000 });
  await sleep(1500);
  await h.step(`${D}/cf-select-tweak`, 'Select — the inspector arrives', 'click the Desktop headline', async () => {});
  await h.esc(2);
  // frames & text
  await fr.locator('[data-cd-id="desktop-headline"]').first().dblclick({ timeout: 6000 });
  await sleep(700);
  await fr.locator('[data-cd-id="desktop-headline"]').first().dblclick({ timeout: 6000 });
  await sleep(900);
  await page.keyboard.press('End');
  await page.keyboard.type(' for people');
  await sleep(500);
  await h.step(`${D}/cf-frames-text`, 'Text in place — type right on the artboard', 'double-click the headline, type', async () => {});
  await h.esc(2);
  // duplicate at another width
  await fr.locator('[data-dc-screen="desktop"] .dc-artboard-label').first().click({ button: 'right', timeout: 6000 });
  await sleep(800);
  await h.step(`${D}/cf-duplicate-width.menu`, 'Right-click an artboard — the artboard menu', 'right-click Desktop', async () => {});
  const dup = fr.getByText('Duplicate at another width', { exact: false }).first();
  await dup.hover({ timeout: 3000 }).catch((e) => console.log('dup hover fail', String(e.message).split('\n')[0]));
  await sleep(700);
  await h.step(`${D}/cf-duplicate-width`, 'Duplicate at another width ▸ widths', 'hover the row', async () => {});
  await fr.getByText('Laptop', { exact: false }).first().click({ timeout: 3000 }).catch((e) => console.log('laptop fail', String(e.message).split('\n')[0]));
  await sleep(2500);
  await page.keyboard.press('Meta+0');
  await sleep(1200);
  await h.step(`${D}/cf-duplicate-done`, 'The copy lands in line', 'Laptop picked, ⌘0 fits', async () => {});
  // add artboard (F)
  await page.mouse.click(1000, 900);
  await page.keyboard.press('f');
  await sleep(900);
  await h.step(`${D}/cf-add-artboard`, 'F — a new artboard, any kind', 'press F', async () => {});
  await h.esc(3);
  // status words (Edit mode) — the cluster, local then "offline" (navigator.onLine only: the local server stays reachable)
  await h.step(`${D}/cf-status-words.local`, 'Share cluster — Local project', 'top-right cluster in Edit', async () => {});
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); window.dispatchEvent(new Event('offline')); });
  await sleep(1500);
  await h.step(`${D}/cf-status-words.offline`, 'Share cluster — offline (navigator.onLine=false)', 'offline event, network stays up', async () => {});
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true }); window.dispatchEvent(new Event('online')); });
  await sleep(800);
  // sticky + comment
  await page.keyboard.press('Meta+0'); await sleep(900); await page.keyboard.press('n');
  await sleep(900);
  await h.step(`${D}/cf-sticky-comment.preview`, 'N — Preview with Sticky', 'press N', async () => {});
  await page.mouse.click(1000, 800);
  await sleep(900);
  await h.step(`${D}/cf-sticky-comment.sticky`, 'A sticky dropped', 'N, click', async () => {});
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await sleep(700);
  await fr.locator('[data-cd-id="desktop-cta"]').first().click({ timeout: 6000 }).catch(async () => { await page.mouse.click(700, 400); });
  await sleep(1200);
  await h.step(`${D}/cf-sticky-comment.compose`, 'A comment pinned on the button', 'C, click the button', async () => {});
  await page.keyboard.type('Can the button say Book a call?');
  await sleep(500);
  await h.step(`${D}/cf-sticky-comment`, 'A sticky and a comment', 'N, click for a sticky, C, click the button, type', async () => {});
  await h.esc(3);
  await h.click('palette-mode-edit').catch(() => {});
  // offline create
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); window.dispatchEvent(new Event('offline')); });
  await sleep(1000);
  await act('canvas.new', 'new canvas');
  await sleep(4500);
  await h.step(`${D}/cf-offline-create`, 'A new canvas with no internet', 'navigator offline, ⌘K › New canvas', async () => {});
}
