// 2.1.2 HB1 (canvas 17, artboards 15–18) — accounts leave Home's main surface: one chip at the top right
// ("3 accounts", + "1 needs sign-in"), the accounts list behind it (fix on the line that broke, Sign out
// in "…", old servers folded with Forget… / Forget all, each behind a question), and the one banner on
// top only for a sign-in the person can fix. Stubbed routes only — no real config, no keychain.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost:4479/' });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { HomeAccountBanner } from '../client/home/HomeAccountBanner.jsx';
import { HomeAccountsChip } from '../client/home/HomeAccountsChip.jsx';
import { homeAccountBanner, homeAccountsSummary } from '../client/home/home-accounts-model.js';
import { DEV_SECRET_KEY, resetHomeSecret } from '../client/home/home-api.js';
import { useAccountFix } from '../client/home/use-account-fix.js';

type Card = Record<string, unknown>;
const signOut = (path: string, name: string, extra: Record<string, unknown>) => ({
  path,
  ...extra,
  label: `Sign out of ${name}…`,
  confirm: { title: `Sign out of ${name}?`, body: '…', primary: 'Sign out', cancel: 'Cancel' },
});
const card = (over: Card): Card => ({
  key: 'k',
  kind: 'cloud',
  profile: 'default',
  url: null,
  face: { kind: 'cloud', initial: 'A', tone: 'yellow' },
  title: 'alice@example.com',
  sub: 'Maude Cloud · 2 projects',
  state: 'ok',
  word: 'Connected',
  fix: null,
  projects: ['Homepage', 'Pricing'],
  stale: false,
  forget: null,
  signOut: signOut('cloud-signout', 'alice@example.com', { profile: 'default' }),
  ...over,
});
const server = (host: string, over: Card = {}): Card =>
  card({
    key: `server:srv:${host}`,
    kind: 'server',
    profile: 'srv',
    url: `https://${host}`,
    face: { kind: 'server' },
    title: host,
    sub: 'Your server · 2 projects',
    projects: ['Studio site', 'Alligators brand'],
    signOut: signOut('hub-signout', host, { profile: 'srv', url: `https://${host}` }),
    ...over,
  });
const old = (host: string) =>
  server(host, {
    state: 'unreachable',
    word: 'Server unreachable',
    sub: 'Your server · No projects',
    projects: [],
    stale: true,
    forget: { profile: 'srv', url: `http://${host}`, host },
  });
const OLD = ['127.0.0.1:1234', 'localhost:8420', 'localhost:18500'].map(old);
const REJECTED = server('design.example.com', {
  state: 'rejected',
  word: 'Sign-in stopped working',
  fix: {
    path: 'hub-signin',
    profile: 'srv',
    url: 'https://design.example.com',
    label: 'Sign in again',
  },
});
const OK_CARDS = [
  card({ key: 'cloud:default' }),
  card({ key: 'cloud:bright', profile: 'bright', title: 'hello@brightside.example' }),
  server('design.example.com'),
  ...OLD,
];
const ONE_BAD = [OK_CARDS[0], OK_CARDS[1], REJECTED, ...OLD] as Card[];
const TWO_BAD = [
  card({
    key: 'cloud:default',
    state: 'rejected',
    word: 'Sign-in stopped working',
    fix: { path: 'cloud-signin', profile: 'default', label: 'Sign in again' },
  }),
  OK_CARDS[1],
  REJECTED,
] as Card[];

let calls: Array<{ path: string; body: unknown }> = [];
let polls = 0;
let opened: string[] = [];
let originalFetch: typeof fetch;
let originalOpen: typeof window.open;
let host: HTMLElement;
let root: Root;
const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
};
const posted = (p: string) => calls.filter((c) => c.path === p).map((c) => c.body);

beforeEach(() => {
  calls = [];
  polls = 0;
  opened = [];
  resetHomeSecret();
  sessionStorage.setItem(DEV_SECRET_KEY, 'secret');
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input), 'http://localhost:4479').pathname;
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
    const body =
      path === '/_home/hub/signin/start'
        ? { ok: true, id: 'attempt-1', signInUrl: 'https://design.example.com/studio/signin?x=1' }
        : path === '/_home/hub/signin/poll'
          ? ++polls < 3
            ? { ok: true, pending: true }
            : { ok: true, url: 'https://design.example.com', user: 'alice' }
          : { ok: true };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  originalOpen = window.open;
  window.open = ((url: string) => {
    opened.push(String(url));
    return null;
  }) as typeof window.open;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  globalThis.fetch = originalFetch;
  window.open = originalOpen;
  sessionStorage.removeItem(DEV_SECRET_KEY);
  resetHomeSecret();
});

