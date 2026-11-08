// _perf-sweep-shared.mjs — the pure half of `maude design perf --sweep` (issues burndown T9.1).
//
// A short pan+zoom burst only moves a small piece of a big canvas, so it says little about the way
// someone really uses a board: panning across ALL of it. The sweep drives the same wheel path the viewport
// controller listens for (a plain wheel = 2D pan, a ctrl wheel = zoom) through four phases and records, per
// phase, every frame's rAF delta, how many artboards were on screen / mounted / standing in as a still, and
// how many frames showed an artboard that already had content as a blank:
//
//   sweep-overview   serpentine over the whole world at the overview zoom (10 % by default), after a settle
//   sweep-fit        the zoom with the most artboards on screen (fit-all), a small pan to keep it moving
//   zoom-cycles      fit-all <-> overview, three times
//   sweep-after-zoom serpentine at the overview zoom, started the instant a zoom cycle ends (no settle)
//
// Everything that needs no browser lives here (option parsing, statistics, result validation, the
// report) so it is testable; `_perf-sweep.mjs` is the driver (Playwright Chromium / safaridriver Safari).
// The in-page harness is a real function (`sweepHarness`) serialised with toString(), so it is
// syntax-checked with the rest of the file.

export const SWEEP_PHASES = ['sweep-overview', 'sweep-fit', 'zoom-cycles', 'sweep-after-zoom'];
export const DEFAULT_SWEEP = {
  engine: 'chromium',
  url: '',
  label: '',
  passes: 3,
  runs: 1,
  zoom: 0.1,
  speed: 1200,
  afterZoomRows: 3,
  sweeps: 3,
  warmup: 2,
  window: '1600x920',
  dpr: 2,
  query: 'artboard-live=sleep',
  timeout: 600,
  driverPort: 4488,
  json: false,
  gpu: false,
  out: '',
};

const INT = /^\d+$/;
const NUM = /^\d+(\.\d+)?$/;

/** Parse the argv of the sweep driver. Throws an Error naming the bad option (the caller prints it, exit 2). */
export function parseSweepArgs(argv) {
  const o = { ...DEFAULT_SWEEP };
  const takeInt = (name, v, min, max) => {
    if (!INT.test(String(v ?? ''))) throw new Error(`${name} must be a whole number`);
    const n = Number(v);
    if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case '--engine': {
        const v = next();
        if (v !== 'chromium' && v !== 'safari')
          throw new Error('--engine must be chromium or safari');
        o.engine = v;
        break;
      }
      case '--url':
        o.url = next();
        break;
      case '--label':
        o.label = next();
        break;
      case '--passes':
      case '--repeat':
        o.passes = takeInt('--passes', next(), 1, 20);
        break;
      case '--runs':
        o.runs = takeInt('--runs', next(), 1, 20);
        break;
      case '--zoom': {
        const v = next();
        if (!NUM.test(v)) throw new Error('--zoom must be a number such as 0.1');
        const z = Number(v);
        if (z < 0.02 || z > 1) throw new Error('--zoom must be between 0.02 and 1');
        o.zoom = z;
        break;
      }
      case '--speed':
        o.speed = takeInt('--speed', next(), 100, 6000);
        break;
      case '--sweeps':
        o.sweeps = takeInt('--sweeps', next(), 1, 20);
        break;
      case '--warmup':
        o.warmup = takeInt('--warmup', next(), 0, 20);
        break;
      case '--after-zoom-rows':
        o.afterZoomRows = takeInt('--after-zoom-rows', next(), 1, 50);
        break;
      case '--window': {
        const v = next();
        const m = /^(\d{3,5})x(\d{3,5})$/.exec(v);
        if (!m) throw new Error('--window must look like 2560x1340');
        o.window = v;
        break;
      }
      case '--dpr': {
        const v = next();
        if (!NUM.test(v) || Number(v) < 1 || Number(v) > 3)
          throw new Error('--dpr must be between 1 and 3');
        o.dpr = Number(v);
        break;
      }
      case '--query': {
        const v = next();
        if (/[^A-Za-z0-9=&_-]/.test(v))
          throw new Error('--query takes letters, digits and = & _ - only');
        o.query = v;
        break;
      }
      case '--timeout':
        o.timeout = takeInt('--timeout', next(), 10, 7200);
        break;
      case '--driver-port':
        o.driverPort = takeInt('--driver-port', next(), 1024, 65535);
        break;
      case '--out':
        o.out = next();
        break;
      case '--json':
        o.json = true;
        break;
      case '--gpu':
        o.gpu = true;
        break;
      default:
        throw new Error(`unknown option '${a}'`);
    }
  }
  if (!o.url) throw new Error('--url is required');
  return o;
}

