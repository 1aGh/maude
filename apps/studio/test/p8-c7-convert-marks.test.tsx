// V2-8.5 c7 (08 ak-convert-after) — the two marks after "Make A6 print": "✓ Unchanged" under the post, "+ 13 % height ·
// Ink fill" on the copy. The shell sends `convert-marks` (dgn-protocol.ts); the canvas honours it from its parent only
// and paints words it builds itself; the marks carry `.dc-artboard-guides` (exporters hide them).

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArtboardConvertMarks,
  extraHeightPx,
  extraWords,
  getConvertMarks,
  setConvertMarks,
  UNCHANGED_WORDS,
} from '../artboard-convert-marks.tsx';
import { CanvasShell } from '../canvas-shell.tsx';
import { convertMarksMessage } from '../client/v2/kinds/convert-api.js';
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
  setConvertMarks(null);
  await GlobalRegistrator.unregister();
  notifications.stop(true);
});
afterEach(() => setConvertMarks(null));

const sibling = { name: 'sibling-canvas-frame' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test('the words: "✓ Unchanged" and "+ 13 % height · Ink fill" (no fill name, no fill words)', () => {
  expect(UNCHANGED_WORDS).toBe('✓ Unchanged');
  expect(extraWords(13, 'Ink')).toBe('+ 13 % height · Ink fill');
  expect(extraWords(13.4, null)).toBe('+ 13 % height');
  // 13 % of the scaled design is background: of a 232 px copy that is 205 px design + 27 px fill
  expect(extraHeightPx(232, 13)).toBe(27);
  expect(extraHeightPx(232, 0)).toBe(0);
});

test('the shell builds the message from the plan: ids, a percent, the fill name', () => {
  expect(
    convertMarksMessage({ from: 'post', to: 'a6', plan: { extraPct: 13, fill: 'Ink' } })
  ).toEqual({
    dgn: 'convert-marks',
    v: 1,
    from: 'post',
    to: 'a6',
    extraPct: 13,
    fill: 'Ink',
  });
  expect(convertMarksMessage({ from: 'a', to: 'b', plan: {} })).toMatchObject({
    extraPct: 0,
    fill: null,
  });
});

test('the canvas takes convert-marks from its parent only; a sibling frame paints nothing', async () => {
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
  const msg = { dgn: 'convert-marks', v: 1, from: 'post', to: 'a6', extraPct: 13, fill: 'Ink' };
  try {
    await act(async () => {
      root.render(
        <ToolProvider initial="move">
          <UndoStackProvider>
            <div ref={canvasRef}>
              <CanvasShell hostRef={canvasRef}>
                <div data-dc-screen="post" />
              </CanvasShell>
            </div>
          </UndoStackProvider>
        </ToolProvider>
      );
    });
    await send(sibling, msg);
    await send(null, msg);
    expect(getConvertMarks()).toBeNull();
    await send(window.parent, { ...msg, to: 42 });
    expect(getConvertMarks()).toBeNull();
    await send(window.parent, msg);
    expect(getConvertMarks()).toEqual({ from: 'post', to: 'a6', extraPct: 13, fill: 'Ink' });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test('the post says Unchanged, the copy says how much height was added; nobody else draws a thing', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const draw = async (id: string, show = true) => {
    await act(async () => {
      root.render(<ArtboardConvertMarks id={id} x={150} y={110} w={168} h={232} show={show} />);
    });
  };
  try {
    await draw('post');
    expect(host.innerHTML).toBe('');
    await act(async () => setConvertMarks({ from: 'post', to: 'a6', extraPct: 13, fill: 'Ink' }));
    await draw('post');
    const un = host.querySelector('[data-testid="artboard-convert-unchanged"]') as HTMLElement;
    expect(un.textContent).toBe('✓ Unchanged');
    expect(un.classList.contains('dc-artboard-guides')).toBe(true);
    expect(un.getAttribute('aria-hidden')).toBe('true');
    await draw('a6');
    const ex = host.querySelector('[data-testid="artboard-convert-extra"]') as HTMLElement;
    expect(ex.textContent).toBe('+ 13 % height · Ink fill');
    expect(ex.classList.contains('dc-artboard-guides')).toBe(true);
    await draw('other');
    expect(host.innerHTML).toBe('');
    await draw('a6', false); // Preview / Present: no edit chrome
    expect(host.innerHTML).toBe('');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
