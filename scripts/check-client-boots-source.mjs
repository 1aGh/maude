#!/usr/bin/env node
// check-client-boots-source.mjs — the PER-PR half of the v0.51.1 gate (T4).
//
// apps/desktop/scripts/check-client-boots.mjs boots the PACKAGED .app bundle
// and is the release gate — but it needs a full Tauri build, so it runs only in
// build-desktop.yml. v0.51.1 taught us the blank-app class has two triggers
// (window.__TAURI__ present + the minified release build), and NEITHER needs
// the native shell to reproduce: the same fault appears when the SOURCE server
// serves a freshly-built `--release` client bundle to a browser with a Tauri
// global injected. That is what this script does, so a client/** PR fails in
// minutes instead of at the next release.
//
// Prereqs (the client-boot workflow provides both):
//   - `bun install` done in apps/studio
//   - `MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` already run
//     (this script boots with MAUDE_NO_AUTOBUILD=1 and never builds)
//   - playwright chromium installed (playwright is an apps/studio devDep)
//
// V2-2.12: mounting is not enough — the shared interaction probe
// (scripts/boot-gate/interaction-probe.mjs) then checks the shell ANSWERS: the File menu
// opens and closes, ⌘K opens and closes the palette, the tree is there.
// `--plant-dead` injects a fault that swallows all input after mount (the gate's own red test).
//
// Exit 0 = the release client mounts AND responds with a Tauri global. Exit 1 = blank or dead
// app. Exit 2 = the harness itself could not run (server never up, browser missing).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEAD_SHELL, failedSteps, PROBE } from './boot-gate/interaction-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const STUDIO = join(REPO, 'apps', 'studio');

const SERVER_WAIT_MS = 45_000;
const PLANT_DEAD = process.argv.includes('--plant-dead');
const MOUNT_SETTLE_MS = 5_000;

function die(msg, code = 2) {
  console.error(`check-client-boots-source: ${msg}`);
  process.exit(code);
}

if (!existsSync(join(STUDIO, 'dist', 'client.bundle.js'))) {
  die(
    'no dist/client.bundle.js — run `MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` in apps/studio first.'
  );
}

// Playwright comes from apps/studio's own dependency tree (devDep) — resolve it
// from there, not from the root workspace.
const require = createRequire(join(STUDIO, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  die('playwright not installed in apps/studio — run `bun install` there first.');
}

// The smallest honest project: the server refuses to serve a directory without
// `.design/`, and an empty project keeps this red only for shell-boot faults.
const work = mkdtempSync(join(tmpdir(), 'maude-boot-gate-src-'));
const projectRoot = join(work, 'project');
mkdirSync(join(projectRoot, '.design'), { recursive: true });
writeFileSync(join(projectRoot, '.design', 'config.json'), '{"project":"boot-gate"}\n');

let server = null;
let browser = null;
async function cleanup() {
  try {
    await browser?.close();
  } catch {
    /* already gone */
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
process.on('exit', () => {
  /* async cleanup already awaited on the main path; this is the crash belt */
  try {
    server?.kill('SIGTERM');
  } catch {
    /* already dead */
  }
});

// Boot the SOURCE server exactly as `maude design serve` does in a dev tree —
// `bun server.ts`. MAUDE_NO_AUTOBUILD=1 (per CLAUDE.md) so the self-heal can
// never regenerate dev bundles over the release artifacts we are testing.
const serverLog = [];
server = spawn('bun', [join(STUDIO, 'server.ts'), '--root', projectRoot], {
  env: { ...process.env, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', MAUDE_SYNC_IN_CI: '1' },
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
  console.error(serverLog.join('').slice(-1200));
  await cleanup();
  die('the source dev-server never came up — cannot judge whether the UI renders.');
}
console.log(`  server up at ${url}`);

// Same stub as the packaged gate: commands REJECT rather than resolve, so a UI
// that only mounts when every native call succeeds fails here too.
const TAURI_STUB = `window.__TAURI__ = {
  core: { invoke: (cmd) => Promise.reject(new Error('client-boot-gate: ' + cmd)) },
  event: { listen: () => Promise.resolve(() => {}) },
  window: {}, path: {}, app: {},
};`;

try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.error(String(err).split('\n')[0]);
  await cleanup();
  die('chromium is not installed — run `bunx playwright install chromium` in apps/studio first.');
}
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(m.text());
});
await page.addInitScript(TAURI_STUB);
if (PLANT_DEAD) await page.addInitScript(DEAD_SHELL);
await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
await sleep(MOUNT_SETTLE_MS);

const verdict = JSON.parse(await page.evaluate(PROBE));
const failed = failedSteps(verdict);

if (!failed.length) {
  console.log(
    `OK — the release client mounts and responds with a Tauri global present ` +
      `(#root children: ${verdict.rootChildren}, ${verdict.text} chars of text; menu, ⌘K palette, tree all answer)`
  );
  await cleanup();
  process.exit(0);
}

if (verdict.mounted) {
  console.error(`DEAD SHELL — the release client mounts but does not respond${PLANT_DEAD ? ' (planted fault)' : ''}.

  Failed steps: ${failed.join(', ')}
  Verdict: ${JSON.stringify(verdict)}

  Page errors:
${pageErrors.map((e) => `    ${e}`).join('\n') || '    (none captured)'}
`);
  await cleanup();
  process.exit(1);
}

console.error(`BLANK APP — the release client does not render with window.__TAURI__ present.

  #root has ${verdict.rootChildren} children after ${MOUNT_SETTLE_MS} ms.
  The same bundle very likely renders fine in a plain browser — this fault only
  appears with a Tauri global, which is exactly why it shipped once already
  (v0.51.1).

  Page errors:
${pageErrors.map((e) => `    ${e}`).join('\n') || '    (none captured)'}
`);
await cleanup();
process.exit(1);
