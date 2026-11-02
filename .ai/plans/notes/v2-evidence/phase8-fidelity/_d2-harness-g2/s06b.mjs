import { alligators } from './fx3.mjs';
import { REPO } from './lib.mjs';
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const fixture = async () => {
  const d = await alligators();
  writeFileSync(
    join(d, '.design/ui/Broken.tsx'),
    `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";\nexport default function Broken() {\n  return (\n    <DesignCanvas>\n      <DCSection id="s" title="Pricing">\n        <DCArtboard id="a" label="Desktop" width={400} height={300}>\n          <span className="pr-plan">\n            <b>{plan.name}</b>\n            <i>{plan.price}</span>\n          </span>\n        </DCArtboard>\n      </DCSection>\n    </DesignCanvas>\n  );\n}\n`
  );
  return d;
};
export const page = { w: 1440, h: 900, channel: true };
const D = '06-advanced';
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const palette = async (q, enter = true) => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type(q);
    await sleep(700);
    if (enter) { await page.keyboard.press('Enter'); await sleep(1500); }
  };
  const fold = async (tid) => {
    await page.locator(`[data-testid="${tid}"]`).first().locator('text=/^\\s*Advanced\\s*$/').first().click({ timeout: 4000 });
    await sleep(700);
  };
  const same = async () => {};
  await h.open('ui-combine-kampan', 3500);
  const ic = page.locator('[data-testid="panel-icon-left"]').first();
  if (await ic.count()) { await ic.click(); await sleep(900); }
  await h.step(`${D}/ad-left`, 'Canvases › Advanced', 'open the Advanced fold at the foot of Canvases', async () => { await h.click('canvases-advanced'); await sleep(600); });
  await h.step(`${D}/ad-left-layers`, 'Layers › Advanced', 'Layers tab, open its Advanced fold', async () => { await h.click('panel-tab-layers'); await sleep(700); await h.click('layers-advanced'); await sleep(600); });
  await h.click('panel-tab-tree').catch(() => {});
  await h.click('canvases-advanced').catch(() => {});
  await h.step(`${D}/ad-inspector`, 'Inspector, with the Advanced rows', 'meta-click the headline, open Advanced in the Inspector', async () => {
    await f.locator('[data-cd-id="post-headline"]').first().click({ modifiers: ['Meta'], timeout: 5000 });
    await sleep(1000);
    await page.locator('text="Advanced" >> visible=true').last().click({ timeout: 4000 });
    await sleep(800);
  });
  await h.esc(2);
  await h.step(`${D}/ad-ai`, 'AI chat › Advanced', 'AI panel, › Advanced', async () => { await h.click('panel-icon-assistant'); await sleep(700); await h.click('ai-advanced'); });
  await h.step(`${D}/ad-pinned`, 'AI chat pinned to the side, Advanced still open', 'ai-chat-pin', async () => { await h.click('ai-chat-pin'); await sleep(1200); });
  await h.click('ai-chat-pin').catch(() => {});
  await h.click('ai-advanced').catch(() => {});
  await h.click('ai-chat-hide').catch(() => {});
  await h.step(`${D}/ad-share`, 'Share › Advanced — other ways in', 'Share sheet, open the fold', async () => { await page.evaluate(() => { window.__T = window.__TAURI__; delete window.__TAURI__; }); await h.click('share-cluster-share'); await sleep(900); await h.click('share-other-ways-toggle'); await sleep(500); });
  await h.esc(2);
  await h.step(`${D}/ad-export`, 'Export › Advanced', '⇧⌘E, open the fold', async () => { await page.keyboard.press('Shift+Meta+e'); await sleep(900); await h.click('export-advanced-toggle'); });
  await h.esc(3);
  await h.step(`${D}/ad-history`, 'Version history › Advanced', '⌥⌘H, open the fold', async () => {
    await page.keyboard.press('Alt+Meta+h');
    await sleep(1200);
    await page.locator('[data-testid="vh-advanced"]').count().then(() => {});
    await page.locator('text="Advanced" >> visible=true').last().click({ timeout: 4000 });
    await sleep(900);
  });
  await h.esc(2);
  await page.mouse.click(1405, 94).catch(() => {});
  await h.step(`${D}/ad-logs`, 'Diagnostics — Logs', '⌘K › Logs', async () => { await palette('diagnostics', false); await h.click('palette-row-action:diag.logs'); await sleep(1200); });
  await h.step(`${D}/ad-diag`, 'Diagnostics — Server', 'Server tab', async () => { await sleep(300); });
  await h.step(`${D}/ad-syncd`, 'Diagnostics — Sync', 'Sync tab', async () => { await sleep(300); });
  await h.step(`${D}/ad-ai-diag`, 'Diagnostics — AI', 'AI tab', async () => { await sleep(300); });
  await h.esc(3);
  await h.step(`${D}/ad-settings`, 'Settings', '⌘K › Settings', async () => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('Settings'); await sleep(800);
    await page.locator('[data-testid="palette-row-action:settings.open"]').first().click(); await sleep(1200);
  });
  await h.esc(3);
  await h.step(`${D}/ad-search`, '⌘K finds the advanced rows too', '⌘K, type “advanced”', async () => { await palette('advanced', false); });
  await h.esc(2);
  await h.step(`${D}/ad-code`, 'The canvas as code', '⌘K › code', async () => { await palette('code', false); });
  await h.esc(2);
  await h.step(`${D}/ad-edge-syntax`, 'Broken canvas code: the card in words', 'open Broken, Show details', async () => {
    await h.open('ui-broken', 3500);
    await page.getByText('Show details').first().click({ timeout: 4000 }).catch(() => {});
    await sleep(800);
  });
}
