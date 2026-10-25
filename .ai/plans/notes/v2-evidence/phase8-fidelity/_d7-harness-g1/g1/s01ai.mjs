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
  G1_AGENT_STEP_MS: '9000',
};
export async function run(h) {
  const { page, sleep } = h;
  const act = async (id, q) => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type(q); await sleep(800);
    await page.locator(`[data-testid="palette-row-action:${id}"]`).first().click(); await sleep(1500);
  };
  await act('canvas.new', 'new canvas');
  await sleep(2500);
  await h.step(`${D}/cf-ai-ready.blank`, 'blank canvas before the sentence', '⌘K › New canvas', async () => {});
  await h.click('panel-icon-assistant');
  await sleep(1200);
  await h.tid('chat-composer').locator('textarea, [contenteditable]').first().click({ timeout: 4000 });
  await page.keyboard.type('A calm landing page for Studio site — hero, three services, a pricing teaser');
  await sleep(400);
  await h.step(`${D}/cf-ai-drafting.typed`, 'AI panel, sentence typed (signed-in AI, fake agent)', 'AI panel › type', async () => {});
  await page.keyboard.press('Enter');
  await sleep(3500);
  await h.step(`${D}/cf-ai-drafting`, 'AI drafts — Desktop on the canvas, Tablet being drawn', '≈3.5 s after Enter (fake agent: Desktop at t0, Tablet at +7 s, Mobile at +14 s)', async () => {});
  await sleep(7000);
  await h.step(`${D}/cf-ai-drafting.tablet`, 'AI drafts — Tablet landed, Mobile next', '≈10.5 s after Enter', async () => {});
  await h.click('ai-chat-hide').catch(() => {});
  // the finish moment: shoot DURING the 1.8 s data-fresh window
  const fresh = page.frameLocator('[data-testid="canvas-frame"]').locator('[data-fresh]').first();
  // D3: a MutationObserver inside the frame (re-armed when the frame reloads) sees the 1.8 s window under load, where polling missed it
  let seen = false;
  for (let i = 0; i < 20 && !seen; i++) {
    seen = await page.frameLocator('[data-testid="canvas-frame"]').locator('body').evaluate((b) => new Promise((res) => {
      const d = b.ownerDocument;
      if (d.querySelector('[data-fresh]')) return res(true);
      const mo = new MutationObserver(() => { if (d.querySelector('[data-fresh]')) { mo.disconnect(); res(true); } });
      mo.observe(d.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-fresh'] });
      setTimeout(() => { mo.disconnect(); res(false); }, 4000);
    }), null, { timeout: 6000 }).catch(() => false);
  }
  if (!seen) console.log('NO data-fresh');
  await h.step(`${D}/cf-ai-done.toast`, 'Done - the panel folded, the finish moment (data-fresh) with the result toast + Undo', 'panel folded, shot the moment [data-fresh] appears', async () => {});
  await h.click('panel-icon-assistant').catch(() => {});
  await sleep(1500);
  await h.step(`${D}/cf-ai-done`, 'Done - the result, panel reopened (settled: label only)', '~2 s after the finish', async () => {});
  await h.esc(1);
  await h.tid('chat-composer').locator('textarea, [contenteditable]').first().click({ timeout: 4000 });
  await page.keyboard.type('Try a dark hero');
  await page.keyboard.press('Enter');
  // the board's moment is AFTER the run: "Done" in the chat and the dark hero on the canvas (a fixed
  // 6 s caught a loaded machine mid-run, where ⌘Z rightly undid the newest LANDED entry - the first draft)
  await page.getByText('the hero on Desktop is dark now').first().waitFor({ timeout: 40000 }).catch((e) => console.log('NO done line', String(e.message).split('\n')[0]));
  await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-cd-id="desktop-page"]').first()
    .evaluate((e) => new Promise((r) => { const t0 = Date.now(); const k = () => (getComputedStyle(e).backgroundColor !== 'rgb(255, 255, 255)' || Date.now() - t0 > 20000 ? r() : setTimeout(k, 200)); k(); }))
    .catch(() => {});
  await sleep(1500);
  await h.step(`${D}/cf-undo-before`, 'AI went too far — the Desktop hero is dark', 'second prompt: Try a dark hero', async () => {});
  // p8-bugs3: ⌘Z while your own run is still working is refused (v2-p8-undo-while-ai-runs-refuses) — wait for its end
  await page.evaluate(async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { const r = await fetch('/_api/ai/runs').then((x) => x.json()).catch(() => null); if (!(r?.mine || []).some((x) => ['running', 'starting', 'needs-you'].includes(x.state))) return; await new Promise((y) => setTimeout(y, 300)); } });
  await sleep(1200);
  await page.mouse.click(1200, 120);
  await page.keyboard.press('Meta+z');
  // D3: shoot while the "Undone — <label> · Redo" toast is still up (it was gone after a fixed 2.5 s + canvas wait)
  await page.getByText(/^Undone/).first().waitFor({ timeout: 8000 }).catch(() => console.log('NO undone toast'));
  // the undone canvas reloads in the frame; on a loaded machine that can take longer than a fixed wait
  await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-cd-id="desktop-page"]').first()
    .evaluate((e) => new Promise((r) => { const t0 = Date.now(); const k = () => (getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)' || Date.now() - t0 > 6000 ? r() : setTimeout(k, 150)); k(); }))
    .catch(() => {});
  await sleep(100);
  const dark = await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-cd-id="desktop-page"]').first().evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => 'n/a');
  console.log('after ⌘Z desktop bg:', dark);
  if (false) {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('undo'); await sleep(800);
    console.log('undo rows', (await page.$$eval('[data-testid^="palette-row"]', (e) => e.map((x) => x.getAttribute('data-testid')))).join(','));
    await page.keyboard.press('Enter'); await sleep(7000);
    console.log('after palette undo desktop bg:', await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-cd-id="desktop-page"]').first().evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => 'n/a'));
  }
  await h.step(`${D}/cf-undo-ai`, '⌘Z undoes AI too', '⌘Z after the dark hero', async () => {});
  // chat search with no hits (05 es-edge-panels)
  const btns = await page.$$eval('[data-testid="ai-chat-header"] button', (e) => e.map((x) => (x.getAttribute('data-testid') || '') + ':' + (x.getAttribute('aria-label') || x.textContent.trim().slice(0, 14))));
  console.log('header buttons', btns.join(' | '));
  await page.locator('[data-testid="ai-chat-header"] button').first().click().catch(() => {});
  await sleep(900);
  const ids = await page.$$eval('[data-testid^="ai-chat-list"]', (e) => e.map((x) => x.getAttribute('data-testid') + '<' + x.tagName + '>'));
  console.log('list ids', ids.join(','));
  await page.locator('[data-testid="ai-chat-list-search"]').first().fill('invoice').catch(() => {});
  await page.locator('[data-testid="ai-chat-list-search"] input').first().fill('invoice').catch(() => {});
  await sleep(900);
  await h.step('05/es-edge-panels.chat-search', 'Chat search with no hits', 'AI panel › chat title › search: invoice', async () => {});
}