export function parseWindow(v) {
  const m = /^(\d+)x(\d+)$/.exec(v);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

// ---------- statistics (node side, over the raw rAF deltas the page returns) ----------

/** The p-th percentile (0..1) of a list, the same index rule the other perf probes use. */
export function percentile(values, p) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
}

/**
 * The worst 1 s window of a frame-delta series: the fewest frames delivered in any window of `ms`
 * (ends at each frame) and the longest single stall inside the window that lost the most time. The delta
 * series is the timeline (cumulative sum), so no timestamps are needed.
 */
export function worstWindow(dts, ms = 1000) {
  if (!dts.length) return { minFrames: null, fps: null, worstStall: null };
  const t = [];
  let acc = 0;
  for (const d of dts) {
    acc += d;
    t.push(acc);
  }
  let minFrames = Number.POSITIVE_INFINITY;
  let lo = 0;
  for (let i = 0; i < t.length; i++) {
    while (t[i] - t[lo] >= ms) lo++;
    // only windows that are really `ms` long: skip the ramp-up at the start of the series
    if (t[i] < ms) continue;
    const n = i - lo + 1;
    if (n < minFrames) minFrames = n;
  }
  if (!Number.isFinite(minFrames)) {
    // a series shorter than the window: the whole of it
    minFrames = dts.length;
    return {
      minFrames,
      fps: Math.round((dts.length / (acc / 1000)) * 10) / 10,
      worstStall: Math.round(Math.max(...dts)),
    };
  }
  return {
    minFrames,
    fps: minFrames,
    worstStall: Math.round(Math.max(...dts)),
  };
}

/** One phase record (as the page returns it) -> the numbers the report shows. */
export function summarizePhase(rec) {
  const dts = rec.dts;
  const w = worstWindow(dts);
  const n = Math.max(1, rec.samples);
  return {
    name: rec.name,
    frames: dts.length,
    ms: Math.round(dts.reduce((a, b) => a + b, 0)),
    p50: percentile(dts, 0.5),
    p95: percentile(dts, 0.95),
    p99: percentile(dts, 0.99),
    max: dts.length ? Math.round(Math.max(...dts)) : null,
    long50: dts.filter((d) => d >= 50).length,
    worstWindowFps: w.fps,
    onAvg: Math.round((rec.on / n) * 10) / 10,
    onMax: rec.onMax,
    mountedAvg: Math.round((rec.live / n) * 10) / 10,
    mountedMax: rec.liveMax,
    stillAvg: Math.round((rec.still / n) * 10) / 10,
    standInAvg: Math.round((rec.standIn / n) * 10) / 10,
    blankFrames: rec.blankFrames,
    blankSamples: rec.samples,
    blankBoards: rec.blankBoards,
    zoomStart: rec.zoomStart,
    zoomEnd: rec.zoomEnd,
  };
}

const med = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
};
const minOf = (xs) => Math.min(...xs.filter((x) => typeof x === 'number'));
const maxOf = (xs) => Math.max(...xs.filter((x) => typeof x === 'number'));

/**
 * The summaries of one phase over every pass of every run -> median plus the min..max spread (the spread
 * is the noise floor: a difference between two arms smaller than it is not a difference).
 */
export function aggregatePhase(name, summaries) {
  const pick = (k) => summaries.map((s) => s[k]);
  const out = { name, passes: summaries.length };
  for (const k of [
    'p50',
    'p95',
    'p99',
    'max',
    'long50',
    'worstWindowFps',
    'onAvg',
    'mountedAvg',
    'stillAvg',
    'standInAvg',
  ]) {
    out[k] = med(pick(k));
    out[`${k}Min`] = summaries.length ? minOf(pick(k)) : null;
    out[`${k}Max`] = summaries.length ? maxOf(pick(k)) : null;
  }
  out.onMax = maxOf(pick('onMax'));
  out.mountedMax = maxOf(pick('mountedMax'));
  out.blankFrames = pick('blankFrames').reduce((a, b) => a + b, 0);
  out.blankSamples = pick('blankSamples').reduce((a, b) => a + b, 0);
  out.blankBoards = maxOf(pick('blankBoards'));
  out.frames = pick('frames').reduce((a, b) => a + b, 0);
  return out;
}

