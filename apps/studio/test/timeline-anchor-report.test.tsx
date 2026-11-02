// S7.7 — the canvas tells the shell which artboard is selected (`artboard-anchor`), and the shell believes it
// only from the active canvas. The island's rule: a VIDEO artboard (explicit kind, or one holding a
// <VideoComp>) is followed through pan and zoom; any other artboard is reported once; nothing is posted while
// nothing was selected.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { createAnchorLane } from '../client/v2/timeline/anchor-lane.js';
import { createTimelineStore } from '../client/v2/timeline/timeline-store.js';
import { artboardKindOf, createAnchorReporter, measureAnchor } from '../editing/anchor-report.ts';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = '';
});

const board = (id: string, label: string, kind: string | null, inner = '') =>
  `<article data-dc-screen="${id}"${kind ? ` data-dc-kind="${kind}"` : ''}><header class="dc-artboard-label">${label}</header><div class="dc-artboard-body">${inner}</div></article>`;

describe('the canvas side', () => {
  test('kind: the resolved data-dc-kind; a <VideoComp> inside makes an unmigrated artboard a video', () => {
    document.body.innerHTML =
      board('reels', 'Reels', 'video') +
      board('post', 'Post', 'digital') +
      board('old', 'Old', 'digital', '<div data-comp-id="c1"></div>') +
      board('bare', 'Bare', null);
    const kind = (id: string) =>
      artboardKindOf(document.querySelector(`[data-dc-screen="${id}"]`) as Element);
    expect(kind('reels')).toBe('video');
    expect(kind('post')).toBe('digital');
    expect(kind('old')).toBe('video');
    expect(kind('bare')).toBe('digital');
    expect(measureAnchor(document, 'reels')).toMatchObject({ kind: 'video', label: 'Reels' });
    expect(measureAnchor(document, 'nope')).toBeNull();
  });

  const mk = (selected: { v: string | null }) => {
    const posts: Array<Record<string, unknown>> = [];
    const frames: Array<() => void> = [];
    const r = createAnchorReporter({
      doc: document,
      selectedArtboard: () => selected.v,
      post: (m: Record<string, unknown>) => posts.push(m),
      raf: (fn: () => void) => frames.push(fn),
    });
    return { posts, frames, r };
  };

  test('nothing selected posts nothing; a video posts once per change and keeps a frame loop', () => {
    document.body.innerHTML = board('reels', 'Reels', 'video');
    const sel = { v: null as string | null };
    const { posts, frames, r } = mk(sel);
    r.request();
    r.request(); // coalesced into the one frame
    expect(frames.length).toBe(1);
    frames.shift()?.();
    expect(posts).toEqual([]);

    sel.v = 'reels';
    r.request();
    frames.shift()?.();
    expect(posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ dgn: 'artboard-anchor', artboardId: 'reels', kind: 'video' });
    expect(frames.length).toBe(1); // the loop that follows pan and zoom
    frames.shift()?.();
    expect(posts.length).toBe(1); // nothing moved, nothing sent
  });

  test('the loop sends a new rect when the camera moves', () => {
    document.body.innerHTML = board('reels', 'Reels', 'video');
    const body = document.querySelector('.dc-artboard-body') as HTMLElement;
    let left = 40;
    body.getBoundingClientRect = () =>
      ({ left, top: 10, width: 250, height: 444, right: left + 250, bottom: 454 }) as DOMRect;
    const sel = { v: 'reels' as string | null };
    const { posts, frames, r } = mk(sel);
    r.request();
    frames.shift()?.();
    left = -60; // panned half off the left edge: a real negative x, not clamped
    frames.shift()?.();
    expect(posts.length).toBe(2);
    expect((posts[1].rect as { x: number }).x).toBe(-60);
  });

  test('a page artboard is reported once and has no loop; leaving says null once', () => {
    document.body.innerHTML = board('post', 'Post', 'digital') + board('reels', 'Reels', 'video');
    const sel = { v: 'post' as string | null };
    const { posts, frames, r } = mk(sel);
    r.request();
    frames.shift()?.();
    expect(posts[0]).toMatchObject({ artboardId: 'post', kind: 'digital' });
    expect(frames.length).toBe(0);
    sel.v = null;
    r.request();
    frames.shift()?.();
    expect(posts[1]).toEqual({ dgn: 'artboard-anchor', artboardId: null });
    r.request();
    frames.shift()?.();
    expect(posts.length).toBe(2);
  });

  test('a selected video that is deleted says null', () => {
    document.body.innerHTML = board('reels', 'Reels', 'video');
    const sel = { v: 'reels' as string | null };
    const { posts, frames, r } = mk(sel);
    r.request();
    frames.shift()?.();
    document.body.innerHTML = '';
    frames.shift()?.();
    expect(posts[1]).toEqual({ dgn: 'artboard-anchor', artboardId: null });
  });

  test('cancel stops the loop', () => {
    document.body.innerHTML = board('reels', 'Reels', 'video');
    const cancelled: number[] = [];
    const r = createAnchorReporter({
      doc: document,
      selectedArtboard: () => 'reels',
      post: () => {},
      raf: () => 7,
      caf: (id) => cancelled.push(id),
    });
    r.request();
    r.cancel();
    expect(cancelled).toEqual([7]);
  });
});

describe('the shell side believes only the active canvas', () => {
  const win = {} as Window;
  const msg = (data: Record<string, unknown>, source: unknown = win, origin = 'http://c.test') =>
    ({ data, source, origin }) as unknown as MessageEvent;
  const lane = (store: { anchor: (m: object) => void }) =>
    createAnchorLane({
      canvasOrigin: () => 'http://c.test',
      activePath: () => '.design/a.tsx',
      frameOf: () => ({ contentWindow: win }),
      store,
    });
  const rect = { x: 1, y: 2, w: 3, h: 4 };

  test('a video anchor from the active canvas summons the island; the label is clipped', () => {
    const store = createTimelineStore();
    const l = lane(store);
    l.onMessage(
      msg({ dgn: 'artboard-anchor', artboardId: 'r', kind: 'video', label: 'x'.repeat(300), rect })
    );
    expect(store.get().visible).toBe(true);
    expect(store.get().target?.label.length).toBe(120);
  });

  test('another window, another origin, or a malformed rect is ignored', () => {
    const store = createTimelineStore();
    const l = lane(store);
    const ok = { dgn: 'artboard-anchor', artboardId: 'r', kind: 'video', rect };
    l.onMessage(msg(ok, {} as Window));
    l.onMessage(msg(ok, win, 'http://evil.test'));
    l.onMessage(msg({ ...ok, rect: { x: 1 } }));
    expect(store.get().visible).toBe(false);
    l.onMessage(msg({ dgn: 'artboard-anchor', artboardId: null }));
    expect(store.get().visible).toBe(false);
  });

  test('the protocol row: live, accepts a rect or null, refuses a half rect', () => {
    const row = (
      DGN_TABLE.c2s as Record<string, { parse: (v: unknown) => unknown; status: string }>
    )['artboard-anchor'];
    expect(row.status).toBe('live');
    expect(row.parse({ artboardId: 'a', kind: 'video', label: 'R', rect })).toBeTruthy();
    expect(row.parse({ artboardId: null })).toBeTruthy();
    expect(row.parse({ artboardId: 'a', rect: { x: 1 } })).toBeNull();
    expect(row.parse({ artboardId: 3 })).toBeNull();
  });
});
