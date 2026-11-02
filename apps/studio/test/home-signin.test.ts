// S6.5 — Home signs in to Maude Cloud by itself (contract S6-S9-signin-invite-home §5.1). Against a
// fake control plane in temp config dirs: the device code never leaves the Home process, only the
// profile Rust registered (bearer-only `/_home/internal/signin/profile`) can be written, a second
// start cancels the first, a wrong/old state changes nothing, the own 10-minute wait ends in
// `expired`. Never touches the real cloud, ~/.config/maude or the keychain.

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHomeSignIn, SIGNIN_WAIT_MS } from '../home/signin.ts';
import { HOST, homeFetch, homeReq, PAGE_SECRET, TOKEN } from './_home-fixtures.ts';

// ── the fake control plane ───────────────────────────────────────────────────────────────────
let plane: ReturnType<typeof Bun.serve>;
let down = false;
/** ms the token endpoint waits before answering (a slow cloud, for the in-flight race) */
let slowToken = 0;
let codes = 0;
/** device_code → 'pending' | 'approved' | 'expired' */
const codeState = new Map<string, string>();
let landing: unknown = { project: 'poster-co', canvas: 'ui/poster.tsx', thread: 'c-12' };
const polled: string[] = [];
const raw: Array<{ url: string; body: string }> = [];

const saved = {
  url: process.env.MAUDE_CLOUD_URL,
  cfg: process.env.MAUDE_CLOUD_CONFIG,
  xdg: process.env.XDG_CONFIG_HOME,
};
let cfgHome = '';

