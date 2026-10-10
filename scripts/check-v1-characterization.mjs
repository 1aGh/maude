#!/usr/bin/env node
// check-v1-characterization.mjs — Maude v2 plan V2-0.1 (hardening backlog T6).
//
// Pins today's (v1) studio UI before `client/app.jsx` is split into modules (V2-0.2) and
// before the v2 reshell moves anything. It boots the SOURCE dev-server against a fixed
// fixture project, drives every region that will move — menubar menus, status bar, sidebar
// tree, viewport states, ⌘K palette, export dialog, inspector, comments panel, banners,
// help/shortcuts, settings — in four shells (desktop browser, Tauri stub, viewer, cloud),
// and writes a normalized structural snapshot of each state:
//
//   apps/studio/test/characterization/v1/<state>.txt   (committed golden)
//
// A move-only refactor must leave every snapshot byte-identical. Any diff is a behaviour
// change and fails the check with a unified diff of the first differing lines.
//
// Usage (from the repo root):
//   node scripts/check-v1-characterization.mjs [--update] [--only <state-prefix>]
//                                              [--build] [--shots <dir>] [--repeat]
//     --update   (re)write the golden snapshots instead of comparing
//     --only     comma-separated state-name prefixes (e.g. browser/menu-,viewer/)
//     --build    build the release client from the CURRENT source first
//                (MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release), and restore the
//                committed dist/ afterwards — so the check tests the source, not the commit
//     --shots    also save PNG screenshots of the main screens to <dir>; when
//                <dir>/baseline/ exists, each shot is compared byte-for-byte against it
//     --repeat   run every state twice and fail on any difference (flake hunt)
//     --boot-gate also run scripts/check-client-boots-source.mjs against the same build
//     --jobs N   run N states at once (each has its own server; default 1)
//
// Prereqs: `bun install` in apps/studio; playwright chromium installed.
// The server runs with NO_OPEN=1, MAUDE_NO_AUTOBUILD=1 and a throwaway HOME, so neither the
// user's prefs nor their Claude/hub setup leak into a snapshot.
// Exit: 0 = identical · 1 = behaviour changed · 2 = harness could not run.

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(REPO, 'apps', 'studio');
const GOLDEN = join(STUDIO, 'test', 'characterization', 'v1');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const UPDATE = flag('--update');
const BUILD = flag('--build');
const REPEAT = flag('--repeat');
const ONLY = opt('--only');
const SHOTS = opt('--shots');
const BOOT_GATE = flag('--boot-gate');
const JOBS = Math.max(1, Number(opt('--jobs') ?? 1));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg, code = 2) {
  console.error(`check-v1-characterization: ${msg}`);
  process.exit(code);
}

// ── optional release build of the current source ─────────────────────────────────────────
function distStatus() {
  return spawnSync('git', ['status', '--porcelain', '--', 'apps/studio/dist/'], {
    cwd: REPO,
    encoding: 'utf8',
  }).stdout.trim();
}
let restoreDist = false;
if (BUILD) {
  if (distStatus()) die('apps/studio/dist/ is dirty — commit or restore it before --build.');
  console.log('building the release client from the current source …');
  const b = spawnSync('bun', ['run', 'build.ts', '--release'], {
    cwd: STUDIO,
    env: { ...process.env, MAUDE_SKIP_RUNTIME_BUILD: '1' },
    encoding: 'utf8',
  });
  if (b.status !== 0) die(`release build failed:\n${(b.stderr || b.stdout).slice(-2000)}`);
  restoreDist = true;
  const size = (f) => statSync(join(STUDIO, 'dist', f)).size;
  console.log(
    `  client.bundle.js ${size('client.bundle.js')} B · styles.css ${size('styles.css')} B`
  );
}
function restoreBuild() {
  if (!restoreDist) return;
  restoreDist = false;
  spawnSync('git', ['checkout', '--', 'apps/studio/dist/'], { cwd: REPO });
  const left = distStatus();
  if (left) console.error(`check-v1-characterization: dist/ still differs after restore:\n${left}`);
}