// ---------- result validation: the harness parks its answer on a global of the untrusted canvas origin ----------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

function validPhase(p) {
  if (!p || typeof p !== 'object') return false;
  if (!SWEEP_PHASES.includes(p.name)) return false;
  if (
    !Array.isArray(p.dts) ||
    p.dts.length > 200000 ||
    !p.dts.every((d) => isNum(d) && d >= 0 && d < 3600000)
  )
    return false;
  for (const k of ['on', 'live', 'still', 'standIn']) if (!isNum(p[k]) || p[k] < 0) return false;
  for (const k of ['onMax', 'liveMax', 'blankFrames', 'blankBoards', 'samples'])
    if (!isCount(p[k])) return false;
  return isNum(p.zoomStart) && isNum(p.zoomEnd);
}

/**
 * Shape-check the page's final result before any of it is printed or recorded (a canvas from a cloned repo
 * can define the global ahead of the harness). Returns the object only when every leaf is the primitive it
 * claims to be, else null.
 */
export function parseSweepResult(raw) {
  let r;
  try {
    r = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!r || typeof r !== 'object') return null;
  if (r.occluded === true) {
    const vis =
      typeof r.visibility === 'string' ? r.visibility.slice(0, 20).replace(/[^a-z]/g, '') : '';
    return { occluded: true, visibility: vis, idleHz: isNum(r.idleHz) ? r.idleHz : 0 };
  }
  if (!Array.isArray(r.passes) || !r.passes.length || r.passes.length > 50) return null;
  for (const pass of r.passes) {
    if (!pass || !Array.isArray(pass.phases) || pass.phases.length !== SWEEP_PHASES.length)
      return null;
    if (!pass.phases.every(validPhase)) return null;
    if (typeof pass.visibility !== 'string' || !isNum(pass.idleHz)) return null;
  }
  const e = r.env;
  if (!e || typeof e !== 'object') return null;
  for (const k of ['innerW', 'innerH', 'hostW', 'hostH', 'dpr', 'artboards', 'zoomFit', 'idleHz'])
    if (!isNum(e[k])) return null;
  if (!Array.isArray(e.world) || e.world.length !== 4 || !e.world.every(isNum)) return null;
  return r;
}

/** Did any pass run on a page that was hidden / throttled? Then those numbers describe nothing a user sees. */
export function occlusionReason(result, minHz = 50) {
  if (result.occluded)
    return `the page was occluded before the run (visibility ${result.visibility || 'unknown'}, idle ${result.idleHz} Hz)`;
  for (const [i, pass] of result.passes.entries()) {
    if (pass.visibility !== 'visible')
      return `pass ${i + 1} ended with visibilityState ${pass.visibility.slice(0, 20)}`;
    if (pass.idleHz < minHz) return `pass ${i + 1} idle rAF was ${pass.idleHz} Hz (< ${minHz})`;
  }
  return null;
}

/** Fold several results (runs) into the per-phase aggregate. */
export function aggregateRuns(results) {
  const byPhase = new Map(SWEEP_PHASES.map((p) => [p, []]));
  for (const r of results)
    for (const pass of r.passes)
      for (const ph of pass.phases) byPhase.get(ph.name).push(summarizePhase(ph));
  return SWEEP_PHASES.map((p) => aggregatePhase(p, byPhase.get(p)));
}

