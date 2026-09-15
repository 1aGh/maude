#!/usr/bin/env node
// T32 — large-project scale acceptance, local real processes (plan T32; scenario
// rows S13 + S14; exercises T18 resumable media and T19 progressive bootstrap).
//
// What runs, all from source, all on loopback:
//
//   hub  apps/hub/test/fixtures/serve-hub.mjs --transactions, in WORKSPACE mode
//        (HUB_WORKSPACE_MODE=1 + MAUDE_REPO_DIR, no studio child) — the only
//        hub shape that carries the file journal / file plane. Accepted
//        revisions own the canvases; the checkout owns Plane-B files.
//   A    a studio server over a LARGE project (a copy of this repo's own
//        `.design/` plus synthetic 96 MiB + 513 MiB video-like objects and ~200
//        PNG-sized files), linked to the hub. A seeds.
//   B, C two CLEAN studio servers (empty `.design/` with only config.json) that
//        join mid-seed and pull everything.
//
// Every studio runs with MAUDE_NO_AUTOBUILD=1 and an isolated HOME /
// XDG_CONFIG_HOME / HUBS_CONFIG_PATH / MAUDE_CLOUD_CONFIG inside the work
// directory, so nothing reads or writes the developer's real config.
//
// The run:
//   1. A seeds and is SIGKILLed TWICE, each time restarted on the same
//      directory: once while the small files are moving (the hub holds 25–75 %
//      of them) and once while the largest object's upload session is
//      part-way through. Evidence of resume (not restart), from the hub's own
//      disk: no path the hub already held is written again (journal rows stay
//      one per path), the upload session keeps its id, and parts received
//      before the kill are never rewritten (inode + mtime watched every 50 ms).
//   2. Throughout, a small canvas on A is rewritten on disk (the way an agent or
//      editor writes it); each edit's latency to the hub's accepted head and to
//      B/C's disk is measured while media is still moving.
//   3. B and C join right after the restart; time-to-first-canvas (index API +
//      disk) is measured separately from full completion.
//   4. Oracle: SHA-256 of every eligible file on A, B and C (and the hub
//      checkout for Plane B); every missing/extra/mismatched path is listed.
//
//   node scripts/dev/t32-scale.mjs --scale full  --base-port 5110 \
//        --work <scratch>/t32-scale --out .ai/scenarios/.../t32-2026-09-15-scale.json
//   node scripts/dev/t32-scale.mjs --scale small --base-port 5150 --work <scratch>/t32-scale
//
// Flags: --scale small|full (default small) · --base-port N (hub=N, A=N+1,
// B=N+2, C=N+3) · --work DIR (required; everything temporary lives here) ·
// --out FILE (report; default <work>/<scale>/report.json) · --prior F1[,F2]
// (embed previous runs' summaries) · --keep-data (do not delete the big data) ·
// --timeout-min N (default 20 small / 60 full).

import { execFile, spawn } from 'node:child_process';
import { createCipheriv, createHash } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(ROOT, 'apps/hub/test/fixtures/serve-hub.mjs');
const { addToken } = await import(join(ROOT, 'apps/hub/src/tokens.mjs'));
const membership = await import(join(ROOT, 'apps/hub/src/file-membership.mjs'));
const { classifyProjectFile, isRuntimeStateRel, isProjectFileShape, isFilePlaneClass } = membership;
const Database = createRequire(join(ROOT, 'apps/hub/package.json'))('better-sqlite3');
const exec = promisify(execFile);

/* ---------------------------------------------------------------- args --- */

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 || !argv[i + 1] || argv[i + 1].startsWith('--') ? d : argv[i + 1];
};
const has = (k) => argv.includes(`--${k}`);
const SCALE = arg('scale', 'small');
if (!['small', 'full'].includes(SCALE)) throw new Error('--scale small|full');
const BASE_PORT = Number(arg('base-port', SCALE === 'full' ? '5110' : '5150'));
if (!(BASE_PORT >= 5100 && BASE_PORT + 3 <= 5199)) throw new Error('ports must be in 5100–5199');
const WORK_ROOT = arg('work');
if (!WORK_ROOT) throw new Error('--work <dir> is required');
const WORK = resolve(WORK_ROOT, SCALE);
const OUT = resolve(arg('out', join(WORK, 'report.json')));
const PRIOR = arg('prior');
const KEEP = has('keep-data');
const TIMEOUT_MS = Number(arg('timeout-min', SCALE === 'full' ? '60' : '20')) * 60_000;

const MIB = 1024 * 1024;
const PROFILE =
  SCALE === 'full'
    ? {
        // The whole of this repo's `.design/` (raw, runtime state included).
        copy: 'all',
        synthetic: [
          { rel: 'assets/t32-synthetic/master-096m.mp4', bytes: 96 * MIB },
          { rel: 'assets/t32-synthetic/master-513m.mp4', bytes: 513 * MIB },
        ],
        smallFiles: 200,
      }
    : {
        // Canvases, the design system, root docs, small assets and a slice of
        // runtime state — about 100 MB with the synthetic media.
        copy: 'small',
        synthetic: [
          { rel: 'assets/t32-synthetic/master-040m.mp4', bytes: 40 * MIB },
          { rel: 'assets/t32-synthetic/master-100m.mp4', bytes: 100 * MIB },
        ],
        smallFiles: 50,
      };
const BIG_REL = PROFILE.synthetic.at(-1).rel;
const PROBE_REL = 'ui/t32-probe.tsx';
const PORTS = { hub: BASE_PORT, a: BASE_PORT + 1, b: BASE_PORT + 2, c: BASE_PORT + 3 };
const HUB_URL = `http://127.0.0.1:${PORTS.hub}`;
const CANVAS_GROUPS = [
  { label: 'Design system', path: 'system' },
  { label: 'UI kit', path: 'ui' },
];

const runStart = Date.now();
const t = () => Date.now() - runStart;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stdout.write(`[t32-scale +${(t() / 1000).toFixed(1)}s] ${s}\n`);
const rel = (p) => relative(WORK, p) || '.';

/* ------------------------------------------------------------ layout ----- */

const P = {
  hubData: join(WORK, 'hub-data'),
  hubRepo: join(WORK, 'hub-repo'),
  logs: join(WORK, 'logs'),
  homes: join(WORK, 'homes'),
  a: join(WORK, 'client-a'),
  b: join(WORK, 'client-b'),
  c: join(WORK, 'client-c'),
};
const designOf = (root) => join(root, '.design');

/* ------------------------------------------------------------ helpers ---- */

function sha256File(abs) {
  const hash = createHash('sha256');
  const buf = Buffer.allocUnsafe(MIB);
  const fd = openSync(abs, 'r');
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(n === buf.length ? buf : buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/** Every file under `dir`, lstat'd (a symlink is recorded, never followed). */
function walk(dir) {
  const out = [];
  const rec = (abs, prefix) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = prefix ? `${prefix}/${e.name}` : e.name;
      const a = join(abs, e.name);
      if (e.isSymbolicLink()) {
        out.push({ rel: r, size: lstatSync(a).size, symlink: true });
      } else if (e.isDirectory()) {
        rec(a, r);
      } else if (e.isFile()) {
        out.push({ rel: r, size: statSync(a).size });
      }
    }
  };
  rec(dir, '');
  return out;
}

function classify(designRoot, r) {
  return classifyProjectFile(r, {
    canvasGroups: CANVAS_GROUPS,
    hasFile: (x) => existsSync(join(designRoot, x)),
  });
}

function exclusionReason(r, cls, symlink) {
  if (symlink) return 'symlink (never followed)';
  if (cls !== 'never') return null;
  if (r === 'config.json') return 'config.json — the trust anchor, never synced';
  if (isRuntimeStateRel(r)) return 'runtime state (DDR-115 isRuntimeStateRel)';
  if (!isProjectFileShape(r)) {
    const parts = r.split('/');
    if (/\.sync-conflict-/i.test(r)) return 'shape: foreign conflict artifact';
    if (parts.some((p) => p.startsWith('.'))) return 'shape: dotfile / dot segment';
    if (parts.slice(0, -1).some((p) => p.startsWith('_')))
      return 'shape: underscore directory outside the runtime list';
    if (parts.length > 8) return 'shape: deeper than 8 segments';
    return 'shape: other refusal';
  }
  const last = r.split('/').at(-1).toLowerCase();
  const dot = last.lastIndexOf('.');
  return `extension not enumerated (default-closed): ${dot < 0 ? '(none)' : last.slice(dot)}`;
}

/** Classified inventory of one design root. */
function inventory(designRoot, { hash = false } = {}) {
  const files = walk(designRoot);
  const eligible = new Map();
  const excluded = [];
  for (const f of files) {
    const cls = f.symlink ? 'never' : classify(designRoot, f.rel);
    const why = exclusionReason(f.rel, cls, f.symlink);
    if (why) excluded.push({ ...f, reason: why });
    else {
      eligible.set(f.rel, {
        size: f.size,
        cls,
        plane: cls === 'canvas-owned' ? 'A' : 'B',
        ...(hash ? { sha256: sha256File(join(designRoot, f.rel)) } : {}),
      });
    }
  }
  return { files, eligible, excluded };
}

