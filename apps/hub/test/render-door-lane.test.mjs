// S8.5b-4 — the cloud render door, end to end (contract
// apps/studio/client/v2/contracts/S8.5b-cloud-render-door.md §13 "Lane test", §12 T2/T7/T9).
//
// Everything real except the renderer: a real hub PROCESS (`src/server.mjs`, workspace mode,
// `MAUDE_RENDER_DOOR=1`), a real studio child it supervises (bun `apps/studio/server.ts`), the real
// desktop door client (`createHubRenderDoor`) and the real send-time fingerprint
// (`closureFingerprint`). `maude-render` is a loopback stub answering like `apps/render/server.ts`
// (`POST /render`, bearer = the render secret, element targets, `canvas.origin` required, artifact
// bytes + `x-maude-filename`).
//
// Between the hub and the studio child sits a header TAP: the hub launches `MAUDE_STUDIO_BIN`
// (its documented binary seam, studio-child.mjs `studioLaunch`), which is a small node script that
// records every request the hub sends and proxies it to the real studio on another port. That is how
// "the hub token never reaches the studio child" is observed rather than assumed.
//
// Never a real Cloudflare, maude-render or hub; nothing outside a mktemp dir is written.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFingerprint } from '../../studio/exporters/door-fingerprint.ts';
import { createHubRenderDoor } from '../../studio/exporters/hub-render-door.ts';
import { verifyRenderToken } from '../src/render-token.mjs';
import { addToken } from '../src/tokens.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB_DIR = resolve(HERE, '..');
const REPO_ROOT = resolve(HUB_DIR, '..', '..');
const STUDIO_DIR = join(REPO_ROOT, 'apps', 'studio');

const HUB_SECRET = 'lane-hub-secret-not-for-production';
const RENDER_SECRET = 'lane-render-secret';
const TENANT = 'lane';
const ARTIFACT = Buffer.from('\x00\x00\x00\x18ftypmp42 lane-render-artifact', 'latin1');

/** `i_` + 20 of [a-z0-9] — the outbox record id shape (§5). */
const jobId = (n) => `i_lane${String(n).padStart(16, '0')}`;

