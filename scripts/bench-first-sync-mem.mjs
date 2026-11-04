#!/usr/bin/env node
// First-sync memory bench — issue #175 item 3.
//
// A large project linked to a hub for the first time grew the studio server to ~1.8 GB RSS
// (309 canvases, ~7 500 files in the file plane, a self-hosted hub). This bench rebuilds that
// shape LOCALLY and measures it: a generated project (canvases + their meta + small assets), a
// LOCAL hub from source under Node 24 in workspace mode (a checkout of its own, so it keeps the
// file journal a self-hosted hub keeps — apps/desktop/e2e/fixtures/local-hub.mjs), and the real
// studio server (`bun apps/studio/server.ts`) linked to it, pushing everything up. It samples the
// server's RSS until both lanes report their first sync done (`_sync.json` `coldOpen`).
//
// Never a real hub, never a real project: everything lives under --out (a scratch path).
//
//   node scripts/bench-first-sync-mem.mjs --out /tmp/x/first-sync [--canvases 300] [--files 7200]
//        [--budget-rss-mb 2000] [--timeout 1800] [--json] [--preload probe.ts] [--bun-arg --cpu-prof-md]
//        [--pull] [--media 3000] [--media-min-kb 50] [--media-max-kb 5000] [--settle 60] [--reuse]
//        [--client] [--reboot 300] [--studio <apps/studio dir>] [--hub-rate N]
//
// --pull (issue #204): the PULL direction — a second Mac linking an existing project. The fixture is
// written into the hub's checkout (the hub's boot scan journals it) and the studio starts from an
// empty design root, so everything arrives DOWN: canvases through the doc plane, files through the
// file plane. --media N adds N media files sized log-uniformly between --media-min-kb and
// --media-max-kb (the shape of the reported 5 041-file project, which carried photos and clips).
// --settle S keeps sampling S seconds past "done", for the steady state after a sync. --reuse
// measures another pull against the hub a previous --pull run of the same --out seeded. --client
// opens the studio page in a headless Chromium for the measured run (the desktop has its window up).
// --reboot S then restarts the studio on the synced project and samples it S seconds: that boot
// renders a cover for every canvas the sync brought, building each canvas module once.
// --studio <dir> boots the MEASURED server from another apps/studio tree (e.g. a `git archive` of
// the release before a fix, with node_modules linked in); --hub-rate N opens the hub's write door
// to N/min so a push-direction run of a big shape finishes in reasonable time.
// scripts/lib/mem-probe.ts (--preload, MAUDE_PROBE_OUT=<file>) logs heapStats every few seconds, and
// on macOS every 10th sample also records the phys footprint (`ps` RSS omits compressed pages).
//
// --budget-rss-mb N: exit 1 when the peak RSS during the first sync passes N MB. It is a bench, not
// a CI gate — RSS swings with the machine and the hub's 600 writes/min door makes a full run ~16 min —
// so 2000 sits well above the fixed peak and well below the unfixed one. Measured on an M-series Mac,
// 300 canvases + 7 200 files (2026-11-02, ps RSS sampled every 0.5 s):
//   before (projections decoded every file event):  peak 4 193 MB, p50 1 515, p90 2 979 —
//                                                   files not converged in 900 s (5 364/7 200)
//   after  (a projection drops a path not its own): peak 1 170 MB, p50 424, p90 634, settled 357 —
//                                                   first sync done in 942 s
// apps/studio/test/sync-first-sync-memory.test.ts pins the cause deterministically.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startLocalHub } from '../apps/desktop/e2e/fixtures/local-hub.mjs';
import { stubClaudeEnv } from './lib/stub-claude.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {
    canvases: 300,
    files: 7200,
    out: null,
    budget: 0,
    timeout: 900,
    json: false,
    bunArgs: [],
    pull: false,
    media: 0,
    mediaMinKb: 50,
    mediaMaxKb: 5000,
    settle: 15,
    reuse: false,
    client: false,
    reboot: 0,
    studio: null,
    hubRate: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--canvases') out.canvases = Number(argv[++i]);
    else if (a === '--files') out.files = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--budget-rss-mb') out.budget = Number(argv[++i]);
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--preload') out.preload = argv[++i];
    else if (a === '--bun-arg') out.bunArgs.push(argv[++i]);
    else if (a === '--pull') out.pull = true;
    else if (a === '--media') out.media = Number(argv[++i]);
    else if (a === '--media-min-kb') out.mediaMinKb = Number(argv[++i]);
    else if (a === '--media-max-kb') out.mediaMaxKb = Number(argv[++i]);
    else if (a === '--settle') out.settle = Number(argv[++i]);
    else if (a === '--reuse') out.reuse = true;
    else if (a === '--client') out.client = true;
    else if (a === '--reboot') out.reboot = Number(argv[++i]);
    else if (a === '--studio') out.studio = argv[++i];
    else if (a === '--hub-rate') out.hubRate = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.out || !/(^\/tmp\/|^\/private\/tmp\/|fixture|scratch)/.test(args.out)) {
  process.stderr.write('usage: bench-first-sync-mem.mjs --out <scratch dir under /tmp> …\n');
  process.exit(2);
}
const OUT = resolve(args.out);
// --reuse (with --pull): keep the hub a previous run of this --out seeded and measure another pull
// against it — seeding is the slow half (the hub's write door) and is not what is measured.
const reuse = args.pull && args.reuse && existsSync(join(OUT, 'hub-port.json'));
if (reuse) {
  rmSync(join(OUT, 'project'), { recursive: true, force: true });
  rmSync(join(OUT, 'home'), { recursive: true, force: true });
} else {
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

// ── the fixture ───────────────────────────────────────────────────────────────
// Deterministic pseudo-random, so two runs measure the same project.
let seed = 0x9e3779b9;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};

