#!/usr/bin/env node
// _perf-probe-open.mjs — the OPEN lane behind `perf.sh --open` (2.0.7 smooth canvases).
//
// The pan/zoom probes start once a canvas is up. This one times what Michal felt: opening a heavy
// canvas inside the studio and moving it WHILE it loads. It opens the studio at `/?open=<rel>`,
// records from the canvas frame's first script (an init script, so nothing before the probe is missed):
//
//   firstArtboard   open → the first `[data-dc-screen]` in the frame
//   firstPaint      open → the first on-screen artboard whose content is drawn (not a placeholder)
//   allVisible      open → every on-screen artboard drawn (no placeholder inside, every <img> decoded)
//   viewportCorrect gesture end → every on-screen artboard drawn (the camera settled: is what you see right?)
//   long tasks      during the open and during the gesture (Chromium; WebKit has none — long FRAMES
//                   (rAF delta ≥ 50 ms) are reported on both engines)
//   gesture frames  a pan + zoom that starts the moment the first artboard is there (the canvas is
//                   still loading), and how long its frames took
//   placeholders    how many on-screen artboards still showed a placeholder when the gesture ended,
//                   and whether any placeholder painted as solid black
//   memory          JS heap (Chromium) and the frame's DOM element count (both engines)
//
// Both engines through Playwright (`--engine chromium|webkit`); WebKit is what the desktop app runs.
// Deliberately not a CI gate (timings swing with machine load) — run before and after, same machine.
//
// Usage: node _perf-probe-open.mjs --url <studio-root> --open <designRoot-relative .tsx>
//          [--engine chromium|webkit] [--window WxH] [--dpr N] [--gesture-ms N] [--timeout S]
//          [--shot <png>] [--shot-mid <png>] [--json]
// Exit: 0 measured / 1 failed / 2 bad args.

import { launchChromium, launchWebkit } from './_pw-launch.mjs';

function parseArgs(argv) {
  const o = {
    url: '',
    open: '',
    engine: 'chromium',
    window: '1600x1000',
    dpr: 2,
    gestureMs: 4000,
    gestureDelay: 0,
    timeout: 60,
    shot: '',
    shotMid: '',
    profile: '',
    bare: null,
    injectCss: '',
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--url') o.url = v();
    else if (a === '--open') o.open = v();
    else if (a === '--engine') o.engine = v();
    else if (a === '--window') o.window = v();
    else if (a === '--dpr') o.dpr = Number(v());
    else if (a === '--gesture-ms') o.gestureMs = Number(v());
    // --gesture-delay: start the gesture this long after the first artboard (a settled canvas), not at once
    else if (a === '--gesture-delay') o.gestureDelay = Number(v());
    else if (a === '--timeout') o.timeout = Number(v());
    else if (a === '--shot') o.shot = v();
    else if (a === '--shot-mid') o.shotMid = v();
    else if (a === '--profile') o.profile = v();
    else if (a === '--bare') o.bare = v();
    else if (a === '--inject-css') o.injectCss = v();
    else if (a === '--json') o.json = true;
    else {
      console.error(`_perf-probe-open.mjs: unknown arg '${a}'`);
      process.exit(2);
    }
  }
  const m = /^(\d{3,5})x(\d{3,5})$/.exec(o.window);
  if (!o.url || !o.open || !m || !['chromium', 'webkit'].includes(o.engine)) {
    console.error('_perf-probe-open.mjs: --url, --open, --window WxH, --engine chromium|webkit');
    process.exit(2);
  }
  o.viewport = { width: Number(m[1]), height: Number(m[2]) };
  return o;
}

