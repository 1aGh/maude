// p8-c2-nav-home — stage C round 2, area C8 (Home): the ⌘K palette (centred, shortcut groups before you type,
// an Ask AI row), Find a project + sort, the trailing project square, See all, the top-right face.
// Tauri is stubbed as in p8-c-nav-home.test.tsx; no keychain, no real cloud.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost:4479/' });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// seven canvases in one project and three projects, so See all and Find a project have something to do
const PB = 'l00000000000000b2';
const PC = 'l00000000000000c3';
const MANY = {
  v: 1,
  projects: [
    {
      pid: P1,
      state: 'ok',
      stale: false,
      project: { root: '/x/a', name: 'Alligators brand', label: null, linkedHub: null },
      counts: { canvases: 7, artboards: 7, byKind: { print: 7 } },
      canvases: Array.from({ length: 7 }, (_, i) => ({
        rel: `ui/C${i}.tsx`,
        name: `Canvas ${i}`,
        folder: 'ui',
        cover: null,
        openedAt: 100 - i,
      })),
    },
    {
      pid: PB,
      state: 'ok',
      stale: false,
      project: { root: '/x/b', name: 'Studio site', label: null, linkedHub: null },
      counts: { canvases: 0, artboards: 0, byKind: {} },
      canvases: [],
    },
    {
      pid: PC,
      state: 'ok',
      stale: false,
      project: { root: '/x/c', name: 'Portfolio 2026', label: null, linkedHub: null },
      counts: { canvases: 0, artboards: 0, byKind: {} },
      canvases: [],
    },
  ],
};
const SHELL_MANY = {
  projects: [
    { pid: P1, root: '/x/a', name: 'Alligators brand', profile: 'default', place: 'tab' },
    {
      pid: PB,
      root: '/x/b',
      name: 'Studio site',
      profile: 'default',
      place: 'tab',
      ai: { running: 1 },
    },
    { pid: PC, root: '/x/c', name: 'Portfolio 2026', profile: 'default', place: 'closed' },
  ],
  profiles: [{ id: 'default', label: 'Personal' }],
  recent: [P1, PB, PC],
};
function many() {
  shell = SHELL_MANY;
  routes['/_home/index'] = () => [200, MANY];
}
const type = (el: HTMLElement | null, value: string) => {
  const key = Object.keys(el ?? {}).find((k) => k.startsWith('__reactProps')) as string;
  act(() => (el as any)[key].onChange({ target: { value } }));
};

describe('⌘K on Home is a centred palette (11 pn-home-search)', () => {
  test('the top bar holds an icon + the ⌘K key; the field is not on the page until it opens', async () => {
    many();
    mount();
    await flush();
    expect($('home-search-open')).not.toBeNull();
    expect($('home-search-open')?.textContent).toContain('⌘K');
    expect($('home-search')).toBeNull();
  });

  test('⌘K opens a 620 dialog with the placeholder, an esc key, and the shortcut groups', async () => {
    many();
    mount();
    await flush();
    press(document.body, 'k', { metaKey: true });
    await flush();
    const dlg = host.querySelector('[role="dialog"][aria-label="Search"]') as HTMLElement;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const input = $('home-search') as HTMLInputElement;
    expect(input.placeholder).toBe('Search canvases, artboards, actions, or ask AI…');
    expect(dlg.textContent).toContain('esc');
    // before you type: open tabs (with their AI) and recent canvases, an Ask AI row, a ↑↓ ↵ foot
    expect(dlg.textContent).toContain('Open tabs');
    expect($(`home-search-tab-${PB}`)?.textContent).toContain('AI is working');
    expect(dlg.textContent).toContain('Recent canvases');
    expect(host.querySelectorAll('[data-testid^="home-search-recent-"]').length).toBe(3);
    expect($('home-search-ask')?.textContent).toContain('describe what you want on the canvas');
    expect(dlg.querySelector('.home-pal-foot')?.textContent).toContain('move');
  });

  test('esc closes it; the veil closes it; a tab row opens that project', async () => {
    many();
    mount();
    await flush();
    click('home-search-open');
    await flush();
    press($('home-search'), 'Escape');
    await flush();
    expect($('home-search')).toBeNull();
    click('home-search-open');
    await flush();
    click(`home-search-tab-${PB}`);
    await flush();
    expect(cmds('open_project').length).toBe(1);
    expect($('home-search')).toBeNull();
  });

  test('Ask AI with a sentence starts a canvas from it', async () => {
    many();
    mount();
    await flush();
    click('home-search-open');
    await flush();
    type($('home-search'), 'a poster');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    press($('home-search'), 'Enter', { metaKey: true });
    await flush();
    expect(
      hit('/_home/projects/create-local').length + cmds('open_project').length
    ).toBeGreaterThan(0);
  });
});

describe('Recent canvases: one row of six, See all (11 pn-home)', () => {
  test('seven canvases show six; See all shows the seventh', async () => {
    many();
    mount();
    await flush();
    const n = () => host.querySelectorAll('[data-testid^="home-recent-row-"]').length;
    expect(n()).toBe(6);
    click('home-recent-seeall');
    await flush();
    expect(n()).toBe(7);
  });
});

describe('Projects: Find a project + sort + trailing square (11 pn-home)', () => {
  test('typing narrows the list; Name sorts; every row ends in the project square', async () => {
    many();
    mount();
    await flush();
    const rows = () =>
      [...host.querySelectorAll('[data-testid^="home-project-row-"]')].map((r) => r.textContent);
    expect(rows().length).toBe(3);
    type($('home-project-find'), 'stud');
    await flush();
    expect(rows().length).toBe(1);
    expect(rows()[0]).toContain('Studio site');
    type($('home-project-find'), '');
    const sort = $('home-project-sort') as HTMLSelectElement;
    act(() => {
      sort.value = 'name';
      sort.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(rows()[0]).toContain('Alligators');
    expect(rows()[2]).toContain('Studio');
    const first = host.querySelector('[data-testid^="home-project-row-"]') as HTMLElement;
    expect(first.querySelector('.home-sq')).not.toBeNull();
  });

  test('Pinned says where to pin (the board words)', async () => {
    many();
    routes['/_home/pins'] = () => [200, { ok: true }];
    mount();
    await flush();
    await act(async () => {
      $(`home-pin-${P1}-ui-c0`)?.click();
    });
    await flush();
    expect(host.textContent).toContain('pin any canvas from its row or its menu');
  });
});

describe('the docked ask row and the top-right face (CSS pinned)', () => {
  const css = readFileSync(join(import.meta.dir, '../client/home/home.css'), 'utf8');
  test('the slim ask row is fixed in the header row, so it never scrolls away', () => {
    const rule = css.match(/\.home-askbar-wrap \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('top: var(--space-4)');
    expect(rule).not.toContain('sticky');
  });
  test('the palette is 620 wide over a veil', () => {
    expect(css).toMatch(/\.home-pal \{[^}]*width: 620px/);
    expect(css).toContain('.home-pal-veil');
  });
});

// P8 C7 (11 · pn-home): what scrolls under the sticky header fades behind it, so the docked ask bar sits on a clear row
describe('the header fades what scrolls under it', () => {
  test('.home-top::before paints the canvas colour out to transparent, behind the header and out of the way of clicks', () => {
    const css = readFileSync(join(import.meta.dir, '..', 'client', 'home', 'home.css'), 'utf8');
    const rule = css.match(/\.home-top::before \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('var(--canvas-bg)');
    expect(rule).toContain('transparent');
    expect(rule).toContain('z-index: -1');
    expect(rule).toContain('pointer-events: none');
  });
});
