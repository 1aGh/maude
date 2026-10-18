// S6.0b — `POST /_api/cloud/move` + `GET /_api/cloud/move` (contract S6-S9 §5.5).
//
// The route against a FAKE control plane and a FAKE cell (two loopback Bun servers). The cloud
// half of the attach is the real `createCloudEndpoints`, so a finished move is the same on-disk
// state a Connect writes (linkedHub in config.json + a hub credential). Every machine file lives
// in a temp dir: MAUDE_CLOUD_CONFIG, HUBS_CONFIG_PATH and MAUDE_MACHINE_FILE never name
// ~/.config/maude.

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCloudEndpoints } from '../cloud/endpoints.ts';
import { CANVAS_SAFE_API, guardTableRoute } from '../http.ts';
import { createCloudMoveRoutes } from '../routes/cloud-move.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes, type RouteSpec } from '../routes/table.ts';
import { isRuntimeStateRel } from '../sync/file-membership.ts';
import { stubDeps } from './_route-stubs.ts';

// ── the fakes ───────────────────────────────────────────────────────────────

interface Fake {
  /** what POST /api/projects answers; `null` = the real happy answer */
  createStatus: number | null;
  /** how many GET /api/projects answer `pending` before `active` */
  pendingPolls: number;
  /** the cell refuses /auth/login */
  cellRefuses: boolean;
  /** hub format reported by /health */
  hubFormat: number;
  events: string[];
  formatBodies: unknown[];
  /** was config.json linked when the format marker went up? */
  linkedAtFormat: boolean[];
}

const fake: Fake = {
  createStatus: null,
  pendingPolls: 1,
  cellRefuses: false,
  hubFormat: 1,
  events: [],
  formatBodies: [],
  linkedAtFormat: [],
};
let designRoot = '';
let polls = 0;

const cell = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/auth/login') {
      fake.events.push('login');
      if (fake.cellRefuses) return Response.json({ error: 'no' }, { status: 401 });
      return Response.json({ token: 'hubtok_secret', user: { role: 'owner' } });
    }
    if (pathname === '/health') {
      fake.events.push('health');
      return Response.json({
        ok: true,
        formatVersion: fake.hubFormat,
        capabilities: ['format-v2'],
      });
    }
    if (pathname === '/api/project-format' && req.method === 'POST') {
      fake.events.push('format');
      fake.formatBodies.push(await req.json());
      const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
      fake.linkedAtFormat.push(!!cfg.linkedHub);
      return Response.json({ formatVersion: 2, epoch: 1 });
    }
    return new Response('not found', { status: 404 });
  },
});
const CELL = `http://127.0.0.1:${cell.port}`;

const cloud = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const authed = req.headers.get('authorization') === 'Bearer mpt_test';
    if (pathname === '/api/projects' && req.method === 'POST') {
      fake.events.push('create');
      if (!authed) return Response.json({ error: 'sign in' }, { status: 401 });
      if (fake.createStatus !== null)
        return Response.json({ error: 'refused' }, { status: fake.createStatus });
      const body = (await req.json()) as { name?: string };
      fake.events.push(`name:${body.name}`);
      return Response.json(
        { project: { id: 'alligators', name: body.name, state: 'pending' } },
        { status: 201 }
      );
    }
    if (pathname === '/api/projects' && req.method === 'GET') {
      fake.events.push('list');
      if (!authed) return Response.json({ error: 'sign in' }, { status: 401 });
      polls++;
      const state = polls > fake.pendingPolls ? 'active' : 'pending';
      return Response.json({ projects: [{ id: 'alligators', name: 'Alligators', state }] });
    }
    if (pathname === '/projects/open' && req.method === 'POST') {
      fake.events.push('open');
      return Response.json({ token: 'ptok_secret', url: CELL, role: 'owner' });
    }
    return new Response('not found', { status: 404 });
  },
});
const CLOUD = `http://127.0.0.1:${cloud.port}`;

// ── the sandbox ─────────────────────────────────────────────────────────────

let tmp = '';
const saved: Record<string, string | undefined> = {};
const ENV = ['MAUDE_CLOUD_URL', 'MAUDE_CLOUD_CONFIG', 'HUBS_CONFIG_PATH', 'MAUDE_MACHINE_FILE'];

function signIn() {
  writeFileSync(
    process.env.MAUDE_CLOUD_CONFIG as string,
    JSON.stringify({ url: CLOUD, token: 'mpt_test', email: 'a@example.com', connectedAt: 1 })
  );
}

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(designRoot, 'config.json'),
    `${JSON.stringify({ name: 'Alligators', ...extra }, null, 2)}\n`
  );
}

