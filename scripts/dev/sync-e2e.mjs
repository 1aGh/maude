#!/usr/bin/env node
// SYNC E2E — the whole loop, both ways, against two live machines.
//
// `journal-e2e.mjs` proves the transport is correct: the journal appends, the
// poke fires, the tail survives a restore. This proves the PRODUCT is correct —
// a person makes a change on one machine and sees it on the other. Those are
// different claims, and the gap between them is where every sync bug this repo
// has shipped actually lived.
//
// What it stands up:
//
//   • the cell (hub in workspace mode + its studio child) — the CLOUD side,
//     reached the way a person reaches it: through the hub's port, signed in;
//   • a peer studio server over the desktop-side project — the DESKTOP side,
//     the same process the desktop app spawns as its sidecar;
//   • two isolated agent-browser sessions, one per side, so a screenshot is
//     unambiguous about which machine it came from.
//
// Then it runs every scenario in `scenarios.mjs` TWICE — cloud→desktop, then
// desktop→cloud — and reports each with the time it took to cross.
//
//   node scripts/dev/sync-e2e.mjs                      # stand everything up
//   node scripts/dev/sync-e2e.mjs --keep               # leave it running
//   node scripts/dev/sync-e2e.mjs --only asset-upload  # one scenario
//   node scripts/dev/sync-e2e.mjs --dir ~/.maude-local-cell   # reuse a cell
//   node scripts/dev/sync-e2e.mjs --no-browser         # disk assertions only
//
// ── The one thing to know before reading a green run ────────────────────────
//
// A row marked `expected-pending` is a check that SHOULD fail today: deletion
// propagation is Increment 6 and is deliberately not wired. Those rows are
// printed, counted separately, and do not fail the suite — so the day the
// increment lands, they turn green on their own and nobody has to remember to
// come back and enable them.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Browser, Side, sleep, waitFor } from './sync-e2e/harness.mjs';
import { SCENARIOS } from './sync-e2e/scenarios.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const arg = (n, fb = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb;
};

if (has('help')) {
  process.stdout.write(`sync-e2e — cloud ↔ desktop, every scenario, both directions

  --dir PATH        reuse an existing local cell (default: a fresh temp cell)
  --port N          hub port (default 4699, or the cell's own when reusing)
  --peer-port N     the desktop peer studio's port (default 4799)
  --only ID[,ID]    run just these scenarios
  --direction D     'cloud-to-desktop' | 'desktop-to-cloud' (default: both)
  --no-browser      skip the visual half; assert on disk only
  --keep            leave the cell and the peer running when done
  --shots PATH      where screenshots go (default: <run>/shots)
`);
  process.exit(0);
}

const reuseDir = arg('dir');
const runRoot = reuseDir ? resolve(reuseDir) : join(tmpdir(), `maude-sync-e2e-${Date.now()}`);
const port = Number(arg('port', reuseDir ? 4599 : 4699));
const peerPort = Number(arg('peer-port', 4799));
const shotDir = arg('shots', join(runRoot, 'shots'));
const useBrowser = !has('no-browser');
const keep = has('keep') || !!reuseDir;
const only = (arg('only') ?? '').split(',').filter(Boolean);
const directions = arg('direction') ? [arg('direction')] : ['cloud-to-desktop', 'desktop-to-cloud'];

const ADMIN_EMAIL = 'you@local.test';
const ADMIN_PASSWORD = 'local-cell-password';

const children = [];
const logs = new Map();
const line = (s = '') => process.stdout.write(`${s}\n`);

/* --------------------------------------------------------------- bring-up --- */

/**
 * Spawn a server, DETACHED, with its output on disk.
 *
 * Detached is not tidiness — it is correctness. A child inheriting this
 * process's pipes dies with it: when the runner exits after a `--keep` run, the
 * cell's `stdout` closes, the hub (which local-cell spawns with `stdio:
 * 'inherit'`) writes into a broken pipe and goes down, and what is left is a
 * studio child serving a project whose hub no longer exists. That looked
 * exactly like a sync bug for twenty minutes: files stopped crossing, nothing
 * in any log said why, and the hub had simply died of the runner's own exit.
 *
 * Same failure family as the desktop shell's SIGPIPE panic. The fix is the
 * same: never write to a pipe whose reader may already be gone.
 */
