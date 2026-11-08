// Chromium zoom profile on a live canvas (#169 T8.1 item 3). Playwright + CDP tracing (no agent-browser).
//   node zoom-trace.mjs <port> <canvas rel> [label] [--trace out.json] [--steps N] [--engine chromium|webkit]
// Fits the whole canvas, then runs a ctrl+wheel zoom sweep (in, out, across) and reports rAF frame times
// (p50/p95/max, long frames > 50 ms) and, from the trace, Layout events during the sweep (count, total ms,
// max ms, objects laid out) plus UpdateLayoutTree (style) totals.
import { writeFileSync } from 'node:fs';
import { chromium, webkit } from '/Users/iagh/git/personal/maude/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs';

const [port, rel, label = ''] = process.argv.slice(2);
const opt = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const STEPS = Number(opt('--steps', '60'));
const ENGINE = opt('--engine', 'chromium');
const traceOut = opt('--trace', '');
const b = await (ENGINE === 'webkit' ? webkit : chromium).launch(
  ENGINE === 'chromium' ? { channel: process.env.CH || undefined, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] } : {}
);
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
// the canvas runtime gates window.requestAnimationFrame during a gesture (frame-clock.ts): measure on the native one
await page.addInitScript(() => { window.__nativeRaf = window.requestAnimationFrame.bind(window); });
const url = `http://localhost:${port}/_canvas-shell.html?canvas=${encodeURIComponent(rel)}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('[data-dc-screen]').length > 0, null, { timeout: 60000 });
await page.waitForTimeout(4000); // specimens, fonts, hug heights
if (opt('--inject-css', '')) await page.addStyleTag({ content: opt('--inject-css', '') });
const n = await page.evaluate(() => document.querySelectorAll('[data-dc-screen]').length);
const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
const cx = 800;
const cy = 500;
await page.mouse.move(cx, cy);
// --zoom-in N: zoom in N ctrl+wheel steps first (to where artboards are live DOM, not stills), then settle
const PRE = Number(opt('--zoom-in', '0'));
if (PRE) {
  await page.keyboard.down('Control');
  for (let i = 0; i < Math.abs(PRE); i++) {
    await page.mouse.wheel(0, PRE > 0 ? -40 : 40);
    await page.waitForTimeout(16);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(3000);
}
const zoomNow = () =>
  page.evaluate(() => Number(document.querySelector('.dc-world')?.style.getPropertyValue('--dc-zoom')));
console.log('zoom before sweep', (await zoomNow()).toFixed(3));
const sweep = async (steps, tag) => {
  await page.evaluate(() => {
    window.__ft = [];
    let last = performance.now();
    const tick = (t) => {
      window.__ft.push(t - last);
      last = t;
      if (window.__ftOn) window.__nativeRaf(tick);
    };
    window.__ftOn = true;
    window.__nativeRaf(tick);
  });
  await page.keyboard.down('Control');
  for (let i = 0; i < steps; i++) {
    const phase = Math.floor((i / steps) * 4);
    const DY = Number(opt('--dy', '12')) * (process.argv.includes('--out-first') ? -1 : 1);
    const dy = phase === 0 || phase === 2 ? -DY : DY; // in, out, in, out (or out first)
    if (phase >= 2) await page.mouse.move(300 + ((i * 1000) / steps), 300 + ((i * 400) / steps));
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(16);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const ft = await page.evaluate(() => {
    window.__ftOn = false;
    return window.__ft.slice(1);
  });
  const s = [...ft].sort((a, z) => a - z);
  const q = (p) => s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] ?? 0;
  const z = await zoomNow();
  return { tag, z, frames: ft.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] ?? 0, long: ft.filter((x) => x > 50).length };
};
let cdp = null;
if (ENGINE === 'chromium') {
  cdp = await ctx.newCDPSession(page);
}
let events = [];
if (cdp) {
  const chunks = [];
  cdp.on('Tracing.dataCollected', (e) => chunks.push(...e.value));
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,blink',
    transferMode: 'ReportEvents',
  });
  var first = await sweep(Math.round(STEPS / 3), 'first');
  var warm = await sweep(STEPS, 'warm');
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await done;
  events = chunks;
} else {
  var first = await sweep(Math.round(STEPS / 3), 'first');
  var warm = await sweep(STEPS, 'warm');
}
const fmt = (r) =>
  `${r.tag} (end zoom ${r.z.toFixed(3)}): frames ${r.frames} p50 ${r.p50.toFixed(1)} p95 ${r.p95.toFixed(1)} max ${r.max.toFixed(1)} long>50 ${r.long}`;
console.log(`${ENGINE} ${label} ${rel} — ${n} artboards, ${dom} elements`);
console.log(fmt(first));
console.log(fmt(warm));
if (events.length) {
  const sum = (name) => {
    const ev = events.filter((e) => e.name === name && e.ph === 'X');
    const ms = ev.map((e) => (e.dur ?? 0) / 1000);
    return { n: ev.length, total: ms.reduce((a, z) => a + z, 0), max: Math.max(0, ...ms), ev };
  };
  const lay = sum('Layout');
  const sty = sum('UpdateLayoutTree');
  const paint = sum('Paint');
  const objs = lay.ev.map((e) => e.args?.beginData?.dirtyObjects ?? 0);
  const totalObjs = lay.ev.map((e) => e.args?.beginData?.totalObjects ?? 0);
  console.log(
    'layouts > 16 ms (ms/dirty):',
    lay.ev
      .filter((e) => e.dur > 16000)
      .map((e) => `${(e.dur / 1000).toFixed(0)}/${e.args?.beginData?.dirtyObjects ?? '?'}`)
      .join(' ')
  );
  const sty16 = sty.ev.filter((e) => e.dur > 16000).map((e) => `${(e.dur / 1000).toFixed(0)}/${e.args?.elementCount ?? '?'}`);
  console.log('style > 16 ms (ms/elements):', sty16.join(' '));
  console.log(
    `trace: Layout n ${lay.n} total ${lay.total.toFixed(0)} ms max ${lay.max.toFixed(1)} ms dirtyObjects max ${Math.max(0, ...objs)} (of ${Math.max(0, ...totalObjs)}) · Style n ${sty.n} total ${sty.total.toFixed(0)} ms max ${sty.max.toFixed(1)} · Paint total ${paint.total.toFixed(0)} ms`
  );
  // what invalidated layout: the stacks of the biggest layouts
  const inval = events.filter((e) => e.name === 'LayoutInvalidationTracking' || e.name === 'StyleRecalcInvalidationTracking' || e.name === 'ScheduleStyleRecalculation' || e.name === 'InvalidateLayout');
  const reasons = {};
  for (const e of inval) {
    const k = `${e.name}:${e.args?.data?.reason ?? ''}:${e.args?.data?.nodeName ?? ''}`;
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  console.log('invalidations', JSON.stringify(Object.entries(reasons).sort((a, z) => z[1] - a[1]).slice(0, 14)));
  if (traceOut) writeFileSync(traceOut, JSON.stringify({ traceEvents: events }));
}
await b.close();
