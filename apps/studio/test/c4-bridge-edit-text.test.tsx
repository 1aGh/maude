// gate-b-c4 — the canvas→shell half (C4b): a message from the active frame acts on the canvas that
// frame was opened for, never on a file the message names. `edit-text` used to forward the frame's
// own `file` to the main-origin `/_api/edit-text`, so canvas code in A (planted by an A-only editor)
// could rewrite B's source with the rights of whoever had A open. Same harness as
// canvas-bridge-gate-b.test.tsx: the real useCanvasBridge hook, real `message` events.

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
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
const OTHER = '.design/ui/canary-b.tsx';
const activeWin = { name: 'active-frame', postMessage: () => {} };

const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
const realFetch = globalThis.fetch;

function bridgeProps(activePath: string) {
  const values: Record<string, unknown> = {
    activePath,
    selected: null,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN, designRel: '.design' },
    viewerMode: false,
    commentsByFile: { [ACTIVE]: [{ id: 'c_own' }] },
    presentMode: false,
    gitUser: 'Tereza',
    iframesRef: { current: new Map([[ACTIVE, { contentWindow: activeWin }]]) },
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
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  sent.length = 0;
  globalThis.fetch = realFetch;
});

test("an active frame's edit-text naming another canvas edits only the frame's own canvas", async () => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(bridgeProps(ACTIVE) as never);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Harness />));
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: { dgn: 'edit-text', id: 'el-1', text: 'pwned', file: OTHER } },
    origin: { value: CANVAS_ORIGIN },
    source: { value: activeWin },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
  await Bun.sleep(10);
  const edits = sent.filter((s) => s.url.includes('/_api/edit-text'));
  // the edit went through — to the frame's own canvas (not vacuous: one write, at ACTIVE)
  expect(edits.map((e) => e.body.canvas)).toEqual([ACTIVE]);
  host.remove();
});

async function mountAndSend(data: Record<string, unknown>) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(bridgeProps(ACTIVE) as never);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Harness />));
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: data },
    origin: { value: CANVAS_ORIGIN },
    source: { value: activeWin },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
  await Bun.sleep(10);
  host.remove();
}

test("an active frame's apply-edit (undo/redo) naming another canvas re-applies only to its own", async () => {
  for (const op of ['css', 'attr', 'text'] as const) {
    sent.length = 0;
    await mountAndSend({
      dgn: 'apply-edit',
      op,
      id: 'el-1',
      key: op === 'css' ? 'color' : op === 'attr' ? 'alt' : undefined,
      value: 'pwned',
      canvas: OTHER,
    });
    const edits = sent.filter((s) => s.url.includes('/_api/edit-'));
    expect({ op, canvases: edits.map((e) => e.body.canvas) }).toEqual({ op, canvases: [ACTIVE] });
    act(() => root?.unmount());
    root = null;
  }
});

test("an active frame's comment-op naming a thread of another canvas is not sent", async () => {
  await mountAndSend({ dgn: 'comment-op', reqId: 'r1', op: { op: 'resolve', id: 'c_on_b' } });
  expect(sent.filter((s) => s.url.includes('/_api/comments/op'))).toEqual([]);
  act(() => root?.unmount());
  root = null;
  // not vacuous: the same op on one of the active canvas's own threads goes through
  await mountAndSend({ dgn: 'comment-op', reqId: 'r2', op: { op: 'resolve', id: 'c_own' } });
  expect(sent.filter((s) => s.url.includes('/_api/comments/op')).map((s) => s.body)).toEqual([
    { op: 'resolve', id: 'c_own' },
  ]);
});