function spawnLogged(name, cmd, args, opts) {
  mkdirSync(runRoot, { recursive: true });
  const logPath = join(runRoot, `${name}.log`);
  const fd = openSync(logPath, 'a');
  const p = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', fd, fd] });
  p.unref();
  children.push(p);
  logs.set(name, logPath);
  if (process.env.SYNC_E2E_VERBOSE === '1') line(`  [${name}] logging to ${logPath}`);
  return p;
}

async function reachable(url, timeoutMs = 90_000) {
  const r = await waitFor(
    async () => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        return res.status < 500;
      } catch {
        return false;
      }
    },
    { timeoutMs }
  );
  return r.ok;
}

/** Bring up the cell, unless we were pointed at one that is already running. */
async function startCell() {
  const base = `http://127.0.0.1:${port}`;
  if (await reachable(`${base}/health`, 1_500)) {
    // Same trap as the peer's, one process up: adopting whatever answers is how
    // a suite ends up asserting about somebody else's project. A cell we were
    // POINTED at (`--dir`) is fair game; one we merely collided with is not.
    if (!reuseDir) {
      throw new Error(
        `port ${port} is already serving something. Point at it deliberately with ` +
          `--dir <its run dir>, or pick another with --port.`
      );
    }
    line(`  cell      reusing the one already on :${port}`);
    return base;
  }
  line(`  cell      starting on :${port}…`);
  spawnLogged(
    'cell',
    'node',
    [
      join(REPO_ROOT, 'scripts/dev/local-cell.mjs'),
      '--dir',
      runRoot,
      '--port',
      String(port),
      // NOT optional. On macOS `fs.watch` DOES fire for the atomic tmp+rename
      // writes a container's inotify misses, so a run without this would prove
      // that the laptop's watcher works rather than that the sync does. See
      // local-cell's own header.
      '--no-watch',
      '--keep',
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        // A short belt so the OUT-OF-BAND scenarios (a design-system file
        // written straight to disk, the way an agent writes one) do not wait a
        // full minute to be noticed. The hooked paths never touch this, and
        // keeping it visible here is what stops a green suite from hiding a
        // regression that made everything fall back to the reconciler.
        MAUDE_JOURNAL_WALK_MS: '3000',
      },
    }
  );
  if (!(await reachable(`${base}/health`))) throw new Error(`the cell never came up on :${port}`);
  return base;
}

/**
 * The peer — a plain studio over the desktop-side project.
 *
 * "Something answers on the port" is NOT the same as "our peer is running", and
 * conflating the two cost an afternoon: a `--keep` run left a studio on 4799,
 * the next run adopted it, and every scenario timed out against a peer serving
 * a project that had already been deleted. `/_health` says as much in its own
 * comments — a supervisor that only asks whether something answered cannot tell
 * the right tree from whatever was left lying around.
 *
 * So identity is checked the way the runtime contract intends: `_server.json`
 * in OUR peer project names the port its own server took. If the port is held
 * by something that did not write that file, this stops and says so rather than
 * running a suite whose every result would be meaningless.
 */
async function startPeer(peerRepo, hubsConfig) {
  const base = `http://127.0.0.1:${peerPort}`;
  const stateFile = join(peerRepo, '.design', '_server.json');
  if (await reachable(`${base}/_health`, 1_500)) {
    let claimed = null;
    try {
      claimed = JSON.parse(readFileSync(stateFile, 'utf8'));
    } catch {
      /* no state file — then it is certainly not ours */
    }
    if (claimed?.port === peerPort) {
      line(`  peer      reusing ours, already on :${peerPort}`);
      return base;
    }
    throw new Error(
      `port ${peerPort} is taken by a studio that is not this run's peer ` +
        `(no matching ${stateFile}). Stop it — \`lsof -ti :${peerPort} | xargs kill\` — ` +
        `or pick another with --peer-port.`
    );
  }
  line(`  peer      starting on :${peerPort}…`);
  spawnLogged(
    'peer',
    'bun',
    [join(REPO_ROOT, 'apps/studio/server.ts'), '--root', peerRepo, '--port', String(peerPort)],
    {
      cwd: join(REPO_ROOT, 'apps/studio'),
      env: {
        ...process.env,
        // NEVER the user's real credential store. The cell wrote a scratch one.
        HUBS_CONFIG_PATH: hubsConfig,
        MAUDE_PROJECT_ROOT: peerRepo,
        MAUDE_NO_AUTOBUILD: '1',
      },
    }
  );
  if (!(await reachable(`${base}/_health`))) throw new Error(`the peer never came up`);
  return base;
}

