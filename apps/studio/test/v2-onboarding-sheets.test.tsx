// v2-onboarding-sheets — S6.9: the five Advanced sheets of Home's "Advanced options" (02 Onboarding ob-adv-sheets).
// Part A drives each sheet as a view (title verb = primary button; Cancel; no secret echoed into the DOM);
// part B scripts `connectClaudeHome`; part C mounts Home (Tauri stubbed as in home-first-run.test.tsx) and walks
// the flyout rows to the real routes: /_home/hub/{test,signin/*,prepare}, /_home/ai/*, /_home/cli/*, the shell's folder
// picker and the import-figma intent. No keychain, no real hub, no real Claude.

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
import { CHECK_DEBOUNCE_MS } from '../client/v2/link-server/LinkServerDialog.jsx';
import { HUB_POLL_MS } from '../client/v2/onboarding/AdvancedSheets.jsx';
import { CliSheet } from '../client/v2/onboarding/CliSheet.jsx';
import { ConnectAiSheet } from '../client/v2/onboarding/ConnectAiSheet.jsx';
import { connectClaudeHome } from '../client/v2/onboarding/connect-ai-home.js';
import { FigmaSheet } from '../client/v2/onboarding/FigmaSheet.jsx';
import { FolderGithubSheet } from '../client/v2/onboarding/FolderGithubSheet.jsx';

const SECRET = 'ef'.repeat(32);
const flush = async (n = 8) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
};

let host: HTMLElement;
let root: Root;
const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (id: string) => act(() => $(id)?.click());
// happy-dom does not drive React's synthetic onChange from a dispatched event: call the handler React holds
function reactProps(el: Element): Record<string, (e: unknown) => unknown> {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (e: unknown) => unknown>>)[key] ?? {};
}
const type = (id: string, value: string) =>
  act(() => {
    const el = $(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    reactProps(el).onChange?.({ target: el, currentTarget: el });
  });
const esc = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
function render(el: unknown) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(el as never);
  });
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const noop = () => {};

