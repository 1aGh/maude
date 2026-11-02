// p8-hub-undo-collision — two people on one LOCAL hub, one sticky (browser E2E, node --test).
// A loopback hub (apps/hub/test/fixtures/serve-hub.mjs, accepted revisions) and two real studio servers
// linked to it — Alice in headless Chromium, Bob through his own studio's op route. Never a real hub.
//
//   node --test --test-force-exit apps/studio/test/e2e/hub-undo-together.e2e.mjs
//
//   U1 Alice types a word into the sticky; Bob overwrites that same word; Alice presses ⌘Z →
//      refused (Michal 2026-10-29, kg maude/v2-michal-hub-undo-refuses-on-text-collision): the
//      "Can't undo … changed it since" notice shows, and Bob's text stays — on the hub head and on
//      Alice's disk.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeProject, openCanvas, peerOps, readBoard, sleep, waitForBoard } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO_DIR = join(HERE, '..', '..');
const FIXTURE = join(STUDIO_DIR, '..', 'hub', 'test', 'fixtures', 'serve-hub.mjs');
const SHOTS = process.env.E2E_SHOTS_DIR ?? null;

const SEED = 'Hello world';
const BOARD = [
  { id: 'duo', type: 'sticky', index: 'a0', x: 100, y: 100, w: 260, h: 220, text: SEED },
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

function startHub(dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({ proc, port: info.port, tokens: info.tokens });
        return;
      }
    });
    proc.stderr.on('data', (c) => (buf += c.toString('utf8')));
  });
}

/** A studio linked to the loopback hub as `who` (its own hubs.json — never ~/.config). */
async function startLinkedServer(root, hubUrl, token) {
  const cfgPath = join(root, '.design', 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: hubUrl, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const hubsPath = join(root, 'hubs.json');
  // the fixture's alice/bob tokens are members (Can edit); the studio reads the role from this record
  writeFileSync(
    hubsPath,
    JSON.stringify({ hubs: { [hubUrl]: { token, linkedAt: Date.now(), role: 'member' } } }),
    { mode: 0o600 }
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
        MAUDE_SYNC_IN_CI: '1',
        HUBS_CONFIG_PATH: hubsPath,
        // the harness is the app that made this link (sync/link-consent.ts)
        MAUDE_APP_BOUND_HUB: hubUrl,
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

async function until(fn, what, ms = 20_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = String(e);
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 300)})`);
}

let tmp;
let hub;
let hubUrl;
let alice;
let bob;
let c;
let doc;

/** The sticky's text at the hub head (the owner's read — what every peer pulls). */
async function hubText(id) {
  const res = await fetch(
    `${hubUrl}/api/projects/current/v1/lane?doc=${encodeURIComponent(doc)}&lane=annotations&rev=${Number.MAX_SAFE_INTEGER}`,
    { headers: { authorization: `Bearer ${hub.tokens.owner}` } }
  );
  const body = (await res.json()).body;
  if (!body) return null;
  return JSON.parse(body).elements.find((e) => e.id === id)?.text ?? null;
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'p8-hub-undo-e2e-'));
  hub = await startHub(join(tmp, 'hub'));
  hubUrl = `http://127.0.0.1:${hub.port}`;
  alice = await startLinkedServer(makeProject({ board: BOARD }), hubUrl, hub.tokens.alice);
  doc = await until(async () => {
    const r = await fetch(`${hubUrl}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    const b = await r.json();
    return b.docs?.find((d) => d.path === 'ui/Board.tsx')?.doc ?? null;
  }, 'the hub to hold ui/Board.tsx');
  await until(async () => (await hubText('duo')) === SEED, 'the seeded sticky on the hub');
  const bobRoot = makeProject();
  rmSync(join(bobRoot, '.design', 'ui', 'Board.tsx'));
  rmSync(join(bobRoot, '.design', 'ui', 'Board.meta.json'));
  bob = await startLinkedServer(bobRoot, hubUrl, hub.tokens.bob);
  await until(
    () => readBoard(bob.root)?.get('duo')?.text === SEED,
    'bob’s copy of the sticky',
    30_000
  );
  c = await openCanvas(alice);
});

after(async () => {
  await c?.browser?.close().catch(() => {});
  alice?.stop();
  bob?.stop();
  if (hub && hub.proc.exitCode === null) {
    const gone = new Promise((r) => hub.proc.once('exit', r));
    hub.proc.kill('SIGTERM');
    await gone;
  }
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('two people on one hub, one sticky', () => {
  test('U1 Bob overwrites the word I typed; my ⌘Z is refused and his text stays', async () => {
    // I type a word
    const [x, y] = await c.center('duo');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.press('End');
    await c.page.keyboard.type(' brave');
    await c.page.keyboard.press('Enter');
    await until(
      async () => (await hubText('duo')) === `${SEED} brave`,
      'my word on the hub',
      20_000
    ).catch(async (e) => {
      const ed = await c.editorState().catch(() => null);
      if (SHOTS) await c.page.screenshot({ path: join(SHOTS, 'u1-typed.png') }).catch(() => {});
      throw new Error(
        `${e.message}\ndisk: ${readBoard(alice.root)?.get('duo')?.text}\neditor: ${JSON.stringify(ed)}\nhub: ${await hubText('duo')}\nserver: ${alice.log().slice(-2500)}`
      );
    });
    // the step is on my ⌘Z stack before Bob moves
    await sleep(800);

    // Bob overwrites that same word, through his own studio
    await until(() => readBoard(bob.root)?.get('duo')?.text === `${SEED} brave`, 'my word on bob');
    await peerOps(bob, [
      { op: 'patch', id: 'duo', set: { text: `${SEED} bold` }, expect: { text: `${SEED} brave` } },
    ]);
    await until(async () => (await hubText('duo')) === `${SEED} bold`, 'bob’s word on the hub');
    await waitForBoard(alice.root, (b) => b.get('duo')?.text === `${SEED} bold`, 15_000);
    assert.equal(readBoard(alice.root).get('duo').text, `${SEED} bold`, 'bob’s word reached me');
    await sleep(500);

    // ⌘Z on the canvas
    await c.page.keyboard.press('Meta+z');
    const notice = await c.page
      .getByText(/Can't undo .+ changed it since/)
      .first()
      .waitFor({ timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await c.page.screenshot({ path: join(SHOTS, 'u1-refused.png') }).catch(() => {});
    }
    assert.ok(notice, 'the "can’t undo — someone else changed it since" notice is shown');
    await sleep(1000);
    assert.equal(await hubText('duo'), `${SEED} bold`, 'bob’s text is the hub head');
    assert.equal(readBoard(alice.root).get('duo').text, `${SEED} bold`, 'and on my disk');
    assert.equal(readBoard(bob.root).get('duo').text, `${SEED} bold`, 'and on his');
    assert.deepEqual(c.errors, [], 'no page errors');
  });
});