if (BOOT_GATE) {
  const g = spawnSync('node', [join(REPO, 'scripts', 'check-client-boots-source.mjs')], {
    cwd: REPO,
    encoding: 'utf8',
  });
  console.log(`boot gate: ${(g.stdout || g.stderr).trim().split('\n').pop()}`);
  if (g.status !== 0) {
    restoreBuild();
    die('check-client-boots-source.mjs failed — the release client does not mount', 1);
  }
}

if (!existsSync(join(STUDIO, 'dist', 'client.bundle.js'))) {
  die('no dist/client.bundle.js — build the client first (or pass --build).');
}
const require = createRequire(join(STUDIO, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  die('playwright not installed in apps/studio — run `bun install` there first.');
}

// ── fixture project ───────────────────────────────────────────────────────────────────────
// Every state gets a FRESH copy of the fixture and its own server, so nothing one state
// persists (tree disclosure, camera, prefs) can leak into the next one's snapshot.
const runDir = mkdtempSync(join(tmpdir(), 'maude-v1-char-'));

const CANVAS = (
  name,
  boards
) => `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function ${name}() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="${name}">
${boards
  .map(
    ([id, label]) => `        <DCArtboard id="${id}" label="${label}" width={800} height={500}>
          <main style={{ padding: 40, fontFamily: 'system-ui' }}>
            <h1 data-cd-id="${id}-title">${label}</h1>
            <p data-cd-id="${id}-body">Characterization fixture.</p>
            <button data-cd-id="${id}-cta" type="button">Get started</button>
          </main>
        </DCArtboard>`
  )
  .join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;

function makeFixture(project) {
  const put = (rel, content) => {
    const p = join(project, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  put(
    '.design/config.json',
    `${JSON.stringify(
      {
        name: 'characterization',
        designRoot: '.design',
        rootClass: 'demo',
        canvasGroups: [
          { label: 'Design system', path: 'system' },
          { label: 'UI kit', path: 'ui' },
        ],
        designSystems: [
          {
            name: 'demo',
            path: 'system/demo',
            tokensCssRel: 'system/demo/colors_and_type.css',
            rootClass: 'demo',
            themeDefault: 'light',
            themes: ['light', 'dark'],
            newCanvasDir: 'ui',
          },
        ],
      },
      null,
      2
    )}\n`
  );
  put(
    '.design/system/demo/colors_and_type.css',
    `.demo[data-theme="light"] {
    --bg-0: oklch(0.99 0 0); --bg-1: oklch(0.97 0 0); --bg-2: oklch(0.94 0 0);
    --fg-0: oklch(0.2 0 0); --fg-1: oklch(0.35 0 0); --fg-2: oklch(0.5 0 0);
    --accent: oklch(0.6 0.15 250); --radius-md: 8px; --space-4: 16px;
    --font-body: system-ui; --type-base: 14px;
  }
  .demo[data-theme="dark"] {
    --bg-0: oklch(0.18 0 0); --bg-1: oklch(0.22 0 0); --bg-2: oklch(0.26 0 0);
    --fg-0: oklch(0.96 0 0); --fg-1: oklch(0.8 0 0); --fg-2: oklch(0.65 0 0);
    --accent: oklch(0.7 0.15 250); --radius-md: 8px; --space-4: 16px;
    --font-body: system-ui; --type-base: 14px;
  }
  `
  );
  put(
    '.design/system/demo/README.md',
    '# demo\n\nA tiny design system for the v1 characterization fixture.\n'
  );
  put('.design/system/demo/preview/colors.tsx', CANVAS('Colors', [['colors', 'Colors']]));
  put(
    '.design/ui/Home.tsx',
    CANVAS('Home', [
      ['home-hero', 'Hero'],
      ['home-pricing', 'Pricing'],
    ])
  );
  put('.design/ui/marketing/Landing.tsx', CANVAS('Landing', [['landing', 'Landing']]));
  put('.design/ui/Broken.tsx', 'export default function Broken() {\n  return <div>\n}\n');
}

// ── server ────────────────────────────────────────────────────────────────────────────────
let browser = null;
const live = new Set(); // every running { server, work, url, origin, log }
async function stopServer(c) {
  if (!c || !live.has(c)) return;
  live.delete(c);
  try {
    c.server.kill('SIGTERM');
  } catch {
    /* gone */
  }
  await new Promise((r) => (c.server.exitCode !== null ? r() : c.server.once('exit', r)));
  try {
    rmSync(c.work, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
async function cleanup() {
  try {
    await browser?.close();
  } catch {
    /* gone */
  }
  for (const c of [...live]) await stopServer(c);
  restoreBuild();
  try {
    rmSync(runDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
process.on('exit', () => {
  try {
    for (const c of live) c.server.kill('SIGTERM');
  } catch {
    /* gone */
  }
});
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});

// Boots are serialized (the server takes the first free port from 4399 up — two at once
// could race for one); the states themselves then run in parallel.
let bootChain = Promise.resolve();
function startServer() {
  const p = bootChain.then(bootServer);
  bootChain = p.catch(() => {});
  return p;
}
async function bootServer() {
  const work = mkdtempSync(join(runDir, 's-'));
  const project = join(work, 'project');
  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  makeFixture(project);
  const log = [];
  const server = spawn('bun', [join(STUDIO, 'server.ts'), '--root', project], {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_SYNC_IN_CI: '1',
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));
  const c = { server, work, log, url: null, origin: null };
  live.add(c);
  for (let waited = 0; waited < 45_000 && !c.url; waited += 300) {
    await sleep(300);
    if (server.exitCode !== null) break;
    const sj = join(project, '.design', '_server.json');
    if (!existsSync(sj)) continue;
    try {
      c.url = JSON.parse(readFileSync(sj, 'utf8')).url;
    } catch {
      /* mid-write */
    }
  }
  if (!c.url) {
    console.error(log.join('').slice(-1500));
    await cleanup();
    die('the source dev-server never came up.');
  }
  c.origin = new URL(c.url).origin;
  return c;
}

// Machine-specific paths never reach a snapshot: the fixture's temp dir and the real home.
const USER_HOME = process.env.HOME || '/nonexistent-home';
const snapArg = (page, selector) => ({ selector, work: page.__ctx.work, userHome: USER_HOME });

try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.error(String(err).split('\n')[0]);
  await cleanup();
  die('chromium is not installed — run `bunx playwright install chromium` in apps/studio.');
}

// ── the structural snapshot (runs in the page) ────────────────────────────────────────────
// One line per element: tag, testid, classes, role/aria/data-tour/state attributes, own text.
// Volatile values (origins, ports, times, versions) are normalized; SVG and iframe insides
// are not descended into (the iframe is the canvas runtime, not the shell under test).
function snapshotInPage({ selector, work, userHome }) {
  const KEEP = [
    'data-testid',
    'role',
    'aria-label',
    'aria-pressed',
    'aria-expanded',
    'aria-selected',
    'aria-checked',
    'aria-current',
    'aria-disabled',
    'aria-hidden',
    'aria-haspopup',
    'aria-modal',
    'data-tour',
    'data-path',
    'data-state',
    'title',
    'type',
    'placeholder',
    'disabled',
    'hidden',
    'checked',
    'value',
    'href',
    'name',
    'tabindex',
  ];
  const norm = (s) =>
    String(s)
      .split(work)
      .join('<work>')
      .split(userHome)
      .join('<user-home>')
      .replace(/https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/g, '<origin>')
      .replace(/:\d{4,5}\b/g, ':<port>')
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<time>')
      .replace(
        /\b\d+\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hrs?|hours?|d|days?)\s+ago\b/gi,
        '<ago>'
      )
      .replace(/\b(just now|a few seconds ago|a minute ago|an hour ago)\b/gi, '<ago>')
      .replace(/\bv?\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\b/g, '<ver>')
      .replace(/\b20\d\d-\d\d-\d\d(T[\d:.]+Z?)?\b/g, '<date>')
      .replace(/\s+/g, ' ')
      .trim();
  const roots = [...document.querySelectorAll(selector)];
  const out = [];
  const walk = (el, depth) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    const parts = [tag];
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).sort();
    if (cls.length) parts.push(`.${cls.join('.')}`);
    for (const a of KEEP) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      parts.push(v === '' ? `[${a}]` : `[${a}=${JSON.stringify(norm(v).slice(0, 80))}]`);
    }
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.value) {
      parts.push(`{value=${JSON.stringify(norm(el.value).slice(0, 80))}}`);
    }
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      parts.push(el.checked ? '{on}' : '{off}');
    }
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    text = norm(text);
    if (text) parts.push(JSON.stringify(text.slice(0, 140)));
    out.push(`${'  '.repeat(depth)}${parts.join(' ')}`);
    if (tag === 'svg' || tag === 'iframe' || tag === 'canvas' || tag === 'video') return;
    for (const c of el.children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out.join('\n');
}

// ── shells and states ─────────────────────────────────────────────────────────────────────
const TAURI_STUB = `window.__TAURI__ = {
  core: { invoke: (cmd) => Promise.reject(new Error('characterization: ' + cmd)) },
  event: { listen: () => Promise.resolve(() => {}) },
  window: {}, path: {}, app: {},
};`;

const CONFIG_PATCH = {
  browser: null,
  tauri: null,
  viewer: { readOnly: true },
  cloud: {
    cloud: {
      dashboardUrl: 'https://cloud.example/dashboard',
      projectName: 'Studio site',
      user: 'tereza@example.com',
      role: 'owner',
    },
  },
  'cloud-viewer': {
    readOnly: true,
    cloud: {
      dashboardUrl: 'https://cloud.example/dashboard',
      projectName: 'Studio site',
      user: 'jonas@example.com',
      role: 'viewer',
    },
  },
};

// Shells that differ only by what the server reports on another route.
const ROUTE_PATCH = {
  'sync-offline': {
    '/_sync-status': {
      linked: true,
      state: 'offline-long',
      queuedOps: 3,
      hub: 'https://hub.example.com',
      docs: { total: 4, synced: 3, rejected: 1 },
      conflicts: [
        { kind: 'cold-start-diverged', path: '.design/ui/Home.tsx', at: '2026-01-01T00:00:00Z' },
      ],
    },
  },
};

async function openShell(ctx, shell) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  // Network fonts make screenshots depend on the network: block them.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // Pending What's New entries (`version: null`) are dev-only and always unseen, so every one the
  // v2 run adds would light the badge + toast in all 30 states. v1 behaviour is the RELEASED feed.
  await page.route(`${ctx.origin}/_api/whats-new`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const entries = (body.entries ?? []).filter((e) => e?.version != null);
    await route.fulfill({ response: res, json: { ...body, entries } });
  });
  const patch = CONFIG_PATCH[shell];
  if (patch) {
    await page.route(`${ctx.origin}/_config`, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, ...patch } });
    });
  }
  for (const [path, json] of Object.entries(ROUTE_PATCH[shell] ?? {})) {
    await page.route(`${ctx.origin}${path}`, (route) => route.fulfill({ json }));
  }
  if (shell === 'tauri') await page.addInitScript(TAURI_STUB);
  page.__ctx = ctx;
  await page.goto(ctx.url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(
    () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
    null,
    { timeout: 30_000 }
  );
  await settle(page, 2500);
  return { context, page, errors };
}

async function settle(page, ms = 600) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    /* websocket keeps it busy — fine */
  }
  await sleep(ms);
}

async function press(page, keys) {
  await page.keyboard.press(keys);
  await settle(page);
}

// Same reveal as the desktop e2e helper (apps/desktop/e2e/helpers/tree.ts): sections and
// folders start closed; click every closed one, in bounded passes.
const CLOSED =
  '[data-testid^="tree-section-"][aria-expanded="false"], [data-testid^="tree-folder-"][aria-expanded="false"]';
async function expandFolders(page) {
  for (let pass = 0; pass < 12; pass++) {
    const clicked = await page.evaluate((sel) => {
      const closed = Array.from(document.querySelectorAll(sel));
      for (const el of closed) el.click();
      return closed.length;
    }, CLOSED);
    if (!clicked) break;
    await sleep(200);
  }
  await settle(page, 300);
}

// `.design/ui/Home.tsx` → `canvas-row-ui-home` (pathTestIdSlug strips the designRoot).
async function openCanvas(page, slug) {
  const row = page.locator(`[data-testid="canvas-row-${slug}"]`).first();
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await settle(page, 2500);
}

// A state that presses a key combination, then snapshots `sel`.
const afterKeys =
  (keys, sel = '#root') =>
  async (page) => {
    await press(page, keys);
    return sel;
  };

// Each state: [name, shell, async (page) => selector-to-snapshot]
const STATES = [
  ['browser/shell-empty', 'browser', async () => '#root'],
  ...['file', 'edit', 'view', 'selection', 'tools', 'help'].map((m) => [
    `browser/menu-${m}`,
    'browser',
    async (page) => {
      await page.locator(`[data-testid="menu-${m}"]`).click();
      await settle(page);
      return '.st-menubar';
    },
  ]),
  [
    'browser/palette-open',
    'browser',
    async (page) => {
      await press(page, 'Meta+k');
      return '[role="dialog"], .st-palette, .cmdk, [data-testid*="palette"]';
    },
  ],
  [
    'browser/palette-query',
    'browser',
    async (page) => {
      await press(page, 'Meta+k');
      await page.keyboard.type('export');
      await settle(page);
      return '[role="dialog"], .st-palette, .cmdk, [data-testid*="palette"]';
    },
  ],
  ['browser/shortcuts', 'browser', afterKeys('Shift+Slash')],
  ['browser/help', 'browser', afterKeys('F1')],
  ['browser/settings', 'browser', afterKeys('Meta+Comma')],
  [
    'browser/settings-tabs',
    'browser',
    async (page) => {
      await press(page, 'Meta+Comma');
      const tabs = page.locator('[role="dialog"] [role="tab"], .st-settings [role="tab"]');
      const n = await tabs.count();
      const snaps = [];
      for (let i = 0; i < n; i++) {
        await tabs.nth(i).click();
        await settle(page, 400);
        snaps.push(
          `## tab ${i}\n${await page.evaluate(snapshotInPage, snapArg(page, '[role="dialog"]'))}`
        );
      }
      return { text: snaps.join('\n') };
    },
  ],
  ['browser/export-dialog', 'browser', afterKeys('Meta+Shift+E')],
  ['browser/handoff-dialog', 'browser', afterKeys('Meta+Shift+H')],
  ['browser/comments', 'browser', afterKeys('Meta+Shift+M')],
  [
    'browser/tree-expanded',
    'browser',
    async (page) => {
      await expandFolders(page);
      return '#root';
    },
  ],
  [
    'browser/canvas-open',
    'browser',
    async (page) => {
      await expandFolders(page);
      await openCanvas(page, 'ui-home');
      return '#root';
    },
  ],
  [
    'browser/canvas-error',
    'browser',
    async (page) => {
      await expandFolders(page);
      await openCanvas(page, 'ui-broken');
      return '#root';
    },
  ],
  [
    'browser/inspector',
    'browser',
    async (page) => {
      await expandFolders(page);
      await openCanvas(page, 'ui-home');
      await press(page, 'Meta+Shift+I');
      return '#root';
    },
  ],
  [
    'browser/inspector-selected',
    'browser',
    async (page) => {
      await expandFolders(page);
      await openCanvas(page, 'ui-home');
      const frame = page.frameLocator('iframe[data-path]').first();
      try {
        await frame.locator('[data-cd-id="home-hero-title"]').click({ timeout: 8000 });
      } catch {
        /* selection may need edit mode — the snapshot records whatever happened */
      }
      await settle(page, 1200);
      return '#root';
    },
  ],
  [
    'browser/system-view',
    'browser',
    async (page) => {
      await press(page, 'S');
      return '#root';
    },
  ],
  ['tauri/shell-empty', 'tauri', async () => '#root'],
  [
    'tauri/menu-file',
    'tauri',
    async (page) => {
      await page.locator('[data-testid="menu-file"]').click();
      await settle(page);
      return '.st-menubar';
    },
  ],
  ['viewer/shell-empty', 'viewer', async () => '#root'],
  [
    'viewer/canvas-open',
    'viewer',
    async (page) => {
      await expandFolders(page);
      await openCanvas(page, 'ui-home');
      return '#root';
    },
  ],
  ['cloud/shell-empty', 'cloud', async () => '#root'],
  ['cloud/settings', 'cloud', afterKeys('Meta+Comma')],
  ['cloud-viewer/shell-empty', 'cloud-viewer', async () => '#root'],
  ['sync-offline/shell-empty', 'sync-offline', async () => '#root'],
];