// Runs first in every frame; only the canvas frame records.
const INIT = `(() => {
  if (!/_canvas-shell/.test(location.pathname)) return;
  const P = (window.__maudeOpenProbe = { frames: [], long: [], marks: {}, black: 0 });
  const now = () => performance.timeOrigin + performance.now();
  let last = 0;
  const loop = (t) => { const at = performance.timeOrigin + t; if (last) P.frames.push([at, at - last]); last = at; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([performance.timeOrigin + e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  const PH = '.dc-artboard-sleeping, .ds-specimen-pending, [data-dc-placeholder]';
  // On-screen = an IntersectionObserver's answer, never getBoundingClientRect: a poll that forces a
  // synchronous layout of a 40k-node canvas 20x a second measures the probe, not the canvas.
  const onScreen = new Set();
  const io = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target); });
  const watched = new WeakSet();
  P.state = () => {
    let on = 0, drawn = 0, ph = 0, total = 0;
    for (const a of document.querySelectorAll('[data-dc-screen]')) {
      total++;
      if (!watched.has(a)) { watched.add(a); io.observe(a); }
      if (!onScreen.has(a)) continue;
      on++;
      const body = a.querySelector('.dc-artboard-body');
      if (!body) continue;
      if (body.querySelector(PH)) { ph++; continue; }
      let ok = true;
      for (const img of body.getElementsByTagName('img')) if (!img.complete) { ok = false; break; }
      if (ok) drawn++;
    }
    return { total, on, drawn, ph };
  };
  const tick = () => {
    const s = P.state();
    const t = now();
    if (s.total && !P.marks.firstArtboard) P.marks.firstArtboard = t;
    if (s.drawn && !P.marks.firstPaint) P.marks.firstPaint = t;
    if (s.on && s.drawn === s.on && !P.marks.allVisible) P.marks.allVisible = t;
    if (P.marks.allVisible && s.drawn < s.on) P.marks.allVisible = 0; // a later artboard came on screen undrawn
    // viewport correct: once the gesture is over (the probe sets settleFrom), every on-screen artboard drawn
    if (P.settleFrom && !P.marks.viewportCorrect && s.on && s.drawn === s.on) P.marks.viewportCorrect = t;
  };
  setInterval(tick, 100);
})();`;

