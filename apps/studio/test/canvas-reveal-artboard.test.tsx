// A6c (S1.3 L1 / S1.15) — the canvas's `reveal-artboard { artboardId, glide, flash }` handler. The jump
// list (S1.3) and Compare (S1.15) take the camera to one artboard and flash it; honoured only from the
// canvas's own parent (`e.source === window.parent`, V2-2.8 S1's class): a sibling canvas frame (DDR-054
// untrusted) must not move this camera or flash its boards. Behavioural: the real CanvasShell is mounted
// and real `message` events are dispatched; `flash` is the observable (the class on the artboard).

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasShell } from '../canvas-shell.tsx';
import { ToolProvider } from '../use-tool-mode.tsx';
import { UndoStackProvider } from '../use-undo-stack.tsx';

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
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test('reveal-artboard flashes the board only when the parent sends it', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const canvasRef = createRef<HTMLDivElement>();
  const send = async (source: unknown, data: unknown) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));
      await settle();
    });
  };
  try {
    await act(async () => {
      root.render(
        <ToolProvider initial="move">
          <UndoStackProvider>
            <div ref={canvasRef}>
              <CanvasShell hostRef={canvasRef}>
                <div data-dc-screen="p1">
                  <h1 data-cd-id="heading">Title</h1>
                </div>
                <div data-dc-screen="p2" />
              </CanvasShell>
            </div>
          </UndoStackProvider>
        </ToolProvider>
      );
    });
    const board = (id: string) => document.querySelector(`[data-dc-screen="${id}"]`) as HTMLElement;
    const flashed = (id: string) => board(id).classList.contains('dc-reveal-flash');
    const msg = (artboardId: unknown, flash = true) => ({
      dgn: 'reveal-artboard',
      artboardId,
      glide: true,
      flash,
    });

    // A sibling frame, a dropped source, an unknown id, a malformed id: nothing flashes.
    await send(sibling, msg('p1'));
    await send(null, msg('p1'));
    await send(window.parent, msg('nope'));
    await send(window.parent, msg(42));
    expect([flashed('p1'), flashed('p2')]).toEqual([false, false]);

    // The shell itself: that board, and only that board.
    await send(window.parent, msg('p2'));
    expect([flashed('p1'), flashed('p2')]).toEqual([false, true]);

    // flash: false moves the camera without the flash.
    await send(window.parent, msg('p1', false));
    expect(flashed('p1')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
