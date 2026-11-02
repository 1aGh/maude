// S7.16 — what the real Timeline draws for footage that is not here yet and for a long video: the waiting clip says whose
// Mac, the preparing ones wear a percent, a narrow block hides its name (its title says it), a busy track folds to
// "Text · 18", ⌘K is told the clips, and the Inspector says "Your edit is safe."
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
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
import { clearAssetAnswers, createAssetStateLane } from '../client/v2/assets/asset-state-lane.js';
import { trackKey } from '../client/v2/timeline/advanced/advanced-store.js';
import { clipSearchRows } from '../client/v2/timeline/clip-search.js';
import { trackFold } from '../client/v2/timeline/fold.js';
import { TimelineIslandContext } from '../client/v2/timeline/island-context.js';
import { timelineSelection } from '../client/v2/timeline/selection.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';

const CANVAS = 'ui/Touchdown.tsx';
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  await new Promise((r) => setTimeout(r, 20)); // late filmstrip callbacks land before the next test
  host?.remove();
  document.body.innerHTML = '';
  root = null;
  clearAssetAnswers();
});
beforeEach(() => {
  timelineSelection.set(null);
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
});

const JONAS = { name: 'jonas', kind: 'mac', self: false };
const beat = (i: number, label: string, src: string, over: Record<string, unknown> = {}) => ({
  stableId: `b${i}`,
  label,
  from: i * 90,
  duration: 90,
  series: true,
  mediaTag: 'Video',
  mediaSrc: src,
  mediaProps: { muted: false },
  keyframes: [],
  ...over,
});
const title = (i: number) => ({
  stableId: `t${i}`,
  label: `Titulek ${i}`,
  from: i * 30,
  duration: 30,
  mediaTag: 'Title',
  text: `T${i}`,
  keyframes: [],
});
const SEQS = [
  beat(0, 'Dron klesá', 'assets/9f3a2c1e.mov'),
  beat(1, 'Touchdown', 'assets/touchdown.mp4'),
  beat(2, 'IMG_4471.mov · 4K', 'assets/img4471.mov'),
  beat(3, 'IMG_4472.mov · 4K', 'assets/img4472.mov'),
  title(0),
  title(1),
  title(2),
];
const COMPS = [
  { id: 'c1', fps: 30, durationInFrames: 360, width: 1920, height: 1080, artboardId: 'touchdown' },
];

async function tell(items: unknown[]) {
  const frame = { contentWindow: { postMessage: () => {} }, getAttribute: () => CANVAS };
  const lane = createAssetStateLane({
    win: { addEventListener: () => {}, removeEventListener: () => {} } as unknown as Window,
    frames: () => [frame as unknown as Element],
    canvasOrigin: () => 'http://127.0.0.1:1',
    setTimer: () => 1,
    clearTimer: () => {},
    fetchImpl: (async () =>
      new Response(JSON.stringify({ items }), { status: 200 })) as unknown as typeof fetch,
  });
  await lane.refresh();
  lane.stop();
}

