#!/usr/bin/env node
// _thumbs-playwright.mjs — the long-lived thumbnail renderer (V2-2.17, contract V2-1.17 §5.8).
//
// One per project server, spawned by `thumbs/service.ts` on the first job through the same runtime
// (`resolveExportRuntime()`, DDR-177) and the same engine resolution (`launchChromium()`: Playwright's
// Chromium, else `_ensure-browser --no-download` — never a silent download) as every export.
// NDJSON over stdio:
//
//   → {"op":"render","id":17,"url":"<main origin>/_canvas-shell.html?canvas=…&hide-chrome=1…",
//      "expectOrigin":"<capture origin>","hasArtboards":true,"deadlineMs":20000,
//      "coverOrder":["…"]|null,"posters":{"<artboard>":120},
//      "targets":[{"artboard":null,"px":480},{"artboard":"pozvanka-story","px":160}]}
//   ← {"id":17,"ok":true,"runtime":{"artboards":[{"id","label","kind","w","h"}]},
//      "shots":[{"target":0,"artboard":"…","jpeg":"<base64>","partial":false}],"blocked":0}
//   → {"op":"probe","id":18}  ← {"id":18,"ok":true,"probe":{"pid":…,"cookies":[names]}}
//
// THE CANVAS IS UNTRUSTED CODE (DDR-054). What keeps it contained here:
//   - It renders only on the read-only CAPTURE origin (decision v2-2.8-read-only-capture-origin).
//     The server hands a main-origin shell URL built like every export's (`canvasShellUrl`); the
//     main origin 307s it to the capture origin. The page's final origin is asserted against the
//     `expectOrigin` the server passed, before the first shot and again before every shot.
//   - Every request the context makes to any other origin is aborted — the one exception is the
//     job's own first navigation, to exactly the URL the server gave (it only redirects). This is
//     the second leg behind the capture origin's CSP and its canvas-safe route table (R1).
//   - WebSockets are refused outright; service workers are blocked; no downloads, no permissions.
//   - One browser and one non-persistent context per shim, so per project server: no cookies or
//     storage from the person's own browser, none shared with another project (R3).
//   - The page decides nothing: targets, sizes and the URL come from the server (R2). The clip is
//     clamped to the size the server asked for, whatever the page's DOM says, and the server
//     re-validates the bytes before storing them.

import { createInterface } from 'node:readline';

import { launchChromium } from './_pw-launch.mjs';

const MAX_PAGES = 4;
const IDLE_MS = Number(process.env.MAUDE_THUMBS_IDLE_MS) || 60_000;
const MAX_VIEW = 4096;

let browserP = null;
let ctxState = null; // { origin, ctx: Promise<BrowserContext> }
const freePages = [];
let openPages = 0;
const waiters = [];
const jobsByPage = new Map();
let inflight = 0;
let idleTimer = null;
let lastLaunchMs = null;

const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

function bounded(p, ms) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((resolve) => {
      t = setTimeout(() => resolve('__timeout__'), ms);
    }),
  ]);
}

async function getBrowser() {
  if (!browserP) {
    const t0 = performance.now();
    browserP = launchChromium({ headless: true }).then((b) => {
      lastLaunchMs = Math.round(performance.now() - t0);
      b.on('disconnected', () => {
        browserP = null;
        ctxState = null;
        freePages.length = 0;
        openPages = 0;
      });
      return b;
    });
    browserP.catch(() => {
      browserP = null;
    });
  }
  return browserP;
}

async function makeContext(origin) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await ctx.route('**/*', (route) => {
    const req = route.request();
    let reqOrigin = null;
    try {
      reqOrigin = new URL(req.url()).origin;
    } catch {
      /* unparsable — refused below */
    }
    if (reqOrigin !== null && reqOrigin === origin) return route.continue();
    let job;
    try {
      job = jobsByPage.get(req.frame().page());
    } catch {
      job = undefined; // a worker request has no frame
    }
    if (
      job &&
      !job.entered &&
      req.isNavigationRequest() &&
      req.frame() === job.page.mainFrame() &&
      sameHref(req.url(), job.url)
    ) {
      job.entered = true;
      return route.continue();
    }
    if (job) job.blocked++;
    return route.abort('blockedbyclient');
  });
  await ctx.routeWebSocket(/.*/, (ws) => ws.close({ code: 1008, reason: 'thumbnail render' }));
  return ctx;
}

