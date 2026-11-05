// _ds-prove-playwright.mjs — the visual gate of "Bring it up to the schema" (V2-1.13 §5.10 step 6,
// S10.15a). Spawned by ds/upgrade-prove.ts as a subprocess (so `bun --compile` of the studio never
// pulls playwright in), exactly like the exporters' shims.
//
// Input: `--job <file.json>` = { before, after, canvases: [{path, tokens, components, themes}],
// deltaE, ratio, timeout, canvasTimeout, workers? }. `before` / `after` are the origins of two
// headless studios on the staged copies; every URL goes through the main origin's 307 to that
// studio's read-only capture origin. For every artboard of every canvas (a specimen with none: its
// whole mount), in every theme it carries (`[data-theme]` inside it, flipped in place; one that
// carries none: each system theme, on `<html>`), both renders are shot by the artboard's OWN rect
// with everything else hidden (`_ds-prove-judge.mjs`) and diffed IN THE PAGE: OKLab ΔE × 100 >
// deltaE is a changed pixel, changed / area > ratio fails the artboard. A failing pair gets a noise
// control — `before` rendered again — and a pair that differs with itself is not a failure. Each
// canvas has a hard deadline: past it the canvas is `timeout` and the run goes on. No new
// dependency — the decode and the maths run in Chromium.
//
// Output (stdout, last line): { canvases: [{path, error?, specimen?, artboards: [{id, theme,
// width, height, changed, area, fail, reason?, noise?, empty?, control?}]}] }.

import { readFileSync } from 'node:fs';
import {
  clipOf,
  isolateArtboard,
  judge,
  pairFails,
  restoreArtboard,
  SPECIMEN_ID,
  themesFor,
  viewportFor,
  withDeadline,
} from './_ds-prove-judge.mjs';
import { launchChromium, newShellContext } from './_pw-launch.mjs';

const argv = process.argv.slice(2);
const jobAt = argv.indexOf('--job');
if (jobAt < 0 || !argv[jobAt + 1]) {
  console.error('usage: _ds-prove-playwright.mjs --job <job.json>');
  process.exit(2);
}
const job = JSON.parse(readFileSync(argv[jobAt + 1], 'utf8'));
const DELTA_E = Number(job.deltaE ?? 2);
const RATIO = Number(job.ratio ?? 0.005);
const TIMEOUT = Number(job.timeout ?? 20000);
const MAX_SIDE = 4000;
const CANVAS_TIMEOUT = Number(job.canvasTimeout ?? 180000);
const BASE_VIEWPORT = { width: 1440, height: 900 };

const shellUrl = (origin, c) => {
  const p = new URLSearchParams();
  p.set('canvas', c.path);
  if (c.tokens) p.set('tokens', c.tokens);
  if (c.components) p.set('components', c.components);
  p.set('hide-chrome', '1');
  return `${origin}/_canvas-shell.html?${p.toString()}`;
};

