// profile.mjs — CDP CPU profile + timeline trace of the perf.sh gesture, in the studio shell.
// usage: node profile.mjs <worktree> <port> <slug> <outprefix> [--fit-all] [--zoom-only|--pan-only]
import { writeFileSync } from 'node:fs';

const [wt, port, slug, outPrefix, ...rest] = process.argv.slice(2);
const fitAll = rest.includes('--fit-all');
const zoomOnly = rest.includes('--zoom-only');
const panOnly = rest.includes('--pan-only');
const { harnessSource, parseAndValidateResult } = await import(`${wt}/apps/studio/bin/_perf-shared.mjs`);
const { launchChromium } = await import(`${wt}/apps/studio/bin/_pw-launch.mjs`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/?open=ui/AI-StudyMate/ux/retention-ladder.tsx`, { waitUntil: 'domcontentloaded' });
let frame = null;
for (let i = 0; i < 60 && !frame; i++) {
  frame = page.frames().find((f) => /_canvas-shell/.test(f.url())) || null;
  if (!frame) await sleep(500);
}
for (let i = 0; i < 60; i++) {
  const n = await frame.evaluate(() => document.querySelectorAll('[data-dc-screen]').length);
  if (n > 0) break;
  await sleep(500);
}
// let the board settle in
for (let i = 0; i < 40; i++) {
  const n = await frame.evaluate(() => document.querySelectorAll('.dc-annot-scene > *').length);
  if (n > 500) break;
  await sleep(500);
}
await sleep(1500);

const nodeCounts = async () =>
  frame.evaluate(() => {
    const scene = document.querySelector('.dc-annot-scene');
    const world = document.querySelector('.dc-world');
    const all = (el) => (el ? el.querySelectorAll('*').length : 0);
    const svgIn = (el) => (el ? el.querySelectorAll('svg, svg *').length : 0);
    const mosaic = document.querySelector('.dc-lod-mosaic, [data-lod-mosaic]');
    const byClass = {};
    if (scene) for (const c of scene.children) {
      const k = c.getAttribute('data-an-type') || c.getAttribute('data-type') || c.className?.baseVal || c.className || c.tagName;
      const key = String(k).split(' ')[0];
      byClass[key] = (byClass[key] || 0) + 1;
    }
    const w = world;
    const m = w ? new DOMMatrix(getComputedStyle(w).transform) : null;
    return {
      documentNodes: document.querySelectorAll('*').length,
      worldNodes: all(world),
      sceneTopLevel: scene ? scene.children.length : 0,
      sceneNodes: all(scene),
      sceneSvgNodes: svgIn(scene),
      worldSvgNodes: svgIn(world),
      annotSvgOverlay: all(document.querySelector('.dc-annot-svg')),
      mosaicNodes: all(mosaic),
      byClass,
      scale: m ? Math.round(m.a * (Number.parseFloat(w.style.zoom) || 1) * 1000) / 1000 : null,
      dcZoomUsers: [...document.styleSheets].reduce((n, s) => {
        try { for (const r of s.cssRules) if (r.cssText.includes('--dc-zoom')) n++; } catch {}
        return n;
      }, 0),
    };
  });

async function runHarness() {
  await frame.evaluate('window.__maudePerfResult = null');
  await frame.evaluate(
    harnessSource({ pan: zoomOnly ? 0 : 60, zoom: panOnly ? 0 : 40, injectCss: '', fitAll, setFlags: [] })
  );
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const r = await frame.evaluate('JSON.stringify(window.__maudePerfResult)');
    if (r && r !== 'null') return JSON.parse(r);
  }
  throw new Error('harness timeout');
}

// warm-up (also applies fit-all)
const warm = await runHarness();
const before = await nodeCounts();

// CDP session: OOPIF frame if it is one, else the page.
let cdp;
try { cdp = await ctx.newCDPSession(frame); } catch { cdp = await ctx.newCDPSession(page); }
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await browser.startTracing(page, {
  categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'v8'],
});
await cdp.send('Profiler.start');
const res = await runHarness();
const { profile } = await cdp.send('Profiler.stop');
const trace = await browser.stopTracing();
const after = await nodeCounts();
writeFileSync(`${outPrefix}.cpuprofile`, JSON.stringify(profile));
writeFileSync(`${outPrefix}.trace.json`, trace);

// ---- CPU self time by function ----
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const cf = n.callFrame;
  const url = cf.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const key = `${cf.functionName || '(anon)'} ${url}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
}
const topSelf = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

