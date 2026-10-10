#!/usr/bin/env node
// _perf-probe.mjs — internal shim behind `perf.sh` (`maude design perf`).
//
// Drives a scripted pan + zoom gesture against a live canvas and reports what
// the frame pipeline actually did: frame-time percentiles, long-task count, and
// the React render count during the gesture. That last number is the point.
// The plan this implements (.ai/plans/feature-canvas-render-performance.md)
// asserts a "zero React renders during gesture" invariant, and an invariant
// with no meter is a wish — so the meter ships in the same wave as the fix, and
// the BASELINE is captured before any fix lands.
//
// Numbers are only meaningful relative to another run on the same machine and
// engine (headless GPU behaviour varies wildly), so every run appends to a
// history file and the report prints the delta against the previous run of the
// same (canvas, engine) pair. There is deliberately no absolute pass/fail
// threshold and no CI gate — a red build on a noisy GPU teaches people to
// ignore the meter.
//
// Usage:
//   node _perf-probe.mjs --url <canvas-shell-url> [--label <name>]
//                        [--history <path>] [--engine-tag <tag>]
//                        [--timeout <secs>] [--pan <n>] [--zoom <n>] [--json]
//
// Stdout: human report (or raw JSON with --json).
// Exit:   0 measured / 1 dependency or capture failure / 2 bad args.

import { execFileSync } from 'node:child_process';
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

const AB = process.env.MAUDE_AGENT_BROWSER || 'agent-browser';

// agent-browser is a SHARED singleton by default: a concurrent session running
// its own smoke sweep will navigate the same tab out from under a measurement
// mid-gesture, and the probe then times somebody else's page. Observed exactly
// that during this feature's own baseline run. A named session pins us to our
// own browser instance, so the benchmark measures the canvas it was pointed at.
const AB_SESSION = process.env.MAUDE_PERF_SESSION || 'maude-perf';

function parseArgs(argv) {
  const out = {
    url: '',
    label: '',
    history: '',
    engineTag: '',
    timeout: 30,
    pan: 60,
    zoom: 40,
    json: false,
    // A/B lever: inject a CSS override before measuring, so a rendering
    // hypothesis can be tested against the SAME build instead of rebuilding
    // per variant (a rebuild changes more than the variable under test).
    // `--variant` is only a label — it keys the history row so A and B don't
    // overwrite each other's baseline.
    injectCss: '',
    variant: '',
    fitAll: false,
    setFlags: [],
    // Repetitions, median-reported, FIRST ONE DISCARDED. Measured necessity,
    // not caution: two identical control runs of this probe came out 60% apart
    // (p95 82.4ms vs 32.7ms) because the first paid for canvas compile, image
    // decode and initial layout. A benchmark whose noise exceeds the effect it
    // measures is worse than none — it produces confident wrong conclusions.
    repeat: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else if (a === '--history') out.history = argv[++i];
    else if (a === '--engine-tag') out.engineTag = argv[++i];
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--pan') out.pan = Number(argv[++i]);
    else if (a === '--zoom') out.zoom = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--inject-css') out.injectCss = argv[++i];
    else if (a === '--variant') out.variant = argv[++i];
    else if (a === '--repeat') out.repeat = Number(argv[++i]);
    else if (a === '--fit-all') out.fitAll = true;
    else if (a === '--set-flag') out.setFlags.push(argv[++i]);
    else {
      console.error(`_perf-probe.mjs: unknown arg '${a}'`);
      process.exit(2);
    }
  }
  if (!out.url) {
    console.error('_perf-probe.mjs: --url is required');
    process.exit(2);
  }
  return out;
}

