// home-page — the Home page client (V2-3.3) in a live DOM: every request carries `x-maude-home: <page secret>`
// (from `home_session()`, V2-3.6 H1 — the Home server answers nothing without it, V2-1.1 §5.3), the shell bridge is called with the
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
// V2-3.6 H1 — the Home page secret `home_session()` hands the Home window; its calls are counted
// apart from `invokes` (they are plumbing, not a shell action the page took)
const SECRET = 'ef'.repeat(32);
let sessions = 0;
let sessionAnswer: (() => unknown) | null = null;
// Finding 1d: the shell reaches Home ONLY through the Channel Home hands `shell_subscribe`
// (client/shell-bus.js). `listeners[kind]({payload})` delivers one shell message on it.
let busChannel: { onmessage?: (m: unknown) => void } | null = null;
let subscribes = 0;
let eventListens: string[] = [];
const deliver =
  (kind: string) =>
  (e: { payload: unknown }): void =>
    busChannel?.onmessage?.({ kind, payload: e.payload });
const listeners: Record<string, (e: { payload: unknown }) => void> = new Proxy(
  {},
  { get: (_t, kind) => deliver(String(kind)) }
);
// per-test shell answers (cmd → value or fn(args)); consulted before the defaults
let shellAnswers: Record<string, unknown> = {};
let shellOverride: typeof SHELL | null = null;
// per-test fetch answers (pathname → [status, body]); consulted before `answer`
let fetchAnswers: Record<string, [number, unknown]> = {};
let windowListeners: Record<string, (e: { payload: unknown }) => void> = {};
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
  if (u.pathname === '/_home/projects/create-local')
    return { ok: true, root: '/Users/x/Maude/Plakaty', pid: 'lnew', name: 'Plakaty' };
  if (u.pathname === '/_home/cloud/prepare')
    return {
      ok: true,
      serverUrl: 'https://alligators.cloud.maude.sh',
      projectId: 'alligators',
      name: 'alligators',
      canvasGroups: [],
      profile: 'default',
    };
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
    const over = fetchAnswers[new URL(url, 'http://localhost:4479').pathname];
    return new Response(JSON.stringify(over ? over[1] : answer(url)), {
      status: over ? over[0] : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function installTauri(label = 'home') {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label }, currentWebview: { label } } };
  w.__TAURI__ = {
    core: {
      Channel: class {
        onmessage?: (m: unknown) => void;
      },
      invoke: async (cmd: string, args: unknown) => {
        if (cmd === 'shell_subscribe') {
          subscribes++;
          busChannel = (args as { onMessage: { onmessage?: (m: unknown) => void } }).onMessage;
          return null;
        }
        if (cmd === 'home_session') {
          sessions++;
          return sessionAnswer ? sessionAnswer() : { secret: SECRET };
        }
        invokes.push({ cmd, args });
        if (cmd in shellAnswers) {
          const a = shellAnswers[cmd];
          return typeof a === 'function' ? (a as (x: unknown) => unknown)(args) : a;
        }
        if (cmd === 'shell_state') return shellOverride ?? SHELL;
        if (cmd === 'open_project') return { label: 'p-x', opened: 'existing' };
        return null;
      },
    },
    // A global listener hears every `emit_to` in every webview — Home must not use one.
    event: {
      listen: async (name: string) => {
        eventListens.push(name);
        return () => {};
      },
    },
  };
}

function removeTauri() {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = undefined;
  w.__TAURI_INTERNALS__ = undefined;
  w.__maudeShellBus = undefined;
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
  sessions = 0;
  sessionAnswer = null;
  api.resetHomeSecret();
  busChannel = null;
  subscribes = 0;
  eventListens = [];
  (window as unknown as Record<string, unknown>).__maudeShellBus = undefined;
  windowListeners = {};
  shellAnswers = {};
  fetchAnswers = {};
  shellOverride = null;
  installFetch();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  globalThis.fetch = originalFetch;
  removeTauri();
  api.resetHomeSecret();
  try {
    sessionStorage.removeItem(api.DEV_SECRET_KEY);
  } catch {}
});

