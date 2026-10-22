// p8-c-nav-home — Phase 8 stage C, area C8 (Home): first run stays quiet, the Home pill is a real menu button
// (Menu › Help › What's new reachable), Home's sheets trap Tab, the top bar keeps the question when the page
// scrolls, Find a project + sort, See all, and ⌘K opens a centred palette. Tauri is stubbed as in
// home-first-run.test.tsx; no keychain, no real cloud.

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

import * as api from '../client/home/home-api.js';
import { HomeApp } from '../client/home/home-app.jsx';

const P1 = 'l00000000000000a1';
const STATE = 'c0'.repeat(16);
const OTHER = 'd1'.repeat(16);
const USER_CODE = 'BCDF-GHJK';
const SECRET = 'ef'.repeat(32);

const INDEX = {
  v: 1,
  projects: [
    {
      pid: P1,
      state: 'ok',
      stale: false,
      project: { root: '/x/a', name: 'Alligators brand', label: null, linkedHub: null },
      counts: { canvases: 1, artboards: 1, byKind: { print: 1 } },
      canvases: [{ rel: 'ui/Plakat.tsx', name: 'Plakat', folder: 'ui', cover: null, openedAt: 5 }],
    },
  ],
};
const SHELL_ONE = {
  projects: [
    { pid: P1, root: '/x/a', name: 'Alligators brand', profile: 'default', place: 'closed' },
  ],
  profiles: [{ id: 'default', label: 'Personal' }],
  recent: [P1],
};
const SHELL_NONE = { projects: [], profiles: [{ id: 'default', label: 'Personal' }], recent: [] };
const OUT = { ok: false, profile: 'default', signedIn: false, projects: [], shared: [] };
const IN = (n: number) => ({
  ok: true,
  profile: 'default',
  signedIn: true,
  account: { email: 'me@work.cz' },
  projects: Array.from({ length: n }, (_, i) => ({
    projectId: `p${i}`,
    name: `Cloud ${i}`,
    role: 'owner',
    url: 'https://cloud.example/p',
  })),
  shared: [],
});

type Call = { url: string; method: string; body: any };
type Reply = [number, unknown];
let calls: Call[] = [];
let invokes: Array<{ cmd: string; args: any }> = [];
let busChannel: { onmessage?: (m: unknown) => void } | null = null;
let shell: unknown = SHELL_NONE;
let cloud: unknown = OUT;
let routes: Record<string, (body: any) => Reply> = {};
let invokeAnswers: Record<string, (args: any) => unknown> = {};
let originalFetch: typeof fetch;
const deliver = (kind: string, payload: unknown) => busChannel?.onmessage?.({ kind, payload });

function defaults(pathname: string, u: URL): Reply {
  if (pathname === '/_home/index') {
    const pids = (u.searchParams.get('pids') || '').split(',');
    return [200, { v: 1, projects: INDEX.projects.filter((p) => pids.includes(p.pid)) }];
  }
  if (pathname === '/_home/cloud') return [200, cloud];
  if (pathname === '/_home/recent-searches') return [200, { recentSearches: [] }];
  if (pathname === '/_home/whats-new')
    return [200, { version: '2.0.0', entries: [], seen: '2.0.0' }];
  if (pathname === '/_home/projects/create-local')
    return [200, { ok: true, root: '/Users/x/Maude/Portfolio', pid: 'lnew', name: 'Portfolio' }];
  return [404, { error: 'nope' }];
}

function installFetch() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const u = new URL(url, 'http://localhost:4479');
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init.method || 'GET', body });
    const [status, json] = (routes[u.pathname] ?? ((_b: unknown) => defaults(u.pathname, u)))(body);
    return new Response(JSON.stringify(json), {
      status,
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
        if (invokeAnswers[cmd]) return invokeAnswers[cmd](args);
        if (cmd === 'shell_state') return shell;
        if (cmd === 'open_project') return { label: 'p-x', opened: 'new' };
        if (cmd === 'home_cloud_sign_in_prepare') return 'default';
        if (cmd === 'home_cloud_sign_in_open') return null;
        if (cmd === 'home_cloud_signed_in') return 'default';
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

const flush = async (n = 8) => {
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
const setOnline = (v: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(v ? 'online' : 'offline'));
  });
};
const hit = (path: string) => calls.filter((c) => c.url.startsWith(path));
const cmds = (name: string) => invokes.filter((i) => i.cmd === name);