/** Sign in to the cell and keep the cookie. Every cloud act rides it. */
async function cloudCookie(base) {
  const res = await fetch(`${base}/studio/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    redirect: 'manual',
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('the cell would not sign us in — no session cookie came back');
  return cookie;
}

/* ------------------------------------------------------------------ report --- */

const results = [];

function record(row) {
  results.push(row);
  const mark = row.status === 'pass' ? '✔' : row.status === 'pending' ? '◦' : '✖';
  const timing = row.ms === null ? '' : ` ${(row.ms / 1000).toFixed(1)}s`;
  line(`    ${mark} ${row.check}${timing}`);
  if (row.status === 'fail' && row.detail) {
    line(`        ${JSON.stringify(row.detail).slice(0, 240)}`);
  }
}

/* --------------------------------------------------------------- the run --- */

async function runScenario(scenario, dir, ctx) {
  const from = dir === 'cloud-to-desktop' ? ctx.cloud : ctx.desktop;
  const to = dir === 'cloud-to-desktop' ? ctx.desktop : ctx.cloud;
  const browser = to.browserHandle ?? null;

  if (scenario.needsBrowser && !useBrowser) {
    line(`\n  ${scenario.id}  ·  ${dir}  ·  skipped (needs the browser half)`);
    return;
  }

  line(`\n  ${scenario.id}  ·  ${dir}  ·  ${scenario.title}`);

  // `cloud` / `desktop` are named as well as `from` / `to`, because a few
  // claims are genuinely about ONE side whichever way the change travelled —
  // the git history lives in the cell's checkout and nowhere else.
  const env = { from, to, cloud: ctx.cloud, desktop: ctx.desktop, run: ctx.run, dir, browser };
  let made;
  try {
    made = await scenario.act(env);
  } catch (err) {
    record({
      scenario: scenario.id,
      dir,
      check: `act on ${from.label}`,
      status: 'fail',
      ms: null,
      detail: err.message,
    });
    return;
  }

  const settled = await scenario.settle(env, made);
  record({
    scenario: scenario.id,
    dir,
    check: `crossed to ${to.label}`,
    status: settled.ok ? 'pass' : 'fail',
    ms: settled.ms,
    detail: settled.ok ? null : `timed out waiting for ${settled.label ?? 'convergence'}`,
  });

  // Point the receiving browser at the project so the DOM checks and the
  // screenshot describe the state that just arrived, not whatever was open.
  if (browser) {
    await browser.open(to.uiUrl);
    await sleep(1_200);
  }

  let checks = [];
  try {
    checks = await scenario.verify(env, made);
  } catch (err) {
    record({
      scenario: scenario.id,
      dir,
      check: 'verify',
      status: 'fail',
      ms: null,
      detail: err.message,
    });
  }
  for (const [check, ok, detail] of checks) {
    const pending = detail === 'expected-pending';
    record({
      scenario: scenario.id,
      dir,
      check,
      status: ok ? 'pass' : pending ? 'pending' : 'fail',
      ms: null,
      detail: pending ? null : detail,
    });
  }

  if (browser) {
    const shot = await browser.shot(`${scenario.id}--${dir}`);
    if (shot) line(`      shot ${shot}`);
  }
}

async function main() {
  const run = Math.floor(Date.now() / 1000) % 100000;
  line();
  line('  ── sync e2e ─────────────────────────────────────────────────────');
  line();

  const cloudBase = await startCell();
  // `runRoot` either IS the cell we were pointed at, or is the directory we
  // just told local-cell to use. Either way it is where the peer project lives.
  const cellRoot = runRoot;
  const peerRepo = join(cellRoot, 'desktop-project');
  const hubsConfig = join(cellRoot, 'hubs.json');
  if (!existsSync(peerRepo)) {
    throw new Error(`no desktop-side project at ${peerRepo} — did the cell seed one?`);
  }
  const peerBase = await startPeer(peerRepo, hubsConfig);
  const cookie = await cloudCookie(cloudBase);

  const cloud = new Side({
    name: 'cloud',
    base: cloudBase,
    designRoot: join(cellRoot, 'repo', '.design'),
    headers: { cookie },
  });
  const desktop = new Side({
    name: 'desktop',
    base: peerBase,
    designRoot: join(peerRepo, '.design'),
  });
  cloud.uiUrl = cloudBase;
  desktop.uiUrl = peerBase;

  if (useBrowser) {
    cloud.browserHandle = new Browser({ session: 'maude-e2e-cloud', shotDir });
    desktop.browserHandle = new Browser({ session: 'maude-e2e-desktop', shotDir });
    // The cloud browser has to sign in the way a person does, or every page is
    // the sign-in form and every DOM check is trivially false.
    //
    // Exposed as `reSignIn` because a session can lapse mid-run: a scenario
    // that then opens the studio lands on the form, finds no canvas rows, and
    // reports a sync failure for an auth reason. One retry beats a red row
    // that means nothing.
    cloud.reSignIn = async () => {
      const b = cloud.browserHandle;
      await b.open(`${cloudBase}/studio/signin`);
      await b.run(['fill', 'input[type=email], input[name=email]', ADMIN_EMAIL]);
      await b.run(['fill', 'input[type=password], input[name=password]', ADMIN_PASSWORD]);
      await b.run(['click', 'button[type=submit], input[type=submit]']);
      await sleep(2_500);
    };
    await cloud.reSignIn();
    await desktop.browserHandle.open(peerBase);
    await sleep(1_500);
  }

  line();
  line(`  cloud     ${cloudBase}   ${cloud.designRoot}`);
  line(`  desktop   ${peerBase}   ${desktop.designRoot}`);
  line(`  browser   ${useBrowser ? `on — shots in ${shotDir}` : 'off (disk assertions only)'}`);
  line(`  run tag   e2e-${run}`);

  const ctx = { cloud, desktop, run };
  const chosen = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  if (!chosen.length) throw new Error(`no scenario matched --only ${only.join(',')}`);

  for (const dir of directions) {
    line();
    line(`  ══ ${dir} ${'═'.repeat(Math.max(0, 56 - dir.length))}`);
    for (const scenario of chosen) {
      await runScenario(scenario, dir, ctx);
    }
  }

  if (!only.length || only.includes('cold-start')) await coldStart(ctx, cellRoot);

  summarize();

  if (useBrowser) {
    await cloud.browserHandle.close();
    await desktop.browserHandle.close();
  }
}

/**
 * THE THIRD MACHINE — an empty folder that has to become the whole project.
 *
 * Every scenario above starts from two projects that already know about each
 * other, which is the steady state and not the anxious one. The anxious one is
 * a person opening Maude on a laptop they have never used it on: an empty
 * directory, a hub URL, and an expectation that everything shows up. That path
 * touches cold-start (DDR-102), the full manifest read, the pull budget, and
 * every asset — and it is the one where "it mostly worked" means a project
 * missing half its pictures.
 *
 * It runs LAST, once, and it asserts against the cloud as it stands at the end
 * of the suite: by then the project has canvases, folders, a design system,
 * annotations and a pile of assets, which makes it a far better fixture than
 * anything this file could have written by hand.
 */
async function coldStart(ctx, cellRoot) {
  line();
  line(`  ══ cold-start ${'═'.repeat(46)}`);
  line('\n  cold-start  ·  an empty folder pulls the whole project');

  const freshRoot = join(cellRoot, 'fresh-machine');
  const freshDesign = join(freshRoot, '.design');
  const freshPort = peerPort + 1;
  try {
    rmSync(freshRoot, { recursive: true, force: true });
  } catch {
    /* first run */
  }
  mkdirSync(join(freshDesign, 'ui'), { recursive: true });
  // The ONLY thing this machine is given: its name, its groups, and where the
  // hub is. No canvases, no assets, no design system — that is the point.
  writeFileSync(
    join(freshDesign, 'config.json'),
    `${JSON.stringify(
      {
        name: 'fresh-machine',
        canvasGroups: [
          { label: 'Canvases', path: 'ui' },
          { label: 'Design system', path: 'system' },
        ],
        linkedHub: { url: `http://127.0.0.1:${port}`, linkedAt: Date.now(), syncFiles: true },
      },
      null,
      2
    )}\n`
  );

  spawnLogged(
    'fresh',
    'bun',
    [join(REPO_ROOT, 'apps/studio/server.ts'), '--root', freshRoot, '--port', String(freshPort)],
    {
      cwd: join(REPO_ROOT, 'apps/studio'),
      env: {
        ...process.env,
        HUBS_CONFIG_PATH: join(cellRoot, 'hubs.json'),
        MAUDE_PROJECT_ROOT: freshRoot,
        MAUDE_NO_AUTOBUILD: '1',
      },
    }
  );
  if (!(await reachable(`http://127.0.0.1:${freshPort}/_health`))) {
    record({
      scenario: 'cold-start',
      dir: 'hub-to-fresh',
      check: 'the fresh machine started',
      status: 'fail',
      ms: null,
      detail: `nothing came up on :${freshPort}`,
    });
    return;
  }

  const fresh = new Side({
    name: 'fresh',
    base: `http://127.0.0.1:${freshPort}`,
    designRoot: freshDesign,
  });
  fresh.uiUrl = fresh.base;

  // TWO KNOWN SHAPES, so a red row here means something new rather than
  // something already written down.
  //
  // A — ON THE CLOUD, ABSENT FROM THE DESKTOP. With deletion emission off
  //     (Increment 6), a canvas deleted or renamed away ON A PEER leaves its
  //     file behind on the cloud's checkout while its DOCUMENT is gone. A fresh
  //     machine pulls from the document list, so not receiving a file that no
  //     document describes is CORRECT — the cloud is the stale one, not the
  //     newcomer.
  //
  // B — ON BOTH LIVE MACHINES, IN A SUBFOLDER, ABSENT FROM THE FRESH ONE. A
  //     canvas moved into a folder on a peer gets a new folder-prefixed slug
  //     and a new document while the pre-move one lingers, and the newcomer
  //     drops it at admission. That is the recorded finding
  //     `maude/peer-moved-canvas-missing-on-a-fresh-machine`, entangled with
  //     Increment 6 by construction: until deletions propagate, two documents
  //     describe one file and cold start has to choose.
  //
  // Anything else — a top-level canvas, an asset, a design-system file — is a
  // real gap and still fails loudly.
  const goneFromTheDesktopToo = (rel) => !ctx.desktop.has(rel);
  const peerMovedIntoAFolder = (rel) => ctx.desktop.has(rel) && rel.split('/').length > 2;
  const knownShape = (rel) => goneFromTheDesktopToo(rel) || peerMovedIntoAFolder(rel);

  const want = ctx.cloud
    .tracked()
    .filter((r) => r !== 'config.json' && !r.split('/').some((s) => s.startsWith('.')));

  const arrived = await waitFor(() => want.every((r) => fresh.has(r)), {
    timeoutMs: 120_000,
    label: 'the whole project',
  });
  const short = want.filter((r) => !fresh.has(r));
  const knownGapOnly = short.length > 0 && short.every(knownShape);
  record({
    scenario: 'cold-start',
    dir: 'hub-to-fresh',
    check: knownGapOnly
      ? `the whole project landed (${want.length} files) — bar the two known shapes (Increment 6 residue / peer-moved canvases)`
      : `the whole project landed (${want.length} files)`,
    status: arrived.ok ? 'pass' : knownGapOnly ? 'pending' : 'fail',
    ms: arrived.ms,
    detail: knownGapOnly ? null : short.slice(0, 12),
  });

  const canvases = want.filter((r) => r.endsWith('.tsx'));
  const assets = want.filter((r) => r.startsWith('assets/'));
  const annotations = want.filter((r) => r.endsWith('.annotations.json'));
  const ds = want.filter((r) => r.startsWith('system/'));
  // Broken out by KIND, because "39 of 41 files" is not an answer a person can
  // act on and "every canvas but no pictures" is.
  for (const [label, set] of [
    ['every canvas', canvases],
    ['every asset', assets],
    ['every annotation layer', annotations],
    ['the whole design system', ds],
  ]) {
    const missing = set.filter((r) => !fresh.has(r));
    const onlyKnownGap = missing.length > 0 && missing.every(knownShape);
    record({
      scenario: 'cold-start',
      dir: 'hub-to-fresh',
      check: onlyKnownGap
        ? `${label} (${set.length}) — short only by the two known shapes (Increment 6 residue / peer-moved canvases)`
        : `${label} (${set.length})`,
      status: missing.length === 0 ? 'pass' : onlyKnownGap ? 'pending' : 'fail',
      ms: null,
      detail: onlyKnownGap ? null : missing,
    });
  }

  const corrupt = want.filter(
    (r) =>
      fresh.has(r) &&
      !r.endsWith('.meta.json') &&
      ctx.cloud.has(r) &&
      !ctx.cloud.bytes(r).equals(fresh.bytes(r))
  );
  record({
    scenario: 'cold-start',
    dir: 'hub-to-fresh',
    check: 'nothing arrived corrupted',
    status: corrupt.length === 0 ? 'pass' : 'fail',
    ms: null,
    detail: corrupt,
  });

  if (useBrowser) {
    const b = new Browser({ session: 'maude-e2e-fresh', shotDir });
    await b.open(fresh.base);
    await sleep(3_000);
    const rows = await b.eval('document.querySelectorAll(\'[data-testid^="canvas-row-"]\').length');
    // Against what LANDED, not against what the cloud has. A file the fresh
    // machine never received cannot render, and folding that into this row
    // would report one gap twice while hiding the real question: does the UI
    // show everything that actually arrived?
    const landed = canvases.filter((r) => fresh.has(r)).length;
    record({
      scenario: 'cold-start',
      dir: 'hub-to-fresh',
      check: `the file tree RENDERS what landed (${rows} rows for ${landed} canvases on disk)`,
      status: Number(rows) >= landed ? 'pass' : 'fail',
      ms: null,
      detail: { rows, landed, onCloud: canvases.length },
    });
    const shot = await b.shot('cold-start--fresh-machine');
    if (shot) line(`      shot ${shot}`);
    await b.close();
  }
}

