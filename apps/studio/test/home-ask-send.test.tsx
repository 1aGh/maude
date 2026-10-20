// home-ask-send — S6.4: Home's question ("What shall we make?"). ↵ sends the sentence to the target
// project as a parked INTENT (open_project's `intent` argument, Rust parks it per window) — the sentence
// is never in a URL (V2-1.1 §5.8.8). Starters fill the prompt and do not send. ⌘N on Home is the
// `create-empty` intent. Offline the AI is not on offer. Tauri stubbed as in home-page.test.tsx.

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
const P2 = 'l00000000000000b2';
const SENTENCE = 'A poster for my open studio on Thursday, in warm colours';

const INDEX = {
  v: 1,
  projects: [
    {
      pid: P1,
      state: 'ok',
      stale: false,
      project: { root: '/x/a', name: 'Alligators brand', label: null, linkedHub: null },
      counts: { canvases: 2, artboards: 2, byKind: { print: 2 } },
      canvases: [{ rel: 'ui/Plakat.tsx', name: 'Plakat', folder: 'ui', cover: null, openedAt: 5 }],
    },
    {
      pid: P2,
      state: 'ok',
      stale: false,
      project: { root: '/x/b', name: 'Studio site', label: null, linkedHub: null },
      counts: { canvases: 1, artboards: 1, byKind: { web: 1 } },
      canvases: [{ rel: 'ui/Homepage.tsx', name: 'Homepage', folder: 'ui', openedAt: 30 }],
    },
  ],
};
const SHELL = {
  projects: [
    { pid: P1, root: '/x/a', name: 'Alligators brand', profile: 'default', place: 'closed' },
    { pid: P2, root: '/x/b', name: 'Studio site', profile: 'default', place: 'closed' },
  ],
  profiles: [{ id: 'default', label: 'Personal' }],
  recent: [P2, P1],
};
const EMPTY_SHELL = { projects: [], profiles: [{ id: 'default', label: 'Personal' }], recent: [] };
const CLOUD_IN = {
  ok: true,
  profile: 'default',
  signedIn: true,
  account: { email: 'me@work.cz' },
  projects: [],
  shared: [],
};

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let invokes: Array<{ cmd: string; args: unknown }> = [];
let busChannel: { onmessage?: (m: unknown) => void } | null = null;
let shellOverride: unknown = null;
let fetchAnswers: Record<string, [number, unknown]> = {};
let originalFetch: typeof fetch;
const SECRET = 'ef'.repeat(32);

const deliver = (kind: string, payload: unknown) => busChannel?.onmessage?.({ kind, payload });

function answer(url: string): unknown {
  const u = new URL(url, 'http://localhost:4479');
  if (u.pathname === '/_home/index') {
    const pids = (u.searchParams.get('pids') || '').split(',');
    return { v: 1, projects: INDEX.projects.filter((p) => pids.includes(p.pid)) };
  }
  if (u.pathname === '/_home/cloud')
    return { ok: false, profile: 'default', signedIn: false, projects: [], shared: [] };
  if (u.pathname === '/_home/recent-searches') return { recentSearches: [] };
  if (u.pathname === '/_home/projects/create-local')
    return { ok: true, root: '/Users/x/Maude/Plakat', pid: 'lnew', name: 'Plakat' };
  return { error: 'nope' };
}

