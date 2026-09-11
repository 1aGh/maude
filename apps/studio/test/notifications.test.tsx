import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { acceptCanvasNotice } from '../canvas-notice-message.ts';
import { useWhatsNew, WhatsNewToast } from '../client/whats-new.jsx';
import { dismissNotice, NotificationHost, notify, notifyCanvasText } from '../notifications.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
let root: Root;
let host: HTMLDivElement;
let now = 0;
let nextTimer = 100000;
const timers = new Map<number, { at: number; run: () => void }>();
const ids = new Set<string>();
const realTimeout = globalThis.setTimeout;
const realClear = globalThis.clearTimeout;
const realNow = Date.now;

// Control notification-length timers; let Sonner's animation/React scheduling run normally.
beforeEach(async () => {
  now = 0;
  Date.now = () => now;
  globalThis.setTimeout = ((run: () => void, delay = 0) => {
    if (delay < 1000) return realTimeout(run, delay);
    const id = nextTimer++;
    timers.set(id, { at: now + delay, run });
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    if (!timers.delete(id)) realClear(id);
  }) as typeof clearTimeout;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<NotificationHost />));
});
afterEach(async () => {
  await act(async () => {
    for (const id of ids) dismissNotice(id);
  });
  // Let Sonner finish its exit transitions before unregistering the DOM.
  await act(async () => {
    await new Promise((resolve) => realTimeout(resolve, 350));
  });
  await act(async () => {
    root.unmount();
  });
  ids.clear();
  timers.clear();
  host.remove();
  globalThis.setTimeout = realTimeout;
  globalThis.clearTimeout = realClear;
  Date.now = realNow;
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => realTimeout(resolve, 30));
  });
}
async function advance(ms: number) {
  await act(async () => {
    now += ms;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
  });
  await settle();
}
async function show(notice: Parameters<typeof notify>[0]) {
  await act(async () => {
    ids.add(notify(notice));
  });
  await settle();
}

test('updates retain ID and do not restart expiry', async () => {
  const closed = mock(() => {});
  await show({ id: 'one', title: 'Export running', duration: Infinity, timerKey: 'active' });
  await advance(60_000);
  expect(host.textContent).toContain('Export running');
  await show({ id: 'one', title: 'Export done', timerKey: 'done', onDismiss: closed });
  await advance(3000);
  await show({ id: 'one', title: 'Export done (updated)', timerKey: 'done', onDismiss: closed });
  expect(host.querySelectorAll('[data-testid="notice-one"]')).toHaveLength(1);
  await advance(2000);
  expect(closed).toHaveBeenCalledTimes(1);
});

test('overlay, hidden group and saving pause remaining time without acknowledgement', async () => {
  const closed = mock(() => {});
  const notice = { id: 'pause', title: 'Ready', group: 'exports', onDismiss: closed };
  await show(notice);
  await advance(2000);
  await act(async () => root.render(<NotificationHost paused />));
  await advance(20_000);
  await act(async () => root.render(<NotificationHost hiddenGroups={['exports']} />));
  await advance(20_000);
  expect(closed).not.toHaveBeenCalled();
  await show({ ...notice, paused: true });
  await act(async () => root.render(<NotificationHost />));
  await advance(20_000);
  expect(closed).not.toHaveBeenCalled();
  await show(notice);
  await advance(2999);
  expect(closed).not.toHaveBeenCalled();
  await advance(1);
  expect(closed).toHaveBeenCalledTimes(1);
});

test('focus and page visibility pause the clock; Undo lasts ten seconds', async () => {
  const closed = mock(() => {});
  await show({ id: 'focus', title: 'Undo move', kind: 'undo', onDismiss: closed });
  await advance(4000);
  await act(async () => host.querySelector<HTMLButtonElement>('button')?.focus());
  await advance(20_000);
  expect(closed).not.toHaveBeenCalled();
  await act(async () => (document.activeElement as HTMLElement)?.blur());
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await advance(20_000);
  expect(closed).not.toHaveBeenCalled();
  if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
  else Reflect.deleteProperty(document, 'hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await advance(6000);
  expect(closed).toHaveBeenCalledTimes(1);
});

test('older notices wait their turn, and closing one cannot remove a newer one', async () => {
  const oldClosed = mock(() => {});
  await show({ id: 'old', title: 'Older', onDismiss: oldClosed });
  for (const id of ['a', 'b', 'c']) await show({ id, title: id, duration: Infinity });
  await advance(30_000);
  expect(oldClosed).not.toHaveBeenCalled();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="notice-b"] button')?.click()
  );
  await advance(5000);
  expect(oldClosed).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="notice-c"]')).not.toBeNull();
});

test('manual actions run once and programmatic removal does not acknowledge', async () => {
  const clicked = mock(() => {});
  const dismissed = mock(() => {});
  await show({
    id: 'action',
    title: 'Moved',
    action: { label: 'Undo', onClick: clicked },
    onDismiss: dismissed,
  });
  await act(async () => host.querySelector<HTMLButtonElement>('.maude-notice-action')?.click());
  await settle();
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(dismissed).toHaveBeenCalledTimes(1);
  await show({ id: 'cleanup', title: 'Clean up', onDismiss: dismissed });
  await act(async () => dismissNotice('cleanup'));
  await settle();
  expect(dismissed).toHaveBeenCalledTimes(1);
});