function Harness({
  cards,
  native,
  out,
}: {
  cards: Card[];
  native: boolean;
  out: Record<string, unknown[]>;
}) {
  const [open, setOpen] = useState(false);
  const fixer = useAccountFix({
    onCloudSignIn: (c: unknown) => {
      out.cloud?.push(c);
    },
    onChanged: () => {
      out.changed?.push(1);
    },
    pollMs: 5,
  });
  const shell = { profiles: [{ id: 'default', github: 'alice' }, { id: 'srv' }] };
  return createElement(
    'div',
    null,
    createElement(HomeAccountsChip, {
      summary: homeAccountsSummary(cards),
      shell,
      native,
      open,
      onOpen: () => setOpen(true),
      onClose: () => setOpen(false),
      fixer,
      onAddCloud: () => {},
      onAddTeam: () => {},
      onChanged: () => {
        out.changed?.push(1);
      },
    }),
    createElement(HomeAccountBanner, {
      banner: homeAccountBanner(cards),
      native,
      fixer,
      onReview: () => setOpen(true),
    })
  );
}

function mount(cards: Card[], native = true) {
  const out: Record<string, unknown[]> = { cloud: [], changed: [] };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(createElement(Harness, { cards, native, out }));
  });
  return out;
}
const openList = () => act(() => $('home-accounts-chip')?.click());

describe('the accounts chip', () => {
  test('every sign-in works: "3 accounts", no dot, no banner; old servers are not counted', () => {
    mount(OK_CARDS);
    expect($('home-accounts-chip')?.textContent).toBe('3 accounts');
    expect($('home-accounts-chip-needs')).toBeNull();
    expect($('home-account-banner')).toBeNull();
    expect($('home-accounts')).toBeNull();
  });

  test('a sign-in that stopped working: "1 needs sign-in" on the chip', () => {
    mount(ONE_BAD);
    expect($('home-accounts-chip-needs')?.textContent).toBe('1 needs sign-in');
    expect($('home-accounts-chip')?.getAttribute('data-needs')).toBe('1');
  });

  test('the list: one line per account, the state only when it is not fine, the fix only where it broke', () => {
    mount(ONE_BAD);
    openList();
    expect($('home-accounts')).not.toBeNull();
    expect($('home-account-card-default-cloud')?.getAttribute('data-state')).toBe('ok');
    expect($('home-account-state-default-cloud')).toBeNull();
    expect($('home-account-signin-default-cloud')).toBeNull();
    expect($('home-account-state-srv-design-example-com')?.textContent).toBe(
      'Sign-in stopped working'
    );
    expect($('home-account-signin-srv-design-example-com')?.textContent).toBe('Sign in again');
    // the old servers are folded: not a line of their own
    expect($('home-account-card-srv-localhost-8420')).toBeNull();
    expect($('home-accounts-old')?.textContent).toContain('3 old servers');
    expect($('home-accounts-old')?.getAttribute('aria-expanded')).toBe('false');
    expect($('home-accounts-old-row-srv-localhost-8420')).toBeNull();
  });

  test('a server line signs in to THAT server, says Waiting… while the browser has it, then reloads', async () => {
    const out = mount(ONE_BAD);
    openList();
    act(() => $('home-account-signin-srv-design-example-com')?.click());
    await flush(2);
    expect(posted('/_home/hub/signin/start')).toEqual([
      { profile: 'srv', url: 'https://design.example.com' },
    ]);
    expect(opened).toEqual(['https://design.example.com/studio/signin?x=1']);
    expect($('home-account-signin-srv-design-example-com')?.textContent).toBe('Waiting…');
    expect($('home-account-banner-fix')?.textContent).toBe('Waiting…');
    await flush(20);
    expect(out.changed).toHaveLength(1);
    expect($('home-accounts-error')).toBeNull();
  });

  test('a browser that will not open says so and changes nothing', async () => {
    window.open = (() => {
      throw new Error('blocked');
    }) as typeof window.open;
    const out = mount(ONE_BAD);
    openList();
    act(() => $('home-account-signin-srv-design-example-com')?.click());
    await flush();
    expect($('home-accounts-error')?.textContent).toContain('Nothing changed');
    expect(out.changed).toHaveLength(0);
    expect(posted('/_home/hub/signin/cancel')).toHaveLength(1);
  });

  test('Sign out… lives in the line’s "…" and asks first', async () => {
    mount(OK_CARDS);
    openList();
    act(() => $('home-account-more-srv-design-example-com')?.click());
    act(() => $('home-account-signout-srv-design-example-com')?.click());
    expect($('home-accounts-confirm')?.textContent).toContain('Sign out of design.example.com?');
    expect(posted('/_home/hub/signout')).toEqual([]);
    act(() => $('home-accounts-signout-confirm')?.click());
    await flush();
    expect(posted('/_home/hub/signout')).toEqual([
      { profile: 'srv', url: 'https://design.example.com' },
    ]);
  });

  test('GitHub sits in the "…" of the profile’s first line', () => {
    mount(OK_CARDS);
    openList();
    act(() => $('home-account-more-default-cloud')?.click());
    expect($('home-account-github-default')?.textContent).toBe('GitHub · @alice');
    act(() => $('home-account-more-srv-design-example-com')?.click());
    expect($('home-account-github-signin-srv')?.textContent).toBe('Sign in with GitHub…');
  });
});

