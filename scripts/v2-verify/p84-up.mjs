#!/usr/bin/env node
// V2-8.4 rig: the three shells of the cross-shell scenarios, all local and throwaway.
//
//   browser  — a plain studio server on a COPY of the cell's seeded project (loopback)
//   cell     — a LOCAL cell (scripts/dev/local-cell.mjs: hub in workspace mode + its studio child)
//              reached at http://studio.cell.localhost:<port>, signed in as the seeded owner
//   viewer   — the same cell, a session token minted into the cell's own token store with the
//              `viewer` project role (Can comment), the way the studio door mints one
//
// Nothing here touches ~/.config/maude, the keychain, a real hub or any production service:
// HOME / XDG_CONFIG_HOME are throwaway, a stub `claude` is first on PATH, every server is
// NO_OPEN=1 MAUDE_NO_AUTOBUILD=1. The hub needs Node 24 on PATH (better-sqlite3 ABI 137).
//
//   node scripts/v2-verify/p84-up.mjs <run-dir> [--cell-port 4799] [--browser-port 4398]
//
// Stays in the foreground (it supervises both children); SIGTERM tears everything down.
// When it is ready it writes <run-dir>/rig.json.

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seedScenarioCanvas } from './p84-fixture.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { stubClaudeEnv } = await import(
  pathToFileURL(join(REPO, 'scripts/lib/stub-claude.mjs')).href
);

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : d;
};
const RUN = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: p84-up.mjs <run-dir>');
  process.exit(2);
}
const CELL_PORT = Number(arg('cell-port', '4799'));
const BROWSER_PORT = Number(arg('browser-port', '4398'));

rmSync(RUN, { recursive: true, force: true });
mkdirSync(RUN, { recursive: true });
const HOME = join(RUN, 'home');
mkdirSync(join(HOME, '.config'), { recursive: true });
const baseEnv = {
  ...process.env,
  HOME,
  XDG_CONFIG_HOME: join(HOME, '.config'),
  MAUDE_INDEX_DIR: join(HOME, 'index'), // P8: never the person's ~/.maude/index (Home lists every project indexed there)
  NO_OPEN: '1',
  // p8-orphan-sidecars — the server ends by itself if this script is SIGKILLed
  MAUDE_EXIT_WITH_PARENT: '1',
  MAUDE_NO_AUTOBUILD: '1',
  ...stubClaudeEnv(HOME),
};

const kids = [];
const spawnLogged = (name, cmd, args, env, cwd = REPO) => {
  const log = [];
  const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const sink = (d) => {
    log.push(String(d));
    if (log.length > 400) log.shift();
    writeFileSync(join(RUN, `${name}.log`), log.join(''));
  };
  p.stdout.on('data', sink);
  p.stderr.on('data', sink);
  kids.push(p);
  return p;
};

const waitUp = async (url, ms = 90_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`never came up: ${url}`);
};

// 1. the local cell
const cellDir = join(RUN, 'cell');
spawnLogged(
  'cell',
  process.execPath,
  [
    join(REPO, 'scripts/dev/local-cell.mjs'),
    '--dir',
    cellDir,
    '--port',
    String(CELL_PORT),
    '--no-peer',
    '--keep',
  ],
  { ...baseEnv, PATH: `${dirname(process.execPath)}:${baseEnv.PATH}` }
);
await waitUp(`http://127.0.0.1:${CELL_PORT}/health`);

// 2. the browser project = a copy of the cell's seeded project (no git, no runtime state)
const browserRoot = join(RUN, 'browser');
mkdirSync(browserRoot, { recursive: true });
cpSync(join(cellDir, 'repo', '.design'), join(browserRoot, '.design'), {
  recursive: true,
  // no per-machine runtime state (`_state`, `_sync.json`, …) rides along: the browser project is its own
  filter: (src) => !/[\\/]_[^\\/]*/.test(src.slice(join(cellDir, 'repo', '.design').length)),
});
// the scenario canvas, in BOTH projects (the cell's checkout is the hub's: its studio child reads it from disk)
seedScenarioCanvas(browserRoot);
seedScenarioCanvas(join(cellDir, 'repo'));
spawnLogged(
  'browser',
  'bun',
  [
    'run',
    join(REPO, 'apps/studio/server.ts'),
    '--root',
    browserRoot,
    '--port',
    String(BROWSER_PORT),
  ],
  { ...baseEnv, MAUDE_MACHINE_FILE: join(browserRoot, '.design', '_state', 'machine.json') }
);
await waitUp(`http://localhost:${BROWSER_PORT}/`);