/** Open a canvas; returns its artboards' ids and the themes each one carries. */
async function open(page, url, gotoShell) {
  await gotoShell(page, url, { waitUntil: 'load', timeout: TIMEOUT });
  await page.evaluate(() => document.fonts.ready);
  // Ready = an artboard is there, or the shell said why not, or it mounted a canvas that has no
  // artboard (a specimen): that one is given a moment, then taken as it is — never the whole timeout.
  const started = Date.now();
  let mountedAt = 0;
  while (Date.now() - started < TIMEOUT) {
    const s = await page
      .evaluate(() => ({
        board: !!document.querySelector('[data-dc-screen]'),
        err: !!document.getElementById('canvas-mount-error')?.textContent?.trim(),
        mounted:
          !!window.__maudeCanvasRuntime ||
          !!window.__dsProveMounted ||
          (document.getElementById('canvas-root')?.childElementCount ?? 0) > 0,
      }))
      .catch(() => null);
    if (s?.board || s?.err) break;
    if (s?.mounted) {
      mountedAt ||= Date.now();
      if (Date.now() - mountedAt > 1500) break;
    }
    await page.waitForTimeout(80);
  }
  // Not `networkidle`: it waits out 500 ms of quiet per page (and the whole timeout when anything
  // polls), which was most of the 6 s an artboard cost. What a render needs is its fonts and its
  // images decoded; both sides wait for exactly the same things.
  await page.evaluate(async () => {
    await document.fonts.ready;
    const pending = [...document.images].filter((i) => !i.complete);
    await Promise.all(
      pending.map(
        (i) =>
          new Promise((r) => {
            i.addEventListener('load', r, { once: true });
            i.addEventListener('error', r, { once: true });
            setTimeout(r, 4000);
          })
      )
    );
    await Promise.all([...document.images].map((i) => i.decode?.().catch(() => {})));
  });
  // A hug artboard is sized by its content, a layout pass after it mounts: measured at once, the two studios
  // caught the same unchanged canvas 20 px apart ("size" refusals on Plain / Spec, `systemFailed`). Wait until
  // every artboard's box holds still for three reads in a row (capped: a canvas that never settles is taken as is).
  {
    let last = '';
    let still = 0;
    for (let i = 0; i < 40 && still < 3; i++) {
      const now = await page
        .evaluate(() =>
          [...document.querySelectorAll('[data-dc-screen]')]
            .map((el) => {
              const r = el.getBoundingClientRect();
              return `${Math.round(r.width)}x${Math.round(r.height)}`;
            })
            .join(',')
        )
        .catch(() => '');
      still = now === last ? still + 1 : 0;
      last = now;
      await page.waitForTimeout(100);
    }
  }
  return page.evaluate(() => {
    const err = document.getElementById('canvas-mount-error')?.textContent?.trim() || null;
    const boards = [...document.querySelectorAll('[data-dc-screen]')].map((el) => ({
      id: el.getAttribute('data-dc-screen') || '',
      themes: [
        ...new Set(
          [el, ...el.querySelectorAll('[data-theme]')]
            .map((n) => n.getAttribute('data-theme'))
            .filter(Boolean)
        ),
      ],
    }));
    return { err, boards };
  });
}

