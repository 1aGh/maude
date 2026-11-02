// sec-a M3 (wave-A defender) / C3 (attacker) — canvas messages can no longer crash the shell.
//
// The S4.12 rows (annotation-toast / -selection / -to-comment / -ask-ai) used raw `e.data`: a
// `{dgn:'annotation-toast', v:1, message:1}` reached notify() as a number, `.trim()` threw in the
// toast render and the whole shell unmounted. Now: the dgn table's parser cleans the row first, a
// canvas toast is a rate-limited canvas notice with no shell Undo, and notify() / the card coerce
// a title to text. Behavioural: the real hook + the real notification host, real `message` events.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 500)); // Sonner's exit timers
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  dismissCanvasNotices,
  NotificationHost,
  notify,
  summarizeNoticeText,
} from '../notifications.tsx';

const CANVAS_ORIGIN = 'http://canvas.test';
const ACTIVE = '.design/ui/Active.tsx';
const activeWin = { name: 'active-frame' };

type Props = Record<string, unknown>;
function bridgeProps(overrides: Props): Props {
  const values: Props = {
    selected: null,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN },
    viewerMode: false,
    commentsByFile: {},
    focusedCommentId: null,
    theme: 'light',
    canvasActiveArtboard: null,
    minimapVisible: false,
    zoomCtlVisible: false,
    presentMode: false,
    iframesRef: { current: new Map([[ACTIVE, { contentWindow: activeWin }]]) },
    ...overrides,
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
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => {
    dismissCanvasNotices();
    await new Promise((r) => setTimeout(r, 350));
  });
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mount(spies: Props = {}) {
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(bridgeProps({ activePath: ACTIVE, ...spies }) as never);
    return <NotificationHost />;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness />));
}

function post(data: unknown) {
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: data },
    origin: { value: CANVAS_ORIGIN },
    source: { value: activeWin },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 50)));

describe('sec-a M3 — the S4.12 canvas rows go through the dgn parser', () => {
  test('a number for a message no longer throws; nothing is shown and the shell stays mounted', async () => {
    await mount();
    expect(() => post({ dgn: 'annotation-toast', v: 1, message: 1, undo: true })).not.toThrow();
    expect(() => post({ dgn: 'annotation-toast', v: 1, message: { x: 1 } })).not.toThrow();
    await settle();
    expect(host?.querySelectorAll('.maude-notice').length).toBe(0);
    // the host still renders: a later, well-formed toast shows
    post({ dgn: 'annotation-toast', v: 1, message: '3 stickies resolved', undo: false });
    await settle();
    expect(host?.textContent).toContain('3 stickies resolved');
  });

  test('a flood is capped, and a canvas toast never carries a shell Undo button', async () => {
    await mount();
    for (let i = 0; i < 100; i++)
      post({ dgn: 'annotation-toast', v: 1, message: `Moved ${i} to the trash`, undo: true });
    await settle();
    const shown = host?.querySelectorAll('.maude-notice') ?? [];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(2);
    expect(host?.querySelectorAll('.maude-notice-action').length).toBe(0);
  });

  test('annotation-selection takes only the parsed payload', async () => {
    const { annotationScopeOf } = await import('../client/v2/annotations/annotation-asks.js');
    await mount();
    post({ dgn: 'annotation-selection', ids: ['s1'], kinds: 7, artboards: null });
    expect(annotationScopeOf(ACTIVE)).toBeNull();
    post({ dgn: 'annotation-selection', ids: ['s1'], kinds: { sticky: 1 }, artboards: [] });
    expect(annotationScopeOf(ACTIVE)?.ids).toEqual(['s1']);
  });

  test('notify() and the card coerce a title to text', async () => {
    await mount();
    expect(summarizeNoticeText(42 as unknown as string)).toBe('42');
    expect(summarizeNoticeText(undefined as unknown as string)).toBe('');
    let id = '';
    await act(async () => {
      id = notify({ title: 7 as unknown as string, kind: 'info' });
    });
    await settle();
    expect(id).toBeTruthy();
    expect(host?.textContent).toContain('7');
  });
});

describe('sec-a C3 — a render throw shows a recoverable card, not a blank window', () => {
  test('the shell error boundary catches it and Reload reloads', async () => {
    const { default: ShellErrorBoundary } = await import(
      '../client/v2/shell/shell-error-boundary.jsx'
    );
    function Thrower(): never {
      throw new Error('bad row');
    }
    let reloaded = 0;
    const quiet = console.error;
    console.error = () => {};
    try {
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      await act(async () =>
        root?.render(
          <ShellErrorBoundary onReload={() => reloaded++}>
            <Thrower />
          </ShellErrorBoundary>
        )
      );
    } finally {
      console.error = quiet;
    }
    expect(host?.querySelector('[data-testid="shell-error-card"]')?.textContent).toContain(
      'This window stopped drawing.'
    );
    const btn = host?.querySelector('[data-testid="shell-error-reload"]') as HTMLButtonElement;
    act(() => btn.click());
    expect(reloaded).toBe(1);
  });
});
