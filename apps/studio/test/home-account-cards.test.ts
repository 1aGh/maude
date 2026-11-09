// 2.1.1 B4 (artboard 14) — the accounts row on top of Home: one card per account (a Maude Cloud
// account by e-mail, a server by host) with its state, and — for a sign-in that stopped working or is
// missing — its own button, aimed at THAT account. Pure model.

import { describe, expect, test } from 'bun:test';

import {
  homeAccountBanner,
  homeAccountCards,
  homeAccountsSummary,
} from '../client/home/home-accounts-model.js';
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

function cards(
  over: {
    clouds?: unknown[];
    hubProfiles?: { id: string; hubs: Hub[] }[];
    cloudUrl?: string | null;
    shell?: typeof sh;
  } = {}
) {
  const shell = over.shell ?? sh;
  const cloudUrl = over.cloudUrl === undefined ? 'https://cloud.maude.sh' : over.cloudUrl;
  const clouds = over.clouds ?? [live('default'), live('bright')];
  const hubProfiles = over.hubProfiles ?? srv([DESIGN]);
  const by = (pick: (h: Hub) => string | null) =>
    Object.fromEntries(
      hubProfiles.map((p) => [p.id, Object.fromEntries(p.hubs.map((h) => [h.url, pick(h)]))])
    );
  const model = buildHomeModel({
    shell,
    index: { v: 1, projects: [] },
    clouds,
    hubAccounts: by((h) => h.account),
    hubStates: by((h) => h.state),
    cloudUrl,
  });
  return homeAccountCards({ shell, clouds, hubProfiles, groups: model.groups, cloudUrl });
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

// 2.1.2 HB1 (canvas 17, artboards 15–18): a Maude Cloud cell is never a server; old servers fold;
// the chip counts; the banner speaks only for a sign-in the person can fix.
const CELL: Hub = { url: 'https://alligators.cloud.maude.sh', account: null, state: 'rejected' };
const OLD = (url: string): Hub => ({ url, account: null, state: 'unreachable' });
const OLD_SIX = [
  'http://127.0.0.1:1234',
  'http://[::1]:1234',
  'http://localhost',
  'http://localhost:8420',
  'http://localhost:18500',
  'http://localhost:1234',
].map(OLD);
const withCell = {
  ...sh,
  projects: [
    ...sh.projects,
    {
      pid: 'g',
      name: 'Alligators brand',
      root: '/Users/x/g',
      profile: 'default',
      place: 'closed',
      hub: 'https://alligators.cloud.maude.sh/',
    },
  ],
};
const rejectedCloud = () => [
  live('default', { signedIn: false, rejected: true, account: null }),
  live('bright'),
];

describe('2.1.2 — a Maude Cloud cell is not a server', () => {
  test('a saved sign-in to a cell never becomes a server card; its project counts under Maude Cloud', () => {
    const c = cards({
      shell: withCell,
      hubProfiles: [{ id: 'default', hubs: [CELL] }, ...srv([DESIGN])],
    });
    expect(c.some((x) => x.kind === 'server' && String(x.url).includes('cloud.maude.sh'))).toBe(
      false
    );
    // the account's own sign-in decides, never the cell token's
    expect(c[0]).toMatchObject({
      key: 'cloud:default',
      sub: 'Maude Cloud · 3 projects',
      state: 'ok',
    });
  });

  test('the control plane not known yet: no server card is drawn for any saved sign-in', () => {
    const c = cards({ cloudUrl: null, hubProfiles: [{ id: 'default', hubs: [CELL] }] });
    expect(c.filter((x) => x.kind === 'server')).toEqual([]);
  });
});

describe('2.1.2 — old servers, the chip, the banner', () => {
  test('a server that does not answer and holds no project is old; one with a project is not', () => {
    const c = cards({ hubProfiles: srv([{ ...DESIGN, state: 'unreachable' }, ...OLD_SIX]) });
    const servers = c.filter((x) => x.kind === 'server');
    expect(servers.filter((x) => x.stale).map((x) => x.title)).toEqual([
      '127.0.0.1:1234',
      '[::1]:1234',
      'localhost',
      'localhost:8420',
      'localhost:18500',
      'localhost:1234',
    ]);
    expect(servers.find((x) => x.url === 'https://design.example.com')?.stale).toBe(false);
    expect(servers.find((x) => x.title === 'localhost:8420')?.forget).toEqual({
      profile: 'srv',
      url: 'http://localhost:8420',
      host: 'localhost:8420',
    });
  });

  test('a sign-in that stopped working never folds, even with no project', () => {
    const c = cards({
      hubProfiles: srv([DESIGN, { url: 'http://localhost:9', account: null, state: 'rejected' }]),
    });
    expect(c.find((x) => x.title === 'localhost:9')?.stale).toBe(false);
  });

  test('the chip: live accounts only, and how many need a sign-in', () => {
    const ok = homeAccountsSummary(cards({ hubProfiles: srv([DESIGN, ...OLD_SIX]) }));
    expect(ok).toMatchObject({
      word: '3 accounts',
      needs: 0,
      needsWord: null,
      oldWord: '6 old servers',
    });
    expect(ok.old).toHaveLength(6);
    expect(ok.live).toHaveLength(3);
    const bad = homeAccountsSummary(
      cards({ hubProfiles: srv([{ ...DESIGN, state: 'rejected' }]) })
    );
    expect(bad).toMatchObject({ word: '3 accounts', needs: 1, needsWord: '1 needs sign-in' });
  });

  test('every sign-in works, or only old servers: no banner', () => {
    expect(homeAccountBanner(cards())).toBeNull();
    expect(homeAccountBanner(cards({ hubProfiles: srv([DESIGN, ...OLD_SIX]) }))).toBeNull();
    expect(
      homeAccountBanner(cards({ hubProfiles: srv([{ ...DESIGN, state: 'unreachable' }]) }))
    ).toBeNull();
  });

  test('one server sign-in stopped working: the banner names it, its projects, and the fix', () => {
    const b = homeAccountBanner(cards({ hubProfiles: srv([{ ...DESIGN, state: 'rejected' }]) }));
    expect(b).toMatchObject({
      kind: 'one',
      title: 'Your sign-in to design.example.com stopped working.',
      body: 'Changes to W wait on this Mac.',
      action: 'Sign in again',
    });
    expect(b?.card?.fix?.path).toBe('hub-signin');
  });

  test('a Maude Cloud sign-in that stopped working names Maude Cloud, not an address', () => {
    const b = homeAccountBanner(cards({ clouds: rejectedCloud() }));
    expect(b).toMatchObject({
      kind: 'one',
      title: 'Your sign-in to Maude Cloud stopped working.',
      body: 'Changes to A and A2 wait on this Mac.',
      action: 'Sign in again',
    });
  });

  test('a missing sign-in says so, with Sign in', () => {
    const b = homeAccountBanner(cards({ hubProfiles: srv([]) }));
    expect(b).toMatchObject({
      title: 'Your sign-in to design.example.com is missing.',
      action: 'Sign in',
    });
  });

  test('two problems: one banner with a count and Review', () => {
    const b = homeAccountBanner(
      cards({ clouds: rejectedCloud(), hubProfiles: srv([{ ...DESIGN, state: 'rejected' }]) })
    );
    expect(b).toMatchObject({
      kind: 'many',
      title: '2 sign-ins stopped working',
      action: 'Review',
    });
    const mixed = homeAccountBanner(cards({ clouds: rejectedCloud(), hubProfiles: srv([]) }));
    expect(mixed).toMatchObject({ kind: 'many', title: '2 sign-ins need you' });
  });
});