const SHOT_STATES = new Set([
  'browser/shell-empty',
  'browser/canvas-open',
  'browser/export-dialog',
  'browser/settings',
  'browser/palette-open',
  'browser/shortcuts',
  'browser/inspector',
  'viewer/shell-empty',
  'cloud/shell-empty',
]);

async function runState([name, shell, drive]) {
  const ctx = await startServer();
  const { context, page, errors } = await openShell(ctx, shell);
  try {
    const r = await drive(page);
    const text =
      typeof r === 'string' ? await page.evaluate(snapshotInPage, snapArg(page, r)) : r.text;
    let shot = null;
    if (SHOTS && SHOT_STATES.has(name)) {
      await page.evaluate(() => document.fonts?.ready);
      shot = await page.screenshot({ fullPage: false });
    }
    const errLine = errors.length
      ? `\n## page errors\n${[...new Set(errors)].map((e) => e.replace(/:\d+:\d+/g, '')).join('\n')}`
      : '';
    return { text: `# ${name}\n${text}${errLine}\n`, shot };
  } finally {
    await context.close();
    await stopServer(ctx);
  }
}

function firstDiff(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      const from = Math.max(0, i - 3);
      const ctx = [];
      for (let j = from; j < Math.min(i + 6, Math.max(al.length, bl.length)); j++) {
        if (al[j] === bl[j]) ctx.push(`  ${al[j] ?? ''}`);
        else {
          if (al[j] !== undefined) ctx.push(`- ${al[j]}`);
          if (bl[j] !== undefined) ctx.push(`+ ${bl[j]}`);
        }
      }
      return `line ${i + 1}:\n${ctx.join('\n')}`;
    }
  }
  return null;
}

