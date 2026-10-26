// Round 11 (10 co-comment-video): Preview of a video board draws the comment-marker strip under the picture,
// read-only — "0:12 / 0:30 · <video> · 2 comments on this video" and each thread's face at its second.
// Edit keeps its own (the timeline island); Preview had none.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const model = () => import('../client/v2/timeline/comment-strip-model.js');
const comps = [
  {
    id: 'hype-comp',
    artboardId: 'hype',
    artboardLabel: 'Hype trailer',
    fps: 30,
    durationInFrames: 900,
  },
  { id: 'reel-comp', artboardId: 'reel', artboardLabel: 'Reels', fps: 30, durationInFrames: 300 },
];
const tc = (id: string, author: string, t: number, artboard = 'hype', over = {}) => ({
  id,
  author,
  text: `${author} says`,
  status: 'open',
  artboard,
  t,
  ...over,
});

describe('commentStrip (pure)', () => {
  test('timed threads of ONE video: its second, its share of the length, the count line', async () => {
    const { commentStrip } = await model();
    const s = commentStrip({
      comments: [tc('a', 'Tereza', 6), tc('b', 'Jonas', 21), tc('x', 'Petra', 3, 'reel')],
      comps,
      compId: 'hype-comp',
      frame: 360,
    });
    expect(s?.artboardLabel).toBe('Hype trailer');
    expect(s?.countLine).toBe('2 comments on this video');
    expect(s?.readout).toEqual({ at: '0:12', of: '0:30' });
    expect(
      s?.marks.map((m: { id: string; at: number }) => [m.id, Math.round(m.at * 1000) / 10])
    ).toEqual([
      ['a', 20],
      ['b', 70],
    ]);
    expect(s?.marks[0].author).toBe('Tereza');
  });

  test('one comment says "1 comment"; none (or only untimed pins) draws no strip at all', async () => {
    const { commentStrip } = await model();
    expect(
      commentStrip({ comments: [tc('a', 'Tereza', 6)], comps, compId: 'hype-comp', frame: 0 })
        ?.countLine
    ).toBe('1 comment on this video');
    for (const comments of [[], [{ id: 'u', author: 'X', text: 't', status: 'open' }], null])
      expect(commentStrip({ comments, comps, compId: 'hype-comp', frame: 0 })).toBeNull();
  });

  test('the video is the one the playhead follows; else the first video that has timed threads', async () => {
    const { commentStrip } = await model();
    const comments = [tc('r', 'Petra', 3, 'reel'), tc('a', 'Tereza', 6)];
    expect(commentStrip({ comments, comps, compId: 'reel-comp', frame: 0 })?.artboardId).toBe(
      'reel'
    );
    expect(commentStrip({ comments, comps, compId: null, frame: 0 })?.artboardId).toBe('reel');
    // a followed video with no threads of its own does not hide the other video's strip
    expect(
      commentStrip({ comments: [tc('a', 'Tereza', 6)], comps, compId: 'reel-comp', frame: 90 })
        ?.artboardId
    ).toBe('hype');
  });

  test('the playhead only reads on the video it belongs to; the marker at the playhead is "on"', async () => {
    const { commentStrip } = await model();
    const comments = [tc('a', 'Tereza', 12), tc('b', 'Jonas', 21)];
    const mine = commentStrip({ comments, comps, compId: 'hype-comp', frame: 360 });
    expect(mine?.marks.map((m: { on: boolean }) => m.on)).toEqual([true, false]);
    expect(mine?.playhead).toBeCloseTo(0.4, 5);
    const other = commentStrip({ comments, comps, compId: 'reel-comp', frame: 90 });
    expect(other?.readout.at).toBe('0:00'); // no other video's frame on this one's strip
    expect(other?.playhead).toBe(0);
  });

  test('a second past the end is clamped onto the strip; resolved threads stay, quiet', async () => {
    const { commentStrip } = await model();
    const s = commentStrip({
      comments: [tc('late', 'Jonas', 99), tc('done', 'Tereza', 2, 'hype', { status: 'resolved' })],
      comps,
      compId: 'hype-comp',
      frame: 0,
    });
    expect(s?.marks.find((m: { id: string }) => m.id === 'late')?.at).toBe(1);
    expect(s?.marks.find((m: { id: string }) => m.id === 'done')?.resolved).toBe(true);
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('CommentStrip (render) — read-only', () => {
  test('draws the header and a face per thread at its place; a click seeks, nothing edits', async () => {
    const { CommentStrip } = await import('../client/v2/timeline/comment-strip.jsx');
    const { commentStrip } = await model();
    const strip = commentStrip({
      comments: [tc('a', 'Tereza', 6), tc('b', 'Jonas', 21)],
      comps,
      compId: 'hype-comp',
      frame: 360,
    });
    const seeks: Array<[string, number]> = [];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <CommentStrip
          strip={strip}
          placement={{ left: 100, width: 600 }}
          onSeek={(id, s) => seeks.push([id, s])}
        />
      )
    );
    const q = (sel: string) => host?.querySelector<HTMLElement>(sel) ?? null;
    expect(q('[data-testid="comment-strip"]')).not.toBeNull();
    expect(
      q('[data-testid="comment-strip-readout"]')?.textContent?.replace(/\s+/g, ' ').trim()
    ).toBe('0:12 / 0:30');
    expect(q('[data-testid="comment-strip-name"]')?.textContent?.trim()).toBe('Hype trailer');
    expect(q('[data-testid="comment-strip-count"]')?.textContent?.trim()).toBe(
      '2 comments on this video'
    );
    const a = q('[data-testid="comment-strip-mark-a"]');
    const b = q('[data-testid="comment-strip-mark-b"]');
    expect(a?.style.left).toBe('20%');
    expect(b?.style.left).toBe('70%');
    expect(a?.getAttribute('title')).toContain('Tereza');
    // read-only: no transport, no clip rows, no add / delete controls
    expect(host?.querySelectorAll('input, textarea, [contenteditable]').length).toBe(0);
    await act(async () => b?.click());
    expect(seeks).toEqual([['b', 21]]);
  });
});

describe('CommentStripHost — Preview only', () => {
  const store = (posted: unknown[]) => ({
    shellCore: {
      activeComps: comps,
      activePath: 'ui/Matchday.tsx',
      commentsByFile: { 'ui/Matchday.tsx': [tc('a', 'Tereza', 6), tc('b', 'Jonas', 21)] },
      iframesRef: { current: new Map() },
      postToActiveCanvas: (m: unknown) => posted.push(m),
      setTimelineFrame: () => {},
      timelineCompId: 'hype-comp',
      timelineFrame: 360,
    },
  });
  async function mountHost(posted: unknown[] = []) {
    const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
    const { CommentStripHost } = await import('../client/v2/timeline/comment-strip-host.jsx');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <ShellStoreContext.Provider value={store(posted) as never}>
          <CommentStripHost />
        </ShellStoreContext.Provider>
      )
    );
  }

  test('Preview draws the strip; Edit and Viewing do not (Edit has the timeline island)', async () => {
    const { shellMode } = await import('../client/v2/shell/use-canvas-mode-lane.js');
    await mountHost();
    for (const [mode, drawn] of [
      ['preview', true],
      ['edit', false],
      ['viewing', false],
      ['preview', true],
    ] as const) {
      await act(async () => shellMode.select(mode));
      expect(host?.querySelector('[data-testid="comment-strip"]') !== null).toBe(drawn);
    }
    expect(host?.querySelector('[data-testid="comment-strip-count"]')?.textContent?.trim()).toBe(
      '2 comments on this video'
    );
  });

  test('a face seeks the Player to its second: the shell’s playhead and a timeline-seek to the canvas', async () => {
    const { shellMode } = await import('../client/v2/shell/use-canvas-mode-lane.js');
    const posted: unknown[] = [];
    await mountHost(posted);
    await act(async () => shellMode.select('preview'));
    await act(async () =>
      host?.querySelector<HTMLElement>('[data-testid="comment-strip-mark-b"]')?.click()
    );
    expect(posted).toEqual([{ dgn: 'timeline-seek', frame: 630, id: 'hype-comp' }]);
  });
});