const VIDEO_TSX = `import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, useCurrentFrame } from "remotion";

const W = 320, H = 180, FPS = 12, TOTAL = 12;
function Clip() {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#132038" }}><div>{f}</div></AbsoluteFill>;
}
export default function LaneClip() {
  return (
    <DesignCanvas>
      <DCSection id="v" title="Lane">
        <DCArtboard id="clip" label="Clip" kind="video" width={W} height={H}>
          <VideoComp component={Clip} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const SPEC = Object.freeze({ v: 2, scope: 'canvas', canvas: 'ui/clip.tsx', format: 'mp4' });

/** The tap the hub launches as its "studio binary": records, then proxies to the real studio. */
const TAP_SRC = `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { request, createServer } from 'node:http';
import { connect } from 'node:net';
const cfg = JSON.parse(readFileSync(new URL('./tap.json', import.meta.url), 'utf8'));
const outer = Number(process.env.PORT);
const child = spawn(cfg.bun, [cfg.entry, ...process.argv.slice(2)], {
  env: { ...process.env, PORT: String(cfg.innerPort) },
  stdio: 'inherit',
});
writeFileSync(cfg.pidFile, String(child.pid));
const note = (req) => appendFileSync(cfg.log, JSON.stringify({ method: req.method, url: req.url, headers: req.headers }) + '\\n');
const server = createServer((req, res) => {
  note(req);
  const up = request({ host: '127.0.0.1', port: cfg.innerPort, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
});
server.on('upgrade', (req, socket, head) => {
  note(req);
  const up = connect(cfg.innerPort, '127.0.0.1', () => {
    const lines = [req.method + ' ' + req.url + ' HTTP/1.1'];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
    up.write(lines.join('\\r\\n') + '\\r\\n\\r\\n');
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});
server.listen(outer, '127.0.0.1');
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 4000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
`;

async function freePort() {
  const s = createNetServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the world -------------------------------------------------------------------------------
let root;
let repo;
let macDesign;
let hub;
let hubLog = '';
let base;
let tapLog;
let tapPidFile;
let stub;
const renderSeen = [];
let alice;
let bob;

function seedDesign(designRoot) {
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    `${JSON.stringify({ name: 'render-door-lane', canvasGroups: [{ label: 'Canvases', path: 'ui' }] }, null, 2)}\n`
  );
  writeFileSync(join(designRoot, 'ui', 'clip.tsx'), VIDEO_TSX);
  writeFileSync(
    join(designRoot, 'ui', 'clip.meta.json'),
    `${JSON.stringify({ title: 'Clip', kind: 'video' }, null, 2)}\n`
  );
}

/** The fake maude-render: `apps/render/server.ts`'s contract, recording every request whole. */
function startRenderStub() {
  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      renderSeen.push({ method: req.method, url: req.url, headers: req.headers, text });
      if (req.url === '/_health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ ok: true, app: 'maude-render', version: 'lane', configured: true })
        );
        return;
      }
      if (req.url !== '/render' || req.method !== 'POST') {
        res.writeHead(404).end('not found');
        return;
      }
      if (req.headers.authorization !== `Bearer ${RENDER_SECRET}`) {
        res.writeHead(401).end('unauthorized');
        return;
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        res.writeHead(400).end('invalid JSON');
        return;
      }
      const okTargets =
        Array.isArray(body?.targets) &&
        body.targets.length > 0 &&
        body.targets.every((t) => t?.kind === 'element');
      if (!okTargets || typeof body?.canvas?.origin !== 'string' || !body.canvas.origin) {
        res.writeHead(400).end('invalid render job');
        return;
      }
      res.writeHead(200, {
        'content-type': 'video/mp4',
        'x-maude-filename': 'clip.mp4',
        'content-length': String(ARTIFACT.length),
      });
      res.end(ARTIFACT);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function waitForHub(timeoutMs) {
  const until = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < until) {
    if (hub.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/health`);
      last = await r.json();
      if (last?.studio?.state === 'ready' && last.capabilities?.includes('render-jobs-v1'))
        return last;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error(
    `hub/studio never came up: ${JSON.stringify(last)}\n--- hub log ---\n${hubLog.slice(-4000)}`
  );
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'maude-render-door-lane-'));
  repo = join(root, 'repo');
  const dataDir = join(root, 'data');
  mkdirSync(repo, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  // The cell's checkout: a real git repo with the project, committed.
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'cell@lane.test');
  git(repo, 'config', 'user.name', 'Lane Cell');
  seedDesign(join(repo, '.design'));
  const { writeGitignoreBlock } = await import(join(REPO_ROOT, 'cli/lib/gitignore-block.mjs'));
  writeGitignoreBlock(repo, { designRel: '.design' });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'seed: render door lane');

  // "This Mac": its own copy of the same project (what the desktop fingerprints at send time).
  macDesign = join(root, 'mac', '.design');
  cpSync(join(repo, '.design'), macDesign, { recursive: true });

  // Two people, each with the peer token their desktop syncs with.
  alice = addToken(dataDir, {
    label: 'alice-mac',
    scope: '*',
    owner: 'alice@lane.test',
    role: 'member',
  }).value;
  bob = addToken(dataDir, {
    label: 'bob-mac',
    scope: '*',
    owner: 'bob@lane.test',
    role: 'member',
  }).value;

  stub = await startRenderStub();
  const renderUrl = `http://127.0.0.1:${stub.address().port}`;

  // The tap the hub launches as its studio binary.
  const tapDir = join(root, 'tap');
  mkdirSync(tapDir, { recursive: true });
  tapLog = join(tapDir, 'requests.ndjson');
  tapPidFile = join(tapDir, 'studio.pid');
  const bunPath = execFileSync('/bin/sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  const tapBin = join(tapDir, 'studio-tap.mjs');
  writeFileSync(tapBin, TAP_SRC);
  chmodSync(tapBin, 0o755);
  writeFileSync(
    join(tapDir, 'tap.json'),
    JSON.stringify({
      bun: bunPath,
      entry: join(STUDIO_DIR, 'server.ts'),
      innerPort: await freePort(),
      log: tapLog,
      pidFile: tapPidFile,
    })
  );

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    PORT: String(port),
    DATA_DIR: dataDir,
    HUB_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_REPO_DIR: repo,
    MAUDE_DESIGN_ROOT: '.design',
    HUB_PUBLIC_URL: base,
    HUB_INSECURE_HTTP: '1',
    HUB_SECRET,
    MAUDE_TENANT_ID: TENANT,
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    MAUDE_STUDIO_BIN: tapBin,
    MAUDE_STUDIO_PORT: String(await freePort()),
    MAUDE_RENDER_URL: renderUrl,
    MAUDE_RENDER_SECRET: RENDER_SECRET,
    MAUDE_RENDER_DOOR: '1',
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_MACHINE_FILE: join(root, 'machine.json'),
  };
  hub = spawn(process.execPath, [join(HUB_DIR, 'src', 'server.mjs')], {
    cwd: HUB_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (b) => {
    hubLog = (hubLog + b.toString('utf8')).slice(-64_000);
  };
  hub.stdout.on('data', keep);
  hub.stderr.on('data', keep);
  await waitForHub(120_000);
});