export function renderSweepReport({ label, engine, opts, results, aggregate }) {
  const e = results[0].env;
  const lines = [];
  lines.push(
    `perf sweep — ${label} | engine ${engine} | ${e.innerW}x${e.innerH} @${e.dpr}x | ${e.artboards} artboards | overview zoom ${opts.zoom} | fit zoom ${e.zoomFit}`
  );
  lines.push(
    `runs ${results.length} x passes ${opts.passes} = ${results.reduce((n, r) => n + r.passes.length, 0)} samples per phase; speed ${opts.speed} px/s; ${opts.query}`
  );
  lines.push('');
  lines.push(
    'phase               frames  p50   p95 (min..max)    p99    max  worst-1s fps  on-screen avg/max  mounted avg/max  stand-ins  blank frames (boards)'
  );
  for (const a of aggregate) {
    lines.push(
      `${a.name.padEnd(18)} ${String(a.frames).padStart(7)} ${String(a.p50).padStart(5)} ${String(a.p95).padStart(5)} (${a.p95Min}..${a.p95Max})`.padEnd(
        54
      ) +
        ` ${String(a.p99).padStart(5)} ${String(a.max).padStart(5)}  ${String(a.worstWindowFps).padStart(11)}` +
        `  ${`${a.onAvg}/${a.onMax}`.padStart(16)}  ${`${a.mountedAvg}/${a.mountedMax}`.padStart(15)}  ${String(a.standInAvg).padStart(9)}` +
        `  ${a.blankFrames}/${a.blankSamples} (${a.blankBoards})`
    );
  }
  return lines.join('\n');
}

// ---------- the in-page harness ----------

/**
 * Runs in the canvas page (Playwright `evaluate` / WebDriver `execute`). Returns 'STARTED' (or 'NO_HOST'); the
 * answer is parked on `window.__maudeSweep` ({ state, progress, result }) because the drivers cannot await.
 * Self-contained: it may not close over anything outside its own body.
 */
