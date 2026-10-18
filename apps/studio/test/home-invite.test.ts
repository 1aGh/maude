// S6.5 — Home's invite proxy (contract S6-S9-signin-invite-home §5.3): `/_home/invite/peek` shows
// what the public invite page shows, `/_home/invite/accept` trades the profile's device token for a
// handoff code — the token never reaches the page, an other-account 403 passes through unchanged.
// Against a fake control plane in temp config dirs; never the real cloud or ~/.config/maude.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { homeFetch, homeReq } from './_home-fixtures.ts';

const ID = '0123abcd-0000-4000-8000-00000000abcd';
const DEAD = '0123abcd-0000-4000-8000-00000000dead';
const GONE = {
  reason: 'gone',
  error: 'This invitation link is not valid. Ask the person who invited you for a new one.',
};

let plane: ReturnType<typeof Bun.serve>;
let down = false;
let acceptAnswer: { status: number; body: unknown } = { status: 200, body: null };
const seen: Array<{ url: string; method: string; auth: string | null; access: string | null }> = [];
const saved = {
  url: process.env.MAUDE_CLOUD_URL,
  cfg: process.env.MAUDE_CLOUD_CONFIG,
  xdg: process.env.XDG_CONFIG_HOME,
};

beforeAll(() => {
  plane = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      seen.push({
        url: req.url,
        method: req.method,
        auth: req.headers.get('authorization'),
        access: req.headers.get('x-maude-access'),
      });
      if (down) return new Response('boom', { status: 503 });
      if (url.pathname === `/api/invites/${ID}/peek`)
        return Response.json({
          projectName: 'Poster Co',
          fromName: 'Tereza',
          email: 'you@work-studio.test',
          role: 'member',
          canvas: { path: 'ui/poster.tsx', name: 'poster' },
          thread: 'c-12',
          extra: 'never forwarded',
        });
      if (url.pathname === `/api/invites/${DEAD}/peek`) return Response.json(GONE, { status: 404 });
      if (url.pathname === `/api/invites/${ID}/accept`)
        return Response.json(acceptAnswer.body, { status: acceptAnswer.status });
      if (url.pathname.endsWith('/peek'))
        return Response.json(
          { reason: 'rate-limited', error: 'Too many attempts.' },
          { status: 429 }
        );
      return Response.json(GONE, { status: 404 });
    },
  });
  process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${plane.port}`;
  const cfgHome = mkdtempSync(join(tmpdir(), 'maude-home-invite-'));
  process.env.XDG_CONFIG_HOME = cfgHome;
  process.env.MAUDE_CLOUD_CONFIG = join(cfgHome, 'default-cloud.json'); // default: signed out
  mkdirSync(join(cfgHome, 'maude', 'profiles', 'work'), { recursive: true });
  writeFileSync(
    join(cfgHome, 'maude', 'profiles', 'work', 'cloud.json'),
    JSON.stringify({ url: process.env.MAUDE_CLOUD_URL, token: 'mpt_work_secret' })
  );
});

beforeEach(() => {
  down = false;
  seen.length = 0;
  acceptAnswer = {
    status: 200,
    body: {
      code: `mhc_${'ab'.repeat(16)}`,
      landing: { project: 'poster-co', canvas: 'ui/poster.tsx', thread: 'c-12' },
    },
  };
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

const f = homeFetch();
async function page(path: string, body: unknown) {
  const r = await f(homeReq(path, { method: 'POST', body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> };
}

describe('/_home/invite/peek', () => {
  test("the invite page's facts, nothing more", async () => {
    const r = await page('/_home/invite/peek', { id: ID });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      projectName: 'Poster Co',
      fromName: 'Tereza',
      email: 'you@work-studio.test',
      role: 'member',
      canvas: { path: 'ui/poster.tsx', name: 'poster' },
      thread: 'c-12',
    });
    // no credential is sent for a peek
    expect(seen.at(-1)?.auth).toBeNull();
  });

  test('a dead invite is the cloud’s one 404', async () => {
    const r = await page('/_home/invite/peek', { id: DEAD });
    expect(r.status).toBe(404);
    expect(r.body).toEqual(GONE);
  });

  test('an id outside the grammar is refused before the cloud is asked', async () => {
    for (const id of ['../x', 'ABCD', `${ID}/../../api/home`, '', undefined, 7]) {
      const n = seen.length;
      expect([id, (await page('/_home/invite/peek', { id })).status]).toEqual([id, 400]);
      expect(seen.length).toBe(n);
    }
  });

  test('rate limit passes through; an unreachable cloud is 502 with words', async () => {
    const other = '0123abcd-0000-4000-8000-000000000000';
    expect((await page('/_home/invite/peek', { id: other })).status).toBe(429);
    down = true;
    const r = await page('/_home/invite/peek', { id: ID });
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('/_home/invite/accept', () => {
  test('returns a handoff code and the landing — never the device token', async () => {
    const r = await page('/_home/invite/accept', { id: ID, profile: 'work' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      code: `mhc_${'ab'.repeat(16)}`,
      landing: { project: 'poster-co', canvas: 'ui/poster.tsx', thread: 'c-12' },
    });
    expect(JSON.stringify(r.body)).not.toContain('mpt_');
    const call = seen.at(-1);
    expect(call?.method).toBe('POST');
    expect(call?.auth).toBe('Bearer mpt_work_secret');
    expect(call?.access).toBe('2');
    expect(call?.url).not.toContain('mpt_');
  });

  test("another account's 403 passes through unchanged", async () => {
    acceptAnswer = {
      status: 403,
      body: { reason: 'other-account', email: 'tereza-invited@this-address.test' },
    };
    const r = await page('/_home/invite/accept', { id: ID, profile: 'work' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ reason: 'other-account', email: 'tereza-invited@this-address.test' });
  });

  test('gone / version / rate refusals pass through', async () => {
    acceptAnswer = { status: 404, body: GONE };
    let r = await page('/_home/invite/accept', { id: ID, profile: 'work' });
    expect([r.status, r.body]).toEqual([404, GONE]);
    acceptAnswer = { status: 426, body: { reason: 'update-required', error: 'Update Maude.' } };
    r = await page('/_home/invite/accept', { id: ID, profile: 'work' });
    expect([r.status, r.body]).toEqual([
      426,
      { reason: 'update-required', error: 'Update Maude.' },
    ]);
    acceptAnswer = { status: 401, body: { reason: 'signed-out' } };
    r = await page('/_home/invite/accept', { id: ID, profile: 'work' });
    expect([r.status, r.body]).toEqual([401, { ok: false, reason: 'signed-out' }]);
  });

  test('a signed-out profile is 401 without asking the cloud', async () => {
    for (const profile of ['default', 'nobody']) {
      const n = seen.length;
      const r = await page('/_home/invite/accept', { id: ID, profile });
      expect([profile, r.status, r.body]).toEqual([
        profile,
        401,
        { ok: false, reason: 'signed-out' },
      ]);
      expect(seen.length).toBe(n);
    }
  });

  test('a bad id or profile is 400 without asking the cloud', async () => {
    const n = seen.length;
    for (const body of [{ id: 'x', profile: 'work' }, { id: ID, profile: '../work' }, { id: ID }])
      expect([body, (await page('/_home/invite/accept', body)).status]).toEqual([body, 400]);
    expect(seen.length).toBe(n);
  });

  test('a malformed answer from the cloud is not forwarded', async () => {
    acceptAnswer = { status: 200, body: { code: 'mpt_leaked_token', landing: { project: 'p' } } };
    const r = await page('/_home/invite/accept', { id: ID, profile: 'work' });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain('mpt_');
    acceptAnswer = {
      status: 200,
      body: { code: `mhc_${'ab'.repeat(16)}`, landing: { project: 'p', thread: 't' } },
    };
    // a thread without its canvas is dropped
    expect((await page('/_home/invite/accept', { id: ID, profile: 'work' })).body.landing).toEqual({
      project: 'p',
    });
  });
});
