#!/usr/bin/env node
// check-client-boots.mjs — assert the UI the packaged app ships actually renders.
//
// WHY THIS EXISTS
//
// v0.51.1 shipped a Maude.app that opened to a blank window. Not a crash — no
// panic, no crash log, no error anywhere. The shell booted, the sidecar started,
// the webview navigated, the WebSocket connected, and React mounted nothing.
//
// Two properties made it invisible to everything we already run:
//
//   1. It only happens when `window.__TAURI__` exists. Open the same server in
//      a browser and the UI is perfect — which is what every existing check,
//      every screenshot helper and every manual "is the studio fine" glance
//      does. The desktop shell is the only caller that sets that global, and it
//      is the one nobody automates.
//
//   2. It was in the MINIFIED bundle only. `tauri dev` serves the dev build and
//      is green; the dev build was green here too. And the committed
//      `dist/client.bundle.js` was green — the broken artifact was produced by
//      the release build at PACKAGE time. `MAUDE_SKIP_RUNTIME_BUILD=1` pins
//      `dist/runtime/*.js` to the committed copies and `check-runtime-bundles.sh`
//      guards their size, but `client.bundle.js` is regenerated on every build
//      and had no gate at all. Whatever the minifier emitted that day shipped.
//
// So this check does the one thing that would have caught it: boot the BUNDLED
// server against a throwaway project, load the page with a Tauri global present,
// and assert the UI mounted. It asserts an outcome, not a cause — a future
// blank-app with a completely different origin fails here too.
//
// Everything it drives is already inside the bundle: `maude-server` (the
// sidecar the app itself spawns, with the same env `sidecar.rs` passes it) and
// `agent-browser` (the Chromium the screenshot helpers already use). No new CI
// dependency, and no engine assumption — the fault reproduces identically in
// Chromium and WebKit, so the cheaper one is enough.
//
// V2-2.12: mounting is not enough — after mount the shared interaction probe
// (scripts/boot-gate/interaction-probe.mjs, the same steps the per-PR source gate runs) checks
// the shell ANSWERS: the File menu opens and closes, ⌘K opens and closes the palette, the tree
// is there. `--plant-dead` adds a fault that swallows all input after mount (the gate's red test).
//
// Usage:
//   node check-client-boots.mjs [<path-to-.app | resources-dir>] [--plant-dead]
//
// Exit 0 = the UI mounts and responds. Exit 1 = it does not (blank or dead app). Exit 2 = could
// not run the check (bad target, no server binary), so CI can tell "broken" from "ran wrong".

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEAD_SHELL, failedSteps, PROBE } from '../../../scripts/boot-gate/interaction-probe.mjs';

const RED = '\x1b[31m';
const GRN = '\x1b[32m';
const DIM = '\x1b[2m';
const RST = '\x1b[0m';

const SESSION = 'maude-client-boot-gate';
const PLANT_DEAD = process.argv.includes('--plant-dead');
/** How long to wait for the sidecar to write `_server.json`. Cold start on a
 *  loaded CI box is slower than on a laptop; this is generous on purpose. */
const SERVER_WAIT_MS = 45_000;
/** Time the client gets to mount after `load`. It has to fetch `/_config` and
 *  friends first, so this is not instant. */
const MOUNT_SETTLE_MS = 5_000;

function die(msg, code = 2) {
  console.error(`${RED}check-client-boots: ${msg}${RST}`);
  process.exit(code);
}

// --- Resolve the bundle -------------------------------------------------------
// Same shapes `check-bundle-completeness.mjs` accepts: a macOS `.app`, an
// unwrapped one, or a Tauri `resources/` staging dir. We need three anchors:
// the `maude-server` binary, `agent-browser`, and the staged `apps/studio`.
function resolveTarget(argPath) {
  const p = resolve(argPath);
  if (!existsSync(p)) return null;
  const asApp = (root) => ({
    macosDir: join(root, 'Contents', 'MacOS'),
    resources: join(root, 'Contents', 'Resources'),
  });
  if (p.endsWith('.app') || existsSync(join(p, 'Contents', 'MacOS'))) return asApp(p);
  // A staging `resources/` dir: the binaries are not beside it before packaging,
  // so fall back to the repo's own build outputs when they exist.
  if (existsSync(join(p, 'apps', 'studio'))) return { macosDir: null, resources: p };
  return null;
}

const arg = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '/Applications/Maude.app';
const target = resolveTarget(arg);
if (!target) {
  die(`target not found or unrecognized: ${arg}\nPass a built Maude.app or a resources/ dir.`);
}

const studio = join(target.resources, 'apps', 'studio');
if (!existsSync(join(studio, 'dist'))) {
  die(`no staged runtime at ${studio} — is this a packaged bundle?`);
}

function bundled(name) {
  if (!target.macosDir) return null;
  const p = join(target.macosDir, name);
  return existsSync(p) ? p : null;
}
const serverBin = bundled('maude-server');
const browserBin = bundled('agent-browser');
if (!serverBin) {
  die(
    'no bundled `maude-server` beside the target.\n' +
      'This check needs a PACKAGED bundle — run it against the built .app, not the staging dir.'
  );
}
if (!browserBin) die('no bundled `agent-browser` beside the target.');

console.log(`\n${'='.repeat(70)}\nMaude client-boot check — ${arg}\n${'='.repeat(70)}`);

// --- A throwaway project ------------------------------------------------------
// The server refuses to serve a directory without `.design/`, deliberately — so
// the smallest honest project is a config and nothing else. An EMPTY project is
// the right fixture anyway: the failure is in the shell's own boot, and a canvas
// would only add ways for this check to go red for unrelated reasons.
const work = mkdtempSync(join(tmpdir(), 'maude-boot-gate-'));
const projectRoot = join(work, 'project');
mkdirSync(join(projectRoot, '.design'), { recursive: true });
writeFileSync(join(projectRoot, '.design', 'config.json'), '{"project":"boot-gate"}\n');

