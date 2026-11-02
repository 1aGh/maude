#!/usr/bin/env node
// check-real-drop.mjs — a REAL OS drag into the packaged app: an Assets tile and a Finder file onto a canvas.
//
// !!! THIS MOVES THE MOUSE for about 30 seconds. Run it only on an unlocked Mac nobody is using, with the
// !!! Accessibility grant for the app that runs it (Terminal / the Claude app). It puts the cursor back after.
// Not part of CI.
//
// WHY THIS EXISTS (r4 #2, the third round of "drag and drop does not work"): r1 and r3 were green on everything
// that does not drive the real thing — synthetic DragEvents (desktop e2e `edit-images`, `drop-photos`) and a
// WebKit drag in a PLAIN WKWebView (apps/studio/test/e2e/webkit-asset-drop.mjs), which hands the drag to the one
// view itself. The app is ONE window of stacked tab webviews, and AppKit picks a drag's destination among every
// view registered for dragged types WITHOUT skipping hidden ones. So with two projects open, a hidden tab that
// lies above the active one took every drag: an Assets tile's drag left the page and never came back, and a
// Finder drop landed in the OTHER project's page. Only a real OS drag into the real window shows that.
//
// What it does: two throwaway projects (A, then B, so B's webview lies above A's), back to A, a canvas with an
// empty frame on an artboard; then, with real CGEvent drags:
//   1. Edit — an Assets tile onto the empty frame   → the frame's `src` is the tile's picture (Drop.tsx)
//   2. Edit — a PNG from a Finder-like drag source onto the artboard → a new picture on the artboard (Drop.tsx)
//   3. Preview — an Assets tile onto the artboard    → an annotation image (ui-drop.annotations.json), Drop.tsx untouched
//   4. Preview — a Finder PNG onto the artboard      → an annotation image, Drop.tsx untouched
// It needs the debug E2E build (`pnpm test:e2e:desktop:build`, identifier com.maude.app.e2e): coordinates come
// from its WebDriver server; the drags themselves are the OS's. Isolated like the desktop e2e lanes (throwaway
// XDG_CONFIG_HOME / prefs / index, stub `claude`, NO_OPEN, no keychain), never ~/.config/maude.
//
//   node apps/desktop/scripts/check-real-drop.mjs <path/to/Maude.app> [--only edit|preview] [--keep]
// Exit 0 = every step green; 1 = a step failed (named); 2 = it could not run (locked screen, no build, …).

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const app = args.find((a) => !a.startsWith('--'));
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const keep = args.includes('--keep');
const PORT = 4471;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (code, msg) => {
  console.error(`check-real-drop: ${msg}`);
  process.exit(code);
};

if (!app || !existsSync(join(app, 'Contents/MacOS/maude-desktop')))
  die(2, 'usage: check-real-drop.mjs <Maude.app>');
if (process.platform !== 'darwin') die(2, 'macOS only');
const locked = execFileSync('ioreg', ['-n', 'Root', '-d1', '-a'])
  .toString()
  .includes('CGSSessionScreenIsLocked');
if (locked) die(2, 'the screen is locked — a locked screen freezes WebKit and eats the drag');

