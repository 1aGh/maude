// S9.22b — the shell half of the overlay's comment bridge (`comment-op`, `comment-people-request`).
//
// Every canvas iframe shares one canvas origin (DDR-054), so the origin check proves only "a canvas said
// this". A BACKGROUND canvas (synced, untrusted) must not be able to write comments as the session through
// `POST /_api/comments/op`, nor read who can open the canvas; a discarded source with no canvas open must
// not pass as `null === null`; and a payload the dgn table's parser refuses is dropped before any fetch.
//
// Same harness as shell-sibling-gates.test.tsx: the real useCanvasBridge hook, real `message` events.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const CANVAS_ORIGIN = 'http://canvas.test';
const ACTIVE = '.design/ui/Active.tsx';
const BACKGROUND = '.design/ui/Background.tsx';

const replies: Array<{ to: string; msg: Record<string, unknown> }> = [];
const frameWin = (name: string) => ({
  name,
  postMessage: (msg: Record<string, unknown>) => replies.push({ to: name, msg }),
});
const activeWin = frameWin('active-frame');
const backgroundWin = frameWin('background-frame');

const fetches: Array<{ url: string; body: unknown }> = [];
const NativeFetch = globalThis.fetch;

function bridgeProps(overrides: Record<string, unknown>) {
  const values: Record<string, unknown> = {
    selected: null,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN, designRel: '.design' },
    viewerMode: false,
    commentsByFile: {},
    focusedCommentId: null,
    theme: 'light',
    canvasActiveArtboard: null,
    minimapVisible: false,
    zoomCtlVisible: false,
    presentMode: false,
    gitUser: 'Tereza',
    iframesRef: {
      current: new Map([
        [ACTIVE, { contentWindow: activeWin }],
        [BACKGROUND, { contentWindow: backgroundWin }],
      ]),
    },
    ...overrides,
  };
  const cache = new Map<string, unknown>();
  return new Proxy(values, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      if (!cache.has(key)) cache.set(key, key.endsWith('Ref') ? { current: null } : () => {});
      return cache.get(key);
    },
  });
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  replies.length = 0;
  fetches.length = 0;
  globalThis.fetch = NativeFetch;
});

async function mount(activePath: string | null) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    fetches.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).startsWith('/_api/comments/op'))
      return new Response(JSON.stringify({ comment: { id: 'c_1' } }), { status: 200 });
    return new Response(
      JSON.stringify({
        people: [
          { id: 'u1', name: 'Jonas', role: 'member', email: 'jonas@example.com' },
          { id: 'u2', name: 'Tereza', role: 'owner' },
        ],
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(bridgeProps({ activePath }) as never);
    return null;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Harness />));
}

function post(source: unknown, data: unknown, origin = CANVAS_ORIGIN) {
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: data },
    origin: { value: origin },
    source: { value: source },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
}
const settle = () => new Promise((r) => setTimeout(r, 30));

const OP = {
  dgn: 'comment-op',
  reqId: 'cm1',
  op: { op: 'add', file: '.design/ui/Background.tsx', text: 'hi' },
};

describe('comment-op (S9.22b)', () => {
  test('a background frame and a discarded source write nothing and hear nothing', async () => {
    await mount(ACTIVE);
    post(backgroundWin, OP);
    post(null, OP);
    await settle();
    expect(fetches).toEqual([]);
    expect(replies).toEqual([]);
  });

  test('the active frame is acked, the door is asked, the add is pinned to the open canvas', async () => {
    await mount(ACTIVE);
    post(activeWin, OP);
    await settle();
    expect(fetches.map((f) => f.url)).toEqual(['/_api/comments/op']);
    expect((fetches[0].body as { file: string }).file).toBe(ACTIVE);
    expect(replies.map((r) => r.to)).toEqual(['active-frame', 'active-frame']);
    expect(replies.map((r) => r.msg.dgn)).toEqual(['comment-op-ack', 'comment-op-result']);
    expect(replies[1].msg.ok).toBe(true);
  });

  test('no canvas open: a discarded source cannot pass as the active frame', async () => {
    await mount(null);
    post(null, OP);
    await settle();
    expect(fetches).toEqual([]);
    expect(replies).toEqual([]);
  });

  test('a payload the dgn table refuses is dropped before any ack or fetch', async () => {
    await mount(ACTIVE);
    post(activeWin, { dgn: 'comment-op', reqId: 'cm2', op: { op: 'drop-everything' } });
    post(activeWin, { dgn: 'comment-op', reqId: 'cm3', op: 'resolve' });
    post(activeWin, { dgn: 'comment-op', reqId: 'x'.repeat(65), op: { op: 'resolve', id: 'c1' } });
    await settle();
    expect(fetches).toEqual([]);
    expect(replies).toEqual([]);
  });

  test('a foreign origin is ignored even from the active window', async () => {
    await mount(ACTIVE);
    post(activeWin, OP, 'http://evil.example');
    await settle();
    expect(fetches).toEqual([]);
  });
});

describe('comment-people-request (S9.22b)', () => {
  test('only the active frame hears the people, as names and role words without addresses', async () => {
    await mount(ACTIVE);
    post(backgroundWin, { dgn: 'comment-people-request', reqId: 'cm9' });
    await settle();
    expect(replies).toEqual([]);
    post(activeWin, { dgn: 'comment-people-request', reqId: 'cm9' });
    await settle();
    expect(replies.map((r) => r.to)).toEqual(['active-frame']);
    expect(replies[0].msg).toEqual({
      dgn: 'comment-people',
      reqId: 'cm9',
      people: [{ id: 'u1', name: 'Jonas', role: 'Can edit' }],
    });
    expect(JSON.stringify(replies)).not.toContain('example.com');
  });
});
