// v2-onboarding-sheets — S6.9: the five Advanced sheets of Home's "Advanced options" (02 Onboarding ob-adv-sheets).
// Part A drives each sheet as a view (title verb = primary button; Cancel; no secret echoed into the DOM);
// part B scripts `connectClaudeHome`; part C mounts Home (Tauri stubbed as in home-first-run.test.tsx) and walks
// the flyout rows to the real routes: /_home/hub/{test,prepare}, /_home/ai/*, /_home/cli/*, the shell's folder
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
import { CliSheet } from '../client/v2/onboarding/CliSheet.jsx';
import { ConnectAiSheet } from '../client/v2/onboarding/ConnectAiSheet.jsx';
import { connectClaudeHome } from '../client/v2/onboarding/connect-ai-home.js';
import { FigmaSheet } from '../client/v2/onboarding/FigmaSheet.jsx';
import { FolderGithubSheet } from '../client/v2/onboarding/FolderGithubSheet.jsx';
import { HubSheet } from '../client/v2/onboarding/HubSheet.jsx';

const SECRET = 'ef'.repeat(32);
const PASSWORD = 'hunter2-correct-horse';
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
        'hub',
        createElement(HubSheet, {
          onTest: async () => ({ ok: true }),
          onConnect: async () => ({ ok: true }),
          onCancel: noop,
        }),
        'Connect to your own hub',
        'onb-hub-go',
        'Connect',
      ],
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

  test('Cancel and Escape both leave the sheet', async () => {
    let cancels = 0;
    render(
      createElement(HubSheet, {
        onTest: async () => ({ ok: true }),
        onConnect: async () => ({ ok: true }),
        onCancel: () => {
          cancels += 1;
        },
      })
    );
    click('onb-hub-cancel');
    expect(cancels).toBe(1);
    esc();
    expect(cancels).toBe(2);
  });

  test('hub: Test connection reads "Reachable — hub 1.4"; a changed address forgets it', async () => {
    const tested: string[] = [];
    render(
      createElement(HubSheet, {
        onTest: async (url: string) => {
          tested.push(url);
          return { ok: true, version: '1.4' };
        },
        onConnect: async () => ({ ok: true }),
        onCancel: noop,
      })
    );
    type('onb-hub-url', 'https://maude.alligators.cz');
    click('onb-hub-test');
    await flush();
    expect(tested).toEqual(['https://maude.alligators.cz']);
    expect($('onb-hub-reachable')?.textContent).toBe('Reachable — hub 1.4');
    type('onb-hub-url', 'https://maude.alligators.cz/x');
    expect($('onb-hub-reachable')).toBeNull();
  });

  test('hub: a refusal is shown in the server’s words', async () => {
    render(
      createElement(HubSheet, {
        onTest: async () => ({
          ok: false,
          error: "That address answered, but it isn't a Maude hub.",
        }),
        onConnect: async () => ({ ok: false, error: 'Wrong email or password.' }),
        onCancel: noop,
      })
    );
    type('onb-hub-url', 'https://example.com');
    click('onb-hub-test');
    await flush();
    expect($('onb-hub-test-error')?.textContent).toContain("isn't a Maude hub");
    type('onb-hub-email', 'me@alligators.cz');
    type('onb-hub-password', PASSWORD);
    click('onb-hub-go');
    await flush();
    expect($('onb-hub-error')?.textContent).toBe('Wrong email or password.');
  });

  test('hub: the password is handed over once and nothing in the DOM holds it afterwards', async () => {
    const got: Array<Record<string, string>> = [];
    let release: (v: { ok: boolean }) => void = noop;
    render(
      createElement(HubSheet, {
        onTest: async () => ({ ok: true }),
        onConnect: (v: Record<string, string>) => {
          got.push(v);
          return new Promise((res) => {
            release = res as never;
          });
        },
        onCancel: noop,
      })
    );
    type('onb-hub-url', 'https://maude.alligators.cz');
    type('onb-hub-email', 'me@alligators.cz');
    type('onb-hub-password', PASSWORD);
    expect(($('onb-hub-password') as HTMLInputElement).type).toBe('password');
    click('onb-hub-go');
    // while the request is in flight the field is already empty and the button says what it is doing
    expect(got).toEqual([
      { url: 'https://maude.alligators.cz', email: 'me@alligators.cz', password: PASSWORD },
    ]);
    expect(($('onb-hub-password') as HTMLInputElement).value).toBe('');
    expect($('onb-hub-go')?.textContent).toBe('Connecting…');
    expect(document.body.innerHTML).not.toContain(PASSWORD);
    await act(async () => release({ ok: false }));
    await flush();
    expect(document.body.innerHTML).not.toContain(PASSWORD);
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  test('hub: blank credentials connect to a hub this Mac already holds a sign-in for', async () => {
    const got: Array<Record<string, string>> = [];
    render(
      createElement(HubSheet, {
        onTest: async () => ({ ok: true }),
        onConnect: async (v: Record<string, string>) => {
          got.push(v);
          return { ok: true };
        },
        onCancel: noop,
      })
    );
    expect(($('onb-hub-go') as HTMLButtonElement).disabled).toBe(true); // no address yet
    type('onb-hub-url', 'https://maude.alligators.cz');
    click('onb-hub-go');
    await flush();
    expect(got).toEqual([{ url: 'https://maude.alligators.cz' }]);
  });

  test('hub: "Invite link or key" is drawn and rests', async () => {
    render(
      createElement(HubSheet, {
        onTest: async () => ({ ok: true }),
        onConnect: async () => ({ ok: true }),
        onCancel: noop,
      })
    );
    const invite = $('onb-hub-mode-invite');
    expect(invite?.textContent).toBe('Invite link or key');
    expect(invite?.getAttribute('aria-disabled')).toBe('true');
    click('onb-hub-mode-invite');
    expect($('onb-hub-mode-password')?.getAttribute('aria-pressed')).toBe('true');
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
    // no field for a token or a link: Home holds no Figma credential
    expect(host.querySelector('input')).toBeNull();
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
      hub: 'onb-hub',
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

  test('hub: Test connection probes the address; Connect posts it once and opens the managed copy as a tab', async () => {
    routes['/_home/hub/test'] = () => [
      200,
      { ok: true, reachable: true, url: 'https://hub.example', version: '1.4' },
    ];
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
    invokeAnswers.managed_project_open = () => '/Users/x/.maude/managed/Combine';
    await mountHome();
    await openRow('hub');
    type('onb-hub-url', 'https://hub.example');
    click('onb-hub-test');
    await flush();
    expect(hit('/_home/hub/test')[0]?.body).toEqual({ url: 'https://hub.example' });
    expect($('onb-hub-reachable')?.textContent).toBe('Reachable — hub 1.4');
    type('onb-hub-email', 'me@alligators.cz');
    type('onb-hub-password', PASSWORD);
    click('onb-hub-go');
    await flush();
    expect(hit('/_home/hub/prepare')).toHaveLength(1);
    expect(hit('/_home/hub/prepare')[0].body).toEqual({
      profile: 'default',
      url: 'https://hub.example',
      email: 'me@alligators.cz',
      password: PASSWORD,
    });
    expect(cmds('managed_project_open')[0]?.args).toMatchObject({
      serverUrl: 'https://hub.example',
      projectId: 'proj-1',
      name: 'Combine',
      profile: 'default',
    });
    expect(cmds('open_project')[0]?.args).toMatchObject({
      root: '/Users/x/.maude/managed/Combine',
    });
    // the sheet is gone; the password went nowhere but the one POST body
    expect($('onb-hub')).toBeNull();
    expect(JSON.stringify(invokes)).not.toContain(PASSWORD);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  test('hub: a refused sign-in stays on the sheet, in words; no tab opens; the password is gone', async () => {
    routes['/_home/hub/prepare'] = () => [401, { ok: false, error: 'Wrong email or password.' }];
    await mountHome();
    await openRow('hub');
    type('onb-hub-url', 'https://hub.example');
    type('onb-hub-email', 'me@alligators.cz');
    type('onb-hub-password', PASSWORD);
    click('onb-hub-go');
    await flush();
    expect($('onb-hub-error')?.textContent).toBe('Wrong email or password.');
    expect(cmds('open_project')).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
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
    click('onb-figma-go');
    await flush();
    expect(hit('/_home/projects/create-local')).toHaveLength(1);
    const open = cmds('open_project')[0];
    expect(open?.args.root).toBe('/Users/x/Maude/Untitled project');
    expect(open?.args.intent).toMatchObject({ kind: 'import-figma', prompt: '' });
    expect($('onb-figma')).toBeNull();
  });
});
