// S9.20b (decision v2-lead-plan-words-via-home-route) — the account's plan reaches Settings ›
// Account from the CLOUD, never from a sum this Mac does:
//  · `GET /_api/cloud/plan` reads cloud `GET /api/home` `account.plan` with the device token;
//  · `/_api/cloud/status` carries the same `plan` (null when signed out);
//  · only `{ state, daysLeft, name }` survives — any other field the control plane sends is dropped;
//  · a cloud 401 is a plain read failure: the stored device credential stays;
//  · the route is MAIN ORIGIN ONLY: the canvas origin of a real server never reaches it, and a
//    request with no device token is refused without a byte leaving this Mac.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { cleanPlan, createCloudEndpoints } from '../cloud/endpoints.ts';
import { guardTableRoute } from '../http.ts';
import { createCloudPlanRoutes } from '../routes/cloud-plan.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

type Seen = { path: string; auth: string | null };
const seen: Seen[] = [];
let stub: ReturnType<typeof Bun.serve> | null = null;
let cloud = '';
let scratch = '';
let answer: { status: number; body: unknown } = { status: 200, body: {} };
const procs: Subprocess[] = [];

const HOME_BODY = {
  account: {
    email: 'me@example.com',
    plan: {
      state: 'trialing',
      daysLeft: 12,
      name: 'Free trial',
      // what the page must never see, were a control plane to send it
      endsAt: 1_900_000_000_000,
      customer: 'cus_secret',
    },
  },
  projects: [],
  shared: [],
};

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maude-cloud-plan-'));
  stub = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const u = new URL(req.url);
      seen.push({ path: u.pathname, auth: req.headers.get('authorization') });
      if (u.pathname === '/api/home') return Response.json(answer.body, { status: answer.status });
      return Response.json({ error: 'not stubbed' }, { status: 404 });
    },
  });
  cloud = `http://127.0.0.1:${stub.port}`;
  process.env.MAUDE_CLOUD_URL = cloud;
});
afterAll(async () => {
  stub?.stop(true);
  for (const p of procs) await killProc(p);
  rmSync(scratch, { recursive: true, force: true });
  delete process.env.MAUDE_CLOUD_URL;
});
beforeEach(() => {
  seen.length = 0;
  answer = { status: 200, body: HOME_BODY };
});

const cfg = (name: string) => join(scratch, `${name}.json`);
const signIn = (p: string, token = 'mpt_device_token') =>
  writeFileSync(p, JSON.stringify({ url: cloud, token, email: 'me@example.com', connectedAt: 1 }));
const lane = (p: string) =>
  createCloudEndpoints({
    paths: { repoRoot: scratch, designRoot: join(scratch, '.design') },
    cloudConfigPath: p,
  });

describe('the plan read', () => {
  test('reads /api/home with the device token; only state, days left and name survive', async () => {
    const p = cfg('a');
    signIn(p);
    const r = await lane(p).plan();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      ok: true,
      plan: { state: 'trialing', daysLeft: 12, name: 'Free trial' },
    });
    expect(seen).toEqual([{ path: '/api/home', auth: 'Bearer mpt_device_token' }]);
    expect(JSON.stringify(r.json)).not.toContain('cus_secret');
  });

  test('no device token: refused, and nothing leaves this Mac', async () => {
    const r = await lane(cfg('nobody')).plan();
    expect(r.status).toBe(401);
    expect((r.json as { reason?: string }).reason).toBe('signed-out');
    expect(seen).toEqual([]);
  });

  test('a cloud 401 is a read failure — the device credential is NOT deleted', async () => {
    const p = cfg('revoked');
    signIn(p);
    answer = { status: 401, body: { reason: 'signed-out' } };
    const r = await lane(p).plan();
    expect(r.status).toBe(401);
    expect(existsSync(p)).toBe(true);
  });

  test('one read per five minutes per token; a new sign-in reads again', async () => {
    const p = cfg('cache');
    signIn(p);
    const api = lane(p);
    await api.plan();
    await api.plan();
    expect(seen.length).toBe(1);
    signIn(p, 'mpt_other_account');
    await api.plan();
    expect(seen.map((s) => s.auth)).toEqual([
      'Bearer mpt_device_token',
      'Bearer mpt_other_account',
    ]);
  });

  test('status carries the plan when signed in, null when not', async () => {
    const p = cfg('status');
    signIn(p);
    const on = (await lane(p).statusWithPlan()).json as Record<string, unknown>;
    expect(on.connected).toBe(true);
    expect(on.plan).toEqual({ state: 'trialing', daysLeft: 12, name: 'Free trial' });
    unlinkSync(p);
    seen.length = 0;
    const off = (await lane(p).statusWithPlan()).json as Record<string, unknown>;
    expect(off.connected).toBe(false);
    expect(off.plan).toBeNull();
    expect(seen).toEqual([]);
  });

  test('cleanPlan: an unknown state or a garbage value is no plan; odd fields are dropped', () => {
    expect(cleanPlan({ state: 'paid-forever', daysLeft: 3 })).toBeNull();
    expect(cleanPlan('trialing')).toBeNull();
    expect(cleanPlan({ state: 'ended', daysLeft: -4, name: 'x'.repeat(80) })).toEqual({
      state: 'ended',
      daysLeft: null,
      name: null,
    });
  });
});