/** A canvas the size and shape of a real one: several artboards, nested markup, ~6–20 KB. */
function canvasSource(i) {
  const boards = 3 + Math.floor(rnd() * 5);
  const parts = [];
  for (let b = 0; b < boards; b++) {
    const rows = 6 + Math.floor(rnd() * 14);
    const items = [];
    for (let r = 0; r < rows; r++) {
      items.push(
        `          <div className="row row-${r}" style={{ padding: ${4 + (r % 5) * 4}, gap: 8, display: 'flex' }}>\n` +
          `            <span className="label">Item ${i}.${b}.${r} — ${Math.floor(rnd() * 1e9).toString(36)}</span>\n` +
          `            <img src="../assets/a${(i * 13 + r) % 500}.png" alt="Picture ${r}" width={48} height={48} />\n` +
          '          </div>'
      );
    }
    parts.push(
      `      <DCArtboard id="board-${b}" label="Board ${b}" width={1280} height={${800 + b * 40}}>\n` +
        `        <section className="screen screen-${b}">\n          <h1>Screen ${i} / ${b}</h1>\n${items.join('\n')}\n        </section>\n` +
        '      </DCArtboard>'
    );
  }
  return (
    `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';\n\n` +
    `export default function Canvas${i}() {\n  return (\n    <DesignCanvas>\n      <DCSection id="main" title="Canvas ${i}">\n` +
    `${parts.join('\n')}\n      </DCSection>\n    </DesignCanvas>\n  );\n}\n`
  );
}

function bytes(n) {
  const b = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i += 4) b.writeUInt32LE((rnd() * 0x100000000) >>> 0, Math.min(i, n - 4));
  return b;
}

const config = (extra = {}) => ({
  name: 'First sync bench',
  designRoot: '.design',
  formatVersion: 2,
  canvasGroups: [{ label: 'UI', path: 'ui' }],
  ...extra,
});

