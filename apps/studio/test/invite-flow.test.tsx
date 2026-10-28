// invite-flow — S6.11: an invite reaches Home (02 ob-invite-landed, ob-home-team, ob-edge-accounts; contract
// S6-S9 §5.1–§5.3, S6 Q12). The profile that holds the invite's address accepts it and lands on the canvas and
// the thread; another account (or nobody) gets "Open the invite as <address>?", whose Open signs that address in
// a NEW profile — never the signed-in one; a dead invite says so; a canvas the person cannot see lands on the
// project alone; the first sign-in's `landing` (the deferred path) opens the same way. The invite id is a bearer
// secret: never in a URL, the DOM or a log. Tauri and the Home server are stubbed (home-first-run.test.tsx's
// harness); no keychain, no real cloud, no ~/.config/maude.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost:4479/' });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import * as api from '../client/home/home-api.js';
import { HomeApp } from '../client/home/home-app.jsx';
import {
  INVITE_WORDS,
  inviteSheetWords,
  landingTarget,
  planAccept,
  planAfterSignIn,
  planInvite,
} from '../client/home/invite-flow.js';

const STUDIO = join(import.meta.dir, '..');
const ID = '0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab';
const STATE = 'c0'.repeat(16);
const SECRET = 'ef'.repeat(32);
const CODE = 'mhc_0123456789abcdef0123456789abcdef';
const GONE = { reason: 'gone', error: INVITE_WORDS.gone };
const PEEK = {
  ok: true,
  projectName: 'Alligators brand',
  fromName: 'Tereza',
  email: 'You@Work-Studio.cz',
  role: 'member',
  canvas: { path: 'ui/Combine-kampan.tsx', name: 'Combine-kampan' },
  thread: 'th_01',
};
const LANDING = { project: 'alligators', canvas: 'ui/Combine-kampan.tsx', thread: 'th_01' };

const listing = (profile: string, email: string | null) =>
  email
    ? { ok: true, profile, signedIn: true, account: { email }, projects: [], shared: [] }
    : { ok: false, profile, signedIn: false, projects: [], shared: [] };

type Call = { url: string; method: string; body: any };
type Reply = [number, unknown];
let calls: Call[] = [];
let invokes: Array<{ cmd: string; args: any }> = [];
let busChannel: { onmessage?: (m: unknown) => void } | null = null;
let shell: any;
let accounts: Record<string, string | null> = {};
let routes: Record<string, (body: any) => Reply> = {};
let pendingInvite: string | null = null;
let preparedProfile = 'default';
let logged: string[] = [];
let originalFetch: typeof fetch;
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
const deliver = (kind: string, payload: unknown) => busChannel?.onmessage?.({ kind, payload });

function installFetch() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const u = new URL(url, 'http://localhost:4479');
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init.method || 'GET', body });
    let reply: Reply;
    if (routes[u.pathname]) reply = routes[u.pathname](body);
    else if (u.pathname === '/_home/index') reply = [200, { v: 1, projects: [] }];
    else if (u.pathname === '/_home/cloud') {
      const p = u.searchParams.get('profile') || 'default';
      reply = [200, listing(p, accounts[p] ?? null)];
    } else if (u.pathname === '/_home/recent-searches') reply = [200, { recentSearches: [] }];
    else if (u.pathname === '/_home/whats-new')
      reply = [200, { version: '2.0.0', entries: [], seen: '2.0.0' }];
    else if (u.pathname === '/_home/cloud/prepare')
      reply = [
        200,
        {
          ok: true,
          serverUrl: 'https://cell.example',
          projectId: body?.projectId,
          name: 'Alligators brand',
          profile: body?.profile,
        },
      ];
    else reply = [404, { error: 'nope' }];
    return new Response(JSON.stringify(reply[1]), {
      status: reply[0],
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function installTauri() {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'home' }, currentWebview: { label: 'home' } },
  };
  w.__TAURI__ = {
    core: {
      Channel: class {
        onmessage?: (m: unknown) => void;
      },
      invoke: async (cmd: string, args: any) => {
        if (cmd === 'shell_subscribe') {
          busChannel = args.onMessage;
          return null;
        }
        if (cmd === 'home_session') return { secret: SECRET };
        invokes.push({ cmd, args });
        if (cmd === 'shell_state') return shell;
        if (cmd === 'take_pending_invite') {
          const id = pendingInvite;
          pendingInvite = null;
          return id;
        }
        if (cmd === 'managed_project_open') return '/Users/x/Maude/alligators';
        if (cmd === 'open_project') return { label: 'p-alligators', opened: 'new' };
        if (cmd === 'home_cloud_sign_in_prepare') return preparedProfile;
        if (cmd === 'home_cloud_sign_in_open') return null;
        if (cmd === 'home_cloud_signed_in') return args.profile;
        return null;
      },
    },
    event: { listen: async () => () => {} },
  };
}
function removeTauri() {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = undefined;
  w.__TAURI_INTERNALS__ = undefined;
  w.__maudeShellBus = undefined;
}

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
};

