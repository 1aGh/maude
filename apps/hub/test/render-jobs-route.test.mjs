// S8.5b-2 — the cloud render door's hub half (contract
// apps/studio/client/v2/contracts/S8.5b-cloud-render-door.md §4, §5, §8, §10, §12, §13).
//
// A real hub-shaped HTTP server (`runHubRoutes` over the render-jobs rows), the real studio
// proxy (`forwardAs`) and a fake studio child on loopback that records every request it gets
// and keeps an owner-scoped job store like `exporters/jobs.ts`. No real hub, cell or renderer.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { resetFileAccessCaches } from '../src/access-files.mjs';
import { peerAccess } from '../src/access-gate.mjs';
import { mintRenderToken } from '../src/render-token.mjs';
import { runHubRoutes } from '../src/routes-v2/index.mjs';
import {
  createRenderJobsRoutes,
  RENDER_JOBS_ROWS,
  renderDoorEnabled,
} from '../src/routes-v2/render-jobs.mjs';
import { createStudioProxy } from '../src/studio-proxy.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const JOB = (n) => `i_${String(n).padStart(20, '0')}`;

// ---- the people -----------------------------------------------------------------------------
const MATCHES = {
  'tok-owner': { owner: 'ann@x.test', label: 'ann', role: 'owner', readOnly: false, scope: '*' },
  'tok-member': { owner: 'bob@x.test', label: 'bob', role: 'member', readOnly: false, scope: '*' },
  'tok-viewer': { owner: 'vic@x.test', label: 'vic', role: 'viewer', readOnly: true, scope: '*' },
  'tok-observer': {
    owner: 'oli@x.test',
    label: 'oli',
    role: 'observer',
    readOnly: true,
    scope: '*',
  },
  'tok-canvas': {
    owner: 'cy@x.test',
    label: 'cy',
    role: null,
    readOnly: true,
    scope: 'label:cy',
    access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
  },
  // S8.5b-4 — canvas-only with TWO exportable canvases: a job on one must never carry the other.
  'tok-canvas2': {
    owner: 'cara@x.test',
    label: 'cara',
    role: null,
    readOnly: true,
    scope: 'label:cara',
    access: {
      v: 1,
      role: null,
      grants: [
        { c: 'ui/a.tsx', r: 'member' },
        { c: 'ui/b.tsx', r: 'member' },
      ],
    },
  },
};
const verify = (token) => MATCHES[token] ?? null;
function auth(req) {
  const presented = (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const m = presented ? verify(presented) : null;
  if (!m) return null;
  return {
    actor: m.owner || m.label,
    readOnly: !!m.readOnly,
    scope: m.scope ?? '*',
    access: peerAccess(m).access,
  };
}

// ---- the checkout ---------------------------------------------------------------------------
let designRoot;
const FILES = {
  'ui/a.tsx': 'export default function A() { return null; }\n',
  'ui/b.tsx': 'export default function B() { return null; }\n',
};

// ---- the fake studio child ------------------------------------------------------------------
const seen = [];
let jobs = new Map(); // id -> { id, status, owner, spec, error?, progress? }
let studioAnswer = null; // optional override for the next POST
let studio;
let studioPort;

function studioHandler(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    seen.push({ method: req.method, url: req.url, headers: { ...req.headers }, body: text });
    const owner = req.headers['x-maude-session'] ?? '';
    const url = new URL(req.url, 'http://studio');
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/_api/export-jobs' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      const own = [...jobs.values()].filter((j) => j.owner === owner);
      if (id !== null) {
        const j = own.find((x) => x.id === id);
        if (!j) return json(404, { error: 'Not found' });
        return json(200, { jobs: [{ ...j, options: { secret: 'internal' }, filename: 'a.mp4' }] });
      }
      return json(200, { jobs: own });
    }
    if (url.pathname === '/_api/export-jobs' && req.method === 'POST') {
      if (studioAnswer) {
        const a = studioAnswer;
        studioAnswer = null;
        return json(a.status, a.body);
      }
      const id = req.headers['x-maude-door-job'];
      const prior = jobs.get(id);
      if (prior && prior.owner !== owner) return json(409, { code: 'id-taken' });
      if (prior) return json(200, { jobId: id, already: true });
      jobs.set(id, { id, status: 'queued', owner, spec: JSON.parse(text).spec });
      return json(202, { jobId: id });
    }
    if (url.pathname === '/_api/export-jobs/download') {
      const j = jobs.get(url.searchParams.get('id'));
      if (!j || j.owner !== owner) return json(404, { error: 'Not found' });
      if (j.status !== 'done') return json(409, { error: 'job not finished' });
      res.writeHead(200, {
        'content-type': 'text/html',
        'content-disposition': 'attachment; filename="a.mp4"',
      });
      return res.end('MP4BYTES');
    }
    json(404, { error: 'Not found' });
  });
}