function installFetch() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method || 'GET',
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    const over = fetchAnswers[new URL(url, 'http://localhost:4479').pathname];
    return new Response(JSON.stringify(over ? over[1] : answer(url)), {
      status: over ? over[0] : 200,
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
      invoke: async (cmd: string, args: unknown) => {
        if (cmd === 'shell_subscribe') {
          busChannel = (args as { onMessage: { onmessage?: (m: unknown) => void } }).onMessage;
          return null;
        }
        if (cmd === 'home_session') return { secret: SECRET };
        invokes.push({ cmd, args });
        if (cmd === 'shell_state') return shellOverride ?? SHELL;
        if (cmd === 'open_project') return { label: 'p-x', opened: 'new' };
        if (cmd === 'managed_project_open') return '/Users/x/Maude/copy';
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
const propsOf = (el: Element) => {
  const k = Object.keys(el).find((x) => x.startsWith('__reactProps')) as string;
  return (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[k];
};
const type = (value: string) =>
  act(() => propsOf($('home-ask-input') as HTMLElement).onChange({ target: { value } }));
const press = (key: string, extra: Record<string, unknown> = {}) =>
  act(() =>
    propsOf($('home-ask-input') as HTMLElement).onKeyDown({
      key,
      shiftKey: false,
      metaKey: false,
      nativeEvent: { isComposing: false },
      preventDefault() {},
      ...extra,
    })
  );
const setOnline = (v: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(v ? 'online' : 'offline'));
  });
};
const opens = () => invokes.filter((i) => i.cmd === 'open_project');

beforeEach(() => {
  calls = [];
  invokes = [];
  busChannel = null;
  shellOverride = null;
  fetchAnswers = {};
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

describe('the question', () => {
  test('asks "What shall we make?" and says where the canvas lands', async () => {
    mount();
    await flush();
    expect(host.textContent).toContain('What shall we make?');
    expect($('home-ask-input')).not.toBeNull();
    // the most recently opened project is the default target
    expect($('home-target-chip')?.textContent).toContain('Starts a new canvas in');
    expect($('home-target-chip')?.textContent).toContain('Studio site');
  });

  test('↵ parks the sentence as an intent on the target; the URL never carries it', async () => {
    mount();
    await flush();
    type(SENTENCE);
    press('Enter');
    await flush();
    expect(opens()).toHaveLength(1);
    expect(opens()[0].args).toEqual({
      pid: P2,
      intent: { kind: 'create-canvas', prompt: SENTENCE },
    });
    // nothing the page asked for, and nowhere it is, names the sentence
    expect(calls.some((c) => c.url.includes(encodeURIComponent(SENTENCE)))).toBe(false);
    expect(window.location.href).not.toContain('poster');
    expect(JSON.stringify(opens()[0].args)).not.toContain('target');
  });

  test('an empty sentence, or Shift+↵, does not send', async () => {
    mount();
    await flush();
    press('Enter');
    type('   ');
    press('Enter');
    type(SENTENCE);
    press('Enter', { shiftKey: true });
    await flush();
    expect(opens()).toHaveLength(0);
  });

  test('the send button sends too, and is off while the field is empty', async () => {
    mount();
    await flush();
    expect(($('home-ask-send') as HTMLButtonElement).disabled).toBe(true);
    type(SENTENCE);
    expect(($('home-ask-send') as HTMLButtonElement).disabled).toBe(false);
    act(() => $('home-ask-send')?.click());
    await flush();
    expect(opens()).toHaveLength(1);
  });

  test('the chip picks another project', async () => {
    mount();
    await flush();
    act(() => $('home-target-chip')?.click());
    expect($('home-target-menu')).not.toBeNull();
    act(() => $(`home-target-item-local:${P1}`)?.click());
    expect($('home-target-menu')).toBeNull();
    expect($('home-target-chip')?.textContent).toContain('Alligators brand');
    type(SENTENCE);
    press('Enter');
    await flush();
    expect(opens()[0].args).toMatchObject({ pid: P1 });
  });

  test('the menu opens on the chosen project and Escape closes it, choosing nothing', async () => {
    mount();
    await flush();
    act(() => $('home-target-chip')?.click());
    await flush(2);
    expect(document.activeElement).toBe($(`home-target-item-local:${P2}`));
    expect($(`home-target-item-local:${P2}`)?.getAttribute('aria-checked')).toBe('true');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect($('home-target-menu')).toBeNull();
    expect($('home-target-chip')?.textContent).toContain('Studio site');
  });

  test('"a project on this Mac" makes a project named from the sentence, then opens it', async () => {
    shellOverride = EMPTY_SHELL;
    mount();
    await flush();
    expect($('home-target-chip')?.textContent).toContain('a project on this Mac');
    type(SENTENCE);
    press('Enter');
    await flush();
    const create = calls.find((c) => c.url === '/_home/projects/create-local');
    expect(create?.body).toEqual({ fromPrompt: SENTENCE });
    expect(opens()[0].args).toEqual({
      root: '/Users/x/Maude/Plakat',
      intent: { kind: 'create-canvas', prompt: SENTENCE, projectHint: 'Plakat' },
    });
  });

  test('signed in, "a new project" also asks the new tab to move to the cloud', async () => {
    shellOverride = EMPTY_SHELL;
    fetchAnswers['/_home/cloud'] = [200, CLOUD_IN];
    mount();
    await flush();
    expect($('home-target-chip')?.textContent).toContain('a new project');
    type(SENTENCE);
    press('Enter');
    await flush();
    expect(opens()[0].args).toMatchObject({
      root: '/Users/x/Maude/Plakat',
      intent: { kind: 'create-canvas', prompt: SENTENCE, moveToCloud: true },
    });
  });
});

describe('starters, ⌘N and the way in without AI', () => {
  test('a starter fills the prompt and does not send', async () => {
    mount();
    await flush();
    const starters = host.querySelectorAll('[data-testid^="home-starter-"]');
    expect(starters).toHaveLength(3);
    // the first is "A design system" (an action, S10.16c); the rest are sentences
    act(() => (starters[1] as HTMLElement).click());
    await flush();
    expect(opens()).toHaveLength(0);
    expect(($('home-ask-input') as HTMLTextAreaElement).value.length).toBeGreaterThan(8);
  });

  test('"Bring my existing brand" is an import-brand intent in the target', async () => {
    shellOverride = {
      ...SHELL,
      projects: SHELL.projects,
    };
    // a project with no canvases yet offers the brand starter
    const bare = {
      ...INDEX.projects[1],
      counts: { canvases: 0, artboards: 0, byKind: {} },
      canvases: [],
    };
    fetchAnswers['/_home/index'] = [200, { v: 1, projects: [bare, INDEX.projects[0]] }];
    mount();
    await flush();
    const brand = $('home-starter-brand');
    expect(brand?.textContent).toContain('Bring my existing brand');
    act(() => brand?.click());
    await flush();
    expect(opens()[0].args).toEqual({ pid: P2, intent: { kind: 'import-brand', prompt: '' } });
  });

  test('S10.16c: "A design system" is a make-ds intent in the target — the make sheet, not the prompt', async () => {
    mount();
    await flush();
    const ds = $('home-starter-ds');
    expect(ds?.textContent).toContain('A design system');
    act(() => ds?.click());
    await flush();
    expect(opens()[0].args).toEqual({ pid: P2, intent: { kind: 'make-ds', prompt: '' } });
    expect(($('home-ask-input') as HTMLTextAreaElement).value).toBe('');
  });

  test('⌘N on Home (menu://action canvas.new) is a create-empty intent in the target', async () => {
    mount();
    await flush();
    await act(async () => deliver('menu://action', { id: 'canvas.new' }));
    await flush();
    expect(opens()).toHaveLength(1);
    expect(opens()[0].args).toEqual({ pid: P2, intent: { kind: 'create-empty', prompt: '' } });
  });

  test('"Start with an empty canvas ⌘N" is the same, one click', async () => {
    mount();
    await flush();
    const b = $('home-empty-canvas');
    expect(b?.textContent).toContain('Start with an empty canvas');
    expect(b?.textContent).toContain('⌘N');
    act(() => b?.click());
    await flush();
    expect(opens()[0].args).toEqual({ pid: P2, intent: { kind: 'create-empty', prompt: '' } });
  });
});

describe('offline', () => {
  test('the AI is not on offer; the way in without it still is', async () => {
    mount();
    await flush();
    setOnline(false);
    await flush(2);
    expect($('home-ask-offline')?.textContent).toContain('AI is back when this Mac is online.');
    type(SENTENCE);
    expect(($('home-ask-send') as HTMLButtonElement).disabled).toBe(true);
    press('Enter');
    await flush();
    expect(opens()).toHaveLength(0);
    act(() => $('home-empty-canvas')?.click());
    await flush();
    expect(opens()).toHaveLength(1);
    setOnline(true);
    await flush(2);
    expect($('home-ask-offline')).toBeNull();
  });
});

describe('the shelves (05 es-home-*, 11 pn-home)', () => {
  const NOW = Date.now();
  const SHARED = [
    {
      projectId: 'nabor',
      projectName: 'Nábor 2027',
      ownerName: 'Tereza',
      canvas: { path: 'ui/web/Mapa.tsx', name: 'Mapa-areálu' },
      role: 'viewer',
      grantedAt: NOW - 3_600_000,
      grantedBy: 'Tereza',
    },
    {
      projectId: 'liga',
      projectName: 'Liga ČAAF',
      ownerName: 'Jonas',
      canvas: null,
      role: 'member',
      grantedAt: NOW - 30 * 24 * 3_600_000,
      grantedBy: 'Jonas',
    },
  ];

  test('signed in, nothing yet: ghost cards and the cloud words, no Shared shelf', async () => {
    shellOverride = EMPTY_SHELL;
    fetchAnswers['/_home/cloud'] = [200, CLOUD_IN];
    mount();
    await flush();
    const shelf = $('home-projects-empty');
    expect(shelf?.textContent).toContain('Your projects');
    expect(shelf?.textContent).toContain('No projects yet.');
    expect(shelf?.textContent).toContain('everyone you invite sees it here');
    expect(shelf?.querySelectorAll('.home-ghosts > i')).toHaveLength(3);
    expect($('home-shared')).toBeNull();
  });

  test('not signed in: this Mac, and the one next step is opening a folder you already have', async () => {
    shellOverride = EMPTY_SHELL;
    mount();
    await flush();
    const shelf = $('home-projects-empty');
    expect(shelf?.textContent).toContain('No projects on this Mac yet.');
    expect(shelf?.textContent).toContain('On this Mac');
    act(() => $('home-open-folder')?.click());
    await flush();
    expect(invokes.some((i) => i.cmd === 'open_project_folder')).toBe(true);
    // no Shared shelf and no cloud door for someone who has not signed in
    expect($('home-shared')).toBeNull();
  });

  test('Shared with you before anyone shares: ghost cards, its line, and no button at all', async () => {
    fetchAnswers['/_home/cloud'] = [200, CLOUD_IN];
    mount();
    await flush();
    const shelf = $('home-shared');
    expect(shelf?.textContent).toContain('Shared with you');
    expect(shelf?.textContent).toContain('Nothing shared with you yet.');
    expect(shelf?.querySelectorAll('.home-ghosts > i')).toHaveLength(3);
    expect(shelf?.querySelectorAll('button')).toHaveLength(0);
  });

  test('Shared with you lists the grants in people words, "1 new this week", and opens one', async () => {
    fetchAnswers['/_home/cloud'] = [200, { ...CLOUD_IN, shared: SHARED }];
    fetchAnswers['/_home/cloud/prepare'] = [
      200,
      {
        ok: true,
        serverUrl: 'https://nabor.cloud.maude.sh',
        projectId: 'nabor',
        name: 'nabor',
        canvasGroups: [],
        profile: 'default',
      },
    ];
    mount();
    await flush();
    const shelf = $('home-shared');
    expect(shelf?.textContent).toContain('Mapa-areálu');
    expect(shelf?.textContent).toContain('Can comment');
    expect(shelf?.textContent).toContain('Can edit');
    expect(shelf?.textContent).toContain("Tereza's");
    expect(shelf?.textContent).toContain('1 new this week');
    // a person is a circle; the project beside the title is a square
    expect(shelf?.querySelector('.home-face')).not.toBeNull();
    expect(shelf?.querySelector('.home-sq')).not.toBeNull();
    act(() => $('home-shared-row-nabor-ui-web-mapa')?.click());
    await flush();
    expect(opens()[0].args).toEqual({
      root: '/Users/x/Maude/copy',
      target: { canvas: 'ui/web/Mapa.tsx' },
    });
    // opened: no longer new
    expect($('home-shared')?.textContent).not.toContain('new this week');
  });

  test('Projects are grouped by account, each with the person’s face circle', async () => {
    shellOverride = {
      ...SHELL,
      profiles: [
        { id: 'default', label: 'Personal', email: 'me@gmail.com' },
        { id: 'work', label: 'Work', email: 'me@work-studio.cz' },
      ],
      projects: [SHELL.projects[0], { ...SHELL.projects[1], profile: 'work' }],
    };
    mount();
    await flush();
    const personal = $('home-profile-default');
    const work = $('home-profile-work');
    expect(personal?.textContent).toContain('Personal · me@gmail.com');
    expect(work?.textContent).toContain('Work · me@work-studio.cz');
    expect(work?.querySelector('.home-acctf')?.textContent).toBe('W');
    expect(personal?.querySelector('.home-acctf')?.textContent).toBe('P');
  });
});