// ── a throwaway world ───────────────────────────────────────────────────────
// the real path: /var/folders is a link, and the app opens a project by its real path (open-once compares them)
const W = realpathSync(mkdtempSync(join(tmpdir(), 'maude-real-drop-')));
const xdg = join(W, 'maude-e2e-xdg');
mkdirSync(join(xdg, 'maude'), { recursive: true });
const BUNDLE = 'com.maude.app.e2e';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAG0lEQVR4nGNkYPj/n4EIwESMolGF1FNIrEIGAJ2iAg8ZvYpIAAAAAElFTkSuQmCC',
  'base64'
);
const CANVAS = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Drop() {
  return (
    <DesignCanvas>
      <DCArtboard id="drop" label="Drop here" width={900} height={600}>
        <div data-cd-id="wrap" style={{ padding: 24, display: "flex", gap: 24 }}>
          <img data-cd-id="slot" alt="" style={{ width: 300, height: 300, background: "#ddd" }} />
          <p data-cd-id="note">An empty frame on the left, open artboard on the right.</p>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const project = (name) => {
  const d = join(W, name, '.design');
  mkdirSync(join(d, 'ui'), { recursive: true });
  mkdirSync(join(d, 'assets'), { recursive: true });
  writeFileSync(
    join(d, 'config.json'),
    JSON.stringify({
      name,
      designRoot: '.design',
      formatVersion: 2,
      canvasGroups: [{ label: 'UI', path: 'ui' }],
    })
  );
  writeFileSync(join(d, 'ui/Drop.tsx'), CANVAS);
  writeFileSync(join(d, 'assets/pic.png'), PNG);
  return join(W, name);
};
const A = project('drop-a');
const B = project('drop-b');
const FINDER_PNG = join(W, 'from-finder.png');
writeFileSync(FINDER_PNG, Buffer.concat([PNG, Buffer.from([0])])); // other bytes than pic.png: its own asset
const DROP = join(A, '.design/ui/Drop.tsx');
const BOARD = join(A, '.design/ui-drop.annotations.json'); // the board lives at the design root, named by slug
const stub = join(W, 'bin/claude');
mkdirSync(dirname(stub), { recursive: true });
writeFileSync(
  stub,
  '#!/bin/sh\n[ "$1" = --version ] && echo "2.1.999 (stub)" && exit 0\nexit 1\n',
  { mode: 0o755 }
);

// the drag helper
const helper = join(W, 'real-drag');
execFileSync('swiftc', ['-O', join(HERE, 'real-drag.swift'), '-o', helper], { stdio: 'inherit' });

for (const t of [
  join(homedir(), 'Library/WebKit', BUNDLE, 'WebsiteDataStore'),
  join(homedir(), 'Library/Application Support', BUNDLE, 'app-state.json'),
  join(homedir(), 'Library/Application Support', BUNDLE, 'last-project.txt'),
]) {
  if (t.includes(BUNDLE)) rmSync(t, { recursive: true, force: true });
}

const env = {
  ...process.env,
  MAUDE_PROJECT_ROOT: A,
  NO_OPEN: '1',
  MAUDE_NO_AUTOBUILD: '1',
  MAUDE_E2E_NO_KEYCHAIN: '1',
  MAUDE_E2E_FAKE_KEYCHAIN: '1',
  MAUDE_E2E_CONFIRM_TEAM_SERVER: '1',
  MAUDE_E2E_NO_REVEAL: '1',
  MAUDE_E2E_ON_TOP: '1',
  MAUDE_E2E_LANE_STARTED: String(Date.now()),
  TAURI_WEBDRIVER_PORT: String(PORT),
  XDG_CONFIG_HOME: xdg,
  MAUDE_UI_PREFS_PATH: join(xdg, 'maude/prefs.json'),
  MAUDE_CLOUD_CONFIG: join(xdg, 'maude/cloud.json'),
  HUBS_CONFIG_PATH: join(xdg, 'maude/hubs.json'),
  MAUDE_MACHINE_FILE: join(homedir(), 'Library/Application Support', BUNDLE, 'machine.json'),
  MAUDE_INDEX_DIR: join(W, 'index'),
  MAUDE_E2E_RUN_DIR: join(W, 'run'),
  MAUDE_CLAUDE_BIN: stub,
  PATH: `${dirname(stub)}:${process.env.PATH}`,
};
const child = spawn(join(app, 'Contents/MacOS/maude-desktop'), [], {
  env,
  stdio: ['ignore', 'ignore', 'ignore'],
});
const stop = () => {
  try {
    child.kill('SIGTERM');
  } catch {}
};
process.on('exit', () => {
  stop();
  if (!keep) rmSync(W, { recursive: true, force: true });
});

// ── WebDriver (coordinates only) ────────────────────────────────────────────
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, path, body) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${path}: ${j.value.error} ${j.value.message ?? ''}`);
  return j.value;
};
let sid = null;
for (let i = 0; i < 120 && !sid; i++) {
  try {
    sid = (await call('POST', '/session', { capabilities: {} })).sessionId;
  } catch {
    await sleep(500);
  }
}
if (!sid)
  die(2, 'no WebDriver answer — is this the debug E2E build (pnpm test:e2e:desktop:build)?');
const projectTabs = async () =>
  (await call('GET', `/session/${sid}/window/handles`)).filter((h) => h.startsWith('p-'));
const js = async (label, script) => {
  await call('POST', `/session/${sid}/window`, { handle: label });
  return call('POST', `/session/${sid}/execute/sync`, { script, args: [] });
};
const until = async (what, fn, ms = 30_000) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) die(1, `timed out: ${what}`);
    await sleep(300);
  }
};

const tabA = await until('project A tab', async () => (await projectTabs())[0]);
await until('canvas list', () =>
  js(tabA, 'return !!document.querySelector("[data-testid=canvas-row-ui-drop]")')
);
// B opens AFTER A, so B's (hidden) webview lies above A's — the shape of any session with two projects open
// a tab's page has the Tauri global once its project page (not the splash) is loaded
const openRoot = (label, root) =>
  until(`open ${root}`, () =>
    js(
      label,
      `return window.__TAURI__?.core ? window.__TAURI__.core.invoke('e2e_open_root', { root: ${JSON.stringify(root)} }).then(() => 1) : 0`
    )
  );
await openRoot(tabA, B);
const tabB = await until('project B tab', async () =>
  (await projectTabs()).find((h) => h !== tabA)
);
await openRoot(tabB, A);
await until('A is the active tab', () => js(tabA, 'return document.visibilityState === "visible"'));
await js(tabA, 'document.querySelector("[data-testid=canvas-row-ui-drop]").click(); return 1');
await until('canvas frame', () =>
  js(tabA, 'return !!document.querySelector("[data-testid=canvas-frame]")')
);
await sleep(3000); // the canvas renders and fits
await js(tabA, 'document.querySelector("[data-testid=panel-tab-assets]").click(); return 1');
await until('Assets tile', () =>
  js(
    tabA,
    'const t=document.querySelector("[data-testid=assets-tile][data-asset=\\"assets/pic.png\\"]"); return !!t && t.getBoundingClientRect().width > 0'
  )
);

// client → screen: the shell window's top-left + the tab's offset below the strip (window height − viewport height)
const pid = child.pid;
const [wx, wy, , wh] = execFileSync(helper, ['window', String(pid)])
  .toString()
  .trim()
  .split(' ')
  .map(Number);
const ih = await js(tabA, 'return innerHeight');
const toScreen = ([x, y]) => [Math.round(wx + x), Math.round(wy + (wh - ih) + y)];
const tileAt = async () =>
  toScreen(
    await js(
      tabA,
      'const r=document.querySelector("[data-testid=assets-tile][data-asset=\\"assets/pic.png\\"]").getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]'
    )
  );
// where the artboard and its empty frame are: the canvas reports its own artboard rect (frame coordinates) to the
// shell's selection chrome; simplest and engine-free is the fixture's fixed fit — the 900×600 artboard, fitted.
const frameRect = await js(
  tabA,
  'const r=document.querySelector("[data-testid=canvas-frame]").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]'
);
const fit = (fx, fy) => [frameRect[0] + frameRect[2] * fx, frameRect[1] + frameRect[3] * fy];
// the artboard is centred in the frame at ~70 % of its width: the empty frame sits in its top-left third,
// open artboard in its lower right
const SLOT = toScreen(fit(0.37, 0.38));
const OPEN = toScreen(fit(0.77, 0.8));

const mouse = (...a) =>
  execFileSync(helper, a, { env: { ...process.env, FROM_X: String(Math.max(20, wx - 45)) } });
const front = () =>
  js(tabA, 'return document.visibilityState === "visible" && document.hasFocus()');
const results = [];
const step = async (name, run, check) => {
  if (!(await front())) await sleep(800);
  const before = {
    drop: readFileSync(DROP, 'utf8'),
    board: existsSync(BOARD) ? readFileSync(BOARD, 'utf8') : '',
  };
  await run();
  let ok = false;
  const end = Date.now() + 6000;
  while (!ok && Date.now() < end) {
    await sleep(400);
    const now = {
      drop: readFileSync(DROP, 'utf8'),
      board: existsSync(BOARD) ? readFileSync(BOARD, 'utf8') : '',
    };
    ok = check(before, now);
  }
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  return ok;
};
const images = (s) => (s.match(/<img\b/g) || []).length;
const boardImages = (s) => (s.match(/"type"\s*:\s*"image"/g) || []).length;

if (only !== 'preview') {
  await step(
    'Edit · Assets tile → empty frame fills it',
    async () => mouse('drag', ...(await tileAt()), ...SLOT),
    (_b, n) =>
      /src="assets\/pic\.png"[^>]*data-cd-id="slot"|data-cd-id="slot"[^>]*src="assets\/pic\.png"/.test(
        n.drop
      )
  );
  await step(
    'Edit · Finder PNG → artboard places a picture',
    async () => mouse('file', FINDER_PNG, ...OPEN),
    (b, n) => images(n.drop) > images(b.drop)
  );
}
if (only !== 'edit') {
  await js(tabA, 'document.querySelector("[data-testid=palette-mode-preview]").click(); return 1');
  await sleep(800);
  // Preview folds the panels: open the left one again to reach the Assets tile
  await js(
    tabA,
    'if (!document.querySelector("[data-testid=assets-tile]")?.getBoundingClientRect().width) document.querySelector("[data-testid=panel-icon-left]")?.closest("button")?.click(); return 1'
  );
  await until('Assets tile in Preview', () =>
    js(
      tabA,
      'const t=document.querySelector("[data-testid=assets-tile][data-asset=\\"assets/pic.png\\"]"); return !!t && t.getBoundingClientRect().width > 0'
    )
  );
  await step(
    'Preview · Assets tile → artboard adds an annotation, the design untouched',
    async () => mouse('drag', ...(await tileAt()), ...OPEN),
    (b, n) => boardImages(n.board) > boardImages(b.board) && n.drop === b.drop
  );
  await step(
    'Preview · Finder PNG → artboard adds an annotation, the design untouched',
    async () => mouse('file', FINDER_PNG, ...OPEN),
    (b, n) => boardImages(n.board) > boardImages(b.board) && n.drop === b.drop
  );
}

stop();
const failed = results.filter(([, ok]) => !ok);
if (keep) console.log(`kept: ${W}`);
if (failed.length) die(1, `${failed.length} of ${results.length} failed`);
console.log(`check-real-drop: ${results.length} of ${results.length} green`);