// ── run ───────────────────────────────────────────────────────────────────────────────────
const ONLY_LIST = ONLY ? ONLY.split(',') : null;
const selected = STATES.filter(([n]) => !ONLY_LIST || ONLY_LIST.some((p) => n.startsWith(p)));
let changed = 0;
let flaky = 0;
const fileFor = (name) => join(GOLDEN, `${name.replace('/', '__')}.txt`);
if (UPDATE) mkdirSync(GOLDEN, { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// Pixel comparison in the harness's own Chromium: the count of pixels whose RGB distance is
// above a small threshold. A few pixels move between identical runs (a spinner tick), so a
// handful is tolerated; a moved panel, a lost button or a changed colour is not.
const SHOT_TOLERANCE_PX = 64;
let shotDiffs = 0;
async function pixelDiff(a, b) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([da, db]) => {
        const load = (u) =>
          new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.src = u;
          });
        const [ia, ib] = await Promise.all([load(da), load(db)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return Number.MAX_SAFE_INTEGER;
        const px = (i) => {
          const cv = document.createElement('canvas');
          cv.width = i.width;
          cv.height = i.height;
          const x = cv.getContext('2d');
          x.drawImage(i, 0, 0);
          return x.getImageData(0, 0, i.width, i.height).data;
        };
        const pa = px(ia);
        const pb = px(ib);
        let diff = 0;
        for (let k = 0; k < pa.length; k += 4) {
          const d =
            Math.abs(pa[k] - pb[k]) +
            Math.abs(pa[k + 1] - pb[k + 1]) +
            Math.abs(pa[k + 2] - pb[k + 2]);
          if (d > 24) diff++;
        }
        return diff;
      },
      [
        `data:image/png;base64,${a.toString('base64')}`,
        `data:image/png;base64,${b.toString('base64')}`,
      ]
    );
  } finally {
    await page.close();
  }
}