describe('GET /_api/cloud/plan — main origin only', () => {
  test('the table spec is main-origin; a cross-site browser read is refused before the lane', async () => {
    let asked = 0;
    const [spec] = createCloudPlanRoutes({
      cloud: {
        plan: async () => {
          asked++;
          return { status: 200, json: { ok: true, plan: null } };
        },
      },
    });
    expect(spec.origin).toBe('main');
    const guarded = guardTableRoute(spec);
    const res = await guarded.handle(
      new Request('http://localhost:4399/_api/cloud/plan', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
      {}
    );
    expect(res.status).toBe(403);
    expect(asked).toBe(0);
  });

  test('a real server: the canvas origin never reaches it; no device token → 401; signed in → the plan', async () => {
    const { root, designRoot } = makeSandbox();
    const cloudCfg = join(root, 'cloud.json');
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_CANVAS_ORIGIN_SPLIT: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_CLOUD_URL: cloud,
      MAUDE_CLOUD_CONFIG: cloudCfg,
      HUBS_CONFIG_PATH: join(root, 'hubs.json'),
    });
    procs.push(proc);
    let canvasOrigin = '';
    for (let i = 0; i < 40 && !canvasOrigin; i++) {
      try {
        canvasOrigin =
          JSON.parse(await Bun.file(join(designRoot, '_server.json')).text()).canvasOrigin ?? '';
      } catch {
        /* not written yet */
      }
      if (!canvasOrigin) await Bun.sleep(50);
    }
    expect(canvasOrigin).toBeTruthy();
    const main = `http://localhost:${port}`;
    const get = (base: string, path: string) =>
      fetch(base + path, { signal: AbortSignal.timeout(5000) });

    // signed in, so a leak WOULD spend the token — the canvas origin still gets nothing
    signIn(cloudCfg);
    seen.length = 0;
    const fromCanvas = await get(canvasOrigin, '/_api/cloud/plan');
    expect(fromCanvas.status).not.toBe(200);
    expect(await fromCanvas.text()).not.toContain('trialing');
    expect(seen).toEqual([]);

    const plan = await get(main, '/_api/cloud/plan');
    expect(plan.status).toBe(200);
    expect(await plan.json()).toEqual({
      ok: true,
      plan: { state: 'trialing', daysLeft: 12, name: 'Free trial' },
    });
    const status = (await (await get(main, '/_api/cloud/status')).json()) as Record<
      string,
      unknown
    >;
    expect(status.plan).toEqual({ state: 'trialing', daysLeft: 12, name: 'Free trial' });

    unlinkSync(cloudCfg);
    seen.length = 0;
    const none = await get(main, '/_api/cloud/plan');
    expect(none.status).toBe(401);
    expect(seen).toEqual([]);
    await killProc(proc);
  }, 40_000);
});