describe('A · the sheets as views', () => {
  test('every sheet asks with the verb of its main button, and has Cancel', async () => {
    const cases: Array<[string, unknown, string, string, string]> = [
      [
        'folder',
        createElement(FolderGithubSheet, { onOpenFolder: noop, onCancel: noop }),
        'Open a folder or a GitHub project',
        'onb-folder-go',
        'Open',
      ],
      [
        'cli',
        createElement(CliSheet, {
          status: { state: 'absent', plugin: { phase: 'idle' } },
          onInstall: noop,
          onCancel: noop,
        }),
        'Install the maude command',
        'onb-cli-go',
        'Install',
      ],
      [
        'figma',
        createElement(FigmaSheet, { onImport: noop, onCancel: noop }),
        'Import from Figma',
        'onb-figma-go',
        'Import',
      ],
      [
        'ai',
        createElement(ConnectAiSheet, { onConnect: noop, onCancel: noop }),
        'Connect AI',
        'ai-connect-go',
        'Connect',
      ],
    ];
    for (const [id, el, title, go, verb] of cases) {
      render(el);
      const t = host.querySelector('.ai-conn-t')?.textContent;
      expect(t).toBe(title);
      expect($(go)?.textContent).toBe(verb);
      // the title's first word IS the button
      expect(title.startsWith(verb)).toBe(true);
      const cancel = $(id === 'ai' ? 'ai-connect-cancel' : `onb-${id}-cancel`);
      expect(cancel?.textContent).toBe('Cancel');
      act(() => root.unmount());
      host.remove();
    }
  });

  test('folder: From GitHub rests until S6.10 hands a list in; Open runs the folder picker', async () => {
    let opened = 0;
    render(
      createElement(FolderGithubSheet, {
        tab: 'github',
        onOpenFolder: () => {
          opened += 1;
        },
        onCancel: noop,
      })
    );
    expect($('onb-folder-tab-github')?.getAttribute('aria-disabled')).toBe('true');
    expect($('onb-folder-tab-folder')?.getAttribute('aria-pressed')).toBe('true');
    click('onb-folder-tab-github');
    expect($('onb-folder-tab-folder')?.getAttribute('aria-pressed')).toBe('true');
    click('onb-folder-go');
    expect(opened).toBe(1);
  });

  test('folder: once a GitHub list exists the segment opens and Open follows it', async () => {
    let gh = 0;
    render(
      createElement(FolderGithubSheet, {
        tab: 'github',
        onOpenFolder: noop,
        onCancel: noop,
        github: {
          content: createElement('p', { 'data-testid': 'gh-list' }, 'repos'),
          canOpen: true,
          onOpen: () => {
            gh += 1;
          },
        },
      })
    );
    expect($('gh-list')).not.toBeNull();
    click('onb-folder-go');
    expect(gh).toBe(1);
  });

  test('AI: the API key option is drawn and rests; the status word says where AI stands', async () => {
    render(createElement(ConnectAiSheet, { onConnect: noop, onCancel: noop }));
    const key = $('onb-ai-apikey');
    expect(key?.getAttribute('aria-disabled')).toBe('true');
    expect(key?.querySelector('input')?.disabled).toBe(true);
    expect(key?.textContent).toContain('Pay as you go, from your Anthropic console.');
    expect(host.textContent).toContain('Claude Pro or Max');
    expect($('onb-ai-status')?.textContent).toBe(
      'Not connected yet — or connect at your first prompt'
    );
    // the other callers of ConnectSheet keep their words
    act(() => root.unmount());
    host.remove();
    render(createElement(ConnectAiSheet, { connected: true, onConnect: noop, onCancel: noop }));
    expect($('onb-ai-status')?.textContent).toBe('Connected');
  });

  test('CLI: real status on both rows; Install rests when there is nothing left to do', async () => {
    render(
      createElement(CliSheet, {
        status: { state: 'absent', claude: true, plugin: { phase: 'idle' } },
        onInstall: noop,
        onCancel: noop,
      })
    );
    expect($('onb-cli-cmd-status')?.textContent).toBe('Not installed');
    expect($('onb-cli-plugin-status')?.textContent).toBe('Not installed');
    expect(($('onb-cli-go') as HTMLButtonElement).disabled).toBe(false);
    expect(host.textContent).toContain('npm i -g @1agh/maude');
    expect(host.textContent).toContain('/plugin marketplace add 1aGh/maude');
    act(() => root.unmount());
    host.remove();
    render(
      createElement(CliSheet, {
        status: { state: 'installed', claude: true, plugin: { phase: 'done', ok: true } },
        onInstall: noop,
        onCancel: noop,
      })
    );
    expect($('onb-cli-cmd-status')?.textContent).toBe('Installed');
    expect($('onb-cli-plugin-status')?.textContent).toBe('Installed');
    expect(($('onb-cli-go') as HTMLButtonElement).disabled).toBe(true);
  });

  test('CLI: a path Maude will not overwrite is reported in the server’s words', async () => {
    render(
      createElement(CliSheet, {
        status: { state: 'not-a-link', claude: false, plugin: { phase: 'idle' } },
        error: '~/.local/bin/maude is a file. Maude left it as it is.',
        onInstall: noop,
        onCancel: noop,
      })
    );
    expect($('onb-cli-cmd-status')?.textContent).toBe('Not installed');
    expect($('onb-cli-error')?.textContent).toContain('Maude left it as it is');
  });

  test('Figma: the fine print names the project the frames land in', async () => {
    render(
      createElement(FigmaSheet, {
        target: { name: 'Alligators brand' },
        onImport: noop,
        onCancel: noop,
      })
    );
    expect($('onb-figma-line')?.textContent).toBe(
      "Each frame arrives as an artboard on a new canvas in Alligators brand — Figma's exact picture of it. Make editable turns one artboard into layers; it needs Figma Dev Mode, on a paid seat."
    );
    // the board's link field, and the token fold (collapsed): Home holds no Figma credential
    expect($('onb-figma-link')).not.toBeNull();
    expect(host.querySelector('input[type="password"]')).toBeNull();
    const fold = $('onb-figma-advanced');
    expect(fold?.textContent).toBe('AdvancedAccess token');
    expect($('onb-figma-token-line')).toBeNull();
    click('onb-figma-advanced');
    expect($('onb-figma-token-line')?.textContent).toContain('in the project window');
    expect(host.querySelector('input[type="password"]')).toBeNull();
  });

  test('Figma: the link is checked by shape; Import hands a good one over and holds a bad one', async () => {
    const seen: string[] = [];
    render(createElement(FigmaSheet, { onImport: (l: string) => seen.push(l), onCancel: noop }));
    await type('onb-figma-link', 'https://example.com/design/x');
    expect($('onb-figma-link-err')?.textContent).toBe("That doesn't look like a Figma link.");
    expect(($('onb-figma-go') as HTMLButtonElement).disabled).toBe(true);
    await type('onb-figma-link', ' figma.com/design/AbC/Uniformy-2027 ');
    expect($('onb-figma-link-err')).toBeNull();
    click('onb-figma-go');
    expect(seen).toEqual(['figma.com/design/AbC/Uniformy-2027']);
  });
});