// ---- inclusive time per function (for React/our code) ----
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const incl = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const seen = new Set();
  let id = profile.samples[i];
  while (id != null) {
    const n = byId.get(id);
    const cf = n.callFrame;
    const url = cf.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const key = `${cf.functionName || '(anon)'} ${url}:${cf.lineNumber + 1}`;
    if (!seen.has(key)) { incl.set(key, (incl.get(key) || 0) + (dt[i] || 0) / 1000); seen.add(key); }
    id = parent.get(id);
  }
}
const topIncl = [...incl.entries()].filter(([k]) => !/^\((root|program|idle)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 40);

// ---- timeline: main-thread event durations (top-level, renderer main thread of the frame) ----
const t = JSON.parse(trace.toString());
const evs = t.traceEvents || t;
const sums = {};
const counts = {};
const threads = {};
for (const e of evs) if (e.ph === 'M' && e.name === 'thread_name') threads[`${e.pid}:${e.tid}`] = e.args.name;
for (const e of evs) {
  if (e.ph !== 'X' || !e.dur) continue;
  const th = threads[`${e.pid}:${e.tid}`] || '?';
  if (!/CrRendererMain/.test(th)) continue;
  const k = e.name;
  if (!['Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'Paint', 'PrePaint', 'Layerize', 'UpdateLayer', 'CompositeLayers', 'FunctionCall', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'HitTest', 'ParseHTML', 'MajorGC', 'MinorGC', 'V8.GC_SCAVENGER', 'ProfileCall', 'Commit', 'PaintImage', 'UpdateLayerTree', 'IntersectionObserverController::computeIntersections', 'v8.callFunction', 'v8.run', 'ScheduleStyleRecalculation', 'InvalidateLayout', 'LocalFrameView::RunPostLifecycleSteps', 'LocalFrameView::updateLifecyclePhasesInternal', 'Document::updateStyle', 'PageAnimator::serviceScriptedAnimations', 'ProxyMain::BeginMainFrame::commit', 'ThreadProxy::BeginMainFrame', 'WebFrameWidgetImpl::BeginMainFrame', 'WebViewImpl::BeginFrame', 'LocalFrameView::UpdateAllLifecyclePhases'].includes(k)) continue;
  sums[`${th} ${k}`] = (sums[`${th} ${k}`] || 0) + e.dur / 1000;
  counts[`${th} ${k}`] = (counts[`${th} ${k}`] || 0) + 1;
}
// layout object counts from Layout events
let layoutObjs = 0, layoutN = 0, styleEls = 0, styleN = 0;
for (const e of evs) {
  if (e.name === 'Layout' && e.ph === 'B' && e.args?.beginData) {}
  if (e.name === 'Layout' && e.args?.endData?.layoutRoots) {}
  if (e.name === 'Layout' && e.args?.beginData?.dirtyObjects) { layoutObjs += e.args.beginData.dirtyObjects; layoutN++; }
  if ((e.name === 'UpdateLayoutTree' || e.name === 'RecalculateStyles') && e.args?.elementCount) { styleEls += e.args.elementCount; styleN++; }
}
const out = {
  result: { gesture: res.gesture, pan: res.pan, zoom: res.zoom, longFrames: res.longFrames, renders: res.renders ?? res.artboardRenders },
  raw: res,
  nodesBefore: before,
  nodesAfter: after,
  timeline: Object.entries(sums).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v), counts[k]]),
  layout: { events: layoutN, dirtyObjectsTotal: layoutObjs, avgDirty: layoutN ? Math.round(layoutObjs / layoutN) : 0 },
  style: { events: styleN, elementsTotal: styleEls, avgElements: styleN ? Math.round(styleEls / styleN) : 0 },
  topSelf: topSelf.map(([k, v]) => [k, Math.round(v)]),
  topIncl: topIncl.map(([k, v]) => [k, Math.round(v)]),
};
writeFileSync(`${outPrefix}.summary.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ result: out.result, nodesAfter: after, timeline: out.timeline.slice(0, 18), layout: out.layout, style: out.style }, null, 1));
await browser.close();
