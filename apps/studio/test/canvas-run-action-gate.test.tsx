// V2-1.3 §5.7 / V2-2.4 step 6 — the shell → canvas `run-action` lane is honoured only from the
// canvas's own parent (`e.source === window.parent`, V2-2.8 S1's class). v1's `undo` / `redo` /
// `zoom` / `selection-clear` lanes had no source check, so a sibling canvas (any frame reachable
// through `parent.frames`, DDR-054 untrusted) could undo, move or deselect the active one. The
// swap to `run-action` retires those lanes (rule 13) and gates the new one.
//
// Behavioural, not a source grep: the real CanvasShell is mounted (happy-dom + React) and real
// `message` events are dispatched at it. `select.none` is the observable action — clearing the
// selection posts `{dgn:'select-set', selection:null}` to the parent. In happy-dom the top window
// is its own parent, so `source: window.parent` is the shell and any other object is a sibling.

import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasShell } from '../canvas-shell.tsx';
import { ToolProvider } from '../use-tool-mode.tsx';
import { UndoStackProvider } from '../use-undo-stack.tsx';

// The standalone shell opens its unrelated AI-notice socket and export list.
const NativeResponse = globalThis.Response;
const notifications = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request, server) {
    if (new URL(request.url).pathname === '/_ws' && server.upgrade(request)) return;
    return NativeResponse.json({ entries: [], history: [], jobs: [] });
  },
  websocket: { message() {} },
});
beforeAll(() => {
  GlobalRegistrator.register({ url: `${notifications.url}_canvas-shell.html?canvas=ui/Gate.tsx` });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
  notifications.stop(true);
});

const sibling = { name: 'sibling-canvas-frame' };
// The selection provider debounces its `select-set` post by 50 ms (use-selection-set.tsx).
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test('run-action select.none clears only when the parent sends it (v1, from window.parent)', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const canvasRef = createRef<HTMLDivElement>();
  const messages: Array<Record<string, unknown>> = [];
  const post = spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    if (message && typeof message === 'object') messages.push(message as Record<string, unknown>);
  });
  const send = async (source: unknown, data: unknown) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));
      await settle();
    });
  };
  const clears = () =>
    messages.filter((m) => m.dgn === 'select-set' && m.selection === null).length;
  try {
    await act(async () => {
      root.render(
        <ToolProvider initial="move">
          <UndoStackProvider>
            <div ref={canvasRef}>
              <CanvasShell hostRef={canvasRef}>
                <div data-dc-screen="main">
                  <h1 data-cd-id="heading">Title</h1>
                </div>
              </CanvasShell>
            </div>
          </UndoStackProvider>
        </ToolProvider>
      );
    });
    const selectHeading = () =>
      send(window.parent, { dgn: 'select-by-id', id: 'heading', artboardId: 'main', index: 0 });
    await selectHeading();
    expect(messages.some((m) => m.dgn === 'select-set' && m.selection)).toBe(true);
    const before = clears();

    // A sibling canvas frame, a discarded (null) source, a malformed and a retired lane: nothing.
    await send(sibling, { dgn: 'run-action', v: 1, id: 'select.none' });
    await send(null, { dgn: 'run-action', v: 1, id: 'select.none' });
    await send(window.parent, { dgn: 'run-action', id: 'select.none' });
    await send(window.parent, { dgn: 'selection-clear' });
    expect(clears()).toBe(before);

    // The shell itself: the selection clears.
    await send(window.parent, { dgn: 'run-action', v: 1, id: 'select.none' });
    expect(clears()).toBe(before + 1);
  } finally {
    await act(async () => root.unmount());
    post.mockRestore();
    host.remove();
  }
});