// --pull: the content is written into a SEED project, which a first studio pushes up; the measured
// studio then links an empty project and pulls it all down.
const project = join(OUT, 'project');
const design = join(project, '.design');
const seedProject = join(OUT, 'seed');
const source = args.pull ? join(seedProject, '.design') : design;
mkdirSync(design, { recursive: true });
let canvasBytes = 0;
let fileBytes = 0;
let mediaBytes = 0;
const assetDirs = 30;
if (!reuse) {
  const groups = Math.max(1, Math.ceil(args.canvases / 40));
  for (let g = 0; g < groups; g++) mkdirSync(join(source, 'ui', `area-${g}`), { recursive: true });
  for (let i = 0; i < args.canvases; i++) {
    const rel = join('ui', `area-${i % groups}`, `screen-${i}.tsx`);
    const src = canvasSource(i);
    canvasBytes += src.length;
    writeFileSync(join(source, rel), src);
    writeFileSync(
      join(source, rel.replace(/\.tsx$/, '.meta.json')),
      `${JSON.stringify({ title: `Screen ${i}`, layout: { artboards: [] } })}\n`
    );
  }
  for (let d = 0; d < assetDirs; d++)
    mkdirSync(join(source, 'assets', `set-${d}`), { recursive: true });
  mkdirSync(join(source, 'system/ds/preview'), { recursive: true });
  for (let i = 0; i < args.files; i++) {
    // Mostly small images (2–40 KB), a few CSS/MD/SVG — the shape of a design root's file plane.
    const kind = i % 10;
    let rel;
    let body;
    if (kind < 8) {
      rel = join('assets', `set-${i % assetDirs}`, `a${i}.png`);
      body = bytes(2048 + Math.floor(rnd() * 38 * 1024));
    } else if (kind === 8) {
      rel = join('system/ds/preview', `part-${i}.css`);
      body = `.part-${i} { color: oklch(0.${i % 10} 0.1 ${i % 360}); }\n`.repeat(20);
    } else {
      rel = join('assets', `set-${i % assetDirs}`, `note-${i}.md`);
      body = `# Note ${i}\n\n${'Lorem ipsum dolor sit amet. '.repeat(30)}\n`;
    }
    fileBytes += body.length;
    writeFileSync(join(source, rel), body);
  }
  if (args.media > 0) {
    // One random pool sliced per file, each slice stamped with its index: distinct hashes without
    // generating gigabytes of random bytes one word at a time.
    const pool = bytes(args.mediaMaxKb * 1024 + 64);
    const lo = Math.log(args.mediaMinKb * 1024);
    const hi = Math.log(args.mediaMaxKb * 1024);
    for (let d = 0; d < assetDirs; d++)
      mkdirSync(join(source, 'media', `m-${d}`), { recursive: true });
    for (let i = 0; i < args.media; i++) {
      const size = Math.floor(Math.exp(lo + rnd() * (hi - lo)));
      const off = Math.floor(rnd() * 64);
      const body = Buffer.from(pool.subarray(off, off + size));
      body.writeUInt32LE(i, 0);
      body.writeUInt32LE(0x6d656469, 4);
      mediaBytes += size;
      const ext = i % 3 ? 'jpg' : 'mp4';
      writeFileSync(join(source, 'media', `m-${i % assetDirs}`, `clip-${i}.${ext}`), body);
    }
  }
}

// ── the hub (local, from source, Node 24, a checkout of its own) ──────────────
const checkout = join(OUT, 'hub-checkout');
mkdirSync(join(checkout, '.design'), { recursive: true });
writeFileSync(join(checkout, '.design', 'config.json'), `${JSON.stringify(config(), null, 2)}\n`);
// --pull seeds the hub through a first studio with the hub's write door opened wide (seeding is
// not what is measured), then restarts the hub on the same port with the shipped limits.
let hub = await startLocalHub({
  dir: join(OUT, 'hub'),
  workspace: checkout,
  ...(reuse ? { port: JSON.parse(readFileSync(join(OUT, 'hub-port.json'), 'utf8')).port } : {}),
  ...(args.pull && !reuse
    ? { env: { HUB_ASSET_WRITE_RATE_LIMIT: '100000' } }
    : args.hubRate
      ? { env: { HUB_ASSET_WRITE_RATE_LIMIT: String(args.hubRate) } }
      : {}),
});
const hubPort = Number(new URL(hub.http).port);
if (args.pull) writeFileSync(join(OUT, 'hub-port.json'), JSON.stringify({ port: hubPort }));
for (const d of args.pull ? [design, source] : [design]) {
  writeFileSync(
    join(d, 'config.json'),
    `${JSON.stringify(config({ linkedHub: { url: hub.http, linkedAt: Date.now() } }), null, 2)}\n`
  );
}

// ── the studio server, isolated from every real config ────────────────────────
const home = join(OUT, 'home');
mkdirSync(join(home, 'config'), { recursive: true });
// A throwaway HOME with the shared signed-out stub `claude` first on PATH: the studio's ACP probe
// never reaches the real CLI or the keychain.
const claudeStub = stubClaudeEnv(home);
const hubsFile = join(home, 'hubs.json');
writeFileSync(
  hubsFile,
  JSON.stringify({ hubs: { [hub.http]: { token: hub.tokens.owner, linkedAt: Date.now() } } }),
  { mode: 0o600 }
);
const freePort = () =>
  new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });

const rssMb = (pid) => {
  try {
    return (
      Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })) / 1024
    );
  } catch {
    return 0;
  }
};

/**
 * macOS phys footprint (what Activity Monitor calls Memory) in MB, or 0 elsewhere. `ps` RSS leaves
 * out compressed and swapped pages, so on a Mac under memory pressure it reads far below what the
 * process holds — a fixed leak can look like 100 MB.
 */
