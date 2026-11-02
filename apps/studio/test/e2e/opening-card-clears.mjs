#!/usr/bin/env node
// Headless check: opening a canvas clears the shell's "Opening <name>…" card.
//
// Boots this tree's studio (serving the committed/built `dist/`) on a scratch copy of the desktop e2e
// fixture, opens `ui-smoke` from the canvas list in Chromium and waits for `[data-testid=canvas-loading]`
// to go away. Exit 0 = the card cleared within 10 s; 1 = still shown (prints the console + the frame's
// state); 2 = harness failure (server did not boot, row missing).
//
// The card is cleared by the canvas iframe's `dgn:'canvas-rendered'` (TSX) / `loaded` (legacy .html)
// message — this is the end-to-end proof that the message survives every hop (shell template → canvas
// origin → the shell's bridge listener). Unit pin: test/canvas-loading-clears.test.ts.
//
// Usage: node apps/studio/test/e2e/opening-card-clears.mjs [--keep] [--webkit]
// Requires a built `apps/studio/dist` (MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release).
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, '../..');
const repo = resolve(studio, '../..');
const require = createRequire(join(studio, 'package.json'));
const playwright = require('playwright');
const engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';

const keep = process.argv.includes('--keep');
const scratch = mkdtempSync(join(tmpdir(), 'maude-opening-'));
const project = join(scratch, 'project');
cpSync(join(repo, 'apps/desktop/e2e/fixtures/project'), project, { recursive: true });
for (const p of ['.design/_state', '.design/_sync.json'])
  rmSync(join(project, p), { recursive: true, force: true });
const cfgPath = join(project, '.design/config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
delete cfg.linkedHub;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
const machineFile = join(scratch, 'machine.json');
const home = join(scratch, 'home');
const stubBin = join(scratch, 'stub-bin');
mkdirSync(join(home, '.config', 'maude'), { recursive: true });
mkdirSync(stubBin, { recursive: true });
writeFileSync(join(stubBin, 'claude'), '#!/bin/sh\necho \'{"loggedIn":false}\'\n', { mode: 0o755 });
const port = 4600 + Math.floor(Math.random() * 300);

const server = spawn(
  'bun',
  ['run', join(studio, 'server.ts'), '--root', project, '--port', String(port)],
  {
    // a throwaway HOME/XDG and a signed-out stub claude: the studio must never read or write the
    // person's real ~/.config/maude (this probe once rewrote the real prefs.json)
    env: {
      ...process.env,
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_MACHINE_FILE: machineFile,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      MAUDE_UI_PREFS_PATH: join(home, '.config', 'maude', 'prefs.json'),
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

let code = 2;
let browser;
try {
  const serverJson = join(project, '.design/_server.json');
  const t0 = Date.now();
  while (!existsSync(serverJson) && Date.now() - t0 < 30000)
    await new Promise((r) => setTimeout(r, 200));
  if (!existsSync(serverJson)) throw new Error(`server did not boot:\n${serverLog.slice(-2000)}`);
  const { url } = JSON.parse(readFileSync(serverJson, 'utf8'));
  browser = await playwright[engine].launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  const row = page.locator('[data-testid="canvas-row-ui-smoke"]');
  await row.waitFor({ timeout: 15000 });
  await row.click();
  const card = page.locator('[data-testid="canvas-loading"]');
  try {
    await card.first().waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    /* already gone (fast path) */
  }
  try {
    await card.first().waitFor({ state: 'detached', timeout: 10000 });
    console.log(`PASS (${engine}): the Opening card cleared`);
    code = 0;
  } catch {
    const state = await page.locator('.viewport').first().getAttribute('data-canvas-state');
    const screens = await Promise.all(
      page.frames().map((f) =>
        f
          .locator('[data-dc-screen]')
          .count()
          .catch(() => 0)
      )
    );
    console.log(
      `FAIL (${engine}): "Opening…" card still shown after 10 s (canvas-state=${state}, frame screens=${screens})`
    );
    console.log(consoleLines.slice(-30).join('\n'));
    code = 1;
  }
} catch (err) {
  console.error(`HARNESS: ${err && err.stack ? err.stack : err}`);
  code = 2;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  if (!keep) rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}