function summarize(inv) {
  const sum = (xs) => xs.reduce((n, x) => n + x.size, 0);
  const byClass = {};
  const byPlane = {};
  for (const [, e] of inv.eligible) {
    byClass[e.cls] ??= { files: 0, bytes: 0 };
    byClass[e.cls].files += 1;
    byClass[e.cls].bytes += e.size;
    byPlane[e.plane] ??= { files: 0, bytes: 0 };
    byPlane[e.plane].files += 1;
    byPlane[e.plane].bytes += e.size;
  }
  const byReason = {};
  for (const x of inv.excluded) {
    byReason[x.reason] ??= { files: 0, bytes: 0, examples: [] };
    byReason[x.reason].files += 1;
    byReason[x.reason].bytes += x.size;
    if (byReason[x.reason].examples.length < 4) byReason[x.reason].examples.push(x.rel);
  }
  const elig = [...inv.eligible.values()];
  return {
    raw: { files: inv.files.length, bytes: sum(inv.files) },
    eligible: {
      files: elig.length,
      bytes: elig.reduce((n, e) => n + e.size, 0),
      byClass,
      byPlane,
    },
    excluded: { files: inv.excluded.length, bytes: sum(inv.excluded), byReason },
    largestEligible: [...inv.eligible]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 8)
      .map(([r, e]) => ({ rel: r, bytes: e.size, cls: e.cls })),
  };
}

/** Deterministic pseudo-random bytes (AES-256-CTR keystream), streamed. */
function writeSynthetic(abs, bytes, seed) {
  mkdirSync(dirname(abs), { recursive: true });
  const key = createHash('sha256').update(`t32-scale:${seed}`).digest();
  const cipher = createCipheriv('aes-256-ctr', key, Buffer.alloc(16));
  const zero = Buffer.alloc(8 * MIB);
  const hash = createHash('sha256');
  const fd = openSync(abs, 'w');
  try {
    // A plausible ISO-BMFF `ftyp` box first, so the bytes read as video-like.
    const ftyp = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
    writeSync(fd, ftyp);
    hash.update(ftyp);
    let left = bytes - ftyp.length;
    while (left > 0) {
      const n = Math.min(left, zero.length);
      const chunk = cipher.update(zero.subarray(0, n));
      writeSync(fd, chunk);
      hash.update(chunk);
      left -= n;
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/** A valid noise PNG, deterministic per seed, a few KB to ~100 KB. */
function noisePng(seed) {
  const w = 24 + ((seed * 37) % 137);
  const h = 24 + ((seed * 53) % 131);
  let s = (seed * 2654435761) >>> 0 || 1;
  const rows = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 4);
    rows[o] = 0;
    for (let i = 1; i <= w * 4; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      rows[o + i] = (i & 3) === 0 ? 255 : s & 0xff;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const probeSource = (marker) =>
  `export default function T32Probe() {\n  return (\n    <main style={{ padding: 32, fontFamily: 'system-ui' }}>\n      <h1 data-t32="${marker}">T32 probe ${marker}</h1>\n      <p>Rewritten on disk while media is still moving.</p>\n    </main>\n  );\n}\n`;

const pct = (xs, q) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const stats = (xs) => {
  const v = xs.filter((x) => typeof x === 'number');
  return {
    n: v.length,
    p50: pct(v, 0.5),
    p95: pct(v, 0.95),
    max: v.length ? Math.max(...v) : null,
  };
};

/* ------------------------------------------------------------ processes -- */

const children = new Map(); // name → { child, pid }
function cleanEnv(extra) {
  const keep = ['PATH', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}
function isolatedHome(name) {
  const home = join(P.homes, name);
  mkdirSync(join(home, '.config'), { recursive: true });
  mkdirSync(join(home, '.cache'), { recursive: true });
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    MAUDE_CLOUD_CONFIG: join(home, 'cloud.json'),
  };
}
function spawnLogged(name, cmd, args, env, cwd = ROOT) {
  mkdirSync(P.logs, { recursive: true });
  const fd = openSync(join(P.logs, `${name}.log`), 'a', 0o600);
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  children.set(name, { child, pid: child.pid, startedAt: t() });
  child.on('exit', (code, sig) => {
    const c = children.get(name);
    if (c?.child === child) c.exited = { code, sig, at: t() };
  });
  return child;
}
function killGroup(name, sig = 'SIGTERM') {
  const c = children.get(name);
  if (!c || c.exited) return;
  try {
    process.kill(-c.pid, sig);
  } catch {
    try {
      c.child.kill(sig);
    } catch {
      /* gone */
    }
  }
}
function killAll() {
  for (const name of children.keys()) killGroup(name, 'SIGKILL');
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    killAll();
    process.exit(130);
  });
}
process.on('exit', killAll);

async function reachable(url, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return true;
    } catch {
      /* starting */
    }
    await sleep(200);
  }
  return false;
}
async function portFree(port, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      await fetch(`http://127.0.0.1:${port}/_health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return true;
    }
    await sleep(200);
  }
  return false;
}

/* ------------------------------------------------------------ the run ---- */

const report = {
  task: 'T32',
  scenarios: ['S13', 'S14'],
  plan: '.ai/plans/feature-reliable-project-multiplayer.md#T32',
  date: new Date(runStart).toISOString(),
  scale: SCALE,
  script: 'scripts/dev/t32-scale.mjs',
  command: `node scripts/dev/t32-scale.mjs ${argv.map((a) => (a.startsWith('/') ? '<path>' : a)).join(' ')}`,
  environment: {},
  topology: {
    hub: 'serve-hub.mjs --transactions, HUB_WORKSPACE_MODE=1, MAUDE_REPO_DIR=<work>/hub-repo, MAUDE_STUDIO_CHILD=0 (self-host workspace hub, file journal on, accepted revisions on)',
    clients:
      'bun apps/studio/server.ts --root <dir> (MAUDE_NO_AUTOBUILD=1, isolated HOME/XDG/HUBS_CONFIG_PATH/MAUDE_CLOUD_CONFIG), linkedHub.syncFiles=true, owner-role hub record',
    ports: PORTS,
    limitations: [
      'Single machine, loopback: no WAN latency, no real object storage; the self-host SQLite accepted store is the only durable store here.',
      'Canvas "open" is measured through the studio index API and disk materialisation, not a rendered browser/WKWebView frame.',
      'Edits are written to the canvas file on disk (agent/editor path), not through inspector UI gestures.',
    ],
  },
  failures: [],
};
const fail = (what, detail) => {
  report.failures.push({ what, ...(detail !== undefined ? { detail } : {}) });
  log(`FAIL ${what}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
};

async function environment() {
  const v = async (cmd, args) => {
    try {
      return (await exec(cmd, args, { timeout: 5000 })).stdout.trim();
    } catch {
      return null;
    }
  };
  report.environment = {
    commit: await v('git', ['-C', ROOT, 'rev-parse', 'HEAD']),
    dirtyTrackedFiles: ((await v('git', ['-C', ROOT, 'status', '--porcelain', '-uno'])) ?? '')
      .split('\n')
      .filter(Boolean).length,
    node: process.version,
    bun: await v('bun', ['--version']),
    platform: `${platform()} ${release()} ${arch()}`,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? null,
    memoryBytes: totalmem(),
  };
}

/* ---- 1. the inventory --------------------------------------------------- */

function buildInventory() {
  const src = join(ROOT, '.design');
  const dst = designOf(P.a);
  mkdirSync(P.a, { recursive: true });
  const t0 = Date.now();
  if (PROFILE.copy === 'all') {
    cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
  } else {
    // Everything except the heavy runtime folders; assets only when small.
    cpSync(src, dst, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (p) => {
        const r = relative(src, p);
        if (!r) return true;
        const top = r.split('/')[0];
        if (['_history', '_chat', '_trash', '_draw'].includes(top)) return false;
        if ((top === 'assets' || top === 'exports') && r.split('/').length > 1) {
          try {
            const st = lstatSync(p);
            if (st.isFile() && st.size > 3 * MIB) return false;
          } catch {
            return false;
          }
        }
        return true;
      },
    });
  }
  const copyMs = Date.now() - t0;

  // Raw inventory AS COPIED — the 8.8 GB-vs-eligible distinction starts here.
  const copied = summarize(inventory(dst));

  // Per-machine link state for a DIFFERENT hub (the developer's own
  // localhost link) is reset so this is a first link to the test hub. It is
  // runtime state either way (never eligible); recorded, not hidden.
  const reset = { files: 0, bytes: 0, paths: [] };
  for (const r of ['_sync.json', '_server.json', '_active.json']) {
    const a = join(dst, r);
    if (existsSync(a)) {
      reset.files += 1;
      reset.bytes += statSync(a).size;
      reset.paths.push(r);
      rmSync(a, { force: true });
    }
  }
  const state = join(dst, '_state');
  if (existsSync(state)) {
    for (const f of walk(state)) {
      reset.files += 1;
      reset.bytes += f.size;
    }
    reset.paths.push('_state/**');
    rmSync(state, { recursive: true, force: true });
  }

  // The project links to the test hub; everything else in config.json stays.
  const cfgPath = join(dst, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.canvasGroups = CANVAS_GROUPS;
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now(), syncFiles: true };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);

  // The canvas edited throughout the run.
  writeFileSync(join(dst, PROBE_REL), probeSource('t32e0'));
  writeFileSync(
    join(dst, 'ui/t32-probe.meta.json'),
    `${JSON.stringify({ title: 'T32 probe', kind: 'web' }, null, 2)}\n`
  );

  // Synthetic large media + PNG-sized files.
  const synthetic = [];
  const tg = Date.now();
  for (const s of PROFILE.synthetic) {
    const sha = writeSynthetic(join(dst, s.rel), s.bytes, s.rel);
    synthetic.push({ rel: s.rel, bytes: s.bytes, sha256: sha });
  }
  let smallBytes = 0;
  for (let i = 0; i < PROFILE.smallFiles; i++) {
    const r = `assets/t32-small/still-${String(i).padStart(3, '0')}.png`;
    const png = noisePng(i + 1);
    mkdirSync(dirname(join(dst, r)), { recursive: true });
    writeFileSync(join(dst, r), png);
    smallBytes += png.length;
  }
  return {
    source: `this repository's own .design/ (${PROFILE.copy === 'all' ? 'complete copy' : 'copy without _history/_chat/_trash/_draw and without assets/exports over 3 MiB'}) plus synthetic media`,
    copyMs,
    asCopied: copied,
    resetLinkState: reset,
    synthetic: {
      large: synthetic,
      small: { files: PROFILE.smallFiles, bytes: smallBytes, pattern: 'assets/t32-small/still-NNN.png' },
      generator: 'AES-256-CTR keystream keyed by sha256("t32-scale:"+rel), after an ISO-BMFF ftyp box; streamed in 8 MiB chunks',
      generateMs: Date.now() - tg,
    },
  };
}

