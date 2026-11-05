#!/usr/bin/env node
// First-sync PULL bench — issue #204 (task C): a large cloud project's first sync to a new Mac.
//
// Measured in the field (desktop 2.0.2/2.0.3, a 5 041-file cloud project, mostly media): 200 files
// per pass, one pass every 2–4 minutes, ≈ 1.5 h end to end. This rebuilds that shape LOCALLY, in the
// cloud → desktop direction (the sibling bench-first-sync-mem.mjs measures the push direction): a
// LOCAL hub from source under Node 24 in workspace mode whose checkout already holds the project
// (walk-imported into the file journal at boot, as a cell holds it), and a FRESH studio server with an
// empty design root linked to it. It times how long the file plane takes to land every file.
//
// --latency-ms L models a COLD CELL: the cell's disk is a cache, and every first GET of an inert-media
// file is a bucket fill (apps/hub/src/materializer.mjs — MAX_CONCURRENT_FILLS = 4, a 15 s deadline,
// then `503 Retry-After: 5 {"error":"fetching from storage","miss":"timeout"}` while the fill keeps
// going). A small proxy in front of the hub reproduces exactly that: `--fill-slots` slots, a fill
// costs L ms + size / --fill-mbps, a request past `--deadline-ms` gets the 503 and the fill finishes
// for the next caller. Everything else (journal, WebSocket) passes straight through.
//
// Never a real hub, never a real project: everything lives under --out (a scratch path).
//
//   node scripts/bench-first-sync-pull.mjs --out /tmp/x/pull [--files 3000] [--latency-ms 200]
//        [--fill-slots 4] [--deadline-ms 15000] [--fill-mbps 80] [--timeout 3600] [--json]
//
// Measured on an M-series Mac (shared with other agents' runs, so ±10 %), 3 000 files (1 094 MB,
// 50 KB–2 MB) + 12 code modules held by consent, wall clock from studio spawn to the last file:
//
//                                       local disk hub   cold-cell model (250 ms fill, 4 slots)
//   2.0.3 client, 600/min hub              459 s (429s)     3 022 s  (one GET at a time)
//   #204 client,  600/min hub (old)        380 s            404 s    (paced at 480/min)
//   #204 client,  1 800/min hub            156 s            277 s    (6 in flight, 0 misses)
//
// --hub-tree <repo> runs an older tree's hub (e.g. a `git archive` of the previous release).

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { stubClaudeEnv } from './lib/stub-claude.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {
    files: 3000,
    out: null,
    timeout: 3600,
    json: false,
    latencyMs: 0,
    fillSlots: 4,
    deadlineMs: 15_000,
    fillMbps: 80,
    codeModules: 12,
    studio: null,
    hubTree: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') out.files = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--latency-ms') out.latencyMs = Number(argv[++i]);
    else if (a === '--fill-slots') out.fillSlots = Number(argv[++i]);
    else if (a === '--deadline-ms') out.deadlineMs = Number(argv[++i]);
    else if (a === '--fill-mbps') out.fillMbps = Number(argv[++i]);
    else if (a === '--code-modules') out.codeModules = Number(argv[++i]);
    // --studio <server.ts>: another tree's studio (a before/after pair from one bench script).
    else if (a === '--studio') out.studio = resolve(argv[++i]);
    // --hub-tree <repo>: another tree's hub (e.g. a pre-#204 hub with its 600-a-minute read bucket).
    else if (a === '--hub-tree') out.hubTree = resolve(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.out || !/(^\/tmp\/|^\/private\/tmp\/|fixture|scratch)/.test(args.out)) {
  process.stderr.write('usage: bench-first-sync-pull.mjs --out <scratch dir under /tmp> …\n');
  process.exit(2);
}
const OUT = resolve(args.out);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── the fixture: the project lives on the HUB ─────────────────────────────────
let seed = 0x9e3779b9;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};
function bytes(n) {
  const b = Buffer.allocUnsafe(n);
  for (let i = 0; i + 4 <= n; i += 4) b.writeUInt32LE((rnd() * 0x100000000) >>> 0, i);
  return b;
}
const config = (extra = {}) => ({
  name: 'First sync pull bench',
  designRoot: '.design',
  formatVersion: 2,
  canvasGroups: [{ label: 'UI', path: 'ui' }],
  ...extra,
});

