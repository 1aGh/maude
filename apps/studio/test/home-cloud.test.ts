// V2-3.3 — `/_home/cloud` (V2-1.1 §5.7) against a stubbed control plane: `/api/home` when it exists,
// `GET /api/projects` when it 404s, the last good answer + `offline: true` when it is unreachable,
// 60 s cache, one `cloud.json` per profile. Never talks to the real cloud.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHomeCloud, profileCloudPath, profileHubsPath } from '../home/cloud.ts';
import { homeFetch, homeReq } from './_home-fixtures.ts';

let plane: ReturnType<typeof Bun.serve>;
let hasHome = true;
let down = false;
const seen: Array<{ path: string; auth: string | null }> = [];
/** every request's full URL and body — a handoff code must ride only in a POST body */
const raw: Array<{ url: string; method: string; body: string }> = [];
const saved = {
  url: process.env.MAUDE_CLOUD_URL,
  cfg: process.env.MAUDE_CLOUD_CONFIG,
  xdg: process.env.XDG_CONFIG_HOME,
  hubs: process.env.HUBS_CONFIG_PATH,
};

beforeAll(() => {
  plane = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      seen.push({ path, auth: req.headers.get('authorization') });
      const text = await req.text();
      raw.push({ url: req.url, method: req.method, body: text });
      if (down) return new Response('boom', { status: 503 });
      if (req.headers.get('authorization') === 'Bearer mpt_revoked')
        return new Response('no', { status: 401 });
      if (path === '/api/home' && hasHome)
        return Response.json({
          account: { email: 'you@work-studio.test' },
          projects: [
            {
              id: 'alligators',
              name: 'Alligators brand',
              role: 'owner',
              url: 'https://a.test',
              extra: 'x',
            },
          ],
          shared: [
            {
              projectId: 'nabor-2027',
              projectName: 'Nábor 2027',
              role: 'viewer',
              canvas: null,
              grantedAt: 1,
            },
          ],
        });
      if (path === '/api/projects')
        return Response.json({ projects: [{ id: 'alligators', name: 'Alligators brand' }] });
      // N-H1: one project this stub can open — the plane names itself as the project's cell
      if (path === '/projects/open' && text.includes('"cellproj"'))
        return Response.json({ token: 'mpt_cell', url: `http://127.0.0.1:${plane.port}` });
      if (path === '/auth/login')
        return Response.json({ token: 'hub_tok_work', user: { role: 'member' } });
      if (path === '/api/projects/current/v1/bootstrap')
        return Response.json({ projectId: 'cellproj', canvasGroups: ['ui'] });
      return new Response('not found', { status: 404 });
    },
  });
  process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${plane.port}`;
  const cfgHome = mkdtempSync(join(tmpdir(), 'maude-home-cloud-'));
  process.env.MAUDE_CLOUD_CONFIG = join(cfgHome, 'cloud.json');
  process.env.XDG_CONFIG_HOME = cfgHome;
  delete process.env.HUBS_CONFIG_PATH;
  writeFileSync(
    process.env.MAUDE_CLOUD_CONFIG,
    JSON.stringify({ url: process.env.MAUDE_CLOUD_URL, token: 'mpt_default' })
  );
  mkdirSync(join(cfgHome, 'maude', 'profiles', 'work'), { recursive: true });
  writeFileSync(
    join(cfgHome, 'maude', 'profiles', 'work', 'cloud.json'),
    JSON.stringify({ url: `${process.env.MAUDE_CLOUD_URL}/`, token: 'mpt_work' })
  );
  mkdirSync(join(cfgHome, 'maude', 'profiles', 'gone'), { recursive: true });
  writeFileSync(
    join(cfgHome, 'maude', 'profiles', 'gone', 'cloud.json'),
    JSON.stringify({ url: process.env.MAUDE_CLOUD_URL, token: 'mpt_revoked' })
  );
});

afterAll(() => {
  plane.stop(true);
  for (const [k, v] of [
    ['MAUDE_CLOUD_URL', saved.url],
    ['MAUDE_CLOUD_CONFIG', saved.cfg],
    ['XDG_CONFIG_HOME', saved.xdg],
    ['HUBS_CONFIG_PATH', saved.hubs],
  ] as const)
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

describe('profile → cloud.json', () => {
  test('default is the 1.x file; others live under XDG_CONFIG_HOME; ids are validated', () => {
    expect(profileCloudPath('default')).toBe(process.env.MAUDE_CLOUD_CONFIG as string);
    expect(profileCloudPath('work')).toBe(
      join(process.env.XDG_CONFIG_HOME as string, 'maude', 'profiles', 'work', 'cloud.json')
    );
    for (const bad of ['', '../x', 'Work', 'a/b', 'x'.repeat(33)])
      expect(profileCloudPath(bad)).toBeNull();
  });

  test('hubs.json follows the same rule as profiles.rs paths_in', () => {
    const xdg = process.env.XDG_CONFIG_HOME as string;
    expect(profileHubsPath('default')).toBe(join(xdg, 'maude', 'hubs.json'));
    expect(profileHubsPath('work')).toBe(join(xdg, 'maude', 'profiles', 'work', 'hubs.json'));
    for (const bad of ['', '../x', 'Work', 'a/b', 'x'.repeat(33)])
      expect(profileHubsPath(bad)).toBeNull();
  });
});

describe('/_home/cloud', () => {
  test('reads /api/home with THAT profile’s token; rows are clamped to the §5.7 fields', async () => {
    hasHome = true;
    down = false;
    seen.length = 0;
    const r = await homeFetch()(homeReq('/_home/cloud?profile=work'));
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      ok: boolean;
      projects: Array<Record<string, unknown>>;
      shared: unknown[];
      account: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.account).toEqual({ email: 'you@work-studio.test' });
    expect(body.projects[0]?.id).toBe('alligators');
    expect(body.projects[0]?.extra).toBeUndefined();
    expect(body.shared).toHaveLength(1);
    expect(seen).toEqual([{ path: '/api/home', auth: 'Bearer mpt_work' }]);
    expect(JSON.stringify(body)).not.toContain('mpt_');
  });

  test('a control plane without /api/home (404) falls back to GET /api/projects', async () => {
    hasHome = false;
    down = false;
    seen.length = 0;
    const cloud = createHomeCloud();
    const r = await cloud.listing('default');
    expect(r).toMatchObject({ ok: true, fallback: true, shared: [] });
    expect((r as { projects: unknown[] }).projects).toHaveLength(1);
    expect(seen.map((s) => s.path)).toEqual(['/api/home', '/api/projects']);
  });

  test('cached 60 s; offline → the last good answer flagged offline', async () => {
    hasHome = true;
    down = false;
    let t = 1_000_000;
    const cloud = createHomeCloud({ now: () => t });
    seen.length = 0;
    await cloud.listing('work');
    await cloud.listing('work');
    expect(seen).toHaveLength(1); // second call from the cache
    down = true;
    t += 61_000;
    const r = await cloud.listing('work');
    expect(r).toMatchObject({ ok: true, offline: true });
    expect((r as { projects: unknown[] }).projects).toHaveLength(1);
    // never fetched before + offline → empty, offline
    const fresh = await createHomeCloud().listing('default');
    expect(fresh).toMatchObject({ ok: false, offline: true, projects: [], shared: [] });
  });

  test('signed out / revoked / bad profile', async () => {
    down = false;
    const cloud = createHomeCloud();
    expect(await cloud.listing('nobody')).toMatchObject({ ok: false, signedIn: false });
    expect(await cloud.listing('gone')).toMatchObject({ ok: false, signedIn: false });
    expect((await homeFetch()(homeReq('/_home/cloud?profile=../etc'))).status).toBe(400);
  });

  // V2-3.10 W4 — a token travels only to the control plane that issued it.
  test('a profile signed in to ANOTHER control plane is signed out here; its token never travels', async () => {
    down = false;
    const xdg = process.env.XDG_CONFIG_HOME as string;
    for (const [id, file] of [
      ['elsewhere', { url: 'https://other-plane.test', token: 'mpt_elsewhere' }],
      ['nourl', { token: 'mpt_nourl' }],
    ] as const) {
      mkdirSync(join(xdg, 'maude', 'profiles', id), { recursive: true });
      writeFileSync(join(xdg, 'maude', 'profiles', id, 'cloud.json'), JSON.stringify(file));
    }
    seen.length = 0;
    const cloud = createHomeCloud();
    expect(await cloud.listing('elsewhere')).toMatchObject({ ok: false, signedIn: false });
    expect(await cloud.listing('nourl')).toMatchObject({ ok: false, signedIn: false });
    expect(
      seen.filter((s) => s.auth?.includes('mpt_elsewhere') || s.auth?.includes('mpt_nourl'))
    ).toEqual([]);
    // The bound one still works (a trailing slash in the recorded url is the same plane).
    expect(await cloud.listing('work')).toMatchObject({ ok: true, signedIn: true });
  });

  test('prepare refuses a bad profile or project id before any network call', async () => {
    seen.length = 0;
    const f = homeFetch();
    for (const body of [
      { profile: '../x', projectId: 'alligators' },
      { profile: 'work', projectId: 'Bad Id' },
    ]) {
      const r = await f(
        homeReq('/_home/cloud/prepare', { method: 'POST', body: JSON.stringify(body) })
      );
      expect(r.status).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  test('prepare runs the project route’s code with the profile’s token', async () => {
    down = false;
    seen.length = 0;
    const r = await homeFetch()(
      homeReq('/_home/cloud/prepare', {
        method: 'POST',
        body: JSON.stringify({ profile: 'work', projectId: 'alligators' }),
      })
    );
    // the stub has no /projects/open → the shared code's own refusal, after asking with mpt_work
    expect(r.status).toBe(502);
    expect(seen).toEqual([{ path: '/projects/open', auth: 'Bearer mpt_work' }]);
  });

  const CODE = `mhc_${'ab12'.repeat(8)}`;

  test('prepare with a handoff code takes the handoff lane; the code rides only in a POST body', async () => {
    down = false;
    seen.length = 0;
    raw.length = 0;
    const logged: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => {
      const orig = console[k];
      console[k] = (...a: unknown[]) => {
        logged.push(a.map(String).join(' '));
      };
      return () => {
        console[k] = orig;
      };
    });
    let r: Response;
    try {
      r = await homeFetch()(
        homeReq('/_home/cloud/prepare', {
          method: 'POST',
          body: JSON.stringify({ profile: 'work', projectId: 'alligators', code: CODE }),
        })
      );
    } finally {
      for (const undo of spies) undo();
    }
    // the stub has no /auth/handoff/exchange → the shared handoff code's own "link expired" (410)
    expect(r.status).toBe(410);
    expect(seen.map((s) => s.path)).toEqual(['/auth/handoff/exchange']);
    expect(raw[0]?.method).toBe('POST');
    expect(JSON.parse(raw[0]?.body ?? '{}')).toEqual({ code: CODE });
    for (const q of raw) expect(q.url).not.toContain(CODE);
    expect(logged.join('\n')).not.toContain(CODE);
    expect(await r.text()).not.toContain(CODE);
  });

  // N-H1 (audit 2): the cell credential prepare stores is the PROFILE's, in the profile's own
  // hubs.json — never the default profile's file, where it would replace default's record.
  test('prepare for a profile writes only that profile’s hubs.json and names the profile', async () => {
    down = false;
    const xdg = process.env.XDG_CONFIG_HOME as string;
    const defaultHubs = join(xdg, 'maude', 'hubs.json');
    const cell = `http://127.0.0.1:${plane.port}`;
    writeFileSync(
      defaultHubs,
      JSON.stringify({ hubs: { [cell]: { token: 'hub_tok_default', linkedAt: 1 } } })
    );
    const r = await homeFetch()(
      homeReq('/_home/cloud/prepare', {
        method: 'POST',
        body: JSON.stringify({ profile: 'work', projectId: 'cellproj' }),
      })
    );
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; serverUrl: string; profile: string };
    expect(j.ok).toBe(true);
    expect(j.serverUrl).toBe(cell);
    expect(j.profile).toBe('work');
    const work = JSON.parse(
      readFileSync(join(xdg, 'maude', 'profiles', 'work', 'hubs.json'), 'utf8')
    );
    expect(work.hubs[cell].token).toBe('hub_tok_work');
    const def = JSON.parse(readFileSync(defaultHubs, 'utf8'));
    expect(def.hubs[cell].token).toBe('hub_tok_default');
    expect(existsSync(join(xdg, 'maude', 'profiles', 'default'))).toBe(false);
  });

  test('prepare refuses a malformed handoff code with 400 before any network call', async () => {
    seen.length = 0;
    const f = homeFetch();
    for (const code of [
      'mhc_short',
      `mhc_${'AB12'.repeat(8)}`,
      `mpt_${'ab12'.repeat(8)}`,
      `${CODE}x`,
      `mhc_${'a'.repeat(129)}`,
      42,
      '',
    ]) {
      const r = await f(
        homeReq('/_home/cloud/prepare', {
          method: 'POST',
          body: JSON.stringify({ profile: 'work', projectId: 'alligators', code }),
        })
      );
      expect(r.status).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });
});
