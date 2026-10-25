// P8 c7 (10 co-comment-video) — a pin on a video keeps its moment, and each such thread is a marker on the
// timeline strip: the author's face on its tone, at its second; a click puts the playhead there; the strip's
// header says "2 comments on this video". The pins come from comments that name the video artboard and a time
// (`c.t`, seconds — comments/where.ts); the old frame-anchored 💬 pins (`c.timeline`) are unchanged.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TimelineIslandContext } from '../client/v2/timeline/island-context.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';

const FILE = '.design/ui/Reels.tsx';
const ID = 'reels';
const clip = (i: number) => ({
  stableId: `b${i}`,
  label: `Klip ${i}`,
  from: i * 180,
  duration: 180,
  series: true,
  mediaTag: 'Video',
  mediaSrc: `assets/klip-${i}.mp4`,
  mediaProps: { muted: false },
  keyframes: [],
});

describe('comment markers on the timeline strip', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(async () => {
    await act(async () => root?.unmount());
    await new Promise((r) => setTimeout(r, 20));
    host?.remove();
    document.body.innerHTML = '';
    root = null;
  });

  const mount = (comments: unknown[], seeks: number[] = []) => {
    host = document.createElement('div');
    host.style.width = '1200px';
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        createElement(
          TimelineIslandContext.Provider,
          {
            value: {
              size: 'full',
              kept: false,
              onToggleSize: () => {},
              canvas: FILE,
              canEdit: true,
              empty: null,
            },
          },
          createElement(TimelinePanel, {
            comps: [
              {
                id: 'c1',
                fps: 30,
                durationInFrames: 900,
                width: 1080,
                height: 1920,
                artboardId: ID,
              },
            ],
            compId: 'c1',
            sequences: Array.from({ length: 5 }, (_, i) => clip(i)),
            total: 900,
            frame: 360,
            height: 260,
            resolveMediaUrl: (src: string) => `/.design/${src}`,
            comments,
            onRetime: () => {},
            onSelect: () => {},
            onSeek: (f: number) => seeks.push(f),
            onClipVerb: () => {},
          })
        )
      );
    });
    return (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  };

  const pins = [
    { id: 'c-t', author: 'Tereza', t: 12, artboard: ID, status: 'open', text: 'Logo moc brzo' },
    { id: 'c-j', author: 'Jonas', t: 21, artboard: ID, status: 'open', text: 'Souhlas' },
    // another video's thread is not this video's
    { id: 'c-x', author: 'Petra', t: 3, artboard: 'other', status: 'open', text: 'x' },
  ];

  test('one marker per timed thread of THIS video: the face, at its second; a click seeks', () => {
    const seeks: number[] = [];
    const q = mount(pins, seeks);
    expect(q('timeline-comments-strip')).not.toBeNull();
    const t = q('timeline-comment-c-t');
    const j = q('timeline-comment-c-j');
    expect(t?.textContent).toBe('T');
    expect(j?.textContent).toBe('J');
    expect(q('timeline-comment-c-x')).toBeNull();
    expect(t?.classList.contains('tl-comment-pin--face')).toBe(true);
    expect(t?.querySelector('.k-av')).not.toBeNull();
    act(() => t?.click());
    act(() => j?.click());
    expect(seeks).toEqual([360, 630]);
  });

  test('the strip says how many: "2 comments on this video", "1 comment on this video", none when none', () => {
    expect(mount(pins)('timeline-comments-count')?.textContent).toBe('2 comments on this video');
  });

  test('one comment is singular; no timed comments, no count', async () => {
    expect(mount([pins[0]])('timeline-comments-count')?.textContent).toBe(
      '1 comment on this video'
    );
    await act(async () => root?.unmount());
    host?.remove();
    expect(mount([])('timeline-comments-count')).toBeNull();
  });

  test('the older frame-anchored 💬 pin keeps its face-less look', () => {
    const q = mount([
      { id: 'c-old', author: 'Jonas', text: 'cut here', timeline: { frame: 90 }, status: 'open' },
    ]);
    const pin = q('timeline-comment-c-old');
    expect(pin?.textContent).toBe('💬');
    expect(pin?.classList.contains('tl-comment-pin--face')).toBe(false);
  });
});
