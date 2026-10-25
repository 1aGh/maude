#!/usr/bin/env node
// _perf-probe-studio.mjs — the Chromium STUDIO lane behind `perf.sh --engine chromium --studio`
// (V2-8.8, V2-1.8 contract T5/M7).
//
// The bare-canvas probe (`_perf-probe.mjs`) times the canvas page on its own. This one times the
// canvas AS THE USER RUNS IT: inside the studio shell, in the cross-origin canvas iframe, with
// whatever the shell draws around it (v2: the floating islands over a full-width canvas; pre-v2:
// the sidebar and docked panels). Same gesture, same in-frame harness (`harnessSource`), same
// refusals and report as the other two probes — only the document under test and the engine differ.
//
// Playwright drives it because the canvas frame is a different origin (DDR-054): its `Frame`
// object evaluates inside it, which the page-level `eval` of agent-browser cannot. The page is a
// Retina one (deviceScaleFactor 2) at --window, because the V2-1.8 findings are dpr-2 findings.
//
// Usage: node _perf-probe-studio.mjs --url <studio-root-url> --studio <canvas-slug>
//          [--history <p>] [--engine-tag <t>] [--label <l>] [--timeout <s>] [--pan <n>]
//          [--zoom <n>] [--repeat <n>] [--fit-all] [--window WxH] [--dpr <n>] [--json]
// Exit:  0 measured / 1 dependency, capture failure or a refused pass / 2 bad args / 3 occluded.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  buildRow,
  emptyViewportRefusal,
  harnessSource,
  medianOf,
  occlusionRefusal,
  parseAndValidateResult,
  readHistory,
  renderReport,
} from './_perf-shared.mjs';
import { launchChromium } from './_pw-launch.mjs';