describe('B · connectClaudeHome', () => {
  const ok = (json: unknown) => ({ ok: true, json });
  const never = async () => {};

  test('already connected: nothing is started', async () => {
    const calls: string[] = [];
    const r = await connectClaudeHome({
      status: async () => ok({ available: true, claudeInstalled: true }),
      connect: async (s: string) => (calls.push(s), ok({ ok: true })),
      sleep: never,
    });
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  test('missing Claude Code: install, follow it, then the browser sign-in, then wait for AI', async () => {
    const calls: string[] = [];
    const phases: string[] = [];
    let reads = 0;
    const r = await connectClaudeHome({
      status: async () => {
        reads += 1;
        if (reads === 1) return ok({ available: false, claudeInstalled: false });
        if (reads === 2) return ok({ install: { phase: 'running' } });
        if (reads === 3) return ok({ install: { phase: 'done', ok: true } });
        if (reads === 4)
          return ok({ available: false, claudeInstalled: true, signinInFlight: true });
        return ok({ available: true, claudeInstalled: true, signinInFlight: false });
      },
      connect: async (s: string) => (calls.push(s), ok({ ok: true })),
      sleep: never,
      onPhase: (p: string) => phases.push(p),
    });
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual(['install', 'signin']);
    expect(phases).toEqual(['installing', 'waiting']);
  });

  test('an installer that fails says why; nothing signs in', async () => {
    const calls: string[] = [];
    let reads = 0;
    const r = await connectClaudeHome({
      status: async () =>
        ++reads === 1
          ? ok({ available: false, claudeInstalled: false })
          : ok({ install: { phase: 'done', ok: false, reason: 'No network.' } }),
      connect: async (s: string) => (calls.push(s), ok({ ok: true })),
      sleep: never,
    });
    expect(r).toEqual({ ok: false, reason: 'No network.' });
    expect(calls).toEqual(['install']);
  });

  test('Cancel while waiting withdraws the sign-in', async () => {
    const calls: string[] = [];
    const ctl = new AbortController();
    const r = await connectClaudeHome({
      status: async () => ok({ available: false, claudeInstalled: true, signinInFlight: true }),
      connect: async (s: string) => (calls.push(s), ok({ ok: true })),
      sleep: async () => ctl.abort(),
      signal: ctl.signal,
    });
    expect(r).toEqual({ ok: false, reason: 'cancelled' });
    expect(calls).toEqual(['signin', 'cancel']);
  });

  test('a sign-in that ends without connecting is called over, not waited out', async () => {
    const r = await connectClaudeHome({
      status: async () => ok({ available: false, claudeInstalled: true, signinInFlight: false }),
      connect: async () => ok({ ok: true }),
      sleep: never,
    });
    expect(r).toEqual({ ok: false, reason: "Sign-in didn't finish. Try again." });
  });

  test('a refusal to start comes back in the server’s words', async () => {
    const r = await connectClaudeHome({
      status: async () => ok({ available: false, claudeInstalled: true }),
      connect: async () => ({
        ok: false,
        json: { ok: false, error: 'Another sign-in is running.' },
      }),
      sleep: never,
    });
    expect(r).toEqual({ ok: false, reason: 'Another sign-in is running.' });
  });
});

// ── C · Home ───────────────────────────────────────────────────────────────────────────────────
const SHELL_NONE = { projects: [], profiles: [{ id: 'default', label: 'Personal' }], recent: [] };
const OUT = { ok: false, profile: 'default', signedIn: false, projects: [], shared: [] };

type Call = { url: string; method: string; body: any };
type Reply = [number, unknown];
let calls: Call[] = [];
let invokes: Array<{ cmd: string; args: any }> = [];
let routes: Record<string, (body: any) => Reply> = {};
let invokeAnswers: Record<string, (args: any) => unknown> = {};
let originalFetch: typeof fetch;

function defaults(pathname: string): Reply {
  if (pathname === '/_home/index') return [200, { v: 1, projects: [] }];
  if (pathname === '/_home/cloud') return [200, OUT];
  if (pathname === '/_home/recent-searches') return [200, { recentSearches: [] }];
  if (pathname === '/_home/whats-new')
    return [200, { version: '2.0.0', entries: [], seen: '2.0.0' }];
  if (pathname === '/_home/projects/create-local')
    return [
      200,
      { ok: true, root: '/Users/x/Maude/Untitled project', pid: 'lnew', name: 'Untitled project' },
    ];
  if (pathname === '/_home/ai/status')
    return [
      200,
      {
        ok: true,
        available: false,
        claudeInstalled: true,
        install: { phase: 'idle' },
        signinInFlight: false,
      },
    ];
  if (pathname === '/_home/cli/status')
    return [
      200,
      {
        ok: true,
        state: 'absent',
        link: '~/.local/bin/maude',
        claude: true,
        plugin: { phase: 'idle' },
      },
    ];
  return [404, { error: 'nope' }];
}

function installFetch() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const u = new URL(url, 'http://localhost:4479');
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init.method || 'GET', body });
    const [status, json] = (routes[u.pathname] ?? (() => defaults(u.pathname)))(body);
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
        if (cmd === 'shell_subscribe') return null;
        if (cmd === 'home_session') return { secret: SECRET };
        invokes.push({ cmd, args });
        if (invokeAnswers[cmd]) return invokeAnswers[cmd](args);
        if (cmd === 'shell_state') return SHELL_NONE;
        if (cmd === 'open_project') return { label: 'p-x', opened: 'new' };
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
const hit = (path: string) => calls.filter((c) => c.url.startsWith(path));
const cmds = (name: string) => invokes.filter((i) => i.cmd === name);

