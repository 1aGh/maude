import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasShell } from '../canvas-shell.tsx';
import { ToolProvider } from '../use-tool-mode.tsx';
import { UndoStackProvider } from '../use-undo-stack.tsx';

// The standalone shell opens its unrelated AI-notice socket and export list.
// Give it an empty local notification service; document saving is the real
// editor's postMessage contract below, not a mocked sync/backend acceptance.
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
  GlobalRegistrator.register({ url: `${notifications.url}_canvas-shell.html?canvas=ui/Text.tsx` });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
  notifications.stop(true);
});

test('a same-element selection refresh preserves an open text editor and its commit', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const canvasRef = createRef<HTMLDivElement>();
  const messages: Array<Record<string, unknown>> = [];
  const post = spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    if (message && typeof message === 'object') messages.push(message as Record<string, unknown>);
  });
  const select = () =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { dgn: 'select-by-id', id: 'heading', artboardId: 'main', index: 0 },
      })
    );
  try {
    await act(async () => {
      root.render(
        <ToolProvider initial="move">
          <UndoStackProvider>
            <div ref={canvasRef}>
              <CanvasShell hostRef={canvasRef}>
                <div data-dc-screen="main">
                  <h1 data-cd-id="heading" data-cd-editable="text">
                    Original title
                  </h1>
                </div>
              </CanvasShell>
            </div>
          </UndoStackProvider>
        </ToolProvider>
      );
    });
    const heading = host.querySelector('h1');
    if (!heading) throw new Error('Heading fixture absent');
    await act(async () => {
      select();
    });
    await act(async () => {
      heading.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(heading.getAttribute('contenteditable')).toBe('plaintext-only');
    heading.textContent = 'Uncommitted local typing';
    // The shell's delayed halo-restore sends the SAME select-by-id even after
    // the user has entered the editor. This is not a new document or target.
    await act(async () => {
      select();
    });
    expect(heading.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(document.activeElement).toBe(heading);
    expect(heading.textContent).toBe('Uncommitted local typing');
    expect(messages.filter((m) => m.dgn === 'edit-text')).toEqual([]);
    await act(async () => {
      heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(messages.filter((m) => m.dgn === 'edit-text')).toEqual([
      expect.objectContaining({
        id: 'heading',
        text: 'Uncommitted local typing',
        before: 'Original title',
      }),
    ]);
    expect(heading.hasAttribute('contenteditable')).toBe(false);
    await act(async () => {
      heading.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(heading.getAttribute('contenteditable')).toBe('plaintext-only');
    heading.textContent = 'Cancelled typing';
    await act(async () => {
      select();
    });
    await act(async () => {
      heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(heading.textContent).toBe('Uncommitted local typing');
    expect(heading.hasAttribute('contenteditable')).toBe(false);
    expect(messages.filter((m) => m.dgn === 'edit-text')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    post.mockRestore();
    host.remove();
  }
});