/** Two animation frames: what was set is laid out and painted. */
const frames = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Isolate the element and read its rect until it holds still (a hug artboard settles a pass late). */
async function stableRect(page, arg) {
  let last = '';
  let still = 0;
  let rect = null;
  for (let i = 0; i < 30 && still < 2; i++) {
    rect = await page.evaluate(isolateArtboard, arg);
    if (!rect) return null;
    const key = [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(',');
    still = key === last ? still + 1 : 0;
    last = key;
    await frames(page);
  }
  return rect;
}

/**
 * One artboard (or a specimen's mount) in one theme → a PNG of exactly its own rect, everything else
 * hidden. Every page goes through the same steps from the same viewport, whatever it shot before —
 * so before and after are measured alike (the old shim sized after's viewport from before's shot, and
 * the same unchanged artboard came out a different size). `{ empty: true }` = nothing rendered.
 */
async function shot(page, id, { theme, htmlTheme }) {
  const arg = { id, theme, htmlTheme, specimenId: SPECIMEN_ID };
  await page.setViewportSize(BASE_VIEWPORT);
  try {
    let rect = await stableRect(page, arg);
    if (!rect) return null;
    const vp = viewportFor(rect, BASE_VIEWPORT, MAX_SIDE);
    if (vp.width !== BASE_VIEWPORT.width || vp.height !== BASE_VIEWPORT.height) {
      await page.setViewportSize(vp);
      rect = await stableRect(page, arg);
      if (!rect) return null;
    }
    const clip = clipOf(rect, MAX_SIDE);
    if (!clip) return { empty: true };
    const png = await page.screenshot({ clip, animations: 'disabled' });
    return { png, width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  } finally {
    await page.evaluate(restoreArtboard, { id }).catch(() => {});
  }
}

/** The diff, in the page: OKLab ΔE per pixel over two same-size PNGs. */
async function diffInPage(page, a, b, deltaE) {
  return page.evaluate(
    async ({ a, b, deltaE }) => {
      const load = async (b64) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const px = (img) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const da = px(ia);
      const db = px(ib);
      const lin = new Float64Array(256);
      for (let i = 0; i < 256; i++) {
        const c = i / 255;
        lin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }
      const lab = (d, i) => {
        const r = lin[d[i]];
        const g = lin[d[i + 1]];
        const bl = lin[d[i + 2]];
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
        return [
          0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
        ];
      };
      let changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (
          da[i] === db[i] &&
          da[i + 1] === db[i + 1] &&
          da[i + 2] === db[i + 2] &&
          da[i + 3] === db[i + 3]
        )
          continue;
        const [l1, a1, b1] = lab(da, i);
        const [l2, a2, b2] = lab(db, i);
        const alpha = Math.abs(da[i + 3] - db[i + 3]) / 255;
        const de = Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100 + alpha * 100;
        if (de > deltaE) changed++;
      }
      return { changed, area: w * h };
    },
    { a: a.toString('base64'), b: b.toString('base64'), deltaE }
  );
}

/** before × after (or any two shots) → the measured pair. */
async function measure(pd, x, y) {
  const d = await diffInPage(pd, x.png, y.png, DELTA_E);
  return { sized: x.width === y.width && x.height === y.height, changed: d.changed, area: d.area };
}

/** One canvas on one worker's pages → its row. Never throws: a canvas that cannot render is a row with an error. */
async function proveCanvas(c, { pa, pb, pc, pd, goto }) {
  const row = { path: c.path, artboards: [] };
  let control = null; // before, rendered a second time — opened only when a pair fails
  const openControl = () => {
    control ??= open(pc, shellUrl(job.before, c), goto).then(
      (C) => (C.err ? null : C),
      () => null
    );
    return control;
  };
  try {
    const [A, B] = await Promise.all([
      open(pa, shellUrl(job.before, c), goto),
      open(pb, shellUrl(job.after, c), goto),
    ]);
    if (A.err || B.err) {
      row.error = A.err ? 'before' : 'after';
      row.detail = String(A.err || B.err).slice(0, 300);
      return row;
    }
    // A canvas with no artboard on either side (a specimen) is measured as one: its whole mount.
    const specimen = !A.boards.length && !B.boards.length;
    if (specimen) row.specimen = true;
    const boards = specimen ? [{ id: SPECIMEN_ID, themes: [] }] : A.boards;
    const bIds = new Set(specimen ? [SPECIMEN_ID] : B.boards.map((x) => x.id));
    for (const board of boards) {
      if (!bIds.has(board.id)) {
        row.artboards.push({ id: board.id, theme: null, fail: true, reason: 'missing' });
        continue;
      }
      for (const t of themesFor(board.themes, c.themes)) {
        const sa = await shot(pa, board.id, t);
        const sb = sa && (await shot(pb, board.id, t));
        if (sa?.empty && sb?.empty) {
          row.artboards.push({ id: board.id, theme: t.theme, empty: true, fail: false });
          continue;
        }
        if (!sa || !sb || sa.empty || sb.empty) {
          row.artboards.push({ id: board.id, theme: t.theme, fail: true, reason: 'missing' });
          continue;
        }
        const ab = await measure(pd, sa, sb);
        let ac = null;
        let bc = null;
        if (pairFails(ab, RATIO) && (await openControl())) {
          const sc = await shot(pc, board.id, t);
          if (sc && !sc.empty) {
            ac = await measure(pd, sa, sc);
            bc = await measure(pd, sb, sc);
          }
        }
        const v = judge({ ab, ac, bc }, RATIO);
        row.artboards.push({
          id: board.id,
          theme: t.theme,
          width: sa.width,
          height: sa.height,
          changed: ab.changed,
          area: ab.area,
          fail: v.fail,
          ...(ab.sized ? {} : { reason: 'size' }),
          ...(v.noise ? { noise: true } : {}),
          ...(ac ? { control: { changed: ac.changed, area: ac.area, sized: ac.sized } } : {}),
        });
      }
    }
  } catch (e) {
    row.error = 'render';
    row.detail = String(e?.message ?? e).slice(0, 300);
  }
  return row;
}

const CONTEXT_OPTS = {
  serviceWorkers: 'block',
  viewport: BASE_VIEWPORT,
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
};

/** A worker's own context and pages (before, after, the noise control, the diff page). */
async function newPages(browser) {
  // gate-b-c4d — each page confined to the origin its shell lands on (popups, other origins refused).
  const { ctx, goto } = await newShellContext(browser, CONTEXT_OPTS);
  // The shell tells its parent the canvas mounted (`canvas-mounted`, also for a specimen that
  // renders nothing); at the top level that parent is the page itself. Without it such a canvas
  // waited out the whole timeout on both sides.
  await ctx.addInitScript(() => {
    addEventListener('message', (e) => {
      const d = e.data;
      if (d && (d.dgn === 'canvas-mounted' || d.dgn === 'canvas-rendered'))
        window.__dsProveMounted = true;
    });
  });
  const pages = {
    pa: await ctx.newPage(),
    pb: await ctx.newPage(),
    pc: await ctx.newPage(),
    pd: await ctx.newPage(),
    goto,
  };
  await pages.pd.setContent('<!doctype html><title>ds prove diff</title>');
  return { ctx, pages };
}

// Canvases are independent, so a few workers prove them side by side, each on a context of its own
// (a canvas's render is a page, not the machine). The order of `out.canvases` is the job's.
//
// Every canvas has a hard deadline (`canvasTimeout`): a canvas whose renderer never answers (a heavy
// 3D scene at 99 % CPU) is reported `timeout` and the run goes on — its worker throws the context
// away (closing its pages kills their renderers) and starts a fresh one; when even the close does not
// answer, the worker moves to a browser of its own, so no later canvas inherits the stuck one.
const WORKERS = Math.max(1, Math.min(Number(job.workers ?? 3), job.canvases.length || 1));
const shared = await launchChromium();
const browsers = new Set([shared]);
const out = { canvases: job.canvases.map((c) => ({ path: c.path, artboards: [] })) };
const closeWithin = (p, ms) => withDeadline(() => p, ms).catch(() => ({ ok: false }));
try {
  let next = 0;
  let done = 0;
  const worker = async () => {
    let browser = shared;
    let { ctx, pages } = await newPages(browser);
    for (;;) {
      const i = next++;
      if (i >= job.canvases.length) break;
      const c = job.canvases[i];
      const r = await withDeadline(() => proveCanvas(c, pages), CANVAS_TIMEOUT);
      if (r.ok) out.canvases[i] = r.value;
      else {
        out.canvases[i] = {
          path: c.path,
          error: 'timeout',
          detail: `no answer within ${Math.round(CANVAS_TIMEOUT / 1000)} s`,
          artboards: [],
        };
        const closed = await closeWithin(ctx.close(), 10_000);
        if (!closed.ok) {
          browser = await launchChromium();
          browsers.add(browser);
        }
        ({ ctx, pages } = await newPages(browser));
      }
      done++;
      console.log(
        `MAUDE_PROGRESS ${JSON.stringify({ current: done, total: job.canvases.length })}`
      );
    }
    await closeWithin(ctx.close(), 10_000);
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
} finally {
  await Promise.all([...browsers].map((b) => closeWithin(b.close(), 10_000)));
}
// a stuck renderer can keep the browser's pipes open: write the answer, then leave
await new Promise((r) => process.stdout.write(`${JSON.stringify(out)}\n`, r));
process.exit(0);
