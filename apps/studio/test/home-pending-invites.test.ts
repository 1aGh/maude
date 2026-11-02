// gate-b-sec3b — Home › Shared with you: the invitations waiting for the signed-in account.
//
//   GET  /_home/cloud                      → `invited[]` beside `shared[]`: a project, the inviter's NAME, the canvas and
//                                            the role. The cloud sends no invite id and Home never invents one.
//   POST /_home/invite/pending/accept      {profile, projectId, canvas?} → {ok, code, landing}  (the cloud's
//                                            POST /api/invites/pending/accept with the profile's device token)
//   POST /_home/invite/pending/leave       {profile, projectId, canvas?} → {ok:true}
//
// Against a fake control plane in temp config dirs; never the real cloud or ~/.config/maude.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { homeRouteTable } from '../home/routes.ts';
import { homeDeps, homeFetch, homeReq } from './_home-fixtures.ts';

const GONE = {
  reason: 'gone',
  error: 'This invitation link is not valid. Ask the person who invited you for a new one.',
};
const CODE = `mhc_${'ab'.repeat(16)}`;

let plane: ReturnType<typeof Bun.serve>;
let invited: unknown[] = [];
let pendingAnswer: { status: number; body: unknown } = { status: 200, body: null };
let homeHits = 0;
const seen: Array<{
  path: string;
  method: string;
  auth: string | null;
  access: string | null;
  body: string;
}> = [];
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
        path: url.pathname,
        method: req.method,
        auth: req.headers.get('authorization'),
        access: req.headers.get('x-maude-access'),
        body: await req.text(),
      });
      if (url.pathname === '/api/home') {
        homeHits++;
        return Response.json({
          account: { email: 'you@work-studio.test' },
          projects: [],
          shared: [],
          invited,
        });
      }
      if (/^\/api\/invites\/pending\/(accept|leave)$/.test(url.pathname))
        return Response.json(pendingAnswer.body, { status: pendingAnswer.status });
      return Response.json(GONE, { status: 404 });
    },
  });
  process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${plane.port}`;
  const cfgHome = mkdtempSync(join(tmpdir(), 'maude-home-pending-'));
  process.env.XDG_CONFIG_HOME = cfgHome;
  process.env.MAUDE_CLOUD_CONFIG = join(cfgHome, 'default-cloud.json'); // default: signed out
  mkdirSync(join(cfgHome, 'maude', 'profiles', 'work'), { recursive: true });
  writeFileSync(
    join(cfgHome, 'maude', 'profiles', 'work', 'cloud.json'),
    JSON.stringify({ url: process.env.MAUDE_CLOUD_URL, token: 'mpt_work_secret' })
  );
});

beforeEach(() => {
  f = homeFetch(); // a fresh listing cache for every test
  seen.length = 0;
  homeHits = 0;
  invited = [];
  pendingAnswer = {
    status: 200,
    body: { code: CODE, landing: { project: 'poster-co', canvas: 'ui/poster.tsx' } },
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

// one Home fetch for the whole file, so the listing cache and the proxy share a process like the real one
let f = homeFetch();
async function page(path: string, body: unknown) {
  const r = await f(homeReq(path, { method: 'POST', body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> };
}
async function listing() {
  const r = await f(homeReq('/_home/cloud?profile=work'));
  return (await r.json()) as Record<string, unknown>;
}

describe('/_home/cloud › invited[]', () => {
  test('the pending invitations come through as names and facts, never an invite id', async () => {
    invited = [
      {
        projectId: 'alligators',
        projectName: 'Alligators brand',
        fromName: 'Tereza',
        canvas: { path: 'ui/poster.tsx', name: 'poster' },
        role: 'viewer',
        invitedAt: 1234,
        id: '0123abcd-0000-4000-8000-00000000abcd',
        inviteId: 'leak',
        email: 'secret@x.test',
      },
      {
        projectId: 'studio',
        projectName: 'Studio site',
        fromName: null,
        canvas: null,
        role: 'member',
      },
      { projectName: 'no project id' },
    ];
    const l = (await listing()) as { invited: Array<Record<string, unknown>> };
    expect(l.invited).toEqual([
      {
        projectId: 'alligators',
        projectName: 'Alligators brand',
        fromName: 'Tereza',
        canvas: { path: 'ui/poster.tsx', name: 'poster' },
        role: 'viewer',
        invitedAt: 1234,
      },
      {
        projectId: 'studio',
        projectName: 'Studio site',
        fromName: null,
        canvas: null,
        role: 'member',
        invitedAt: null,
      },
    ]);
    expect(JSON.stringify(l)).not.toContain('0123abcd');
    expect(JSON.stringify(l)).not.toContain('secret@x.test');
  });

  test('an older control plane (no invited key) is an empty list; signed out is too', async () => {
    invited = undefined as unknown as unknown[];
    expect(((await listing()) as { invited: unknown[] }).invited).toEqual([]);
    const r = await f(homeReq('/_home/cloud?profile=default'));
    expect(((await r.json()) as { invited: unknown[] }).invited).toEqual([]);
  });
});

describe('/_home/invite/pending/accept', () => {
  test('trades the profile’s device token for a code and landing; the project and canvas ride the body', async () => {
    const r = await page('/_home/invite/pending/accept', {
      profile: 'work',
      projectId: 'poster-co',
      canvas: 'ui/poster.tsx',
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      code: CODE,
      landing: { project: 'poster-co', canvas: 'ui/poster.tsx' },
    });
    expect(JSON.stringify(r.body)).not.toContain('mpt_');
    const call = seen.at(-1);
    expect(call).toMatchObject({
      path: '/api/invites/pending/accept',
      method: 'POST',
      auth: 'Bearer mpt_work_secret',
      access: '2',
    });
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      projectId: 'poster-co',
      canvas: 'ui/poster.tsx',
    });
  });

  test('a project-level invitation sends a null canvas', async () => {
    pendingAnswer = { status: 200, body: { code: CODE, landing: { project: 'studio' } } };
    const r = await page('/_home/invite/pending/accept', { profile: 'work', projectId: 'studio' });
    expect(r.status).toBe(200);
    expect(JSON.parse(seen.at(-1)?.body ?? '{}')).toEqual({ projectId: 'studio', canvas: null });
  });

  test('gone / version / rate refusals pass through; signed out is 401', async () => {
    pendingAnswer = { status: 404, body: GONE };
    let r = await page('/_home/invite/pending/accept', { profile: 'work', projectId: 'studio' });
    expect([r.status, r.body]).toEqual([404, GONE]);
    pendingAnswer = { status: 426, body: { reason: 'update-required', error: 'Update Maude.' } };
    r = await page('/_home/invite/pending/accept', { profile: 'work', projectId: 'studio' });
    expect([r.status, r.body]).toEqual([
      426,
      { reason: 'update-required', error: 'Update Maude.' },
    ]);
    pendingAnswer = { status: 429, body: { reason: 'rate-limited', error: 'Too many attempts.' } };
    r = await page('/_home/invite/pending/accept', { profile: 'work', projectId: 'studio' });
    expect(r.status).toBe(429);
    pendingAnswer = { status: 401, body: { reason: 'signed-out' } };
    r = await page('/_home/invite/pending/accept', { profile: 'work', projectId: 'studio' });
    expect([r.status, r.body]).toEqual([401, { ok: false, reason: 'signed-out' }]);
  });

  test('a signed-out profile, a bad profile or a bad project never reaches the cloud', async () => {
    const n = seen.length;
    for (const [body, status] of [
      [{ profile: 'default', projectId: 'studio' }, 401],
      [{ profile: '../work', projectId: 'studio' }, 400],
      [{ profile: 'work', projectId: '../x' }, 400],
      [{ profile: 'work', projectId: 'Studio' }, 400],
      [{ profile: 'work' }, 400],
      [{ profile: 'work', projectId: 'studio', canvas: 7 }, 400],
    ] as const)
      expect([body, (await page('/_home/invite/pending/accept', body)).status]).toEqual([
        body,
        status,
      ]);
    expect(seen.length).toBe(n);
  });

  test('a malformed cloud answer is not forwarded', async () => {
    pendingAnswer = { status: 200, body: { code: 'mpt_leaked_token', landing: { project: 'p' } } };
    const r = await page('/_home/invite/pending/accept', { profile: 'work', projectId: 'studio' });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain('mpt_');
  });
});

describe('/_home/invite/pending/leave', () => {
  test('declines with the device token and answers ok; the next listing is fetched fresh', async () => {
    await listing();
    const before = homeHits;
    await listing(); // cached for 60 s
    expect(homeHits).toBe(before);
    pendingAnswer = { status: 200, body: { ok: true } };
    const r = await page('/_home/invite/pending/leave', {
      profile: 'work',
      projectId: 'studio',
      canvas: null,
    });
    expect([r.status, r.body]).toEqual([200, { ok: true }]);
    expect(seen.at(-1)).toMatchObject({
      path: '/api/invites/pending/leave',
      auth: 'Bearer mpt_work_secret',
    });
    await listing();
    expect(homeHits).toBe(before + 1);
  });

  test('accepting drops the cached listing too', async () => {
    await listing();
    const before = homeHits;
    await page('/_home/invite/pending/accept', {
      profile: 'work',
      projectId: 'poster-co',
      canvas: 'ui/poster.tsx',
    });
    await listing();
    expect(homeHits).toBe(before + 1);
  });

  test('a gone invitation passes through; a signed-out profile is 401 without asking the cloud', async () => {
    pendingAnswer = { status: 404, body: GONE };
    const r = await page('/_home/invite/pending/leave', { profile: 'work', projectId: 'studio' });
    expect([r.status, r.body]).toEqual([404, GONE]);
    const n = seen.length;
    const s = await page('/_home/invite/pending/leave', {
      profile: 'default',
      projectId: 'studio',
    });
    expect([s.status, s.body]).toEqual([401, { ok: false, reason: 'signed-out' }]);
    expect(seen.length).toBe(n);
  });
});

test('both rows are page routes behind the page secret', () => {
  const kinds = new Map(homeRouteTable(homeDeps()).map((r) => [`${r.method} ${r.path}`, r.kind]));
  for (const row of ['POST /_home/invite/pending/accept', 'POST /_home/invite/pending/leave'])
    expect([row, kinds.get(row)]).toEqual([row, 'home']);
});
