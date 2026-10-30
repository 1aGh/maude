// p8-update-fails-loud — the callout, rendered (happy-dom). "Update project did nothing: repeated clicks,
// no change, no message" (the alligators report, 2026-10-29). Each answer the migrate route can give ends
// in a worded line and ONE action that helps. Since p8-v1-drop the update runs BY ITSELF on open (the
// opt-in dialog is gone), so the words land in the callout itself; while it runs the callout says so and
// a second trigger sends nothing.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  native(true);
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const HUB = 'https://hub.example';
/** The desktop app's Tauri global (the team-server sign-in is the app's own; a browser has none). */
function native(on: boolean) {
  const w = window as unknown as { __TAURI__?: unknown };
  if (on) w.__TAURI__ = { core: { invoke: async () => [] } };
  else w.__TAURI__ = undefined;
}
const realFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
  try {
    sessionStorage.clear();
  } catch {}
});

const older = {
  name: 'alligators',
  designRel: '.design',
  formatVersion: 1,
  formatGate: { projectFormat: 1, supported: 2, source: 'config' },
  readOnlyReason: 'format',
};
const dryOk = {
  format: 'maude.migrate-report',
  dryRun: true,
  exitCode: 0,
  project: { formatBefore: 1, linked: { hub: HUB, role: 'owner', hubFormat: 2, capabilities: [] } },
  refusals: [],
  steps: [],
};
const refusedWith = (code: string) => ({
  ...dryOk,
  dryRun: false,
  exitCode: 11,
  refusals: [{ path: '', reason: 'x', code }],
});

type Answer = { status: number; body?: unknown; raw?: string } | 'throw' | Promise<Response>;

/** The migrate route: the dry run answers `dry`; every apply answers the next of `applies`. */
function mockMigrate(dry: unknown, applies: Answer[]) {
  const calls = { dry: 0, apply: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/_api/project/migrate') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (!body.apply) {
        calls.dry++;
        return new Response(JSON.stringify(dry), { status: 200 });
      }
      calls.apply++;
      const a = applies.shift() ?? { status: 500, body: { error: 'x' } };
      if (a === 'throw') throw new TypeError('Failed to fetch');
      if (a instanceof Promise) return a;
      return new Response(a.raw ?? JSON.stringify(a.body ?? null), { status: a.status });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return calls;
}

const wait = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function mount(cfg: Record<string, unknown> = older) {
  const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
  const { OlderFormatCallout } = await import('../client/v2/shell/format-update.jsx');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const store = { shellCore: { cfg, project: 'alligators' } };
  await act(async () =>
    root?.render(
      <ShellStoreContext.Provider value={store as never}>
        <OlderFormatCallout />
      </ShellStoreContext.Provider>
    )
  );
  await wait(10);
}

const callout = () => $('format-older-callout');
/** the callout's one action button, if any */
const actionButton = () => callout()?.querySelector('button') as HTMLButtonElement | null;

