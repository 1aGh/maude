// Round 11 (15 an-video): the Preview strip of a video board marks the NOTES pinned to it as well as the comment
// threads — "0:12 / 0:30 · Reels · 2 notes · 1 comment", a bar in the note's paper from its start to its end.
// One strip (p8-r11-10's), extended; read-only, a click seeks.
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
    id: 'reel-comp',
    artboardId: 'reel',
    artboardLabel: 'Reels 9:16',
    fps: 30,
    durationInFrames: 900,
  },
  { id: 'wide-comp', artboardId: 'wide', artboardLabel: '16:9', fps: 30, durationInFrames: 300 },
];
const note = (id: string, start: number, end: number, artboard = 'reel', fill = '#f2a08c') => ({
  id,
  type: 'sticky',
  text: `${id} says`,
  fill,
  timeRange: { artboard, start, end },
});
const thread = (id: string, t: number, artboard = 'reel') => ({
  id,
  author: 'Tereza',
  text: 'a thread',
  status: 'open',
  artboard,
  t,
});

describe('commentStrip with notes (pure)', () => {
  test('notes of ONE video: their span on the track, their paper, and "2 notes · 1 comment"', async () => {
    const { commentStrip } = await model();
    const s = commentStrip({
      board: [note('n1', 12, 15), note('n2', 21, 23.4, 'reel', '#f7e08a'), note('x', 3, 6, 'wide')],
      comments: [thread('c1', 25)],
      comps,
      compId: 'reel-comp',
      frame: 360,
    });
    expect(s?.countLine).toBe('2 notes · 1 comment');
    expect(s?.notes.map((n: { id: string }) => n.id)).toEqual(['n1', 'n2']);
    const n1 = s?.notes[0];
    expect(Math.round(n1.at * 1000) / 10).toBe(40);
    expect(Math.round(n1.width * 1000) / 10).toBe(10);
    expect(n1.seconds).toBe(12);
    expect(n1.colour).toBe('#f2a08c');
    expect(n1.on).toBe(true); // the playhead (0:12) is inside 0:12-0:15
    expect(s?.notes[1].on).toBe(false);
    expect(s?.marks.map((m: { id: string }) => m.id)).toEqual(['c1']);
  });

  test('notes alone draw the strip ("1 note"); a peer string never becomes a colour', async () => {
    const { commentStrip } = await model();
    const s = commentStrip({
      board: [note('n1', 12, 15, 'reel', 'url(javascript:alert(1))')],
      comments: [],
      comps,
      compId: null,
      frame: 0,
    });
    expect(s?.artboardId).toBe('reel');
    expect(s?.countLine).toBe('1 note');
    expect(s?.notes[0].colour).toBe('var(--object-yellow)');
    expect(s?.marks).toEqual([]);
  });

  test('comments only keep the p8-r11-10 wording; no notes and no threads draws nothing', async () => {
    const { commentStrip } = await model();
    expect(
      commentStrip({
        board: [],
        comments: [thread('c1', 3), thread('c2', 4)],
        comps,
        compId: 'reel-comp',
        frame: 0,
      })?.countLine
    ).toBe('2 comments on this video');
    expect(
      commentStrip({
        board: [note('n', 1, 2, 'elsewhere')],
        comments: [],
        comps,
        compId: 'reel-comp',
        frame: 0,
      })
    ).toBeNull();
  });

  test('a note past the end is clamped onto the track; a zero-length pin stays a visible bar', async () => {
    const { commentStrip } = await model();
    const s = commentStrip({
      board: [note('late', 29, 99), note('pt', 6, 6)],
      comments: [],
      comps,
      compId: 'reel-comp',
      frame: 0,
    });
    const late = s?.notes.find((n: { id: string }) => n.id === 'late');
    expect(late.at + late.width).toBeLessThanOrEqual(1.0000001);
    expect(s?.notes.find((n: { id: string }) => n.id === 'pt').width).toBeGreaterThan(0);
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('CommentStrip (render) with notes', () => {
  test('a bar per note in its paper at its place; a click seeks to its start; the count line is the board’s', async () => {
    const { CommentStrip } = await import('../client/v2/timeline/comment-strip.jsx');
    const { commentStrip } = await model();
    const strip = commentStrip({
      board: [note('n1', 12, 15), note('n2', 21, 24, 'reel', '#f7e08a')],
      comments: [thread('c1', 25)],
      comps,
      compId: 'reel-comp',
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
          placement={{ left: 0, width: 600 }}
          onSeek={(id, s) => seeks.push([id, s])}
        />
      )
    );
    const q = (sel: string) => host?.querySelector<HTMLElement>(sel) ?? null;
    expect(q('[data-testid="comment-strip-count"]')?.textContent?.trim()).toBe(
      '2 notes · 1 comment'
    );
    const n1 = q('[data-testid="comment-strip-note-n1"]');
    expect(n1?.style.left).toBe('40%');
    expect(n1?.style.width).toBe('10%');
    expect(n1?.getAttribute('aria-label')).toBe('Note on this part of the video');
    expect(n1?.hasAttribute('data-on')).toBe(true);
    expect(q('[data-testid="comment-strip-note-n2"]')?.hasAttribute('data-on')).toBe(false);
    expect(q('[data-testid="comment-strip-mark-c1"]')).not.toBeNull();
    await act(async () => q('[data-testid="comment-strip-note-n2"]')?.click());
    expect(seeks).toEqual([['n2', 21]]);
    expect(host?.querySelectorAll('input, textarea, [contenteditable]').length).toBe(0);
  });
});

describe('CommentStripHost reads the canvas board', () => {
  test('Preview strip carries the notes the board holds for the followed video', async () => {
    const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
    const { CommentStripHost } = await import('../client/v2/timeline/comment-strip-host.jsx');
    const { shellMode } = await import('../client/v2/shell/use-canvas-mode-lane.js');
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ format: 'maude-annotations', v: 2, elements: [note('n1', 12, 15)] }),
        { status: 200 }
      )) as unknown as typeof fetch;
    try {
      const posted: unknown[] = [];
      const value = {
        shellCore: {
          activeComps: comps,
          activePath: 'ui/Matchday.tsx',
          commentsByFile: { 'ui/Matchday.tsx': [] },
          iframesRef: { current: new Map() },
          postToActiveCanvas: (m: unknown) => posted.push(m),
          setTimelineFrame: () => {},
          timelineCompId: 'reel-comp',
          timelineFrame: 360,
        },
      };
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      await act(async () => shellMode.select('preview'));
      await act(async () =>
        root?.render(
          <ShellStoreContext.Provider value={value as never}>
            <CommentStripHost />
          </ShellStoreContext.Provider>
        )
      );
      await act(async () => new Promise((r) => setTimeout(r, 30)));
      expect(host?.querySelector('[data-testid="comment-strip-count"]')?.textContent?.trim()).toBe(
        '1 note'
      );
      await act(async () =>
        host?.querySelector<HTMLElement>('[data-testid="comment-strip-note-n1"]')?.click()
      );
      expect(posted).toEqual([{ dgn: 'timeline-seek', frame: 360, id: 'reel-comp' }]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
