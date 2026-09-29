// Probe: does a selection made in client B leak into client A via the shared _active.json?
import { createRequire } from 'node:module';
const require = createRequire('/Users/iagh/git/personal/maude/apps/studio/package.json');
const { chromium } = require('playwright');
const X = '/Users/iagh/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
async function open() {
  const b = await chromium.launch({ executablePath: X }); const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await p.goto('http://localhost:4712/'); await p.click('[data-testid="canvas-row-ui-team-structure"]');
  await p.waitForTimeout(4000); return { b, p, f: p.frames().find(f => f.url().includes('_canvas-shell')) };
}
const st = (f) => f.evaluate(() => ({ own: document.querySelectorAll('.dc-cv-halo--selected,.dc-cv-halo--selected-member').length, peerSel: document.querySelectorAll('.dc-peer-selection').length, cursors: document.querySelectorAll('.dc-cursor').length }));
const A = await open();
console.log('A initial', await st(A.f));
await A.f.locator('.dc-canvas').press('Escape'); await A.p.waitForTimeout(800);
console.log('A after Esc', await st(A.f));
const B = await open();
console.log('B initial', await st(B.f), 'A', await st(A.f));
await B.f.locator('[data-dc-screen="b0"] h2').first().click(); await B.p.waitForTimeout(1500);
console.log('after B click: B', await st(B.f), 'A', await st(A.f));
await A.f.locator('.dc-canvas').press('Escape'); await A.p.waitForTimeout(1500);
console.log('after A Esc: B', await st(B.f), 'A', await st(A.f));
await A.b.close(); await B.b.close();