beforeAll(() => {
  plane = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const text = await req.text();
      raw.push({ url: req.url, body: text });
      if (down) return new Response('boom', { status: 503 });
      if (path === '/auth/device/code') {
        codes += 1;
        const device = `mdc_${String(codes).padStart(8, '0')}`;
        codeState.set(device, 'pending');
        return Response.json({
          device_code: device,
          user_code: `ABCD-${String(1000 + codes)}`,
          verification_url: `http://127.0.0.1:${plane.port}/activate?code=ABCD-${1000 + codes}`,
          interval: 5,
          expires_in: 900,
        });
      }
      if (path === '/auth/device/token') {
        const device = String(JSON.parse(text).device_code);
        polled.push(device);
        if (slowToken) await Bun.sleep(slowToken);
        const s = codeState.get(device);
        if (!s || s === 'expired') return Response.json({ error: 'expired' }, { status: 400 });
        if (s === 'pending') return Response.json({ pending: true, interval: 5 }, { status: 202 });
        codeState.delete(device); // burned, as device-auth.mjs does
        return Response.json({
          token: `mpt_${device.slice(4)}secret`,
          account: { email: 'you@work-studio.test' },
          ...(landing ? { landing } : {}),
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${plane.port}`;
});

beforeEach(() => {
  down = false;
  slowToken = 0;
  landing = { project: 'poster-co', canvas: 'ui/poster.tsx', thread: 'c-12' };
  polled.length = 0;
  raw.length = 0;
  cfgHome = mkdtempSync(join(tmpdir(), 'maude-home-signin-'));
  process.env.MAUDE_CLOUD_CONFIG = join(cfgHome, 'default-cloud.json');
  process.env.XDG_CONFIG_HOME = cfgHome;
});

afterAll(() => {
  plane.stop(true);
  for (const [k, v] of [
    ['MAUDE_CLOUD_URL', saved.url],
    ['MAUDE_CLOUD_CONFIG', saved.cfg],
    ['XDG_CONFIG_HOME', saved.xdg],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
function rig() {
  let t = 1_000_000;
  const signin = createHomeSignIn({ now: () => t });
  const f = homeFetch({ signin });
  const page = async (path: string, body: unknown) => {
    const r = await f(homeReq(path, { method: 'POST', body: JSON.stringify(body) }));
    return {
      status: r.status,
      body: (await r.json().catch(() => null)) as Record<string, unknown>,
    };
  };
  /** What Rust sends (home.rs register_sign_in_profile). */
  const rust = async (body: unknown, headers: Record<string, string> = {}) =>
    (
      await f(
        new Request(`http://${HOST}/_home/internal/signin/profile`, {
          method: 'POST',
          headers: {
            host: HOST,
            'x-maude-home': '1',
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(body),
        })
      )
    ).status;
  return { page, rust, advance: (ms: number) => (t += ms) };
}

const profileFile = (id: string) => join(cfgHome, 'maude', 'profiles', id, 'cloud.json');
const deviceOf = (n: number) => `mdc_${String(n).padStart(8, '0')}`;
const approveLatest = () => codeState.set(deviceOf(codes), 'approved');

describe('the profile comes from Rust only', () => {
  test('start without a Rust registration is refused and asks the cloud nothing', async () => {
    const { page } = rig();
    const before = codes;
    const r = await page('/_home/cloud/signin/start', {});
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ ok: false });
    const r2 = await page('/_home/cloud/signin/start', { profile: 'default' });
    expect(r2.status).toBe(403);
    expect(codes).toBe(before);
  });

  test('the internal route takes only a profile id and an invite id, bearer only', async () => {
    const { rust } = rig();
    expect(await rust({ profile: 'work', invite: null })).toBe(200);
    for (const bad of [
      { profile: '../evil', invite: null },
      { profile: 'Work', invite: null },
      { profile: '', invite: null },
      { profile: 'a/b', invite: null },
      { profile: 'work', invite: 'not-an-invite' },
      { profile: 'work', invite: 'G'.repeat(36) },
      {},
    ])
      expect([bad, await rust(bad)]).toEqual([bad, 400]);
    // a page (page secret, browser headers) never registers a profile, even with the bearer
    expect(await rust({ profile: 'work', invite: null }, { 'sec-fetch-site': 'same-origin' })).toBe(
      403
    );
    expect(
      await rust({ profile: 'work', invite: null }, { authorization: `Bearer ${PAGE_SECRET}` })
    ).toBe(403);
  });

  test('start for any profile but the registered one is refused', async () => {
    const { page, rust } = rig();
    expect(await rust({ profile: 'work', invite: null })).toBe(200);
    const before = codes;
    for (const profile of ['default', 'other', '../work', 'work/../default'])
      expect([profile, (await page('/_home/cloud/signin/start', { profile })).status]).toEqual([
        profile,
        403,
      ]);
    expect(codes).toBe(before);
  });

  test('an invite other than the registered one is refused', async () => {
    const { page, rust } = rig();
    const invite = '0123abcd-0000-4000-8000-00000000abcd';
    expect(await rust({ profile: 'work', invite })).toBe(200);
    const other = '0123abcd-0000-4000-8000-00000000ffff';
    expect(
      (await page('/_home/cloud/signin/start', { profile: 'work', forInvite: other })).status
    ).toBe(403);
    expect(
      (await page('/_home/cloud/signin/start', { profile: 'work', forInvite: invite })).status
    ).toBe(200);
  });

  test('a registration older than the wait is refused', async () => {
    const { page, rust, advance } = rig();
    expect(await rust({ profile: 'work', invite: null })).toBe(200);
    advance(SIGNIN_WAIT_MS + 1);
    expect((await page('/_home/cloud/signin/start', { profile: 'work' })).status).toBe(403);
  });
});