let host: HTMLElement;
let root: Root;
function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(createElement(HomeApp));
  });
}
const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (id: string) => act(() => $(id)?.click());
const hit = (path: string) => calls.filter((c) => c.url.startsWith(path));
/** Press a door, then the browser's `maude://auth/done` nudge (polls at once instead of in 5 s). */
async function pressAndSignIn(id: string) {
  click(id);
  await flush();
  act(() => deliver('auth://return', { kind: 'done', state: STATE }));
  await flush(16);
}
const cmds = (name: string) => invokes.filter((i) => i.cmd === name);

function cloudSignIn(done: { email: string; landing?: unknown }) {
  routes['/_home/cloud/signin/start'] = () => [
    200,
    { ok: true, userCode: 'BCDF-GHJK', state: STATE, expiresIn: 600 },
  ];
  routes['/_home/cloud/signin/poll'] = () => [200, { status: 'done', ...done }];
  routes['/_home/cloud/signin/cancel'] = () => [200, { ok: true }];
}

const PROFILES = [
  { id: 'default', label: 'Personal' },
  { id: 'work', label: 'Work' },
];

beforeEach(() => {
  calls = [];
  invokes = [];
  busChannel = null;
  shell = { projects: [], profiles: [{ id: 'default', label: 'Personal' }], recent: [] };
  accounts = {};
  routes = { '/_home/invite/peek': () => [200, PEEK] };
  pendingInvite = ID;
  preparedProfile = 'default';
  logged = [];
  for (const k of ['log', 'warn', 'error'] as const)
    console[k] = (...a: unknown[]) => {
      logged.push(a.map(String).join(' '));
    };
  try {
    localStorage.clear();
  } catch {}
  api.resetHomeSecret();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  installFetch();
  installTauri();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  globalThis.fetch = originalFetch;
  Object.assign(console, originalConsole);
  removeTauri();
  api.resetHomeSecret();
});

/** The invite id never left the POST bodies and the Rust calls: no URL, no DOM, no log. */
function expectIdKept() {
  for (const c of calls) expect(c.url).not.toContain(ID);
  expect(host.innerHTML).not.toContain(ID);
  expect(logged.join('\n')).not.toContain(ID);
  for (const c of calls.filter((x) => x.body && JSON.stringify(x.body).includes(ID)))
    expect(['/_home/invite/peek', '/_home/invite/accept']).toContain(c.url);
}

