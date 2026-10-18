// S2.20b — canvas-focus ⌘Z on a project on the op log goes through the SHELL (V2-1.5 §5.4, V2-1.2
// feed): the parent-gated `undo-mode {opLog: true}` turns the canvas's ⌘Z / ⇧⌘Z — its own keys and
// the shell's `run-action edit.undo` — into `undo-key {redo}` posts to the shell, and the iframe keeps
// no durable stack (no record, nothing in sessionStorage, no positional edit-op record). A legacy
// project (the shell never says op-log) keeps the DDR-050 canvas stack.
//
// Behavioural: the real CanvasShell inside the real UndoStackProvider (happy-dom + React); real
// `message` / `keydown` events. In happy-dom the top window is its own parent, so `source:
// window.parent` is the shell and any other object a sibling canvas.

import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasShell } from '../canvas-shell.tsx';
import { editOpRecord } from '../editing/edit-op.ts';
import { ToolProvider } from '../use-tool-mode.tsx';
import { UndoStackProvider, type UndoStackValue, useUndoStack } from '../use-undo-stack.tsx';

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
  GlobalRegistrator.register({ url: `${notifications.url}_canvas-shell.html?canvas=ui/Undo.tsx` });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
  notifications.stop(true);
});

const FILE = '.design/ui/Undo.tsx';
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const sibling = { name: 'sibling-canvas-frame' };

test('op-log mode: canvas ⌘Z / ⇧⌘Z go to the shell; the iframe keeps no stack', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const canvasRef = createRef<HTMLDivElement>();
  const messages: Array<Record<string, unknown>> = [];
  const post = spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    if (message && typeof message === 'object') messages.push(message as Record<string, unknown>);
  });
  let stack: UndoStackValue | null = null;
  const Probe = () => {
    const s = useUndoStack();
    useEffect(() => {
      stack = s;
    });
    return null;
  };
  const send = async (source: unknown, data: unknown) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));
      await settle();
    });
  };
  const keyZ = async (shift: boolean) => {
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: shift ? 'Z' : 'z',
          code: 'KeyZ',
          metaKey: true,
          shiftKey: shift,
          bubbles: true,
        })
      );
      await settle();
    });
  };
  const keys = () =>
    messages.filter((m) => m.dgn === 'undo-key').map((m) => (m.redo ? 'redo' : 'undo'));
  const stored = () =>
    Object.keys(sessionStorage).filter((k) => k.startsWith('maude-undo:') && k.includes('Undo'));
  const rec = { kind: 'test-noop', label: 'Nudge', payload: {} };
  try {
    await act(async () => {
      root.render(
        <ToolProvider initial="move">
          <UndoStackProvider canvasFile={FILE}>
            <Probe />
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

    // Legacy (the shell never spoke): the canvas stack takes records, persists, and ⌘Z stays here.
    await act(async () => {
      stack?.record(rec);
      await settle();
    });
    expect(stack?.canUndo).toBe(true);
    expect(stored().length).toBe(1);
    expect(editOpRecord('w_1', 'Frame')).not.toBeNull();
    await send(window.parent, { dgn: 'run-action', v: 1, id: 'edit.undo' });
    await keyZ(false);
    expect(keys()).toEqual([]);

    // A sibling canvas cannot switch it (parent-gated).
    await send(sibling, { dgn: 'undo-mode', opLog: true });
    await keyZ(false);
    expect(keys()).toEqual([]);

    // The shell says op-log.
    await send(window.parent, { dgn: 'undo-mode', opLog: true });
    expect(stack?.canUndo).toBe(false);
    expect(stored()).toEqual([]);

    await keyZ(false);
    await keyZ(true);
    await send(window.parent, { dgn: 'run-action', v: 1, id: 'edit.undo' });
    await send(window.parent, { dgn: 'run-action', v: 1, id: 'edit.redo' });
    expect(keys()).toEqual(['undo', 'redo', 'undo', 'redo']);

    // No durable stack: a record is dropped, nothing is written to sessionStorage, and an edit-op
    // leaves no positional record.
    await act(async () => {
      stack?.record(rec);
      await settle();
    });
    expect(stack?.canUndo).toBe(false);
    expect(stored()).toEqual([]);
    expect(editOpRecord('w_2', 'Frame')).toBeNull();

    // Back to legacy (the shell's fallback path tells the frame first): the canvas stack answers again.
    await send(window.parent, { dgn: 'undo-mode', opLog: false });
    const before = keys().length;
    await keyZ(false);
    expect(keys().length).toBe(before);
  } finally {
    post.mockRestore();
    await act(async () => root.unmount());
    host.remove();
  }
});
