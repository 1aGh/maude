// gate-b-sec3b — Home › Shared with you lists the invitations waiting for the signed-in account
// (`invited[]` from /_home/cloud): "<inviter> invited you to <project>", the role, and two buttons.
// Join accepts (POST /_home/invite/pending/accept), trades the one-time code on the prepare lane and opens
// the project; Leave declines (POST /_home/invite/pending/leave). The cloud sends no invite id, and nothing on
// the page — DOM, state, URLs — names one. Tauri stubbed as in home-ask-send.test.tsx.

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
import { invitedRows } from '../client/home/home-model.js';

const NOW = 1_700_000_000_000;
const INVITE_ID = '0123abcd-0000-4000-8000-00000000abcd';
const EMPTY_SHELL = { projects: [], profiles: [{ id: 'default', label: 'Personal' }], recent: [] };
const INVITED = [
  {
    projectId: 'alligators',
    projectName: 'Alligators brand',
    fromName: 'Tereza',
    canvas: null,
    role: 'member',
    invitedAt: NOW - 3_600_000,
  },
  {
    projectId: 'poster-co',
    projectName: 'Poster Co',
    fromName: null,
    canvas: { path: 'ui/poster.tsx', name: 'poster' },
    role: 'viewer',
    invitedAt: NOW - 7_200_000,
  },
];
const cloud = (invited: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  profile: 'default',
  signedIn: true,
  account: { email: 'me@work.cz' },
  projects: [],
  shared: [],
  invited,
  ...extra,
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let invokes: Array<{ cmd: string; args: unknown }> = [];
let fetchAnswers: Record<string, [number, unknown]> = {};
let originalFetch: typeof fetch;
const SECRET = 'ef'.repeat(32);

function installFetch() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method || 'GET',
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    const path = new URL(url, 'http://localhost:4479').pathname;
    const over = fetchAnswers[path];
    const dflt =
      path === '/_home/index'
        ? { v: 1, projects: [] }
        : path === '/_home/recent-searches'
          ? { recentSearches: [] }
          : { error: 'nope' };
    return new Response(JSON.stringify(over ? over[1] : dflt), {
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
        if (cmd === 'shell_subscribe') return null;
        if (cmd === 'home_session') return { secret: SECRET };
        invokes.push({ cmd, args });
        if (cmd === 'shell_state') return EMPTY_SHELL;
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
const posts = (suffix: string) =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith(suffix));

beforeEach(() => {
  calls = [];
  invokes = [];
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

describe('invitedRows (model)', () => {
  test('one row per pending invitation, in the inviter’s words, newest first', () => {
    const rows = invitedRows([cloud(INVITED)], NOW);
    expect(rows.map((r) => r.key)).toEqual([
      'default:alligators:',
      'default:poster-co:ui/poster.tsx',
    ]);
    expect(rows[0]).toMatchObject({
      profile: 'default',
      projectId: 'alligators',
      canvasPath: null,
      title: 'Tereza invited you to Alligators brand',
      roleWord: 'Can edit',
    });
    // no inviter name (unset, or from before v18): no name, never an address
    expect(rows[1]).toMatchObject({
      canvasPath: 'ui/poster.tsx',
      title: 'Invited to poster',
      meta: 'Poster Co · 2 h ago',
      roleWord: 'Can comment',
    });
  });

  test('a row carries no invite id and no address, even when the listing leaks one', () => {
    const leaky = { ...INVITED[0], id: INVITE_ID, inviteId: INVITE_ID, email: 'a@b.test' };
    const [row] = invitedRows([cloud([leaky])], NOW);
    expect(JSON.stringify(row)).not.toContain(INVITE_ID);
    expect(JSON.stringify(row)).not.toContain('a@b.test');
    expect(Object.keys(row).sort()).toEqual(
      [
        'canvasName',
        'canvasPath',
        'fromName',
        'invitedAt',
        'key',
        'meta',
        'profile',
        'projectId',
        'projectName',
        'role',
        'roleWord',
        'title',
      ].sort()
    );
  });

  test('a signed-out profile and a malformed row list nothing', () => {
    expect(invitedRows([{ signedIn: false, profile: 'x', invited: INVITED }], NOW)).toEqual([]);
    expect(invitedRows([cloud([null, {}, { projectId: 7 }])], NOW)).toEqual([]);
    expect(invitedRows(undefined, NOW)).toEqual([]);
  });
});

describe('Shared with you › pending invitations', () => {
  test('an invitation is a row with Join and Leave; the shelf shows even with nothing shared', async () => {
    fetchAnswers['/_home/cloud'] = [200, cloud(INVITED)];
    mount();
    await flush();
    const shelf = $('home-shared');
    expect(shelf?.textContent).toContain('Tereza invited you to Alligators brand');
    expect(shelf?.textContent).toContain('Can edit');
    expect($('home-shared-empty')).toBeNull();
    const row = $('home-invite-row-alligators-project');
    expect(row).not.toBeNull();
    expect(($('home-invite-join-alligators-project') as HTMLElement).textContent).toContain('Join');
    expect(($('home-invite-leave-alligators-project') as HTMLElement).textContent).toContain(
      'Leave'
    );
    // a canvas invitation is named by its slug
    expect($('home-invite-row-poster-co-ui-poster')?.textContent).toContain('Invited to poster');
  });

  test('Join accepts with the project and canvas, trades the code, and opens the landing', async () => {
    fetchAnswers['/_home/cloud'] = [200, cloud([INVITED[1]])];
    fetchAnswers['/_home/invite/pending/accept'] = [
      200,
      {
        ok: true,
        code: `mhc_${'ab'.repeat(16)}`,
        landing: { project: 'poster-co', canvas: 'ui/poster.tsx' },
      },
    ];
    fetchAnswers['/_home/cloud/prepare'] = [
      200,
      {
        ok: true,
        serverUrl: 'https://x.test',
        projectId: 'poster-co',
        name: 'poster-co',
        profile: 'default',
      },
    ];
    mount();
    await flush();
    act(() => $('home-invite-join-poster-co-ui-poster')?.click());
    await flush();
    expect(posts('/_home/invite/pending/accept')).toHaveLength(1);
    expect(posts('/_home/invite/pending/accept')[0].body).toEqual({
      profile: 'default',
      projectId: 'poster-co',
      canvas: 'ui/poster.tsx',
    });
    expect(posts('/_home/cloud/prepare')[0].body).toEqual({
      profile: 'default',
      projectId: 'poster-co',
      code: `mhc_${'ab'.repeat(16)}`,
    });
    const open = invokes.find((i) => i.cmd === 'open_project');
    expect(open?.args).toEqual({
      root: '/Users/x/Maude/copy',
      target: { canvas: 'ui/poster.tsx' },
    });
    expect(posts('/_home/invite/pending/leave')).toHaveLength(0);
  });

  test('a Join the cloud refuses says so in words and refreshes the list', async () => {
    fetchAnswers['/_home/cloud'] = [200, cloud(INVITED)];
    fetchAnswers['/_home/invite/pending/accept'] = [
      404,
      {
        reason: 'gone',
        error: 'This invitation link is not valid. Ask the person who invited you for a new one.',
      },
    ];
    mount();
    await flush();
    const loads = calls.filter((c) => c.url.includes('/_home/cloud?')).length;
    act(() => $('home-invite-join-alligators-project')?.click());
    await flush();
    expect(host.textContent).toContain(
      'This invitation link is not valid. Ask the person who invited you for a new one.'
    );
    expect(invokes.some((i) => i.cmd === 'open_project')).toBe(false);
    expect(calls.filter((c) => c.url.includes('/_home/cloud?')).length).toBeGreaterThan(loads);
  });

  test('Leave declines and the row goes away once the list is read again', async () => {
    fetchAnswers['/_home/cloud'] = [200, cloud(INVITED)];
    fetchAnswers['/_home/invite/pending/leave'] = [200, { ok: true }];
    mount();
    await flush();
    fetchAnswers['/_home/cloud'] = [200, cloud([INVITED[1]])];
    act(() => $('home-invite-leave-alligators-project')?.click());
    await flush();
    expect(posts('/_home/invite/pending/leave')).toHaveLength(1);
    expect(posts('/_home/invite/pending/leave')[0].body).toEqual({
      profile: 'default',
      projectId: 'alligators',
      canvas: null,
    });
    expect($('home-invite-row-alligators-project')).toBeNull();
    expect($('home-invite-row-poster-co-ui-poster')).not.toBeNull();
    expect(posts('/_home/invite/pending/accept')).toHaveLength(0);
    expect(invokes.some((i) => i.cmd === 'open_project')).toBe(false);
  });

  test('no invite id is in the DOM, in a URL or in a request, even if the listing carries one', async () => {
    fetchAnswers['/_home/cloud'] = [
      200,
      cloud([{ ...INVITED[0], id: INVITE_ID, inviteId: INVITE_ID, token: INVITE_ID }]),
    ];
    fetchAnswers['/_home/invite/pending/leave'] = [200, { ok: true }];
    mount();
    await flush();
    act(() => $('home-invite-leave-alligators-project')?.click());
    await flush();
    expect(host.innerHTML).not.toContain(INVITE_ID);
    expect(window.location.href).not.toContain(INVITE_ID);
    expect(JSON.stringify(calls)).not.toContain(INVITE_ID);
    // the row's testids name the project and canvas, nothing secret
    expect(host.innerHTML).not.toContain('0123abcd');
  });
});
