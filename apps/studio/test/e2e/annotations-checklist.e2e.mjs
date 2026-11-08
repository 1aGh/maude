// #113 (113-C) — a sticky with ticks — browser E2E (node --test). A real studio server and the real canvas in
// headless Chromium; assertions on the DOM AND on the board on disk.
//
//   node --test apps/studio/test/e2e/annotations-checklist.e2e.mjs
//
//   T1  the rows draw as checkboxes with the "0/2" chip
//   T2  a click on a box ticks (on disk), ⌘Z unticks (on disk)
//   T3  Space ticks the focused row; ↓ moves focus to the next row
//   T4  type + ↵ splits into a new entry; Esc keeps the typed words
//   T5  Turn into checklist on a ☐ sticky makes the entries
//   T6  Can comment sees the list but cannot tick (nothing changes on disk)
//
// Isolation (burndown preamble): a throwaway HOME / XDG_CONFIG_HOME, a stub `claude` first on PATH, NO_OPEN and
// MAUDE_NO_AUTOBUILD for every server. The browser cache path is pinned BEFORE HOME moves, or Chromium would not
// be found.
//
// Needs Chromium, a free port and a client built `--release` in this tree (`cd apps/studio && bun run build.ts
// --release`). Run through the lane: `scripts/v2-test-lane.sh -- node --test <this file>`.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRATCH = mkdtempSync(join(tmpdir(), 'maude-checklist-e2e-'));
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
      : join(homedir(), '.cache', 'ms-playwright');
}
mkdirSync(join(SCRATCH, 'home'), { recursive: true });
mkdirSync(join(SCRATCH, 'bin'), { recursive: true });
writeFileSync(join(SCRATCH, 'bin', 'claude'), '#!/bin/sh\nexit 0\n');
chmodSync(join(SCRATCH, 'bin', 'claude'), 0o755);
process.env.HOME = join(SCRATCH, 'home');
process.env.XDG_CONFIG_HOME = join(SCRATCH, 'home', '.config');
process.env.PATH = `${join(SCRATCH, 'bin')}:${process.env.PATH}`;
process.env.FARM_LOCAL = '1';
process.env.NO_OPEN = '1';
process.env.MAUDE_NO_AUTOBUILD = '1';

const { makeProject, openCanvas, readBoard, sleep, startServer, waitForBoard } = await import(
  './harness.mjs'
);

const STUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUB_URL = 'http://hub.invalid:9';

const BOARD = [
  { id: 's1', type: 'sticky', index: 'a0', x: 120, y: 120, w: 240, h: 200, text: 'Launch' },
  { id: 'ck1', type: 'checkitem', index: 'a0', list: 's1', text: 'Write the post' },
  { id: 'ck2', type: 'checkitem', index: 'a1', list: 's1', text: 'Record the demo' },
  {
    id: 'p1',
    type: 'sticky',
    index: 'a1',
    x: 500,
    y: 120,
    w: 200,
    h: 200,
    text: 'Plan\n☐ one\n☐ two',
  },
];

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

/** A studio linked to a hub whose stored credential vouches `viewer` - the desktop's Can comment door. */
async function startViewerServer(root) {
  const cfgPath = join(root, '.design', 'config.json');
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch {}
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const hubsPath = join(root, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({ hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), role: 'viewer' } } })
  );
  const port = await freePort();
  const proc = spawn(
    'bun',
    ['run', join(STUDIO_DIR, 'server.ts'), '--root', root, '--port', String(port)],
    {
      env: {
        ...process.env,
        HUBS_CONFIG_PATH: hubsPath,
        MAUDE_APP_BOUND_HUB: HUB_URL,
        MAUDE_MACHINE_FILE: join(root, '.design', '_state', 'machine.json'),
        MAUDE_UI_PREFS_PATH: join(root, '.design', '_state', 'prefs.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) {
        return { port, root, log: () => log, stop: () => proc.kill('SIGTERM') };
      }
    } catch {}
    await sleep(200);
  }
  proc.kill('SIGTERM');
  throw new Error(`studio server did not start:\n${log}`);
}

