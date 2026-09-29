// EXP1 — floating-comment orphan-delete harness (issues #134/#136).
// Usage: node exp1-comments.mjs <port> <projectRoot> <outJson>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const require = createRequire('/Users/iagh/git/personal/maude/apps/studio/package.json');
const { chromium } = require('playwright');

const [port, root, out] = process.argv.slice(2);
const commentsFile = `${root}/.design/_comments/ui-board.json`;
const t0 = Date.now();
const log = [];
const L = (msg, extra = {}) => {
  const e = { t: Date.now() - t0, msg, ...extra };
  log.push(e);
  console.log(JSON.stringify(e));
};

function readComments() {
  if (!existsSync(commentsFile)) return [];
  try {
    const j = JSON.parse(readFileSync(commentsFile, 'utf8'));
    const arr = Array.isArray(j) ? j : j.comments || [];
    return arr.map((c) => ({ id: c.id, text: c.text, selector: c.selector, status: c.status }));
  } catch (e) {
    return [{ parseError: String(e) }];
  }
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROME || '/Users/iagh/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const wsSent = [];
page.on('websocket', (ws) => {
  ws.on('framesent', (f) => {
    const s = String(f.payload);
    if (/comments-(add|delete|patch)/.test(s)) {
      wsSent.push({ t: Date.now() - t0, url: ws.url(), payload: s.slice(0, 400) });
      L('WS SENT', { url: ws.url(), payload: s.slice(0, 200) });
    }
  });
});
page.on('console', (m) => {
  if (m.type() === 'error') L('console.error', { text: m.text().slice(0, 200) });
});

await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('[data-testid="canvas-row-ui-board"]', { timeout: 20000 });
await page.click('[data-testid="canvas-row-ui-board"]');
await page.waitForSelector('[data-testid="canvas-frame"]', { timeout: 20000 });
let frame;
for (let i = 0; i < 60 && !frame; i++) {
  frame = page.frames().find((f) => /_canvas|canvas=|\.tsx/.test(f.url()) && f !== page.mainFrame());
  if (!frame) await page.waitForTimeout(250);
}
L('frame', { url: frame.url() });
await frame.waitForSelector('[data-dc-screen="a1"]', { timeout: 20000 });
await frame.waitForSelector('g[data-id="sticky_1"]', { timeout: 20000 }).catch(() => L('sticky not found'));
await page.waitForTimeout(1500);

const fl = page.frameLocator('[data-testid="canvas-frame"]');
async function box(sel) {
  const b = await fl.locator(sel).first().boundingBox();
  return b;
}
const titleBox = await box('#alpha-title');
const stickyBox = await box('g[data-id="sticky_1"] path');
const a2Box = await box('[data-dc-screen="a2"]');
L('boxes', { titleBox, stickyBox, a2Box });

async function pinStats() {
  return frame.evaluate(() => {
    const pins = [...document.querySelectorAll('.cm-pin')];
    return {
      total: pins.length,
      visible: pins.filter((p) => p.style.display !== 'none').length,
    };
  });
}

async function armComment() {
  // Focus the canvas without selecting anything, then press C (input-router k==='c').
  await frame.evaluate(() => window.focus());
  await page.keyboard.press('Escape');
  await fl.locator('body').press('c');
  await page.waitForTimeout(300);
}

async function runCase(name, x, y) {
  L(`CASE ${name} start`, { x, y });
  const before = readComments().length;
  await armComment();
  await page.mouse.click(x, y);
  const ta = fl.locator('.cm-composer__textarea');
  try {
    await ta.waitFor({ timeout: 4000 });
  } catch {
    L(`CASE ${name}: composer did not open`);
    return { name, composerOpened: false };
  }
  const selectorChip = await fl.locator('.cm-composer__selector').first().textContent().catch(() => null);
  await ta.fill(`comment ${name} ${Date.now()}`);
  await fl.locator('.cm-composer .cm-btn--primary').click();
  const submitAt = Date.now() - t0;
  L(`CASE ${name} submitted`, { selectorChip });
  const samples = [];
  let persistedAt = null;
  let deletedAt = null;
  let myId = null;
  for (let i = 0; i <= 20; i++) {
    const cs = readComments();
    const mine = cs.find((c) => c.text && c.text.startsWith(`comment ${name}`));
    const ps = await pinStats();
    const now = Date.now() - t0;
    samples.push({ dt: now - submitAt, onDisk: !!mine, diskCount: cs.length, pins: ps });
    if (mine && persistedAt == null) {
      persistedAt = now - submitAt;
      myId = mine.id;
    }
    if (!mine && persistedAt != null && deletedAt == null) deletedAt = now - submitAt;
    await page.waitForTimeout(500);
  }
  const res = {
    name,
    composerOpened: true,
    selectorChip,
    id: myId,
    before,
    persistedAtMs: persistedAt,
    deletedAtMs: deletedAt,
    finalOnDisk: readComments().some((c) => c.id === myId),
    deleteMsgs: wsSent.filter((w) => myId && w.payload.includes(myId) && w.payload.includes('delete')),
    samples,
  };
  L(`CASE ${name} result`, { persistedAt, deletedAt, final: res.finalOnDisk });
  await page.keyboard.press('Escape');
  return res;
}

const results = [];
results.push(await runCase('a-element', titleBox.x + 20, titleBox.y + titleBox.height / 2));
results.push(await runCase('b-sticky', stickyBox.x + stickyBox.width / 2, stickyBox.y + stickyBox.height / 2));
results.push(await runCase('c-empty', a2Box.x + a2Box.width / 2, a2Box.y + a2Box.height + 200));
await page.screenshot({ path: out.replace(/\.json$/, '.png') });
writeFileSync(out, JSON.stringify({ results, wsSent, log, finalComments: readComments() }, null, 2));
await browser.close();