/* ---- 2. the hub + tokens ------------------------------------------------ */

const tokens = {};
function mintTokens() {
  mkdirSync(P.hubData, { recursive: true });
  const exp = Date.now() + 12 * 3600_000;
  for (const who of ['a', 'b', 'c']) {
    tokens[who] = addToken(P.hubData, {
      label: `t32-${who}`,
      scope: '*',
      role: 'owner',
      owner: `t32-${who}@local.test`,
      expiresAt: exp,
    }).value;
  }
  tokens.monitor = addToken(P.hubData, {
    label: 't32-monitor',
    scope: '*',
    readOnly: true,
    expiresAt: exp,
  }).value;
}

async function startHub() {
  mkdirSync(designOf(P.hubRepo), { recursive: true });
  writeFileSync(
    join(designOf(P.hubRepo), 'config.json'),
    `${JSON.stringify({ name: 't32-hub', canvasGroups: CANVAS_GROUPS }, null, 2)}\n`
  );
  spawnLogged(
    'hub',
    'node',
    [FIXTURE, P.hubData, String(PORTS.hub), '--transactions'],
    cleanEnv({
      ...isolatedHome('hub'),
      HUB_WORKSPACE_MODE: '1',
      MAUDE_REPO_DIR: P.hubRepo,
      MAUDE_DESIGN_ROOT: '.design',
      MAUDE_STUDIO_CHILD: '0',
    })
  );
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    const text = existsSync(join(P.logs, 'hub.log')) ? readFileSync(join(P.logs, 'hub.log'), 'utf8') : '';
    const line = text.split('\n').find((l) => l.startsWith('{') && l.includes('"http"'));
    if (line) return true;
    if (children.get('hub')?.exited) break;
    await sleep(200);
  }
  throw new Error(`hub did not start — see ${rel(join(P.logs, 'hub.log'))}`);
}

async function hubApi(route, { token = tokens.monitor } = {}) {
  const res = await fetch(`${HUB_URL}/api/projects/current/v1/${route}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The hub journal, read-only, straight from its SQLite file. */
function journalRows() {
  const file = join(P.hubData, 'journal.db');
  if (!existsSync(file)) return [];
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    return db
      .prepare('SELECT seq, path, sha256, size, deleted, source, at_ms FROM file_journal ORDER BY seq')
      .all();
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* closed */
    }
  }
}

/** Upload sessions on the hub, with per-part identity for the resume proof. */
function uploadSessions() {
  const dir = join(P.hubData, 'uploads');
  const out = [];
  let ids = [];
  try {
    ids = readdirSync(dir);
  } catch {
    return out;
  }
  for (const id of ids) {
    let s;
    try {
      s = JSON.parse(readFileSync(join(dir, id, 'session.json'), 'utf8'));
    } catch {
      continue;
    }
    const parts = {};
    let names = [];
    try {
      names = readdirSync(join(dir, id));
    } catch {
      /* completed + removed */
    }
    for (const n of names) {
      const m = /^(\d{6})\.part$/.exec(n);
      if (!m) continue;
      try {
        const st = statSync(join(dir, id, n));
        parts[Number(m[1])] = { ino: st.ino, mtimeMs: st.mtimeMs, size: st.size };
      } catch {
        /* raced a completion */
      }
    }
    out.push({ id, path: s.path, size: s.size, parts: s.parts, completedAt: s.completedAt ?? null, have: parts });
  }
  return out;
}

/* ---- 3. studio clients -------------------------------------------------- */

function prepareClean(root, name) {
  mkdirSync(join(designOf(root), 'ui'), { recursive: true });
  writeFileSync(
    join(designOf(root), 'config.json'),
    `${JSON.stringify(
      {
        name: `t32-clean-${name}`,
        canvasGroups: CANVAS_GROUPS,
        linkedHub: { url: HUB_URL, linkedAt: Date.now(), syncFiles: true },
      },
      null,
      2
    )}\n`
  );
}

function hubsConfig(who) {
  const p = join(P.homes, `${who}-hubs.json`);
  mkdirSync(P.homes, { recursive: true });
  writeFileSync(
    p,
    JSON.stringify({ hubs: { [HUB_URL]: { token: tokens[who], role: 'owner', linkedAt: Date.now() } } }),
    { mode: 0o600 }
  );
  return p;
}

let incarnation = { a: 0, b: 0, c: 0 };
async function startStudio(who, root) {
  incarnation[who] += 1;
  const name = `client-${who}-${incarnation[who]}`;
  spawnLogged(
    name,
    'bun',
    ['--no-env-file', join(ROOT, 'apps/studio/server.ts'), '--root', root, '--port', String(PORTS[who])],
    cleanEnv({
      ...isolatedHome(`client-${who}`),
      HUBS_CONFIG_PATH: hubsConfig(who),
      MAUDE_PROJECT_ROOT: root,
      CLAUDE_PROJECT_DIR: root,
      MAUDE_NO_AUTOBUILD: '1',
      NO_OPEN: '1',
    })
  );
  const t0 = t();
  const ok = await reachable(`http://127.0.0.1:${PORTS[who]}/_health`);
  if (!ok) throw new Error(`${name} never answered /_health — see ${rel(join(P.logs, `${name}.log`))}`);
  return { name, spawnedAt: t0, healthyAt: t() };
}

function syncJson(root) {
  try {
    return JSON.parse(readFileSync(join(designOf(root), '_sync.json'), 'utf8'));
  } catch {
    return null;
  }
}
function progressOf(root) {
  const s = syncJson(root);
  const p = s?.files?.progress;
  return p
    ? {
        phase: p.phase,
        tracked: p.tracked,
        delivered: p.delivered,
        remaining: p.remaining,
        bytesRemaining: p.bytesRemaining,
        blocked: p.blocked,
      }
    : null;
}

/* ---- 4. samplers ------------------------------------------------------- */

const resourceSamples = [];
const diskSamples = [];
async function sampleResources() {
  try {
    const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,comm='], { timeout: 3000 });
    const procs = stdout
      .split('\n')
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/))
      .filter(Boolean)
      .map((m) => ({ pid: +m[1], ppid: +m[2], cpu: +m[3], rssKiB: +m[4] }));
    const row = { at: t() };
    for (const [name, c] of children) {
      if (c.exited) continue;
      const own = new Set([c.pid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const p of procs)
          if (own.has(p.ppid) && !own.has(p.pid)) {
            own.add(p.pid);
            changed = true;
          }
      }
      const mine = procs.filter((p) => own.has(p.pid));
      row[name] = {
        cpu: Math.round(mine.reduce((n, p) => n + p.cpu, 0) * 10) / 10,
        rssMiB: Math.round(mine.reduce((n, p) => n + p.rssKiB, 0) / 1024),
        procs: mine.length,
      };
    }
    resourceSamples.push(row);
  } catch {
    /* ps unavailable this tick */
  }
}
async function sampleDisk() {
  const dirs = { hubData: P.hubData, hubRepo: P.hubRepo, a: P.a, b: P.b, c: P.c };
  const row = { at: t(), kib: {} };
  let total = 0;
  for (const [k, d] of Object.entries(dirs)) {
    if (!existsSync(d)) continue;
    try {
      const { stdout } = await exec('du', ['-sk', d], { timeout: 60_000 });
      const kib = Number(stdout.split(/\s+/)[0]);
      row.kib[k] = kib;
      total += kib;
    } catch {
      /* raced a removal */
    }
  }
  row.totalKiB = total;
  diskSamples.push(row);
}

/* ---- main --------------------------------------------------------------- */

