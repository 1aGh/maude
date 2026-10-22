// _ds-prove-playwright.mjs — the visual gate of "Bring it up to the schema" (V2-1.13 §5.10 step 6,
// S10.15a). Spawned by ds/upgrade-prove.ts as a subprocess (so `bun --compile` of the studio never
// pulls playwright in), exactly like the exporters' shims.
//
// Input: `--job <file.json>` = { before, after, canvases: [{path, tokens, components}], deltaE,
// ratio, timeout }. `before` / `after` are the origins of two headless studios on the staged
// copies; every URL goes through the main origin's 307 to that studio's read-only capture origin.
// For every artboard of every canvas, in every theme the artboard carries (`[data-theme]` inside
// it, flipped in place), both renders are captured at the same size and diffed IN THE PAGE: OKLab
// ΔE × 100 > deltaE is a changed pixel, changed / area > ratio fails the artboard. No new
// dependency — the decode and the maths run in Chromium.
//
// Output (stdout, last line): { canvases: [{path, error?, artboards: [{id, theme, width, height,
// changed, area, fail, reason?}]}] }.

import { readFileSync } from 'node:fs';
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
  return page.evaluate(() => {
    const err = document.getElementById('canvas-mount-error')?.textContent?.trim() || null;
    const world = document.querySelector('.dc-world');
    if (world) {
      world.style.zoom = '1';
      world.style.transform = 'none';
    }
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

/** One artboard in one theme → a PNG buffer (the artboard moved to 0,0, the viewport its size). */
async function shot(page, id, theme, size) {
  const rect = await page.evaluate(
    ({ id, theme }) => {
      const ab = [...document.querySelectorAll('[data-dc-screen]')].find(
        (el) => el.getAttribute('data-dc-screen') === id
      );
      if (!ab) return null;
      window.__dsProveSaved ??= new Map();
      if (!window.__dsProveSaved.has(id)) {
        const themed = [ab, ...ab.querySelectorAll('[data-theme]')].filter((n) =>
          n.hasAttribute('data-theme')
        );
        window.__dsProveSaved.set(id, {
          left: ab.style.left,
          top: ab.style.top,
          themed: themed.map((n) => [n, n.getAttribute('data-theme')]),
        });
      }
      const saved = window.__dsProveSaved.get(id);
      for (const [n, t] of saved.themed) n.setAttribute('data-theme', theme ?? t);
      ab.style.left = '0px';
      ab.style.top = '0px';
      const r = ab.getBoundingClientRect();
      if (r.left || r.top) {
        ab.style.left = `${-r.left}px`;
        ab.style.top = `${-r.top}px`;
      }
      window.scrollTo(0, 0);
      const f = ab.getBoundingClientRect();
      return { width: Math.ceil(f.width), height: Math.ceil(f.height) };
    },
    { id, theme }
  );
  if (!rect) return null;
  const width = Math.max(1, Math.min(MAX_SIDE, size?.width ?? rect.width));
  const height = Math.max(1, Math.min(MAX_SIDE, size?.height ?? rect.height));
  await page.setViewportSize({ width, height });
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  const png = await page.screenshot({
    clip: { x: 0, y: 0, width, height },
    animations: 'disabled',
  });
  await page.evaluate((id) => {
    const ab = [...document.querySelectorAll('[data-dc-screen]')].find(
      (el) => el.getAttribute('data-dc-screen') === id
    );
    const saved = window.__dsProveSaved?.get(id);
    if (!ab || !saved) return;
    ab.style.left = saved.left;
    ab.style.top = saved.top;
    for (const [n, t] of saved.themed) n.setAttribute('data-theme', t);
  }, id);
  return { png, width: rect.width, height: rect.height };
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

/** One canvas on one worker's pages → its row. Never throws: a canvas that cannot render is a row with an error. */
async function proveCanvas(c, { pa, pb, pd, goto }) {
  const row = { path: c.path, artboards: [] };
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
    const bIds = new Set(B.boards.map((x) => x.id));
    for (const board of A.boards) {
      if (!bIds.has(board.id)) {
        row.artboards.push({ id: board.id, theme: null, fail: true, reason: 'missing' });
        continue;
      }
      const themes = board.themes.length ? board.themes : [null];
      for (const theme of themes) {
        const sa = await shot(pa, board.id, theme);
        const sb = sa && (await shot(pb, board.id, theme, sa));
        if (!sa || !sb) {
          row.artboards.push({ id: board.id, theme, fail: true, reason: 'missing' });
          continue;
        }
        const sized = sa.width === sb.width && sa.height === sb.height;
        const d = await diffInPage(pd, sa.png, sb.png, DELTA_E);
        const fail = !sized || d.changed / Math.max(1, d.area) > RATIO;
        row.artboards.push({
          id: board.id,
          theme,
          width: sa.width,
          height: sa.height,
          changed: d.changed,
          area: d.area,
          fail,
          ...(sized ? {} : { reason: 'size' }),
        });
      }
    }
  } catch (e) {
    row.error = 'render';
    row.detail = String(e?.message ?? e).slice(0, 300);
  }
  return row;
}

// Canvases are independent, so a few workers prove them side by side, each on a context of its own
// (a canvas's render is a page, not the machine). The order of `out.canvases` is the job's.
const WORKERS = Math.max(1, Math.min(Number(job.workers ?? 3), job.canvases.length || 1));
const browser = await launchChromium();
const out = { canvases: job.canvases.map((c) => ({ path: c.path, artboards: [] })) };
try {
  let next = 0;
  let done = 0;
  const worker = async () => {
    // gate-b-c4d — each page confined to the origin its shell lands on (popups, other origins refused).
    const { ctx, goto } = await newShellContext(browser, {
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const pages = {
      pa: await ctx.newPage(),
      pb: await ctx.newPage(),
      pd: await ctx.newPage(),
      goto,
    };
    await pages.pd.setContent('<!doctype html><title>ds prove diff</title>');
    for (;;) {
      const i = next++;
      if (i >= job.canvases.length) break;
      out.canvases[i] = await proveCanvas(job.canvases[i], pages);
      done++;
      console.log(
        `MAUDE_PROGRESS ${JSON.stringify({ current: done, total: job.canvases.length })}`
      );
    }
    await ctx.close();
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
} finally {
  await browser.close();
}
console.log(JSON.stringify(out));