/** What the Maude window's own fetch carries and no other local client can be made to send. */
const FROM_WINDOW = { 'sec-fetch-site': 'same-origin' };

/** A route reply, read loosely. */
type Reply = { ok?: boolean; reason?: string; state?: string; project?: string; error?: string };

const readConfig = () => JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));

function routes(over: { localFormat?: number } = {}) {
  const repoRoot = join(tmp, 'repo');
  const cloudApi = createCloudEndpoints({ paths: { repoRoot, designRoot } });
  const specs = createCloudMoveRoutes({
    designRoot,
    projectName: () => readConfig().name ?? null,
    localFormat: () => over.localFormat ?? readConfig().formatVersion ?? 1,
    cloud: cloudApi,
    pollMs: 5,
    activeTimeoutMs: 2000,
  }).map(guardTableRoute);
  const find = (method: string) => {
    const s = specs.find((x) => x.method === method && x.path === '/_api/cloud/move');
    if (!s) throw new Error(`no ${method} spec`);
    return s;
  };
  /** A POST exactly as sent — no browser header unless `headers` names one (curl, an agent). */
  const send = async (body: unknown = {}, headers: Record<string, string> = {}) => {
    const res = await find('POST').handle(
      new Request('http://127.0.0.1:4399/_api/cloud/move', {
        method: 'POST',
        headers: { host: '127.0.0.1:4399', 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    );
    return { status: res.status, body: (await res.json().catch(() => null)) as Reply };
  };
  /** A POST from the Maude window: a browser stamps Sec-Fetch-Site on its own fetch (S6.0c). */
  const post = (body: unknown = {}, headers: Record<string, string> = {}) =>
    send(body, { ...FROM_WINDOW, ...headers });
  const get = async () => {
    const res = await find('GET').handle(
      new Request('http://127.0.0.1:4399/_api/cloud/move', { headers: { host: '127.0.0.1:4399' } }),
      {}
    );
    return (await res.json()) as Reply;
  };
  const settle = async () => {
    for (let i = 0; i < 400; i++) {
      const s = await get();
      if (s.state === 'ready' || s.state === 'failed') return s;
      await Bun.sleep(5);
    }
    throw new Error('the move never settled');
  };
  return { specs, post, send, get, settle };
}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  tmp = mkdtempSync(join(tmpdir(), 'cloud-move-'));
  designRoot = join(tmp, 'repo', '.design');
  mkdirSync(designRoot, { recursive: true });
  process.env.MAUDE_CLOUD_URL = CLOUD;
  process.env.MAUDE_CLOUD_CONFIG = join(tmp, 'machine', 'cloud.json');
  process.env.HUBS_CONFIG_PATH = join(tmp, 'machine', 'hubs.json');
  process.env.MAUDE_MACHINE_FILE = join(tmp, 'machine', 'machine.json');
  mkdirSync(join(tmp, 'machine'));
  writeConfig();
  Object.assign(fake, {
    createStatus: null,
    pendingPolls: 1,
    cellRefuses: false,
    hubFormat: 1,
    events: [],
    formatBodies: [],
    linkedAtFormat: [],
  });
  polls = 0;
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

afterAll(() => {
  cell.stop(true);
  cloud.stop(true);
});

const creates = () => fake.events.filter((e) => e === 'create').length;

// ── refusals ────────────────────────────────────────────────────────────────

describe('POST /_api/cloud/move — refusals leave the project local', () => {
  test('signed out → 401 signed-out, nothing asked of the cloud, GET stays idle', async () => {
    const r = routes();
    expect(await r.post()).toEqual({ status: 401, body: { ok: false, reason: 'signed-out' } });
    expect(creates()).toBe(0);
    expect(await r.get()).toEqual({ state: 'idle' });
  });

  test('a token the cloud no longer takes → 401 signed-out', async () => {
    writeFileSync(
      process.env.MAUDE_CLOUD_CONFIG as string,
      JSON.stringify({ url: CLOUD, token: 'mpt_revoked', connectedAt: 1 })
    );
    const r = routes();
    expect(await r.post()).toEqual({ status: 401, body: { ok: false, reason: 'signed-out' } });
    expect(await r.get()).toEqual({ state: 'idle' });
  });

  test('trial ended → 402 plan with the contract words', async () => {
    signIn();
    fake.createStatus = 402;
    const r = routes();
    expect(await r.post()).toEqual({
      status: 402,
      body: { ok: false, reason: 'plan', error: 'Choose a plan to keep editing.' },
    });
    expect(readConfig().linkedHub).toBeUndefined();
    expect(await r.get()).toEqual({ state: 'idle' });
  });

  test('already linked to another hub → 409 linked-elsewhere, before any cloud call', async () => {
    signIn();
    writeConfig({ linkedHub: { url: 'https://team.example.com', linkedAt: 1 } });
    const r = routes();
    expect(await r.post()).toEqual({
      status: 409,
      body: { ok: false, reason: 'linked-elsewhere' },
    });
    expect(fake.events).toEqual([]);
    expect(readConfig().linkedHub.url).toBe('https://team.example.com');
  });

  test('cloud down → 503 offline; the retry starts the move', async () => {
    signIn();
    fake.createStatus = 503;
    const r = routes();
    expect(await r.post()).toEqual({ status: 503, body: { ok: false, reason: 'offline' } });
    expect(await r.get()).toEqual({ state: 'idle' });
    fake.createStatus = null;
    const again = await r.post();
    expect(again).toEqual({
      status: 200,
      body: { ok: true, project: 'alligators', state: 'provisioning' },
    });
    expect((await r.settle()).state).toBe('ready');
  });

  test('cloud unreachable → 503 offline', async () => {
    signIn();
    process.env.MAUDE_CLOUD_URL = 'http://127.0.0.1:9';
    writeFileSync(
      process.env.MAUDE_CLOUD_CONFIG as string,
      JSON.stringify({ url: 'http://127.0.0.1:9', token: 'mpt_test', connectedAt: 1 })
    );
    const r = routes();
    expect(await r.post()).toEqual({ status: 503, body: { ok: false, reason: 'offline' } });
  });

  test('a name that is not a string → 400', async () => {
    signIn();
    const r = routes();
    expect((await r.post({ name: 42 })).status).toBe(400);
    expect(creates()).toBe(0);
  });
});

// ── the move ────────────────────────────────────────────────────────────────

describe('POST /_api/cloud/move — the move, idempotent per folder', () => {
  test('provisioning → ready: one cloud project, linked, credential stored, no secret in _state', async () => {
    signIn();
    const r = routes();
    const first = await r.post();
    expect(first).toEqual({
      status: 200,
      body: { ok: true, project: 'alligators', state: 'provisioning' },
    });
    expect(fake.events).toContain('name:Alligators'); // the name defaults to config.json's
    const done = await r.settle();
    expect(done).toEqual({ state: 'ready', project: 'alligators' });
    expect(readConfig().linkedHub.url).toBe(CELL);
    const hubs = JSON.parse(readFileSync(process.env.HUBS_CONFIG_PATH as string, 'utf8'));
    expect(Object.keys(hubs.hubs)).toContain(CELL);

    const file = join(designRoot, '_state', 'cloud-move.json');
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf8');
    for (const secret of ['mpt_', 'ptok_', 'hubtok_']) expect(raw).not.toContain(secret);
    // the progress file is runtime state: the file plane never ships it to the cloud
    expect(isRuntimeStateRel('.design/_state/cloud-move.json')).toBe(true);

    // repeat after ready = the same answer, and still one cloud project
    expect(await r.post()).toEqual({
      status: 200,
      body: { ok: true, project: 'alligators', state: 'ready' },
    });
    expect(creates()).toBe(1);
  });

  test('a double call (sequential and concurrent) creates ONE cloud project and answers the same job', async () => {
    signIn();
    fake.pendingPolls = 20;
    const r = routes();
    const [a, b] = await Promise.all([r.post(), r.post()]);
    expect(a).toEqual(b);
    expect(a.body).toEqual({ ok: true, project: 'alligators', state: 'provisioning' });
    const c = await r.post();
    expect(c.body).toEqual({ ok: true, project: 'alligators', state: 'provisioning' });
    expect(creates()).toBe(1);
    expect((await r.settle()).state).toBe('ready');
    expect(creates()).toBe(1);
  });

  test('a new server for the same folder continues the job — no second cloud project', async () => {
    signIn();
    // the server that started the move is gone (restart): the file says provisioning, nobody runs it
    mkdirSync(join(designRoot, '_state'));
    writeFileSync(
      join(designRoot, '_state', 'cloud-move.json'),
      JSON.stringify({
        v: 1,
        state: 'provisioning',
        project: 'alligators',
        name: 'Alligators',
        startedAt: 1,
        updatedAt: 1,
      })
    );
    const second = routes();
    const stale = await second.get();
    expect(stale.state).toBe('failed');
    expect(stale.project).toBe('alligators');
    expect((await second.post()).body).toEqual({
      ok: true,
      project: 'alligators',
      state: 'provisioning',
    });
    expect((await second.settle()).state).toBe('ready');
    expect(creates()).toBe(0);
  });

  test('a failure leaves the project local and failed with words; the retry resumes it', async () => {
    signIn();
    fake.cellRefuses = true;
    const r = routes();
    await r.post();
    const failed = await r.settle();
    expect(failed.state).toBe('failed');
    expect(failed.project).toBe('alligators');
    expect(typeof failed.error).toBe('string');
    expect(failed.error.length).toBeGreaterThan(10);
    expect(readConfig().linkedHub).toBeUndefined();

    fake.cellRefuses = false;
    expect((await r.post()).body.state).toBe('provisioning');
    expect((await r.settle()).state).toBe('ready');
    expect(creates()).toBe(1);
  });

  test('a format-2 folder raises the hub marker BEFORE the link (the first seed-up)', async () => {
    signIn();
    writeConfig({ formatVersion: 2 });
    const r = routes();
    await r.post();
    expect((await r.settle()).state).toBe('ready');
    expect(fake.formatBodies).toEqual([{ formatVersion: 2 }]);
    expect(fake.linkedAtFormat).toEqual([false]);
  });

  test('a format-1 folder never touches the hub marker', async () => {
    signIn();
    const r = routes();
    await r.post();
    expect((await r.settle()).state).toBe('ready');
    expect(fake.events).not.toContain('format');
  });
});

// ── the window only (S6.0c) ─────────────────────────────────────────────────

describe('POST /_api/cloud/move — the Maude window only (S6.0c)', () => {
  const jobFile = () => join(designRoot, '_state', 'cloud-move.json');

  // curl / `maude design curl-local` / an agent's script send no Sec-Fetch-Site; another local
  // page (a project on another port, Home) is `same-site`; `none` is a typed URL, never a fetch.
  for (const [who, headers] of [
    ['a local client without browser headers (curl, an agent)', {}],
    ['a page on another loopback port', { 'sec-fetch-site': 'same-site' }],
    ['a navigation, not the window’s fetch', { 'sec-fetch-site': 'none' }],
  ] as const) {
    test(`${who} → 403, nothing provisioned, the cloud never called`, async () => {
      signIn();
      const r = routes();
      const res = await r.send({ name: 'Exfil' }, headers);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ ok: false, reason: 'window-only' });
      expect(fake.events).toEqual([]);
      expect(existsSync(jobFile())).toBe(false);
      expect(await r.get()).toEqual({ state: 'idle' });
      expect(readConfig().linkedHub).toBeUndefined();
    });
  }

  test('a failed move on file is not resumed from outside the window', async () => {
    signIn();
    mkdirSync(join(designRoot, '_state'), { recursive: true });
    const failed = {
      v: 1,
      state: 'failed',
      project: 'alligators',
      name: 'Alligators',
      error: 'x',
      startedAt: 1,
      updatedAt: 1,
    };
    writeFileSync(jobFile(), JSON.stringify(failed));
    const r = routes();
    expect((await r.send()).status).toBe(403);
    await Bun.sleep(20);
    expect(fake.events).toEqual([]);
    expect(JSON.parse(readFileSync(jobFile(), 'utf8'))).toEqual(failed);
  });

  test('the window’s own fetch (Sec-Fetch-Site: same-origin) starts the move', async () => {
    signIn();
    const r = routes();
    const res = await r.send({}, FROM_WINDOW);
    expect(res).toEqual({
      status: 200,
      body: { ok: true, project: 'alligators', state: 'provisioning' },
    });
    expect((await r.settle()).state).toBe('ready');
  });

  test('GET (status) stays open to a local client — it carries no credential', async () => {
    signIn();
    const r = routes();
    await r.post();
    const s = await r.settle();
    expect(s).toEqual({ state: 'ready', project: 'alligators' });
    expect(JSON.stringify(s)).not.toMatch(/mpt_|ptok_|hubtok_/);
    expect(readFileSync(jobFile(), 'utf8')).not.toMatch(/mpt_|ptok_|hubtok_/);
  });
});

// ── origin ──────────────────────────────────────────────────────────────────

describe('/_api/cloud/move — main origin only', () => {
  const tableSpecs = allSpecs(stubDeps());
  test('in the route table, origin main, in neither canvas allowlist', () => {
    const mine = tableSpecs.filter((s: RouteSpec) => s.path === '/_api/cloud/move');
    expect(mine.map((s) => `${s.method} ${s.origin}`).sort()).toEqual(['GET main', 'POST main']);
    expect(mountRoutes(tableSpecs).canvasPaths).not.toContain('/_api/cloud/move');
    expect(CANVAS_SAFE_API.has('/_api/cloud/move')).toBe(false);
  });

  test('a cross-site write and a rebound Host are refused before the handler runs', async () => {
    signIn();
    const r = routes();
    expect((await r.post({}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await r.post({}, { host: 'evil.example' })).status).toBe(403);
    expect(creates()).toBe(0);
  });
});
