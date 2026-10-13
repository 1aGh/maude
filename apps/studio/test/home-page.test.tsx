// home-page — the Home page client (V2-3.3) in a live DOM: every request carries `x-maude-home: 1`
// (the Home server answers nothing without it, V2-1.1 §5.3), the shell bridge is called with the
// §5.4 argument shapes, `index://changed` refetches only the changed pids, and outside the desktop
// app the page renders the index without throwing.

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
import { bootShellMode, shellModeHint } from '../client/home/shell-mode.js';

const P1 = 'l00000000000000a1';
const P2 = 'l00000000000000b2';

const INDEX = {
  v: 1,
  projects: [
    {
      pid: P1,
      state: 'ok',
      stale: false,
      project: { root: '/x/a', name: 'Alligators brand', label: null, linkedHub: null },
      counts: { canvases: 2, artboards: 2, byKind: {} },
      canvases: [
        {
          rel: 'ui/Uniformy-2027.tsx',
          name: 'Uniformy-2027',
          folder: 'ui',
          cover: { key: 'aa11', w: 1, h: 1, fresh: true },
          pinnedAt: 10,
          openedAt: 20,
        },
        {
          rel: 'ui/Plakat.tsx',
          name: 'Plakat',
          folder: 'ui',
          cover: null,
          openedAt: 5,
          pinnedAt: null,
        },
      ],
    },
    {
      pid: P2,
      state: 'ok',
      stale: false,
      project: { root: '/x/b', name: 'Studio site', label: null, linkedHub: null },
      counts: { canvases: 1, artboards: 1, byKind: {} },
      canvases: [
        { rel: 'ui/Homepage.tsx', name: 'Homepage', folder: 'ui', openedAt: 30, pinnedAt: null },
      ],
    },
  ],
};

const SHELL = {
  projects: [
    {
      pid: P1,
      root: '/x/a',
      name: 'Alligators brand',
      profile: 'default',
      place: 'tab',
      focused: false,
    },
    {
      pid: P2,
      root: '/x/b',
      name: 'Studio site',
      profile: 'default',
      place: 'closed',
      focused: false,
    },
  ],
  profiles: [{ id: 'default', label: 'Personal' }],
  recent: [P1, P2],
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let invokes: Array<{ cmd: string; args: unknown }> = [];
let listeners: Record<string, (e: { payload: unknown }) => void> = {};
let originalFetch: typeof fetch;

function answer(url: string): unknown {
  const u = new URL(url, 'http://localhost:4479');
  if (u.pathname === '/_config') return { mode: 'home', shell: 'home', version: 'x' };
  if (u.pathname === '/_home/index') {
    const pids = (u.searchParams.get('pids') || '').split(',');
    return { v: 1, projects: INDEX.projects.filter((p) => pids.includes(p.pid)) };
  }
  if (u.pathname === '/_home/cloud')
    return {
      ok: false,
      profile: u.searchParams.get('profile'),
      signedIn: false,
      projects: [],
      shared: [],
    };
  if (u.pathname === '/_home/recent-searches') return { recentSearches: [] };
  if (u.pathname === '/_home/search')
    return {
      q: u.searchParams.get('q'),
      closeOnly: false,
      groups: [
        {
          pid: P2,
          name: 'Studio site',
          rows: [
            {
              group: 'canvases',
              key: 'ui/Homepage.tsx',
              name: 'Homepage',
              meta: 'ui',
              marks: [[0, 4]],
              cover: null,
            },
          ],
        },
      ],
    };
  if (u.pathname === '/_home/pins') return { ok: true, pins: [] };
  return { error: 'nope' };
}

function installFetch() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers as Record<string, string>) || {}))
      headers[k.toLowerCase()] = v;
    calls.push({
      url,
      method: init.method || 'GET',
      headers,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(answer(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function installTauri(label = 'home') {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label }, currentWebview: { label } } };
  w.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args: unknown) => {
        invokes.push({ cmd, args });
        if (cmd === 'shell_state') return SHELL;
        if (cmd === 'open_project') return { label: 'p-x', opened: 'existing' };
        return null;
      },
    },
    event: {
      listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
        listeners[name] = cb;
        return () => {
          delete listeners[name];
        };
      },
    },
  };
}