// States are independent (own fixture, own server, own browser context): run JOBS at once,
// then report in the declared order.
async function computeState(state) {
  const [name] = state;
  let res;
  let note = '';
  try {
    res = await runState(state);
    if (REPEAT) {
      const again = await runState(state);
      const d = firstDiff(res.text, again.text);
      if (d) note = `FLAKY ${name} — two runs differ at ${d}`;
    }
  } catch (err) {
    return { error: `ERROR ${name}: ${String(err).split('\n')[0]}` };
  }
  return { res, note };
}
const results = new Array(selected.length);
let nextIndex = 0;
await Promise.all(
  Array.from({ length: Math.min(JOBS, selected.length) }, async () => {
    while (nextIndex < selected.length) {
      const i = nextIndex++;
      results[i] = await computeState(selected[i]);
    }
  })
);
for (const [i, state] of selected.entries()) {
  const [name] = state;
  const out = results[i];
  if (out.error) {
    console.log(out.error);
    changed++;
    continue;
  }
  if (out.note) {
    flaky++;
    console.log(out.note);
  }
  const res = out.res;
  if (res.shot) {
    const shotFile = join(SHOTS, `${name.replace('/', '__')}.png`);
    writeFileSync(shotFile, res.shot);
    const base = join(SHOTS, 'baseline', `${name.replace('/', '__')}.png`);
    if (existsSync(base) && !readFileSync(base).equals(res.shot)) {
      const px = await pixelDiff(readFileSync(base), res.shot);
      if (px > SHOT_TOLERANCE_PX) {
        shotDiffs++;
        console.log(`SHOT  ${name} differs from baseline (${px} px)`);
      }
    }
  }
  const file = fileFor(name);
  if (UPDATE) {
    writeFileSync(file, res.text);
    console.log(`wrote ${name} (${res.text.split('\n').length} lines)`);
    continue;
  }
  if (!existsSync(file)) {
    console.log(`NEW   ${name} — no golden (run with --update)`);
    changed++;
    continue;
  }
  const d = firstDiff(readFileSync(file, 'utf8'), res.text);
  if (d) {
    changed++;
    console.log(`DIFF  ${name} — ${d}`);
  } else {
    console.log(`same  ${name}`);
  }
}

if (!UPDATE && !ONLY) {
  const known = new Set(selected.map(([n]) => `${n.replace('/', '__')}.txt`));
  for (const f of existsSync(GOLDEN) ? readdirSync(GOLDEN) : []) {
    // keys.txt is the v1 KEY characterization's golden (test/characterization/v1-keys.test.ts).
    if (!known.has(f) && f !== 'keys.txt') {
      console.log(`GONE  ${f} — golden without a state`);
      changed++;
    }
  }
}

await cleanup();
if (UPDATE) {
  console.log(`golden written to ${GOLDEN}`);
  process.exit(flaky ? 1 : 0);
}
console.log(
  changed || flaky || shotDiffs
    ? `${changed} state(s) changed, ${flaky} flaky, ${shotDiffs} screenshot(s) differ`
    : `all ${selected.length} states identical`
);
process.exit(changed || flaky || shotDiffs ? 1 : 0);