describe('Update — each failure is worded in the callout', () => {
  const cases: Array<{ name: string; answer: Answer; line: RegExp; action: string | null }> = [
    {
      name: 'offline',
      answer: { status: 409, body: refusedWith('offline') },
      line: /team server can't be reached/,
      action: 'Retry update',
    },
    {
      name: 'not signed in',
      answer: { status: 409, body: refusedWith('no-sign-in') },
      line: /isn't signed in to the team server/,
      action: 'Sign in',
    },
    {
      name: 'token rejected',
      answer: { status: 409, body: refusedWith('token-rejected') },
      line: /turned down this Mac's sign-in/,
      action: 'Sign in again',
    },
    {
      name: 'an older server without the route (404)',
      answer: { status: 404, raw: 'Not Found' },
      line: /Restart Maude/,
      action: null,
    },
    {
      name: 'an older server without the route (405)',
      answer: { status: 405, raw: '' },
      line: /Restart Maude/,
      action: null,
    },
    {
      name: 'an unexpected error (500)',
      answer: { status: 500, body: { error: 'migration failed' } },
      line: /Something stopped the update/,
      action: 'Retry update',
    },
    {
      name: 'a dropped connection',
      answer: 'throw',
      line: /Something stopped the update/,
      action: 'Retry update',
    },
  ];
  for (const c of cases) {
    test(c.name, async () => {
      const calls = mockMigrate(dryOk, [c.answer]);
      await mount();
      expect($('format-update-dialog')).toBe(null); // nothing to confirm: it ran by itself
      expect(calls.apply).toBe(1);
      expect(callout()?.textContent ?? '').toMatch(c.line);
      if (c.action === null) expect(actionButton()).toBe(null);
      else {
        expect(actionButton()?.textContent).toBe(c.action);
        expect(actionButton()?.disabled).toBe(false);
      }
    });
  }

  test('Retry update runs the update again, and a success clears the line', async () => {
    const calls = mockMigrate(dryOk, [
      { status: 500, body: { error: 'x' } },
      { status: 200, body: { ...dryOk, dryRun: false } },
    ]);
    await mount();
    expect($('format-older-retry')?.textContent).toBe('Retry update');
    await act(async () => {
      $('format-older-retry')?.click();
    });
    await wait(10);
    expect(calls.apply).toBe(2);
    expect(callout()?.textContent ?? '').not.toMatch(/Something stopped/);
  });

  test('Sign in again opens the sign-in for the project’s team server', async () => {
    mockMigrate(dryOk, [{ status: 409, body: refusedWith('token-rejected') }]);
    await mount();
    await act(async () => {
      $('format-older-sign-in')?.click();
    });
    await wait(10);
    expect($('team-projects-dialog')).not.toBe(null);
  });

  test('in a browser (no desktop app) the words stay, with no sign-in button to break', async () => {
    native(false);
    try {
      mockMigrate(dryOk, [{ status: 409, body: refusedWith('token-rejected') }]);
      await mount();
      expect(callout()?.textContent ?? '').toMatch(/turned down this Mac's sign-in/);
      expect($('format-older-sign-in')).toBe(null);
    } finally {
      native(true);
    }
  });
});

describe('Update — while it runs', () => {
  test('the callout says so, and a second trigger sends nothing', async () => {
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((r) => {
      release = r;
    });
    const calls = mockMigrate(dryOk, [pending]);
    await mount();
    expect(calls.apply).toBe(1);
    expect(callout()?.getAttribute('data-kind')).toBe('updating');
    expect(callout()?.textContent ?? '').toMatch(/Updating this project for Maude 2/);
    expect(actionButton()).toBe(null);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await wait(10);
    expect(calls.apply).toBe(1);
    await act(async () => {
      release(new Response(JSON.stringify({ ...dryOk, dryRun: false }), { status: 200 }));
    });
    await wait(10);
    expect(calls.apply).toBe(1);
  });
});

describe('the callout before anyone clicks', () => {
  test('format 1, the token is rejected: view only, Sign in again (no silent Update)', async () => {
    mockMigrate({ ...refusedWith('token-rejected'), dryRun: true }, []);
    await mount();
    expect($('format-update-dialog')).toBe(null); // the opt-in dialog is gone
    expect($('format-older-callout')?.textContent ?? '').toMatch(/turned down this Mac's sign-in/);
    expect($('format-older-sign-in')?.textContent).toBe('Sign in again');
  });

  test('format 2, saves the old way, the token is rejected: the quiet line says why', async () => {
    mockMigrate(
      {
        ...refusedWith('token-rejected'),
        dryRun: true,
        project: { ...dryOk.project, formatBefore: 2 },
      },
      []
    );
    await mount({ name: 'alligators', formatVersion: 2, formatGate: null, saveMode: 'legacy' });
    expect($('format-older-callout')?.getAttribute('data-kind')).toBe('save-mode-sign-in');
    expect($('format-older-callout')?.textContent ?? '').toMatch(/still saves the old way/);
    expect($('format-older-sign-in')?.textContent).toBe('Sign in again');
  });
});
