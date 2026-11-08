#!/usr/bin/env node
// webkit-asset-drop.mjs — r3 guard: an Assets tile dragged onto the canvas, with a REAL WebKit drag (macOS only).
//
//   node apps/studio/test/e2e/webkit-asset-drop.mjs [--build] [--keep] [--only artboard,frame,finder,elsewhere]
//
// Michal (rc.1, after r1-10 "fixed" it): "porad mi nejde delat drag and drop z assets do canvasu nebo artboardu". Every
// earlier check dispatched a synthetic DataTransfer or ran Chromium; neither has the rule that broke it: WebKit gives a
// drag a page started NO event in a frame of another origin (the canvas, DDR-054). This boots the studio on a copy of
// the desktop e2e fixture (origin split on, as in the app), opens the page in a WKWebView — the app's engine — and drags
// with webkit-drag-probe.swift (WebKit's own drag source + destination code, no synthetic events, no cursor moved).
//
// Scenarios, each asserted on the canvas FILE on disk:
//   artboard   a tile dropped on a bare artboard → the picture is placed in it (loose)
//   frame      a tile dropped on a frame → the frame takes the picture (fill)
//   finder     a file dragged in from outside the page (as from Finder) → imported to Assets and placed (no regression)
//   elsewhere  a tile let go over the left panel → nothing placed, the catcher gone
//
// --build rebuilds the shell bundle from source first (dist/ is the release artifact: run this through
// scripts/v2-test-lane.sh, which reverts dist/ afterwards). Exit 0 all pass · 1 a scenario failed · 2 harness.

import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, '../..');
const repo = resolve(studio, '../..');
const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const onlyArg = argv[argv.indexOf('--only') + 1];
const only = argv.includes('--only') && onlyArg ? new Set(onlyArg.split(',')) : null;

if (process.platform !== 'darwin') {
  console.log('SKIP: a real WebKit drag needs macOS (WKWebView).');
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), 'maude-webkit-drop-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (argv.includes('--build')) {
  console.log('building the shell bundle from source…');
  execFileSync('bun', ['run', 'build.ts'], {
    cwd: studio,
    stdio: 'inherit',
    env: { ...process.env, MAUDE_SKIP_RUNTIME_BUILD: '1' },
  });
}

const probe = join(scratch, 'webkit-drag-probe');
execFileSync('swiftc', ['-O', join(here, 'webkit-drag-probe.swift'), '-o', probe], {
  stdio: ['ignore', 'ignore', 'inherit'],
});