describe('start → poll → done', () => {
  test('the page gets a user code and a state — never the device code', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    const r = await page('/_home/cloud/signin/start', { profile: 'work' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, expiresIn: 600 });
    expect(r.body.userCode).toBe(`ABCD-${1000 + codes}`);
    expect(String(r.body.state)).toMatch(/^[0-9a-f]{32}$/);
    expect(Object.keys(r.body).sort()).toEqual(['expiresIn', 'ok', 'state', 'userCode']);
    expect(JSON.stringify(r.body)).not.toContain('mdc_');
    // the client name the cloud's device list shows
    expect(raw.find((x) => x.url.endsWith('/auth/device/code'))?.body).toContain('Maude on ');
  });

  test('done writes the credential into the registered profile only', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    const { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
    expect((await page('/_home/cloud/signin/poll', { state })).body).toEqual({ status: 'pending' });
    expect(existsSync(profileFile('work'))).toBe(false);
    approveLatest();
    const done = await page('/_home/cloud/signin/poll', { state });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({
      status: 'done',
      email: 'you@work-studio.test',
      landing: { project: 'poster-co', canvas: 'ui/poster.tsx', thread: 'c-12' },
    });
    expect(JSON.stringify(done.body)).not.toContain('mpt_');
    const file = JSON.parse(readFileSync(profileFile('work'), 'utf8'));
    expect(file).toMatchObject({
      url: process.env.MAUDE_CLOUD_URL,
      token: `mpt_${deviceOf(codes).slice(4)}secret`,
      email: 'you@work-studio.test',
    });
    expect(statSync(profileFile('work')).mode & 0o777).toBe(0o600);
    // nothing else on this Mac changed
    expect(existsSync(process.env.MAUDE_CLOUD_CONFIG as string)).toBe(false);
    // polling again answers the same, without asking the cloud
    const n = polled.length;
    expect((await page('/_home/cloud/signin/poll', { state })).body).toMatchObject({
      status: 'done',
    });
    expect(polled.length).toBe(n);
    // the registration is spent: a new start needs a new one from Rust
    expect((await page('/_home/cloud/signin/start', { profile: 'work' })).status).toBe(403);
  });

  test('the default profile writes the 1.x cloud.json', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'default', invite: null });
    const { state } = (await page('/_home/cloud/signin/start', {})).body;
    approveLatest();
    expect((await page('/_home/cloud/signin/poll', { state })).body.status).toBe('done');
    expect(
      JSON.parse(readFileSync(process.env.MAUDE_CLOUD_CONFIG as string, 'utf8')).token
    ).toStartWith('mpt_');
  });

  test('a credential already in the profile is never overwritten', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    const { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
    mkdirSync(join(cfgHome, 'maude', 'profiles', 'work'), { recursive: true });
    writeFileSync(profileFile('work'), '{"url":"x","token":"mpt_someone_else"}');
    approveLatest();
    expect((await page('/_home/cloud/signin/poll', { state })).body).toEqual({ status: 'expired' });
    expect(readFileSync(profileFile('work'), 'utf8')).toContain('mpt_someone_else');
  });

  test('landing is kept only in its own shape; absent when the cloud sends none', async () => {
    const { page, rust } = rig();
    landing = { project: 'poster-co', canvas: 'ui/poster.tsx', thread: '"><x', email: 'z@z' };
    await rust({ profile: 'work', invite: null });
    let { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
    approveLatest();
    expect((await page('/_home/cloud/signin/poll', { state })).body.landing).toEqual({
      project: 'poster-co',
      canvas: 'ui/poster.tsx',
    });
    landing = null;
    await rust({ profile: 'second', invite: null });
    ({ state } = (await page('/_home/cloud/signin/start', { profile: 'second' })).body);
    approveLatest();
    const r = await page('/_home/cloud/signin/poll', { state });
    expect(r.body).toEqual({ status: 'done', email: 'you@work-studio.test' });
  });

  test('an unreachable cloud on start is 502 with words; on poll it stays pending', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    down = true;
    const r = await page('/_home/cloud/signin/start', { profile: 'work' });
    expect(r.status).toBe(502);
    expect(r.body).toEqual({
      ok: false,
      reason: 'unreachable',
      error: 'Maude Cloud could not be reached. Try again in a moment.',
    });
    down = false;
    const { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
    down = true;
    expect((await page('/_home/cloud/signin/poll', { state })).body).toEqual({ status: 'pending' });
  });
});