function sameHref(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

async function context(origin) {
  if (ctxState && ctxState.origin !== origin) {
    // the capture listener moved (a restart): nothing from the old origin is reused
    const old = ctxState.ctx;
    ctxState = null;
    freePages.length = 0;
    openPages = 0;
    await old.then((c) => c.close()).catch(() => {});
  }
  if (!ctxState) {
    ctxState = { origin, ctx: makeContext(origin) };
    ctxState.ctx.catch(() => {
      ctxState = null;
    });
  }
  return ctxState.ctx;
}

async function takePage(origin) {
  const ctx = await context(origin);
  const idle = freePages.pop();
  if (idle && !idle.isClosed()) return idle;
  if (openPages < MAX_PAGES) {
    openPages++;
    try {
      return await ctx.newPage();
    } catch (e) {
      openPages--;
      throw e;
    }
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releasePage(page) {
  const next = waiters.shift();
  if (next) return next(page);
  if (!page.isClosed()) freePages.push(page);
  else openPages = Math.max(0, openPages - 1);
}

function armIdle() {
  clearTimeout(idleTimer);
  if (inflight > 0) return;
  idleTimer = setTimeout(closeBrowser, IDLE_MS);
  idleTimer.unref?.();
}

async function closeBrowser() {
  const b = browserP;
  browserP = null;
  ctxState = null;
  freePages.length = 0;
  openPages = 0;
  if (b) await b.then((x) => x.close()).catch(() => {});
}

function assertOrigin(page, job) {
  let origin = null;
  try {
    origin = new URL(page.url()).origin;
  } catch {
    /* about:blank or worse */
  }
  if (origin !== job.expectOrigin) {
    const err = new Error('render left the capture origin');
    err.code = 'origin';
    throw err;
  }
}

const frames = (page) =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))
  );

/** The artboard count holds across two animation frames + 250 ms (code-built artboards mount late). */
async function settleCount(page, left) {
  let prev = -1;
  for (let i = 0; i < 40 && left() > 300; i++) {
    const n = await page.locator('[data-dc-screen]').count();
    if (n === prev) return;
    prev = n;
    await bounded(frames(page), 1000);
    await page.waitForTimeout(250);
  }
}

const SAFE_ID = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Names and sizes only — never trusted for anything else (§5.8 step 3). */
async function harvest(page) {
  const raw = await bounded(
    page.evaluate(() => {
      const out = [];
      let rects = [];
      try {
        const m = window.__maudeCanvasRects?.();
        rects = Array.isArray(m?.artboards) ? m.artboards : [];
      } catch {
        rects = [];
      }
      const els = [...document.querySelectorAll('[data-dc-screen]')];
      const byId = new Map(rects.map((r) => [r?.id, r]));
      for (const el of els.slice(0, 2000)) {
        const id = el.getAttribute('data-dc-screen');
        const r = byId.get(id);
        const label = el.querySelector(':scope > .dc-artboard-label')?.textContent ?? null;
        out.push({
          id,
          label: label ? label.trim().slice(0, 200) : null,
          kind: r?.kind ?? el.getAttribute('data-dc-kind') ?? null,
          x: r?.x ?? el.offsetLeft,
          y: r?.y ?? el.offsetTop,
          w: r?.w ?? el.offsetWidth,
          h: r?.h ?? el.offsetHeight,
        });
      }
      return out;
    }),
    3000
  );
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const rows = [];
  for (const a of raw) {
    if (!a || !SAFE_ID(a.id) || seen.has(a.id)) continue;
    seen.add(a.id);
    rows.push({
      id: a.id,
      label: typeof a.label === 'string' && a.label ? a.label : null,
      kind: ['digital', 'print', 'web', 'video'].includes(a.kind) ? a.kind : null,
      x: num(a.x) ?? 0,
      y: num(a.y) ?? 0,
      w: num(a.w),
      h: num(a.h),
    });
  }
  return rows;
}

/** C31: the first artboard in "Order and notes…" when set, else row by row, left to right. */
function pickCover(rects, order) {
  if (Array.isArray(order)) for (const id of order) if (rects.some((r) => r.id === id)) return id;
  if (!rects.length) return null;
  const minY = Math.min(...rects.map((r) => r.y));
  const minH = Math.min(...rects.map((r) => r.h ?? 0).filter((h) => h > 0), 1);
  const top = rects.filter((r) => r.y < minY + minH / 2);
  return top.sort((a, b) => a.x - b.x)[0]?.id ?? rects[0].id;
}