const checkout = join(OUT, 'hub-checkout');
const hubDesign = join(checkout, '.design');
mkdirSync(hubDesign, { recursive: true });
writeFileSync(join(hubDesign, 'config.json'), `${JSON.stringify(config(), null, 2)}\n`);
// ── the hub (local, from source, Node 24, the checkout above) ─────────────────
// Started on the bare checkout and fed AFTERWARDS: a boot-time walk-import of a gigabyte outlasts
// the fixture's 30 s start timeout. The 1 s journal walk picks the files up (waitForJournal below).
const { startLocalHub } = await import(
  pathToFileURL(join(args.hubTree ?? REPO, 'apps/desktop/e2e/fixtures/local-hub.mjs')).href
);
const hub = await startLocalHub({
  dir: join(OUT, 'hub'),
  workspace: checkout,
  env: { MAUDE_JOURNAL_WALK_MS: '1000' },
});

const assetDirs = 30;
for (let d = 0; d < assetDirs; d++)
  mkdirSync(join(hubDesign, 'assets', `set-${d}`), { recursive: true });
let fileBytes = 0;
for (let i = 0; i < args.files; i++) {
  // Mostly media 50 KB–2 MB: 70 % small (50–300 KB), 25 % medium (0.3–1 MB), 5 % large (1–2 MB).
  const r = rnd();
  const kb = r < 0.7 ? 50 + rnd() * 250 : r < 0.95 ? 300 + rnd() * 700 : 1024 + rnd() * 1024;
  const ext = i % 7 === 0 ? 'mp4' : i % 3 === 0 ? 'jpg' : 'png';
  const body = bytes(Math.floor(kb * 1024));
  fileBytes += body.length;
  writeFileSync(join(hubDesign, 'assets', `set-${i % assetDirs}`, `m${i}.${ext}`), body);
}
// One canvas on both sides: a studio with no canvas at all does not start sync ("no canvases found").
const CANVAS_REL = join('ui', 'home.tsx');
const CANVAS_SRC =
  `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';\n\n` +
  `export default function Home() {\n  return (\n    <DesignCanvas>\n      <DCSection id="main" title="Home">\n` +
  `        <DCArtboard id="a" label="A" width={800} height={600}>\n          <img src="../assets/set-0/m0.jpg" alt="" />\n        </DCArtboard>\n` +
  `      </DCSection>\n    </DesignCanvas>\n  );\n}\n`;
mkdirSync(join(hubDesign, 'ui'), { recursive: true });
writeFileSync(join(hubDesign, CANVAS_REL), CANVAS_SRC);
// Code modules: held on a Mac whose stored hub record does not vouch an owner (the "12 waiting").
mkdirSync(join(hubDesign, 'ui', 'shared'), { recursive: true });
for (let i = 0; i < args.codeModules; i++) {
  writeFileSync(
    join(hubDesign, 'ui', 'shared', `helper-${i}.ts`),
    `export const helper${i} = ${i};\n`
  );
}