describe('state rules', () => {
  test('a wrong state is 409 and polls nothing', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    await page('/_home/cloud/signin/start', { profile: 'work' });
    const n = polled.length;
    for (const state of ['0'.repeat(32), 'nope', '', undefined, 42]) {
      const r = await page('/_home/cloud/signin/poll', { state });
      expect([state, r.status, r.body]).toEqual([state, 409, { reason: 'stale-state' }]);
    }
    expect(polled.length).toBe(n);
  });

  test('a second start cancels the first', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    const first = (await page('/_home/cloud/signin/start', { profile: 'work' })).body.state;
    const firstDevice = deviceOf(codes);
    const second = (await page('/_home/cloud/signin/start', { profile: 'work' })).body.state;
    expect(second).not.toBe(first);
    codeState.set(firstDevice, 'approved'); // the first page gets approved anyway
    expect((await page('/_home/cloud/signin/poll', { state: first })).status).toBe(409);
    expect((await page('/_home/cloud/signin/poll', { state: second })).body).toEqual({
      status: 'pending',
    });
    expect(polled).not.toContain(firstDevice);
    expect(existsSync(profileFile('work'))).toBe(false);
  });

  test('a poll in flight when the second start lands writes nothing', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    const first = (await page('/_home/cloud/signin/start', { profile: 'work' })).body.state;
    approveLatest();
    slowToken = 150;
    const inflight = page('/_home/cloud/signin/poll', { state: first });
    await Bun.sleep(30); // the cloud has the poll and is about to approve it
    const second = await page('/_home/cloud/signin/start', { profile: 'work' });
    expect(second.status).toBe(200);
    expect((await inflight).body).toEqual({ status: 'cancelled' });
    expect(existsSync(profileFile('work'))).toBe(false);
    slowToken = 0;
    expect((await page('/_home/cloud/signin/poll', { state: second.body.state })).body).toEqual({
      status: 'pending',
    });
  });

  test('a new Rust registration also ends the attempt in flight', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    const { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
    await rust({ profile: 'other', invite: null });
    expect((await page('/_home/cloud/signin/poll', { state })).status).toBe(409);
  });

  test('cancel with an old or wrong state is a no-op; with the current one it cancels', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    const { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
    for (const s of ['0'.repeat(32), 'x', undefined])
      expect((await page('/_home/cloud/signin/cancel', { state: s })).body).toEqual({ ok: true });
    expect((await page('/_home/cloud/signin/poll', { state })).body).toEqual({ status: 'pending' });
    expect((await page('/_home/cloud/signin/cancel', { state })).body).toEqual({ ok: true });
    approveLatest();
    const n = polled.length;
    expect((await page('/_home/cloud/signin/poll', { state })).body).toEqual({
      status: 'cancelled',
    });
    expect(polled.length).toBe(n);
    expect(existsSync(profileFile('work'))).toBe(false);
  });

  test('after the own 10-minute wait the attempt is expired, whatever the cloud says', async () => {
    const { page, rust, advance } = rig();
    await rust({ profile: 'work', invite: null });
    const { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
    advance(SIGNIN_WAIT_MS + 1);
    approveLatest();
    const n = polled.length;
    expect((await page('/_home/cloud/signin/poll', { state })).body).toEqual({ status: 'expired' });
    expect(polled.length).toBe(n);
    expect(existsSync(profileFile('work'))).toBe(false);
  });

  test('the cloud saying expired ends the attempt', async () => {
    const { page, rust } = rig();
    await rust({ profile: 'work', invite: null });
    const { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
    codeState.set(deviceOf(codes), 'expired');
    expect((await page('/_home/cloud/signin/poll', { state })).body).toEqual({ status: 'expired' });
  });
});

describe('nothing secret in a URL or a log', () => {
  test('device code, token and e-mail ride only in bodies and never reach a log line', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      spyOn(console, m)
    );
    try {
      const { page, rust } = rig();
      await rust({ profile: 'work', invite: null });
      const { state } = (await page('/_home/cloud/signin/start', { profile: 'work' })).body;
      await page('/_home/cloud/signin/poll', { state });
      approveLatest();
      await page('/_home/cloud/signin/poll', { state });
      const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
      for (const secret of ['mdc_', 'mpt_', 'you@work-studio.test', String(state)])
        expect(logged).not.toContain(secret);
      for (const r of raw) {
        expect(r.url).not.toContain('mdc_');
        expect(r.url).not.toContain('@');
        expect(r.url).not.toContain(String(state));
      }
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
