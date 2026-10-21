// S4.16 — Can comment (canvas 15 `an-viewer`) — browser E2E (node --test). Real studio server + real canvas in
// headless Chromium, the server linked to a hub that vouched the role `viewer` (Can comment); assertions on
// the DOM AND on disk.
//
//   node --test apps/studio/test/e2e/annotations-viewer.e2e.mjs
//
//   T1 everyone's notes are drawn, and a drag on one changes nothing on disk (read-only)
//   T2 N answers with ONE line that names what needs Can edit, with an Ask to edit button; no sticky is made
//   T3 the op route and the FigJam import answer 403 to this session; the board on disk is byte for byte
//      what it was
//
// Written for S4.16, not run in the builder's session; the lead runs it at the wave gate (it needs
// Chromium + a free port).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeProject, openCanvas, readBoard, sleep } from './harness.mjs';

const STUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUB_URL = 'http://hub.invalid:9';
const BOARD = [
  {
    id: 'note',
    type: 'sticky',
    index: 'a0',
    x: 160,
    y: 160,
    w: 180,
    h: 140,
    text: 'Logo o kousek výš',
    author: { kind: 'human', name: 'Tereza' },
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

/** A studio linked to a hub whose stored credential vouches `viewer` — the desktop's Can comment door. */
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
        MAUDE_NO_AUTOBUILD: '1',
        NO_OPEN: '1',
        HUBS_CONFIG_PATH: hubsPath,
        // gate-b-sec4: the harness is the app that made this link (sync/link-consent.ts)
        MAUDE_APP_BOUND_HUB: HUB_URL,
        MAUDE_MACHINE_FILE: join(root, '.design', '_state', 'machine.json'),
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
let before0;

before(async () => {
  const root = makeProject({ board: BOARD });
  server = await startViewerServer(root);
  c = await openCanvas(server);
  before0 = JSON.stringify(readBoard(server.root));
});
after(async () => {
  await c?.close();
  server?.stop();
});

const post = (path, body) =>
  fetch(`http://localhost:${server.port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${server.port}` },
    body: JSON.stringify(body),
  });

describe('Can comment on a canvas with notes', () => {
  test('T1 the notes are there, and dragging one writes nothing', async () => {
    const note = c.frame.locator('.dc-annot-scene [data-id="note"]').first();
    await note.waitFor({ state: 'visible' });
    const box = await note.boundingBox();
    assert.ok(box, 'the note is drawn');
    await c.page.mouse.move(box.x + 20, box.y + 20);
    await c.page.mouse.down();
    await c.page.mouse.move(box.x + 160, box.y + 120, { steps: 8 });
    await c.page.mouse.up();
    await sleep(600);
    assert.equal(JSON.stringify(readBoard(server.root)), before0);
  });

  test('T2 N answers with one line and Ask to edit; no sticky appears', async () => {
    await c.frame
      .locator('.dc-world')
      .first()
      .click({ position: { x: 600, y: 600 } });
    await c.page.keyboard.press('n');
    const notice = c.page.locator('.maude-notice', { hasText: 'Stickies need Can edit.' });
    await notice.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await notice.locator('.maude-notice-action').first().innerText(), 'Ask to edit');
    await sleep(400);
    assert.equal(JSON.stringify(readBoard(server.root)), before0);
  });

  test('T3 the op route and the FigJam import are refused for this session', async () => {
    const ops = await post('/_api/annotations/ops', {
      file: '.design/ui/Board.tsx',
      actionId: 'e2e-viewer-ops',
      ops: [
        {
          op: 'put',
          el: {
            id: 'intruder',
            type: 'sticky',
            index: 'a9',
            x: 0,
            y: 0,
            w: 120,
            h: 120,
            text: 'x',
          },
        },
      ],
    });
    assert.equal(ops.status, 403);
    const fig = await post('/_api/annotations/figjam', {
      file: '.design/ui/Board.tsx',
      url: 'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/x',
    });
    assert.equal(fig.status, 403);
    await sleep(300);
    assert.equal(JSON.stringify(readBoard(server.root)), before0);
  });
});
