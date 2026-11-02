// V2-8.9 r2 C1 (attacker) — a canvas could keep a real "Export failed" off the screen. Every refused
// `annotation-to-comment` (and the browser's "AI chat is in the Maude desktop app.") became a fresh
// SHELL-authored error notice — fresh id, no rate limit — and the one toast slot showed shell notices
// first, newest first, so a flood always beat the trusted one and hid it behind paused clocks.
// Now: a notice raised in direct response to a canvas message has one fixed reused id and the canvas
// rate limit; only shell-ORIGINATED notices rank above canvas-triggered ones; waiting errors come
// forward first-in, first-out; the entries list is bounded. Behavioural: the real bridge hook + the
// real notification host, real `message` events.

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
  dismissNotice,
  MAX_NOTICE_ENTRIES,
  NotificationHost,
  noticeEntries,
  notify,
  notifyCanvasTriggered,
  shownNoticeIds,
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

const realFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  globalThis.fetch = realFetch;
  await act(async () => {
    for (const e of noticeEntries()) dismissNotice(e.id);
    await new Promise((r) => setTimeout(r, 350));
  });
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mount() {
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(bridgeProps({ activePath: ACTIVE }) as never);
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
const settle = (ms = 50) => act(async () => new Promise((r) => setTimeout(r, ms)));

describe('a canvas-triggered flood never hides a trusted "Export failed"', () => {
  test('refused annotation-to-comment asks: one reused notice, rate-limited, ranked below the shell', async () => {
    // every conversion is refused by the server
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'not-found' }), {
        status: 404,
      })) as typeof fetch;
    await mount();
    await act(async () => {
      notify({ id: 'export-job', title: 'Export failed', kind: 'error' });
    });
    for (let i = 0; i < 360; i++) post({ dgn: 'annotation-to-comment', v: 1, id: `x${i}` });
    await settle(150);
    // the flood shares one fixed id: at most one entry, however many asks
    const fromCanvas = noticeEntries().filter((e) => e.id !== 'export-job');
    expect(fromCanvas.length).toBeLessThanOrEqual(1);
    // and the trusted notice is the one on screen
    expect(shownNoticeIds(noticeEntries())).toEqual(['export-job']);
    expect(host?.textContent).toContain('Export failed');
  });

  test('the browser AI-chat line is one reused, rate-limited notice too', async () => {
    await mount();
    await act(async () => {
      notify({ id: 'export-job', title: 'Export failed', kind: 'error' });
    });
    for (let i = 0; i < 50; i++) post({ dgn: 'annotation-ask-ai', v: 1 });
    await settle();
    expect(noticeEntries().filter((e) => e.id !== 'export-job').length).toBeLessThanOrEqual(1);
    expect(shownNoticeIds(noticeEntries())).toEqual(['export-job']);
  });
});

describe('the one slot (pure)', () => {
  test('shell-originated beats canvas-triggered, even when the canvas one is newer', () => {
    const entries = [
      { id: 'a', title: 'Export failed', kind: 'error' as const },
      {
        id: 'b',
        title: 'Could not turn it into a comment',
        kind: 'error' as const,
        canvasTriggered: true,
      },
    ];
    expect(shownNoticeIds(entries)).toEqual(['a']);
  });

  test('waiting errors come forward first-in, first-out', () => {
    const entries = [
      { id: 'e1', title: 'Export failed', kind: 'error' as const },
      { id: 'e2', title: "Couldn't save", kind: 'error' as const },
      { id: 's1', title: 'Copied', kind: 'success' as const },
    ];
    expect(shownNoticeIds(entries)).toEqual(['e1']);
    expect(shownNoticeIds(entries.slice(1))).toEqual(['e2']);
    // no error waiting: the newest, as before
    expect(shownNoticeIds(entries.slice(2))).toEqual(['s1']);
  });

  test('canvas text and canvas-triggered both wait for the shell', () => {
    const entries = [
      { id: 'c', title: 'canvas words', kind: 'info' as const, group: 'canvas' },
      { id: 't', title: 'canvas asked', kind: 'error' as const, canvasTriggered: true },
    ];
    expect(shownNoticeIds(entries)).toEqual(['t']);
  });
});

describe('the entries list is bounded', () => {
  test('a long run of shell notices keeps at most MAX_NOTICE_ENTRIES, the oldest trusted error kept', () => {
    notify({ id: 'first-error', title: 'Export failed', kind: 'error' });
    for (let i = 0; i < MAX_NOTICE_ENTRIES * 3; i++)
      notify({ title: `Saved ${i}`, kind: 'success' });
    for (let i = 0; i < 20; i++)
      notifyCanvasTriggered({ id: 'canvas-x', title: 'refused', kind: 'error' });
    const all = noticeEntries();
    expect(all.length).toBeLessThanOrEqual(MAX_NOTICE_ENTRIES);
    expect(all.some((e) => e.id === 'first-error')).toBe(true);
  });
});
