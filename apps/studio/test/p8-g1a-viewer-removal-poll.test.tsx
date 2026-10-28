// P8 G1a item 4 (decision maude/v2-p8-g1a-commenter-door-and-viewer-removal-poll) — a Can view window holds no
// hub socket (the hub's document door refuses Can view sessions), so the hub's `access ended` notice never
// reaches it and Lukáš's card never showed for a removed Can view person. The window asks itself: about every
// 60 s and on focus it GETs `/_api/share/me` (the studio relays the hub's `/api/access/me` with this Mac's
// credential). The hub's refusal of THAT credential with `access-withdrawn` / `expired` / `link-off` is the same
// signal the editing case shows: the access card. A plain 401 (sign in again), a 403, an unlinked project or an
// unreachable hub change nothing, and a person who can comment or edit (who has a hub socket) never polls.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { VIEWER_ACCESS_POLL, viewerPolls } from '../client/v2/access/access-client.js';
import { AccessHost } from '../client/v2/access/access-host.jsx';

beforeAll(() => {
  if (typeof globalThis.document === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)));
};

describe('viewerPolls (pure)', () => {
  test('only a Can view window that shows no card polls', () => {
    expect(viewerPolls('observer', { ended: null, linkOff: false })).toBe(true);
    expect(viewerPolls('viewer', { ended: null, linkOff: false })).toBe(false);
    expect(viewerPolls('member', { ended: null, linkOff: false })).toBe(false);
    expect(viewerPolls(undefined, { ended: null, linkOff: false })).toBe(false);
    expect(viewerPolls('observer', { ended: 'removed', linkOff: false })).toBe(false);
    expect(viewerPolls('observer', { ended: null, linkOff: true })).toBe(false);
  });
  test('the cadence is the lead decision: GET /_api/share/me about every 60 s', () => {
    expect(VIEWER_ACCESS_POLL.path).toBe('/_api/share/me');
    expect(VIEWER_ACCESS_POLL.ms).toBe(60_000);
  });
});

describe('a Can view desktop window learns it was removed', () => {
  let asked: string[] = [];
  let meAnswer: { status: number; body: unknown } = { status: 200, body: { role: 'observer' } };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  function mount(role: string | undefined) {
    // a desktop shell: the plain-browser refusal watch is off, so only the poll can end the window
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    asked = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
      asked.push(url);
      if (url.startsWith('/_api/share/me'))
        return new Response(JSON.stringify(meAnswer.body), {
          status: meAnswer.status,
          headers: { 'content-type': 'application/json' },
        });
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    act(() =>
      root.render(
        createElement(AccessHost, {
          activePath: '.design/ui/Smoke.tsx',
          designRel: '.design',
          tabs: [{ path: '.design/ui/Smoke.tsx' }],
          project: 'Share Roles',
          canEdit: false,
          role,
          toast: () => {},
          run: () => {},
          onOpenTab: () => {},
        })
      )
    );
    return {
      el,
      card: () => el.querySelector('[data-testid="access-ended"]'),
      meCalls: () => asked.filter((u) => u.startsWith('/_api/share/me')).length,
      unmount: () => {
        act(() => root.unmount());
        el.remove();
      },
    };
  }
  const focus = () => act(() => void window.dispatchEvent(new Event('focus')));

  test('removed: on focus the refusal of its credential is the access card', async () => {
    meAnswer = { status: 401, body: { error: 'Your access…', reason: 'access-withdrawn' } };
    const h = mount('observer');
    await flush();
    focus();
    await flush();
    expect(h.meCalls()).toBeGreaterThan(0);
    expect(h.card()).not.toBeNull();
    expect(h.card()?.textContent).toContain('You no longer have access to Share Roles.');
    // the card stays; the window stops asking
    const n = h.meCalls();
    focus();
    await flush();
    expect(h.meCalls()).toBe(n);
    h.unmount();
  });

  test('still Can view, a plain 401, a 403, unlinked or unreachable: no card', async () => {
    for (const a of [
      { status: 200, body: { role: 'observer', grants: [] } },
      { status: 401, body: { error: 'Sign in to see who has access.', reason: 'unauthorized' } },
      { status: 403, body: { reason: 'access-withdrawn' } },
      { status: 409, body: { reason: 'not-linked' } },
      { status: 503, body: { reason: 'unreachable' } },
    ]) {
      meAnswer = a;
      const h = mount('observer');
      await flush();
      focus();
      await flush();
      expect(h.meCalls()).toBeGreaterThan(0);
      expect(h.card()).toBeNull();
      h.unmount();
    }
  });

  test('Can comment / Can edit hold a hub socket: they never poll', async () => {
    meAnswer = { status: 401, body: { reason: 'access-withdrawn' } };
    for (const role of ['viewer', 'member', 'owner']) {
      const h = mount(role);
      await flush();
      focus();
      await flush();
      expect(h.meCalls()).toBe(0);
      expect(h.card()).toBeNull();
      h.unmount();
    }
  });
});