async function shoot(page, job, index, target, runtime, left) {
  const px = Math.max(16, Math.min(2048, Math.trunc(Number(target.px) || 480)));
  let id = target.artboard == null ? null : String(target.artboard);
  const domIds = runtime.map((a) => a.id);
  if (id === null && domIds.length) id = pickCover(runtime, job.coverOrder);
  else if (id !== null && !domIds.includes(id)) return { target: index, missing: true };

  const box = await page.evaluate(
    ([abId, size]) => {
      const world = document.querySelector('.dc-world');
      if (abId !== null) {
        const abs = [...document.querySelectorAll('[data-dc-screen]')];
        const ab = abs.find((a) => a.getAttribute('data-dc-screen') === abId);
        if (!ab) return null;
        if (world) {
          world.style.transform = 'none';
          world.style.zoom = '1';
        }
        for (const o of abs) o.style.visibility = o === ab ? '' : 'hidden';
        ab.style.left = '0px';
        ab.style.top = '0px';
        const w = ab.offsetWidth || 1;
        const h = ab.offsetHeight || 1;
        const z = Math.min(1, size / Math.max(w, h));
        if (world) world.style.zoom = String(z);
        else ab.style.zoom = String(z);
        window.scrollTo(0, 0);
        const b = ab.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
      }
      // a specimen: #canvas-root, clipped to 16 : 10 from the top
      const root = document.querySelector('#canvas-root');
      if (!root) return null;
      const w = root.scrollWidth || root.offsetWidth || 1;
      root.style.zoom = String(Math.min(1, size / w));
      window.scrollTo(0, 0);
      const b = root.getBoundingClientRect();
      const cw = Math.min(b.width, size);
      return { x: b.left, y: b.top, w: cw, h: Math.min(b.height, (cw * 10) / 16) };
    },
    [id, px]
  );
  if (!box) return { target: index, missing: id !== null };

  // The page reported this box; clamp it to what the server asked for (R2).
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  const x = Math.floor(clamp(box.x, 0, MAX_VIEW - 1));
  const y = Math.floor(clamp(box.y, 0, MAX_VIEW - 1));
  const w = Math.max(1, Math.floor(clamp(box.w, 1, px)));
  const h = Math.max(1, Math.floor(clamp(box.h, 1, px)));
  await page.setViewportSize({
    width: Math.min(MAX_VIEW, Math.max(1, x + w)),
    height: Math.min(MAX_VIEW, Math.max(1, y + h)),
  });

  const scope = id;
  await bounded(
    page.evaluate((abId) => {
      const el =
        abId === null
          ? document.querySelector('#canvas-root')
          : [...document.querySelectorAll('[data-dc-screen]')].find(
              (a) => a.getAttribute('data-dc-screen') === abId
            );
      return Promise.all(
        [...(el?.querySelectorAll('img') ?? [])].map((im) => im.decode().catch(() => {}))
      );
    }, scope),
    3000
  );
  let partial = false;
  const kind = runtime.find((a) => a.id === id)?.kind;
  if (kind === 'video') {
    const poster = Number(job.posters?.[id] ?? 0);
    const seek = await bounded(
      page.evaluate(
        async (frame) => {
          if (typeof window.__maude_seek__ !== 'function') return true;
          await window.__maude_seek__(frame, { strict: false });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return true;
        },
        Number.isFinite(poster) && poster >= 0 ? Math.trunc(poster) : 0
      ),
      3000
    );
    if (seek !== true) partial = true;
  }
  assertOrigin(page, job);
  const jpeg = await page.screenshot({
    type: 'jpeg',
    quality: 80,
    clip: { x, y, width: w, height: h },
    timeout: Math.max(1000, Math.min(10_000, left())),
  });
  return { target: index, artboard: id, jpeg: jpeg.toString('base64'), partial };
}

async function render(msg) {
  const t0 = Date.now();
  const deadline = t0 + Math.max(1000, Math.min(Number(msg.deadlineMs) || 20_000, 60_000));
  const left = () => Math.max(1, deadline - Date.now());
  const job = {
    url: String(msg.url),
    expectOrigin: String(msg.expectOrigin),
    hasArtboards: msg.hasArtboards === true,
    coverOrder: Array.isArray(msg.coverOrder) ? msg.coverOrder.filter(SAFE_ID).slice(0, 500) : null,
    posters: msg.posters && typeof msg.posters === 'object' ? msg.posters : {},
    entered: false,
    blocked: 0,
    page: null,
  };
  const targets = Array.isArray(msg.targets) ? msg.targets.slice(0, 64) : [];
  const page = await takePage(job.expectOrigin);
  const launchMs = lastLaunchMs;
  lastLaunchMs = null;
  job.page = page;
  jobsByPage.set(page, job);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: left() });
    assertOrigin(page, job);
    await page
      .locator('#canvas-root > *')
      .first()
      .waitFor({ state: 'attached', timeout: Math.min(20_000, left()) });
    if (job.hasArtboards) {
      await page
        .locator('[data-dc-screen]')
        .first()
        .waitFor({ state: 'attached', timeout: Math.min(10_000, left()) })
        .catch(() => {});
      await settleCount(page, left);
    } else {
      await bounded(frames(page), 1000);
    }
    await bounded(
      page.evaluate(() => document.fonts.ready.then(() => true)),
      3000
    );
    const runtime = await harvest(page);
    const shots = [];
    for (const [i, t] of targets.entries()) shots.push(await shoot(page, job, i, t, runtime, left));
    return {
      ok: true,
      runtime: {
        artboards: runtime.map(({ id, label, kind, w, h }) => ({ id, label, kind, w, h })),
      },
      shots,
      blocked: job.blocked,
      ms: Date.now() - t0,
      launchMs,
    };
  } finally {
    jobsByPage.delete(page);
    await page.goto('about:blank').catch(() => {});
    releasePage(page);
  }
}

