// S9.21d — the browser shell learns "link turned off" from a refused answer (decision
// v2-lead-browser-link-off-via-refusal; 10 co-access-ends · co-browser-view).
//
// Access notices reach desktop shells only (S9.21b). In a plain browser on a cell the next request after the
// link went off is refused at the cell's door: 401 with reason `link-off` (or `access-withdrawn`). The shell
// watches its own same-origin answers and maps them through `accessOutcome()`:
//   · 401 link-off → the link card; 401 access-withdrawn / expired → the access card;
//   · a 401 with no reason, any 403 and a `not-in-scope` / 404 change nothing (no oracle, no false card);
//   · another origin's answers are never read; the response reaches its caller untouched;
//   · a desktop shell (window.__TAURI__) installs no watch — its S9.21b notice path is unchanged.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { doorRefusal, REFUSAL_PROBE, watchRefusals } from '../client/v2/access/access-client.js';
import { AccessHost, accessHostRefusal } from '../client/v2/access/access-host.jsx';

beforeAll(() => {
  if (typeof globalThis.document === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('what a refused answer means for the browser window', () => {
  test('only a door 401 with a known reason ends the window', () => {
    expect(doorRefusal(401, { reason: 'link-off' })).toEqual({ kind: 'link-off' });
    expect(doorRefusal(401, { reason: 'access-withdrawn' })).toEqual({
      kind: 'ended',
      reason: 'removed',
    });
    expect(doorRefusal(401, { reason: 'expired' })).toEqual({ kind: 'ended', reason: 'expired' });
    expect(doorRefusal(401, { error: 'sign in to open this project' })).toBeNull();
    expect(doorRefusal(401, null)).toBeNull();
    // A 403 is a role answer (read-only, not-in-scope), never the end of access.
    expect(doorRefusal(403, { reason: 'link-off' })).toBeNull();
    expect(doorRefusal(403, { reason: 'not-in-scope' })).toBeNull();
    expect(doorRefusal(404, { reason: 'not-in-scope' })).toBeNull();
    expect(doorRefusal(401, { reason: 'not-in-scope' })).toBeNull();
  });

  test('the host state: link-off is the link card, ended the access card', () => {
    const s0 = { ended: null, linkOff: false };
    expect(accessHostRefusal(s0, { kind: 'link-off' })).toEqual({ ended: null, linkOff: true });
    expect(accessHostRefusal(s0, { kind: 'ended', reason: 'removed' })).toEqual({
      ended: 'removed',
      linkOff: false,
    });
    expect(accessHostRefusal(s0, null)).toBe(s0);
    expect(accessHostRefusal(s0, { kind: 'missing' })).toBe(s0);
  });
});

describe('the watch over the window’s own answers', () => {
  function fakeWin(answer: (url: string) => Response) {
    const calls: string[] = [];
    const base = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
      calls.push(url);
      return answer(url);
    };
    return { win: { fetch: base, location: { origin: 'https://acme.maude.cloud' } }, base, calls };
  }

  test('a same-origin 401 link-off is heard; the caller still reads the body', async () => {
    const { win, base } = fakeWin(() => json(401, { error: 'x', reason: 'link-off' }));
    const heard: unknown[] = [];
    const stop = watchRefusals(win, (o) => heard.push(o));
    expect(win.fetch).not.toBe(base);
    const r = await win.fetch('/_api/canvas?x=1');
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'x', reason: 'link-off' });
    await flush();
    expect(heard).toEqual([{ kind: 'link-off' }]);
    await win.fetch('https://acme.maude.cloud/_config');
    await flush();
    expect(heard.length).toBe(2);
    stop();
    expect(win.fetch).toBe(base);
  });

  test('another origin, a 200, a reasonless 401 and a 403 are never acted on', async () => {
    let next = json(401, { reason: 'link-off' });
    const { win } = fakeWin(() => next);
    const heard: unknown[] = [];
    const stop = watchRefusals(win, (o) => heard.push(o));
    await win.fetch('https://cloud.maude.sh/api/me');
    next = json(200, { reason: 'link-off' });
    await win.fetch('/_api/x');
    next = json(401, { error: 'sign in to open this project' });
    await win.fetch('/_api/x');
    next = json(403, { reason: 'not-in-scope' });
    await win.fetch('/_api/x');
    next = new Response('<html>', { status: 401, headers: { 'content-type': 'text/html' } });
    await win.fetch('/_api/x');
    await flush();
    expect(heard).toEqual([]);
    stop();
  });

  test('installs once; a second watch is a no-op', () => {
    const { win, base } = fakeWin(() => json(200, {}));
    const stop = watchRefusals(win, () => {});
    const wrapped = win.fetch;
    const stop2 = watchRefusals(win, () => {});
    expect(win.fetch).toBe(wrapped);
    stop2();
    expect(win.fetch).toBe(wrapped);
    stop();
    expect(win.fetch).toBe(base);
  });
});

