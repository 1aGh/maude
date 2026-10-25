// round 7 (p8-c7-modes): the Combine-kampan states — present menu in Edit with a selected artboard, full-screen stage,
// the kinds on one screen (contact sheet of the real Present frames), Preview with stickies + the AI panel
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { studio } from './fx4.mjs';
import { REPO } from './lib.mjs';
export const fixture = studio;
export const page = { w: 1440, h: 900, channel: true };
export const env = {
  MAUDE_ACP_ADAPTER_ENTRY: join(REPO, '.scr/impl/fake-agent.mjs'),
  MAUDE_ACP_RUNTIME: '/Users/iagh/.bun/bin/bun',
  MAUDE_CLAUDE_BIN: join(REPO, 'apps/desktop/e2e/fixtures/fake-acp/claude-stub.sh'),
  FAKE_ACP_SDK: join(REPO, 'apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js'),
};
const D = '04-modes';
export async function run(h) {
  const { page, sleep, theme } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const pick = async (re) => {
    const loc = f.getByText(re).first();
    const b = await loc.boundingBox({ timeout: 5000 });
    await page.mouse.click(b.x + Math.min(14, b.width / 2), b.y + b.height / 2);
    await sleep(600);
  };
  const POST = /^Post 1:1/;
  await h.open('ui-combine-kampan', 3500);
  await pick(POST);
  await h.step(`${D}/md-present-menu`, 'Edit: Post 1:1 selected, Present ⌄ open', 'select the artboard, Present ⌄', async () => {
    await h.click('mode-present-menu');
    await sleep(600);
  });
  await h.esc(1);
  await sleep(300);
  await pick(POST);
  await page.keyboard.press('Alt+Meta+Enter');
  await sleep(1100);
  await h.step(`${D}/md-present-full`, 'Present from the selection: the dark stage and the controls', '⌥⌘↵ on Post 1:1, shot inside the 2 s the controls stay', async () => {}, { now: true });
  await h.esc(2);
  await sleep(900);
  // the kinds on one screen: one real Present frame per kind, laid on one sheet
  const kinds = [['web', /^Web ·/], ['post', POST], ['story', /^Story 9:16/], ['poster', /^A4/], ['teaser', /^16:9/]];
  const files = [];
  for (const [k, re] of kinds) {
    await pick(re);
    await page.keyboard.press('Alt+Meta+Enter');
    await sleep(1100);
    await h.step(`${D}/md-edge-mixed-${k}`, `Present · Artboards: ${k}`, 'select, ⌥⌘↵', async () => {}, { now: true });
    files.push(join(process.env.SHOTS_OUT, D, `md-edge-mixed-${k}-${theme}.jpg`));
    await h.esc(2);
    await sleep(900);
  }
  const out = join(process.env.SHOTS_OUT, D, `md-edge-mixed-${theme}.jpg`);
  files.splice(3, 2, files[4], files[3]); // web, post, story / teaser, poster
  execFileSync('magick', ['montage', '-font', '/System/Library/Fonts/Helvetica.ttc', ...files, '-tile', '3x2', '-geometry', '720x450+6+6', '-background', theme === 'dark' ? '#0e1013' : '#d8dbe0', out]);
  console.log(`shot ${D}/md-edge-mixed-${theme} (contact sheet)`);
  // md-draw: Preview on Combine-kampan, the Sticky tool armed (its colours above the toolbar), two stickies down, AI beside
  await h.click('palette-mode-preview');
  await sleep(2200);
  await f.locator('[data-testid="toolbar-slot-sticky"]').first().click({ timeout: 4000 });
  await sleep(500);
  await page.mouse.click(1000, 300);
  await sleep(700);
  await page.keyboard.type('Logo větší?');
  await h.esc(1);
  await sleep(500);
  await f.locator('[data-testid="toolbar-slot-sticky"]').first().click({ timeout: 4000 }).catch(() => {});
  await sleep(400);
  await page.mouse.click(1000, 520);
  await sleep(700);
  await page.keyboard.type('Datum tučně — 14. 3.');
  await h.esc(1);
  await sleep(500);
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(900);
  await f.locator('[data-testid="toolbar-slot-sticky"]').first().click({ timeout: 4000 }).catch(() => {});
  await sleep(500);
  await h.step(`${D}/md-draw`, 'Preview: stickies on the annotation layer, Sticky armed, AI beside', 'Preview, Sticky ×2, AI panel', async () => {});
}
