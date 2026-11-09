// 2.1.1 B4 (artboard 14) — Home's accounts row: each account with its state; a sign-in that stopped
// working is fixed from its own card (Maude Cloud → Home's sign-in for that profile, your server → the
// team-server sign-in with its address); a server that does not answer has no button.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
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

import { HomeAccountsRow } from '../client/home/HomeAccountsRow.jsx';
import { DEV_SECRET_KEY, resetHomeSecret } from '../client/home/home-api.js';

const card = (over: Record<string, unknown>) => ({
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
  ...over,
});
const CARDS = [
  card({ key: 'cloud:default' }),
  card({
    key: 'cloud:bright',
    profile: 'bright',
    title: 'hello@brightside.example',
    state: 'rejected',
    word: 'Sign-in stopped working',
    fix: { path: 'cloud-signin', profile: 'bright', label: 'Sign in again' },
  }),
  card({
    key: 'server:srv:a',
    kind: 'server',
    profile: 'srv',
    url: 'https://design.example.com',
    face: { kind: 'server' },
    title: 'alice@example.com',
    sub: 'design.example.com · 2 projects',
    state: 'rejected',
    word: 'Sign-in stopped working',
    fix: {
      path: 'hub-signin',
      profile: 'srv',
      url: 'https://design.example.com',
      label: 'Sign in again',
    },
  }),
  card({
    key: 'server:srv:b',
    kind: 'server',
    profile: 'srv',
    url: 'https://down.example.com',
    face: { kind: 'server' },
    title: 'down.example.com',
    sub: 'Your server · 1 project',
    state: 'unreachable',
    word: 'Server unreachable',
    fix: null,
  }),
];

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
          ? ++polls < 2
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

function mount(props: Record<string, unknown> = {}) {
  const out = { cloud: [] as unknown[], changed: 0 };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(
      createElement(HomeAccountsRow, {
        cards: CARDS,
        native: true,
        pollMs: 5,
        onCloudSignIn: (c: unknown) => out.cloud.push(c),
        onAddCloud: () => {},
        onAddTeam: () => {},
        onChanged: () => {
          out.changed++;
        },
        ...props,
      })
    );
  });
  return out;
}

describe('Home accounts row', () => {
  test('one card per account, each with its state word', () => {
    mount();
    expect($('home-account-state-default-cloud')?.textContent).toBe('Connected');
    expect($('home-account-state-bright-cloud')?.textContent).toBe('Sign-in stopped working');
    expect($('home-account-state-srv-design-example-com')?.textContent).toBe(
      'Sign-in stopped working'
    );
    expect($('home-account-state-srv-down-example-com')?.textContent).toBe('Server unreachable');
    expect($('home-account-card-bright-cloud')?.getAttribute('data-state')).toBe('rejected');
  });

  test('Sign in again exists only where the person can fix it', () => {
    mount();
    expect($('home-account-signin-default-cloud')).toBeNull();
    expect($('home-account-signin-bright-cloud')?.textContent).toBe('Sign in again');
    expect($('home-account-signin-srv-design-example-com')?.textContent).toBe('Sign in again');
    expect($('home-account-signin-srv-down-example-com')).toBeNull();
  });

  test('a Maude Cloud card hands ITS profile to Home’s sign-in', () => {
    const out = mount();
    act(() => $('home-account-signin-bright-cloud')?.click());
    expect(out.cloud).toHaveLength(1);
    expect(out.cloud[0]).toMatchObject({ profile: 'bright', fix: { path: 'cloud-signin' } });
  });

  test('a server card signs in to THAT server (address prefilled), waits for the browser, then reloads', async () => {
    const out = mount();
    act(() => $('home-account-signin-srv-design-example-com')?.click());
    await flush();
    const start = calls.find((c) => c.path === '/_home/hub/signin/start');
    expect(start?.body).toEqual({ profile: 'srv', url: 'https://design.example.com' });
    expect(opened).toEqual(['https://design.example.com/studio/signin?x=1']);
    await flush(12);
    expect(calls.filter((c) => c.path === '/_home/hub/signin/poll').length).toBeGreaterThan(1);
    expect(out.changed).toBe(1);
    expect($('home-accounts-row-error')).toBeNull();
  });

  test('a browser that will not open says so and changes nothing', async () => {
    window.open = (() => {
      throw new Error('blocked');
    }) as typeof window.open;
    const out = mount();
    act(() => $('home-account-signin-srv-design-example-com')?.click());
    await flush();
    expect($('home-accounts-row-error')?.textContent).toContain('Nothing changed');
    expect(out.changed).toBe(0);
    expect(calls.some((c) => c.path === '/_home/hub/signin/cancel')).toBe(true);
  });

  test('outside the app the cards are facts only: no Add an account, no live button', () => {
    mount({ native: false });
    expect($('home-accounts-row-add')).toBeNull();
    expect(($('home-account-signin-bright-cloud') as HTMLButtonElement).disabled).toBe(true);
  });
});