// ---- the hub --------------------------------------------------------------------------------
let enabled = true;
let hub;
let hubPort;
let limits = null;
let door;

function buildDoor() {
  const proxy = createStudioProxy({
    upstream: () => ({ ok: true, port: studioPort }),
    publicUrl: null,
    mintRenderToken: (session, { grants = [] } = {}) =>
      mintRenderToken({
        secret: 'test-secret',
        project: 'tenant-1',
        subject: session.email,
        role: 'viewer',
        grants,
      }),
  });
  door = createRenderJobsRoutes({
    projectId: 'tenant-1',
    tenant: 'tenant-1',
    auth,
    enabled: () => enabled,
    proxy: () => proxy,
    designRoot: () => designRoot,
    limits,
  });
}

before(async () => {
  designRoot = mkdtempSync(join(tmpdir(), 'maude-render-door-'));
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  for (const [rel, body] of Object.entries(FILES)) writeFileSync(join(designRoot, rel), body);
  studio = createServer(studioHandler);
  await new Promise((r) => studio.listen(0, '127.0.0.1', r));
  studioPort = studio.address().port;
  hub = createServer(async (request, response) => {
    const path = request.url.split('?')[0];
    const respondJson = (status, body) => {
      if (response.headersSent) return;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const handled = await runHubRoutes({
      request,
      response,
      method: request.method,
      path,
      verify,
      respondJson,
      deps: { renderJobs: door },
      rows: RENDER_JOBS_ROWS,
    });
    if (!handled) respondJson(418, { error: 'fell through' });
  });
  await new Promise((r) => hub.listen(0, '127.0.0.1', r));
  hubPort = hub.address().port;
});

after(async () => {
  await new Promise((r) => hub.close(r));
  await new Promise((r) => studio.close(r));
  rmSync(designRoot, { recursive: true, force: true });
});

beforeEach(() => {
  seen.length = 0;
  jobs = new Map();
  studioAnswer = null;
  enabled = true;
  limits = null;
  resetFileAccessCaches();
  buildDoor();
});

const URL_BASE = () => `http://127.0.0.1:${hubPort}/api/projects/current/v1/render-jobs`;
const spec = (canvas = 'ui/a.tsx') => ({ v: 2, scope: 'canvas', canvas, format: 'mp4' });
const fp = (rel) => ({ rel, sha256: sha(FILES[rel]) });

function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  return fetch(`${URL_BASE()}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
}
const submit = (token, body, headers) => call('', { token, method: 'POST', body, headers });
const posts = () => seen.filter((s) => s.method === 'POST');

// ---- tests ----------------------------------------------------------------------------------

test('dark by capability: renderDoorEnabled needs a studio, a render URL and the flag', () => {
  const env = { MAUDE_RENDER_URL: 'https://render.test', MAUDE_RENDER_DOOR: '1' };
  assert.equal(renderDoorEnabled({ studio: {}, env }), true);
  assert.equal(renderDoorEnabled({ studio: null, env }), false);
  assert.equal(renderDoorEnabled({ studio: {}, env: { ...env, MAUDE_RENDER_URL: '' } }), false);
  assert.equal(renderDoorEnabled({ studio: {}, env: { MAUDE_RENDER_URL: 'x' } }), false);
  assert.equal(
    renderDoorEnabled({ studio: {}, env: { ...env, MAUDE_RENDER_DOOR: 'true' } }),
    false
  );
});

test('a dark door answers 404 to everyone and forwards nothing', async () => {
  enabled = false;
  const r = await submit('tok-owner', { jobId: JOB(1), spec: spec() });
  assert.equal(r.status, 404);
  assert.equal((await call(`/${JOB(1)}`, { token: 'tok-owner' })).status, 404);
  assert.equal(seen.length, 0);
});

test('bearer only: a cookie alone is nobody (401), no bearer reaches the studio', async () => {
  const r = await submit(
    null,
    { jobId: JOB(1), spec: spec() },
    { cookie: 'maude_session=tok-owner' }
  );
  assert.equal(r.status, 401);
  assert.equal(seen.length, 0);
});

test('T9/T5: the studio sees no authorization, no cookie and no inbound x-maude-*', async () => {
  const r = await submit(
    'tok-owner',
    { jobId: JOB(2), spec: spec(), expect: [fp('ui/a.tsx')] },
    {
      cookie: 'maude_session=abc',
      'x-maude-role': 'owner',
      'x-maude-door-job': JOB(99),
      'x-maude-render-token': 'forged',
      'x-maude-session': 'someone-else',
    }
  );
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { jobId: JOB(2) });
  assert.ok(seen.length >= 2);
  for (const s of seen) {
    assert.equal(s.headers.authorization, undefined, `${s.method} ${s.url} carried the bearer`);
    assert.equal(s.headers.cookie, undefined);
    assert.notEqual(s.headers['x-maude-render-token'], 'forged');
    assert.notEqual(s.headers['x-maude-session'], 'someone-else');
  }
  const post = posts()[0];
  assert.equal(post.url, '/_api/export-jobs');
  assert.equal(post.headers['x-maude-door-job'], JOB(2), 'the BODY names the job, not a header');
  assert.equal(post.headers['x-maude-role'], 'owner');
  assert.equal(post.headers['x-maude-session'], sha('tenant-1\0ann@x.test').slice(0, 16));
  assert.deepEqual(JSON.parse(post.body), { v: 2, spec: spec() });
});

test('T4: a read-only project session and Can view render nothing (403, never forwarded)', async () => {
  for (const tok of ['tok-viewer', 'tok-observer']) {
    const r = await submit(tok, { jobId: JOB(3), spec: spec() });
    assert.equal(r.status, 403, tok);
  }
  assert.equal(posts().length, 0);
});

test('T3: canvas-only + Folder / Whole project → 404, never forwarded', async () => {
  for (const s of [
    { v: 2, scope: 'folder', folder: 'ui', format: 'mp4' },
    { v: 2, scope: 'project', format: 'mp4' },
  ]) {
    const r = await submit('tok-canvas', { jobId: JOB(4), spec: s });
    assert.equal(r.status, 404, s.scope);
  }
  assert.equal(seen.length, 0);
});

test('T3: canvas-only + an ungranted canvas → 404 exactly like a missing one', async () => {
  const ungranted = await submit('tok-canvas', { jobId: JOB(5), spec: spec('ui/b.tsx') });
  const missing = await submit('tok-canvas', { jobId: JOB(5), spec: spec('ui/nope.tsx') });
  assert.equal(ungranted.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await ungranted.json(), await missing.json());
  assert.equal(seen.length, 0);
});

test('T3: canvas-only + its granted canvas → forwarded read-only with R carrying g', async () => {
  const r = await submit('tok-canvas', {
    jobId: JOB(6),
    spec: spec('ui/a.tsx'),
    expect: [fp('ui/a.tsx')],
  });
  assert.equal(r.status, 202);
  const post = posts()[0];
  assert.equal(post.headers['x-maude-readonly'], '1');
  const token = post.headers['x-maude-render-token'];
  assert.ok(token, 'a canvas-only door job carries a render capability');
  const claims = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(claims.r, 'viewer');
  assert.deepEqual(claims.g, [{ c: 'ui/a.tsx', r: 'member' }]);
});

test('S8.5b-4 F2: a status poll’s fresh capability is narrowed to the JOB’s canvas, like the submit’s', async () => {
  const r = await submit('tok-canvas2', {
    jobId: JOB(40),
    spec: spec('ui/a.tsx'),
    expect: [fp('ui/a.tsx')],
  });
  assert.equal(r.status, 202);
  seen.length = 0;
  const s = await call(`/${JOB(40)}`, { token: 'tok-canvas2' });
  assert.equal(s.status, 200);
  const carrying = seen.filter((x) => x.headers['x-maude-render-token']);
  assert.ok(carrying.length >= 1, 'the queued job gets a fresh capability (T11)');
  for (const x of carrying) {
    const claims = JSON.parse(
      Buffer.from(x.headers['x-maude-render-token'].split('.')[0], 'base64url').toString('utf8')
    );
    assert.deepEqual(claims.g, [{ c: 'ui/a.tsx', r: 'member' }], `${x.url} widened the grants`);
  }
});

test('a project session’s render capability is viewer with no grants', async () => {
  await submit('tok-member', { jobId: JOB(7), spec: spec() });
  const claims = JSON.parse(
    Buffer.from(posts()[0].headers['x-maude-render-token'].split('.')[0], 'base64url').toString()
  );
  assert.equal(claims.r, 'viewer');
  assert.equal(claims.g, undefined);
});

test('freshness: a different or missing file inside the closure → 425 not-synced', async () => {
  const r = await submit('tok-member', {
    jobId: JOB(8),
    spec: spec(),
    expect: [{ rel: 'ui/a.tsx', sha256: sha('a newer body') }],
  });
  assert.equal(r.status, 425);
  const body = await r.json();
  assert.equal(body.code, 'not-synced');
  assert.deepEqual(body.behind, ['ui/a.tsx']);
  assert.equal(body.retryAfterMs, 15000);
  assert.equal(posts().length, 0);
});

test('T7: not-synced never names, nor judges, a rel outside the session’s closure', async () => {
  // A canvas-only probe of an ungranted file's hash and of a file that does not exist.
  const r = await submit('tok-canvas', {
    jobId: JOB(9),
    spec: spec('ui/a.tsx'),
    expect: [
      fp('ui/a.tsx'),
      { rel: 'ui/b.tsx', sha256: sha('a guess') },
      { rel: 'ui/secret-plan.tsx', sha256: null },
    ],
  });
  assert.equal(r.status, 202, 'out-of-closure entries are skipped silently');
  const behind = await submit('tok-canvas', {
    jobId: JOB(10),
    spec: spec('ui/a.tsx'),
    expect: [
      { rel: 'ui/a.tsx', sha256: sha('x') },
      { rel: 'ui/b.tsx', sha256: sha('y') },
    ],
  });
  assert.equal(behind.status, 425);
  assert.deepEqual((await behind.json()).behind, ['ui/a.tsx']);
});

test('§7 replay: same owner + same id → 200 already; another owner → 409 id-taken', async () => {
  const body = { jobId: JOB(11), spec: spec(), expect: [fp('ui/a.tsx')] };
  assert.equal((await submit('tok-member', body)).status, 202);
  const again = await submit('tok-member', body);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { jobId: JOB(11), already: true });
  const other = await submit('tok-owner', body);
  assert.equal(other.status, 409);
  assert.equal((await other.json()).code, 'id-taken');
});

test('T2: another member’s job id answers 404 on status and on file, like a missing one', async () => {
  await submit('tok-member', { jobId: JOB(12), spec: spec() });
  jobs.get(JOB(12)).status = 'done';
  for (const p of [`/${JOB(12)}`, `/${JOB(12)}/file`]) {
    const foreign = await call(p, { token: 'tok-owner' });
    const missing = await call(p.replace(JOB(12), JOB(13)), { token: 'tok-owner' });
    assert.equal(foreign.status, 404, p);
    assert.equal(missing.status, 404, p);
    assert.deepEqual(await foreign.json(), await missing.json());
  }
  assert.equal((await call(`/${JOB(12)}`, { token: 'tok-member' })).status, 200);
});

test('status is projected: the desktop learns state, progress and error — nothing else', async () => {
  await submit('tok-member', { jobId: JOB(14), spec: spec() });
  Object.assign(jobs.get(JOB(14)), {
    status: 'running',
    progress: { current: 3, total: 9 },
    error: 'x'.repeat(2000),
  });
  const r = await call(`/${JOB(14)}`, { token: 'tok-member' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(Object.keys(body), ['job']);
  assert.deepEqual(Object.keys(body.job).sort(), ['error', 'id', 'progress', 'status']);
  assert.equal(body.job.status, 'running');
  assert.equal(body.job.error.length, 500);
  // every status read carries a freshly minted render capability (T11)
  const get = seen.find((s) => s.url === `/_api/export-jobs?id=${JOB(14)}`);
  assert.ok(get.headers['x-maude-render-token']);
});

test('file: bytes as octet-stream with the studio’s filename; not done → 409', async () => {
  await submit('tok-member', { jobId: JOB(15), spec: spec() });
  assert.equal((await call(`/${JOB(15)}/file`, { token: 'tok-member' })).status, 409);
  jobs.get(JOB(15)).status = 'done';
  const r = await call(`/${JOB(15)}/file`, { token: 'tok-member' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="a.mp4"');
  assert.equal(await r.text(), 'MP4BYTES');
});

test('§10 limits: ≤ 2 active door jobs and ≤ N submits per hour → 429 busy', async () => {
  limits = { active: 2, perHour: 3, perMinute: 100 };
  buildDoor();
  assert.equal((await submit('tok-member', { jobId: JOB(20), spec: spec() })).status, 202);
  assert.equal((await submit('tok-member', { jobId: JOB(21), spec: spec() })).status, 202);
  const busy = await submit('tok-member', { jobId: JOB(22), spec: spec() });
  assert.equal(busy.status, 429);
  const b = await busy.json();
  assert.equal(b.code, 'busy');
  assert.ok(b.retryAfterMs > 0);
  // a replay of a held job is never refused as busy
  assert.equal((await submit('tok-member', { jobId: JOB(20), spec: spec() })).status, 200);
  // the slots free when jobs finish; the hourly budget still holds
  jobs.get(JOB(20)).status = 'done';
  jobs.get(JOB(21)).status = 'failed';
  assert.equal((await submit('tok-member', { jobId: JOB(23), spec: spec() })).status, 202);
  jobs.get(JOB(23)).status = 'done';
  const hour = await submit('tok-member', { jobId: JOB(24), spec: spec() });
  assert.equal(hour.status, 429);
  assert.ok((await hour.json()).retryAfterMs > 60_000);
  // another person has their own budget
  assert.equal((await submit('tok-owner', { jobId: JOB(25), spec: spec() })).status, 202);
});

test('§10 a flood of submits is refused before any body is read', async () => {
  limits = { active: 100, perHour: 100, perMinute: 2 };
  buildDoor();
  const bad = { jobId: 'nope', spec: spec() };
  assert.equal((await submit('tok-member', bad)).status, 400);
  assert.equal((await submit('tok-member', bad)).status, 400);
  assert.equal((await submit('tok-member', bad)).status, 429);
});

test('input: bad id, bad spec, bad fingerprint, wrong project, wrong method', async () => {
  assert.equal((await submit('tok-member', { jobId: 'x', spec: spec() })).status, 400);
  assert.equal((await submit('tok-member', { jobId: JOB(30), spec: 'mp4' })).status, 400);
  const badFp = await submit('tok-member', {
    jobId: JOB(30),
    spec: spec(),
    expect: [{ rel: 'ui/a.tsx', sha256: 'nothex', extra: 1 }],
  });
  assert.equal(badFp.status, 400);
  const wrong = await fetch(
    `http://127.0.0.1:${hubPort}/api/projects/other-tenant/v1/render-jobs/${JOB(30)}`,
    { headers: { authorization: 'Bearer tok-member' } }
  );
  assert.equal(wrong.status, 404);
  assert.equal((await wrong.json()).code, 'unknown-project');
  assert.equal((await call('', { token: 'tok-member' })).status, 405);
  assert.equal((await call(`/${JOB(30)}`, { token: 'tok-member', method: 'POST' })).status, 405);
  assert.equal((await call('/not-an-id', { token: 'tok-member' })).status, 404);
  assert.equal(seen.filter((s) => s.method === 'POST').length, 0);
});

test('a body over 256 KB is refused (413)', async () => {
  const r = await submit('tok-member', {
    jobId: JOB(31),
    spec: spec(),
    pad: 'x'.repeat(300 * 1024),
  });
  assert.equal(r.status, 413);
});

test('the studio’s refusals reach the desktop as codes (422 cap, queue full → busy)', async () => {
  studioAnswer = { status: 422, body: { code: 'video-too-long', message: 'Too long.' } };
  const cap = await submit('tok-member', { jobId: JOB(32), spec: spec() });
  assert.equal(cap.status, 422);
  assert.deepEqual(await cap.json(), { code: 'video-too-long', message: 'Too long.' });
  studioAnswer = { status: 429, body: { error: 'queue full' } };
  const full = await submit('tok-member', { jobId: JOB(33), spec: spec() });
  assert.equal(full.status, 429);
  assert.equal((await full.json()).code, 'busy');
});
