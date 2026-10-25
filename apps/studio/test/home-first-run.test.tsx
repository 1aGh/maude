// home-first-run — S6.8: Home's first run (02 Onboarding ob-first-launch … ob-edge-whats-new). The card shows
// only when there is no project and no account; "Sign in to cloud.maude.sh" runs the device flow through
// Rust (prepare → start → open) and polls; `maude://auth/{done,cancelled}` are nudges, never credentials;
// "Just a local project" is the Create a local project sheet; the What's New line shows once, never on a
// first run. Tauri is stubbed as in home-ask-send.test.tsx; no keychain, no real cloud.

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

describe('who sees the card', () => {
  test('a first run — no project, no account — shows the two doors and nothing else', async () => {
    mount();
    await flush();
    const card = $('signin-card');
    expect(card?.getAttribute('data-state')).toBe('idle');
    expect(card?.textContent).toContain('Keep your work on cloud.maude.sh');
    expect($('signin-cloud')?.textContent).toContain('Sign in to cloud.maude.sh');
    expect($('signin-local')?.textContent).toContain('Just a local project');
    expect(card?.textContent).toContain(
      'Opens your browser, then brings you back. 14 days free, no card.'
    );
    expect($('home-signin-quiet')).toBeNull();
  });

  test('with a project on this Mac the card is gone; a quiet "Sign in" sits in the top bar', async () => {
    shell = SHELL_ONE;
    mount();
    await flush();
    expect($('signin-card')).toBeNull();
    expect($('home-signin-quiet')?.textContent).toContain('Sign in to cloud.maude.sh');
  });

  test('the first launch writes the per-Mac flag once the card is up, and keeps the card for this visit', async () => {
    mount();
    await flush();
    expect($('signin-card')).not.toBeNull();
    expect(calls.filter((c) => c.url.includes('/_home/first-run') && c.method === 'POST')).toHaveLength(
      1
    );
  });

  test('a later launch (flag set), still no project and no account: board 05 shelf + the quiet pill, no card (05 es-home-local)', async () => {
    routes['/_home/first-run'] = () => [200, { seen: true }];
    mount();
    await flush();
    expect($('signin-card')).toBeNull();
    expect($('home-projects-empty')?.textContent).toContain('No projects on this Mac yet.');
    expect($('home-signin-quiet')?.textContent).toContain('Sign in to cloud.maude.sh');
    // nothing is written again
    expect(calls.filter((c) => c.url.includes('/_home/first-run') && c.method === 'POST')).toHaveLength(
      0
    );
  });

  test('the quiet pill still opens the sign-in card after the first launch', async () => {
    routes['/_home/first-run'] = () => [200, { seen: true }];
    mount();
    await flush();
    await click('home-signin-quiet');
    expect($('signin-card')).not.toBeNull();
  });

  test('signed in with nothing made: no card, no quiet link', async () => {
    cloud = IN(0);
    mount();
    await flush();
    expect($('signin-card')).toBeNull();
    expect($('home-signin-quiet')).toBeNull();
  });

  test('it waits for the cloud listing — a signed-in Mac never flashes the card', async () => {
    cloud = IN(2);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/_home/cloud?')) await gate;
      return real(input, init);
    }) as typeof fetch;
    mount();
    await flush();
    expect($('signin-card')).toBeNull();
    release();
    await flush();
    expect($('signin-card')).toBeNull();
    globalThis.fetch = real;
  });
});