/** An asset tile: a raster picture (or a video frame at 0.5 s) on a blank capture page (§5.8). */
async function tile(msg) {
  const t0 = Date.now();
  const px = Math.max(16, Math.min(2048, Math.trunc(Number(msg.px) || 480)));
  const job = {
    url: String(msg.url),
    expectOrigin: String(msg.expectOrigin),
    entered: false,
    blocked: 0,
    page: null,
  };
  const page = await takePage(job.expectOrigin);
  job.page = page;
  jobsByPage.set(page, job);
  try {
    await page.setViewportSize({ width: px, height: px });
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    assertOrigin(page, job);
    const box = await bounded(
      page.evaluate(
        async ([src, size, video]) => {
          const host = document.createElement('div');
          host.style.cssText =
            'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;margin:0;background:#fff';
          document.body.appendChild(host);
          let el;
          let w;
          let h;
          if (video) {
            el = document.createElement('video');
            el.muted = true;
            el.preload = 'auto';
            el.src = src;
            await new Promise((res, rej) => {
              el.addEventListener('loadeddata', res, { once: true });
              el.addEventListener('error', rej, { once: true });
            });
            el.currentTime = Math.min(0.5, el.duration || 0.5);
            await new Promise((res) => {
              el.addEventListener('seeked', res, { once: true });
              setTimeout(res, 2000);
            });
            if (el.readyState < 2) return null;
            w = el.videoWidth;
            h = el.videoHeight;
          } else {
            el = new Image();
            el.src = src;
            await el.decode();
            w = el.naturalWidth;
            h = el.naturalHeight;
          }
          if (!w || !h) return null;
          const s = Math.min(1, size / Math.max(w, h));
          const cw = Math.max(1, Math.round(w * s));
          const ch = Math.max(1, Math.round(h * s));
          el.style.cssText = `display:block;width:${cw}px;height:${ch}px`;
          host.appendChild(el);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { w: cw, h: ch };
        },
        [String(msg.src), px, msg.video === true]
      ),
      3000
    ).catch(() => null);
    if (!box || box === '__timeout__') return { ok: true, shots: [{ target: 0, missing: true }] };
    assertOrigin(page, job);
    const w = Math.max(1, Math.min(px, Math.floor(box.w)));
    const h = Math.max(1, Math.min(px, Math.floor(box.h)));
    const jpeg = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      clip: { x: 0, y: 0, width: w, height: h },
      timeout: 10_000,
    });
    return {
      ok: true,
      shots: [{ target: 0, jpeg: jpeg.toString('base64'), partial: false }],
      blocked: job.blocked,
      ms: Date.now() - t0,
    };
  } finally {
    jobsByPage.delete(page);
    await page.goto('about:blank').catch(() => {});
    releasePage(page);
  }
}

async function handle(msg) {
  const id = msg?.id;
  if (msg?.op === 'close') return closeBrowser();
  if (msg?.op === 'probe') {
    const ctx = ctxState ? await ctxState.ctx.catch(() => null) : null;
    const cookies = ctx ? (await ctx.cookies()).map((c) => c.name) : [];
    return send({ id, ok: true, probe: { pid: process.pid, browser: !!browserP, cookies } });
  }
  if (msg?.op !== 'render' && msg?.op !== 'tile')
    return send({ id, ok: false, error: 'unknown op' });
  inflight++;
  clearTimeout(idleTimer);
  try {
    send({ id, ...(await (msg.op === 'tile' ? tile(msg) : render(msg))) });
  } catch (e) {
    const code =
      e?.code === 'origin' ? 'origin' : /timeout/i.test(String(e?.message)) ? 'timeout' : 'error';
    send({
      id,
      ok: false,
      error: code,
      detail: String(e?.message ?? e)
        .split('\n')[0]
        .slice(0, 300),
    });
  } finally {
    inflight--;
    armIdle();
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  void handle(msg);
});
// The shim dies with the server: its stdin closes when the parent goes.
rl.on('close', async () => {
  await closeBrowser();
  process.exit(0);
});