describe('old servers', () => {
  test('opened, each has Forget…; nothing is forgotten until the person says so', async () => {
    const out = mount(OK_CARDS);
    openList();
    act(() => $('home-accounts-old')?.click());
    expect($('home-accounts-old-row-srv-localhost-8420')?.textContent).toContain('localhost:8420');
    act(() => $('home-accounts-old-forget-srv-localhost-8420')?.click());
    expect($('home-accounts-confirm')?.textContent).toContain('Forget this server?');
    expect($('home-accounts-confirm')?.textContent).toContain(
      'Nothing on the server or in your projects is deleted.'
    );
    expect(posted('/_home/hub/signout')).toEqual([]);
    act(() => $('home-accounts-forget-cancel')?.click());
    expect($('home-accounts-confirm')).toBeNull();
    expect(posted('/_home/hub/signout')).toEqual([]);
    act(() => $('home-accounts-old-forget-srv-localhost-8420')?.click());
    act(() => $('home-accounts-forget-confirm')?.click());
    await flush();
    expect(posted('/_home/hub/signout')).toEqual([
      { profile: 'srv', url: 'http://localhost:8420' },
    ]);
    expect(out.changed.length).toBeGreaterThan(0);
  });

  test('Forget all N asks once, then forgets every old server and nothing else', async () => {
    mount(OK_CARDS);
    openList();
    act(() => $('home-accounts-old')?.click());
    expect($('home-accounts-old-forget-all')?.textContent).toBe('Forget all 3…');
    act(() => $('home-accounts-old-forget-all')?.click());
    expect($('home-accounts-confirm')?.textContent).toContain('Forget 3 old servers?');
    expect(posted('/_home/hub/signout')).toEqual([]);
    act(() => $('home-accounts-forget-all-confirm')?.click());
    await flush();
    expect(posted('/_home/hub/signout')).toEqual([
      { profile: 'srv', url: 'http://127.0.0.1:1234' },
      { profile: 'srv', url: 'http://localhost:8420' },
      { profile: 'srv', url: 'http://localhost:18500' },
    ]);
  });
});

describe('the banner', () => {
  test('one sign-in stopped working: what broke, whose changes wait, and its own fix', async () => {
    mount(ONE_BAD);
    const b = $('home-account-banner');
    expect(b?.getAttribute('data-kind')).toBe('one');
    expect(b?.textContent).toContain('Your sign-in to design.example.com stopped working.');
    expect(b?.textContent).toContain(
      'Changes to Studio site and Alligators brand wait on this Mac.'
    );
    act(() => $('home-account-banner-fix')?.click());
    await flush(2);
    expect(posted('/_home/hub/signin/start')).toEqual([
      { profile: 'srv', url: 'https://design.example.com' },
    ]);
  });

  test('two problems: a count and Review, which opens the accounts list', () => {
    const out = mount(TWO_BAD);
    expect($('home-account-banner')?.textContent).toContain('2 sign-ins stopped working');
    expect($('home-account-banner-fix')).toBeNull();
    act(() => $('home-account-banner-review')?.click());
    expect($('home-accounts')).not.toBeNull();
    // the Maude Cloud line's fix hands ITS profile to Home's sign-in
    act(() => $('home-account-signin-default-cloud')?.click());
    expect(out.cloud).toHaveLength(1);
    expect(out.cloud[0]).toMatchObject({ profile: 'default', fix: { path: 'cloud-signin' } });
  });
});

test('outside the app: facts only — no Add an account, no Forget…, no live fix', () => {
  mount(ONE_BAD, false);
  openList();
  expect($('home-accounts-add')).toBeNull();
  expect(($('home-account-signin-srv-design-example-com') as HTMLButtonElement).disabled).toBe(
    true
  );
  expect(($('home-account-banner-fix') as HTMLButtonElement).disabled).toBe(true);
  act(() => $('home-accounts-old')?.click());
  expect($('home-accounts-old-forget-srv-localhost-8420')).toBeNull();
  expect($('home-accounts-old-forget-all')).toBeNull();
});