describe('a profile that holds the invite address', () => {
  test('a link never accepts by itself: the Join sheet names project, inviter and account (M2)', async () => {
    shell = { projects: [], profiles: PROFILES, recent: [] };
    accounts = { default: 'me@personal.cz', work: 'you@work-studio.cz' };
    routes['/_home/invite/accept'] = () => [200, { ok: true, code: CODE, landing: LANDING }];
    mount();
    await flush(16);
    // the deep link only peeked: nothing accepted, nothing prepared, no tab opened
    expect(hit('/_home/invite/peek')[0].body).toEqual({ id: ID });
    expect(hit('/_home/invite/accept')).toEqual([]);
    expect(hit('/_home/cloud/prepare')).toEqual([]);
    expect(cmds('open_project')).toEqual([]);
    expect($('invite-sheet')?.getAttribute('data-mode')).toBe('join');
    expect($('invite-sheet-title')?.textContent).toBe(
      'Join Alligators brand from Tereza as you@work-studio.cz?'
    );
    expect($('invite-sheet-body')?.textContent).toBe(
      'Tereza invited that address to Alligators brand.'
    );
    expect($('invite-sheet-account')?.textContent).toContain('you@work-studio.cz');
    expect($('invite-sheet-open')).toBeNull();
    expect($('invite-sheet-join')?.textContent).toBe('Join');
    expectIdKept();
  });

  test('Join accepts with THAT profile and lands on the canvas and the thread', async () => {
    shell = { projects: [], profiles: PROFILES, recent: [] };
    accounts = { default: 'me@personal.cz', work: 'you@work-studio.cz' };
    routes['/_home/invite/accept'] = () => [200, { ok: true, code: CODE, landing: LANDING }];
    mount();
    await flush();
    click('invite-sheet-join');
    await flush(16);
    expect(hit('/_home/invite/accept').map((c) => c.body)).toEqual([{ id: ID, profile: 'work' }]);
    expect(hit('/_home/cloud/prepare').map((c) => c.body)).toEqual([
      { profile: 'work', projectId: 'alligators', code: CODE },
    ]);
    expect(cmds('managed_project_open')[0].args.profile).toBe('work');
    expect(cmds('open_project').map((c) => c.args)).toEqual([
      {
        root: '/Users/x/Maude/alligators',
        // S6.11 — the invite's landing says so (the project tab's toast names who invited you)
        target: { canvas: 'ui/Combine-kampan.tsx', thread: 'th_01', via: 'invite' },
      },
    ]);
    expect(cmds('home_cloud_sign_in_prepare')).toEqual([]);
    expect($('invite-sheet')).toBeNull();
    expectIdKept();
  });

  test('Cancel on the Join sheet accepts nothing', async () => {
    accounts = { default: 'you@work-studio.cz' };
    routes['/_home/invite/accept'] = () => [200, { ok: true, code: CODE, landing: LANDING }];
    mount();
    await flush();
    click('invite-sheet-cancel');
    await flush(16);
    expect($('invite-sheet')).toBeNull();
    expect(hit('/_home/invite/accept')).toEqual([]);
    expect(cmds('open_project')).toEqual([]);
  });

  test('a canvas the person cannot see lands on the project alone', async () => {
    accounts = { default: 'you@work-studio.cz' };
    routes['/_home/invite/accept'] = () => [
      200,
      { ok: true, code: CODE, landing: { project: 'alligators' } },
    ];
    mount();
    await flush();
    click('invite-sheet-join');
    await flush(16);
    expect(cmds('open_project').map((c) => c.args)).toEqual([
      { root: '/Users/x/Maude/alligators' },
    ]);
  });

  test('the cloud says another account (403): the sheet says so, nothing is attached', async () => {
    accounts = { default: 'you@work-studio.cz' };
    routes['/_home/invite/accept'] = () => [
      403,
      { reason: 'other-account', email: 'tym@work-studio.cz' },
    ];
    mount();
    await flush();
    click('invite-sheet-join');
    await flush(16);
    expect($('invite-sheet')?.getAttribute('data-mode')).toBe('other-account');
    expect($('invite-sheet-title')?.textContent).toBe('Open the invite as tym@work-studio.cz?');
    expect(hit('/_home/cloud/prepare')).toEqual([]);
    expect(cmds('open_project')).toEqual([]);
  });
});