function stats(deltas) {
  if (!deltas.length) return { n: 0, p50: 0, p95: 0, max: 0, long: 0 };
  const s = [...deltas].sort((a, b) => a - b);
  const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  return {
    n: s.length,
    p50: q(0.5),
    p95: q(0.95),
    max: Math.round(s[s.length - 1]),
    long: s.filter((d) => d >= 50).length,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const browser = await (o.engine === 'webkit' ? launchWebkit() : launchChromium());
  try {
    const ctx = await browser.newContext({ viewport: o.viewport, deviceScaleFactor: o.dpr });
    await ctx.addInitScript(INIT);
    // --inject-css: test a rendering hypothesis against the same build (canvas frame only)
    if (o.injectCss)
      await ctx.addInitScript(
        `if (/_canvas-shell/.test(location.pathname)) document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(o.injectCss)}; document.head.appendChild(s); });`
      );
    const page = await ctx.newPage();
    // Chromium: where the main thread's time went (script vs style vs layout), whole open + gesture.
    const cdp = o.engine === 'chromium' ? await ctx.newCDPSession(page).catch(() => null) : null;
    if (cdp) await cdp.send('Performance.enable').catch(() => {});
    const metrics = async () => {
      if (!cdp) return null;
      const r = await cdp.send('Performance.getMetrics').catch(() => null);
      const m = {};
      for (const { name, value } of r?.metrics || []) m[name] = value;
      return m;
    };
    const t0 = Date.now();
    const enc = o.open.split('/').map(encodeURIComponent).join('/');
    // --bare <query>: the canvas page on its own (top level — every artboard live unless the query says
    // otherwise, e.g. `artboard-live=sleep`), to A/B the runtime without the studio around it.
    await page.goto(
      o.bare != null
        ? `${o.url.replace(/\/$/, '')}/_canvas-shell.html?canvas=${enc}${o.bare ? `&${o.bare}` : ''}`
        : `${o.url.replace(/\/$/, '')}/?open=${enc}`,
      { waitUntil: 'domcontentloaded' }
    );
    let frame = null;
    const deadline = t0 + o.timeout * 1000;
    while (Date.now() < deadline) {
      frame = page.frames().find((f) => /_canvas-shell/.test(f.url())) || null;
      if (frame) {
        const ok = await frame
          .evaluate(() => !!window.__maudeOpenProbe?.marks.firstArtboard)
          .catch(() => false);
        if (ok) break;
      }
      await sleep(25);
    }
    if (!frame) throw new Error('the canvas frame never appeared');
    // The gesture starts NOW — the canvas is still loading. Pan and zoom over the frame.
    const cx = o.viewport.width / 2;
    const cy = o.viewport.height / 2;
    await page.mouse.move(cx, cy);
    if (cdp && o.profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    if (o.gestureDelay > 0) await sleep(o.gestureDelay);
    const m0 = await metrics();
    const g0 = Date.now();
    const steps = Math.max(1, Math.round(o.gestureMs / 16));
    let mid = false;
    let sent = 0;
    for (let i = 0; i < steps && Date.now() - g0 < o.gestureMs; i++) {
      const phase = (Date.now() - g0) / o.gestureMs;
      sent++;
      if (phase < 0.6) {
        // pan: a slow loop to the right/down and back
        const dir = phase < 0.3 ? 1 : -1;
        await page.mouse.wheel(18 * dir, 10 * dir);
      } else {
        // zoom: in then out (ctrl+wheel is a pinch)
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, phase < 0.8 ? -6 : 6);
        await page.keyboard.up('Control');
      }
      if (!mid && o.shotMid && Date.now() - g0 > o.gestureMs * 0.25) {
        mid = true;
        await page.screenshot({ path: o.shotMid });
      }
      await sleep(16);
    }
    const g1 = Date.now();
    await frame
      .evaluate(() => {
        window.__maudeOpenProbe.settleFrom = Date.now();
      })
      .catch(() => {});
    const m1 = await metrics();
    if (cdp && o.profile) {
      const { profile } = await cdp.send('Profiler.stop');
      // self time per function (url:line), top 25 — the raw profile is huge
      const self = new Map();
      const dt = profile.timeDeltas || [];
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      (profile.samples || []).forEach((id, i) => {
        const n = byId.get(id);
        const f = n.callFrame;
        const k = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\//, '')}:${f.lineNumber}`;
        self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000);
      });
      // inclusive time per JS function (each function counted once per sample), to find the caller of a native hot spot
      const parent = new Map();
      for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
      const incl = new Map();
      (profile.samples || []).forEach((id, i) => {
        const seen = new Set();
        for (let cur = id; cur != null; cur = parent.get(cur)) {
          const f = byId.get(cur).callFrame;
          if (!f.url) continue;
          const k = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\//, '').replace(/\?.*$/, '')}:${f.lineNumber}`;
          if (seen.has(k)) continue;
          seen.add(k);
          incl.set(k, (incl.get(k) || 0) + (dt[i] || 0) / 1000);
        }
      });
      // who calls the native hot spots (querySelectorAll, getBoundingClientRect…): native leaf ← nearest JS frame
      const callers = new Map();
      (profile.samples || []).forEach((id, i) => {
        const leaf = byId.get(id).callFrame;
        if (leaf.url || !leaf.functionName || leaf.functionName.startsWith('(')) return;
        let cur = parent.get(id);
        while (cur != null && !byId.get(cur).callFrame.url) cur = parent.get(cur);
        const f = cur != null ? byId.get(cur).callFrame : null;
        const k = `${leaf.functionName} <- ${f ? `${f.functionName || '(anon)'} ${f.url.replace(/^.*\//, '').replace(/\?.*$/, '')}:${f.lineNumber}` : '?'}`;
        callers.set(k, (callers.get(k) || 0) + (dt[i] || 0) / 1000);
      });
      const top = [
        ...[...self]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([k, v]) => `self ${Math.round(v)}ms ${k}`),
        ...[...callers]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([k, v]) => `native ${Math.round(v)}ms ${k}`),
        ...[...incl]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30)
          .map(([k, v]) => `incl ${Math.round(v)}ms ${k}`),
      ];
      (await import('node:fs')).writeFileSync(o.profile, top.join('\n'));
    }
    process.stderr.write(`gesture done ${g1 - g0}ms, ${sent} wheels\n`);
    const endState = await frame.evaluate(() => window.__maudeOpenProbe.state());
    // Settle: wait for every on-screen artboard to be drawn (or the timeout).
    while (Date.now() < deadline) {
      const done = await frame.evaluate(
        () =>
          !!window.__maudeOpenProbe.marks.allVisible &&
          !!window.__maudeOpenProbe.marks.viewportCorrect
      );
      if (done) break;
      await sleep(100);
    }
    await sleep(500);
    const raw = await frame.evaluate(() => {
      const P = window.__maudeOpenProbe;
      const mem = performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null;
      return {
        frames: P.frames,
        long: P.long,
        marks: P.marks,
        nodes: document.getElementsByTagName('*').length,
        heapMB: mem,
        state: P.state(),
      };
    });
    if (o.shot) await page.screenshot({ path: o.shot });
    const rel = (t) => (t ? Math.round(t - t0) : null);
    const inGesture = raw.frames.filter(([t]) => t >= g0 && t <= g1).map(([, d]) => d);
    const openEnd = raw.marks.allVisible || Date.now();
    const inOpen = raw.frames.filter(([t]) => t <= g0).map(([, d]) => d);
    const settleEnd = raw.marks.viewportCorrect || Date.now();
    const inSettle = raw.frames.filter(([t]) => t > g1 && t <= settleEnd).map(([, d]) => d);
    const longOpen = raw.long.filter(([t]) => t <= openEnd);
    const longGesture = raw.long.filter(([t]) => t >= g0 && t <= g1);
    const sum = (a) => Math.round(a.reduce((n, [, d]) => n + d, 0));
    const out = {
      canvas: o.open,
      engine: o.engine,
      firstArtboardMs: rel(raw.marks.firstArtboard),
      firstPaintMs: rel(raw.marks.firstPaint),
      allVisibleMs: rel(raw.marks.allVisible),
      // gesture end → every on-screen artboard drawn (the camera settled; what the user looks at is right)
      viewportCorrectMs: raw.marks.viewportCorrect
        ? Math.max(0, Math.round(raw.marks.viewportCorrect - g1))
        : null,
      openFrames: stats(inOpen),
      settleFrames: stats(inSettle),
      gesture: {
        ms: g1 - g0,
        wheelsSent: sent,
        wheelsPerS: Math.round((sent / Math.max(1, g1 - g0)) * 10000) / 10,
        ...stats(inGesture),
      },
      longTasks: {
        open: longOpen.length,
        openMs: sum(longOpen),
        openMax: Math.round(Math.max(0, ...longOpen.map(([, d]) => d))),
        gesture: longGesture.length,
        gestureMs: sum(longGesture),
      },
      placeholdersAtGestureEnd: endState,
      final: raw.state,
      mainThread: m1
        ? Object.fromEntries(
            ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'].map((k) => [
              k,
              {
                open: Math.round((m0?.[k] || 0) * 1000),
                gesture: Math.round((m1[k] - (m0?.[k] || 0)) * 1000),
              },
            ])
          )
        : null,
      domNodes: raw.nodes,
      heapMB: raw.heapMB,
    };
    console.log(o.json ? JSON.stringify(out) : JSON.stringify(out, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`_perf-probe-open.mjs: ${err.message}`);
  process.exit(1);
});