describe('Sign in to cloud.maude.sh', () => {
  test('prepare → start → open; the page holds a state and a code to type, never a credential', async () => {
    fakeCloud();
    mount();
    await flush();
    await startSignIn();
    expect(cmds('home_cloud_sign_in_prepare')).toHaveLength(1);
    expect(hit('/_home/cloud/signin/start')).toHaveLength(1);
    expect(hit('/_home/cloud/signin/start')[0].body).toEqual({ profile: 'default' });
    expect(cmds('home_cloud_sign_in_open')[0].args).toEqual({ userCode: USER_CODE, state: STATE });
    expect($('signin-card')?.getAttribute('data-state')).toBe('waiting');
    expect($('signin-waiting')?.textContent).toContain('Waiting for your browser…');
    expect($('signin-cancel')).not.toBeNull();
    expect($('signin-reopen')?.textContent).toContain('Open the page again');
    expect($('signin-card')?.textContent).toContain('Signed in on another device?');
    // the code is not on the card until asked for; no URL, token or device code is anywhere
    expect($('signin-code')).toBeNull();
    expect(host.innerHTML).not.toContain('mpt_');
    expect(host.innerHTML).not.toContain('device_code');
  });

  test('"Use a code instead" shows the code to type on the activate page', async () => {
    fakeCloud();
    mount();
    await flush();
    await startSignIn();
    click('signin-use-code');
    expect($('signin-code')?.textContent).toBe(USER_CODE);
  });

  test('"Open the page again" opens the same attempt again', async () => {
    fakeCloud();
    mount();
    await flush();
    await startSignIn();
    click('signin-reopen');
    await flush();
    expect(cmds('home_cloud_sign_in_open')).toHaveLength(2);
    expect(cmds('home_cloud_sign_in_open')[1].args).toEqual({ userCode: USER_CODE, state: STATE });
  });

  test('Cancel in the app ends the attempt on the server and restores the card at once', async () => {
    fakeCloud();
    mount();
    await flush();
    await startSignIn();
    click('signin-cancel');
    await flush();
    expect(hit('/_home/cloud/signin/cancel')[0].body).toEqual({ state: STATE });
    expect($('signin-card')?.getAttribute('data-state')).toBe('idle');
    expect($('signin-cloud')).not.toBeNull();
  });

  test('Cancel on the web page (maude://auth/cancelled) restores the card; a wrong state does nothing', async () => {
    fakeCloud();
    mount();
    await flush();
    await startSignIn();
    act(() => deliver('auth://return', { kind: 'cancelled', state: OTHER }));
    await flush();
    expect($('signin-card')?.getAttribute('data-state')).toBe('waiting');
    expect(hit('/_home/cloud/signin/cancel')).toHaveLength(0);
    act(() => deliver('auth://return', { kind: 'cancelled', state: STATE }));
    await flush();
    expect($('signin-card')?.getAttribute('data-state')).toBe('idle');
    expect(hit('/_home/cloud/signin/cancel')[0].body).toEqual({ state: STATE });
  });

  test('a done nudge polls at once; done records the account, reloads and says what arrived', async () => {
    let n = 0;
    fakeCloud(() => {
      n += 1;
      return [200, { status: 'done', email: 'me@work.cz' }];
    });
    mount();
    await flush();
    await startSignIn();
    // the browser handed back: the cloud now knows the account
    cloud = IN(0);
    shell = SHELL_NONE;
    act(() => deliver('auth://return', { kind: 'done', state: STATE }));
    await flush(12);
    expect(n).toBe(1);
    expect(hit('/_home/cloud/signin/poll')[0].body).toEqual({ state: STATE });
    expect(cmds('home_cloud_signed_in')[0].args).toEqual({ profile: 'default' });
    expect($('home-signin-toast')?.textContent).toContain(
      'Signed in. What you make now lives on cloud.maude.sh.'
    );
    expect($('signin-card')).toBeNull();
  });

  test('on a second Mac the toast says how many cloud projects arrived', async () => {
    fakeCloud(() => [200, { status: 'done', email: 'me@work.cz' }]);
    mount();
    await flush();
    await startSignIn();
    cloud = IN(2);
    act(() => deliver('auth://return', { kind: 'done', state: STATE }));
    await flush(12);
    expect($('home-signin-toast')?.textContent).toContain(
      'Signed in — your 2 cloud projects are here.'
    );
  });

  test('ten minutes with no answer: "Sign-in didn\'t finish", nothing changed, buttons live', async () => {
    fakeCloud(() => [200, { status: 'expired' }]);
    mount();
    await flush();
    await startSignIn();
    act(() => deliver('auth://return', { kind: 'done', state: STATE }));
    await flush(10);
    const card = $('signin-card');
    expect(card?.getAttribute('data-state')).toBe('timeout');
    expect($('signin-timeout')?.textContent).toContain("Sign-in didn't finish");
    expect($('signin-timeout')?.textContent).toContain(
      'Nothing changed on this Mac. Try again whenever you like.'
    );
    expect(($('signin-cloud') as HTMLButtonElement).disabled).toBe(false);
    expect(($('signin-local') as HTMLButtonElement).disabled).toBe(false);
  });

  test('the cloud being unreachable is words, and the card is live again', async () => {
    routes['/_home/cloud/signin/start'] = () => [
      502,
      {
        ok: false,
        reason: 'unreachable',
        error: 'Maude Cloud could not be reached. Try again in a moment.',
      },
    ];
    mount();
    await flush();
    await startSignIn();
    expect($('signin-failed')?.textContent).toContain('Maude Cloud could not be reached.');
    expect(cmds('home_cloud_sign_in_open')).toHaveLength(0);
    expect(($('signin-cloud') as HTMLButtonElement).disabled).toBe(false);
  });

  test('a refusal from Rust (prepare) is shown in its own words', async () => {
    invokeAnswers.home_cloud_sign_in_prepare = () => {
      throw 'Too many sign-in attempts. Try again in a minute.';
    };
    mount();
    await flush();
    await startSignIn();
    expect($('signin-failed')?.textContent).toContain('Too many sign-in attempts.');
    expect(hit('/_home/cloud/signin/start')).toHaveLength(0);
  });

  test('the quiet link (a project, no account) starts the same flow and the card appears while it waits', async () => {
    shell = SHELL_ONE;
    fakeCloud();
    mount();
    await flush();
    expect($('signin-card')).toBeNull();
    click('home-signin-quiet');
    await flush();
    expect($('signin-card')?.getAttribute('data-state')).toBe('waiting');
    expect($('home-signin-quiet')).toBeNull();
    click('signin-cancel');
    await flush();
    expect($('signin-card')).toBeNull();
    expect($('home-signin-quiet')).not.toBeNull();
  });
});