// 3. the viewer session, minted into the cell's own token store
const { addToken } = await import(pathToFileURL(join(REPO, 'apps/hub/src/tokens.mjs')).href);
const sessions = {};
for (const [name, role] of [
  ['viewer', 'viewer'],
  ['observer', 'observer'],
]) {
  sessions[name] = addToken(join(cellDir, 'data'), {
    label: `studio-p84-${name}`,
    owner: `${name}@local.test`,
    role,
    scope: '*',
    expiresAt: Date.now() + 6 * 3600_000,
  }).value;
}

// 4. the cell's project saves with accepted revisions — what a Maude 2 cloud project is. Since p8-v1-drop a
// project that still saves the old way is VIEW ONLY for everyone (formatGate source 'save-mode', decision
// maude/v2-p8-v1-drop-save-mode-is-a-format-gate), and a cloud tab never switches it itself (the owner's
// dashboard does: maude/v2-p8-update-to-accepted-cell-points-to-dashboard). A fresh production cell starts
// in accepted revisions (cell-config MAUDE_NEW_PROJECT_MODE), but only while it has no canvas — and
// local-cell seeds one before the hub boots. So the rig does what the dashboard's Saving page does: the
// owner's switch (`POST /api/projects/current/v1/mode`), once the hub holds both seeded canvases, then
// waits until the cell's studio reports `saveMode: accepted`.
// P84_KEEP_LEGACY=1 skips the switch: the cell stays in the old save mode, so the view-only banner an owner
// and a viewer read (p8-cell-copy) can be driven. The scenarios are not meant to pass in that state.
if (!process.env.P84_KEEP_LEGACY) {
  const admin = addToken(join(cellDir, 'data'), {
    label: 'p84-owner-switch',
    scope: '*',
    expiresAt: Date.now() + 3600_000,
  }).value;
  const hub = `http://127.0.0.1:${CELL_PORT}`;
  const auth = { authorization: `Bearer ${admin}` };
  const stored = async () => {
    const r = await fetch(`${hub}/api/documents`, { headers: auth }).catch(() => null);
    const docs = (await r?.json().catch(() => null))?.documents ?? [];
    const has = (n) => docs.some((d) => new RegExp(`(^|/)${n}$`).test(d.name) && d.bytes > 0);
    return has('ui-home') && has('ui-board');
  };
  for (let t = Date.now(); !(await stored()); ) {
    if (Date.now() - t > 60_000) throw new Error('the cell hub never stored ui-home + ui-board');
    await new Promise((r) => setTimeout(r, 300));
  }
  const res = await fetch(`${hub}/api/projects/current/v1/mode`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'transactions' }),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200)
    throw new Error(
      `switching the cell to accepted revisions failed: ${res.status} ${JSON.stringify(body)}`
    );
  console.log(`[p84-up] the cell saves with accepted revisions (epoch ${body?.epoch})`);
  const cookie = { cookie: `maude_studio=${sessions.viewer}` };
  let mode = null;
  for (let t = Date.now(); mode !== 'accepted'; ) {
    if (Date.now() - t > 60_000)
      throw new Error(`the cell's studio still reports saveMode ${mode} after the switch`);
    await new Promise((r) => setTimeout(r, 300));
    const r = await fetch(`http://studio.cell.localhost:${CELL_PORT}/_config`, {
      headers: cookie,
    }).catch(() => null);
    mode = (await r?.json().catch(() => null))?.saveMode ?? null;
  }
}

writeFileSync(
  join(RUN, 'rig.json'),
  `${JSON.stringify(
    {
      run: RUN,
      browser: `http://localhost:${BROWSER_PORT}`,
      browserRoot,
      cell: `http://studio.cell.localhost:${CELL_PORT}`,
      cellHub: `http://127.0.0.1:${CELL_PORT}`,
      cellRepo: join(cellDir, 'repo'),
      owner: { email: 'you@local.test', password: 'local-cell-password' },
      sessions,
      cookie: 'maude_studio',
    },
    null,
    2
  )}\n`
);
console.log(`[p84-up] ready: ${join(RUN, 'rig.json')}`);

const bye = () => {
  for (const k of kids) k.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2500);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
await new Promise(() => {});