describe('Home page in the desktop app', () => {
  beforeEach(() => installTauri('home'));

  test('every request carries x-maude-home: <the page secret>, fetched once', async () => {
    mount();
    await flush();
    // the field lives in the ⌘K palette now (11 pn-home-search): open it first
    act(() => $('home-search-open')?.click());
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
    for (const c of calls) expect(c.headers['x-maude-home']).toBe(SECRET);
    expect(sessions).toBe(1);
  });

  test('a refused home_session sends no request at all (and is asked again later)', async () => {
    sessionAnswer = () => {
      throw new Error('Only the Home window can do that.');
    };
    expect(await api.getConfig()).toEqual({ ok: false, status: 403, json: null });
    expect(await api.thumbObjectUrl(`/_home/thumb/${P1}/refused.jpg`)).toBeNull();
    expect(calls.length).toBe(0);
    sessionAnswer = null;
    expect((await api.getConfig()).ok).toBe(true);
    expect(calls[0]?.headers['x-maude-home']).toBe(SECRET);
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
    // 2.1.2 (artboard 15): Pinned joined Recent canvases — the pinned card leads (its pin shows on the
    // card), then by openedAt: Uniformy (pinned), Homepage (30), Plakat (5)
    expect($('home-h-pinned')).toBeNull();
    const recent = [...host.querySelectorAll('[data-testid^="home-recent-row-"]')].map((e) =>
      e.getAttribute('data-testid')
    );
    expect(recent).toEqual([
      `home-recent-row-${P1}-ui-uniformy-2027`,
      `home-recent-row-${P2}-ui-homepage`,
      `home-recent-row-${P1}-ui-plakat`,
    ]);
    expect($(`home-pin-${P1}-ui-uniformy-2027`)?.getAttribute('aria-pressed')).toBe('true');
    // 2.1.2 (artboard 19): a row is a name, where it lives, and a state only when it isn't fine —
    // no "in a tab", no "Only on this Mac", no path, no canvas count
    expect($(`home-project-row-${P1}`)?.textContent).not.toContain('in a tab');
    expect($(`home-project-row-${P2}`)?.textContent).not.toContain('Only on this Mac');
    expect($(`home-project-row-${P2}`)?.textContent).not.toContain('canvas');
    expect($(`home-project-where-${P2}`)?.getAttribute('data-kind')).toBe('folder');
    expect($(`home-project-where-${P2}`)?.textContent).toBe('Your folder');
    expect($(`home-project-conn-${P2}`)?.getAttribute('data-state')).toBe('local');
    expect($(`home-project-conn-${P2}`)?.textContent).toBe('');
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

  test('File ▸ New Project… on Home opens the create sheet: create-local, then open_project({root})', async () => {
    mount();
    await flush();
    expect($('home-create-dialog')).toBeNull();
    // menu.rs sends `menu://action {id}` to the ACTIVE tab; any id but these two is not Home's.
    await act(async () => listeners['menu://action']?.({ payload: { id: 'file.save' } }));
    expect($('home-create-dialog')).toBeNull();
    expect(invokes.some((i) => i.cmd === 'open_project')).toBe(false);
    // S6.4: ⌘N on Home is the `create-empty` intent in the chip's project — not the create sheet
    await act(async () => listeners['menu://action']?.({ payload: { id: 'canvas.new' } }));
    await flush();
    expect($('home-create-dialog')).toBeNull();
    expect(invokes.filter((i) => i.cmd === 'open_project').map((i) => i.args)).toEqual([
      { pid: P1, intent: { kind: 'create-empty', prompt: '' } },
    ]);
    invokes = invokes.filter((i) => i.cmd !== 'open_project');
    await act(async () => listeners['menu://action']?.({ payload: { id: 'project.new' } }));
    expect($('home-create-dialog')).not.toBeNull();
    const input = $('home-create-name') as HTMLInputElement;
    const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps')) as string;
    const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[
      propsKey
    ];
    act(() => props?.onChange({ target: { value: '  Plakaty ' } }));
    act(() => $('home-create-submit')?.click());
    await flush();
    const create = calls.find((c) => c.url === '/_home/projects/create-local');
    expect(create?.method).toBe('POST');
    expect(create?.headers['x-maude-home']).toBe(SECRET);
    expect(create?.body).toEqual({ name: 'Plakaty' });
    expect(invokes.find((i) => i.cmd === 'open_project')?.args).toEqual({
      root: '/Users/x/Maude/Plakaty',
    });
    expect($('home-create-dialog')).toBeNull();
    // R2-P2 (F11, overrides the 11 pn-home foot): the Projects foot carries a visible New project next to
    // Open project…, and it opens the same sheet as the menu row
    expect($('home-open-folder')).not.toBeNull();
    expect($('home-new-project')).not.toBeNull();
    expect($('home-new-project')?.parentElement).toBe($('home-open-folder')?.parentElement);
    act(() => $('home-new-project')?.click());
    expect($('home-create-dialog')).not.toBeNull();
    expect(($('home-create-name') as HTMLInputElement).value).toBe('Untitled project');
  });

  test('a long Projects list shows its first rows and "N more"; the foot opens the rest', async () => {
    // 2.1.2 (artboard 15): slim rows — the list shows ten before "N more"
    const many = Array.from({ length: 13 }, (_, i) => ({
      pid: `l0000000000000${String(i).padStart(4, '0')}`,
      root: `/x/m${i}`,
      name: `Many ${i}`,
      profile: 'default',
      place: 'closed',
      focused: false,
    }));
    shellOverride = { ...SHELL, projects: many, recent: many.map((m) => m.pid) };
    mount();
    await flush();
    const rows = () => host.querySelectorAll('[data-testid^="home-project-row-"]').length;
    const before = rows();
    expect(before).toBe(10);
    expect($('home-projects-more')?.textContent).toBe('3 more');
    act(() => $('home-projects-more')?.click());
    await flush();
    expect(rows()).toBe(13);
    expect($('home-projects-more')).toBeNull();
  });

  test('the slim ask bar takes over once the question has scrolled under the sticky header', async () => {
    // The question sits under the (transparent) sticky header long before it leaves the viewport, so the
    // observer's root must stop at the header's lower edge — otherwise the bar never docks (11 pn-home).
    const seen: Array<{ rootMargin?: string }> = [];
    const watched: string[] = [];
    const G = globalThis as unknown as { IntersectionObserver?: unknown };
    const real = G.IntersectionObserver;
    G.IntersectionObserver = class {
      constructor(_cb: unknown, opts: { rootMargin?: string } = {}) {
        seen.push(opts);
      }
      observe(el: Element) {
        watched.push(el.className);
      }
      disconnect() {}
    };
    try {
      mount();
      await flush();
    } finally {
      G.IntersectionObserver = real;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].rootMargin).toMatch(/^-\d+px 0px 0px 0px$/);
    // it watches the composer card itself (the bar docks when the card is under the header), not the whole block
    expect(watched.some((c) => /home-ask-card/.test(c))).toBe(true);
    expect(watched.some((c) => /home-question/.test(c))).toBe(false);
  });

  // #206 T6.3g (contract 206 §5) — a worktree tab is never a project row: Home lists the worktree
  // folders this Mac opened as one Worktrees row under the main project, and a chip opens its tab
  // by pid only (`open_worktree({pid})`, never a path, never `open_project`).
  test('a Worktrees row under the main project opens a worktree by pid', async () => {
    const WT = 'l00000000000000c3';
    shellOverride = {
      ...SHELL,
      worktrees: [
        {
          pid: WT,
          root: '/x/a-wt',
          mainPid: P1,
          branch: 'feat-x',
          place: 'closed',
        },
        // a planted row for a project Home does not list: nowhere to show it
        { pid: 'l00000000000000d4', root: '/x/z', mainPid: 'nope', branch: 'z', place: 'closed' },
        { pid: 42, mainPid: P1, branch: 'bad' },
      ],
    } as unknown as typeof SHELL;
    mount();
    await flush();
    // 2.1.2 (artboard 19): worktrees moved off the row into its "…" menu
    expect($(`home-worktree-${WT}`)).toBeNull();
    act(() => $(`home-project-more-${P2}`)?.click());
    await flush();
    expect(host.querySelectorAll('[data-testid^="home-worktree-"]').length).toBe(0);
    act(() => $(`home-project-more-${P1}`)?.click());
    await flush();
    const chips = host.querySelectorAll('[data-testid^="home-worktree-"]');
    expect(chips.length).toBe(1);
    const chip = $(`home-worktree-${WT}`);
    expect(chip?.textContent).toContain('feat-x');
    expect(chip?.getAttribute('aria-label')).toBe('Open the feat-x worktree of Alligators brand');
    expect(host.querySelectorAll('[data-testid^="home-project-row-"]').length).toBe(2);
    act(() => chip?.click());
    await flush();
    expect(invokes.filter((i) => i.cmd === 'open_worktree').map((i) => i.args)).toEqual([
      { pid: WT },
    ]);
    expect(invokes.some((i) => i.cmd === 'open_project')).toBe(false);
  });

  // 2.1.2 (artboard 19): the row's "…" is a keyboard-reachable menu — Show in Finder by pid, and
  // Remove from list only after the person's yes; Cancel changes nothing.
  test('the row menu: ↓ opens it, Show in Finder reveals by pid, Remove from list asks first', async () => {
    mount();
    await flush();
    const more = $(`home-project-more-${P2}`) as HTMLButtonElement;
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    act(() => {
      more.focus();
      more.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await flush();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('home-project-menu-open');
    expect($('home-project-menu-reveal')?.textContent).toContain('/x/b');
    act(() => $('home-project-menu-reveal')?.click());
    await flush();
    expect(invokes.filter((i) => i.cmd === 'reveal_project_folder').map((i) => i.args)).toEqual([
      { pid: P2 },
    ]);
    expect($('home-project-menu')).toBeNull();

    act(() => $(`home-project-more-${P2}`)?.click());
    await flush();
    act(() => $('home-project-menu-forget')?.click());
    await flush();
    expect($('home-forget-dialog')?.textContent).toContain('Remove Studio site from this list?');
    expect($('home-forget-dialog')?.textContent).toContain(
      'The folder and its files stay where they are.'
    );
    act(() => $('home-forget-cancel')?.click());
    await flush();
    expect($('home-forget-dialog')).toBeNull();
    expect(invokes.some((i) => i.cmd === 'forget_project')).toBe(false);

    act(() => $(`home-project-more-${P2}`)?.click());
    await flush();
    act(() => $('home-project-menu-forget')?.click());
    await flush();
    act(() => $('home-forget-confirm')?.click());
    await flush();
    expect(invokes.filter((i) => i.cmd === 'forget_project').map((i) => i.args)).toEqual([
      { pid: P2 },
    ]);
    expect($('home-forget-dialog')).toBeNull();
  });

  // 2.1.2 (artboard 19, H1 #3): a folder that moved is one quiet row with its two ways out
  test('a lone orphan: one quiet row — Find the folder… or Remove from list (after a yes)', async () => {
    const P3 = 'l00000000000000c9';
    shellOverride = {
      ...SHELL,
      projects: [
        ...SHELL.projects,
        { ...SHELL.projects[1], pid: P3, root: '/x/old', name: 'Landing 2025' },
      ],
      recent: [P1, P2, P3],
    };
    const real = INDEX.projects;
    INDEX.projects = [...real, { pid: P3, state: 'gone', stale: false } as (typeof real)[number]];
    try {
      mount();
      await flush();
    } finally {
      INDEX.projects = real;
    }
    const row = $(`home-project-row-${P3}`);
    expect(row?.textContent).toContain('Landing 2025');
    expect(row?.textContent).toContain('The folder isn’t where it was.');
    expect(host.querySelectorAll(`[data-testid="home-project-row-${P3}"]`)).toHaveLength(1);
    const rows = Array.from(host.querySelectorAll('[data-testid^="home-project-row-"]'));
    expect(rows.at(-1)).toBe(row);
    act(() => $(`home-relink-${P3}`)?.click());
    await flush();
    expect(invokes.filter((i) => i.cmd === 'relink_project').map((i) => i.args)).toEqual([
      { pid: P3 },
    ]);
    act(() => $(`home-project-forget-${P3}`)?.click());
    await flush();
    expect($('home-forget-dialog')?.textContent).toContain('Remove Landing 2025 from this list?');
    act(() => $('home-forget-confirm')?.click());
    await flush();
    expect(invokes.filter((i) => i.cmd === 'forget_project').map((i) => i.args)).toEqual([
      { pid: P3 },
    ]);
  });

  // 2.1.2 HB1 (canvas 17, artboard 16): accounts are a chip, not a row; a Maude Cloud sign-in that
  // stopped working raises the one banner and shows on the project rows that use it, and the banner's
  // Sign in again asks for THAT profile (the dead credential goes first so it can be signed in again).
  test('a Maude Cloud sign-in that stopped working: the banner, the chip and the rows say so, and its button re-signs THAT profile', async () => {
    shellOverride = {
      ...SHELL,
      projects: [
        { ...SHELL.projects[0], hub: 'https://a.cloud.maude.sh/', place: 'closed' },
        SHELL.projects[1],
      ],
      profiles: [{ id: 'default', label: 'Personal', email: 'alice@example.com' }],
    } as unknown as typeof SHELL;
    fetchAnswers['/_config'] = [
      200,
      { mode: 'home', shell: 'home', version: 'x', cloudOrigin: 'https://cloud.maude.sh' },
    ];
    fetchAnswers['/_home/cloud'] = [
      200,
      { ok: false, profile: 'default', signedIn: false, rejected: true, projects: [], shared: [] },
    ];
    shellAnswers.home_cloud_sign_in_prepare = 'default';
    mount();
    await flush(10);
    expect($('home-accounts-row')).toBeNull();
    expect($('home-accounts-chip-needs')?.textContent).toBe('1 needs sign-in');
    expect($('home-account-banner')?.textContent).toContain(
      'Your sign-in to Maude Cloud stopped working.'
    );
    expect($(`home-project-state-${P1}`)?.textContent).toBe('Sign-in stopped working');
    // 2.1.2 HB2: the place is the name, "Maude Cloud" (the address shows only on account rows); a
    // row that is fine says nothing
    expect($(`home-project-where-${P1}`)?.textContent).toBe('Maude Cloud');
    expect($(`home-project-state-${P2}`)).toBeNull();
    act(() => $('home-accounts-chip')?.click());
    expect($('home-account-state-default-cloud')?.textContent).toBe('Sign-in stopped working');
    act(() => $('home-account-banner-fix')?.click());
    await flush(10);
    expect(
      calls.filter((c) => c.url.startsWith('/_home/cloud/signout')).map((c) => c.body)
    ).toEqual([{ profile: 'default' }]);
    expect(
      invokes.filter((i) => i.cmd === 'home_cloud_sign_in_prepare').map((i) => i.args)
    ).toEqual([{ profile: 'default' }]);
  });

  // 2.1.2 (artboard 15): no account headers — one list across accounts, last used first
  test('one Projects list across accounts, the project used last first', async () => {
    shellOverride = {
      ...SHELL,
      projects: [
        { ...SHELL.projects[0], profile: 'default', place: 'closed' },
        { ...SHELL.projects[1], profile: 'work', place: 'tab' },
      ],
      profiles: [
        { id: 'default', label: 'Personal' },
        { id: 'work', label: 'Work' },
      ],
      recent: [P2, P1],
    };
    mount();
    await flush();
    expect(host.querySelectorAll('[data-testid^="home-profile-"]').length).toBe(0);
    const rows = Array.from(host.querySelectorAll('[data-testid^="home-project-row-"]')).map((e) =>
      e.getAttribute('data-testid')
    );
    expect(rows).toEqual([`home-project-row-${P2}`, `home-project-row-${P1}`]);
  });

  test('pin toggles POST /_home/pins {pid, canvas, pinned}', async () => {
    mount();
    await flush();
    act(() => $(`home-pin-${P1}-ui-plakat`)?.click());
    await flush();
    const pin = calls.find((c) => c.url === '/_home/pins');
    expect(pin?.method).toBe('POST');
    expect(pin?.body).toEqual({ pid: P1, canvas: 'ui/Plakat.tsx', pinned: true });
    expect($(`home-pin-${P1}-ui-plakat`)?.getAttribute('aria-pressed')).toBe('true');
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

  // 2.0.5 packaged-app finding: right after a sign-in or sign-out the rows read "Team server · host"
  // and only a reload added "· account" — the accounts were fetched only when the profile ids changed.
  test('/_home/accounts is read again on index://changed and after a Home sign-out', async () => {
    shellOverride = {
      ...SHELL,
      profiles: [{ id: 'work', label: 'StudyFi' }],
    };
    fetchAnswers['/_home/accounts'] = [
      200,
      { ok: true, profiles: [{ id: 'work', hubs: [{ url: 'https://design.studyfi.com' }] }] },
    ];
    fetchAnswers['/_home/hub/signout'] = [200, { ok: true }];
    fetchAnswers['/_config'] = [
      200,
      { mode: 'home', shell: 'home', version: 'x', cloudOrigin: 'https://cloud.maude.sh' },
    ];
    mount();
    await flush();
    const accountReads = () => calls.filter((c) => c.url.startsWith('/_home/accounts')).length;
    const first = accountReads();
    expect(first).toBeGreaterThan(0);
    await act(async () => listeners['index://changed']?.({ payload: { pids: [P2] } }));
    await flush();
    expect(accountReads()).toBeGreaterThan(first);
    const second = accountReads();
    // the accounts list's own sign-out reloads Home, and the rows' accounts with it
    act(() => $('home-accounts-chip')?.click());
    await flush();
    act(() => $('home-account-more-work-design-studyfi-com')?.click());
    act(() => $('home-account-signout-work-design-studyfi-com')?.click());
    await flush(2);
    act(() => $('home-accounts-signout-confirm')?.click());
    await flush(4);
    expect(accountReads()).toBeGreaterThan(second);
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
    expect($(`home-project-row-${P2}`)?.getAttribute('data-place')).toBe('tab');
  });

  // 2.1.2 HB1 (artboard 17; 2.0.5 W4b's sign-outs) — the chip lists every account on this Mac; Sign out
  // in a line's "…" asks, then signs ONE profile out of ONE account; GitHub sits in the profile's first
  // line; add / switch at the foot. Stubbed shell + routes only.
  test('the chip opens every account on this Mac; Sign out asks, then calls that account’s route', async () => {
    shellOverride = {
      ...SHELL,
      profiles: [
        { id: 'default', label: 'Personal', email: 'me@gmail.com', github: 'iagh' },
        { id: 'work', label: 'StudyFi' },
      ],
    };
    fetchAnswers['/_home/cloud'] = [
      200,
      {
        ok: true,
        profile: 'default',
        signedIn: true,
        account: { email: 'me@gmail.com' },
        projects: [],
        shared: [],
      },
    ];
    fetchAnswers['/_home/accounts'] = [
      200,
      {
        ok: true,
        profiles: [
          {
            id: 'work',
            hubs: [{ url: 'https://design.studyfi.com', account: 'michal@studyfi.com' }],
          },
        ],
      },
    ];
    fetchAnswers['/_home/hub/signout'] = [200, { ok: true }];
    fetchAnswers['/_config'] = [
      200,
      { mode: 'home', shell: 'home', version: 'x', cloudOrigin: 'https://cloud.maude.sh' },
    ];
    mount();
    await flush();
    expect($('home-top-face')).toBeNull();
    const chip = $('home-accounts-chip');
    expect(chip?.tagName).toBe('BUTTON');
    expect(chip?.textContent).toBe('2 accounts');
    act(() => chip?.click());
    await flush();
    expect($('home-accounts')).not.toBeNull();
    expect($('home-account-card-default-cloud')?.textContent).toContain('me@gmail.com');
    act(() => $('home-account-more-default-cloud')?.click());
    expect($('home-account-github-default')?.textContent).toContain('@iagh');
    expect($('home-account-card-work-design-studyfi-com')?.textContent).toContain(
      'design.studyfi.com'
    );
    act(() => $('home-account-more-work-design-studyfi-com')?.click());
    expect($('home-account-github-signin-work')).not.toBeNull();
    act(() => $('home-accounts-add')?.click());
    expect($('home-accounts-add-cloud')).not.toBeNull();
    act(() => $('home-account-more-work-design-studyfi-com')?.click());
    act(() => $('home-account-signout-work-design-studyfi-com')?.click());
    await flush(2);
    expect(calls.some((c) => c.url.includes('/_home/hub/signout'))).toBe(false);
    act(() => $('home-accounts-signout-confirm')?.click());
    await flush();
    const out = calls.filter((c) => c.url.includes('/_home/hub/signout'));
    expect(out.map((c) => c.body)).toEqual([
      { profile: 'work', url: 'https://design.studyfi.com' },
    ]);
    expect(out[0]?.headers['x-maude-home']).toBeDefined();
    await flush(10);
  });

  // 2.1.2 HB1 — the keeper's Home (H1 audit, fixtures only): a Maude Cloud cell with a stale saved
  // sign-in, and six old dev servers that do not answer. The cell is the Maude Cloud account's, the
  // old servers fold, and nothing raises the banner.
  test('a Maude Cloud cell is not a server, old servers fold, and nothing raises the banner', async () => {
    shellOverride = {
      ...SHELL,
      projects: [
        { ...SHELL.projects[0], hub: 'https://alligators.cloud.maude.sh/', place: 'closed' },
        SHELL.projects[1],
      ],
      profiles: [{ id: 'default', label: 'Personal', email: 'alice@example.com' }],
    } as unknown as typeof SHELL;
    fetchAnswers['/_config'] = [
      200,
      { mode: 'home', shell: 'home', version: 'x', cloudOrigin: 'https://cloud.maude.sh' },
    ];
    fetchAnswers['/_home/cloud'] = [
      200,
      {
        ok: true,
        profile: 'default',
        signedIn: true,
        account: { email: 'alice@example.com' },
        projects: [],
        shared: [],
      },
    ];
    const old = ['http://127.0.0.1:1234', 'http://localhost:8420', 'http://localhost:18500'];
    fetchAnswers['/_home/accounts'] = [
      200,
      {
        ok: true,
        profiles: [
          {
            id: 'default',
            hubs: [
              { url: 'https://alligators.cloud.maude.sh', state: 'rejected' },
              ...old.map((url) => ({ url, state: 'unreachable' })),
            ],
          },
        ],
      },
    ];
    mount();
    await flush(10);
    expect($('home-account-banner')).toBeNull();
    expect($('home-accounts-chip')?.textContent).toBe('1 account');
    act(() => $('home-accounts-chip')?.click());
    expect(host.querySelectorAll('[data-testid^="home-account-card-"]').length).toBe(1);
    expect($('home-account-card-default-cloud')?.textContent).toContain('1 project');
    expect($('home-account-card-default-alligators-cloud-maude-sh')).toBeNull();
    expect($('home-accounts-old')?.textContent).toContain('3 old servers');
  });
});

// V2-3.5 — Rust routes a maude:// link Home's way when no project tab can take it (deep_link.rs).
const CODE = `mhc_${'ab12'.repeat(8)}`;
const CONNECT = `maude://open/alligators?code=${CODE}`;
const FILE_UNKNOWN = 'maude://open/brno-open?open=ui/Pozvanka.tsx';

describe('Home reads maude:// links', () => {
  beforeEach(() => installTauri('home'));

  test('the link parked at launch is taken on boot (connect → the open-its-own-copy decision)', async () => {
    shellAnswers.take_pending_deep_link = CONNECT;
    mount();
    await flush();
    expect(invokes.some((i) => i.cmd === 'take_pending_deep_link')).toBe(true);
    expect($('home-link-dialog')?.textContent).toContain('Open alligators?');
    expect($('home-link-open')?.textContent).toBe('Open alligators');
  });

  test('a link while running arrives as the event; a second never replaces the one shown', async () => {
    mount();
    await flush();
    expect($('home-link-dialog')).toBeNull();
    await act(async () => listeners['maude://deep-link']?.({ payload: CONNECT }));
    await flush();
    expect($('home-link-dialog')).not.toBeNull();
    await act(async () =>
      listeners['maude://deep-link']?.({
        payload: `maude://open/someone-else?code=${CODE}`,
      })
    );
    await flush();
    expect($('home-link-dialog')?.textContent).toContain('alligators');
    expect($('home-link-dialog')?.textContent).not.toContain('someone-else');
    act(() => $('home-link-dismiss')?.click());
    await flush();
    expect($('home-link-dialog')).toBeNull();
  });

  test('a file link for a project not on this Mac shows the calm note — nothing opens', async () => {
    shellAnswers.take_pending_deep_link = FILE_UNKNOWN;
    mount();
    await flush();
    expect($('home-link-note')?.textContent).toContain(
      "That link is for a project that isn't on this Mac."
    );
    expect($('home-link-note')?.getAttribute('role')).toBe('status');
    expect(invokes.some((i) => i.cmd === 'open_project')).toBe(false);
    // junk is not a link: nothing shown
    await act(async () =>
      listeners['maude://deep-link']?.({ payload: 'maude://open/../x?open=a' })
    );
    await flush();
    expect($('home-link-dialog')).toBeNull();
  });

  test('a file link for a project that IS here opens it at the canvas', async () => {
    shellAnswers.take_pending_deep_link = 'maude://open/alligators-brand?open=ui/Plakat.tsx';
    mount();
    await flush();
    const op = invokes.find((i) => i.cmd === 'open_project');
    expect(op?.args).toEqual({ pid: P1, target: { canvas: 'ui/Plakat.tsx' } });
    expect($('home-link-note')).toBeNull();
  });

  test('connect link end to end: /_home/cloud/prepare → managed_project_open → open_project({root})', async () => {
    shellAnswers.take_pending_deep_link = CONNECT;
    shellAnswers.managed_project_open = '/Users/me/Maude/alligators';
    mount();
    await flush();
    act(() => $('home-link-open')?.click());
    await flush();
    const prep = calls.find((c) => c.url === '/_home/cloud/prepare');
    expect(prep?.method).toBe('POST');
    expect(prep?.headers['x-maude-home']).toBe(SECRET);
    expect(prep?.body).toEqual({ profile: 'default', projectId: 'alligators', code: CODE });
    const chain = invokes
      .map((i) => i.cmd)
      .filter((c) => c === 'managed_project_open' || c === 'open_project');
    expect(chain).toEqual(['managed_project_open', 'open_project']);
    expect(invokes.find((i) => i.cmd === 'managed_project_open')?.args).toEqual({
      serverUrl: 'https://alligators.cloud.maude.sh',
      projectId: 'alligators',
      name: 'alligators',
      canvasGroups: [],
      profile: 'default',
    });
    expect(invokes.find((i) => i.cmd === 'open_project')?.args).toEqual({
      root: '/Users/me/Maude/alligators',
    });
    expect($('home-link-dialog')).toBeNull();
  });

  // S9.17b — a Can view project's `409 browser-door`: Home relays the validated door to
  // `open_cell_tab` with the profile it prepared for; no managed copy, no project tab.
  const DOOR = 'https://alligators.cloud.maude.sh/c/ui/Poster.tsx';
  const browserDoor = (url: string): [number, unknown] => [
    409,
    { ok: false, status: 409, reason: 'browser-door', url, error: 'x' },
  ];
  const signedInCloud = (role: string) => {
    fetchAnswers['/_home/cloud'] = [
      200,
      {
        ok: true,
        profile: 'default',
        signedIn: true,
        projects: [
          { id: 'alligators', name: 'Alligators', role, url: 'https://alligators.cloud.maude.sh' },
        ],
        shared: [],
      },
    ];
  };

  test('connect link answered with a browser door → open_cell_tab({url, profile})', async () => {
    shellAnswers.take_pending_deep_link = CONNECT;
    fetchAnswers['/_home/cloud/prepare'] = browserDoor(DOOR);
    mount();
    await flush();
    act(() => $('home-link-open')?.click());
    await flush();
    const cmds = invokes.map((i) => i.cmd);
    expect(cmds).not.toContain('managed_project_open');
    expect(cmds).not.toContain('open_project');
    expect(invokes.filter((i) => i.cmd === 'open_cell_tab').map((i) => i.args)).toEqual([
      { url: DOOR, profile: 'default' },
    ]);
  });

  test('a Can view cloud row prepares, and its browser door opens a cell tab for its profile', async () => {
    signedInCloud('observer');
    fetchAnswers['/_home/cloud/prepare'] = browserDoor(DOOR);
    mount();
    await flush();
    act(() => $('home-cloud-open-alligators')?.click());
    await flush();
    expect(calls.find((c) => c.url === '/_home/cloud/prepare')?.body).toMatchObject({
      profile: 'default',
      projectId: 'alligators',
    });
    expect(invokes.filter((i) => i.cmd === 'open_cell_tab').map((i) => i.args)).toEqual([
      { url: DOOR, profile: 'default' },
    ]);
    expect(invokes.map((i) => i.cmd)).not.toContain('open_cloud_url');
  });

  test('a hostile browser door never reaches invoke', async () => {
    signedInCloud('observer');
    for (const bad of [
      'https://evil.example/',
      'https://canvas-x.cloud.maude.sh/',
      'https://alligators.cloud.maude.sh/?next=https://evil.example',
      'https://u@alligators.cloud.maude.sh/',
      'javascript:alert(1)',
    ]) {
      fetchAnswers['/_home/cloud/prepare'] = browserDoor(bad);
      invokes = [];
      mount();
      await flush();
      act(() => $('home-cloud-open-alligators')?.click());
      await flush();
      const cmds = invokes.map((i) => i.cmd);
      expect({
        bad,
        cell: cmds.includes('open_cell_tab'),
        web: cmds.includes('open_cloud_url'),
      }).toEqual({
        bad,
        cell: false,
        web: false,
      });
      act(() => root.unmount());
      host.remove();
    }
  });

  test('a Can view row on a cloud with no browser door still opens in the browser', async () => {
    signedInCloud('observer');
    fetchAnswers['/_home/cloud/prepare'] = [502, { ok: false, status: 502, error: 'x' }];
    mount();
    await flush();
    act(() => $('home-cloud-open-alligators')?.click());
    await flush();
    expect(invokes.filter((i) => i.cmd === 'open_cloud_url').map((i) => i.args)).toEqual([
      { url: 'https://alligators.cloud.maude.sh' },
    ]);
    expect(invokes.map((i) => i.cmd)).not.toContain('open_cell_tab');
  });

  test('no cell tabs on this Mac → open_cloud_url with the origin only', async () => {
    signedInCloud('observer');
    fetchAnswers['/_home/cloud/prepare'] = browserDoor(DOOR);
    shellAnswers.open_cell_tab = () => {
      throw 'Open this project in your browser.';
    };
    mount();
    await flush();
    act(() => $('home-cloud-open-alligators')?.click());
    await flush();
    expect(invokes.filter((i) => i.cmd === 'open_cloud_url').map((i) => i.args)).toEqual([
      { url: 'https://alligators.cloud.maude.sh' },
    ]);
  });

  test('Home hears the shell only on its own shell_subscribe channel, never a Tauri event', async () => {
    const w = window as unknown as { __TAURI__: Record<string, unknown> };
    w.__TAURI__.webviewWindow = {
      getCurrentWebviewWindow: () => ({
        listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
          windowListeners[name] = cb;
          return () => {
            delete windowListeners[name];
          };
        },
      }),
    };
    mount();
    await flush();
    // One channel for the whole page; no event listener of either kind (finding 1d: an
    // `emit_to('home')` reached every `Any`-target listener in every project page).
    expect(subscribes).toBe(1);
    expect(eventListens).toEqual([]);
    expect(Object.keys(windowListeners)).toEqual([]);
  });
});

describe('Home shows each tab’s live state', () => {
  beforeEach(() => installTauri('home'));

  // 2.1.2 (artboard 19): live work is a row's state; Resting no longer is (the strip shows it)
  test('AI working · Needs you chips on project rows; Resting says nothing', async () => {
    shellOverride = {
      ...SHELL,
      projects: [
        { ...SHELL.projects[0], ai: { running: 1, awaiting: 0 } },
        { ...SHELL.projects[1], place: 'resting' },
      ],
    };
    mount();
    await flush();
    expect($(`home-project-ai-${P1}`)?.textContent).toBe('AI working');
    expect($(`home-project-ai-${P1}`)?.getAttribute('data-ai')).toBe('running');
    expect($(`home-project-resting-${P2}`)).toBeNull();
    expect($(`home-project-conn-${P2}`)?.textContent).toBe('');
    expect($(`home-project-ai-${P2}`)).toBeNull();
    // the one that asks for you wins
    await act(async () =>
      listeners['shell://state']?.({
        payload: {
          ...SHELL,
          projects: [
            { ...SHELL.projects[0], ai: { running: 1, awaiting: 1 } },
            { ...SHELL.projects[1], place: 'tab' },
          ],
        },
      })
    );
    await flush();
    expect($(`home-project-ai-${P1}`)?.textContent).toBe('Needs you');
    expect($(`home-project-resting-${P2}`)).toBeNull();
  });
});

describe('Home page in a browser (no shell)', () => {
  test('renders the index read-only from ?pids= (with the hand-set dev secret) and never throws', async () => {
    sessionStorage.setItem(api.DEV_SECRET_KEY, SECRET);
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

  test('loopback browser asks /_config WITH the hand-set dev secret and renders Home on mode:home', async () => {
    sessionStorage.setItem(api.DEV_SECRET_KEY, SECRET);
    let got: string | null = null;
    bootShellMode((m: string) => {
      got = m;
    });
    await flush();
    expect(got).toBe('home');
    expect(calls[0]?.url).toBe('/_config');
    expect(calls[0]?.headers['x-maude-home']).toBe(SECRET);
  });

  test('loopback browser without a dev secret sends nothing and renders the project shell', async () => {
    let got: string | null = null;
    bootShellMode((m: string) => {
      got = m;
    });
    await flush();
    expect(got).toBe('project');
    expect(calls.length).toBe(0);
  });

  test('a non-loopback host (a cloud cell) is a project with no request', () => {
    const fake = { location: { hostname: 'alligators.cloud.maude.sh' } };
    expect(shellModeHint(fake)).toBe('project');
  });
});

describe('home-api', () => {
  test('every HTTP helper sends x-maude-home: <secret> (none can be added without it)', async () => {
    sessionStorage.setItem(api.DEV_SECRET_KEY, SECRET);
    const http = Object.entries(api).filter(
      ([name, fn]) =>
        typeof fn === 'function' &&
        ![
          'homeFetch',
          'homeSecret',
          'resetHomeSecret',
          'inShell',
          'shellInvoke',
          'shellListen',
        ].includes(name) &&
        !/^(shellState|openProject|openProjectFolder|openWorktree|relinkProject|forgetProject|revealProjectFolder|managedProjectOpen|openCloudUrl|openCellDoor|takePendingDeepLink|takePendingInvite|openTeamServerSignIn|pickProjectLocation|signInPrepare|signInOpenBrowser|signInDone)$/.test(
          name
        )
    );
    expect(http.map(([n]) => n).sort()).toEqual(
      [
        'aiConnect',
        'aiStatus',
        'cliInstall',
        'cliStatus',
        'cloudSignInCancel',
        'cloudSignInPoll',
        'cloudSignInStart',
        'cloudSignOut',
        'createLocal',
        'createLocalFromPrompt',
        'getAccounts',
        'getCloud',
        'getConfig',
        'getFirstRunSeen',
        'getIndex',
        'getRecentSearches',
        'getWhatsNew',
        'hubPrepare',
        'hubSignInCancel',
        'hubSignInPoll',
        'hubSignInStart',
        'hubSignOut',
        'hubTest',
        'inviteAccept',
        'invitePeek',
        'markFirstRunSeen',
        'markWhatsNewSeen',
        'pendingInviteAccept',
        'pendingInviteLeave',
        'prepareCloud',
        'prepareCloudLink',
        'saveRecentSearch',
        'search',
        'setPin',
        'thumbObjectUrl',
      ].sort()
    );
    for (const [, fn] of http) await (fn as (...a: unknown[]) => Promise<unknown>)('a', 'b', 'c');
    expect(calls.length).toBe(http.length);
    for (const c of calls) expect(c.headers['x-maude-home']).toBe(SECRET);
  });

  test('outside the app the shell bridge resolves null and never throws', async () => {
    expect(api.inShell()).toBe(false);
    expect(await api.shellState()).toBeNull();
    expect(await api.openProject({ pid: P1 }, { canvas: 'ui/x.tsx' })).toBeNull();
    const off = await api.shellListen('shell://state', () => {});
    expect(typeof off).toBe('function');
  });
});