export function sweepHarness(opts) {
  const win = window;
  const doc = document;
  const host = doc.querySelector('.dc-canvas');
  if (!host) return 'NO_HOST';
  const S = { state: 'running', progress: 'starting', phase: '', result: null };
  win.__maudeSweep = S;
  const ZOOM_K = 0.0035; // canvas-lib WHEEL_ZOOM_K
  const SAMPLE_EVERY = 3; // the artboard scan runs on every 3rd frame
  const MARGIN = 20;
  const PHASE_CAP_MS = 240000;
  const sleep = (ms) => new Promise((r) => win.setTimeout(r, ms));
  // The page's real rAF: while the camera moves, the canvas holds the global rAF (the frame freeze,
  // ~250 ms per flush) so artboards do no work; the freeze keeps the unheld one on __maudeFrameFreeze.raf and
  // that is the clock a person's screen follows (the other probes use it the same way).
  const raf = (f) =>
    (win.__maudeFrameFreeze ? win.__maudeFrameFreeze.raf : win.requestAnimationFrame.bind(win))(f);
  const nextFrame = () => new Promise((r) => raf(r));
  const cam = () => (win.__maudeViewport ? win.__maudeViewport() : null);
  const hostBox = () => host.getBoundingClientRect();
  const hb0 = hostBox();
  const cx = hb0.left + hb0.width / 2;
  const cy = hb0.top + hb0.height / 2;
  const wheel = (dx, dy, ctrl) =>
    host.dispatchEvent(
      new win.WheelEvent('wheel', {
        deltaX: dx,
        deltaY: dy,
        ctrlKey: !!ctrl,
        clientX: cx,
        clientY: cy,
        bubbles: true,
        cancelable: true,
      })
    );
  const arts = () => Array.from(doc.querySelectorAll('[data-dc-screen]'));

  // ---- artboard state ----
  // Which artboards are on screen comes from the camera and each artboard's world rectangle (read once per
  // phase, unmeasured) - never from an intersection observer or per-frame rects: those make the browser
  // recompute 88 heavy artboards on every camera move, and the probe would time itself (~250 ms frames).
  let boards = [];
  const refreshBoards = () => {
    const c = cam();
    const hb = hostBox();
    boards = arts().map((a) => {
      const r = a.getBoundingClientRect();
      return {
        a,
        id: a.getAttribute('data-dc-screen'),
        x0: (r.left - hb.left - c.x) / c.zoom,
        y0: (r.top - hb.top - c.y) / c.zoom,
        x1: (r.right - hb.left - c.x) / c.zoom,
        y1: (r.bottom - hb.top - c.y) / c.zoom,
      };
    });
  };
  const had = new Set(); // ids that have shown a still (or a held one) at some point
  const stateOf = (a) => {
    const s = a.getAttribute('data-dc-still');
    if (s) return s === 'cover' ? 'cover' : 'still';
    const ph = a.querySelector('.dc-artboard-sleeping');
    if (ph) return ph.querySelector('canvas, img') ? 'held' : 'ph';
    return 'live';
  };
  const newRec = (name) => ({
    name,
    dts: [],
    on: 0,
    onMax: 0,
    live: 0,
    liveMax: 0,
    still: 0,
    standIn: 0,
    samples: 0,
    blankFrames: 0,
    blankIds: {},
    zoomStart: (cam() || { zoom: 0 }).zoom,
    zoomEnd: 0,
  });
  const sample = (rec) => {
    let on = 0;
    let live = 0;
    let still = 0;
    let standIn = 0;
    let blank = 0;
    const c = cam();
    const vx0 = -c.x / c.zoom;
    const vy0 = -c.y / c.zoom;
    const vx1 = (hb0.width - c.x) / c.zoom;
    const vy1 = (hb0.height - c.y) / c.zoom;
    for (const b of boards) {
      const a = b.a;
      const id = b.id;
      const st = stateOf(a);
      if (st === 'still' || st === 'held') had.add(id);
      if (st === 'live') live++;
      else if (st === 'still' || st === 'held') still++;
      if (b.x1 <= vx0 || b.x0 >= vx1 || b.y1 <= vy0 || b.y0 >= vy1) continue;
      on++;
      if (st === 'ph' || st === 'cover') {
        standIn++;
        if (had.has(id)) {
          blank++;
          rec.blankIds[id] = 1;
        }
      }
    }
    rec.samples++;
    rec.on += on;
    rec.live += live;
    rec.still += still;
    rec.standIn += standIn;
    if (on > rec.onMax) rec.onMax = on;
    if (live > rec.liveMax) rec.liveMax = live;
    if (blank) rec.blankFrames++;
  };
  const finish = (rec) => {
    const c = cam();
    rec.zoomEnd = c ? c.zoom : 0;
    rec.blankBoards = Object.keys(rec.blankIds).length;
    delete rec.blankIds;
    return rec;
  };

  // One measured phase: `driver(dt, t, rec)` is called once per frame and returns true when it is finished.
  const runPhase = (name, driver) =>
    new Promise((resolve) => {
      refreshBoards();
      const rec = newRec(name);
      let last = 0;
      let n = 0;
      let t0 = 0;
      const frame = (t) => {
        const dt = last ? t - last : 16.7;
        if (!t0) t0 = t;
        if (last) rec.dts.push(dt);
        last = t;
        // a phase that never ends (a gesture that does not land) must not hang the run
        const done = driver(Math.min(dt, 100), t, rec) || t - t0 > PHASE_CAP_MS;
        n++;
        if (n % SAMPLE_EVERY === 0) sample(rec);
        if (n % 30 === 0) {
          const c = cam();
          S.progress = `${S.phase} f=${n} zoom=${c ? c.zoom.toFixed(3) : '?'} x=${c ? Math.round(c.x) : '?'} y=${c ? Math.round(c.y) : '?'}`;
        }
        if (done) resolve(finish(rec));
        else raf(frame);
      };
      raf(frame);
    });

  // ---- camera helpers (not measured) ----
  const setZoom = async (target) => {
    for (let i = 0; i < 300; i++) {
      const c = cam();
      const r = Math.log(target / c.zoom);
      if (Math.abs(r) < 0.02) return;
      wheel(0, Math.max(-50, Math.min(50, -r / ZOOM_K)), true);
      await nextFrame();
    }
  };
  const worldBox = () => {
    const c = cam();
    const hb = hostBox();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const a of arts()) {
      const r = a.getBoundingClientRect();
      if (!r.width) continue;
      x0 = Math.min(x0, (r.left - hb.left - c.x) / c.zoom);
      y0 = Math.min(y0, (r.top - hb.top - c.y) / c.zoom);
      x1 = Math.max(x1, (r.right - hb.left - c.x) / c.zoom);
      y1 = Math.max(y1, (r.bottom - hb.top - c.y) / c.zoom);
    }
    return { x0, y0, x1, y1 };
  };
  // a pan that does not land would time an empty gesture: refuse it, never report it
  const moveCamTo = async (x, y) => {
    for (let i = 0; i < 40; i++) {
      const c = cam();
      const dx = x - c.x;
      const dy = y - c.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      wheel(-dx, -dy, false);
      await nextFrame();
    }
    throw new Error('the camera did not reach its start (wheel pan not applied)');
  };
  // the serpentine's camera waypoints at zoom z over the world box, `rows` rows at most
  const serpentine = (z, wb, rows) => {
    const hb = hostBox();
    const W = hb.width;
    const H = hb.height;
    const ww = (wb.x1 - wb.x0) * z;
    const wh = (wb.y1 - wb.y0) * z;
    const xl = MARGIN - wb.x0 * z;
    const xr = ww > W - 2 * MARGIN ? W - MARGIN - wb.x1 * z : xl;
    const rowStep = H * 0.8;
    const total = Math.max(1, Math.ceil(Math.max(0, wh - (H - 2 * MARGIN)) / rowStep) + 1);
    const n = Math.min(total, rows || total);
    const pts = [];
    for (let r = 0; r < n; r++) {
      let y = MARGIN - wb.y0 * z - r * rowStep;
      // the last row stops where the world's bottom edge meets the viewport's, not a full row further
      if (wh > H - 2 * MARGIN) y = Math.max(y, H - MARGIN - wb.y1 * z);
      const [a, b] = r % 2 === 0 ? [xl, xr] : [xr, xl];
      pts.push({ x: a, y }, { x: b, y });
    }
    return { pts, rows: n, total };
  };
  // a driver that walks a polyline of camera positions at `speed` px/s
  const walker = (pts, speed) => {
    let i = 0;
    return (dt) => {
      const c = cam();
      let budget = (speed * dt) / 1000;
      let x = c.x;
      let y = c.y;
      while (budget > 0 && i < pts.length) {
        const p = pts[i];
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= budget) {
          x = p.x;
          y = p.y;
          budget -= d;
          i++;
        } else {
          x += ((p.x - x) / d) * budget;
          y += ((p.y - y) / d) * budget;
          budget = 0;
        }
      }
      if (Math.abs(x - c.x) > 0.01 || Math.abs(y - c.y) > 0.01)
        wheel(-(x - c.x), -(y - c.y), false);
      return i >= pts.length;
    };
  };
  const fit = async () => {
    for (const t of [doc, host]) {
      t.dispatchEvent(
        new win.KeyboardEvent('keydown', {
          key: '0',
          code: 'Digit0',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    await sleep(900);
  };
  const idle = async () => {
    // rAF callbacks over 500 ms of nothing: behind a locked screen / another window WebKit stops them
    let hz = 0;
    for (let w = 0; String(doc.visibilityState) !== 'hidden' && w < 20; w++) {
      let f = 0;
      let on = true;
      const tick = () => {
        if (!on) return;
        f++;
        raf(tick);
      };
      raf(tick);
      await sleep(500);
      on = false;
      hz = Math.max(hz, f * 2);
      if (hz >= 50) break;
    }
    return hz;
  };

  (async () => {
    try {
      const vis0 = String(doc.visibilityState || 'unknown');
      const hz0 = await idle();
      if (vis0 === 'hidden' || hz0 < 50) {
        S.result = { occluded: true, visibility: vis0, idleHz: hz0 };
        S.state = 'done';
        return;
      }
      if (!cam()) throw new Error('no viewport hook');
      await fit();
      const zoomFit = cam().zoom;
      const wb = worldBox();
      const env = {
        innerW: win.innerWidth,
        innerH: win.innerHeight,
        hostW: Math.round(hostBox().width),
        hostH: Math.round(hostBox().height),
        dpr: win.devicePixelRatio,
        artboards: arts().length,
        zoomFit,
        idleHz: hz0,
        world: [Math.round(wb.x0), Math.round(wb.y0), Math.round(wb.x1), Math.round(wb.y1)],
      };
      const passes = [];
      // Warm-up (not measured): the stills of a board are taken the first time its artboards are seen, so a
      // cold first sweep times the mounting of every artboard, not the revisit a person pans through. Walk
      // the world `warmup` times, then let the stills settle.
      if (opts.warmup > 0) {
        S.phase = S.progress = 'warm-up';
        await setZoom(opts.zoom);
        await nextFrame();
        const sw = serpentine(opts.zoom, worldBox(), 0);
        await moveCamTo(sw.pts[0].x, sw.pts[0].y);
        const ptsW = [];
        for (let k = 0; k < opts.warmup; k++) ptsW.push(...sw.pts);
        await runPhase('warmup', walker(ptsW, opts.speed));
        await sleep(4000);
      }
      for (let p = 0; p < opts.passes; p++) {
        const phases = [];
        // 1. the whole world at the overview zoom, after a settle
        S.phase = S.progress = `pass ${p + 1}/${opts.passes} sweep-overview`;
        await setZoom(opts.zoom);
        await nextFrame();
        const w1 = worldBox();
        const s1 = serpentine(opts.zoom, w1, 0);
        await moveCamTo(s1.pts[0].x, s1.pts[0].y);
        await sleep(1500);
        // the serpentine ×N: a single sweep is ~100 frames at 60 fps, too few for a p95
        const pts1 = [];
        for (let k = 0; k < opts.sweeps; k++) pts1.push(...s1.pts);
        phases.push(await runPhase('sweep-overview', walker(pts1, opts.speed)));

        // 2. the zoom with the most artboards on screen (fit-all), kept moving by a small circle
        S.phase = S.progress = `pass ${p + 1}/${opts.passes} sweep-fit`;
        await fit();
        const c2 = cam();
        const t2 = { start: 0 };
        phases.push(
          await runPhase('sweep-fit', (_dt, t) => {
            if (!t2.start) t2.start = t;
            const e = t - t2.start;
            const tx = c2.x + 120 * Math.sin((e / 2000) * Math.PI * 2);
            const ty = c2.y + 90 * Math.sin((e / 1700) * Math.PI * 2);
            const c = cam();
            wheel(-(tx - c.x), -(ty - c.y), false);
            return e >= 6000;
          })
        );

        // 3. fit-all <-> overview, three times (a zoom event every frame, a short hold between)
        S.phase = S.progress = `pass ${p + 1}/${opts.passes} zoom-cycles`;
        const steps = [];
        for (let k = 0; k < 3; k++)
          steps.push({ to: opts.zoom }, { hold: 400 }, { to: zoomFit * 1.02 }, { hold: 400 });
        steps.push({ to: opts.zoom });
        let si = 0;
        let holdUntil = 0;
        phases.push(
          await runPhase('zoom-cycles', (_dt, t) => {
            if (si >= steps.length) return true;
            const st = steps[si];
            if (st.hold !== undefined) {
              if (!holdUntil) holdUntil = t + st.hold;
              if (t >= holdUntil) {
                holdUntil = 0;
                si++;
              }
              return false;
            }
            const c = cam();
            const r = Math.log(st.to / c.zoom);
            if (Math.abs(r) < 0.03) {
              si++;
              return false;
            }
            wheel(0, Math.max(-20, Math.min(20, -r / ZOOM_K)), true);
            return false;
          })
        );

        // 4. a sweep started the moment the last zoom ended: no settle, no re-park
        S.phase = S.progress = `pass ${p + 1}/${opts.passes} sweep-after-zoom`;
        const w4 = worldBox();
        const s4 = serpentine(opts.zoom, w4, opts.afterZoomRows);
        phases.push(await runPhase('sweep-after-zoom', walker(s4.pts, opts.speed)));

        passes.push({
          phases,
          visibility: String(doc.visibilityState || 'unknown'),
          idleHz: await idle(),
          rows: s1.total,
        });
        await sleep(1500);
      }
      S.result = { passes, env };
      S.state = 'done';
    } catch (err) {
      S.result = null;
      S.state = 'error';
      S.progress = String((err && err.message) || err).slice(0, 200);
    }
  })();
  return 'STARTED';
}

/** The expression a driver evaluates to start the harness. */
export function sweepStartExpression(opts) {
  const safe = {
    passes: opts.passes,
    zoom: opts.zoom,
    speed: opts.speed,
    afterZoomRows: opts.afterZoomRows,
    sweeps: opts.sweeps,
    warmup: opts.warmup,
  };
  return `(${sweepHarness.toString()})(${JSON.stringify(safe)})`;
}

/** The expression a driver polls: a JSON string `{state, progress, result}` (never the page's own object). */
export const SWEEP_POLL_EXPRESSION =
  '(() => { const s = window.__maudeSweep; return s ? JSON.stringify({ state: String(s.state), progress: String(s.progress), result: s.result }) : "null"; })()';
