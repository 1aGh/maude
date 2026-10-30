// S7.18 (06 ad-timeline, 07 ve-advanced) — the Timeline's Advanced, at its foot. Closed it is one quiet row; open it
// turns the ruler to frames (Timecode | Frames), the header's time to a timecode, draws the keyframes, and shows
// the video's settings, the selected keyframe's curve (which writes `video.easing.set`), the cut as code, and
// "+ track". The long-video badge warns past 3 600 frames (C22). Testids kept: timeline-readout,
// timeline-long-badge, timeline-kf-<i>-<k>.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  });
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { foldStore } from '../client/v2/fold/use-fold.js';
import { advancedStore } from '../client/v2/timeline/advanced/advanced-store.js';
import { CutAsCode, codeExcerpt } from '../client/v2/timeline/advanced/cut-as-code.jsx';
import { edlEntry, edlSlug, frameReadout, timecode } from '../client/v2/timeline/advanced/model.js';
import { TimelineIslandContext } from '../client/v2/timeline/island-context.js';
import { playbackStore } from '../client/v2/timeline/playhead.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';
import { describeKeyframes } from '../video/keyframes.ts';

const COMP = `import { interpolate, useCurrentFrame } from 'remotion';
const Intro = () => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [10, 30], [48, 0], { extrapolateRight: 'clamp' });
  return <div style={{ top: y }} />;
};
`;

const beat = (id: string, from: number, duration: number) => ({
  stableId: id,
  label: id,
  series: true,
  mediaTag: 'Video',
  mediaSrc: `assets/${id}.mp4`,
  from,
  duration,
  keyframes: [],
  keyframeInfo: [],
});
const SEQ = [
  beat('Oslava', 0, 240),
  {
    stableId: 'Intro',
    label: 'Intro',
    series: true,
    mediaTag: 'Video',
    mediaSrc: 'assets/intro.mp4',
    from: 240,
    duration: 210,
    keyframes: [{ from: 250, to: 270 }],
    keyframeInfo: describeKeyframes(COMP, 'Intro'),
  },
];

let root: Root | null = null;
let host: HTMLElement | null = null;
const verbs: Array<{ ref: unknown; verb: string; params: Record<string, unknown> }> = [];
const fetched: Array<{ url: string; init?: RequestInit }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  verbs.length = 0;
  fetched.length = 0;
  foldStore.set('timeline', false);
  advancedStore.setMode('timecode');
  advancedStore.selectKeyframe(null);
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    fetched.push({ url: String(url), init });
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  playbackStore.reset();
  globalThis.fetch = realFetch;
});