const BARE = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="Drop here" width={480} height={320}>
        <p data-cd-id="note" style={{ margin: 0, padding: 24 }}>A bare artboard.</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const FRAMED = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="Drop here" width={480} height={320}>
        <div data-cd-id="slot" style={{ width: 480, height: 320, background: "#ddd" }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

// Shell-side page script: open the canvas, then the Assets tab; note whether the catcher ever showed.
const SETUP = `
  window.__probeLog = [];
  const q = (s) => document.querySelector(s);
  const wait = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
  new MutationObserver(() => {
    const on = !!q('[data-testid="canvas-asset-drop-catcher"]');
    const last = window.__probeLog.at(-1);
    if ((on ? 'catcher-on' : 'catcher-off') !== last && (on || last === 'catcher-on')) window.__probeLog.push(on ? 'catcher-on' : 'catcher-off');
  }).observe(document.body, { subtree: true, childList: true });
  // a row drawn before the tree is live can swallow the first click: click until the canvas starts opening. A click
  // that DID take leaves 'idle' within a beat, but on a loaded machine that beat is seconds, and a second click while
  // the first is opening restarts it - so a retry waits a long interval before it concludes the click was lost.
  for (let i = 0; i < 6 && (q('main.viewport')?.dataset.canvasState ?? 'idle') === 'idle'; i++) {
    (await wait(() => q('[data-testid="canvas-row-ui-smoke"]')))?.click();
    await wait(() => q('main.viewport')?.dataset.canvasState !== 'idle', 6000);
  }
  await wait(() => q('main.viewport')?.dataset.canvasState === 'ready' && !q('[data-testid="canvas-loading"]'));
  // the same for the Assets tab: a tab drawn while the panel re-renders can swallow the click; the tile is the proof
  for (let i = 0; i < 6 && !q('[data-testid="assets-tile"]'); i++) {
    (await wait(() => q('[data-testid="panel-tab-assets"]')))?.click();
    await wait(() => q('[data-testid="assets-tile"]'), 4000);
  }
`;
const READY = `(() => {
  const f = document.querySelector('[data-testid="canvas-frame"]');
  const tile = document.querySelector('[data-testid="assets-tile"][data-asset="assets/pic.png"]');
  return !!f && !!tile && document.querySelector('main.viewport')?.dataset.canvasState === 'ready'
    && !document.querySelector('[data-testid="canvas-loading"]')
    && new URL(f.src, location.href).origin !== location.origin;
})()`;
const LOG = `JSON.stringify({ log: window.__probeLog || [], state: document.querySelector('main.viewport')?.dataset.canvasState, loading: !!document.querySelector('[data-testid="canvas-loading"]'), error: document.querySelector('[data-testid="canvas-load-error"]')?.innerText?.slice(0, 200), tile: !!document.querySelector('[data-testid="assets-tile"]'), row: !!document.querySelector('[data-testid="canvas-row-ui-smoke"]'), text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300) })`;
const TILE = `const r = document.querySelector('[data-testid="assets-tile"][data-asset="assets/pic.png"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`;
const FRAME_CENTRE = `const r = document.querySelector('[data-testid="canvas-frame"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`;
const LEFT_PANEL = `const r = document.querySelector('[data-testid="assets-panel"]').getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 40];`;

async function scenario(
  name,
  { canvas, mode = 'page', from = TILE, to = FRAME_CENTRE, file, expect, unchanged = false }
) {
  const project = join(scratch, name);
  cpSync(join(repo, 'apps/desktop/e2e/fixtures/project'), project, { recursive: true });
  for (const p of ['.design/_state', '.design/_sync.json'])
    rmSync(join(project, p), { recursive: true, force: true });
  const cfgPath = join(project, '.design/config.json');
  // an unlinked copy: never the live hub (memory: unlink cloned projects before boot)
  const { linkedHub: _hub, ...cfg } = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const smoke = join(project, '.design/ui/Smoke.tsx');
  writeFileSync(smoke, canvas);
  writeFileSync(join(project, '.design/ui/Smoke.meta.json'), '{}\n');
  const assetsBefore = readdirSync(join(project, '.design/assets')).sort();

  const home = join(scratch, `${name}-home`);
  const stubBin = join(scratch, 'stub-bin');
  mkdirSync(join(home, '.config', 'maude'), { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  writeFileSync(join(stubBin, 'claude'), '#!/bin/sh\necho \'{"loggedIn":false}\'\n', {
    mode: 0o755,
  });
  const port = 4900 + Math.floor(Math.random() * 400);
  const server = spawn(
    'bun',
    ['run', join(studio, 'server.ts'), '--root', project, '--port', String(port)],
    {
      env: {
        ...process.env,
        NO_OPEN: '1',
        MAUDE_NO_AUTOBUILD: '1',
        MAUDE_MACHINE_FILE: join(scratch, `${name}-machine.json`),
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        MAUDE_UI_PREFS_PATH: join(home, '.config', 'maude', 'prefs.json'),
        MAUDE_INDEX_DIR: join(home, 'index'),
        MAUDE_CLOUD_CONFIG: join(home, '.config', 'maude', 'cloud.json'),
        HUBS_CONFIG_PATH: join(home, '.config', 'maude', 'hubs.json'),
        MAUDE_CLAUDE_BIN: '',
        PATH: `${stubBin}:${process.env.PATH}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  try {
    const serverJson = join(project, '.design/_server.json');
    const t0 = Date.now();
    while (!existsSync(serverJson) && Date.now() - t0 < 30000) await sleep(200);
    if (!existsSync(serverJson)) throw new Error(`server did not boot:\n${serverLog.slice(-2000)}`);
    const { url } = JSON.parse(readFileSync(serverJson, 'utf8'));
    const before = readFileSync(smoke, 'utf8');
    const out = await new Promise((res) => {
      const p = spawn(probe, [], {
        env: {
          ...process.env,
          PROBE_URL: url,
          PROBE_SETUP_JS: SETUP,
          PROBE_READY_JS: READY,
          PROBE_FROM_JS: from,
          PROBE_TO_JS: to,
          PROBE_MODE: mode,
          PROBE_LOG_JS: LOG,
          ...(file ? { PROBE_FILE: file } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let o = '';
      p.stdout.on('data', (d) => (o += d));
      p.stderr.on('data', (d) => (o += d));
      p.on('exit', (code) => res({ code, o }));
    });
    const line = out.o.split('\n').find((l) => l.startsWith('RESULT ')) ?? '';
    const result = line
      ? JSON.parse(line.slice(7))
      : { stage: 'no-result', raw: out.o.slice(-800) };
    if (out.code !== 0)
      return { name, ok: false, harness: true, why: `probe exit ${out.code}`, result };
    // the write lands through the server; give it a moment
    let after = before;
    const t1 = Date.now();
    while (Date.now() - t1 < (unchanged ? 3000 : 10000)) {
      after = readFileSync(smoke, 'utf8');
      if (after !== before && !unchanged) break;
      await sleep(250);
    }
    const assetsAfter = readdirSync(join(project, '.design/assets')).sort();
    const verdict = expect({ before, after, assetsBefore, assetsAfter, result });
    return { name, ok: verdict === true, why: verdict === true ? '' : verdict, result };
  } finally {
    server.kill('SIGTERM');
    await sleep(300);
  }
}

const SCENARIOS = {
  artboard: {
    canvas: BARE,
    expect: ({ before, after }) =>
      after !== before && /pic\.png/.test(after) && !/pic\.png/.test(before)
        ? true
        : 'the canvas file did not gain the picture',
  },
  frame: {
    canvas: FRAMED,
    expect: ({ before, after }) => {
      if (after === before) return 'the canvas file did not change';
      const slot = after.indexOf('data-cd-id="slot"');
      return slot >= 0 && /pic\.png/.test(after) ? true : 'the frame did not take the picture';
    },
  },
  finder: {
    canvas: BARE,
    mode: 'file',
    file: join(repo, 'apps/desktop/e2e/fixtures/project/.design/assets/pic.png'),
    expect: ({ before, after, assetsBefore, assetsAfter }) =>
      after !== before && assetsAfter.length > assetsBefore.length
        ? true
        : `a file dropped from outside was not imported and placed (assets ${assetsBefore.length}→${assetsAfter.length}, file ${after === before ? 'unchanged' : 'changed'})`,
  },
  elsewhere: {
    canvas: BARE,
    to: LEFT_PANEL,
    unchanged: true,
    expect: ({ before, after, result }) => {
      if (after !== before) return 'a tile let go over the left panel changed the canvas';
      const log = JSON.parse(result.log || '{}').log ?? [];
      return log.at(-1) === 'catcher-on' ? 'the catcher stayed after the drag ended' : true;
    },
  },
};

let code = 0;
try {
  for (const [name, spec] of Object.entries(SCENARIOS)) {
    if (only && !only.has(name)) continue;
    const r = await scenario(name, spec);
    const tag = r.ok ? 'PASS' : r.harness ? 'HARNESS' : 'FAIL';
    console.log(`${tag} ${name}${r.why ? ` — ${r.why}` : ''}`);
    if (!r.ok) console.log(`  probe: ${JSON.stringify(r.result)}`);
    if (!r.ok) code = Math.max(code, r.harness ? 2 : 1);
  }
} catch (err) {
  console.error(`HARNESS: ${err?.stack ?? err}`);
  code = 2;
} finally {
  if (!keep) rmSync(scratch, { recursive: true, force: true });
  else console.log(`kept ${scratch}`);
}
process.exit(code);
