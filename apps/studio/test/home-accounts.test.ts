// 2.0.5 W4b — Home's avatar reads each profile's team-server sign-ins (public handles, never a
// token) and signs ONE profile out of ONE account. Every file lives under a throwaway
// XDG_CONFIG_HOME; the real ~/.config/maude is never read or written.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { homeFetch, homeReq } from './_home-fixtures.ts';

let xdg: string;
const saved: Record<string, string | undefined> = {};
const ENV = ['XDG_CONFIG_HOME', 'HUBS_CONFIG_PATH', 'MAUDE_CLOUD_CONFIG', 'MAUDE_PROFILE_ID'];
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  xdg = mkdtempSync(join(tmpdir(), 'maude-home-accounts-'));
  process.env.XDG_CONFIG_HOME = xdg;
  for (const k of ENV.slice(1)) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const hubsFile = (profile: string) =>
  profile === 'default'
    ? join(xdg, 'maude', 'hubs.json')
    : join(xdg, 'maude', 'profiles', profile, 'hubs.json');
function seedHubs(profile: string, hubs: Record<string, { token: string; account?: string }>) {
  const f = hubsFile(profile);
  mkdirSync(join(f, '..'), { recursive: true });
  const rec = Object.fromEntries(
    Object.entries(hubs).map(([u, h]) => [u, { ...h, linkedAt: 1, role: 'member' }])
  );
  writeFileSync(f, JSON.stringify({ hubs: rec }), { mode: 0o600 });
}
const post = (path: string, body: unknown) =>
  homeReq(path, { method: 'POST', body: JSON.stringify(body) });

describe('/_home/accounts', () => {
  test('each profile’s team servers and the account each vouched for — never a token', async () => {
    seedHubs('default', {
      'https://design.team.example': { token: 'SECRET-1', account: 'me@team.example' },
    });
    seedHubs('work', {
      'https://hub.studio.cz': { token: 'SECRET-2', account: 'tereza@studio.cz' },
      'https://old.studio.cz': { token: '' },
    });
    const r = await homeFetch()(homeReq('/_home/accounts?profiles=default,work,../etc,NOPE'));
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain('SECRET');
    expect(JSON.parse(text)).toEqual({
      ok: true,
      profiles: [
        {
          id: 'default',
          hubs: [{ url: 'https://design.team.example', account: 'me@team.example' }],
        },
        { id: 'work', hubs: [{ url: 'https://hub.studio.cz', account: 'tereza@studio.cz' }] },
      ],
    });
  });
});

describe('sign one profile out of one account', () => {
  test('/_home/hub/signout removes that server from that profile only', async () => {
    seedHubs('default', { 'https://hub.studio.cz': { token: 'D', account: 'me@x' } });
    seedHubs('work', {
      'https://hub.studio.cz': { token: 'W', account: 'tereza@studio.cz' },
      'https://other.studio.cz': { token: 'W2' },
    });
    const r = await homeFetch()(
      post('/_home/hub/signout', { profile: 'work', url: 'https://hub.studio.cz/' })
    );
    expect(r.status).toBe(200);
    const work = JSON.parse(readFileSync(hubsFile('work'), 'utf8'));
    expect(Object.keys(work.hubs)).toEqual(['https://other.studio.cz']);
    const def = JSON.parse(readFileSync(hubsFile('default'), 'utf8'));
    expect(Object.keys(def.hubs)).toEqual(['https://hub.studio.cz']);
  });

  test('/_home/cloud/signout forgets that profile’s Maude Cloud sign-in only', async () => {
    const work = join(xdg, 'maude', 'profiles', 'work', 'cloud.json');
    const other = join(xdg, 'maude', 'profiles', 'home', 'cloud.json');
    for (const f of [work, other]) {
      mkdirSync(join(f, '..'), { recursive: true });
      writeFileSync(f, JSON.stringify({ token: 't', email: 'x@y' }), { mode: 0o600 });
    }
    const r = await homeFetch()(post('/_home/cloud/signout', { profile: 'work' }));
    expect(r.status).toBe(200);
    expect(existsSync(work)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  test('a profile id that names no profile slot touches nothing', async () => {
    seedHubs('work', { 'https://hub.studio.cz': { token: 'W' } });
    for (const body of [
      { profile: '../work', url: 'https://hub.studio.cz' },
      { profile: 'Work', url: 'https://hub.studio.cz' },
      { profile: 'work', url: 'https://u:p@hub.studio.cz' },
    ])
      expect((await homeFetch()(post('/_home/hub/signout', body))).status).toBe(400);
    expect((await homeFetch()(post('/_home/cloud/signout', { profile: '../../x' }))).status).toBe(
      400
    );
    expect(Object.keys(JSON.parse(readFileSync(hubsFile('work'), 'utf8')).hubs)).toEqual([
      'https://hub.studio.cz',
    ]);
  });
});