describe('the host, in a browser and in the desktop shell', () => {
  const realFetch = globalThis.fetch;
  let refuse: Response | null = null;
  let asked: string[] = [];
  afterEach(() => {
    globalThis.fetch = realFetch;
    refuse = null;
    asked = [];
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });
  function mount() {
    globalThis.fetch = (async (url: string) =>
      asked.push(String(url)) && refuse && String(url) !== '/_api/trash'
        ? refuse
        : json(
            200,
            String(url) === '/_api/trash' ? { legacy: true } : { entries: [] }
          )) as unknown as typeof fetch;
    const stub = globalThis.fetch;
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    act(() => {
      root.render(
        createElement(AccessHost, {
          activePath: '.design/ui/Combine-kampan.tsx',
          designRel: '.design',
          tabs: [],
          project: 'Alligators brand',
          canEdit: false,
          toast: () => {},
          run: () => {},
          onOpenTab: () => {},
        })
      );
    });
    return {
      el,
      stub,
      unmount: () => {
        act(() => root.unmount());
        el.remove();
      },
    };
  }

  test('a browser: the next refused answer shows "This link was turned off."', async () => {
    const h = mount();
    expect(window.fetch).not.toBe(h.stub);
    refuse = json(401, { error: 'sign in to open this project', reason: 'link-off' });
    await act(async () => {
      await window.fetch('/_api/canvas');
      await flush();
    });
    const card = h.el.querySelector('[data-testid="access-link-off"]');
    expect(card?.textContent ?? '').toContain('This link was turned off.');
    h.unmount();
    expect(window.fetch).toBe(h.stub);
  });

  test('a browser: access-withdrawn shows the access card', async () => {
    const h = mount();
    refuse = json(401, { reason: 'access-withdrawn' });
    await act(async () => {
      await window.fetch('/_api/canvas');
      await flush();
    });
    expect(h.el.querySelector('[data-testid="access-ended-home"]')).not.toBeNull();
    expect(h.el.querySelector('[data-testid="access-link-off"]')).toBeNull();
    h.unmount();
  });

  test('the desktop shell installs no watch (S9.21b notices stay its path)', () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: {} };
    const h = mount();
    expect(window.fetch).toBe(h.stub);
    asked = [];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(asked).not.toContain(REFUSAL_PROBE.path);
    h.unmount();
  });
});

describe('a quiet browser tab still asks', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  test('focus probes the door once; after the card, no more probes', async () => {
    const asked: string[] = [];
    let refuse = false;
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      return refuse && String(url) === REFUSAL_PROBE.path
        ? json(401, { reason: 'link-off' })
        : json(200, String(url) === '/_api/trash' ? { legacy: true } : {});
    }) as unknown as typeof fetch;
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    act(() => {
      root.render(
        createElement(AccessHost, {
          activePath: '.design/ui/Combine-kampan.tsx',
          designRel: '.design',
          tabs: [],
          project: 'Alligators brand',
          canEdit: false,
          toast: () => {},
          run: () => {},
          onOpenTab: () => {},
        })
      );
    });
    expect(REFUSAL_PROBE.path).toBe('/_health');
    expect(REFUSAL_PROBE.ms).toBeGreaterThanOrEqual(15_000);
    refuse = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await flush();
      await flush();
    });
    expect(asked.filter((u) => u === REFUSAL_PROBE.path).length).toBe(1);
    expect(el.querySelector('[data-testid="access-link-off"]')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await flush();
    });
    expect(asked.filter((u) => u === REFUSAL_PROBE.path).length).toBe(1);
    act(() => root.unmount());
    el.remove();
  });
});
