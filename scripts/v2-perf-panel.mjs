#!/usr/bin/env node
// scripts/v2-perf-panel.mjs — the 93-canvas Canvases panel (V2-8.14), measured in the real studio
// shell on Chromium at dpr 2 (Playwright).
//
//   node scripts/v2-perf-panel.mjs --url http://localhost:4831/ [--runs 5] [--window 1600x1000] [--json]
//
// Per run (a fresh page each time, so the first-load cost is paid every run):
//   firstRowMs   navigation start → the first canvas row is in the DOM and visible
//   rowsInDom    rows mounted when the list first settles (93 canvases: a virtualised list mounts a
//                window of them, the pre-v2 tree mounts them all)
//   scroll       the list scrolled top → bottom → top in 40 steps: rAF frame p95 / max / frames ≥ 50 ms
//   searchMs     typing "c1", "c12", "ui web" into the search field: keystroke → the visible row set
//                changed (p95 over the queries); pre-v2 shells without the field report null
//   openMs       a row click → the canvas iframe shows its first artboard
// Prints one JSON object (`--json`) or a table of the median over the runs.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(HERE, '..', 'apps', 'studio', 'package.json'));
const { chromium } = req('playwright');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const url = opt('--url', '');
const RUNS = Number(opt('--runs', '5'));
const [W, H] = opt('--window', '1600x1000').split('x').map(Number);
if (!url) {
  console.error('usage: v2-perf-panel.mjs --url <studio root> [--runs 5] [--json]');
  process.exit(2);
}
const med = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

const ROW =
  '[data-testid^="canvas-row-"]:not([data-testid^="canvas-row-menu"]):not([data-testid^="canvas-row-meta"]):not([data-testid^="canvas-row-sub"]):not([data-testid^="canvas-row-trashed"])';
const SEARCH = '[data-testid="canvas-search"]';

// scroll the list's scroller, top → bottom → top, 40 steps, measuring rAF deltas
const scrollEval = async (rowSel) => {
  const row = document.querySelector(rowSel);
  let el = row?.parentElement;
  while (
    el &&
    el !== document.body &&
    !(el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible')
  )
    el = el.parentElement;
  if (!el || el === document.body) return { scrollable: false };
  const frames = [];
  let last = 0;
  let run = true;
  const tick = (t) => {
    if (last) frames.push(t - last);
    last = t;
    if (run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const max = el.scrollHeight - el.clientHeight;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i <= 40; i++) {
      el.scrollTop = pass === 0 ? (max * i) / 40 : max - (max * i) / 40;
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
  }
  run = false;
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    scrollable: true,
    scrollHeight: el.scrollHeight,
    n: frames.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted[sorted.length - 1],
    long: frames.filter((f) => f >= 50).length,
  };
};

async function oneRun(browser) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const out = {};
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(ROW, { state: 'visible', timeout: 30000 });
  out.firstRowMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  out.rowsInDom = await page.evaluate((sel) => document.querySelectorAll(sel).length, ROW);
  out.rowsAfterFilter = null;

  out.scroll = await page.evaluate(scrollEval, ROW);

  // search: keystroke → visible row set changes
  if (await page.$(SEARCH)) {
    const input =
      (await page.$(`${SEARCH} input`)) ||
      (await page.$(`input${SEARCH}`)) ||
      (await page.$(SEARCH));
    const lat = [];
    for (const q of ['c1', 'c12', 'ui web', 'zzz', 'c9']) {
      await input.fill('');
      await page.waitForTimeout(300);
      const before = await page.evaluate(
        (s) => [...document.querySelectorAll(s)].map((e) => e.dataset.testid).join('|'),
        ROW
      );
      const t = Date.now();
      await input.type(q, { delay: 0 });
      await page
        .waitForFunction(
          ([s, b]) =>
            [...document.querySelectorAll(s)].map((e) => e.dataset.testid).join('|') !== b,
          [ROW, before],
          { timeout: 5000, polling: 'raf' }
        )
        .catch(() => {});
      lat.push(Date.now() - t);
    }
    out.searchMs = { p95: pct(lat, 0.95), max: Math.max(...lat), all: lat };
    // every canvas in one flat list: "c" matches all 93 names, then scroll that
    await input.fill('c');
    await page.waitForTimeout(800);
    out.rowsFlat = await page.evaluate((sel) => document.querySelectorAll(sel).length, ROW);
    out.scrollFlat = await page.evaluate(scrollEval, ROW);
    await input.fill('');
    await page.waitForTimeout(300);
  } else out.searchMs = null;

  // open one canvas: row click → first artboard in the canvas frame
  const target = await page.$('[data-testid="canvas-row-ui-c12"]');
  if (target) {
    const t = Date.now();
    await target.click();
    let ms = null;
    for (let i = 0; i < 240; i++) {
      const f = page.frames().find((fr) => /_canvas-shell/.test(fr.url()));
      if (
        f &&
        (await f
          .evaluate(() => document.querySelectorAll('[data-dc-screen]').length)
          .catch(() => 0)) > 0
      ) {
        ms = Date.now() - t;
        break;
      }
      await page.waitForTimeout(100);
    }
    out.openMs = ms;
  } else out.openMs = null;
  await ctx.close();
  return out;
}

const browser = await chromium.launch({
  executablePath: process.env.MAUDE_BROWSER_EXECUTABLE || undefined,
});
const runs = [];
try {
  for (let i = 0; i < RUNS; i++) {
    runs.push(await oneRun(browser));
    process.stderr.write(
      `→ run ${i + 1}/${RUNS}: first row ${runs[i].firstRowMs} ms, rows ${runs[i].rowsInDom}, scroll p95 ${r1(runs[i].scroll?.p95)} ms\n`
    );
  }
} finally {
  await browser.close();
}
const kept = runs.slice(1); // the first run warms the server's caches
const k = kept.length ? kept : runs;
const summary = {
  url,
  runs: runs.length,
  kept: k.length,
  firstRowMs: r1(med(k.map((r) => r.firstRowMs))),
  firstRowMax: Math.max(...k.map((r) => r.firstRowMs)),
  rowsInDom: med(k.map((r) => r.rowsInDom)),
  scrollP95: r1(med(k.map((r) => r.scroll?.p95))),
  scrollMax: r1(Math.max(...k.map((r) => r.scroll?.max ?? 0))),
  scrollLong: med(k.map((r) => r.scroll?.long)),
  scrollHeight: k[0]?.scroll?.scrollHeight ?? null,
  rowsFlat: med(k.map((r) => r.rowsFlat)),
  scrollFlatP95: r1(med(k.map((r) => r.scrollFlat?.p95))),
  scrollFlatMax: r1(Math.max(...k.map((r) => r.scrollFlat?.max ?? 0))),
  scrollFlatLong: med(k.map((r) => r.scrollFlat?.long)),
  scrollFlatHeight: k[0]?.scrollFlat?.scrollHeight ?? null,
  searchP95: r1(med(k.map((r) => r.searchMs?.p95))),
  searchMax: k.some((r) => r.searchMs) ? Math.max(...k.map((r) => r.searchMs?.max ?? 0)) : null,
  openMs: r1(med(k.map((r) => r.openMs))),
  raw: runs,
};
if (argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
else {
  const { raw, ...s } = summary;
  console.log(JSON.stringify(s, null, 2));
}