function summarize() {
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail');
  const pending = results.filter((r) => r.status === 'pending').length;

  line();
  line('  ── summary ──────────────────────────────────────────────────────');
  line();
  line(`  ${pass} passed · ${fail.length} failed · ${pending} expected-pending`);

  // The crossing times, because a suite that only says pass/fail cannot tell
  // you the day everything still works and takes thirty seconds.
  const crossings = results.filter((r) => r.check.startsWith('crossed to') && r.ms !== null);
  if (crossings.length) {
    const ms = crossings.map((c) => c.ms).sort((a, b) => a - b);
    const p = (q) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];
    line(
      `  crossing  median ${(p(0.5) / 1000).toFixed(1)}s · slowest ${(ms.at(-1) / 1000).toFixed(1)}s`
    );
    const slow = crossings.filter((c) => c.ms > 10_000);
    for (const s of slow) {
      line(`            SLOW  ${s.scenario} ${s.dir} ${(s.ms / 1000).toFixed(1)}s`);
    }
  }

  if (fail.length) {
    line();
    for (const f of fail) line(`  ✖ ${f.scenario}  ${f.dir}  ${f.check}`);
  }
  line();

  process.exitCode = fail.length ? 1 : 0;
}

function teardown() {
  // `--keep` means keep the MACHINES too, not just the directory. A run that
  // tore down the cell and the peer while claiming to have kept them left you
  // with a scratch tree and nothing to point a browser at.
  if (!keep) {
    for (const c of children) {
      try {
        c.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  if (!keep && !reuseDir && existsSync(runRoot)) {
    try {
      rmSync(runRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

process.on('SIGINT', () => {
  teardown();
  process.exit(130);
});

main()
  .catch((err) => {
    line();
    line(`  ✖ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(500);
    teardown();
    if (keep) {
      line(`  kept ${runRoot}`);
      for (const [name, path] of logs) line(`       ${name} log  ${path}`);
      line(`       stop it with:  pkill -f ${runRoot}`);
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 1_000);
  });