after(async () => {
  if (hub && hub.exitCode === null) {
    const exited = new Promise((r) => hub.once('exit', r));
    hub.kill('SIGTERM');
    await Promise.race([exited, sleep(10_000)]);
    if (hub.exitCode === null) hub.kill('SIGKILL');
  }
  // Backstop: the studio the tap started must not outlive the test.
  try {
    const pid = Number(readFileSync(tapPidFile, 'utf8'));
    if (pid > 0) process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  if (stub) await new Promise((r) => stub.close(r));
  if (root) rmSync(root, { recursive: true, force: true });
});

const doorFor = (token) => createHubRenderDoor({ hubUrl: base, token: () => token });
const expectNow = () => {
  const fp = closureFingerprint(macDesign, SPEC.canvas);
  assert.equal(fp.ok, true, 'the Mac can fingerprint its canvas');
  return fp.expect;
};
const tapped = () =>
  existsSync(tapLog)
    ? readFileSync(tapLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

async function settle(door, id, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  let s;
  while (Date.now() < until) {
    s = await door.status(id);
    if (s.state === 'done' || s.state === 'failed' || s.state === 'gone') return s;
    await sleep(300);
  }
  return s;
}

describe('the cloud render door, against a real hub and a real studio child', () => {
  const FIRST = jobId(1);

  test('a video export goes submit → status → file and comes back as the renderer’s bytes', async () => {
    const door = doorFor(alice);
    const sent = await door.submit({
      jobId: FIRST,
      spec: SPEC,
      label: 'clip · MP4',
      expect: expectNow(),
    });
    assert.deepEqual(sent, { ok: true }, `submit: ${JSON.stringify(sent)}\n${hubLog.slice(-3000)}`);
    const s = await settle(door, FIRST);
    assert.equal(s?.state, 'done', `status: ${JSON.stringify(s)}\n${hubLog.slice(-3000)}`);
    const file = await door.artifact(FIRST);
    assert.ok(file, 'the file came down');
    assert.equal(Buffer.from(file.body).equals(ARTIFACT), true, 'byte-identical to the render');
    assert.match(String(file.filename), /\.mp4$/, 'the studio names the file');

    // A replay (the Mac crashed between send and answer) is the same job, not a second render.
    const renders = renderSeen.filter((r) => r.url === '/render').length;
    assert.deepEqual(
      await door.submit({ jobId: FIRST, spec: SPEC, label: 'clip · MP4', expect: expectNow() }),
      { ok: true, already: true }
    );
    assert.equal(renderSeen.filter((r) => r.url === '/render').length, renders);
  });

  test('the peer token reaches neither the studio child nor the renderer (T9)', () => {
    const renders = renderSeen.filter((r) => r.url === '/render');
    assert.ok(renders.length >= 1, 'the renderer was asked');
    for (const r of renders) {
      const all = JSON.stringify(r.headers) + r.text;
      for (const t of [alice, bob, HUB_SECRET]) assert.equal(all.includes(t), false);
      assert.equal(r.headers.authorization, `Bearer ${RENDER_SECRET}`);
      assert.equal(r.headers.cookie, undefined);
      // The worker holds the cell's VIEWER render capability for this person — never their token.
      const body = JSON.parse(r.text);
      const v = verifyRenderToken({
        secret: HUB_SECRET,
        token: body.canvas.token,
        project: TENANT,
      });
      assert.equal(v.ok, true, `render token verifies: ${JSON.stringify(v)}`);
      assert.equal(v.role, 'viewer');
      assert.equal(v.subject, 'alice@lane.test');
    }

    const seen = tapped();
    const door = seen.filter((r) => String(r.url).startsWith('/_api/export-jobs'));
    assert.ok(door.length >= 3, `the studio served the door: ${door.length} requests`);
    for (const r of seen) {
      const all = JSON.stringify(r.headers);
      for (const t of [alice, bob, HUB_SECRET]) {
        assert.equal(all.includes(t), false, `${r.method} ${r.url} carried a hub credential`);
      }
    }
    for (const r of door) {
      assert.equal(r.headers.authorization, undefined, `${r.url}: no authorization upstream`);
      assert.equal(r.headers.cookie, undefined, `${r.url}: no cookie upstream`);
    }
    const post = door.find((r) => r.method === 'POST');
    assert.equal(post.headers['x-maude-door-job'], FIRST, 'the hub names the job');
    assert.equal(post.headers['x-maude-user'], 'alice@lane.test');
  });

  test('not synced: an edit on this Mac that has not reached the cloud is 425 with `behind`', async () => {
    writeFileSync(join(macDesign, 'ui', 'clip.tsx'), VIDEO_TSX.replace('#132038', '#ff0000'));
    try {
      const expect = expectNow();
      const raw = await fetch(`${base}/api/projects/current/v1/render-jobs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${alice}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: jobId(2), spec: SPEC, label: 'clip · MP4', expect }),
        redirect: 'error',
      });
      assert.equal(raw.status, 425);
      const body = await raw.json();
      assert.equal(body.code, 'not-synced');
      assert.deepEqual(body.behind, ['ui/clip.tsx']);
      assert.equal(typeof body.retryAfterMs, 'number');

      // The desktop door reads it as transient, naming the file by basename.
      const answer = await doorFor(alice).submit({
        jobId: jobId(3),
        spec: SPEC,
        label: 'clip · MP4',
        expect,
      });
      assert.equal(answer.ok, false);
      assert.equal(answer.status, 425);
      assert.equal(answer.code, 'not-synced');
      assert.match(answer.message, /clip\.tsx/);
      // Nothing was queued for either id.
      assert.equal((await doorFor(alice).status(jobId(2))).state, 'gone');
    } finally {
      writeFileSync(join(macDesign, 'ui', 'clip.tsx'), VIDEO_TSX);
    }
  });

  test('owner scoping: a second person can neither see, download nor take the first one’s job (T2)', async () => {
    const theirs = doorFor(bob);
    assert.deepEqual(await theirs.status(FIRST), { state: 'gone' });
    assert.equal(await theirs.artifact(FIRST), null);
    const taken = await theirs.submit({
      jobId: FIRST,
      spec: SPEC,
      label: 'clip · MP4',
      expect: expectNow(),
    });
    assert.equal(taken.ok, false);
    assert.equal(taken.status, 409);
    assert.equal(taken.code, 'id-taken');
    // …and the owner still has it, untouched.
    assert.equal((await doorFor(alice).status(FIRST)).state, 'done');
    const raw = await fetch(`${base}/api/projects/current/v1/render-jobs/${FIRST}/file`, {
      headers: { authorization: `Bearer ${bob}` },
    });
    assert.equal(raw.status, 404);
    await raw.body?.cancel();
  });

  test('after every scenario: no request the hub sent the studio child carried a hub credential', async () => {
    // The door's park probe on a hub with no DO in front (self-hosted shape): answered by the hub
    // (never a redirect the bearer could follow), and never handed to the studio child.
    const probe = await fetch(`${base}/_cell/state`, {
      headers: { authorization: `Bearer ${bob}`, 'x-maude-sync-park': '1' },
      redirect: 'manual',
    });
    assert.equal(probe.status >= 300 && probe.status < 400, false, 'no redirect');
    await probe.body?.cancel();
    const seen = tapped();
    assert.ok(seen.length > 0);
    assert.deepEqual(
      seen.filter((r) => String(r.url).startsWith('/_cell')),
      [],
      'the probe never reaches the studio child'
    );
    for (const r of seen) {
      const all = JSON.stringify(r.headers);
      for (const t of [alice, bob, HUB_SECRET]) {
        assert.equal(all.includes(t), false, `${r.method} ${r.url} carried a hub credential`);
      }
    }
  });
});