async function mountHome() {
  render(createElement(HomeApp));
  await flush();
}
/** 2.1.1 T5 — the address is checked as it rests: type, wait the debounce, let the answer land. */
async function typeAddress(url: string) {
  if (!routes['/_home/hub/test'])
    routes['/_home/hub/test'] = () => [200, { ok: true, reachable: true, url, version: '2.1.0' }];
  type('link-server-url', url);
  await act(async () => {
    await new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 30));
  });
  await flush();
}

async function openRow(id: string) {
  click('signin-advanced');
  click(`signin-adv-${id}`);
  await flush();
}

describe('C · Home: the flyout rows open their sheets', () => {
  beforeEach(() => {
    calls = [];
    invokes = [];
    routes = {};
    invokeAnswers = {};
    api.resetHomeSecret();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    installFetch();
    installTauri();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    removeTauri();
    api.resetHomeSecret();
  });

  test('all five rows are live and each opens exactly one sheet; the flyout closes behind it', async () => {
    await mountHome();
    click('signin-advanced');
    for (const id of ['hub', 'folder-github', 'ai', 'cli', 'figma'])
      expect($(`signin-adv-${id}`)?.getAttribute('aria-disabled')).toBeNull();
    const sheets: Record<string, string> = {
      hub: 'link-server-dialog',
      'folder-github': 'onb-folder',
      ai: 'ai-connect-sheet',
      cli: 'onb-cli',
      figma: 'onb-figma',
    };
    for (const [row, sheet] of Object.entries(sheets)) {
      if (!$(`signin-adv-${row}`)) click('signin-advanced');
      click(`signin-adv-${row}`);
      await flush();
      expect($(sheet)).not.toBeNull();
      expect($('signin-advanced-menu')).toBeNull();
      expect(host.querySelectorAll('[role="dialog"]').length).toBeGreaterThanOrEqual(1);
      esc(); // Esc is Cancel
      await flush();
      expect($(sheet)).toBeNull();
    }
  });

  test('#204 K2 hub: Sign in opens the hub’s own page through the shell, waits, then opens the managed copy as a tab', async () => {
    const SIGNIN = `https://hub.example/studio/signin?client=desktop&state=${'ab'.repeat(16)}`;
    routes['/_home/hub/test'] = () => [
      200,
      { ok: true, reachable: true, url: 'https://hub.example', version: '2.0.4' },
    ];
    routes['/_home/hub/signin/start'] = () => [
      200,
      { ok: true, id: 'att-1', signInUrl: SIGNIN, expiresIn: 600, profile: 'default' },
    ];
    let polls = 0;
    routes['/_home/hub/signin/poll'] = () => {
      polls += 1;
      return polls < 2
        ? [200, { ok: true, pending: true }]
        : [200, { ok: true, url: 'https://hub.example', user: { email: 'me@x', role: 'member' } }];
    };
    routes['/_home/hub/prepare'] = () => [
      200,
      {
        ok: true,
        serverUrl: 'https://hub.example',
        projectId: 'proj-1',
        name: 'Combine',
        role: 'owner',
        canvasGroups: ['UI'],
        mode: 'transactions',
        profile: 'default',
      },
    ];
    invokeAnswers.open_team_server_signin = () => null;
    invokeAnswers.managed_project_open = () => '/Users/x/.maude/managed/Combine';
    await mountHome();
    await openRow('hub');
    await typeAddress('https://hub.example');
    expect(hit('/_home/hub/test')).toHaveLength(1); // checked once, as it was typed
    expect(hit('/_home/hub/test')[0]?.body).toEqual({ url: 'https://hub.example' });
    expect($('link-server-check')?.textContent).toBe('hub.example answers — Maude 2.0.4');
    click('link-server-signin');
    await flush();
    expect(hit('/_home/hub/signin/start')[0]?.body).toEqual({
      profile: 'default',
      url: 'https://hub.example',
    });
    expect(cmds('open_team_server_signin')[0]?.args).toEqual({ url: SIGNIN });
    expect($('link-server-waiting')?.textContent).toBe(
      'hub.example opened in your browser. Sign in there — this closes by itself when you’re done.'
    );
    // the next ask finds the browser came back
    await act(async () => {
      await new Promise((r) => setTimeout(r, HUB_POLL_MS + 50));
    });
    await flush();
    expect(hit('/_home/hub/signin/poll')[0]?.body).toEqual({ id: 'att-1' });
    expect(hit('/_home/hub/prepare')[0]?.body).toEqual({
      profile: 'default',
      url: 'https://hub.example',
    });
    expect(cmds('managed_project_open')[0]?.args).toMatchObject({
      serverUrl: 'https://hub.example',
      projectId: 'proj-1',
      profile: 'default',
    });
    expect(cmds('open_project')[0]?.args).toMatchObject({
      root: '/Users/x/.maude/managed/Combine',
    });
    expect($('link-server-dialog')).toBeNull();
  });

  test('#204 K2 hub: an invite key goes to start once, never a URL Home builds; Cancel forgets the attempt', async () => {
    const KEY = `inv_${'cd'.repeat(24)}`;
    routes['/_home/hub/signin/start'] = () => [
      200,
      {
        ok: true,
        id: 'att-2',
        signInUrl: `https://hub.example/join/${KEY}?client=desktop`,
        expiresIn: 600,
      },
    ];
    routes['/_home/hub/signin/poll'] = () => [200, { ok: true, pending: true }];
    routes['/_home/hub/signin/cancel'] = () => [200, { ok: true }];
    invokeAnswers.open_team_server_signin = () => null;
    await mountHome();
    await openRow('hub');
    await typeAddress('https://hub.example');
    click('link-server-invite-open');
    type('link-server-invite', KEY);
    click('link-server-signin');
    await flush();
    expect(hit('/_home/hub/signin/start')).toHaveLength(1);
    expect(hit('/_home/hub/signin/start')[0].body).toEqual({
      profile: 'default',
      url: 'https://hub.example',
      invite: KEY,
    });
    for (const c of calls) expect(c.url).not.toContain(KEY);
    expect($('link-server-waiting')).not.toBeNull();
    click('link-server-cancel');
    await flush();
    expect(hit('/_home/hub/signin/cancel')[0]?.body).toEqual({ id: 'att-2' });
    expect($('link-server-waiting')).toBeNull();
    expect($('link-server-dialog')).not.toBeNull(); // the wait ended; the dialog stays
    expect(cmds('open_project')).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  test('#204 K2 hub: a team server older than 2.0.4 says so plainly; nothing opens', async () => {
    routes['/_home/hub/signin/start'] = () => [
      409,
      {
        ok: false,
        reason: 'needs-update',
        error:
          'This team server runs 1.9.0, which is too old to sign in from here. Nothing was sent to it. Ask whoever runs it to update it to 2.0.4 or newer.',
      },
    ];
    await mountHome();
    await openRow('hub');
    await typeAddress('https://hub.example');
    click('link-server-signin');
    await flush();
    expect($('link-server-error')?.textContent).toContain('update it to 2.0.4');
    expect(cmds('open_team_server_signin')).toHaveLength(0);
    expect($('link-server-signin')?.textContent).toBe('Sign in in your browser');
  });

  test('#204 K2 hub: the shell refusing the page stays on the sheet, in words, and forgets the attempt', async () => {
    routes['/_home/hub/signin/start'] = () => [
      200,
      { ok: true, id: 'att-3', signInUrl: 'https://hub.example/studio/signin?x', expiresIn: 600 },
    ];
    routes['/_home/hub/signin/cancel'] = () => [200, { ok: true }];
    invokeAnswers.open_team_server_signin = () => {
      throw new Error('Refusing to open that address.');
    };
    await mountHome();
    await openRow('hub');
    await typeAddress('https://hub.example');
    click('link-server-signin');
    await flush();
    expect($('link-server-error')?.textContent).toBe(
      'Maude won’t open that address. Check the server address.'
    );
    expect(hit('/_home/hub/signin/cancel')[0]?.body).toEqual({ id: 'att-3' });
    expect(cmds('open_project')).toHaveLength(0);
  });
  test('folder: Open runs the shell’s folder picker and leaves the sheet', async () => {
    await mountHome();
    await openRow('folder-github');
    // S6.10: inside the app the GitHub segment is live (v2-github-home.test.tsx drives it); the sheet
    // still opens on the folder segment
    expect($('onb-folder-tab-github')?.getAttribute('aria-disabled')).toBeNull();
    expect($('onb-folder-tab-folder')?.getAttribute('aria-pressed')).toBe('true');
    click('onb-folder-go');
    await flush();
    expect(cmds('open_project_folder')).toHaveLength(1);
    expect($('onb-folder')).toBeNull();
  });

  test('AI: Connect starts the sign-in through Home and Cancel withdraws it', async () => {
    let signin = 0;
    routes['/_home/ai/connect'] = (b) => {
      if (b.step === 'signin') signin += 1;
      return [200, { ok: true }];
    };
    await mountHome();
    await openRow('ai');
    expect($('onb-ai-status')?.textContent).toBe(
      'Not connected yet — or connect at your first prompt'
    );
    click('ai-connect-go');
    await flush(3);
    expect(signin).toBe(1);
    expect($('ai-connect-sheet')?.getAttribute('data-phase')).toBe('waiting');
    click('ai-connect-cancel');
    await flush();
    expect(hit('/_home/ai/connect').map((c) => c.body.step)).toEqual(['signin', 'cancel']);
    expect($('ai-connect-sheet')).toBeNull();
  });

  test('CLI: shows the real status and Install runs the install route', async () => {
    let installed = false;
    routes['/_home/cli/status'] = () => [
      200,
      {
        ok: true,
        state: installed ? 'installed' : 'absent',
        link: '~/.local/bin/maude',
        claude: false,
        plugin: { phase: 'idle' },
      },
    ];
    routes['/_home/cli/install'] = () => {
      installed = true;
      return [
        200,
        {
          ok: true,
          state: 'installed',
          link: '~/.local/bin/maude',
          claude: false,
          plugin: { phase: 'idle' },
        },
      ];
    };
    await mountHome();
    await openRow('cli');
    expect($('onb-cli-cmd-status')?.textContent).toBe('Not installed');
    click('onb-cli-go');
    await flush();
    expect(hit('/_home/cli/install')).toHaveLength(1);
    expect($('onb-cli-cmd-status')?.textContent).toBe('Installed');
  });

  test('CLI: a refusal (a file already there) is shown and nothing claims to be installed', async () => {
    routes['/_home/cli/install'] = () => [
      409,
      {
        ok: false,
        state: 'not-a-link',
        link: '~/.local/bin/maude',
        claude: false,
        plugin: { phase: 'idle' },
        error: '~/.local/bin/maude is a file. Maude left it as it is.',
      },
    ];
    await mountHome();
    await openRow('cli');
    click('onb-cli-go');
    await flush();
    expect($('onb-cli-error')?.textContent).toContain('Maude left it as it is');
    expect($('onb-cli-cmd-status')?.textContent).toBe('Not installed');
  });

  test('Figma: Import opens the target (a new project here) with the import-figma intent', async () => {
    await mountHome();
    await openRow('figma');
    expect($('onb-figma-line')?.textContent).toContain('on a new canvas in a project on this Mac');
    await type('onb-figma-link', 'figma.com/design/AbC/Uniformy-2027');
    click('onb-figma-go');
    await flush();
    expect(hit('/_home/projects/create-local')).toHaveLength(1);
    const open = cmds('open_project')[0];
    expect(open?.args.root).toBe('/Users/x/Maude/Untitled project');
    expect(open?.args.intent).toMatchObject({
      kind: 'import-figma',
      prompt: 'figma.com/design/AbC/Uniformy-2027',
    });
    expect($('onb-figma')).toBeNull();
  });
});
