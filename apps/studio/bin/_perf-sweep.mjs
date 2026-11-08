// _perf-sweep.mjs — driver behind `maude design perf --sweep` (issues burndown T9.1).
//
//   node _perf-sweep.mjs --url <canvas page url> --engine chromium|safari [--window 2560x1340] [--passes 3]
//        [--runs 1] [--zoom 0.1] [--speed 1200] [--after-zoom-rows 3] [--query artboard-live=sleep] [--json]
//        [--out <file.json>]
//
// One run = a fresh page load, `--passes` passes of the four sweep phases (see _perf-sweep-shared.mjs); the
// medians and the min..max spread are taken over every pass of every run. The page is the bare canvas page
// (the capture URL perf.sh resolves), identical for both engines. Chromium runs in Playwright (headless,
// `--window` viewport, `--dpr`); Safari runs through safaridriver (a one-time `safaridriver --enable`), in a
// real window of `--window` size — which must be on screen and in front: WebKit freezes rendering behind a
// locked screen or another window, so the harness refuses (exit 3) a page that reports hidden or ~0 Hz rAF.
//
// Exit: 0 measured / 1 failure / 2 bad args / 3 the page was occluded.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  aggregateRuns,
  occlusionReason,
  parseSweepArgs,
  parseSweepResult,
  parseWindow,
  renderSweepReport,
  SWEEP_POLL_EXPRESSION,
  sweepStartExpression,
} from './_perf-sweep-shared.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SweepExit extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function pageUrl(opts) {
  const u = new URL(opts.url);
  if (opts.query) {
    for (const [k, v] of new URLSearchParams(opts.query)) u.searchParams.set(k, v);
  }
  return u.toString();
}

// ---------- Chromium (Playwright) ----------

async function chromiumRun(opts) {
  const win = parseWindow(opts.window);
  // --gpu: the full Chromium build in its new headless mode with Metal-backed ANGLE, so frames are not bound by
  // the software rasteriser the default headless shell uses (which turns a heavy board into ~4 fps)
  const { launchChromium } = await import('./_pw-launch.mjs');
  const browser = await launchChromium(
    opts.gpu
      ? {
          headless: true,
          channel: 'chromium',
          args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
        }
      : { headless: true }
  );
  try {
    const ctx = await browser.newContext({
      viewport: { width: win.w, height: win.h },
      deviceScaleFactor: opts.dpr,
    });
    const page = await ctx.newPage();
    await page.goto(pageUrl(opts), { waitUntil: 'domcontentloaded' });
    await waitForArtboards((expr) => page.evaluate(expr));
    await sleep(2500);
    await page.mouse.move(win.w / 2, win.h / 2);
    return await runHarness((expr) => page.evaluate(expr), opts);
  } finally {
    await browser.close();
  }
}

// ---------- Safari (safaridriver) ----------

async function wd(port, method, path, body) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (json?.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
}

async function looksLikeWebDriver(port) {
  try {
    const res = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    const json = await res.json();
    return !!json && typeof json === 'object' && typeof json.value?.ready === 'boolean';
  } catch {
    return false;
  }
}

async function ensureDriver(port) {
  if (await looksLikeWebDriver(port)) return null;
  const child = spawn('safaridriver', ['-p', String(port)], { stdio: 'ignore' });
  for (let i = 0; i < 15; i++) {
    await sleep(500);
    if (await looksLikeWebDriver(port)) return child;
  }
  child.kill();
  throw new SweepExit(
    `nothing that looks like a W3C driver answered on :${port} (run \`safaridriver --enable\` once)`,
    1
  );
}