async function main() {
  await environment();
  if (existsSync(WORK)) rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const distBefore = (await exec('git', ['-C', ROOT, 'status', '--short', 'apps/studio/dist/'])).stdout;

  log(`building the ${SCALE} inventory under ${WORK}`);
  const inv = buildInventory();
  const aDesign = designOf(P.a);
  const aInv = inventory(aDesign, { hash: true });
  report.inventory = { ...inv, atStart: summarize(aInv) };
  // Excluded files that the source repository VERSIONS — policy exclusions a
  // person would still call project content (runtime state is excluded here).
  try {
    const tracked = new Set(
      (await exec('git', ['-C', ROOT, 'ls-files', '-z', '.design'], { maxBuffer: 64 * MIB })).stdout
        .split('\0')
        .filter(Boolean)
        .map((x) => x.slice('.design/'.length))
    );
    const gap = aInv.excluded.filter(
      (x) => tracked.has(x.rel) && !x.reason.startsWith('runtime state') && x.rel !== 'config.json'
    );
    const byExt = {};
    for (const x of gap) {
      const m = /(\.[a-z0-9]+\.json|\.[a-z0-9]+)$/i.exec(x.rel);
      const k = m ? m[1].toLowerCase() : '(none)';
      byExt[k] ??= { files: 0, bytes: 0, examples: [] };
      byExt[k].files += 1;
      byExt[k].bytes += x.size;
      if (byExt[k].examples.length < 3) byExt[k].examples.push(x.rel);
    }
    report.inventory.excludedButGitTracked = { files: gap.length, bytes: gap.reduce((n, x) => n + x.size, 0), byExtension: byExt };
  } catch {
    report.inventory.excludedButGitTracked = null;
  }
  const planeB = [...aInv.eligible].filter(([, e]) => e.plane === 'B');
  const canvases = [...aInv.eligible].filter(([r, e]) => e.cls === 'canvas-owned' && r.endsWith('.tsx'));
  log(
    `inventory: raw ${aInv.files.length} files / ${(summarize(aInv).raw.bytes / MIB).toFixed(0)} MiB · eligible ${aInv.eligible.size} (${planeB.length} Plane-B, ${canvases.length} canvases) · excluded ${aInv.excluded.length}`
  );

  mintTokens();
  await startHub();
  log(`hub up on ${HUB_URL}`);

  const samplerRes = setInterval(() => void sampleResources(), 1000);
  let diskBusy = false;
  const samplerDisk = setInterval(async () => {
    if (diskBusy) return;
    diskBusy = true;
    await sampleDisk();
    diskBusy = false;
  }, 2000);

  // ── the hub-side watcher: journal + sessions ─────────────────────────────
  const planeBExpect = new Map(planeB.map(([r, e]) => [r, e]));
  const hubWatch = {
    firstDelivered: null,
    delivered: 0,
    deliveredBytes: 0,
    completeAt: null,
    order: [],
    partSeen: new Map(), // `${id}:${n}` → {ino, mtimeMs, firstAt}
    partRewrites: [],
    sessionsSeen: new Map(), // id → {path, parts, firstAt, completedAt}
    partBytesPeak: 0,
  };
  const deliveredSet = new Set();
  let watchBusy = false;
  const watchHub = () => {
    if (watchBusy) return;
    watchBusy = true;
    try {
      let partBytes = 0;
      const sessions = uploadSessions();
      for (const s of sessions) for (const p of Object.values(s.have)) partBytes += p.size;
      if (partBytes > hubWatch.partBytesPeak) hubWatch.partBytesPeak = partBytes;
      for (const s of sessions) {
        if (!hubWatch.sessionsSeen.has(s.id))
          hubWatch.sessionsSeen.set(s.id, { path: s.path, parts: s.parts, firstAt: t(), completedAt: null });
        const seen = hubWatch.sessionsSeen.get(s.id);
        if (s.completedAt && !seen.completedAt) seen.completedAt = t();
        seen.maxHave = Math.max(seen.maxHave ?? 0, Object.keys(s.have).length);
        for (const [n, p] of Object.entries(s.have)) {
          const k = `${s.id}:${n}`;
          const prev = hubWatch.partSeen.get(k);
          if (!prev) hubWatch.partSeen.set(k, { ino: p.ino, mtimeMs: p.mtimeMs, firstAt: t(), aIncarnation: incarnation.a });
          else if (prev.ino !== p.ino || prev.mtimeMs !== p.mtimeMs) {
            hubWatch.partRewrites.push({ session: s.id, part: Number(n), at: t(), firstAt: prev.firstAt });
            hubWatch.partSeen.set(k, { ...prev, ino: p.ino, mtimeMs: p.mtimeMs });
          }
        }
      }
    } finally {
      watchBusy = false;
    }
  };
  const journalWatch = () => {
    const rows = journalRows();
    if (!rows) return;
    for (const r of rows) {
      if (r.deleted || deliveredSet.has(r.path)) continue;
      const e = planeBExpect.get(r.path);
      if (e && r.sha256 === e.sha256) {
        deliveredSet.add(r.path);
        hubWatch.delivered += 1;
        hubWatch.deliveredBytes += e.size;
        hubWatch.firstDelivered ??= t();
        if (hubWatch.order.length < 5000) hubWatch.order.push({ rel: r.path, size: e.size, at: t() });
      }
    }
    if (!hubWatch.completeAt && hubWatch.delivered === planeB.length) hubWatch.completeAt = t();
  };
  const sessTimer = setInterval(watchHub, 50);
  const journalTimer = setInterval(journalWatch, 1000);

  // ── A: seed ─────────────────────────────────────────────────────────────
  const seed = { a1: await startStudio('a', P.a) };
  let aUp = true;
  log(`A up (${seed.a1.name}); seeding`);
  // What A's own studio lists — the bar a clean client's index must reach.
  let aIndexed = [];
  try {
    const text = await (
      await fetch(`http://127.0.0.1:${PORTS.a}/_index-data`, { signal: AbortSignal.timeout(30_000) })
    ).text();
    aIndexed = canvases.map(([r]) => r).filter((r) => text.includes(r.replace(/\.tsx$/, '')));
  } catch {
    /* measured as absent */
  }
  report.aIndexedCanvases = aIndexed.length;

  // ── probe presence on the hub (accepted head) ────────────────────────────
  let probeHash = null;
  const blobHas = new Map();
  async function hubProbeHas(marker) {
    const r = await hubApi('bootstrap').catch(() => null);
    const d = r?.body?.docs?.find?.((x) => !x.retired && String(x.path ?? '').endsWith('t32-probe.tsx'));
    const h = d?.lanes?.html?.hash;
    if (!h) return false;
    probeHash = h;
    if (!blobHas.has(h)) {
      const b = await hubApi(`blobs/${h}`).catch(() => null);
      const body = typeof b?.body?.body === 'string' ? b.body.body : '';
      blobHas.set(h, body);
    }
    return blobHas.get(h).includes(marker);
  }

  // ── the edit loop ─────────────────────────────────────────────────────────
  const edits = [];
  const peersUp = new Set();
  let stopEdits = false;
  const mediaState = () => ({
    aSeedDeliveredFiles: hubWatch.delivered,
    aSeedRemainingBytes: totalPlaneBBytes() - hubWatch.deliveredBytes,
    b: peerMedia.b ? { remainingBytes: peerMedia.b.remainingBytes } : null,
    c: peerMedia.c ? { remainingBytes: peerMedia.c.remainingBytes } : null,
  });
  const totalPlaneBBytes = () => planeB.reduce((n, [, e]) => n + e.size, 0);
  const peerMedia = { b: null, c: null };
  const probeOn = (who) => {
    try {
      return readFileSync(join(designOf(P[who]), PROBE_REL), 'utf8');
    } catch {
      return '';
    }
  };
  const editLoop = (async () => {
    // Wait for the probe canvas to exist on the hub (A's cold start proposed it).
    const w0 = Date.now();
    while (!stopEdits && !(await hubProbeHas('t32e0'))) {
      if (Date.now() - w0 > 10 * 60_000) {
        fail('probe canvas never reached the hub accepted head');
        return;
      }
      await sleep(500);
    }
    report.probeOnHubAt = t();
    let n = 0;
    while (!stopEdits) {
      if (!aUp) {
        await sleep(300);
        continue;
      }
      n += 1;
      const marker = `t32e${n}x${Date.now().toString(36)}`;
      const targets = [...peersUp].filter((p) => probeOn(p).length > 0);
      const rec = {
        n,
        at: t(),
        aIncarnation: incarnation.a,
        media: mediaState(),
        hubMs: null,
        peers: Object.fromEntries(targets.map((p) => [p, null])),
      };
      writeFileSync(join(aDesign, PROBE_REL), probeSource(marker));
      const t0 = Date.now();
      let lastHubCheck = 0;
      while (Date.now() - t0 < 60_000) {
        if (rec.hubMs === null && Date.now() - lastHubCheck > 100) {
          lastHubCheck = Date.now();
          if (await hubProbeHas(marker)) rec.hubMs = Date.now() - t0;
        }
        for (const p of targets) {
          if (rec.peers[p] === null && probeOn(p).includes(marker)) rec.peers[p] = Date.now() - t0;
        }
        if (rec.hubMs !== null && targets.every((p) => rec.peers[p] !== null)) break;
        if (!aUp && rec.hubMs === null) {
          rec.interruptedByKill = true;
          break;
        }
        await sleep(50);
      }
      if (!rec.interruptedByKill && (rec.hubMs === null || targets.some((p) => rec.peers[p] === null)))
        rec.timedOut = true;
      edits.push(rec);
      await sleep(300);
    }
  })();

  // ── two SIGKILLs mid-seed ────────────────────────────────────────────────
  //
  //   kill 1 — while the SMALL files are moving (the hub holds 25–75 % of the
  //            Plane-B files and the large objects have not started);
  //   kill 2 — while the LARGEST object's upload session is part-way through.
  //
  // After each, A restarts on the same directory. Resume is judged from the
  // hub's own disk and journal, never from A's claims.
  const deliveredCount = () => {
    const file = join(P.hubData, 'journal.db');
    if (!existsSync(file)) return 0;
    let db;
    try {
      db = new Database(file, { readonly: true, fileMustExist: true });
      return db.prepare('SELECT COUNT(DISTINCT path) AS n FROM file_journal WHERE deleted = 0').get().n;
    } catch {
      return 0;
    } finally {
      try {
        db?.close();
      } catch {
        /* closed */
      }
    }
  };
  const smallTarget = Math.max(2, Math.floor((planeB.length - PROFILE.synthetic.length) * 0.25));
  const smallCeiling = Math.floor((planeB.length - PROFILE.synthetic.length) * 0.75);
  const kills = [];
  const progressTrail = [];
  const progTimer = setInterval(() => {
    const s = syncJson(P.a);
    const p = s?.files?.progress;
    if (p && progressTrail.length < 2000)
      progressTrail.push({ at: t(), processStartedAt: s.startedAt ?? null, incarnation: incarnation.a, phase: p.phase, tracked: p.tracked, delivered: p.delivered, remaining: p.remaining, bytesRemaining: p.bytesRemaining });
  }, 500);
  async function killAndRestart(label, trigger) {
    watchHub();
    journalWatch();
    const inc = incarnation.a;
    const sess = trigger.session ?? null;
    const partsBefore = sess ? Object.keys(sess.have).map(Number).sort((x, y) => x - y) : [];
    const pre = {
      label,
      at: t(),
      trigger: trigger.kind,
      incarnationKilled: inc,
      hubDeliveredFiles: deliveredCount(),
      hubDeliveredExpectedFiles: hubWatch.delivered,
      hubDeliveredBytes: hubWatch.deliveredBytes,
      planeBFiles: planeB.length,
      planeBBytes: totalPlaneBBytes(),
      largeSession: sess
        ? { id: sess.id, path: sess.path, parts: sess.parts, partsReceived: partsBefore.length }
        : null,
      aProgressAtKill: progressOf(P.a),
      journalRows: journalRows()?.length ?? null,
      partsBefore,
    };
    log(
      `SIGKILL A (${label}): hub holds ${pre.hubDeliveredFiles}/${planeB.length} Plane-B files${sess ? `; large session ${partsBefore.length}/${sess.parts} parts` : ''}`
    );
    aUp = false;
    killGroup(`client-a-${inc}`, 'SIGKILL');
    await portFree(PORTS.a);
    await sleep(1000);
    const next = await startStudio('a', P.a);
    aUp = true;
    log(`A restarted (${next.name}) after ${next.healthyAt - pre.at} ms`);
    const k = { ...pre, restartedAs: next.name, restartedSpawnedAt: next.spawnedAt, restartedHealthyAt: next.healthyAt, before: seed[`a${inc}`]?.name ?? `client-a-${inc}` };
    seed[`a${inc + 1}`] = next;
    kills.push(k);
    return k;
  }

  // Kill 1 — mid small-file seed.
  const trig1 = await (async () => {
    const end = Date.now() + TIMEOUT_MS / 4;
    while (Date.now() < end) {
      const n = deliveredCount();
      const bigStarted = uploadSessions().some((x) => x.path === BIG_REL);
      if (n >= smallTarget && n <= smallCeiling && !bigStarted) return { kind: 'small-files-mid-seed' };
      if (n > smallCeiling || bigStarted) return { kind: `missed — hub already held ${n} files`, soft: true };
      if (children.get(`client-a-${incarnation.a}`)?.exited) return { kind: 'A exited on its own' };
      await sleep(20);
    }
    return { kind: 'timeout' };
  })();
  if (trig1.kind !== 'small-files-mid-seed') fail('kill 1 trigger (mid small-file seed)', trig1.kind);
  await killAndRestart('mid small-file seed', trig1);

  // Kill 2 — the largest object's session part-way through.
  const trigger = await (async () => {
    const end = Date.now() + TIMEOUT_MS / 2;
    let lastJournalPeek = 0;
    while (Date.now() < end) {
      const s = uploadSessions().find((x) => x.path === BIG_REL && !x.completedAt);
      if (s) {
        const have = Object.keys(s.have).length;
        if (have >= Math.max(2, Math.floor(s.parts * 0.3)) && have < s.parts) return { kind: 'large-upload-mid-session', session: s };
      }
      if (Date.now() - lastJournalPeek > 500) {
        lastJournalPeek = Date.now();
        if (journalRows()?.some((r) => r.path === BIG_REL))
          return { kind: 'missed — the large object completed before the trigger fired' };
      }
      if (children.get(`client-a-${incarnation.a}`)?.exited) return { kind: 'A exited on its own' };
      await sleep(20);
    }
    return { kind: 'timeout' };
  })();
  if (trigger.kind !== 'large-upload-mid-session') fail('kill 2 trigger (mid large upload)', trigger.kind);
  const kill2 = await killAndRestart('mid large-object upload', trigger);
  const bigSess = trigger.session ?? null;
  const preKillParts = kill2.partsBefore;

  // ── B and C join mid-seed ─────────────────────────────────────────────────
  prepareClean(P.b, 'b');
  prepareClean(P.c, 'c');
  const canvasSet = canvases.map(([r]) => r);
  const bigRels = PROFILE.synthetic.map((s) => s.rel);
  const clean = {};
  async function follow(who) {
    const m = {
      spawnedAt: t(),
      healthyAt: null,
      indexFirstCanvasAt: null,
      indexProbeAt: null,
      indexAllCanvasesAt: null,
      diskFirstCanvasAt: null,
      diskProbeAt: null,
      diskAllCanvasesAt: null,
      firstPlaneBFileAt: null,
      planeBCompleteAt: null,
      largeObjects: Object.fromEntries(bigRels.map((r) => [r, null])),
      completeAt: null,
      firstCanvasBeforeFullMedia: null,
      mediaOutstandingAtFirstCanvas: null,
      progressSamples: [],
    };
    clean[who] = m;
    const s = await startStudio(who, P[who]);
    m.name = s.name;
    m.healthyAt = s.healthyAt;
    peersUp.add(who);
    const d = designOf(P[who]);
    let lastIndex = 0;
    let lastProg = 0;
    while (!m.completeAt && Date.now() - runStart < TIMEOUT_MS) {
      // Index API (what the studio shell lists) — until every canvas shows.
      if (!m.indexAllCanvasesAt && Date.now() - lastIndex > 1000) {
        lastIndex = Date.now();
        try {
          const text = await (
            await fetch(`http://127.0.0.1:${PORTS[who]}/_index-data`, { signal: AbortSignal.timeout(10_000) })
          ).text();
          const listed = aIndexed.filter((r) => text.includes(r.replace(/\.tsx$/, '')));
          if (listed.length > 0) m.indexFirstCanvasAt ??= t();
          if (text.includes('t32-probe')) m.indexProbeAt ??= t();
          m.indexListed = listed.length;
          if (aIndexed.length > 0 && listed.length === aIndexed.length) m.indexAllCanvasesAt = t();
        } catch {
          /* busy */
        }
      }
      const have = canvasSet.filter((r) => existsSync(join(d, r)));
      if (have.length > 0 && !m.diskFirstCanvasAt) {
        m.diskFirstCanvasAt = t();
        let outstanding = 0;
        for (const [r, e] of planeB) {
          try {
            if (statSync(join(d, r)).size !== e.size) outstanding += e.size;
          } catch {
            outstanding += e.size;
          }
        }
        m.mediaOutstandingAtFirstCanvas = outstanding;
        m.firstCanvasBeforeFullMedia = outstanding > 0;
      }
      if (existsSync(join(d, PROBE_REL))) m.diskProbeAt ??= t();
      if (have.length === canvasSet.length) m.diskAllCanvasesAt ??= t();
      let presentB = 0;
      let remainingBytes = 0;
      for (const [r, e] of planeB) {
        let ok = false;
        try {
          ok = statSync(join(d, r)).size === e.size;
        } catch {
          /* absent */
        }
        if (ok) presentB += 1;
        else remainingBytes += e.size;
      }
      peerMedia[who] = { remainingBytes, presentB };
      try {
        const dl = join(d, '_state', 'downloads');
        const staged = readdirSync(dl).reduce((n, f) => n + statSync(join(dl, f)).size, 0);
        if (staged > (m.stagingPeakBytes ?? 0)) m.stagingPeakBytes = staged;
      } catch {
        /* nothing staged */
      }
      if (presentB > 0) m.firstPlaneBFileAt ??= t();
      for (const r of bigRels) {
        if (m.largeObjects[r] === null) {
          try {
            if (statSync(join(d, r)).size === planeBExpect.get(r)?.size) m.largeObjects[r] = t();
          } catch {
            /* not yet */
          }
        }
      }
      if (presentB === planeB.length) m.planeBCompleteAt ??= t();
      if (m.planeBCompleteAt && m.diskAllCanvasesAt) m.completeAt = t();
      if (Date.now() - lastProg > 5000) {
        lastProg = Date.now();
        const p = progressOf(P[who]);
        if (p) m.progressSamples.push({ at: t(), ...p, presentB });
      }
      await sleep(1000);
    }
    return m;
  }
  const joined = await Promise.all([follow('b'), follow('c')]);
  log(
    `B complete: ${joined[0].completeAt ? `${((joined[0].completeAt - joined[0].spawnedAt) / 1000).toFixed(1)} s` : 'NO'} · C complete: ${joined[1].completeAt ? `${((joined[1].completeAt - joined[1].spawnedAt) / 1000).toFixed(1)} s` : 'NO'}`
  );

  // Let the A seed finish too (it normally already has).
  const seedEnd = Date.now() + 5 * 60_000;
  while (!hubWatch.completeAt && Date.now() < seedEnd) {
    journalWatch();
    await sleep(1000);
  }

  // ── settle: stop editing, let the last edit land everywhere ──────────────
  stopEdits = true;
  await editLoop;
  clearInterval(progTimer);
  const lastEdit = edits.at(-1);
  await sleep(5000);

  // Resume evidence from the hub's own disk + journal.
  watchHub();
  journalWatch();
  const bigSeen = bigSess ? hubWatch.sessionsSeen.get(bigSess.id) : null;
  const sessionsForBig = [...hubWatch.sessionsSeen].filter(([, s]) => s.path === BIG_REL);
  const rowsFinal = journalRows() ?? [];
  const perPath = new Map();
  for (const r of rowsFinal) {
    if (!perPath.has(r.path)) perPath.set(r.path, []);
    perPath.get(r.path).push(r);
  }
  const duplicateWrites = [...perPath]
    .filter(([, rs]) => rs.filter((r) => !r.deleted).length > 1)
    .map(([p, rs]) => ({ rel: p, rows: rs.map((r) => ({ seq: r.seq, source: r.source, sha256: r.sha256?.slice(0, 12) })) }));
  const pushedLines = (name) => {
    try {
      const text = readFileSync(join(P.logs, `${name}.log`), 'utf8');
      let up = 0;
      let down = 0;
      const passes = [];
      for (const m of text.matchAll(
        /\[sync\/files\] (\d+) down, (\d+) up, (\d+) conflict\(s\), (\d+) already in step/g
      )) {
        down += Number(m[1]);
        up += Number(m[2]);
        if (passes.length < 50)
          passes.push({ down: +m[1], up: +m[2], conflicts: +m[3], alreadyInStep: +m[4] });
      }
      const holds = [...text.matchAll(/cold start: ([a-z]+=hold[^\n]*)/g)].map((m) => m[0]).slice(0, 20);
      return { up, down, passes, coldStartHolds: holds };
    } catch {
      return null;
    }
  };
  // Per incarnation: which journal rows landed in its lifetime.
  const lifetimes = [];
  for (let i = 1; i <= incarnation.a; i++) {
    const me = seed[`a${i}`];
    const nextKill = kills.find((k) => k.incarnationKilled === i);
    lifetimes.push({ incarnation: i, name: me?.name, from: me?.spawnedAt ?? 0, to: nextKill ? nextKill.at : Number.POSITIVE_INFINITY });
  }
  const rowsIn = (lt) =>
    rowsFinal.filter((r) => r.at_ms - runStart >= lt.from && r.at_ms - runStart < lt.to && !r.deleted);
  const killReports = kills.map((k) => {
    const after = lifetimes.find((l) => l.incarnation === k.incarnationKilled + 1);
    const beforeLog = pushedLines(k.before);
    const afterLog = pushedLines(k.restartedAs);
    const landedAfter = after ? rowsIn(after) : [];
    const heldAtKill = new Set(rowsFinal.filter((r) => r.at_ms - runStart <= k.at).map((r) => r.path));
    const rewrittenHeld = landedAfter.filter((r) => heldAtKill.has(r.path)).map((r) => r.path);
    const wall = runStart + k.restartedSpawnedAt;
    const firstProgress = progressTrail.find((p) => (p.processStartedAt ?? 0) >= wall - 1000 && p.tracked > 0) ?? null;
    const lastBefore = [...progressTrail].reverse().find((p) => p.at <= k.at) ?? null;
    const firstPass = afterLog?.passes?.[0] ?? null;
    return {
      label: k.label,
      trigger: k.trigger,
      killedAt: k.at,
      killedIncarnation: k.before,
      restartedAs: k.restartedAs,
      restartMs: k.restartedHealthyAt - k.at,
      hubAtKill: { files: k.hubDeliveredFiles, of: planeB.length, bytes: k.hubDeliveredBytes, journalRows: k.journalRows },
      aProgressLastReportedBeforeKill: lastBefore,
      aProgressFirstReportedAfterRestart: firstProgress,
      largeSessionAtKill: k.largeSession,
      rowsLandedByRestartedIncarnation: landedAfter.length,
      pathsTheHubAlreadyHeldWrittenAgain: rewrittenHeld,
      restartedFirstPass: firstPass,
      restartedFirstPassNote: firstPass
        ? null
        : 'the restarted incarnation was itself killed before its first pass summary line printed',
      logsBeforeKill: beforeLog,
      // FROM ZERO = the restarted client sends again what the hub already
      // held. Judged from the hub's journal (a held path written again) and,
      // when printed, the restarted first pass (uploads beyond what was
      // missing, or fewer paths in step than the hub held).
      restartedFromZero:
        rewrittenHeld.length > 0 ||
        (firstPass
          ? firstPass.up > planeB.length - k.hubDeliveredFiles || firstPass.alreadyInStep < k.hubDeliveredFiles
          : false),
    };
  });
  report.seed = {
    aStartedAt: seed.a1.spawnedAt,
    aHealthyAt: seed.a1.healthyAt,
    hubFirstPlaneBFileAt: hubWatch.firstDelivered,
    kills: killReports,
    incarnations: lifetimes.map((l) => ({
      incarnation: l.incarnation,
      name: l.name,
      from: l.from,
      to: Number.isFinite(l.to) ? l.to : null,
      journalRowsLanded: rowsIn(l).length,
      bytesLanded: rowsIn(l).reduce((n, r) => n + (r.size ?? 0), 0),
      log: pushedLines(l.name),
    })),
    largeObjectSession: bigSess
      ? {
          path: BIG_REL,
          sessionId: bigSess.id,
          partsTotal: bigSess.parts,
          partsReceivedBeforeKill: preKillParts.length,
          sessionsCreatedForPath: sessionsForBig.length,
          sameSessionResumed: sessionsForBig.length === 1,
          partsRewrittenAfterRestart: hubWatch.partRewrites.filter((x) => x.session === bigSess.id).length,
          preKillPartsRewritten: hubWatch.partRewrites.filter(
            (x) => x.session === bigSess.id && preKillParts.includes(x.part)
          ),
          partsFirstSeenAfterRestart: [...hubWatch.partSeen]
            .filter(([k, v]) => k.startsWith(`${bigSess.id}:`) && v.aIncarnation > kill2.incarnationKilled)
            .length,
          completedAt: bigSeen?.completedAt ?? null,
          landedInJournal: rowsFinal.some((r) => r.path === BIG_REL && r.sha256 === planeBExpect.get(BIG_REL)?.sha256),
        }
      : null,
    otherSessions: [...hubWatch.sessionsSeen].map(([id, s]) => ({ id, ...s })),
    hubCompleteAt: hubWatch.completeAt,
    hubDelivered: { files: hubWatch.delivered, bytes: hubWatch.deliveredBytes, of: planeB.length },
    journal: { rows: rowsFinal.length, distinctPaths: perPath.size, duplicateWrites },
    deliveryOrderSample: {
      first10: hubWatch.order.slice(0, 10),
      last5: hubWatch.order.slice(-5),
      largeObjectsLast: bigRels.every((r) => {
        const i = hubWatch.order.findIndex((o) => o.rel === r);
        return i >= hubWatch.order.length - bigRels.length - 2 || i === -1;
      }),
    },
    aProgressTrail: progressTrail.filter((_, i) => i % 4 === 0).slice(0, 120),
  };
  for (const k of killReports) if (k.restartedFromZero) fail(`seed restarted from zero after SIGKILL (${k.label})`, k.pathsTheHubAlreadyHeldWrittenAgain.slice(0, 10));
  if (bigSess) {
    const ls = report.seed.largeObjectSession;
    if (!ls.sameSessionResumed) fail('large upload did not resume its session', ls);
    if (ls.preKillPartsRewritten.length) fail('parts received before the kill were re-sent', ls.preKillPartsRewritten.length);
    if (!ls.landedInJournal) fail('large object never landed on the hub');
  }
  if (duplicateWrites.length) fail('hub journal holds more than one write for a path', duplicateWrites.slice(0, 10));
  if (!hubWatch.completeAt) {
    const missingOnHub = planeB.filter(([r]) => !deliveredSet.has(r)).map(([r]) => r);
    fail('A never finished seeding every Plane-B file to the hub', { missing: missingOnHub.length, sample: missingOnHub.slice(0, 20) });
  }

  // ── edits: latency while media moved ─────────────────────────────────────
  const moving = (e) =>
    (e.media.aSeedRemainingBytes ?? 0) > 0 || (e.media.b?.remainingBytes ?? 0) > 0 || (e.media.c?.remainingBytes ?? 0) > 0;
  report.edits = {
    method: `rewrite ${PROBE_REL} on A's disk; poll the hub accepted head (bootstrap + blob) every 100 ms (latency resolution ≈ poll interval + one bootstrap round trip) and B/C disk every 50 ms; next edit 300 ms after the previous one settled or 60 s timeout`,
    count: edits.length,
    whileMediaMoving: edits.filter(moving).length,
    timedOut: edits.filter((e) => e.timedOut).length,
    interruptedByKill: edits.filter((e) => e.interruptedByKill).length,
    latencyMs: {
      hub: stats(edits.map((e) => e.hubMs)),
      hubWhileMediaMoving: stats(edits.filter(moving).map((e) => e.hubMs)),
      b: stats(edits.map((e) => e.peers.b)),
      c: stats(edits.map((e) => e.peers.c)),
      peersWhileMediaMoving: stats(edits.filter(moving).flatMap((e) => [e.peers.b, e.peers.c])),
    },
    samples: edits.map((e) => ({
      n: e.n,
      at: e.at,
      aIncarnation: e.aIncarnation,
      hubMs: e.hubMs,
      bMs: e.peers.b ?? null,
      cMs: e.peers.c ?? null,
      aSeedRemainingBytes: e.media.aSeedRemainingBytes,
      bRemainingBytes: e.media.b?.remainingBytes ?? null,
      cRemainingBytes: e.media.c?.remainingBytes ?? null,
      ...(e.timedOut ? { timedOut: true } : {}),
      ...(e.interruptedByKill ? { interruptedByKill: true } : {}),
    })),
  };
  if (report.edits.timedOut) fail('design edits starved or lost (no arrival within 60 s)', report.edits.timedOut);
  if (!report.edits.whileMediaMoving) fail('no edit was measured while media was still moving');

  // ── clean clients ─────────────────────────────────────────────────────────
  report.cleanClients = {};
  for (const [who, m] of [['b', joined[0]], ['c', joined[1]]]) {
    const rel0 = (x) => (x === null || x === undefined ? null : x - m.spawnedAt);
    report.cleanClients[who] = {
      spawnedAt: m.spawnedAt,
      msFromSpawn: {
        health: rel0(m.healthyAt),
        indexFirstCanvas: rel0(m.indexFirstCanvasAt),
        indexProbeCanvas: rel0(m.indexProbeAt),
        indexAllCanvases: rel0(m.indexAllCanvasesAt),
        diskFirstCanvas: rel0(m.diskFirstCanvasAt),
        diskProbeCanvas: rel0(m.diskProbeAt),
        diskAllCanvases: rel0(m.diskAllCanvasesAt),
        firstPlaneBFile: rel0(m.firstPlaneBFileAt),
        largeObjects: Object.fromEntries(Object.entries(m.largeObjects).map(([r, v]) => [r, rel0(v)])),
        planeBComplete: rel0(m.planeBCompleteAt),
        complete: rel0(m.completeAt),
      },
      downloadStagingPeakBytes: m.stagingPeakBytes ?? 0,
      indexListedCanvases: m.indexListed ?? 0,
      canvasesListedByA: aIndexed.length,
      canvasBodiesExpectedOnDisk: canvasSet.length,
      firstCanvasBeforeFullMedia: m.firstCanvasBeforeFullMedia,
      mediaBytesOutstandingAtFirstCanvas: m.mediaOutstandingAtFirstCanvas,
      progressSamples: m.progressSamples.filter((_, i) => i % 3 === 0).slice(0, 80),
      finalSyncState: (() => {
        const s = syncJson(P[who]);
        return s ? { state: s.state, docs: s.docs, files: { ...s.files, delivery: undefined } } : null;
      })(),
    };
    if (!m.completeAt) fail(`clean client ${who.toUpperCase()} did not complete within the timebox`);
    if (m.firstCanvasBeforeFullMedia === false)
      fail(`clean client ${who.toUpperCase()} showed no canvas until all media had arrived (T19)`);
  }

  // ── the oracle ────────────────────────────────────────────────────────────
  log('oracle: hashing every eligible file on A, B, C and the hub checkout');
  const invA = inventory(aDesign, { hash: true });
  const invB = inventory(designOf(P.b), { hash: true });
  const invC = inventory(designOf(P.c), { hash: true });
  const hubChk = inventory(designOf(P.hubRepo), { hash: true });
  const deliveryState = (root, r) => syncJson(root)?.files?.delivery?.[r] ?? null;
  // Mirrors apps/studio/sync/codec.ts META_LOCAL_KEYS — per-machine keys the
  // meta lane never carries (DDR-115: the camera lives in _canvas-state/).
  const META_LOCAL_KEYS = ['viewport', 'last_modified', 'syncable'];
  const sharedMeta = (abs) => {
    const o = JSON.parse(readFileSync(abs, 'utf8'));
    for (const k of META_LOCAL_KEYS) delete o[k];
    return o;
  };
  const canonical = (v) =>
    JSON.stringify(v, (_, x) =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
        : x
    );
  const canvasBodyFor = (r) => {
    // `<group>/<name>.meta.json|.css` → `<group>/<name>.tsx`; a flat
    // `<slug>.annotations.svg` → any canvas whose slug matches.
    if (r.endsWith('.meta.json')) return r.slice(0, -'.meta.json'.length) + '.tsx';
    if (r.endsWith('.css')) return r.slice(0, -'.css'.length) + '.tsx';
    if (r.endsWith('.annotations.svg')) {
      const slug = r.split('/').at(-1).slice(0, -'.annotations.svg'.length);
      const hit = [...invA.eligible.keys()].find(
        (x) => x.endsWith('.tsx') && x.slice(0, -4).replace(/\//g, '-').replace(/[^A-Za-z0-9_-]/g, '_').toLowerCase() === slug.toLowerCase()
      );
      return hit ?? null;
    }
    return null;
  };
  const explainMissing = (r, e) => {
    const abs = join(aDesign, r);
    if (r.endsWith('.meta.json')) {
      try {
        if (Object.keys(sharedMeta(abs)).length === 0)
          return 'meta holds no shared keys (empty or per-machine only) — nothing for the meta lane to materialise';
      } catch {
        return null;
      }
    }
    if (r.endsWith('.annotations.svg')) {
      const body = canvasBodyFor(r);
      const empty = /^<svg[^>]*>\s*<\/svg>\s*$/.test(readFileSync(abs, 'utf8').trim());
      if (!body) return `orphan annotation layer — no canvas on the sender owns it${empty ? ' (and it is an empty wrapper)' : ''}`;
      if (empty) return 'empty annotation wrapper for an existing canvas — no strokes to materialise';
    }
    return null;
  };
  const explainMismatch = (r, root) => {
    if (r.endsWith('.meta.json')) {
      try {
        if (canonical(sharedMeta(join(aDesign, r))) === canonical(sharedMeta(join(designOf(root), r))))
          return 'meta differs only in per-machine keys (viewport/last_modified/syncable — codec META_LOCAL_KEYS)';
      } catch {
        return null;
      }
    }
    return null;
  };
  const compare = (who, other, root) => {
    const missing = [];
    const mismatched = [];
    const extra = [];
    for (const [r, e] of invA.eligible) {
      const o = other.eligible.get(r);
      if (!o) {
        missing.push({
          rel: r,
          cls: e.cls,
          bytes: e.size,
          explained: explainMissing(r, e),
          receiverState: deliveryState(root, r),
          senderState: deliveryState(P.a, r),
        });
      } else if (o.sha256 !== e.sha256) {
        let semantic = null;
        if (r.endsWith('.json')) {
          try {
            semantic =
              JSON.stringify(JSON.parse(readFileSync(join(aDesign, r), 'utf8'))) ===
              JSON.stringify(JSON.parse(readFileSync(join(designOf(root), r), 'utf8')))
                ? 'json-equal (formatting only)'
                : 'json differs';
          } catch {
            semantic = 'unparseable';
          }
        }
        mismatched.push({ rel: r, cls: e.cls, aBytes: e.size, bytes: o.size, semantic, explained: explainMismatch(r, root) });
      }
    }
    for (const [r, o] of other.eligible) if (!invA.eligible.has(r)) extra.push({ rel: r, cls: o.cls, bytes: o.size });
    return {
      eligibleFiles: other.eligible.size,
      eligibleBytes: [...other.eligible.values()].reduce((n, e) => n + e.size, 0),
      matching: [...invA.eligible].filter(([r, e]) => other.eligible.get(r)?.sha256 === e.sha256).length,
      missing,
      mismatched,
      extra,
    };
  };
  const planeBOnly = (inv) => ({ eligible: new Map([...inv.eligible].filter(([, e]) => e.plane === 'B')) });
  const hubCmp = (() => {
    const aB = planeBOnly(invA).eligible;
    const missing = [...aB].filter(([r]) => !hubChk.eligible.has(r)).map(([r]) => r);
    const mismatched = [...aB].filter(([r, e]) => hubChk.eligible.has(r) && hubChk.eligible.get(r).sha256 !== e.sha256).map(([r]) => r);
    const extra = [...hubChk.eligible].filter(([r]) => !aB.has(r)).map(([r]) => r);
    return { planeBFiles: aB.size, hubFiles: hubChk.eligible.size, missing, mismatched, extra };
  })();
  const b = compare('b', invB, P.b);
  const c = compare('c', invC, P.c);
  const isExplained = (x) => !!x.explained || x.semantic === 'json-equal (formatting only)';
  const unexplainedList = [
    ...b.missing.filter((x) => !isExplained(x)).map((x) => ({ side: 'b', kind: 'missing', ...x })),
    ...b.extra.map((x) => ({ side: 'b', kind: 'extra', ...x })),
    ...b.mismatched.filter((x) => !isExplained(x)).map((x) => ({ side: 'b', kind: 'mismatch', ...x })),
    ...c.missing.filter((x) => !isExplained(x)).map((x) => ({ side: 'c', kind: 'missing', ...x })),
    ...c.extra.map((x) => ({ side: 'c', kind: 'extra', ...x })),
    ...c.mismatched.filter((x) => !isExplained(x)).map((x) => ({ side: 'c', kind: 'mismatch', ...x })),
    ...hubCmp.missing.map((x) => ({ side: 'hub', kind: 'missing', rel: x })),
    ...hubCmp.mismatched.map((x) => ({ side: 'hub', kind: 'mismatch', rel: x })),
  ];
  const unexplained = unexplainedList.length;
  const explainedCount = [...b.missing, ...b.mismatched, ...c.missing, ...c.mismatched].filter(isExplained).length;
  report.oracle = {
    method: 'SHA-256 of every eligible file (classifier: apps/hub/src/file-membership.mjs, the pinned mirror of apps/studio/sync/file-membership.ts) on A, B, C; Plane B also against the hub checkout',
    a: { eligibleFiles: invA.eligible.size, eligibleBytes: [...invA.eligible.values()].reduce((n, e) => n + e.size, 0) },
    b,
    c,
    hubCheckout: hubCmp,
    bcIdentical: [...invB.eligible].every(([r, e]) => invC.eligible.get(r)?.sha256 === e.sha256) && invB.eligible.size === invC.eligible.size,
    explainedDifferences: explainedCount,
    unexplainedDifferences: unexplained,
    unexplainedList: unexplainedList.slice(0, 200),
    planeBByteIdentical:
      [...invA.eligible].filter(([, e]) => e.plane === 'B').every(([r, e]) => invB.eligible.get(r)?.sha256 === e.sha256 && invC.eligible.get(r)?.sha256 === e.sha256),
  };
  if (unexplained) fail('final hash oracle found unexplained differences', unexplained);

  clearInterval(sessTimer);
  clearInterval(journalTimer);
  clearInterval(samplerRes);
  clearInterval(samplerDisk);
  await sampleDisk();

  // ── resources ─────────────────────────────────────────────────────────────
  const peakDisk = diskSamples.reduce((m, s) => (s.totalKiB > m.totalKiB ? s : m), { totalKiB: 0 });
  const perProc = {};
  for (const row of resourceSamples) {
    for (const [k, v] of Object.entries(row)) {
      if (k === 'at') continue;
      perProc[k] ??= { samples: 0, cpuMax: 0, cpuSum: 0, rssMaxMiB: 0 };
      perProc[k].samples += 1;
      perProc[k].cpuMax = Math.max(perProc[k].cpuMax, v.cpu);
      perProc[k].cpuSum += v.cpu;
      perProc[k].rssMaxMiB = Math.max(perProc[k].rssMaxMiB, v.rssMiB);
    }
  }
  for (const v of Object.values(perProc)) {
    v.cpuMean = Math.round((v.cpuSum / v.samples) * 10) / 10;
    delete v.cpuSum;
  }
  report.resources = {
    disk: {
      peakTotalBytes: peakDisk.totalKiB * 1024,
      peakAt: peakDisk.at ?? null,
      peakBreakdownBytes: Object.fromEntries(Object.entries(peakDisk.kib ?? {}).map(([k, v]) => [k, v * 1024])),
      final: diskSamples.at(-1),
      samples: diskSamples.length,
      note: 'du -sk of each scratch root (hub data incl. upload parts, hub checkout, A, B, C); sampled, so a sub-interval transient can be missed',
    },
    transient: {
      hubUploadPartsPeakBytes: hubWatch.partBytesPeak,
      cleanClientDownloadStagingPeakBytes: Object.fromEntries(
        Object.entries(report.cleanClients ?? {}).map(([k, v]) => [k, v.downloadStagingPeakBytes])
      ),
      note: 'hub parts sampled every 50 ms from <hub-data>/uploads; client staging (_state/downloads/*.part) every 1 s',
    },
    processes: perProc,
    processNote: 'ps pcpu (macOS decaying average, can exceed 100 on multi-core) and RSS summed over each process tree; sampled every 1 s',
  };

  report.durationMs = t();
  const distAfter = (await exec('git', ['-C', ROOT, 'status', '--short', 'apps/studio/dist/'])).stdout;
  report.hygiene = { distStatusBefore: distBefore.trim(), distStatusAfter: distAfter.trim() };
  if (distAfter.trim() !== distBefore.trim()) fail('apps/studio/dist changed during the run', distAfter);
}

let exitCode = 1;
try {
  await main();
} catch (err) {
  fail('runner error', String(err?.stack ?? err).slice(0, 2000));
} finally {
  for (const name of children.keys()) killGroup(name, 'SIGTERM');
  await sleep(1500);
  killAll();
  report.processes = Object.fromEntries(
    [...children].map(([k, v]) => [k, { startedAt: v.startedAt, exited: v.exited ?? 'killed at teardown' }])
  );
  if (PRIOR) {
    report.priorRuns = [];
    for (const file of PRIOR.split(',')) {
      if (!existsSync(file)) continue;
      try {
        const prior = JSON.parse(readFileSync(file, 'utf8'));
        report.priorRuns.push({
          scale: prior.scale,
          date: prior.date,
          commit: prior.environment?.commit,
          ok: prior.ok,
          failures: prior.failures,
          inventory: prior.inventory?.atStart && {
            raw: prior.inventory.atStart.raw,
            eligible: { files: prior.inventory.atStart.eligible.files, bytes: prior.inventory.atStart.eligible.bytes },
            excluded: { files: prior.inventory.atStart.excluded.files, bytes: prior.inventory.atStart.excluded.bytes },
          },
          seed: prior.seed && {
            kills: prior.seed.kills?.map((k) => ({
              label: k.label,
              trigger: k.trigger,
              hubAtKill: k.hubAtKill,
              restartedFirstPass: k.restartedFirstPass,
              pathsTheHubAlreadyHeldWrittenAgain: k.pathsTheHubAlreadyHeldWrittenAgain?.length,
              restartedFromZero: k.restartedFromZero,
            })) ?? (prior.seed.preKill ? [{ label: 'mid large-object upload', hubAtKill: { files: prior.seed.preKill.hubDeliveredFiles }, restartedFromZero: prior.seed.restart?.restartedFromZero, restartedFirstPass: prior.seed.restart?.filesPushedPerIncarnation?.afterRestart?.passes?.[0] ?? null }] : null),
            largeObjectSession: prior.seed.largeObjectSession,
            hubCompleteAt: prior.seed.hubCompleteAt,
            journalDuplicateWrites: prior.seed.journal?.duplicateWrites?.length,
          },
          edits: prior.edits && { count: prior.edits.count, whileMediaMoving: prior.edits.whileMediaMoving, latencyMs: prior.edits.latencyMs, timedOut: prior.edits.timedOut },
          cleanClients: prior.cleanClients && Object.fromEntries(Object.entries(prior.cleanClients).map(([k, v]) => [k, v.msFromSpawn])),
          oracle: prior.oracle && {
            explainedDifferences: prior.oracle.explainedDifferences,
            unexplainedDifferences: prior.oracle.unexplainedDifferences,
            planeBByteIdentical: prior.oracle.planeBByteIdentical,
            bcIdentical: prior.oracle.bcIdentical,
          },
          resources: prior.resources && { peakDiskBytes: prior.resources.disk?.peakTotalBytes, transient: prior.resources.transient, processes: prior.resources.processes },
          durationMs: prior.durationMs,
        });
      } catch {
        /* unreadable prior */
      }
    }
  }
  report.ok = report.failures.length === 0;
  exitCode = report.ok ? 0 : 1;
  // Keep logs next to the report; drop the big data.
  if (!KEEP) {
    for (const d of [P.a, P.b, P.c, P.hubRepo, P.hubData, P.homes]) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    report.cleanup = 'client, hub and synthetic data removed; logs kept under the work dir';
  }
  mkdirSync(dirname(OUT), { recursive: true });
  const text = JSON.stringify(report, null, 2).replaceAll(WORK, '<work>').replaceAll(ROOT, '<repo>');
  writeFileSync(OUT, `${text}\n`);
  process.stdout.write(`${text}\n`);
  log(`report → ${relative(ROOT, OUT).startsWith('..') ? OUT : relative(ROOT, OUT)} · ok=${report.ok}`);
}
process.exit(exitCode);