/** A cloud that starts an attempt with STATE and answers polls from `poll`. */
function fakeCloud(poll: () => Reply = () => [200, { status: 'pending' }]) {
  routes['/_home/cloud/signin/start'] = () => [
    200,
    { ok: true, userCode: USER_CODE, state: STATE, expiresIn: 600 },
  ];
  routes['/_home/cloud/signin/poll'] = poll;
  routes['/_home/cloud/signin/cancel'] = () => [200, { ok: true }];
}
async function startSignIn() {
  click('signin-cloud');
  await flush();
}

beforeEach(() => {
  calls = [];
  invokes = [];
  busChannel = null;
  shell = SHELL_NONE;
  cloud = OUT;
  routes = {};
  invokeAnswers = {};
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
  removeTauri();
  api.resetHomeSecret();
});

const press = (el: Element | null, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    (el ?? document.body).dispatchEvent(e);
  });
  return e;
};

describe('a first run stays quiet (05 es-home-cloud · 02 ob-first-launch)', () => {
  test('the card alone: no Recent canvases line, no empty projects shelf under it', async () => {
    mount();
    await flush();
    expect($('signin-card')).not.toBeNull();
    expect($('home-projects-empty')).toBeNull();
    expect(host.textContent).not.toContain('Canvases you open show up here');
    expect(host.querySelector('#home-h-recent')).toBeNull();
  });

  test('signed in with nothing yet: the projects shelf says so, and Recent still stays out of the way', async () => {
    cloud = IN(0);
    mount();
    await flush();
    expect($('signin-card')).toBeNull();
    expect($('home-projects-empty')).not.toBeNull();
    expect(host.querySelector('#home-h-recent')).toBeNull();
  });
});

describe('the Home pill is a menu button (02 ob-edge-whats-new)', () => {
  test('a button with a caret that opens the one menu; Help › What’s new is in it', async () => {
    mount();
    await flush();
    const pill = $('project-pill');
    expect(pill?.tagName).toBe('BUTTON');
    expect(pill?.getAttribute('aria-haspopup')).toBe('menu');
    expect(pill?.textContent).toContain('Home');
    act(() => pill?.click());
    expect($('project-menu')).not.toBeNull();
    act(() => $('project-menu-row-sub-help')?.click());
    const row = $('project-menu-row-help.whats-new');
    expect(row?.textContent).toContain("What's new");
  });

  test('File › New project… opens the Create a local project sheet', async () => {
    mount();
    await flush();
    act(() => $('project-pill')?.click());
    act(() => $('project-menu-row-sub-file')?.click());
    act(() => $('project-menu-row-project.new')?.click());
    expect($('home-create-dialog')).not.toBeNull();
  });

  test('What’s new reads the feed even when everything is seen', async () => {
    routes['/_home/whats-new'] = () => [
      200,
      {
        version: '2.0.0',
        seen: '2.0.0',
        entries: [
          {
            id: 'e1',
            version: '2.0.0',
            title: 'A new look',
            summary: 'The canvas fills the window.',
          },
        ],
      },
    ];
    shell = SHELL_ONE;
    mount();
    await flush();
    act(() => $('project-pill')?.click());
    act(() => $('project-menu-row-sub-help')?.click());
    act(() => $('project-menu-row-help.whats-new')?.click());
    expect($('home-whatsnew-dialog')?.textContent).toContain('A new look');
  });
});

describe("Home's sheets trap Tab (02 a11y RO2)", () => {
  async function openCreate() {
    mount();
    await flush();
    click('signin-local');
    await flush();
    return $('home-create-dialog') as HTMLElement;
  }

  test('Tab on the last control of the Create sheet wraps to the first, not into Home behind it', async () => {
    const dialog = await openCreate();
    const items = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input')];
    const last = items[items.length - 1];
    last.focus();
    const e = press(last, 'Tab');
    expect(e.defaultPrevented).toBe(true);
    const modal = host.querySelector('[role=dialog]') as HTMLElement;
    expect(modal.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });

  test('esc closes it once, from inside', async () => {
    const dialog = await openCreate();
    press(dialog.querySelector('input'), 'Escape');
    await flush();
    expect($('home-create-dialog')).toBeNull();
  });
});

describe('Home CSS rules pinned (02 ob-door · 11 pn-home)', () => {
  const css = require('node:fs').readFileSync(
    require('node:path').join(import.meta.dir, '../client/home/home.css'),
    'utf8'
  ) as string;
  test('the sign-in doors have the kit large button', () => {
    expect(css).toMatch(/\.home-root \.btn--lg \{[^}]*height: 40px/);
  });
  test('the wrapper under the question stretches so the card can be 600 wide', () => {
    expect(css).toMatch(/\.home-below \{[^}]*align-self: stretch/);
  });
});