function removeTauri() {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = undefined;
  w.__TAURI_INTERNALS__ = undefined;
}

const flush = async (n = 6) => {
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

beforeEach(() => {
  calls = [];
  invokes = [];
  listeners = {};
  installFetch();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  globalThis.fetch = originalFetch;
  removeTauri();
});

describe('Home page in the desktop app', () => {
  beforeEach(() => installTauri('home'));

  test('every request carries x-maude-home: 1', async () => {
    mount();
    await flush();
    const input = $('home-search') as HTMLInputElement;
    act(() => input.focus());
    // type: the input's own React onChange (happy-dom's input event does not reach it here)
    const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps')) as string;
    const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[
      propsKey
    ];
    act(() => props?.onChange({ target: { value: 'home' } }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    await flush();
    act(() => $(`home-pin-${P2}-ui-homepage`)?.click());
    await flush();
    const paths = new Set(calls.map((c) => new URL(c.url, 'http://x').pathname));
    for (const p of [
      '/_home/index',
      '/_home/cloud',
      '/_home/recent-searches',
      '/_home/search',
      '/_home/pins',
    ])
      expect(paths.has(p)).toBe(true);
    // pictures are fetched WITH the header (an <img src> could not send it), shown as blob: URLs
    expect(paths.has(`/_home/thumb/${P1}/aa11.jpg`)).toBe(true);
    for (const c of calls) expect(c.headers['x-maude-home']).toBe('1');
  });

  test('builds the page from shell_state + /_home/index (running = place:tab)', async () => {
    mount();
    await flush();
    expect(invokes[0]?.cmd).toBe('shell_state');
    const ix = calls.find((c) => c.url.startsWith('/_home/index'));
    const u = new URL(ix?.url ?? '', 'http://x');
    expect(u.searchParams.get('pids')).toBe(`${P1},${P2}`);
    expect(u.searchParams.get('running')).toBe(P1);
    expect($('home-root')?.getAttribute('class')).toContain('maude-v2');
    expect($('home-root')?.getAttribute('data-theme')).toMatch(/^(light|dark)$/);
    expect($(`home-pinned-row-${P1}-ui-uniformy-2027`)).not.toBeNull();
    // Recent by openedAt: Homepage (30), Uniformy (20), Plakat (5)
    const recent = [...host.querySelectorAll('[data-testid^="home-recent-row-"]')].map((e) =>
      e.getAttribute('data-testid')
    );
    expect(recent).toEqual([
      `home-recent-row-${P2}-ui-homepage`,
      `home-recent-row-${P1}-ui-uniformy-2027`,
      `home-recent-row-${P1}-ui-plakat`,
    ]);
    expect($(`home-project-row-${P1}`)?.textContent).toContain('in a tab');
    expect($(`home-project-row-${P2}`)?.textContent).toContain('this Mac only');
  });

  test('picking a canvas calls open_project({pid, target:{canvas}}); Open project… calls open_project_folder', async () => {
    mount();
    await flush();
    act(() => $(`home-recent-row-${P2}-ui-homepage`)?.click());
    await flush();
    expect(invokes.find((i) => i.cmd === 'open_project')?.args).toEqual({
      pid: P2,
      target: { canvas: 'ui/Homepage.tsx' },
    });
    act(() => $(`home-project-row-${P1}`)?.click());
    await flush();
    expect(invokes.filter((i) => i.cmd === 'open_project')[1]?.args).toEqual({ pid: P1 });
    act(() => $('home-open-folder')?.click());
    await flush();
    expect(invokes.some((i) => i.cmd === 'open_project_folder')).toBe(true);
  });

  test('pin toggles POST /_home/pins {pid, canvas, pinned}', async () => {
    mount();
    await flush();
    act(() => $(`home-pin-${P1}-ui-plakat`)?.click());
    await flush();
    const pin = calls.find((c) => c.url === '/_home/pins');
    expect(pin?.method).toBe('POST');
    expect(pin?.body).toEqual({ pid: P1, canvas: 'ui/Plakat.tsx', pinned: true });
    expect($(`home-pinned-row-${P1}-ui-plakat`)).not.toBeNull();
  });

  test('index://changed refetches only the changed pids', async () => {
    mount();
    await flush();
    calls = [];
    await act(async () => listeners['index://changed']?.({ payload: { pids: [P2] } }));
    await flush();
    const ix = calls.filter((c) => c.url.startsWith('/_home/index'));
    expect(ix.length).toBe(1);
    expect(new URL(ix[0]?.url ?? '', 'http://x').searchParams.get('pids')).toBe(P2);
    // P1's rows survive a P2-only refresh
    expect($(`home-recent-row-${P1}-ui-uniformy-2027`)).not.toBeNull();
  });

  test('shell://state with a moved place refetches that pid only', async () => {
    mount();
    await flush();
    calls = [];
    const next = {
      ...SHELL,
      projects: SHELL.projects.map((p) => (p.pid === P2 ? { ...p, place: 'tab' } : p)),
    };
    await act(async () => listeners['shell://state']?.({ payload: next }));
    await flush();
    const ix = calls.filter((c) => c.url.startsWith('/_home/index'));
    expect(ix.length).toBe(1);
    const u = new URL(ix[0]?.url ?? '', 'http://x');
    expect(u.searchParams.get('pids')).toBe(P2);
    expect(u.searchParams.get('running')).toBe(P2);
    expect($(`home-project-row-${P2}`)?.textContent).toContain('in a tab');
  });
});

describe('Home page in a browser (no shell)', () => {
  test('renders the index read-only from ?pids= and never throws', async () => {
    window.history.replaceState(null, '', `/?pids=${P1}`);
    mount();
    await flush();
    expect(invokes.length).toBe(0);
    expect($(`home-recent-row-${P1}-ui-uniformy-2027`)).not.toBeNull();
    expect(($(`home-recent-row-${P1}-ui-uniformy-2027`) as HTMLButtonElement).disabled).toBe(true);
    expect(($('home-open-folder') as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain('open in a browser');
    window.history.replaceState(null, '', '/');
  });
});

describe('shell mode', () => {
  test('a project webview renders the project shell without asking /_config', () => {
    installTauri('p-l00000000000000a1');
    expect(shellModeHint()).toBe('project');
    let got: string | null = null;
    bootShellMode((m: string) => {
      got = m;
    });
    expect(got).toBe('project');
    expect(calls.length).toBe(0);
  });

  test('loopback browser asks /_config WITH the Home header and renders Home on mode:home', async () => {
    let got: string | null = null;
    bootShellMode((m: string) => {
      got = m;
    });
    await flush();
    expect(got).toBe('home');
    expect(calls[0]?.url).toBe('/_config');
    expect(calls[0]?.headers['x-maude-home']).toBe('1');
  });

  test('a non-loopback host (a cloud cell) is a project with no request', () => {
    const fake = { location: { hostname: 'alligators.cloud.maude.sh' } };
    expect(shellModeHint(fake)).toBe('project');
  });
});

describe('home-api', () => {
  test('every HTTP helper sends x-maude-home: 1 (none can be added without it)', async () => {
    const http = Object.entries(api).filter(
      ([name, fn]) =>
        typeof fn === 'function' &&
        !['homeFetch', 'inShell', 'shellInvoke', 'shellListen'].includes(name) &&
        !/^(shellState|openProject|openProjectFolder|relinkProject|managedProjectOpen|openCloudUrl)$/.test(
          name
        )
    );
    expect(http.map(([n]) => n).sort()).toEqual(
      [
        'getCloud',
        'getConfig',
        'getIndex',
        'getRecentSearches',
        'prepareCloud',
        'saveRecentSearch',
        'search',
        'setPin',
        'thumbObjectUrl',
      ].sort()
    );
    for (const [, fn] of http) await (fn as (...a: unknown[]) => Promise<unknown>)('a', 'b', 'c');
    expect(calls.length).toBe(http.length);
    for (const c of calls) expect(c.headers['x-maude-home']).toBe('1');
  });

  test('outside the app the shell bridge resolves null and never throws', async () => {
    expect(api.inShell()).toBe(false);
    expect(await api.shellState()).toBeNull();
    expect(await api.openProject({ pid: P1 }, { canvas: 'ui/x.tsx' })).toBeNull();
    const off = await api.shellListen('shell://state', () => {});
    expect(typeof off).toBe('function');
  });
});
