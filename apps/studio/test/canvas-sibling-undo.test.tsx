// V2-1.2 §7 T4 / V2-2.8 S1 — a SIBLING canvas frame must not drive the active canvas.
//
// Every canvas iframe shares one `canvasOrigin`, and any frame reaches its siblings through
// `window.parent.frames`, so a background (synced, untrusted — DDR-054) canvas could post
// shell→canvas messages straight into the active one. The canvas side therefore honours the
// shell→canvas lanes below only from its own parent (`e.source === window.parent`), the gate
// V2-2.4 gave `run-action`.
//
// Behavioural, not a source grep: the real CanvasShell (and, for comment-mount's own `tool-set`
// listener, the real comment-mount provider tree) is mounted under happy-dom and real `message`
// events are dispatched at it. In happy-dom the top window is its own parent, so
// `source: window.parent` is the shell and any other object is a sibling frame.

import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasShell } from '../canvas-shell.tsx';
import { ToolProvider, useToolMode } from '../use-tool-mode.tsx';
import { UndoStackContext, UndoStackProvider } from '../use-undo-stack.tsx';

// The standalone shell opens its unrelated AI-notice socket and export list.
const NativeResponse = globalThis.Response;
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request, srv) {
    if (new URL(request.url).pathname === '/_ws' && srv.upgrade(request)) return;
    return NativeResponse.json({ entries: [], history: [], jobs: [], comments: [] });
  },
  websocket: { message() {} },
});
beforeAll(() => {
  GlobalRegistrator.register({ url: `${server.url}_canvas-shell.html?canvas=ui/Gate.tsx` });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
  server.stop(true);
});

const sibling = { name: 'sibling-canvas-frame' };
// The selection provider debounces its `select-set` post by 50 ms (use-selection-set.tsx).
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const send = async (source: unknown, data: unknown) => {
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));
    await settle();
  });
};

function ToolReader() {
  const { tool } = useToolMode();
  return <output data-testid="tool-probe" data-tool={tool} />;
}
const toolNow = () =>
  document.querySelector('[data-testid="tool-probe"]')?.getAttribute('data-tool') ?? null;

async function withShell(
  run: (messages: Array<Record<string, unknown>>) => Promise<void>,
  undo?: Record<string, unknown>
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const canvasRef = createRef<HTMLDivElement>();
  const messages: Array<Record<string, unknown>> = [];
  const post = spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    if (message && typeof message === 'object') messages.push(message as Record<string, unknown>);
  });
  try {
    await act(async () => {
      root.render(
        <ToolProvider initial="move">
          <UndoStackProvider>
            {undo ? (
              <UndoStackContext.Provider value={undo as never}>
                <ToolReader />
                <div ref={canvasRef}>
                  <CanvasShell hostRef={canvasRef}>
                    <div data-dc-screen="main">
                      <h1 data-cd-id="heading">Title</h1>
                      <p data-cd-id="body">Body</p>
                    </div>
                  </CanvasShell>
                </div>
              </UndoStackContext.Provider>
            ) : (
              <>
                <ToolReader />
                <div ref={canvasRef}>
                  <CanvasShell hostRef={canvasRef}>
                    <div data-dc-screen="main">
                      <h1 data-cd-id="heading">Title</h1>
                      <p data-cd-id="body">Body</p>
                    </div>
                  </CanvasShell>
                </div>
              </>
            )}
          </UndoStackProvider>
        </ToolProvider>
      );
    });
    await run(messages);
  } finally {
    await act(async () => root.unmount());
    post.mockRestore();
    host.remove();
  }
}