async function mount({ total = 450, frame = 105, sequences = SEQ as unknown[] } = {}) {
  host = document.createElement('div');
  host.style.width = '1200px';
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <TimelineIslandContext.Provider
        value={{ canvas: '.design/ui/Reel.tsx', canEdit: true, size: 'full' }}
      >
        <TimelinePanel
          comps={[
            {
              id: 'c1',
              artboardId: 'reels',
              fps: 30,
              durationInFrames: total,
              width: 270,
              height: 480,
            },
          ]}
          compId="c1"
          sequences={sequences}
          audio={[]}
          total={total}
          frame={frame}
          height={300}
          onSelect={() => {}}
          onClipVerb={(ref: unknown, verb: string, params: Record<string, unknown>) => {
            verbs.push({ ref, verb, params });
            return Promise.resolve({ ok: true });
          }}
        />
      </TimelineIslandContext.Provider>
    );
  });
}
const q = (sel: string) => document.querySelector(sel);
const all = (sel: string) => [...document.querySelectorAll(sel)];
const click = (sel: string) =>
  act(() => {
    (q(sel) as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const openAdvanced = () => act(() => foldStore.set('timeline', true));

describe('the numbers', () => {
  test('timecode: hours, minutes, seconds and the frame in the second', async () => {
    expect(timecode(354, 30)).toBe('00:00:11:24');
    expect(timecode(900, 30)).toBe('00:00:30:00');
    expect(timecode(0, 30)).toBe('00:00:00:00');
    expect(timecode(30 * 3725 + 7, 30)).toBe('01:02:05:07');
  });
  test('the foot reads "30 fps · frame 354 of 900 · 00:00:11:24"', async () => {
    expect(frameReadout({ fps: 30, frame: 354, total: 900 })).toBe(
      '30 fps · frame 354 of 900 · 00:00:11:24'
    );
  });
  test('the cut as an EDL entry, from what the video says', async () => {
    expect(edlEntry(SEQ[1], { fps: 30 })).toEqual({
      clip: 'intro.mp4',
      name: 'Intro',
      startSec: 8,
      durationFrames: 210,
    });
    expect(edlSlug('ui/Video Nabor.tsx')).toBe('video-nabor');
  });
});

describe('closed: what everyone sees', () => {
  test('one quiet row with its hint; no readout, no markers', async () => {
    await mount();
    expect(q('[data-testid="timeline-advanced-fold"]')).not.toBeNull();
    // P8 C3 (07 · .ve-tl-foot-hint) — Advanced lives at the foot of the FULL timeline
    expect(q('[data-testid="timeline-advanced-toggle"]')?.textContent).toContain(
      'Frame numbers, codec, keyframes, the cut as code'
    );
    expect(q('[data-testid="timeline-frame-readout"]')).toBeNull();
    expect(q('[data-testid="timeline-kf-1-0"]')).toBeNull();
    expect(q('[data-testid="timeline-readout"]')?.textContent).toContain('0:03');
  });
});

describe('open', () => {
  test('the foot reads frame and timecode; the header reads the timecode', async () => {
    await mount({ frame: 105 });
    openAdvanced();
    expect(q('[data-testid="timeline-frame-readout"]')?.textContent).toContain(
      '30 fps · frame 105 of 450 · 00:00:03:15'
    );
    expect(q('[data-testid="timeline-readout"]')?.textContent).toContain('00:00:03:15');
    expect(q('[data-testid="timeline-readout"]')?.textContent).toContain('00:00:15:00');
  });

  test('Frames turns the ruler to frame numbers; Timecode turns it back', async () => {
    await mount();
    openAdvanced();
    const labels = () => all('.tl-tick-label').map((e) => e.textContent ?? '');
    expect(labels().some((t) => /^\d+:\d\d$/.test(t))).toBe(true);
    click('[data-testid="timeline-ruler-frames"]');
    expect(labels().length).toBeGreaterThan(2);
    expect(labels().every((t) => /^\d+$/.test(t))).toBe(true);
    expect(labels()).toContain('0');
    click('[data-testid="timeline-ruler-timecode"]');
    expect(labels().some((t) => /^\d+:\d\d$/.test(t))).toBe(true);
  });

  test('the keyframe markers appear, with their testid', async () => {
    await mount();
    openAdvanced();
    // P8 C10 (07 ve-advanced): a diamond at each end of the animated window (250–270f), the first one picks it
    expect(all('[data-testid^="timeline-kf-"]').map((e) => e.getAttribute('data-testid'))).toEqual([
      'timeline-kf-1-0',
      'timeline-kf-1-0-to',
    ]);
  });

  test('07 ve-advanced (P8 C10): Easing is a card of its own; Render settings and The cut as code are one stack; neither is inside the timeline', async () => {
    await mount();
    openAdvanced();
    const easing = q('[data-testid="timeline-advanced-easing"]') as HTMLElement;
    const stack = q('[data-testid="timeline-advanced-stack"]') as HTMLElement;
    expect(easing.querySelector('[data-testid="timeline-keyframe"]')).not.toBeNull();
    expect([...stack.children].map((c) => c.getAttribute('data-testid'))).toEqual([
      'timeline-render-settings',
      'timeline-cut-as-code',
    ]);
    // the stack stands in the inspector's column: the canvas fits left of it
    expect(stack.getAttribute('data-occludes')).toBe('right');
    expect(easing.getAttribute('data-occludes')).toBeNull();
    expect(easing.closest('.tl-island, [data-testid="timeline-island"]')).toBeNull();
    expect(stack.closest('.tl-island, [data-testid="timeline-island"]')).toBeNull();
  });

  test('a keyframe is a diamond, filled where the playhead is — never a range block', async () => {
    await mount({ frame: 270 });
    openAdvanced();
    const [from, to] = all('[data-testid^="timeline-kf-"]') as HTMLElement[];
    // the clip runs 240 + 210: 250f is 10/210 in, 270f is 30/210 in — a point each, no width
    expect(from?.style.width).toBe('');
    expect(Number.parseFloat(from?.style.left ?? '')).toBeCloseTo((10 / 210) * 100, 1);
    expect(Number.parseFloat(to?.style.left ?? '')).toBeCloseTo((30 / 210) * 100, 1);
    expect(from?.classList.contains('is-at')).toBe(false);
    expect(to?.classList.contains('is-at')).toBe(true);
    // the other end, clicked, seeks there too
    click('[data-testid="timeline-kf-1-0"]');
    expect(q('[data-testid="timeline-easing"]')).not.toBeNull();
  });

  test('"+ track" draws Video 2 and Music 2 empty, once each', async () => {
    await mount();
    openAdvanced();
    expect(q('[data-track="video2"]')).toBeNull();
    click('[data-testid="timeline-add-track-video2"]');
    expect(q('[data-track="video2"]')).not.toBeNull();
    expect((q('[data-testid="timeline-add-track-video2"]') as HTMLButtonElement).disabled).toBe(
      true
    );
    click('[data-testid="timeline-add-track-music2"]');
    expect(q('[data-track="music2"]')).not.toBeNull();
    expect(all('[data-track]').map((t) => t.getAttribute('data-track'))).toEqual([
      'text',
      'gfx',
      'video2',
      'video',
      'music',
      'music2',
    ]);
  });
});

describe('a keyframe’s curve', () => {
  test('click a marker: the foot shows its easing; a handle key writes video.easing.set', async () => {
    await mount();
    openAdvanced();
    expect(q('[data-testid="timeline-keyframe-none"]')).not.toBeNull();
    click('[data-testid="timeline-kf-1-0"]');
    expect(q('[data-testid="timeline-easing"]')).not.toBeNull();
    expect(q('[data-testid="timeline-easing-value"]')?.textContent).toBe('linear');
    const handle = q('[data-testid="timeline-easing-handle-0"]') as Element;
    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(verbs).toEqual([
      {
        ref: null,
        verb: 'video.easing.set',
        params: { component: 'Intro', index: 0, bezier: [0, 0.02, 1, 1] },
      },
    ]);
  });

  test('a curve the video has reads as cubic-bezier(…); "Straight line" takes it off', async () => {
    const withCurve = COMP.replace(
      "{ extrapolateRight: 'clamp' }",
      '{ easing: Easing.bezier(0.22, 1, 0.36, 1) }'
    );
    await mount({
      sequences: [{ ...SEQ[1], keyframeInfo: describeKeyframes(withCurve, 'Intro') }],
    });
    openAdvanced();
    click('[data-testid="timeline-kf-0-0"]');
    expect(q('[data-testid="timeline-easing-value"]')?.textContent).toBe(
      'cubic-bezier(0.22, 1, 0.36, 1)'
    );
    click('[data-testid="timeline-easing-straight"]');
    expect(verbs[0]).toMatchObject({
      verb: 'video.easing.set',
      params: { component: 'Intro', index: 0, bezier: null },
    });
  });

  test('a viewer sees the curve and cannot move it', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <TimelineIslandContext.Provider
          value={{ canvas: '.design/ui/Reel.tsx', canEdit: false, size: 'full' }}
        >
          <TimelinePanel
            comps={[{ id: 'c1', artboardId: 'reels', fps: 30, durationInFrames: 450 }]}
            compId="c1"
            sequences={SEQ}
            total={450}
            frame={0}
            onClipVerb={() => Promise.resolve({ ok: true })}
          />
        </TimelineIslandContext.Provider>
      );
    });
    openAdvanced();
    click('[data-testid="timeline-kf-1-0"]');
    expect(q('[data-testid="timeline-easing-straight"]')).toBeNull();
    act(() => {
      (q('[data-testid="timeline-easing-handle-0"]') as Element).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
      );
    });
    expect(verbs).toEqual([]);
  });
});

