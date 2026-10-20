// S7.17 — what other people left on the video, on the ruler (07 · ve-together): comment flags at the moment a
// thread is pinned to (S9.22 `commentsAt`) and the time-pinned stickies as bars in their paper (S4.16
// `timeMarks`). A v1 clip-anchored comment keeps its 💬 strip (no thread twice); a peer's colour is used only
// when it is a hex value; a flag opens its thread, a bar puts the playhead on its start.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const FILE = 'ui/Nabor.tsx';
const COMMENTS = [
  { id: 'c2', artboard: 'reel', t: 7.5, author: 'Tereza', text: 'Too fast here', status: 'open' },
  { id: 'c1', artboard: 'reel', t: 2, author: 'Jonas', text: 'Nice', status: 'resolved' },
  { id: 'c3', artboard: 'other', t: 1, author: 'Vera', text: 'elsewhere' },
  { id: 'c4', artboard: 'reel', author: 'Max', text: 'no moment' },
  {
    id: 'v1',
    artboard: 'reel',
    t: 3,
    timeline: { clipStableId: 'a', frameOffset: 2 },
    text: 'v1 pin',
  },
];
const BOARD = [
  { id: 's1', type: 'sticky', fill: '#ffe08a', timeRange: { artboard: 'reel', start: 4, end: 6 } },
  {
    id: 's2',
    type: 'sticky',
    fill: 'url(https://evil.test/x)',
    timeRange: { artboard: 'reel', start: 1, end: 1.5 },
  },
  { id: 's3', type: 'sticky', fill: '#abc', timeRange: { artboard: 'other', start: 0, end: 1 } },
  { id: 's4', type: 'sticky', fill: '#abc' },
];

describe('the models', () => {
  test('commentFlags: this video’s moment-pinned threads, earliest first, v1 pins left to their strip', async () => {
    const { commentFlags } = await import('../client/v2/timeline/marks.jsx');
    expect(commentFlags(COMMENTS, 'reel', 30)).toEqual([
      { id: 'c1', frame: 60, author: 'Jonas', resolved: true, title: 'Jonas: Nice' },
      { id: 'c2', frame: 225, author: 'Tereza', resolved: false, title: 'Tereza: Too fast here' },
    ]);
    expect(commentFlags(COMMENTS, null, 30)).toEqual([]);
  });
  test('timeMarkBars: this video’s pinned stickies in frames; a non-hex paper falls back to the token', async () => {
    const { timeMarkBars } = await import('../client/v2/timeline/marks.jsx');
    expect(timeMarkBars(BOARD, 'reel', 30)).toEqual([
      { id: 's2', f0: 30, f1: 45, colour: 'var(--object-yellow)' },
      { id: 's1', f0: 120, f1: 180, colour: '#ffe08a' },
    ]);
  });
});

describe('on the ruler', () => {
  test('flags and bars are drawn; a flag opens its thread, a bar seeks to its start', async () => {
    const { RulerMarks } = await import('../client/v2/timeline/marks.jsx');
    const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
    const opened: Array<[string, string]> = [];
    const seeks: number[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        h(
          ShellStoreContext.Provider,
          { value: { shellCore: { commentsByFile: { [FILE]: COMMENTS } } } },
          h(RulerMarks, {
            file: FILE,
            artboardId: 'reel',
            fps: 30,
            total: 300,
            x: (f: number) => f * 2,
            board: BOARD,
            onSeek: (f: number) => seeks.push(f),
            onOpenThread: (file: string, id: string) => opened.push([file, id]),
          })
        )
      )
    );
    const flag = host.querySelector<HTMLElement>('[data-testid="timeline-flag-c2"]');
    expect(flag?.style.left).toBe('450px');
    expect(flag?.title).toBe('Tereza: Too fast here');
    expect(host.querySelector('[data-testid="timeline-flag-c1"]')?.className).toContain(
      'is-resolved'
    );
    expect(host.querySelector('[data-testid="timeline-flag-v1"]')).toBeNull();
    expect(host.querySelector('[data-testid="timeline-flag-c3"]')).toBeNull();
    const bar = host.querySelector<HTMLElement>('[data-testid="timeline-time-mark-s1"]');
    expect([bar?.style.left, bar?.style.width]).toEqual(['240px', '120px']);
    expect(
      host.querySelector<HTMLElement>('[data-testid="timeline-time-mark-s2"]')?.style.background
    ).not.toContain('url(');
    await act(async () => void flag?.click());
    await act(async () => void bar?.click());
    expect(opened).toEqual([[FILE, 'c2']]);
    expect(seeks).toEqual([120]);
  });
});
