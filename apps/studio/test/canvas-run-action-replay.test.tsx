// V2-4.2 — the project menu's Select all / Copy properties / Paste properties have no canvas lane of
// their own: the canvas replays the action's chord and the key handler is the one implementation.
// Same gate as canvas-run-action-gate.test.tsx: only the shell (window.parent) can make the canvas
// press a key. Behavioural: the real CanvasShell is mounted (happy-dom + React).
import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { REPLAY_KEYS, replayActionKey } from '../canvas-replay-keys.ts';
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test('the replayed chords are exactly the canvas actions with only a key handler', () => {
  // + V2-4.5 mode.preview: ⌥⌘P with the shell focused — the canvas router asks for Preview / back.
  expect(Object.keys(REPLAY_KEYS).sort()).toEqual([
    'edit.copy-properties',
    'edit.paste-properties',
    'inspect.edit', // S3.11 — the Inspect panel's Edit button replays ↵
    'mode.preview',
    'select.all',
    'ui.step-back', // S3.14 — esc with the shell focused: the canvas climbs its own ladder first
  ]);
  expect(replayActionKey('object.remove')).toBe(false);
  expect(replayActionKey(undefined)).toBe(false);
  expect(replayActionKey('constructor')).toBe(false);
});

test('run-action select.all / copy-properties / paste-properties replay the chord, only from the parent', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const canvasRef = createRef<HTMLDivElement>();
  const post = spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  const pressed: string[] = [];
  const onKey = (e: KeyboardEvent) =>
    pressed.push(`${e.altKey ? '⌥' : ''}${e.metaKey ? '⌘' : ''}${e.key}`);
  document.addEventListener('keydown', onKey);
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
                <div data-dc-screen="main" />
              </CanvasShell>
            </div>
          </UndoStackProvider>
        </ToolProvider>
      );
    });
    const ids = ['select.all', 'edit.copy-properties', 'edit.paste-properties'];
    for (const id of ids) {
      await send(sibling, { dgn: 'run-action', v: 1, id });
      await send(null, { dgn: 'run-action', v: 1, id });
      await send(window.parent, { dgn: 'run-action', id }); // no version
    }
    expect(pressed).toEqual([]);
    for (const id of ids) await send(window.parent, { dgn: 'run-action', v: 1, id });
    expect(pressed).toEqual(['⌘a', '⌥⌘c', '⌥⌘v']);
    await send(window.parent, { dgn: 'run-action', v: 1, id: 'object.remove' });
    expect(pressed.length).toBe(3);
  } finally {
    document.removeEventListener('keydown', onKey);
    await act(async () => root.unmount());
    post.mockRestore();
    host.remove();
  }
});

// S3.14 (G7) - L in Present is the Pointer's. present/pointer-dot.tsx hears the shell's `tool.key` itself, so the
// canvas must NOT also replay the key: both toggled, the dot went on and straight off again (seen live, S3.13).
test('run-action tool.key L while presenting is not replayed (the Pointer already heard it); other keys still are', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const canvasRef = createRef<HTMLDivElement>();
  const post = spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  const pressed: string[] = [];
  const onKey = (e: KeyboardEvent) => pressed.push(e.key);
  document.addEventListener('keydown', onKey);
  const send = async (data: unknown) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }));
      await settle();
    });
  };
  const setMode = (seq: number, mode: string, present: unknown = null) =>
    send({
      dgn: 'set-mode',
      v: 2,
      seq,
      mode,
      present,
      caps: { edit: true, annotate: true, comment: true },
    });
  try {
    await act(async () => {
      root.render(
        <ToolProvider initial="move">
          <UndoStackProvider>
            <div ref={canvasRef}>
              <CanvasShell hostRef={canvasRef}>
                <div data-dc-screen="main" />
              </CanvasShell>
            </div>
          </UndoStackProvider>
        </ToolProvider>
      );
    });
    await setMode(100, 'preview');
    await send({ dgn: 'run-action', v: 1, id: 'tool.key', params: { key: 'L' } });
    expect(pressed).toEqual(['l']); // not presenting: replayed as ever
    pressed.length = 0;
    await setMode(101, 'present', { kind: 'canvas' });
    await send({ dgn: 'run-action', v: 1, id: 'tool.key', params: { key: 'L' } });
    expect(pressed).toEqual([]); // presenting: the Pointer's own listener has it
    await send({ dgn: 'run-action', v: 1, id: 'tool.key', params: { key: 'N' } });
    expect(pressed).toEqual(['n']);
  } finally {
    document.removeEventListener('keydown', onKey);
    await act(async () => root.unmount());
    post.mockRestore();
    host.remove();
  }
});