describe('another account on this Mac (ob-edge-accounts)', () => {
  test('the sheet asks; Open signs the address in a NEW profile, accepts with it, other profiles untouched', async () => {
    accounts = { default: 'me@personal.cz' };
    preparedProfile = 'p-work';
    cloudSignIn({ email: 'you@work-studio.cz' });
    routes['/_home/invite/accept'] = () => [200, { ok: true, code: CODE, landing: LANDING }];
    mount();
    await flush();
    const sheet = $('invite-sheet');
    expect(sheet?.getAttribute('data-mode')).toBe('other-account');
    expect($('invite-sheet-title')?.textContent).toBe('Open the invite as You@Work-Studio.cz?');
    expect($('invite-sheet-body')?.textContent).toBe(
      'Tereza invited that address to Alligators brand. This window is signed in as me@personal.cz.'
    );
    expect(sheet?.textContent).toContain(
      'Opens Alligators brand in its own tab, signed in as You@Work-Studio.cz. To switch the whole app: Settings › General › Account.'
    );
    // asking is not accepting: nothing was attached to the signed-in account
    expect(hit('/_home/invite/accept')).toEqual([]);

    await pressAndSignIn('invite-sheet-open');
    expect(cmds('home_cloud_sign_in_prepare').map((c) => c.args)).toEqual([{ forInvite: ID }]);
    expect(hit('/_home/cloud/signin/start')[0].body).toEqual({ profile: 'p-work' });
    expect(hit('/_home/invite/accept').map((c) => c.body)).toEqual([{ id: ID, profile: 'p-work' }]);
    expect(hit('/_home/cloud/prepare').map((c) => c.body.profile)).toEqual(['p-work']);
    expect(cmds('open_project')[0].args.target).toEqual({
      canvas: 'ui/Combine-kampan.tsx',
      thread: 'th_01',
      via: 'invite',
    });
    // the personal profile is never written, re-signed or used for the invite
    for (const c of calls)
      expect(JSON.stringify(c.body ?? {})).not.toContain('"profile":"default"');
    expect($('invite-sheet')).toBeNull();
    expectIdKept();
  });

  test('the browser signed in someone else: the sheet comes back, the invite is not accepted', async () => {
    accounts = { default: 'me@personal.cz' };
    preparedProfile = 'p-work';
    cloudSignIn({ email: 'someone@else.cz' });
    routes['/_home/invite/accept'] = () => [200, { ok: true, code: CODE, landing: LANDING }];
    mount();
    await flush();
    await pressAndSignIn('invite-sheet-open');
    expect(hit('/_home/invite/accept')).toEqual([]);
    expect($('invite-sheet-body')?.textContent).toContain(
      'This window is signed in as someone@else.cz.'
    );
    expect($('invite-sheet-open')?.hasAttribute('disabled')).toBe(false);
  });

  test('Cancel closes the sheet and forgets the invite', async () => {
    accounts = { default: 'me@personal.cz' };
    mount();
    await flush();
    click('invite-sheet-cancel');
    await flush();
    expect($('invite-sheet')).toBeNull();
    expect(cmds('home_cloud_sign_in_prepare')).toEqual([]);
  });
});

describe('signed out, dead invites, links while Home runs', () => {
  test('nobody signed in: the sheet without the account rows; Open is the invite sign-in', async () => {
    cloudSignIn({ email: 'you@work-studio.cz' });
    routes['/_home/invite/accept'] = () => [200, { ok: true, code: CODE, landing: LANDING }];
    mount();
    await flush();
    expect($('invite-sheet')?.getAttribute('data-mode')).toBe('signed-out');
    expect($('invite-sheet-body')?.textContent).toBe(
      'Tereza invited that address to Alligators brand.'
    );
    await pressAndSignIn('invite-sheet-open');
    expect(cmds('home_cloud_sign_in_prepare').map((c) => c.args)).toEqual([{ forInvite: ID }]);
    expect(hit('/_home/invite/accept').map((c) => c.body)).toEqual([
      { id: ID, profile: 'default' },
    ]);
    expect(cmds('open_project')).toHaveLength(1);
  });

  test('a dead invite says so (the cloud words), nothing opens', async () => {
    accounts = { default: 'you@work-studio.cz' };
    routes['/_home/invite/peek'] = () => [404, GONE];
    mount();
    await flush();
    expect($('invite-sheet')).toBeNull();
    expect(host.textContent).toContain(INVITE_WORDS.gone);
    expect(hit('/_home/invite/accept')).toEqual([]);
    expect(cmds('open_project')).toEqual([]);
  });

  test('an `invite://open` nudge while Home runs takes the parked id once', async () => {
    pendingInvite = null;
    accounts = { default: 'you@work-studio.cz' };
    routes['/_home/invite/accept'] = () => [200, { ok: true, code: CODE, landing: LANDING }];
    mount();
    await flush();
    expect(hit('/_home/invite/peek')).toEqual([]);
    pendingInvite = ID;
    act(() => deliver('invite://open', { id: ID }));
    await flush();
    expect(hit('/_home/invite/peek')).toHaveLength(1);
    // the nudge only asks (M2); Join is the accept
    expect(cmds('open_project')).toHaveLength(0);
    click('invite-sheet-join');
    await flush(16);
    expect(cmds('open_project')).toHaveLength(1);
    expectIdKept();
  });

  test('a malformed id is dropped before any request', async () => {
    pendingInvite = '../../etc/passwd-0000-0000-0000-000000';
    mount();
    await flush();
    expect(hit('/_home/invite/peek')).toEqual([]);
  });
});

