// Scratch probe (V2-8.8 WebKit regression): open the studio, open a canvas, fit-all, then a zoom-only
// gesture while Chromium traces style/layout/paint + paint invalidations. --webkit-path makes canvas-lib take
// its WebKit branch (transform: scale + will-change) by spoofing navigator.vendor in every frame, so the
// invalidation pattern is the one Safari sees, display-free. Prints one JSON line.
import { launchChromium } from '../../../../../../apps/studio/bin/_pw-launch.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (k) => argv.includes(k);
const url = opt('--url');
const slug = opt('--studio', 'ui-c12');
const zoomSteps = Number(opt('--zoom', '40'));
const injectCss = opt('--css', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchChromium();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  if (has('--webkit-path')) {
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, 'vendor', { get: () => 'Apple Computer, Inc.' });
      } catch {}
    });
  }
  const page = await ctx.newPage();
  await page.goto(`${url}?open=${encodeURIComponent(`ui/${slug.replace(/^ui-/, '')}.tsx`)}`, {
    waitUntil: 'domcontentloaded',
  });
  // pre-v2 has no ?open= — click the row if it shows up
  const rowSel = `[data-testid="canvas-row-${slug}"]`;
  let frame = null;
  for (let i = 0; i < 60 && !frame; i++) {
    frame = page.frames().find((f) => /_canvas-shell/.test(f.url())) || null;
    if (!frame) {
      if (i === 6 && (await page.$(rowSel))) await page.click(rowSel).catch(() => {});
      if (i === 6 && !(await page.$(rowSel))) {
        const s = await page.$('[data-testid="canvas-search"]');
        if (s) {
          await page.fill('[data-testid="canvas-search"] input, input[data-testid="canvas-search"]', slug.replace(/^ui-/, '')).catch(() => {});
          await sleep(500);
          if (await page.$(rowSel)) await page.click(rowSel).catch(() => {});
        }
      }
      await sleep(500);
    }
  }
  if (!frame) throw new Error('no canvas frame');
  for (let i = 0; i < 60; i++) {
    const n = await frame.evaluate(() => document.querySelectorAll('[data-dc-screen]').length).catch(() => 0);
    if (n > 0) break;
    await sleep(500);
  }
  await sleep(2500);
  const webkitPath = await frame.evaluate(() => {
    const w = document.querySelector('.dc-world');
    return { vendor: navigator.vendor, transform: w?.style.transform || '', zoom: w?.style.zoom || '' };
  });
  if (injectCss) {
    await frame.evaluate((css) => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    }, injectCss);
  }
  // fit-all (Cmd+0) inside the frame, settle
  const gesture = async () =>
    frame.evaluate(async (steps) => {
      const host = document.querySelector('.dc-canvas');
      const win = window;
      const r = host.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));
      for (const t of [document, host])
        t.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise((res) => setTimeout(res, 1200));
      win.__dcPerf = { artboardRenders: 0, annotationRenders: 0 };
      const roSeen = [];
      const art = document.querySelector('article.dc-artboard');
      const ro = new ResizeObserver((es) => { const r = es[0].contentRect; roSeen.push(`${r.width}x${r.height}`); });
      ro.observe(art);
      const frames = [];
      let last = 0;
      let on = true;
      const tick = (t) => {
        if (last) frames.push(t - last);
        last = t;
        if (on) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      performance.mark('zoom-start');
      console.timeStamp('zoom-start');
      for (let i = 0; i < steps; i++) {
        host.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: i < steps / 2 ? -8 : 8, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
        await nextFrame();
      }
      console.timeStamp('zoom-end');
      performance.mark('zoom-end');
      const rendersAtEnd = win.__dcPerf.artboardRenders;
      await new Promise((res) => setTimeout(res, 900));
      on = false;
      const s = frames.slice().sort((a, b) => a - b);
      return {
        rendersDuringZoom: rendersAtEnd,
        roCount: roSeen.length,
        roDistinct: [...new Set(roSeen)].length,
        roSample: roSeen.slice(0, 6),
        rendersInclSettle: win.__dcPerf.artboardRenders,
        boards: document.querySelectorAll('[data-dc-screen]').length,
        p95: s[Math.floor(s.length * 0.95)],
      };
    }, zoomSteps);
  await gesture(); // warm-up
  const cats = [
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.invalidationTracking',
    'blink.user_timing',
  ];
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable').catch(() => {});
  await cdp.send('LayerTree.enable');
  let layers = [];
  cdp.on('LayerTree.layerTreeDidChange', (e) => {
    if (e.layers) layers = e.layers;
  });
  const painted = [];
  let recording = false;
  cdp.on('LayerTree.layerPainted', (e) => {
    if (recording) painted.push(e.layerId);
  });
  await sleep(300);
  await browser.startTracing(page, { categories: cats });
  recording = true;
  const g = await gesture();
  recording = false;
  const byLayer = {};
  for (const id of painted) byLayer[id] = (byLayer[id] || 0) + 1;
  const reasons = {};
  for (const l of layers) {
    if (!l.backendNodeId) continue;
    try {
      const d = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId });
      const a = d.node.attributes || [];
      const ci = a.indexOf('class');
      const cls = ci >= 0 ? a[ci + 1] : '';
      if (!/dc-artboard/.test(cls)) continue;
      const r = await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId }).catch(() => null);
      const k = `${cls.split(' ').slice(0, 2).join('.')}:${(r?.compositingReasonIds || r?.compositingReasons || []).join('+')}`;
      reasons[k] = (reasons[k] || 0) + 1;
    } catch {}
  }
  const layerName = {};
  for (const l of layers) {
    if (!byLayer[l.layerId]) continue;
    let name = l.backendNodeId ? `node${l.backendNodeId}` : 'anon';
    if (l.backendNodeId) {
      try {
        const d = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId });
        const a = d.node.attributes || [];
        const ci = a.indexOf('class');
        name = `${d.node.nodeName.toLowerCase()}.${ci >= 0 ? a[ci + 1].split(' ').slice(0, 2).join('.') : ''}`;
      } catch {}
    }
    layerName[l.layerId] = name;
  }
  const paintedByKind = {};
  for (const [id, n] of Object.entries(byLayer)) {
    const k = layerName[id] || 'gone';
    paintedByKind[k] = paintedByKind[k] || { layers: 0, paints: 0 };
    paintedByKind[k].layers += 1;
    paintedByKind[k].paints += n;
  }
  const buf = await browser.stopTracing();
  const ev = JSON.parse(buf.toString('utf8'));
  const events = Array.isArray(ev) ? ev : ev.traceEvents;
  const ts = (n) => events.find((e) => e.name === 'TimeStamp' && e.args?.data?.message === n)?.ts;
  const t0 = ts('zoom-start');
  const t1 = ts('zoom-end');
  const inWin = events.filter((e) => e.ts >= t0 && e.ts <= t1);
  const count = (name) => inWin.filter((e) => e.name === name && e.ph !== 'E').length;
  const dur = (name) =>
    Math.round(inWin.filter((e) => e.name === name && e.ph === 'X').reduce((a, e) => a + (e.dur || 0), 0) / 1000);
  const byNode = {};
  for (const e of inWin) {
    if (e.name !== 'PaintInvalidationTracking') continue;
    const n = String(e.args?.data?.nodeName || '?').replace(/ id='[^']*'/, '').slice(0, 70);
    byNode[n] = (byNode[n] || 0) + 1;
  }
  const top = Object.entries(byNode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const styleInv = {};
  for (const e of inWin) {
    if (e.name !== 'StyleRecalcInvalidationTracking' && e.name !== 'LayoutInvalidationTracking') continue;
    const k = `${e.name.replace('InvalidationTracking', '')}:${String(e.args?.data?.reason || '')}`;
    styleInv[k] = (styleInv[k] || 0) + 1;
  }
  const layoutObjs = inWin
    .filter((e) => e.name === 'Layout' && e.ph === 'X')
    .reduce((a, e) => a + (e.args?.beginData?.dirtyObjects || 0), 0);
  const paintNodes = {};
  for (const e of inWin) {
    if (e.name !== 'Paint' || e.ph === 'E') continue;
    const id = e.args?.data?.nodeId;
    paintNodes[id] = (paintNodes[id] || 0) + 1;
  }
  const paintByClass = {};
  for (const [id, n] of Object.entries(paintNodes)) {
    let name = `node${id}`;
    try {
      const d = await cdp.send('DOM.describeNode', { backendNodeId: Number(id) });
      const a = d.node.attributes || [];
      const ci = a.indexOf('class');
      name = `${d.node.nodeName.toLowerCase()}.${ci >= 0 ? a[ci + 1].split(' ').slice(0, 2).join('.') : ''}`;
    } catch {}
    paintByClass[name] = paintByClass[name] || { nodes: 0, paints: 0 };
    paintByClass[name].nodes += 1;
    paintByClass[name].paints += n;
  }
  console.log(
    JSON.stringify({
      paintByClass,
      reasons,
      webkitPath,
      ...g,
      zoomWindowMs: Math.round((t1 - t0) / 1000),
      layout: count('Layout'),
      layoutMs: dur('Layout'),
      layoutDirtyObjects: layoutObjs,
      styleRecalc: count('UpdateLayoutTree'),
      styleMs: dur('UpdateLayoutTree'),
      paint: count('Paint'),
      paintMs: dur('Paint'),
      paintInvalidations: inWin.filter((e) => e.name === 'PaintInvalidationTracking').length,
      topInvalidated: top,
      styleLayoutInvalidations: styleInv,
      layerPaints: painted.length,
      layersTotal: layers.length,
      paintedByKind,
    })
  );
} finally {
  await browser.close().catch(() => {});
}
