// EXP4 — #131 presence stutter, observer A = REAL Safari (safaridriver), peer B = headless Chromium (Playwright).
// node exp4-safari.mjs --port N --cond C0|C1|C1f|C2|C3|CX --runs 3 --fit 1 --out file.json
// C0 A alone · C1 B joined idle · C1f B joined then its page frozen (CDP lifecycle) — no publishes, process alive
// C2 B moving · C3 B moving + element selected (A's own selection cleared) · CX control: 2nd Chromium on about:blank
//   running the same 16 ms mousemove loop, NOT connected to the canvas (machine-load confound only).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire('/Users/iagh/git/personal/maude/apps/studio/package.json');
const pw = require('playwright');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const PORT = args.port, COND = args.cond, RUNS = Number(args.runs || 3), FIT = args.fit === '1', WINDOW = 10000;
const DP = Number(args.dport || 4798);
const CHROME = '/Users/iagh/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wd(method, path, body) {
  const res = await fetch(`http://localhost:${DP}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (j?.value?.error) throw new Error(`${j.value.error}: ${j.value.message}`);
  return j.value;
}
async function driverUp() { try { const r = await fetch(`http://localhost:${DP}/status`); return (await r.json())?.value?.ready !== undefined; } catch { return false; } }

const measureSrc = `
const done = arguments[arguments.length - 1];
const windowMs = arguments[0], gesture = arguments[1], parts = arguments[2] || 'wm';
const frames = []; let lastT = 0, i = 0;
const host = document.querySelector('.dc-canvas');
const rect = host.getBoundingClientRect();
const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
const world = document.querySelector('.dc-world');
const tf0 = world ? getComputedStyle(world).transform : '';
const g0 = window.__gbcr || 0;
let lt = 0; try { new PerformanceObserver((l) => { lt += l.getEntries().length; }).observe({ entryTypes: ['longtask'] }); } catch (e) { lt = -1; }
const t0 = performance.now();
const tick = (t) => {
  if (lastT) frames.push(t - lastT); lastT = t;
  if (gesture) { const ph = i / 60;
    if (parts.includes('w')) host.dispatchEvent(new WheelEvent('wheel', { deltaX: Math.round(14 * Math.sin(ph * 1.3)), deltaY: Math.round(10 * Math.cos(ph * 0.9)), clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    if (parts.includes('m')) host.dispatchEvent(new MouseEvent('mousemove', { clientX: cx + 200 * Math.sin(ph), clientY: cy + 150 * Math.cos(ph * 1.7), bubbles: true })); }
  i++;
  if (performance.now() - t0 < windowMs) requestAnimationFrame(tick);
  else { const s = frames.slice().sort((a, b) => a - b); const pct = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100;
    done(JSON.stringify({ frames: s.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: Math.round(s[s.length - 1] * 100) / 100, over33: frames.filter((f) => f > 33.4).length, over50: frames.filter((f) => f > 50).length, longtasks: lt, gbcr: (window.__gbcr || 0) - g0,
      foreignCursors: document.querySelectorAll('.dc-cursor').length, peerSel: document.querySelectorAll('.dc-peer-selection').length, ownHalos: document.querySelectorAll('.dc-cv-halo--selected,.dc-cv-halo--selected-member').length,
      panApplied: world ? getComputedStyle(world).transform !== tf0 : null })); } };
requestAnimationFrame(tick);`;

async function openB(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.click('[data-testid="canvas-row-ui-team-structure"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="canvas-frame"]', { timeout: 30000 });
  let frame; for (let i = 0; i < 120 && !frame; i++) { frame = page.frames().find((f) => f.url().includes('_canvas-shell')); if (!frame) await page.waitForTimeout(250); }
  await frame.waitForSelector('[data-dc-screen="b0"]', { timeout: 60000 });
  return { ctx, page, frame };
}
const moverSrc = () => { const host = document.querySelector('.dc-canvas') || document.documentElement; const r = host.getBoundingClientRect(); let i = 0;
  window.__mover = setInterval(() => { i++; host.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2 + 300 * Math.sin(i / 20), clientY: r.top + r.height / 2 + 200 * Math.cos(i / 27), bubbles: true })); }, 16); return true; };

