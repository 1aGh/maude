// p8-lock-reasons (lead follow-up) — the inline text editor and the shared lock. A locked object refuses every
// write but the lock (S2-edit-ops §3 rule 6), so `text.set` on a locked text answers 409 `locked`. Michal's rule:
// nothing fails. So (1) a double-click or ↵ on a shared-locked text never opens the editor — it says the lock line
// instead, as the other locked gestures do; (2) when the lock lands while the editor is open, the save's 409
// closes the editor, puts the original text back and says the lock line as a notice, never as an error.
// The real CanvasShell, as canvas-text-selection-refresh.test.tsx mounts it; the edit-op is answered in place.
import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import type { createRoot as CreateRoot } from 'react-dom/client';
import type { disposeCanvasToastHost as DisposeToastHost } from '../canvas-notifications.tsx';
import type { CanvasShell as CanvasShellT } from '../canvas-shell.tsx';
import type { EditOpResult } from '../edit-ops/types.ts';
import type { textOpDeps as TextOpDeps } from '../editing/text-actions.ts';
import type { ToolProvider as ToolProviderT } from '../use-tool-mode.tsx';
import type { UndoStackProvider as UndoStackProviderT } from '../use-undo-stack.tsx';

let createRoot: typeof CreateRoot;
let disposeCanvasToastHost: typeof DisposeToastHost;
let CanvasShell: typeof CanvasShellT;
let textOpDeps: typeof TextOpDeps;
let ToolProvider: typeof ToolProviderT;
let UndoStackProvider: typeof UndoStackProviderT;

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
beforeAll(async () => {
  GlobalRegistrator.register({ url: `${notifications.url}_canvas-shell.html?canvas=ui/Text.tsx` });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  ({ disposeCanvasToastHost } = await import('../canvas-notifications.tsx'));
  ({ CanvasShell } = await import('../canvas-shell.tsx'));
  ({ textOpDeps } = await import('../editing/text-actions.ts'));
  ({ ToolProvider } = await import('../use-tool-mode.tsx'));
  ({ UndoStackProvider } = await import('../use-undo-stack.tsx'));
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
  notifications.stop(true);
});

type Toast = [string, string | undefined];

/** Mount one text in the real shell, select it, and hand back the pieces; `answer` is the edit-op's reply. */
async function shell(locked: boolean, answer: () => EditOpResult) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const canvasRef = createRef<HTMLDivElement>();
  const asks: Array<{ op: string }> = [];
  const toasts: Toast[] = [];
  const prevDeps = textOpDeps.current;
  const post = spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  await act(async () => {
    root.render(
      <ToolProvider initial="move">
        <UndoStackProvider>
          <div ref={canvasRef}>
            <CanvasShell hostRef={canvasRef}>
              <div data-dc-screen="main">
                <div className="dc-artboard-body">
                  <h1
                    data-cd-id="heading"
                    data-cd-editable="text"
                    {...(locked ? { 'data-cd-locked': '' } : {})}
                  >
                    Original title
                  </h1>
                </div>
              </div>
            </CanvasShell>
          </div>
        </UndoStackProvider>
      </ToolProvider>
    );
  });
  textOpDeps.current = {
    ...textOpDeps.current,
    toast: (m, k) => toasts.push([m, k]),
    run: async (ask) => {
      asks.push(ask as { op: string });
      return answer();
    },
  };
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { dgn: 'select-by-id', id: 'heading', artboardId: 'main', index: 0 },
      })
    );
  });
  const heading = host.querySelector('h1') as HTMLElement;
  const done = async () => {
    textOpDeps.current = prevDeps;
    await act(async () => root.unmount());
    await act(async () => disposeCanvasToastHost());
    post.mockRestore();
    host.remove();
  };
  return { heading, asks, toasts, done };
}

const OK: EditOpResult = { ok: true, actionId: 'text.set', writeId: 'w1', rev: 'r1', refs: [] };
const LOCKED: EditOpResult = {
  ok: false,
  code: 'locked',
  message: 'heading is locked · ⇧⌘L unlocks',
};

test('a shared-locked text: double-click and ↵ do not open the editor; the lock line says why', async () => {
  const s = await shell(true, () => OK);
  try {
    await act(async () => {
      s.heading.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(s.heading.hasAttribute('contenteditable')).toBe(false);
    // ↵ on a selected text (V2-8.7) arrives as the same entry point, with selectAll
    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('maude:enter-text-edit', { detail: { el: s.heading, selectAll: true } })
      );
    });
    expect(s.heading.hasAttribute('contenteditable')).toBe(false);
    // one line per gesture: the double-click, then ↵
    expect(s.toasts).toHaveLength(2);
    for (const [line, kind] of s.toasts) {
      expect(line).toMatch(/ is locked · ⇧⌘L unlocks$/);
      expect(kind).toBe('info');
    }
    expect(s.asks).toEqual([]);
  } finally {
    await s.done();
  }
});

test('the lock lands while the editor is open: the save closes it, keeps the text, says the lock line', async () => {
  const s = await shell(false, () => LOCKED);
  try {
    await act(async () => {
      s.heading.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(s.heading.getAttribute('contenteditable')).toBe('plaintext-only');
    s.heading.textContent = 'Typed after someone locked it';
    await act(async () => {
      s.heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(s.asks.map((a) => a.op)).toEqual(['text.set']);
    expect(s.heading.hasAttribute('contenteditable')).toBe(false);
    expect((s.heading.textContent ?? '').trim()).toBe('Original title');
    expect(s.toasts).toEqual([['heading is locked · ⇧⌘L unlocks', 'info']]);
  } finally {
    await s.done();
  }
});
