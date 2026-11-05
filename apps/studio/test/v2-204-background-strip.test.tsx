// Issue #177 — "AI says several agents are working, but nothing in the chat shows it." The client half:
// the connection keeps the `{t:'background'}` snapshot (and forgets it when the socket drops), the model
// turns snapshots into rows that end as "Finished" and then leave, and the strip renders one row for one
// task, a collapsed "3 agents working" for several (expandable), with the time each has been running.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import {
  cleanTasks,
  elapsedText,
  KEEP_FINISHED_MS,
  pruneFinished,
  rowElapsed,
  summaryText,
  trackBackground,
} from '../client/v2/ai/background-model.js';

const agent = (id: string, since = 1000) => ({ id, kind: 'agent', label: `Agent ${id}`, since });
const shell = (id: string, since = 1000) => ({
  id,
  kind: 'command',
  label: 'Export the reel',
  since,
});

describe('the model', () => {
  test('a running task is a row; one that leaves the snapshot is Finished, then gone', () => {
    let items = trackBackground([], [agent('a'), shell('b', 2000)], 3000);
    expect(items.map((i) => [i.id, i.state])).toEqual([
      ['a', 'running'],
      ['b', 'running'],
    ]);
    items = trackBackground(items, [shell('b', 2000)], 10_000);
    expect(items.map((i) => [i.id, i.state])).toEqual([
      ['b', 'running'],
      ['a', 'finished'],
    ]);
    expect(rowElapsed(items[1], 99_000)).toBe('0:09'); // it ran 9 s, the clock stopped at the end
    expect(pruneFinished(items, 10_000 + KEEP_FINISHED_MS - 1)).toBe(items);
    expect(pruneFinished(items, 10_000 + KEEP_FINISHED_MS).map((i) => i.id)).toEqual(['b']);
  });

  test('summary words count agents and commands, for one and many', () => {
    const now = 5000;
    expect(summaryText(trackBackground([], [agent('a'), agent('b'), agent('c')], now))).toBe(
      '3 agents working'
    );
    expect(summaryText(trackBackground([], [agent('a'), shell('b')], now))).toBe(
      '1 agent working · 1 command running'
    );
    const ended = trackBackground(trackBackground([], [agent('a')], now), [], now + 1);
    expect(summaryText(ended)).toBe('Finished');
  });

  test('elapsed reads m:ss, then h:mm:ss', () => {
    expect(elapsedText(400)).toBeNull();
    expect(elapsedText(42_000)).toBe('0:42');
    expect(elapsedText(3_725_000)).toBe('1:02:05');
  });

  test('a malformed frame is cut down to what it can show', () => {
    expect(cleanTasks('nope')).toEqual([]);
    expect(
      cleanTasks([null, { id: '' }, { id: 'x', kind: 'weird', label: 7, since: 'later' }])
    ).toEqual([{ id: 'x', kind: 'other', label: '', since: null }]);
  });
});

describe('the connection keeps the background snapshot', () => {
  test('a background frame is replayed to a late subscriber; a dropped socket clears it', async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      readyState = 1;
      sent: string[] = [];
      constructor() {
        sockets.push(this);
        queueMicrotask(() => this.onopen?.());
      }
      send(s: string) {
        this.sent.push(s);
      }
      close() {}
    }
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { WebSocket: g.WebSocket, location: g.location };
    g.WebSocket = FakeSocket;
    g.location = { protocol: 'http:', host: 'localhost:1' };
    try {
      const { createAcpConnection } = await import('../client/panels/acp-runtime.js');
      const conn = createAcpConnection();
      conn.bindChat('c1', 0);
      await conn.warm('c1');
      const sock = sockets[0];
      if (!sock) throw new Error('no socket opened');
      sock.onmessage?.({
        data: JSON.stringify({
          t: 'background',
          tasks: [{ id: 'a1', kind: 'agent', label: 'Review', since: 1 }],
        }),
      });
      const seen: unknown[] = [];
      conn.onBackgroundTasks((t: unknown) => seen.push(t));
      expect(seen).toEqual([[{ id: 'a1', kind: 'agent', label: 'Review', since: 1 }]]);
      sock.onclose?.();
      expect(seen.at(-1)).toEqual([]);
    } finally {
      g.WebSocket = saved.WebSocket;
      g.location = saved.location;
    }
  });
});

describe('the strip', () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  async function mount() {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { BackgroundStrip } = await import('../client/v2/ai/BackgroundStrip.jsx');
    const listeners = new Set<(t: unknown) => void>();
    const conn = {
      onBackgroundTasks(fn: (t: unknown) => void) {
        listeners.add(fn);
        fn([]);
        return () => listeners.delete(fn);
      },
    };
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<BackgroundStrip conn={conn} />);
    });
    const emit = async (tasks: unknown) => {
      await act(async () => {
        for (const fn of listeners) fn(tasks);
      });
    };
    const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    return { host, root, act, emit, q };
  }

  test('nothing running, nothing shown', async () => {
    const { q, root, act } = await mount();
    expect(q('ai-background')).toBeNull();
    await act(async () => root.unmount());
  });

  test('one task is one row: its name, its kind, its time', async () => {
    const { q, emit, root, act } = await mount();
    await emit([
      { id: 'a1', kind: 'agent', label: 'Review the Pricing canvas', since: Date.now() - 42_000 },
    ]);
    const strip = q('ai-background');
    expect(strip?.getAttribute('data-working')).toBe('true');
    expect(strip?.getAttribute('aria-label')).toBe('Running in the background');
    expect(q('ai-background-toggle')).toBeNull();
    const row = q('ai-background-row-a1');
    expect(row?.textContent).toContain('Review the Pricing canvas');
    expect(row?.textContent).toContain('Agent');
    expect(row?.textContent).toMatch(/0:4\d/);
    await act(async () => root.unmount());
  });

  test('several collapse to "3 agents working" and expand to a row each', async () => {
    const { q, emit, root, act } = await mount();
    const now = Date.now();
    await emit([
      { id: 'a1', kind: 'agent', label: 'One', since: now },
      { id: 'a2', kind: 'agent', label: 'Two', since: now },
      { id: 'a3', kind: 'agent', label: 'Three', since: now },
    ]);
    expect(q('ai-background-summary')?.textContent).toBe('3 agents working');
    const toggle = q('ai-background-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(q('ai-background-list')).toBeNull();
    await act(async () => toggle?.click());
    expect(q('ai-background-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('ai-background-list')?.querySelectorAll('li')).toHaveLength(3);
    // one ends: it reads Finished, the summary counts the rest
    await emit([
      { id: 'a2', kind: 'agent', label: 'Two', since: now },
      { id: 'a3', kind: 'agent', label: 'Three', since: now },
    ]);
    expect(q('ai-background-row-a1')?.getAttribute('data-state')).toBe('finished');
    expect(q('ai-background-row-a1')?.textContent).toContain('Finished');
    expect(q('ai-background-summary')?.textContent).toBe('2 agents working');
    // all end: the strip says so and stops working
    await emit([]);
    expect(q('ai-background')?.getAttribute('data-working')).toBe('false');
    expect(q('ai-background-summary')?.textContent).toBe('Finished');
    await act(async () => root.unmount());
  });
});