const initScript = join(work, 'tauri-stub.js');
// The whole point of the check. Shapes match what `withGlobalTauri` exposes and
// what `client/github.js` reaches for; the commands REJECT rather than resolve
// so the client's error paths are exercised too — a UI that only mounts when
// every native call succeeds is not a UI that survives a real machine.
writeFileSync(
  initScript,
  `window.__TAURI__ = {
  core: { invoke: (cmd) => Promise.reject(new Error('client-boot-gate: ' + cmd)) },
  event: { listen: () => Promise.resolve(() => {}) },
  window: {}, path: {}, app: {},
};
${PLANT_DEAD ? DEAD_SHELL : ''}
`
);

let server = null;
function cleanup() {
  try {
    spawnSync(browserBin, ['close', '--all'], { stdio: 'ignore', timeout: 20_000 });
  } catch {
    /* the browser may already be gone */
  }
  try {
    server?.kill('SIGTERM');
  } catch {
    /* already dead */
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(2));

// --- Boot the bundled sidecar -------------------------------------------------
// The same env `sidecar.rs` passes. Without it the compiled server resolves its
// own artifacts against the bun virtual filesystem and exits (DDR-045/DDR-177),
// which is a real failure mode but not the one under test — so we reproduce the
// app's own launch rather than a bare invocation.
const serverLog = [];
server = spawn(serverBin, ['--root', projectRoot], {
  env: {
    ...process.env,
    MAUDE_DEV_SERVER_ROOT: studio,
    MAUDE_PKG_ROOT: target.resources,
    NO_OPEN: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

const serverJson = join(projectRoot, '.design', '_server.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let url = null;
for (let waited = 0; waited < SERVER_WAIT_MS && !url; waited += 400) {
  await sleep(400);
  if (server.exitCode !== null) break;
  if (!existsSync(serverJson)) continue;
  try {
    url = JSON.parse(readFileSync(serverJson, 'utf8')).url;
  } catch {
    /* mid-write — try again */
  }
}
if (!url) {
  console.error(`${DIM}${serverLog.join('').slice(-1200)}${RST}`);
  die('the bundled dev-server never came up — cannot judge whether the UI renders.');
}
console.log(`  sidecar up at ${url}`);

// --- Load it the way the shell does -------------------------------------------
function browser(args, timeout = 90_000) {
  return spawnSync(browserBin, ['--session', SESSION, ...args], {
    encoding: 'utf8',
    timeout,
  });
}

spawnSync(browserBin, ['close', '--all'], { stdio: 'ignore', timeout: 20_000 });
const opened = browser(['open', url, '--init-script', initScript]);
if (opened.status !== 0) {
  console.error(`${DIM}${(opened.stderr || opened.stdout || '').slice(0, 800)}${RST}`);
  die('agent-browser could not open the page.');
}
await sleep(MOUNT_SETTLE_MS);

const probe = browser(['eval', PROBE]);
const raw = (probe.stdout || '').trim();
let verdict = null;
try {
  // agent-browser prints the returned JSON string, sometimes quoted and escaped
  let text = raw;
  if (text.startsWith('"')) text = JSON.parse(text);
  verdict = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? text);
} catch {
  /* fall through to the failure below */
}

if (!verdict || typeof verdict.mounted !== 'boolean') {
  console.error(`${DIM}${raw.slice(0, 600)}${RST}`);
  die('could not read the page state back from agent-browser.');
}
const failed = failedSteps(verdict);

console.log(`\n${'='.repeat(70)}`);
if (!failed.length) {
  console.log(
    `${GRN}The packaged client mounts and responds with a Tauri global present.${RST} ` +
      `${DIM}(#root children: ${verdict.rootChildren}, ${verdict.text} chars of text; menu, ⌘K palette, tree all answer)${RST}`
  );
  process.exit(0);
}

// `errors --json` carries the thrown message AND its stack; the plain form
// prints a bare glyph, which tells a maintainer nothing at 3am.
let errors = '';
try {
  const payload = JSON.parse(browser(['errors', '--json']).stdout || '{}');
  errors = (payload?.data?.errors ?? []).map((e) => e.text ?? '').join('\n\n');
} catch {
  errors = browser(['errors']).stdout || '';
}
if (verdict.mounted) {
  console.error(`${RED}DEAD SHELL — the packaged UI mounts but does not respond${PLANT_DEAD ? ' (planted fault)' : ''}.${RST}

  Failed steps: ${failed.join(', ')}
  Verdict: ${JSON.stringify(verdict)}

  Page errors:
${DIM}${errors.trim().slice(0, 1500) || '  (none reported — check the console)'}${RST}
`);
  process.exit(1);
}
console.error(`${RED}BLANK APP — the packaged UI does not render.${RST}

  #root has ${verdict.rootChildren} children after ${MOUNT_SETTLE_MS} ms with window.__TAURI__ present.
  The same bundle very likely renders fine in a plain browser: this fault only
  appears in the desktop shell, which is exactly why it shipped once already.

  Page errors:
${DIM}${errors.trim().slice(0, 1500) || '  (none reported — check the console)'}${RST}

  First suspect: dist/client.bundle.js is REGENERATED at package time, so the
  artifact under test is not the one committed to git. Compare:
    ls -l ${join(studio, 'dist', 'client.bundle.js')}
    git cat-file -s HEAD:apps/studio/dist/client.bundle.js
  A minified-only fault (green in the dev build, green in the browser) is the
  shape v0.51.1 shipped — see .ai/logs/rca/ for that one.
`);
process.exit(1);
