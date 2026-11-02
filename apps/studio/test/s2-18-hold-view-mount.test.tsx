// S2.18 (14 Editing · ed-edge-tereza) — "Tereza first, you second": Tereza already holds the object when you
// select it. The canvas reports that hold as ONE `hold-view` (it dedupes on the view), and the inspector frame
// mounts with the very selection that produced it — so the message lands before the frame exists. The wave-B
// gate saw the owner's inspector stay fully editable while Tereza edited the same frame. The frame must still
// open in view mode, and a hold-view from a canvas that is not the active one must still read as nothing.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';

let useHoldView: (o: { canvasOrigin?: string; rootRef: { current: unknown } }) => unknown;

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://127.0.0.1:4399/' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // after the DOM exists: the module keeps the newest hold-view from load, as the shell's boot import does
  ({ useHoldView } = await import('../client/v2/inspector/view-mode.jsx'));
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function canvasFrame(testid = 'canvas-frame'): Window {
  const f = document.createElement('iframe');
  f.setAttribute('data-testid', testid);
  document.body.appendChild(f);
  return f.contentWindow as unknown as Window;
}

function postHoldView(source: Window, person: { name: string } | null) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { dgn: 'hold-view', person, label: 'div', ai: null },
      origin: window.location.origin,
      source: source as unknown as MessageEventSource,
    })
  );
}

/** Mount the inspector's hook AFTER the message, as the frame does; return what it read. */
async function mountAndRead(): Promise<{ read: () => unknown; unmount: () => void }> {
  let seen: unknown = 'unset';
  function Probe() {
    const rootRef = useRef(null);
    seen = useHoldView({ canvasOrigin: window.location.origin, rootRef });
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Probe));
  });
  return {
    read: () => seen,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('S2.18 — a hold that was there before the inspector opened', () => {
  test('the frame mounts after the canvas reported Tereza: view mode, her name', async () => {
    const active = canvasFrame();
    postHoldView(active, { name: 'tereza' });
    const m = await mountAndRead();
    expect(m.read()).toEqual({ person: { name: 'tereza' }, label: 'div', ai: null });
    // she moves on: the canvas reports nothing held, the fields open
    await act(async () => postHoldView(active, null));
    expect(m.read()).toBeNull();
    m.unmount();
    document.querySelector('[data-testid="canvas-frame"]')?.remove();
  });

  test('a kept hold-view from a canvas that is not the active one reads as nothing', async () => {
    const stale = canvasFrame('not-the-canvas');
    canvasFrame();
    postHoldView(stale, { name: 'tereza' });
    const m = await mountAndRead();
    expect(m.read()).toBeNull();
    m.unmount();
  });
});