describe('long videos (C22)', () => {
  test('past 3 600 frames the badge warns; at 900 or 3 600 it does not', async () => {
    await mount({ total: 900 });
    expect(q('[data-testid="timeline-long-badge"]')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    await mount({ total: 3600 });
    expect(q('[data-testid="timeline-long-badge"]')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    await mount({ total: 4800 });
    const badge = q('[data-testid="timeline-long-badge"]') as HTMLElement;
    expect(badge.textContent).toContain('2:40');
    expect(badge.getAttribute('title')).toBe(
      'reels is 2:40 long — one export goes up to 2:00 (3,600 frames at 30 fps).'
    );
  });

  test('the badge opens Advanced, where Allow longer stores the artboard’s ceiling', async () => {
    await mount({ total: 4800 });
    click('[data-testid="timeline-long-badge"]');
    expect(q('[data-testid="timeline-render-settings"]')).not.toBeNull();
    expect(q('[data-testid="timeline-cap-line"]')?.textContent).toContain('2:40 long');
    click('[data-testid="timeline-allow-longer"]');
    const call = fetched.find((f) => f.url === '/_api/present-meta');
    expect(call?.init?.method).toBe('PATCH');
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      file: '.design/ui/Reel.tsx',
      maxFrames: { reels: 18000 },
    });
  });
});

