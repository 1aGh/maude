// P8 C6 — 10 co-sync-offline: the foot's "since" is remembered across a relaunch. A Mac that has held 14 changes
// since yesterday 18:20 says so after it is reopened; the first render (before the queue is read, pending 0, kind
// not yet "offline") must NOT forget it — it read "since 01:36" (the time of the relaunch) before.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const KEY = 'maude-offline-since';
let host: HTMLElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  localStorage.clear();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

async function mountFoot(props: { kind: string; pending: number }, now: () => number) {
  const { useOfflineFoot } = await import('../client/v2/sync-states/offline-foot.jsx');
  function Probe(p: { kind: string; pending: number }) {
    useOfflineFoot({ kind: p.kind, pending: p.pending, now });
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Probe {...props} />));
  const rerender = async (next: { kind: string; pending: number }) =>
    act(async () => root?.render(<Probe {...next} />));
  return rerender;
}

describe('offline foot — the remembered "since"', () => {
  test('a relaunch keeps yesterday 18:20 while the queue is still being read', async () => {
    const slots = await import('../client/v2/canvases/row-slots.js');
    slots.resetRowSlots();
    const now = new Date(2026, 9, 25, 1, 36).getTime();
    const since = new Date(2026, 9, 24, 18, 20).getTime();
    localStorage.setItem(KEY, String(since));
    // first paint of the relaunch: nothing known yet (kind saved, nothing pending)
    const rerender = await mountFoot({ kind: 'saved', pending: 0 }, () => now);
    expect(localStorage.getItem(KEY)).toBe(String(since));
    // then the queue is read and the Mac is still offline with its 14 changes
    await rerender({ kind: 'offline', pending: 14 });
    expect(slots.getRowSlots().foot?.text).toBe('14 changes since yesterday 18:20 — kept on this Mac');
    slots.resetRowSlots();
  });

  test('once the changes have gone up, the next day offline starts its own "since"', async () => {
    const slots = await import('../client/v2/canvases/row-slots.js');
    slots.resetRowSlots();
    const now = new Date(2026, 9, 25, 9, 0).getTime();
    const rerender = await mountFoot({ kind: 'offline', pending: 3 }, () => now);
    expect(localStorage.getItem(KEY)).toBe(String(now));
    await rerender({ kind: 'saved', pending: 0 });
    expect(localStorage.getItem(KEY)).toBeNull();
    slots.resetRowSlots();
  });
});