function parseArgs(argv) {
  const o = {
    url: '',
    studio: '',
    label: '',
    history: '',
    engineTag: '',
    timeout: 30,
    pan: 60,
    zoom: 40,
    repeat: 3,
    fitAll: false,
    window: '1600x1000',
    dpr: 2,
    json: false,
    variant: '',
    injectCss: '',
    setFlags: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--url') o.url = v();
    else if (a === '--studio') o.studio = v();
    else if (a === '--label') o.label = v();
    else if (a === '--history') o.history = v();
    else if (a === '--engine-tag') o.engineTag = v();
    else if (a === '--timeout') o.timeout = Number(v());
    else if (a === '--pan') o.pan = Number(v());
    else if (a === '--zoom') o.zoom = Number(v());
    else if (a === '--repeat') o.repeat = Number(v());
    else if (a === '--fit-all') o.fitAll = true;
    else if (a === '--window') o.window = v();
    else if (a === '--dpr') o.dpr = Number(v());
    else if (a === '--variant') o.variant = v();
    else if (a === '--inject-css') o.injectCss = v();
    else if (a === '--json') o.json = true;
    else {
      console.error(`_perf-probe-studio.mjs: unknown arg '${a}'`);
      process.exit(2);
    }
  }
  if (!o.url || !o.studio) {
    console.error('_perf-probe-studio.mjs: --url and --studio <slug> are required');
    process.exit(2);
  }
  const m = /^(\d{3,5})x(\d{3,5})$/.exec(o.window);
  if (!m) {
    console.error('_perf-probe-studio.mjs: --window must be WxH, e.g. 1600x1000');
    process.exit(2);
  }
  o.viewport = { width: Number(m[1]), height: Number(m[2]) };
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const browser = await launchChromium();
  let code = 0;
  try {
    const ctx = await browser.newContext({
      viewport: opts.viewport,
      deviceScaleFactor: opts.dpr,
    });
    const page = await ctx.newPage();
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
    const rowSel = `[data-testid="canvas-row-${opts.studio}"]`;
    try {
      // v2's Canvases panel is virtualised (93 canvases): a row below the fold is not in the DOM,
      // so a search narrows it first. The pre-v2 tree has no such field and lists every row.
      const searchSel = '[data-testid="canvas-search"]';
      await page.waitForSelector(`${rowSel}, ${searchSel}`, { timeout: opts.timeout * 1000 });
      if (!(await page.$(rowSel)) && (await page.$(searchSel))) {
        await page
          .fill(`${searchSel} input, input${searchSel}`, opts.studio.replace(/^ui-/, ''))
          .catch(async () => page.fill(searchSel, opts.studio.replace(/^ui-/, '')));
      }
      await page.waitForSelector(rowSel, { timeout: opts.timeout * 1000 });
    } catch {
      console.error(`_perf-probe-studio.mjs: no ${rowSel} in the studio — check the slug`);
      process.exit(1);
    }
    await page.click(rowSel);
    const isCanvasFrame = (f) => /_canvas-shell/.test(f.url());
    let frame = null;
    for (let i = 0; i < opts.timeout * 2 && !frame; i++) {
      frame = page.frames().find(isCanvasFrame) || null;
      if (!frame) await sleep(500);
    }
    if (!frame) {
      console.error('_perf-probe-studio.mjs: the canvas iframe never appeared');
      process.exit(1);
    }
    let ready = false;
    for (let i = 0; i < opts.timeout * 2; i++) {
      const n = await frame.evaluate(() => document.querySelectorAll('[data-dc-screen]').length);
      if (n > 0) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) {
      console.error(`_perf-probe-studio.mjs: no [data-dc-screen] after ${opts.timeout}s`);
      process.exit(1);
    }

    async function runOnce() {
      await frame.evaluate('window.__maudePerfResult = null');
      const started = await frame.evaluate(
        harnessSource({
          pan: opts.pan,
          zoom: opts.zoom,
          injectCss: opts.injectCss,
          fitAll: opts.fitAll,
          setFlags: opts.setFlags,
        })
      );
      if (started === 'NO_HOST') {
        console.error('_perf-probe-studio.mjs: no .dc-canvas host found in the canvas frame');
        process.exit(1);
      }
      for (let i = 0; i < opts.timeout * 2; i++) {
        await sleep(500);
        const r = await frame.evaluate('JSON.stringify(window.__maudePerfResult)');
        if (r && r !== 'null') {
          const parsed = parseAndValidateResult(r);
          if (!parsed) {
            console.error(
              '_perf-probe-studio.mjs: malformed result from the canvas frame — refusing it'
            );
            process.exit(1);
          }
          return parsed;
        }
      }
      console.error(`_perf-probe-studio.mjs: gesture never completed within ${opts.timeout}s`);
      process.exit(1);
    }

    const passes = [];
    const total = Math.max(1, opts.repeat);
    for (let i = 0; i < total; i++) {
      const r = await runOnce();
      const hidden = occlusionRefusal(r, i + 1);
      if (hidden) {
        console.error(`_perf-probe-studio.mjs: ${hidden}`);
        code = 3;
        return;
      }
      if (!r.panApplied || !r.zoomApplied) {
        console.error(`_perf-probe-studio.mjs: gesture did not reach the canvas on pass ${i + 1}`);
        code = 1;
        return;
      }
      const empty = emptyViewportRefusal(r, i + 1);
      if (empty) {
        console.error(`_perf-probe-studio.mjs: ${empty}`);
        code = 1;
        return;
      }
      if (i > 0 || total === 1) passes.push(r);
      process.stderr.write(
        `→ pass ${i + 1}/${total}: ${r.boardsOnScreen} boards on screen, gesture p95 ${r.gesture.p95}ms zoom p95 ${r.zoom.p95}ms long ${r.longFrames}` +
          `${i === 0 && total > 1 ? ' (warm-up, discarded)' : ''}\n`
      );
    }
    const result = medianOf(passes);
    // where the camera ended (fit-all): the world's scale, so "below 25 %" is a measured fact
    const worldScale = await frame
      .evaluate(() => {
        const w = document.querySelector('.dc-world');
        if (!w) return null;
        const m = new DOMMatrix(getComputedStyle(w).transform);
        return Math.round(m.a * (Number.parseFloat(w.style.zoom) || 1) * 1000) / 1000;
      })
      .catch(() => null);
    const label = `${opts.label || opts.studio} (studio)${opts.variant ? ` [${opts.variant}]` : ''}`;
    const engineTag = opts.engineTag || 'blink-studio';
    const prev = readHistory(opts.history, label, engineTag);
    const row = buildRow({
      result,
      label,
      engineTag,
      opts: { ...opts, url: opts.url },
      extra: { window: opts.window, dpr: opts.dpr, studio: true, worldScale },
    });
    if (opts.history) {
      mkdirSync(dirname(opts.history), { recursive: true });
      appendFileSync(opts.history, `${JSON.stringify(row)}\n`, 'utf8');
    }
    console.log(
      opts.json
        ? JSON.stringify({ current: row, previous: prev }, null, 2)
        : renderReport({ row, prev, opts, label, engineTag })
    );
  } finally {
    await browser.close().catch(() => {});
    if (code) process.exit(code);
  }
}

main().catch((err) => {
  console.error(`_perf-probe-studio.mjs: ${err.message}`);
  process.exit(1);
});