async function safariRun(opts) {
  const win = parseWindow(opts.window);
  const driverChild = await ensureDriver(opts.driverPort);
  let sessionId = null;
  try {
    const created = await wd(opts.driverPort, 'POST', '/session', {
      capabilities: { alwaysMatch: { browserName: 'safari' } },
    });
    sessionId = created.sessionId;
    const base = `/session/${sessionId}`;
    const exec = (script) =>
      wd(opts.driverPort, 'POST', `${base}/execute/sync`, {
        script: `return ${script};`,
        args: [],
      });
    await wd(opts.driverPort, 'POST', `${base}/timeouts`, { script: 10000 });
    await wd(opts.driverPort, 'POST', `${base}/window/rect`, {
      x: 0,
      y: 0,
      width: win.w,
      height: win.h,
    });
    await wd(opts.driverPort, 'POST', `${base}/url`, { url: pageUrl(opts) });
    await waitForArtboards(exec);
    await sleep(2500);
    return await runHarness(exec, opts);
  } finally {
    if (sessionId) await wd(opts.driverPort, 'DELETE', `/session/${sessionId}`).catch(() => {});
    if (driverChild) driverChild.kill();
  }
}

// ---------- shared ----------

async function waitForArtboards(evalExpr) {
  for (let i = 0; i < 1200; i++) {
    const n = await evalExpr("document.querySelectorAll('[data-dc-screen]').length").catch(() => 0);
    if (Number(n) > 0) return;
    await sleep(100);
  }
  throw new SweepExit('no artboard ever appeared on the canvas page', 1);
}

async function runHarness(evalExpr, opts) {
  const started = await evalExpr(sweepStartExpression(opts));
  if (started !== 'STARTED')
    throw new SweepExit(`the harness did not start (${String(started).slice(0, 20)})`, 1);
  const deadline = Date.now() + opts.timeout * 1000;
  let lastProgress = '';
  while (Date.now() < deadline) {
    await sleep(2000);
    const raw = await evalExpr(SWEEP_POLL_EXPRESSION).catch(() => null);
    if (!raw || raw === 'null') continue;
    let s;
    try {
      s = JSON.parse(raw);
    } catch {
      continue;
    }
    const progress = String(s.progress)
      .replace(/[^\w /=.:-]/g, '')
      .slice(0, 80);
    if (progress !== lastProgress) {
      lastProgress = progress;
      process.stderr.write(`  ${progress}\n`);
    }
    if (s.state === 'error') throw new SweepExit(`the harness failed: ${progress}`, 1);
    if (s.state === 'done') {
      const result = parseSweepResult(s.result);
      if (!result)
        throw new SweepExit('the harness answered with a result of the wrong shape (refused)', 1);
      return result;
    }
  }
  throw new SweepExit(`the sweep did not finish within ${opts.timeout} s`, 1);
}

async function main() {
  let opts;
  try {
    opts = parseSweepArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`_perf-sweep.mjs: ${err.message}`);
    process.exit(2);
  }
  const results = [];
  for (let run = 1; run <= opts.runs; run++) {
    process.stderr.write(
      `→ sweep run ${run}/${opts.runs} (${opts.engine}, ${opts.window}, ${opts.passes} passes)\n`
    );
    const result = opts.engine === 'safari' ? await safariRun(opts) : await chromiumRun(opts);
    const why = occlusionReason(result);
    if (why)
      throw new SweepExit(
        `_perf-sweep.mjs: the run was occluded — ${why}. Unlock the Mac, keep the window on screen and in front, and re-run.`,
        3
      );
    results.push(result);
  }
  const aggregate = aggregateRuns(results);
  const label = opts.label || opts.url.replace(/[?#].*$/, '');
  const out = {
    engine: opts.engine,
    label,
    opts: { ...opts, url: undefined },
    env: results[0].env,
    aggregate,
    results,
  };
  if (opts.out) writeFileSync(opts.out, `${JSON.stringify(out)}\n`, 'utf8');
  if (opts.json) console.log(JSON.stringify(out, null, 2));
  else console.log(renderSweepReport({ label, engine: opts.engine, opts, results, aggregate }));
}

main().catch((err) => {
  if (err instanceof SweepExit) {
    console.error(
      err.message.startsWith('_perf-sweep') ? err.message : `_perf-sweep.mjs: ${err.message}`
    );
    process.exit(err.code);
  }
  console.error(`_perf-sweep.mjs: ${err.message}`);
  process.exit(1);
});