describe('offline', () => {
  test('swaps the buttons, not the screen, and wakes by itself', async () => {
    mount();
    await flush();
    setOnline(false);
    expect($('signin-card')?.getAttribute('data-state')).toBe('offline');
    expect($('signin-offline')?.textContent).toContain('Sign-in waits until this Mac is online');
    expect(($('signin-cloud') as HTMLButtonElement).disabled).toBe(true);
    // the local door is the main button now, and first
    const buttons = [...host.querySelectorAll('.si-acts button')].map((b) =>
      b.getAttribute('data-testid')
    );
    expect(buttons).toEqual(['signin-local', 'signin-cloud']);
    setOnline(true);
    expect($('signin-card')?.getAttribute('data-state')).toBe('idle');
    expect(($('signin-cloud') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Just a local project', () => {
  test('opens "Create a local project": a name, the hint, Location under Advanced', async () => {
    mount();
    await flush();
    click('signin-local');
    expect($('home-create-dialog')?.textContent).toContain('Create a local project');
    expect($('home-create-dialog')?.textContent).toContain(
      'Kept on this Mac, in your Maude folder. Move it to the cloud any time.'
    );
    expect($('home-create-location')).toBeNull();
    click('home-create-advanced');
    expect($('home-create-location')?.textContent).toBe('~/Maude/Untitled project');
    // "Choose another folder…" needs the native picker; resting until it exists
    expect(($('home-create-choose-folder') as HTMLButtonElement).disabled).toBe(true);
  });

  test('a name → create-local → the project opens in its own tab', async () => {
    mount();
    await flush();
    click('signin-local');
    const input = $('home-create-name') as HTMLInputElement;
    const key = Object.keys(input).find((k) => k.startsWith('__reactProps')) as string;
    act(() =>
      (input as unknown as Record<string, any>)[key].onChange({
        target: { value: 'Portfolio 2026' },
      })
    );
    click('home-create-advanced');
    expect($('home-create-location')?.textContent).toBe('~/Maude/Portfolio 2026');
    click('home-create-submit');
    await flush();
    expect(hit('/_home/projects/create-local')[0].body).toEqual({ name: 'Portfolio 2026' });
    expect(cmds('open_project')[0].args).toEqual({ root: '/Users/x/Maude/Portfolio' });
    expect($('home-create-dialog')).toBeNull();
  });

  test('Cancel closes the sheet and creates nothing', async () => {
    mount();
    await flush();
    click('signin-local');
    click('home-create-cancel');
    expect($('home-create-dialog')).toBeNull();
    expect(hit('/_home/projects/create-local')).toHaveLength(0);
  });
});

describe('Advanced options', () => {
  test('five rows, each one sheet; closed again on the next launch', async () => {
    mount();
    await flush();
    expect($('signin-advanced-menu')).toBeNull();
    click('signin-advanced');
    const rows = [...host.querySelectorAll('[data-testid^="signin-adv-"]')].map((r) =>
      r.getAttribute('data-testid')
    );
    expect(rows).toEqual([
      'signin-adv-hub',
      'signin-adv-folder-github',
      'signin-adv-ai',
      'signin-adv-cli',
      'signin-adv-figma',
    ]);
    expect($('signin-advanced-menu')?.textContent).toContain('Use a self-hosted hub');
    expect($('signin-advanced-menu')?.textContent).toContain('Import from Figma');
    expect($('signin-advanced-menu')?.textContent).toContain('Settings › Connections');
    act(() => {
      root.unmount();
    });
    host.remove();
    mount();
    await flush();
    expect($('signin-advanced-menu')).toBeNull();
  });

  test('Escape closes the flyout', async () => {
    mount();
    await flush();
    click('signin-advanced');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect($('signin-advanced-menu')).toBeNull();
  });
});

describe("What's new", () => {
  const FEED = {
    version: '2.0.0',
    seen: '1.9.0',
    entries: [
      {
        id: 'v2-home',
        version: '2.0.0',
        title: 'One menu, calmer panels, cloud first.',
        summary: 'Home is the question.',
      },
      { id: 'older', version: '1.9.5', title: 'Older', summary: 'Older thing.' },
    ],
  };
  test('after an update: one quiet line with the newest unseen title — and once', async () => {
    shell = SHELL_ONE;
    cloud = IN(1);
    routes['/_home/whats-new'] = () => [200, FEED];
    mount();
    await flush();
    expect($('home-whatsnew-line')?.textContent).toContain(
      "What's new — One menu, calmer panels, cloud first."
    );
    expect($('home-whatsnew-open')?.textContent).toContain("See what's new");
    // the next visit to Home is quiet again
    act(() => root.unmount());
    host.remove();
    mount();
    await flush();
    expect($('home-whatsnew-line')).toBeNull();
  });

  test('"See what\'s new" lists the entries and reading them moves the one seen mark forward', async () => {
    shell = SHELL_ONE;
    cloud = IN(1);
    routes['/_home/whats-new'] = (b) => (b ? [200, { ok: true }] : [200, FEED]);
    mount();
    await flush();
    click('home-whatsnew-open');
    expect($('home-whatsnew-dialog')?.textContent).toContain('Home is the question.');
    expect($('home-whatsnew-dialog')?.textContent).toContain('Older thing.');
    click('home-whatsnew-close');
    await flush();
    const posts = calls.filter((c) => c.url.startsWith('/_home/whats-new') && c.method === 'POST');
    expect(posts.at(-1)?.body).toEqual({ seen: '2.0.0' });
    expect($('home-whatsnew-line')).toBeNull();
    expect($('home-whatsnew-dialog')).toBeNull();
  });

  test('never on a first run (the card is showing); a first run acknowledges the version silently', async () => {
    routes['/_home/whats-new'] = (b) => (b ? [200, { ok: true }] : [200, { ...FEED, seen: null }]);
    mount();
    await flush();
    expect($('signin-card')).not.toBeNull();
    expect($('home-whatsnew-line')).toBeNull();
    const posts = calls.filter((c) => c.url.startsWith('/_home/whats-new') && c.method === 'POST');
    expect(posts[0]?.body).toEqual({ seen: '2.0.0' });
  });
});