let server;
let c;
before(async () => {
  server = await startServer(makeProject({ board: BOARD }));
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

const row = (id) => c.frame.locator(`[data-testid="checklist-row-${id}"]`);

async function clickIn(locator) {
  const b = await locator.boundingBox();
  assert.ok(b, 'has a box');
  await c.click(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(400);
}

describe('a checklist sticky (Can edit)', () => {
  test('T1 rows draw as checkboxes with the progress chip', async () => {
    assert.equal(await row('ck1').count(), 1);
    assert.equal(await row('ck1').getAttribute('role'), 'checkbox');
    assert.equal(await row('ck1').getAttribute('aria-checked'), 'false');
    assert.match(
      await c.frame.locator('[data-testid="checklist-progress-s1"]').innerText(),
      /0\/2/
    );
  });

  test('T2 a click on the box ticks (on disk); ⌘Z unticks (on disk)', async () => {
    await clickIn(row('ck1').locator('[data-an-check-box]'));
    assert.equal(await row('ck1').getAttribute('aria-checked'), 'true');
    const ticked = await waitForBoard(server.root, (m) => !!m.get('ck1')?.done);
    assert.ok(ticked.get('ck1').done, 'ticked on disk');
    await c.page.keyboard.press('Meta+z');
    await sleep(800);
    assert.equal(await row('ck1').getAttribute('aria-checked'), 'false');
    const back = await waitForBoard(server.root, (m) => m.get('ck1')?.done === undefined);
    assert.equal(back.get('ck1').done, undefined, 'unticked on disk');
  });

  test('T3 Space ticks the focused row and ↓ moves focus to the next', async () => {
    await row('ck1').focus();
    await c.page.keyboard.press('ArrowDown');
    await sleep(200);
    const focused = await c.frame.evaluate(() =>
      document.activeElement?.getAttribute('data-item-id')
    );
    assert.equal(focused, 'ck2');
    await c.page.keyboard.press(' ');
    await sleep(500);
    assert.equal(await row('ck2').getAttribute('aria-checked'), 'true');
    const b = await waitForBoard(server.root, (m) => !!m.get('ck2')?.done);
    assert.ok(b.get('ck2').done, 'ticked on disk');
  });

  test('T4 type + ↵ splits into a new entry; Esc keeps the typed words', async () => {
    await clickIn(row('ck1').locator('[data-an-check-text]'));
    assert.equal(await c.frame.locator('input[data-an-check-input]').count(), 1, 'field open');
    await c.page.keyboard.press('End');
    await c.page.keyboard.type(' now');
    await c.page.keyboard.press('Enter');
    await sleep(500);
    await c.page.keyboard.type('Third');
    await c.page.keyboard.press('Escape');
    const b = await waitForBoard(
      server.root,
      (m) =>
        [...m.values()].filter((e) => e.type === 'checkitem' && e.list === 's1').length === 3 &&
        [...m.values()].some((e) => e.text === 'Third')
    );
    const items = [...b.values()].filter((e) => e.type === 'checkitem' && e.list === 's1');
    assert.equal(items.length, 3, JSON.stringify(items));
    assert.ok(
      items.some((i) => i.text === 'Write the post now'),
      JSON.stringify(items)
    );
    assert.ok(
      items.some((i) => i.text === 'Third'),
      'Esc kept the words'
    );
  });

  test('T5 Turn into checklist on a ☐ sticky makes its entries', async () => {
    const [x, y] = await c.center('p1');
    await c.click(x, y - 60);
    await sleep(400);
    const btn = c.frame.locator('[data-testid="annot-ctx-make-checklist"]');
    assert.equal(await btn.count(), 1, 'the small toolbar offers it');
    await btn.click();
    const b = await waitForBoard(
      server.root,
      (m) => [...m.values()].filter((e) => e.list === 'p1').length === 2
    );
    const items = [...b.values()].filter((e) => e.type === 'checkitem' && e.list === 'p1');
    assert.equal(items.length, 2);
    assert.equal(b.get('p1').text, 'Plan');
  });
});

describe('Can comment on a checklist', () => {
  let viewer;
  let vc;
  let before0;
  before(async () => {
    const root = makeProject({ board: BOARD });
    viewer = await startViewerServer(root);
    vc = await openCanvas(viewer);
    before0 = JSON.stringify(readBoard(viewer.root));
  });
  after(async () => {
    await vc?.close();
    viewer?.stop();
  });

  test('T6 the list is drawn but a click on a box ticks nothing', async () => {
    const r = vc.frame.locator('[data-testid="checklist-row-ck1"]');
    await r.waitFor({ state: 'visible' });
    assert.equal(await r.getAttribute('aria-disabled'), 'true');
    assert.equal(await vc.frame.locator('[data-testid="checklist-add"]').count(), 0);
    const b = await r.locator('[data-an-check-box]').boundingBox();
    assert.ok(b, 'has a box');
    await vc.click(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(700);
    assert.equal(await r.getAttribute('aria-checked'), 'false');
    assert.equal(JSON.stringify(readBoard(viewer.root)), before0);
  });
});