describe('canvas-shell honours shell→canvas lanes only from window.parent (V2-2.8 S1)', () => {
  test('select-by-id: a sibling selects nothing; the parent selects', async () => {
    await withShell(async (messages) => {
      const selects = () => messages.filter((m) => m.dgn === 'select-set' && m.selection).length;
      await send(sibling, { dgn: 'select-by-id', id: 'heading', artboardId: 'main', index: 0 });
      await send(null, { dgn: 'select-by-id', id: 'heading', artboardId: 'main', index: 0 });
      expect(selects()).toBe(0);
      await send(window.parent, {
        dgn: 'select-by-id',
        id: 'heading',
        artboardId: 'main',
        index: 0,
      });
      expect(selects()).toBe(1);
    });
  });

  test('locked-set: a sibling cannot replace the live locked-layer set; the parent can', async () => {
    await withShell(async () => {
      const locked = () => [
        ...((window as unknown as { __maudeLockedKeys?: Set<string> }).__maudeLockedKeys ?? []),
      ];
      await send(window.parent, { dgn: 'locked-set', locked: ['main:heading'] });
      expect(locked()).toEqual(['main:heading']);
      await send(sibling, { dgn: 'locked-set', locked: [] });
      await send(null, { dgn: 'locked-set', locked: ['main:body'] });
      expect(locked()).toEqual(['main:heading']);
      await send(window.parent, { dgn: 'locked-set', locked: ['main:body'] });
      expect(locked()).toEqual(['main:body']);
    });
  });

  test('tool-set: a sibling cannot arm a tool in the active canvas; the parent can', async () => {
    await withShell(async () => {
      expect(toolNow()).toBe('move');
      await send(sibling, { dgn: 'tool-set', tool: 'hand' });
      await send(null, { dgn: 'tool-set', tool: 'comment' });
      expect(toolNow()).toBe('move');
      await send(window.parent, { dgn: 'tool-set', tool: 'hand' });
      expect(toolNow()).toBe('hand');
    });
  });

  test('undo / redo: no sibling path reaches the active canvas undo stack', async () => {
    // A counting stand-in for the in-canvas stack (a real undo re-renders through a portal that
    // happy-dom rejects once an earlier test file in the same process has left its window behind).
    const calls: string[] = [];
    const stack = {
      push: () => Promise.resolve(),
      record: () => {},
      undo: async () => {
        calls.push('undo');
      },
      redo: async () => {
        calls.push('redo');
      },
      clear: () => {},
      canUndo: true,
      canRedo: true,
      lastLabel: null,
      lastTick: 0,
    };
    await withShell(async () => {
      // A sibling: the retired v1 lanes and the run-action lane reach nothing.
      await send(sibling, { dgn: 'undo' });
      await send(sibling, { dgn: 'redo' });
      await send(sibling, { dgn: 'run-action', v: 1, id: 'edit.undo' });
      await send(sibling, { dgn: 'run-action', v: 1, id: 'edit.redo' });
      await send(null, { dgn: 'run-action', v: 1, id: 'edit.undo' });
      // The retired lane from the parent: no handler is left for it either.
      await send(window.parent, { dgn: 'undo' });
      expect(calls).toEqual([]);
      // The shell itself, on the run-action lane: the stack undoes, then redoes.
      await send(window.parent, { dgn: 'run-action', v: 1, id: 'edit.undo' });
      await send(window.parent, { dgn: 'run-action', v: 1, id: 'edit.redo' });
      expect(calls).toEqual(['undo', 'redo']);
    }, stack);
  });
});

describe('comment-mount honours tool-set only from window.parent (V2-2.8 S1)', () => {
  test('a sibling cannot arm the comment tool on a bare specimen; the parent can', async () => {
    const { mountCanvas } = await import('../canvas-comment-mount.tsx');
    const rootEl = document.createElement('div');
    document.body.append(rootEl);
    const post = spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    try {
      await act(async () => {
        mountCanvas(() => <ToolReader />, {
          rootEl,
          file: '.design/ui/Specimen.tsx',
          commentsEnabled: true,
        });
        await settle();
      });
      expect(toolNow()).toBe('browse');
      await send(sibling, { dgn: 'tool-set', tool: 'comment' });
      await send(null, { dgn: 'tool-set', tool: 'comment' });
      expect(toolNow()).toBe('browse');
      await send(window.parent, { dgn: 'tool-set', tool: 'comment' });
      expect(toolNow()).toBe('comment');
    } finally {
      post.mockRestore();
      rootEl.remove();
    }
  });
});