function mount(props: Record<string, unknown> = {}) {
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
            canvas: CANVAS,
            canEdit: true,
            empty: null,
          },
        },
        createElement(TimelinePanel, {
          comps: COMPS,
          compId: 'c1',
          sequences: SEQS,
          total: 360,
          frame: 0,
          height: 260,
          resolveMediaUrl: (src: string) => `/.design/${src}`,
          onRetime: () => {},
          onSelect: () => {},
          onSeek: () => {},
          onClipVerb: () => {},
          ...props,
        })
      )
    );
  });
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('footage that is not here yet', () => {
  test('the clip says whose Mac, quietly; the preparing ones wear a percent; the header counts them', async () => {
    await tell([
      { rel: 'assets/9f3a2c1e.mov', state: 'waiting', who: JONAS },
      { rel: 'assets/img4471.mov', state: 'uploading', progress: 0.62 },
      { rel: 'assets/img4472.mov', state: 'uploading', progress: 0.18 },
    ]);
    mount();
    const waiting = q('timeline-seq-0');
    expect(waiting?.getAttribute('data-footage')).toBe('waiting');
    expect(waiting?.textContent).toContain("Dron klesá · waiting for Jonas's Mac");
    expect(q('timeline-seq-1')?.getAttribute('data-footage')).toBeNull();
    expect(q('timeline-prep-chip-2')?.textContent).toBe('62%');
    expect(q('timeline-prep-chip-3')?.textContent).toBe('18%');
    expect(q('timeline-prep-status')?.textContent).toContain('2 clips still preparing');
  });

  test('missing is its own state, never the waiting one', async () => {
    await tell([{ rel: 'assets/9f3a2c1e.mov', state: 'missing' }]);
    mount();
    expect(q('timeline-seq-0')?.getAttribute('data-footage')).toBe('missing');
    expect(q('timeline-seq-0')?.textContent).toContain('· missing');
    expect(q('timeline-prep-status')).toBeNull();
  });

  test('every file here: nothing is said', async () => {
    await tell([{ rel: 'assets/9f3a2c1e.mov', state: 'here' }]);
    mount();
    expect(document.querySelector('[data-footage]')).toBeNull();
    expect(q('timeline-prep-status')).toBeNull();
  });

  test('the Inspector of a waiting clip: Status and the safe line', async () => {
    await tell([{ rel: 'assets/9f3a2c1e.mov', state: 'waiting', who: JONAS }]);
    mount({ selectedClipId: 'b0' });
    const sel = timelineSelection.get();
    expect(sel?.canvas).toBe(CANVAS);
    expect(sel?.seq.mediaSrc).toBe('assets/9f3a2c1e.mov');
    const { footageForSrc } = await import('../client/v2/timeline/footage-state.js');
    expect(footageForSrc(sel?.canvas, sel?.seq.mediaSrc)?.line).toBe("Waiting for Jonas's Mac");
  });
});

describe('a long video', () => {
  test('three titles on Text: its name is a button; folded it reads "Text · 3" and draws no rows', () => {
    mount();
    const fold = q('timeline-track-fold-text');
    expect(fold?.textContent).toBe('Text');
    expect(q('timeline-row-4')).not.toBeNull();
    act(() => fold?.click());
    expect(q('timeline-track-fold-text')?.textContent).toBe('Text · 3');
    expect(q('timeline-track-text')?.getAttribute('data-folded')).toBe('1');
    expect(q('timeline-row-4')).toBeNull();
    expect(trackFold.isFolded(trackKey(CANVAS, 'touchdown'), 'text')).toBe(true);
    act(() => q('timeline-track-fold-text')?.click());
    expect(q('timeline-row-4')).not.toBeNull();
  });

  test('a track with one thing has no fold button (nothing to put away)', () => {
    mount({ sequences: SEQS.slice(0, 5) });
    expect(q('timeline-track-fold-text')).toBeNull();
    expect(q('timeline-track-text')).not.toBeNull();
  });

  test('a block too narrow to read hides its name and its title says where and how long', () => {
    // 6 000 frames across ~1 000 px: every 90-frame beat is ~15 px wide
    const long = Array.from({ length: 40 }, (_, i) =>
      beat(i, `Akce ${i}`, `assets/akce-${i}.mp4`, { from: i * 150, duration: 150 })
    );
    mount({
      sequences: long,
      comps: [{ ...COMPS[0], durationInFrames: 6000 }],
      total: 6000,
    });
    const b = q('timeline-seq-21');
    expect(b?.getAttribute('data-names')).toBe('off');
    expect(b?.getAttribute('title')).toBe('Akce 21 · akce-21 · 0:05');
  });

  test('⌘K is told the clips of this video, by name', () => {
    mount();
    const rows = clipSearchRows();
    expect(rows.map((r: { name: string }) => r.name)).toContain('Touchdown');
    expect(rows.find((r: { name: string }) => r.name === 'Touchdown')?.group).toBe('clips');
  });

  test('closing the timeline takes the clips away from ⌘K', () => {
    mount();
    act(() => root?.unmount());
    root = null;
    expect(clipSearchRows()).toEqual([]);
  });
});