describe('the cut as code', () => {
  test('EDL shows the picked clip as an entry; Open in code view hands over the canvas', async () => {
    await mount();
    openAdvanced();
    click('[data-testid="timeline-kf-1-0"]');
    const text = q('[data-testid="timeline-cut-text"]')?.textContent ?? '';
    expect(JSON.parse(text)).toMatchObject({
      clip: 'intro.mp4',
      name: 'Intro',
      durationFrames: 210,
    });
  });

  test('Code shows the component’s source from the canvas; a role that cannot read it is told so', async () => {
    const opened: unknown[] = [];
    const ok = (async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('canvas-source') ? { ok: true, file: 'ui/Reel.tsx', source: COMP } : {}
        ),
        { status: 200 }
      )) as unknown as typeof fetch;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <CutAsCode
          canvas="ui/Reel.tsx"
          seq={SEQ[1]}
          fps={30}
          canRead
          fetchImpl={ok}
          open={(r: unknown) => opened.push(r)}
        />
      );
    });
    click('[data-testid="timeline-cut-code"]');
    await act(async () => {
      await Bun.sleep(10);
    });
    expect(q('[data-testid="timeline-cut-text"]')?.textContent).toContain('const Intro = () => {');
    click('[data-testid="timeline-open-in-code"]');
    expect(opened).toEqual([{ canvas: 'ui/Reel.tsx' }]);

    const refused = (async (url: string) =>
      new Response(JSON.stringify({ error: 'read-only' }), {
        status: url.includes('canvas-source') ? 403 : 200,
      })) as unknown as typeof fetch;
    act(() => root?.unmount());
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <CutAsCode canvas="ui/Reel.tsx" seq={SEQ[1]} fps={30} canRead fetchImpl={refused} />
      );
    });
    click('[data-testid="timeline-cut-code"]');
    await act(async () => {
      await Bun.sleep(10);
    });
    expect(q('[data-testid="timeline-cut-text"]')?.textContent).toBe(
      'Your role can’t read the code.'
    );
  });

  test('codeExcerpt starts at the component’s line and stops short of a long one', async () => {
    expect(codeExcerpt(COMP, 'Intro')?.split('\n')[0]).toBe('const Intro = () => {');
    expect(codeExcerpt(COMP, 'Nope')).toBeNull();
    const long = `const Big = () => {\n${'  x;\n'.repeat(40)}};\n`;
    const ex = codeExcerpt(long, 'Big') ?? '';
    expect(ex.split('\n').length).toBe(19);
    expect(ex.endsWith('…')).toBe(true);
  });
});