describe('the deferred path — the first sign-in answers `landing`', () => {
  test('the card sign-in opens the landing project on its canvas and thread, no toast', async () => {
    pendingInvite = null;
    cloudSignIn({ email: 'you@work-studio.cz', landing: LANDING });
    mount();
    await flush();
    await pressAndSignIn('signin-cloud');
    expect(hit('/_home/cloud/prepare').map((c) => c.body)).toEqual([
      { profile: 'default', projectId: 'alligators', server: null },
    ]);
    expect(cmds('open_project')[0].args.target).toEqual({
      canvas: 'ui/Combine-kampan.tsx',
      thread: 'th_01',
      via: 'invite',
    });
    expect($('home-signin-toast')).toBeNull();
  });
});

describe('the plans (pure)', () => {
  test('planInvite: match is case-insensitive; refusals are notices', () => {
    const clouds = [listing('a', 'me@x.cz'), listing('b', 'you@work-studio.cz')];
    expect(planInvite({ ok: true, status: 200, json: PEEK }, clouds)).toMatchObject({
      kind: 'ask',
      mode: 'join',
      current: { profile: 'b', email: 'you@work-studio.cz' },
    });
    expect(planInvite({ ok: true, status: 200, json: PEEK }, [clouds[0]])).toMatchObject({
      kind: 'ask',
      mode: 'other-account',
      current: { profile: 'a', email: 'me@x.cz' },
    });
    expect(planInvite({ ok: true, status: 200, json: PEEK }, [])).toMatchObject({
      kind: 'ask',
      mode: 'signed-out',
    });
    expect(planInvite({ ok: false, status: 404, json: GONE }, clouds)).toEqual({
      kind: 'notice',
      words: INVITE_WORDS.gone,
    });
    expect(planInvite({ ok: false, status: 0, json: null }, clouds).kind).toBe('notice');
    expect(
      planInvite({ ok: true, status: 200, json: { ...PEEK, role: 'owner' } }, clouds).kind
    ).toBe('notice');
  });

  test('planAccept never opens on 401 / 403 / 404 / garbage', () => {
    const invite = {
      projectName: 'A',
      fromName: null,
      email: 'a@b.cz',
      role: 'member',
      canvas: null,
    };
    for (const [status, json] of [
      [401, { reason: 'signed-out' }],
      [403, { reason: 'other-account', email: 'a@b.cz' }],
      [404, GONE],
      [200, { ok: true, code: CODE }],
    ] as const)
      expect(
        planAccept({ ok: status === 200, status, json }, { profile: 'p', invite }).kind
      ).not.toBe('open');
  });

  test('landingTarget keeps a thread only with its canvas; planAfterSignIn needs the same address', () => {
    expect(landingTarget({ project: 'a' })).toBeNull();
    expect(landingTarget({ project: 'a', thread: 'th_1' })).toBeNull();
    expect(landingTarget({ project: 'a', canvas: 'x.tsx', thread: 'bad id!' })).toEqual({
      canvas: 'x.tsx',
    });
    const pending = { invite: { email: 'A@B.cz' } };
    expect(planAfterSignIn({ profile: 'p', email: 'a@b.cz' }, pending)).toEqual({
      kind: 'accept',
      profile: 'p',
    });
    expect(planAfterSignIn({ profile: 'p', email: 'c@d.cz' }, pending).kind).toBe('ask');
    expect(planAfterSignIn({ profile: 'p', email: 'c@d.cz' }, null)).toBeNull();
  });

  test('no inviter name (O3) never puts an address in its place', () => {
    const w = inviteSheetWords({
      mode: 'signed-out',
      invite: { projectName: 'A', fromName: null, email: 'a@b.cz' },
    });
    expect(w.body).toBe('That address is invited to A.');
  });
});

describe('registered and quiet', () => {
  test('every invite-sheet testid is in testids.json and TESTIDS.md', () => {
    const src = readFileSync(join(STUDIO, 'client/home/InviteSheet.jsx'), 'utf8');
    const ids = [...src.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(5);
    const json = JSON.parse(readFileSync(join(STUDIO, 'client/testids.json'), 'utf8'));
    const md = readFileSync(join(STUDIO, 'client/TESTIDS.md'), 'utf8');
    for (const id of ids) {
      expect(json.some((e: { hook: string }) => e.hook === id)).toBe(true);
      expect(md).toContain(`| \`${id}\` |`);
    }
  });

  test('the invite files never log', () => {
    for (const f of ['client/home/invite-flow.js', 'client/home/InviteSheet.jsx'])
      expect(readFileSync(join(STUDIO, f), 'utf8')).not.toMatch(/console\./);
  });
});
