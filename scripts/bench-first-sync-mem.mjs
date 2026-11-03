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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.out || !/(^\/tmp\/|^\/private\/tmp\/|fixture|scratch)/.test(args.out)) {
  process.stderr.write('usage: bench-first-sync-mem.mjs --out <scratch dir under /tmp> …\n');
  process.exit(2);
}
const OUT = resolve(args.out);
rmSync(OUT, { recursive: true, force: true });
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

const project = join(OUT, 'project');
const design = join(project, '.design');
const groups = Math.max(1, Math.ceil(args.canvases / 40));
for (let g = 0; g < groups; g++) mkdirSync(join(design, 'ui', `area-${g}`), { recursive: true });
let canvasBytes = 0;
for (let i = 0; i < args.canvases; i++) {
  const rel = join('ui', `area-${i % groups}`, `screen-${i}.tsx`);
  const src = canvasSource(i);
  canvasBytes += src.length;
  writeFileSync(join(design, rel), src);
  writeFileSync(
    join(design, rel.replace(/\.tsx$/, '.meta.json')),
    `${JSON.stringify({ title: `Screen ${i}`, layout: { artboards: [] } })}\n`
  );
}
const assetDirs = 30;
for (let d = 0; d < assetDirs; d++)
  mkdirSync(join(design, 'assets', `set-${d}`), { recursive: true });
mkdirSync(join(design, 'system/ds/preview'), { recursive: true });
let fileBytes = 0;
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
  writeFileSync(join(design, rel), body);
}

// ── the hub (local, from source, Node 24, a checkout of its own) ──────────────
const checkout = join(OUT, 'hub-checkout');
mkdirSync(join(checkout, '.design'), { recursive: true });
writeFileSync(join(checkout, '.design', 'config.json'), `${JSON.stringify(config(), null, 2)}\n`);
const hub = await startLocalHub({ dir: join(OUT, 'hub'), workspace: checkout });
writeFileSync(
  join(design, 'config.json'),
  `${JSON.stringify(config({ linkedHub: { url: hub.http, linkedAt: Date.now() } }), null, 2)}\n`
);

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
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const logFile = join(OUT, 'studio.log');
const started = Date.now();
const studio = spawn(
  'bun',
  [
    '--no-env-file',
    // --preload <file>: a diagnostic probe loaded into the server (e.g. bun:jsc heapStats every few s).
    ...(args.preload ? ['--preload', resolve(args.preload)] : []),
    // --bun-arg <flag>: any other runtime flag for the server (e.g. --cpu-prof-md).
    ...args.bunArgs,
    join(REPO, 'apps/studio/server.ts'),
    '--root',
    project,
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
      ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k.startsWith('MAUDE_PROBE_'))
      ),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
const log = [];
studio.stdout.on('data', (c) => log.push(c.toString('utf8')));
studio.stderr.on('data', (c) => log.push(c.toString('utf8')));

const rssMb = (pid) => {
  try {
    return (
      Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })) / 1024
    );
  } catch {
    return 0;
  }
};
const readStatus = () => {
  try {
    return JSON.parse(readFileSync(join(design, '_sync.json'), 'utf8'));
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
  samples.push({ t, rss: Math.round(rss), docs: status?.docs, files: status?.files?.progress });
  if (!args.json && samples.length % 10 === 0) {
    const d = status?.docs;
    const f = status?.files?.progress;
    process.stdout.write(
      `t=${(t / 1000).toFixed(0)}s rss=${rss.toFixed(0)}MB docs=${d ? `${d.synced}/${d.synced + d.pending}` : '-'} files=${f ? `${f.phase} ${f.delivered}/${f.tracked}` : '-'}\n`
    );
  }
  const cold = status?.coldOpen;
  if (!doneAt && cold?.canvasesMs !== undefined && cold?.filesMs !== undefined) doneAt = t;
  // Keep sampling 15 s past done: what the server still holds once the sync settles.
  if (doneAt && t - doneAt > 15_000) break;
}
const settled = rssMb(studio.pid);
writeFileSync(logFile, log.join(''));
studio.kill('SIGTERM');
hub.stop();

const memLines = log
  .join('')
  .split('\n')
  .filter((l) => l.includes('[mem]'));
const result = {
  canvases: args.canvases,
  files: args.files,
  canvasMB: +(canvasBytes / 1048576).toFixed(1),
  fileMB: +(fileBytes / 1048576).toFixed(1),
  done: !!doneAt,
  wallS: doneAt ? +(doneAt / 1000).toFixed(1) : null,
  coldOpen: status?.coldOpen ?? null,
  peakRssMB: Math.round(peak),
  peakAtS: +(peakAt / 1000).toFixed(1),
  settledRssMB: Math.round(settled),
  docs: status?.docs ?? null,
  files_: status?.files?.progress ?? null,
  memLines,
  log: logFile,
};
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ...result, samples }, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!doneAt) {
  process.stderr.write('the first sync did not finish before --timeout\n');
  process.exit(3);
}
if (args.budget && peak > args.budget) {
  process.stderr.write(`peak RSS ${peak.toFixed(0)} MB is over the ${args.budget} MB budget\n`);
  process.exit(1);
}