function ab(args) {
  return execFileSync(AB, ['--session', AB_SESSION, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** agent-browser prints eval results JSON-encoded; unwrap one level. */
function abEval(expr) {
  const raw = ab(['eval', expr]).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  try {
    ab(['open', opts.url]);
  } catch (err) {
    console.error(`_perf-probe.mjs: agent-browser could not open ${opts.url}\n${err.message}`);
    process.exit(1);
  }

  // Wait for artboards to exist — measuring an empty shell would report a
  // gorgeous 0.1 ms p95 and mean nothing.
  let ready = false;
  for (let i = 0; i < opts.timeout; i++) {
    await sleep(1000);
    const n = abEval(
      "(() => { const d = document.querySelector('iframe') && document.querySelector('iframe').contentDocument; const r = (d||document).querySelectorAll('[data-dc-screen]'); return r.length; })()"
    );
    if (Number(n) > 0) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    console.error(
      `_perf-probe.mjs: no [data-dc-screen] after ${opts.timeout}s — wrong URL, or the canvas failed to mount`
    );
    process.exit(1);
  }

  /** One gesture pass: install the harness, drive it, wait for its result. */
  async function runOnce() {
    const started = abEval(
      harnessSource({
        pan: opts.pan,
        zoom: opts.zoom,
        injectCss: opts.injectCss,
        fitAll: opts.fitAll,
        setFlags: opts.setFlags,
      })
    );
    if (started === 'NO_HOST') {
      console.error('_perf-probe.mjs: no .dc-canvas host found on the page');
      process.exit(1);
    }
    for (let i = 0; i < opts.timeout; i++) {
      await sleep(1000);
      const r = abEval('JSON.stringify(window.__maudePerfResult)');
      if (r && r !== 'null') {
        const parsed = parseAndValidateResult(r);
        if (!parsed) {
          console.error(
            '_perf-probe.mjs: the page returned a malformed result — refusing to print or record it. ' +
              'window.__maudePerfResult is inside the untrusted canvas origin (DDR-054).'
          );
          process.exit(1);
        }
        return parsed;
      }
    }
    console.error(`_perf-probe.mjs: gesture never completed within ${opts.timeout}s`);
    process.exit(1);
  }

  // Run `repeat` passes and DISCARD the first. The first pass pays for canvas
  // compile, image decode and initial layout — costs that are real but are not
  // what "is panning smooth" asks about, and that swamped the signal by 60% in
  // this probe's own control runs.
  const passes = [];
  const total = Math.max(1, opts.repeat);
  for (let i = 0; i < total; i++) {
    const r = await runOnce();
    const hidden = occlusionRefusal(r, i + 1);
    if (hidden) {
      console.error(`_perf-probe.mjs: ${hidden}`);
      process.exit(3);
    }
    if (!r.panApplied || !r.zoomApplied) {
      console.error(
        `_perf-probe.mjs: gesture did not reach the canvas on pass ${i + 1} ` +
          `(pan: ${r.panApplied}, zoom: ${r.zoomApplied}) — refusing to record a meaningless row.`
      );
      process.exit(1);
    }
    const empty = emptyViewportRefusal(r, i + 1);
    if (empty) {
      console.error(`_perf-probe.mjs: ${empty}`);
      process.exit(1);
    }
    if (i > 0 || total === 1) passes.push(r);
    process.stderr.write(
      `→ pass ${i + 1}/${total}: ${r.boardsOnScreen} boards on screen, gesture p95 ${r.gesture.p95}ms zoom p95 ${r.zoom.p95}ms long ${r.longFrames}` +
        `${i === 0 && total > 1 ? ' (warm-up, discarded)' : ''}\n`
    );
  }

  const result = medianOf(passes);
  const label = (opts.label || opts.url) + (opts.variant ? ` [${opts.variant}]` : '');
  const engineTag = opts.engineTag || 'unknown';
  const prev = readHistory(opts.history, label, engineTag);
  const row = buildRow({ result, label, engineTag, opts });

  if (opts.history) {
    mkdirSync(dirname(opts.history), { recursive: true });
    appendFileSync(opts.history, `${JSON.stringify(row)}\n`, 'utf8');
  }

  if (opts.json) {
    console.log(JSON.stringify({ current: row, previous: prev }, null, 2));
    return;
  }
  console.log(renderReport({ row, prev, opts, label, engineTag }));
}

main().catch((err) => {
  console.error(`_perf-probe.mjs: ${err.message}`);
  process.exit(1);
});