const footprintMb = (pid) => {
  if (process.platform !== 'darwin') return 0;
  try {
    const out = execFileSync('footprint', ['-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(/Footprint: ([\d.]+) ([KMG])B/);
    return m ? Number(m[1]) * { K: 1 / 1024, M: 1, G: 1024 }[m[2]] : 0;
  } catch {
    return 0;
  }
};

/** Boot a studio on `root`, sample its RSS until its first sync is done (+ `settleS`), stop it. */
async function runStudio(root, name, { probe, settleS, blockedIsDone = false, forS = 0 }) {
  const port = await freePort();
  const logFile = join(OUT, `${name}.log`);
  const started = Date.now();
  // --client: the measured studio has its window open, as on the desktop — a headless Chromium on
  // the studio page, so every index/listing refresh a landing file causes is part of the number.
  let browser = null;
  if (probe && args.client) {
    for (let i = 0; i < 120 && !browser; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const up = await fetch(`http://127.0.0.1:${port}/_health`).then(
        (r) => r.ok,
        () => false
      );
      if (!up) continue;
      const { chromium } = createRequire(join(REPO, 'apps/studio/package.json'))('playwright');
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    }
  }
  const studio = spawn(
    'bun',
    [
      '--no-env-file',
      // --preload <file>: a diagnostic probe loaded into the server (e.g. bun:jsc heapStats every few s).
      ...(probe && args.preload ? ['--preload', resolve(args.preload)] : []),
      // --bun-arg <flag>: any other runtime flag for the server (e.g. --cpu-prof-md).
      ...(probe ? args.bunArgs : []),
      // --studio <dir>: the measured server only (the seed and the hub stay this checkout's) — an
      // older apps/studio tree, for a before/after on one machine.
      join(probe && args.studio ? resolve(args.studio) : join(REPO, 'apps/studio'), 'server.ts'),
      '--root',
      root,
      '--port',
      String(port),
    ],
    {
      env: {
        ...claudeStub,
        HOME: home,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        XDG_CONFIG_HOME: join(home, 'config'),
        MAUDE_UI_PREFS_PATH: join(home, 'prefs.json'),
        MAUDE_INDEX_DIR: join(home, 'index'),
        MAUDE_CLOUD_CONFIG: join(home, 'cloud.json'),
        HUBS_CONFIG_PATH: hubsFile,
        MAUDE_APP_BOUND_HUB: hub.http,
        MAUDE_NO_AUTOBUILD: '1',
        NO_OPEN: '1',
        // A --preload probe's own knobs pass through; nothing else from this shell does.
        ...(probe
          ? Object.fromEntries(
              Object.entries(process.env).filter(([k]) => k.startsWith('MAUDE_PROBE_'))
            )
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const log = [];
  studio.stdout.on('data', (c) => log.push(c.toString('utf8')));
  studio.stderr.on('data', (c) => log.push(c.toString('utf8')));
  const statusFile = join(root, '.design', '_sync.json');
  const readStatus = () => {
    try {
      return JSON.parse(readFileSync(statusFile, 'utf8'));
    } catch {
      return null;
    }
  };

  let peak = 0;
  let peakAt = 0;
  const samples = [];
  let doneAt = 0;
  let status = null;
  const deadline = started + args.timeout * 1000;
  let exited = false;
  studio.on('exit', () => {
    exited = true;
  });
  while (!exited && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const rss = rssMb(studio.pid);
    const t = Date.now() - started;
    if (rss > peak) {
      peak = rss;
      peakAt = t;
    }
    status = readStatus();
    // Footprint every 10th sample (5 s): the call takes ~0.1 s.
    const fp = samples.length % 10 === 0 ? Math.round(footprintMb(studio.pid)) : undefined;
    samples.push({
      t,
      rss: Math.round(rss),
      ...(fp ? { fp } : {}),
      docs: status?.docs,
      files: status?.files?.progress,
    });
    if (!args.json && samples.length % 10 === 0) {
      const d = status?.docs;
      const f = status?.files?.progress;
      process.stdout.write(
        `[${name}] t=${(t / 1000).toFixed(0)}s rss=${rss.toFixed(0)}MB${fp ? ` footprint=${fp}MB` : ''} docs=${d ? `${d.synced}/${d.synced + d.pending}` : '-'} files=${f ? `${f.phase} ${f.delivered}/${f.tracked}` : '-'}\n`
      );
    }
    const cold = status?.coldOpen;
    if (!doneAt && cold?.canvasesMs !== undefined && cold?.filesMs !== undefined) doneAt = t;
    // A seed whose last files the hub refused (its hourly upload quota) is as done as it gets.
    const prog = status?.files?.progress;
    if (!doneAt && blockedIsDone && prog?.phase === 'blocked' && prog.remaining === 0) doneAt = t;
    // Keep sampling `settleS` past done: what the server still holds once the sync settles.
    if (doneAt && t - doneAt > settleS * 1000) break;
    if (forS && t > forS * 1000) break;
  }
  const settled = rssMb(studio.pid);
  // With the probe loaded: one heap snapshot of the settled server (scripts/lib/mem-probe.ts).
  const probeOut = process.env.MAUDE_PROBE_OUT;
  if (probe && args.preload && probeOut && !exited) {
    const summary = `${probeOut}.final.summary.json`;
    rmSync(summary, { force: true });
    studio.kill('SIGUSR2');
    for (let i = 0; i < 240 && !existsSync(summary); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await browser?.close().catch(() => {});
  writeFileSync(logFile, log.join(''));
  studio.kill('SIGTERM');
  await new Promise((r) => (exited ? r() : studio.on('exit', r)));
  const memLines = log
    .join('')
    .split('\n')
    .filter((l) => l.includes('[mem]'));
  // The steady state: the median of the samples taken after the sync reported done.
  const after = doneAt ? samples.filter((s) => s.t >= doneAt) : [];
  return {
    done: !!doneAt,
    wallS: doneAt ? +(doneAt / 1000).toFixed(1) : null,
    coldOpen: status?.coldOpen ?? null,
    peakRssMB: Math.round(peak),
    peakAtS: +(peakAt / 1000).toFixed(1),
    p50RssMB: pct(samples, 0.5),
    p90RssMB: pct(samples, 0.9),
    steadyRssMB: pct(after, 0.5),
    peakFootprintMB: Math.max(0, ...samples.map((s) => s.fp ?? 0)),
    steadyFootprintMB: pct(
      after.filter((s) => s.fp).map((s) => ({ rss: s.fp })),
      0.5
    ),
    settledRssMB: Math.round(settled),
    docs: status?.docs ?? null,
    files_: status?.files?.progress ?? null,
    memLines,
    log: logFile,
    samples,
  };
}

function pct(list, q) {
  const v = list.map((x) => x.rss).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : 0;
}

if (args.pull && !reuse) {
  const seeded = await runStudio(seedProject, 'seed', {
    probe: false,
    settleS: 5,
    blockedIsDone: true,
  });
  process.stdout.write(
    `seeded the hub: done=${seeded.done} in ${seeded.wallS}s (peak ${seeded.peakRssMB} MB)\n`
  );
  if (!seeded.done) {
    hub.stop();
    process.stderr.write('seeding the hub did not finish before --timeout\n');
    process.exit(3);
  }
  hub.stop();
  await new Promise((r) => setTimeout(r, 1000));
  hub = await startLocalHub({ dir: join(OUT, 'hub'), workspace: checkout, port: hubPort });
}
const run = await runStudio(project, 'studio', { probe: true, settleS: args.settle });
// --reboot S: start the studio again on the now-synced project and sample it for S seconds — the
// boot that renders a cover for every canvas the sync brought (thumbs `bootCovers`).
const rebooted = args.reboot
  ? await runStudio(project, 'reboot', { probe: true, settleS: 0, forS: args.reboot })
  : null;
hub.stop();

const { samples, ...measured } = run;
const result = {
  canvases: args.canvases,
  files: args.files,
  canvasMB: +(canvasBytes / 1048576).toFixed(1),
  fileMB: +(fileBytes / 1048576).toFixed(1),
  pull: args.pull,
  media: args.media,
  mediaMB: +(mediaBytes / 1048576).toFixed(1),
  ...measured,
  ...(rebooted
    ? {
        reboot: {
          peakRssMB: rebooted.peakRssMB,
          peakFootprintMB: rebooted.peakFootprintMB,
          peakAtS: rebooted.peakAtS,
          p50RssMB: rebooted.p50RssMB,
          settledRssMB: rebooted.settledRssMB,
          memLines: rebooted.memLines,
          log: rebooted.log,
        },
      }
    : {}),
};
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ...result, samples }, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!run.done) {
  process.stderr.write('the first sync did not finish before --timeout\n');
  process.exit(3);
}
if (args.budget && run.peakRssMB > args.budget) {
  process.stderr.write(`peak RSS ${run.peakRssMB} MB is over the ${args.budget} MB budget\n`);
  process.exit(1);
}
