// 2.0.5 (#205) — ds-refresh.js, the one rule for when the shell's design-system hosts read the server: once, then
// on events; after a failure again with a doubling delay (cap 5 min); one optional slow clock that waits while
// the window is hidden or the canvas is loading or broken. Fake timers and a fake fetch, no DOM.
import { describe, expect, test } from 'bun:test';
import { registerErrorCard, resetCodeBusForTest } from '../client/v2/code/code-bus.js';
import {
  backoffMs,
  canvasPaused,
  DS_BACKOFF_CAP_MS,
  DS_BACKOFF_FIRST_MS,
  dsRefresh,
} from '../client/v2/ds/ds-refresh.js';

const DS_STATE_CHANGED = 'maude:ds-state-changed';

function fakeTimers() {
  let now = 0;
  let id = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    set: ((fn: () => void, ms: number) => {
      id += 1;
      due.set(id, { at: now + ms, fn });
      return id;
    }) as unknown as typeof setTimeout,
    clear: ((t: number) => void due.delete(t)) as unknown as typeof clearTimeout,
    /** the delays still pending, from now */
    pending: () => [...due.values()].map((d) => d.at - now).sort((a, b) => a - b),
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = end;
    },
  };
}

function fakeDoc(state: 'visible' | 'hidden' = 'visible') {
  const t = new EventTarget() as EventTarget & { visibilityState: string };
  t.visibilityState = state;
  return t;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(over: { slowMs?: number; status?: () => number; paused?: () => boolean } = {}) {
  const timers = fakeTimers();
  const win = new EventTarget();
  const doc = fakeDoc();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: over.status?.() ?? 200 });
  }) as unknown as typeof fetch;
  const ctl = dsRefresh(async (f) => void (await f('/_api/ds/x')), {
    fetchImpl: () => fetchImpl,
    timers,
    win: win as unknown as Window,
    doc: doc as unknown as Document,
    slowMs: over.slowMs,
    paused: over.paused ?? (() => false),
  });
  return { timers, win, doc, ctl, calls: () => calls };
}

describe('reads on events only', () => {
  test('once, then nothing until an event', async () => {
    const s = setup();
    await flush();
    expect(s.calls()).toBe(1);
    await s.timers.advance(60 * 60_000);
    expect(s.calls()).toBe(1);
    expect(s.timers.pending()).toEqual([]);
    s.win.dispatchEvent(new Event(DS_STATE_CHANGED));
    await flush();
    expect(s.calls()).toBe(2);
    s.doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(s.calls()).toBe(3);
    s.ctl.stop();
    s.win.dispatchEvent(new Event(DS_STATE_CHANGED));
    await flush();
    expect(s.calls()).toBe(3);
  });
});

describe('a failed read backs off', () => {
  test('5 s, 10 s, 20 s … doubling, capped at 5 min; a success resets it', async () => {
    let status = 500;
    const s = setup({ status: () => status });
    await flush();
    const delays: number[] = [];
    for (let i = 0; i < 9; i++) {
      const [d] = s.timers.pending();
      delays.push(d as number);
      await s.timers.advance(d as number);
    }
    expect(delays).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
    expect(s.calls()).toBe(10);
    status = 200;
    await s.timers.advance(300_000);
    expect(s.calls()).toBe(11);
    expect(s.timers.pending()).toEqual([]);
    s.ctl.stop();
  });

  test('a thrown fetch counts as a failure', async () => {
    const timers = fakeTimers();
    const ctl = dsRefresh(
      async (f) => {
        await f('/x');
      },
      {
        fetchImpl: () =>
          (async () => {
            throw new Error('offline');
          }) as unknown as typeof fetch,
        timers,
        win: new EventTarget() as unknown as Window,
        doc: fakeDoc() as unknown as Document,
      }
    );
    await flush();
    expect(timers.pending()).toEqual([DS_BACKOFF_FIRST_MS]);
    ctl.stop();
  });

  test('backoffMs', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(DS_BACKOFF_FIRST_MS);
    expect(backoffMs(2)).toBe(2 * DS_BACKOFF_FIRST_MS);
    expect(backoffMs(40)).toBe(DS_BACKOFF_CAP_MS);
  });
});

describe('the one slow clock', () => {
  test('reads every slowMs while looked at; holds while hidden or paused', async () => {
    let paused = false;
    const s = setup({ slowMs: 60_000, paused: () => paused });
    await flush();
    expect(s.calls()).toBe(1);
    await s.timers.advance(60_000);
    expect(s.calls()).toBe(2);
    s.doc.visibilityState = 'hidden';
    await s.timers.advance(180_000);
    expect(s.calls()).toBe(2);
    s.doc.visibilityState = 'visible';
    paused = true;
    await s.timers.advance(180_000);
    expect(s.calls()).toBe(2);
    paused = false;
    await s.timers.advance(60_000);
    expect(s.calls()).toBe(3);
    s.ctl.stop();
    await s.timers.advance(600_000);
    expect(s.calls()).toBe(3);
  });

  test('canvasPaused: a loading or broken pane, or a broken-canvas card', () => {
    const pane = { getAttribute: () => 'ready' };
    const doc = (state: string | null) =>
      ({
        querySelector: () => (state === null ? null : { ...pane, getAttribute: () => state }),
      }) as unknown as Document;
    resetCodeBusForTest();
    expect(canvasPaused(doc('ready'))).toBe(false);
    expect(canvasPaused(doc(null))).toBe(false);
    expect(canvasPaused(doc('loading'))).toBe(true);
    expect(canvasPaused(doc('error'))).toBe(true);
    const off = registerErrorCard({});
    expect(canvasPaused(doc('ready'))).toBe(true);
    off();
    expect(canvasPaused(doc('ready'))).toBe(false);
  });
});
