// 2.1.1 B4 (artboard 14) — the accounts row on top of Home: one card per account (a Maude Cloud
// account by e-mail, a server by host) with its state, and — for a sign-in that stopped working or is
// missing — its own button, aimed at THAT account. Pure model.

import { describe, expect, test } from 'bun:test';

import { homeAccountCards } from '../client/home/home-accounts-model.js';
import { buildHomeModel } from '../client/home/home-model.js';

type Hub = { url: string; account: string | null; state: string };

const sh = {
  profiles: [
    { id: 'default', label: 'Alice', email: 'alice@example.com' },
    { id: 'bright', label: 'Brightside', email: 'hello@brightside.example' },
    { id: 'srv', label: 'Server' },
  ],
  projects: [
    {
      pid: 'a',
      name: 'A',
      root: '/Users/x/a',
      profile: 'default',
      place: 'closed',
      hub: 'https://a.cloud.maude.sh/',
    },
    {
      pid: 'a2',
      name: 'A2',
      root: '/Users/x/a2',
      profile: 'default',
      place: 'closed',
      hub: 'https://a2.cloud.maude.sh/',
    },
    {
      pid: 'w',
      name: 'W',
      root: '/Users/x/w',
      profile: 'srv',
      place: 'closed',
      linkedHub: { url: 'https://design.example.com/' },
    },
  ],
  recent: [],
};
const live = (profile: string, over: Record<string, unknown> = {}) => ({
  profile,
  signedIn: true,
  account: { email: sh.profiles.find((p) => p.id === profile)?.email },
  projects: [],
  ...over,
});
const srv = (hubs: Hub[]) => [{ id: 'srv', hubs }];
const DESIGN: Hub = {
  url: 'https://design.example.com',
  account: 'alice@example.com',
  state: 'ok',
};

function cards(over: { clouds?: unknown[]; hubProfiles?: { id: string; hubs: Hub[] }[] } = {}) {
  const clouds = over.clouds ?? [live('default'), live('bright')];
  const hubProfiles = over.hubProfiles ?? srv([DESIGN]);
  const by = (pick: (h: Hub) => string | null) =>
    Object.fromEntries(
      hubProfiles.map((p) => [p.id, Object.fromEntries(p.hubs.map((h) => [h.url, pick(h)]))])
    );
  const model = buildHomeModel({
    shell: sh,
    index: { v: 1, projects: [] },
    clouds,
    hubAccounts: by((h) => h.account),
    hubStates: by((h) => h.state),
    cloudUrl: 'https://cloud.maude.sh',
  });
  return homeAccountCards({ shell: sh, clouds, hubProfiles, groups: model.groups });
}

describe('homeAccountCards', () => {
  test('a Maude Cloud account by its e-mail, a server by its host, each with its project count', () => {
    const c = cards();
    expect(c.map((x) => [x.kind, x.title, x.sub, x.state])).toEqual([
      ['cloud', 'alice@example.com', 'Maude Cloud · 2 projects', 'ok'],
      ['cloud', 'hello@brightside.example', 'Maude Cloud · No projects', 'ok'],
      ['server', 'alice@example.com', 'design.example.com · 1 project', 'ok'],
    ]);
    expect(c[0]?.word).toBe('Connected');
    expect(c.every((x) => x.fix === null)).toBe(true);
  });

  test('a server with no account on record is named by its host', () => {
    const c = cards({ hubProfiles: srv([{ ...DESIGN, account: null }]) });
    expect(c.at(-1)).toMatchObject({ title: 'design.example.com', sub: 'Your server · 1 project' });
  });

  test('a Maude Cloud sign-in that stopped working has its own Sign in again, for THAT profile', () => {
    const c = cards({
      clouds: [live('default', { signedIn: false, rejected: true, account: null }), live('bright')],
    });
    expect(c[0]).toMatchObject({
      title: 'alice@example.com',
      state: 'rejected',
      word: 'Sign-in stopped working',
      fix: { path: 'cloud-signin', profile: 'default', label: 'Sign in again' },
    });
    expect(c[1]?.fix).toBeNull();
  });

  test('a server whose sign-in stopped working: Sign in again, with its address', () => {
    const c = cards({ hubProfiles: srv([{ ...DESIGN, state: 'rejected' }]) });
    expect(c.at(-1)).toMatchObject({
      state: 'rejected',
      fix: {
        path: 'hub-signin',
        profile: 'srv',
        url: 'https://design.example.com',
        label: 'Sign in again',
      },
    });
  });

  test('a server that does not answer is not a sign-in problem: no button, its own word', () => {
    const c = cards({ hubProfiles: srv([{ ...DESIGN, state: 'unreachable' }]) });
    expect(c.at(-1)).toMatchObject({ state: 'unreachable', word: 'Server unreachable', fix: null });
  });

  test('a server the projects name but no sign-in is saved for: “Sign in”, with the address', () => {
    const c = cards({ hubProfiles: srv([]) });
    expect(c.at(-1)).toMatchObject({
      kind: 'server',
      state: 'missing',
      word: 'Sign-in missing',
      fix: { path: 'hub-signin', url: 'https://design.example.com', label: 'Sign in' },
    });
  });

  test('a profile signed out of Maude Cloud by choice, with no project on it, has no card', () => {
    const c = cards({ clouds: [live('default'), { profile: 'bright', signedIn: false }] });
    expect(c.map((x) => x.key)).not.toContain('cloud:bright');
  });
});