test('canvas bridge accepts only active-origin text, dropping actions and bounding payload', () => {
  const event = {
    origin: 'https://canvas.test',
    source: window,
    data: {
      dgn: 'canvas-notice',
      kind: 'error',
      message: `<script>${'x'.repeat(5000)}`,
      action: 'bad',
    },
  };
  const notice = acceptCanvasNotice(event, event.origin, window);
  expect(notice?.title.length).toBe(4000);
  expect(notice?.action).toBeUndefined();
  expect(acceptCanvasNotice(event, 'https://other.test', window)).toBeNull();
  expect(acceptCanvasNotice(event, event.origin, null)).toBeNull();
  expect(acceptCanvasNotice({ ...event, source: null }, event.origin, window)).toBeNull();
  expect(
    acceptCanvasNotice({ ...event, data: { ...event.data, kind: 'admin' } }, event.origin, window)
  ).toBeNull();
});

test('notices published before the host mounts are displayed', async () => {
  await act(async () => root.unmount());
  ids.add(notify({ id: 'early', title: 'Already waiting', duration: Infinity }));
  root = createRoot(host);
  await act(async () => root.render(<NotificationHost />));
  await settle();
  expect(host.querySelector('[data-testid="notice-early"]')).not.toBeNull();
});

test('hover pauses expiry and long diagnostic text is shortened before announcement', async () => {
  const closed = mock(() => {});
  await show({
    id: 'hover',
    title: 'Export failed',
    kind: 'error',
    description: 'x'.repeat(1000),
    onDismiss: closed,
  });
  const card = host.querySelector('[data-testid="notice-hover"]');
  expect(card?.querySelector('.maude-notice-summary')?.textContent?.length).toBe(280);
  await advance(3000);
  await act(async () => card?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
  await advance(20_000);
  expect(closed).not.toHaveBeenCalled();
  await act(async () =>
    card?.dispatchEvent(
      new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })
    )
  );
  await advance(7000);
  expect(closed).toHaveBeenCalledTimes(1);
});

test('What’s New expiry acknowledges the toast but keeps the unread badge', async () => {
  const originalFetch = globalThis.fetch;
  localStorage.setItem('mdcc-whatsnew-seen', '1.0.0');
  localStorage.removeItem('mdcc-whatsnew-toast-dismissed');
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          version: '2.0.0',
          entries: [
            {
              id: 'notice-fixture',
              version: '2.0.0',
              title: 'New feature',
              summary: 'Try this change.',
            },
          ],
        })
      )
  ) as unknown as typeof fetch;
  let wn!: ReturnType<typeof useWhatsNew>;
  function Probe() {
    wn = useWhatsNew('1.0.0');
    return (
      <>
        <NotificationHost />
        <WhatsNewToast wn={wn} />
      </>
    );
  }
  try {
    await act(async () => root.render(<Probe />));
    await settle();
    ids.add('whats-new-2.0.0');
    expect(wn.unseen).toHaveLength(1);
    await advance(10_000);
    expect(wn.showToast).toBe(false);
    expect(localStorage.getItem('mdcc-whatsnew-toast-dismissed')).toBe('2.0.0');
    expect(localStorage.getItem('mdcc-whatsnew-seen')).toBe('1.0.0');
    expect(wn.unseen).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
    localStorage.clear();
  }
});

test('canvas bursts stay bounded and cannot hide trusted export notices', async () => {
  await show({ id: 'trusted', title: 'Export failed', duration: Infinity });
  const accepted: string[] = [];
  await act(async () => {
    for (let i = 0; i < 100; i++) {
      const id = notifyCanvasText(`Canvas burst ${i}`, 'error');
      if (id) {
        ids.add(id);
        accepted.push(id);
      }
    }
  });
  await settle();
  expect(accepted.length).toBeLessThanOrEqual(5);
  for (let i = 0; i < 10; i++) {
    await advance(1000);
    await act(async () => {
      const id = notifyCanvasText(`Later canvas ${i}`, 'error');
      if (id) ids.add(id);
    });
  }
  await settle();
  expect(host.querySelector('[data-testid="notice-trusted"]')).not.toBeNull();
  expect(host.querySelectorAll('.maude-notice')).toHaveLength(3);
  await advance(10_000);
  await act(async () => {
    await new Promise((resolve) => realTimeout(resolve, 350));
  });
  expect(host.querySelectorAll('.maude-notice')).toHaveLength(1);
});

test('rapid informational undo replaces its previous notice', async () => {
  for (let i = 0; i < 4; i++) {
    await advance(1000);
    await act(async () => {
      const id = notifyCanvasText(`Undo edit ${i}`, 'undo');
      if (id) ids.add(id);
    });
  }
  await settle();
  expect(host.querySelectorAll('.maude-notice')).toHaveLength(1);
  expect(host.textContent).toContain('Undo edit 3');
});