let driver = null;
if (!(await driverUp())) { driver = spawn('safaridriver', ['-p', String(DP)], { stdio: 'ignore' }); for (let i = 0; i < 20 && !(await driverUp()); i++) await sleep(500); }
const results = [];
try {
  for (let run = 1; run <= RUNS; run++) {
    const load = execSync('sysctl -n vm.loadavg').toString().trim();
    const { sessionId } = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
    const base = `/session/${sessionId}`;
    const exec = (script, a = []) => wd('POST', `${base}/execute/sync`, { script, args: a });
    let bB = null, B = null;
    try {
      await wd('POST', `${base}/timeouts`, { script: 60000 });
      await wd('POST', `${base}/window/rect`, { x: 0, y: 0, width: 1600, height: 1000 });
      await wd('POST', `${base}/url`, { url: `http://localhost:${PORT}/` });
      for (let i = 0; i < 30; i++) { if (await exec(`const el = document.querySelector('[data-testid="canvas-row-ui-team-structure"]'); if (el) { el.click(); return true; } return false;`)) break; await sleep(1000); }
      for (let i = 0; i < 30; i++) { await sleep(1000); if (Number(await exec(`return document.querySelectorAll('[data-testid="canvas-frame"]').length;`)) > 0) break; }
      const fe = await wd('POST', `${base}/element`, { using: 'css selector', value: '[data-testid="canvas-frame"]' });
      await wd('POST', `${base}/frame`, { id: fe });
      for (let i = 0; i < 90; i++) { await sleep(1000); if (Number(await exec(`return document.querySelectorAll('[data-dc-screen]').length;`)) > 0) break; }
      await sleep(2500);
      await exec(`if (!window.__gbcrPatched) { window.__gbcrPatched = 1; window.__gbcr = 0; const o = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { window.__gbcr++; return o.call(this); }; } return true;`);
      const esc = `for (const t of [document, document.querySelector('.dc-canvas')]) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return document.querySelectorAll('.dc-cv-halo--selected,.dc-cv-halo--selected-member').length;`;
      await exec(esc); await sleep(600);
      if (!process.env.NOCLICK) {
        // A real (WebDriver) user gesture inside the cross-origin frame lifts WebKit's 30 fps rAF cap for un-interacted cross-origin iframes.
        const ce = await wd('POST', `${base}/element`, { using: 'css selector', value: '.dc-canvas' });
        const wh = JSON.parse(await exec(`const r = document.querySelector('.dc-canvas').getBoundingClientRect(); return JSON.stringify([r.width, r.height]);`));
        await wd('POST', `${base}/actions`, { actions: [{ type: 'pointer', id: 'm', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: ce, x: -Math.floor(wh[0] / 2) + 12, y: Math.floor(wh[1] / 2) - 12 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] }).catch((e) => console.error('click', e.message));
        await sleep(500); await exec(esc); await sleep(300);
      }
      if (FIT) { await exec(`const h = document.querySelector('.dc-canvas'); for (const t of [document, h]) t.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', metaKey: true, bubbles: true, cancelable: true })); return true;`); await sleep(4000); }
      if (COND !== 'C0') {
        bB = await pw.chromium.launch({ headless: true, executablePath: CHROME });
        if (COND === 'CX') {
          const p = await (await bB.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
          await p.goto('about:blank'); await p.evaluate(moverSrc); B = { page: p, frame: p.mainFrame() };
        } else {
          B = await openB(bB); await B.page.waitForTimeout(1500);
          if (COND === 'C3') {
            await B.frame.evaluate(() => { const h = document.querySelector('.dc-canvas'); for (const t of [document, h]) t.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', metaKey: true, bubbles: true, cancelable: true })); }); await B.page.waitForTimeout(2500);
            const scr = await B.frame.evaluate(() => { for (const h of document.querySelectorAll('[data-dc-screen] h2')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.left > 80 && r.top > 80 && r.right < innerWidth - 80 && r.bottom < innerHeight - 80) return h.closest('[data-dc-screen]').getAttribute('data-dc-screen'); } return 'b0'; });
            await B.frame.locator(`[data-dc-screen="${scr}"] h2`).first().click(); await B.page.waitForTimeout(800);
            for (let k = 0; k < 6; k++) { const own = await exec(esc); await sleep(800); if (!Number(own)) break; }
          }
          if (COND === 'C2' || COND === 'C3') await B.frame.evaluate(moverSrc);
          if (COND === 'C1f') { const cdp = await B.ctx.newCDPSession(B.page); await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); }
        }
        await sleep(1500);
      }
      const pre = JSON.parse(await exec(`return JSON.stringify({ own: document.querySelectorAll('.dc-cv-halo--selected,.dc-cv-halo--selected-member').length, peerSel: document.querySelectorAll('.dc-peer-selection').length, cursors: document.querySelectorAll('.dc-cursor').length });`));
      let warm = null;
      if (!process.env.NOWARM) warm = JSON.parse(await wd('POST', `${base}/execute/async`, { script: measureSrc, args: [WINDOW, true, process.env.PARTS || 'wm'] }));
      const raw = await wd('POST', `${base}/execute/async`, { script: measureSrc, args: [WINDOW, process.env.NOGESTURE ? false : true, process.env.PARTS || 'wm'] });
      const r = { run, cond: COND, fit: FIT, load, pre, warm: warm && { p50: warm.p50, p95: warm.p95, frames: warm.frames }, canvas: JSON.parse(raw) };
      console.log(JSON.stringify(r)); results.push(r);
    } finally {
      if (bB) await bB.close().catch(() => {});
      await wd('DELETE', base).catch(() => {});
      await sleep(1500);
    }
  }
} finally {
  writeFileSync(args.out, JSON.stringify(results, null, 2));
  if (driver) driver.kill();
}