// The walk has imported the whole project once the journal names every file.
async function waitForJournal(want) {
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    try {
      let since = 0;
      let n = 0;
      for (;;) {
        const res = await fetch(`${hub.http}/api/journal?since=${since}`, {
          headers: { authorization: `Bearer ${hub.tokens.owner}` },
        });
        const page = await res.json();
        n += (page.entries ?? []).filter((e) => !e.deleted).length;
        if (!page.truncated || !page.entries?.length) break;
        since = page.entries.at(-1).seq;
      }
      if (n >= want) return n;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('the hub journal never named the whole project');
}
const seededAt = Date.now();
const journalled = await waitForJournal(args.files + args.codeModules);
process.stdout.write(
  `hub journal holds ${journalled} files (${((Date.now() - seededAt) / 1000).toFixed(0)} s to import)\n`
);

// ── the cold-cell model ───────────────────────────────────────────────────────
let hubUrl = hub.http;
let proxy = null;
const cellStats = { gets: 0, misses503: 0, fills: 0, peakInFlight: 0, rate429: 0 };
if (args.latencyMs > 0) {
  const target = new URL(hub.http);
  const filled = new Set();
  const filling = new Map();
  let slotsBusy = 0;
  const slotQueue = [];
  let inFlight = 0;
  const withSlot = async (fn) => {
    if (slotsBusy >= args.fillSlots) await new Promise((r) => slotQueue.push(r));
    slotsBusy += 1;
    try {
      return await fn();
    } finally {
      slotsBusy -= 1;
      slotQueue.shift()?.();
    }
  };
  const fillOf = (rel) => {
    let p = filling.get(rel);
    if (!p) {
      let size = 0;
      try {
        size = statSync(join(hubDesign, rel)).size;
      } catch {
        /* a 404 later */
      }
      const ms = args.latencyMs + (size / (args.fillMbps * 1024 * 1024)) * 1000;
      p = withSlot(() => new Promise((r) => setTimeout(r, ms))).then(() => {
        cellStats.fills += 1;
        filled.add(rel);
        filling.delete(rel);
      });
      filling.set(rel, p);
    }
    return p;
  };
  const forward = (req, res) => {
    const up = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      }
    );
    up.on('error', () => res.destroy());
    req.pipe(up);
  };
  proxy = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'GET' && u.pathname.startsWith('/_project-file/assets/')) {
      cellStats.gets += 1;
      inFlight += 1;
      cellStats.peakInFlight = Math.max(cellStats.peakInFlight, inFlight);
      res.on('close', () => {
        inFlight -= 1;
      });
      const rel = decodeURIComponent(u.pathname.slice('/_project-file/'.length));
      if (!filled.has(rel)) {
        const done = await Promise.race([
          fillOf(rel).then(() => true),
          new Promise((r) => setTimeout(() => r(false), args.deadlineMs)),
        ]);
        if (!done) {
          cellStats.misses503 += 1;
          const body = JSON.stringify({ error: 'fetching from storage', miss: 'timeout' });
          res.writeHead(503, {
            'Content-Type': 'application/json',
            'Retry-After': '5',
            'Content-Length': Buffer.byteLength(body),
          });
          res.end(body);
          return;
        }
      }
    }
    forward(req, res);
  });
  proxy.on('upgrade', (req, socket, head) => {
    const up = net.connect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  hubUrl = `http://127.0.0.1:${proxy.address().port}`;
}

// ── the fresh desktop: an EMPTY design root linked to the hub ─────────────────
const project = join(OUT, 'project');
const design = join(project, '.design');
mkdirSync(join(design, 'ui'), { recursive: true });
writeFileSync(join(design, CANVAS_REL), CANVAS_SRC);
writeFileSync(
  join(design, 'config.json'),
  `${JSON.stringify(config({ linkedHub: { url: hubUrl, linkedAt: Date.now() } }), null, 2)}\n`
);
const home = join(OUT, 'home');
mkdirSync(join(home, 'config'), { recursive: true });
const claudeStub = stubClaudeEnv(home);
const hubsFile = join(home, 'hubs.json');
writeFileSync(
  hubsFile,
  JSON.stringify({ hubs: { [hubUrl]: { token: hub.tokens.owner, linkedAt: Date.now() } } }),
  { mode: 0o600 }
);
const port = await new Promise((ok) => {
  const s = net.createServer();
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
    args.studio ?? join(REPO, 'apps/studio/server.ts'),
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
      MAUDE_APP_BOUND_HUB: hubUrl,
      MAUDE_NO_AUTOBUILD: '1',
      NO_OPEN: '1',
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

const samples = [];
let peak = 0;
let firstAt = 0;
let doneAt = 0;
let status = null;
let exited = false;
studio.on('exit', () => {
  exited = true;
});
const deadline = started + args.timeout * 1000;
const want = args.files;
while (!exited && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  const t = Date.now() - started;
  const rss = rssMb(studio.pid);
  peak = Math.max(peak, rss);
  status = readStatus();
  const f = status?.files?.progress;
  const delivered = f?.delivered ?? 0;
  if (!firstAt && delivered > 0) firstAt = t;
  samples.push({ t, rss: Math.round(rss), delivered, tracked: f?.tracked ?? 0, phase: f?.phase });
  if (!args.json && samples.length % 15 === 0) {
    process.stdout.write(
      `t=${(t / 1000).toFixed(0)}s rss=${rss.toFixed(0)}MB files=${f ? `${f.phase} ${delivered}/${f.tracked}` : '-'}\n`
    );
  }
  if (!doneAt && delivered >= want) doneAt = t;
  if (doneAt && t - doneAt > 25_000) break;
}
writeFileSync(logFile, log.join(''));
studio.kill('SIGTERM');
hub.stop();
proxy?.close();

const fileLines = log
  .join('')
  .split('\n')
  .filter((l) => l.includes('[sync/files]'));
const result = {
  files: args.files,
  fileMB: +(fileBytes / 1048576).toFixed(1),
  latencyMs: args.latencyMs,
  fillSlots: args.fillSlots,
  done: !!doneAt,
  firstFileS: firstAt ? +(firstAt / 1000).toFixed(1) : null,
  wallS: doneAt ? +(doneAt / 1000).toFixed(1) : null,
  peakRssMB: Math.round(peak),
  cell: cellStats,
  final: status?.files?.progress ?? null,
  // The last progress lines, to see what the log says once nothing moves.
  tailLines: fileLines.slice(-8),
  log: logFile,
};
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ...result, samples }, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!doneAt) {
  process.stderr.write('the first sync did not finish before --timeout\n');
  process.exit(3);
}
