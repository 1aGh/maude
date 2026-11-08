// sec-loopback-bearer §7.4 — a desktop project tab trades its server key for the session cookie
// before any same-origin request leaves the page (client/v2/shell/api-session.js).
import { describe, expect, test } from 'bun:test';

import { installApiSession, isProjectTab } from '../client/v2/shell/api-session.js';

type Call = { url: string; init?: RequestInit };

function fakeWin(label: string | null, invoke?: (cmd: string) => Promise<unknown>) {
  const calls: Call[] = [];
  const win: Record<string, unknown> = {
    location: { href: 'http://127.0.0.1:4400/', origin: 'http://127.0.0.1:4400' },
    fetch: (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  };
  if (label) {
    win.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label } } };
    win.__TAURI__ = {
      core: { invoke: invoke ?? (() => Promise.resolve({ key: 'k'.repeat(64) })) },
    };
  }
  return { win, calls };
}

describe('installApiSession', () => {
  test('a project tab opens the session first, with the key from the shell, then sends', async () => {
    const asked: string[] = [];
    const { win, calls } = fakeWin('p-1', (cmd) => {
      asked.push(cmd);
      return Promise.resolve({ key: 'k'.repeat(64) });
    });
    const ready = installApiSession(win as unknown as Window);
    const f = (win.fetch as (u: string) => Promise<Response>)('/_config');
    await ready;
    await f;
    expect(asked).toEqual(['project_api_session']);
    expect(calls[0].url).toBe('/_api/shell/session');
    expect(calls[0].init?.method).toBe('POST');
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-maude-api-key']).toBe('k'.repeat(64));
    expect(calls[1].url).toBe('/_config');
    expect(await ready).toBe(true);
  });

  test('a cross-origin fetch is never held and never carries the key', async () => {
    let release: (v: unknown) => void = () => {};
    const { win, calls } = fakeWin('p-1', () => new Promise((r) => (release = r)));
    installApiSession(win as unknown as Window);
    await (win.fetch as (u: string) => Promise<Response>)('https://example.com/x');
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/x']);
    release({ key: 'k'.repeat(64) });
  });

  test('Home, the strip and a browser are left alone', async () => {
    for (const label of ['home', 'strip', null]) {
      const { win } = fakeWin(label);
      const before = win.fetch;
      expect(await installApiSession(win as unknown as Window)).toBe(false);
      expect(win.fetch).toBe(before);
      expect(isProjectTab(win)).toBe(false);
    }
  });

  test('a shell that refuses leaves the session closed but lets held requests go', async () => {
    const { win, calls } = fakeWin('p-2', () => Promise.reject(new Error('still starting')));
    const ready = installApiSession(win as unknown as Window);
    await (win.fetch as (u: string) => Promise<Response>)('/_config');
    expect(await ready).toBe(false);
    expect(calls.map((c) => c.url)).toEqual(['/_config']);
  }, 5000);
});

// re-check D — a session has an absolute lifetime (24 h) on top of its idle expiry, so a long-open
// tab's session ends while the person works: the page trades its key again, once, without them noticing.
describe('an ended session is re-traded transparently', () => {
  const keyRequired = () =>
    Response.json({ ok: false, error: 'api-key-required' }, { status: 401 });

  test('a 401 api-key-required re-trades the key once and resends the request', async () => {
    const asked: string[] = [];
    const urls: string[] = [];
    let expired = false;
    const win: Record<string, unknown> = {
      location: { href: 'http://127.0.0.1:4400/', origin: 'http://127.0.0.1:4400' },
      fetch: (input: string) => {
        urls.push(String(input));
        if (input === '/_api/shell/session') {
          expired = false;
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(expired ? keyRequired() : new Response('ok'));
      },
      __TAURI_INTERNALS__: { metadata: { currentWebview: { label: 'p-1' } } },
      __TAURI__: {
        core: {
          invoke: (cmd: string) => {
            asked.push(cmd);
            return Promise.resolve({ key: 'k'.repeat(64) });
          },
        },
      },
    };
    await installApiSession(win as unknown as Window);
    expired = true;
    const res = await (win.fetch as (u: string) => Promise<Response>)('/_config');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(asked).toEqual(['project_api_session', 'project_api_session']);
    expect(urls).toEqual(['/_api/shell/session', '/_config', '/_api/shell/session', '/_config']);
  });

  test('still refused after the re-trade: the 401 comes back, no loop', async () => {
    const urls: string[] = [];
    const win: Record<string, unknown> = {
      location: { href: 'http://127.0.0.1:4400/', origin: 'http://127.0.0.1:4400' },
      fetch: (input: string) => {
        urls.push(String(input));
        return Promise.resolve(
          input === '/_api/shell/session' ? new Response(null, { status: 204 }) : keyRequired()
        );
      },
      __TAURI_INTERNALS__: { metadata: { currentWebview: { label: 'p-1' } } },
      __TAURI__: { core: { invoke: () => Promise.resolve({ key: 'k'.repeat(64) }) } },
    };
    await installApiSession(win as unknown as Window);
    const res = await (win.fetch as (u: string) => Promise<Response>)('/_config');
    expect(res.status).toBe(401);
    expect(urls).toEqual(['/_api/shell/session', '/_config', '/_api/shell/session', '/_config']);
  });

  test('another 401 (a route of its own) and a streamed body are not retried', async () => {
    const urls: string[] = [];
    const win: Record<string, unknown> = {
      location: { href: 'http://127.0.0.1:4400/', origin: 'http://127.0.0.1:4400' },
      fetch: (input: string) => {
        urls.push(String(input));
        if (input === '/_api/shell/session')
          return Promise.resolve(new Response(null, { status: 204 }));
        if (input === '/_api/github/me')
          return Promise.resolve(Response.json({ error: 'not signed in' }, { status: 401 }));
        return Promise.resolve(keyRequired());
      },
      __TAURI_INTERNALS__: { metadata: { currentWebview: { label: 'p-1' } } },
      __TAURI__: { core: { invoke: () => Promise.resolve({ key: 'k'.repeat(64) }) } },
    };
    await installApiSession(win as unknown as Window);
    await (win.fetch as (u: string) => Promise<Response>)('/_api/github/me');
    const stream = new ReadableStream({ start: (c) => c.close() });
    await (win.fetch as (u: string, i: RequestInit) => Promise<Response>)('/_api/x', {
      method: 'POST',
      body: stream,
    });
    expect(urls).toEqual(['/_api/shell/session', '/_api/github/me', '/_api/x']);
  });
});
