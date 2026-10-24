// S7.10 — what the real Timeline does with a clip you pick, a join you click and a video that has no sound:
// the selection it hands the right-hand inspector, the join picker titled with both clips, the "how should it sit?" ask
// for a vertical clip on a wide video, and the Music line of a silent one. (The rows themselves are
// test/clip-inspector-rows.test.ts; the numbers are test/join-fit-model.test.ts.)

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
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
import { probeSize, resetFitMemory, resetProbeCache } from '../client/v2/timeline/fit-model.js';
import { timelineSelection } from '../client/v2/timeline/selection.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = '';
  root = null;
});
beforeEach(() => {
  timelineSelection.set(null);
  resetFitMemory();
  resetProbeCache();
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
});

const beat = (i: number, label: string, over: Record<string, unknown> = {}) => ({
  stableId: `b${i}`,
  label,
  from: i * 90,
  duration: 90,
  series: true,
  mediaTag: 'Video',
  mediaSrc: `assets/${label}.mp4`,
  mediaProps: { muted: false },
  keyframes: [],
  ...over,
});
const TITLE = {
  stableId: 't',
  label: 'SRDCE',
  from: 0,
  duration: 300,
  mediaTag: 'Title',
  text: 'SRDCE',
  titleMotion: { preset: 'fade', frames: null },
  keyframes: [],
};
const SEQS = [beat(0, 'Tunel'), beat(1, 'Touchdown'), beat(2, 'Oslava'), beat(3, 'Logo'), TITLE];
const WIDE = [
  { id: 'c1', fps: 30, durationInFrames: 360, width: 1920, height: 1080, artboardId: 'reel' },
];

type Verb = [unknown, string, unknown];
function mount(props: Record<string, unknown> = {}) {
  const verbs: Verb[] = [];
  host = document.createElement('div');
  host.style.width = '1200px';
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <TimelinePanel
        comps={WIDE}
        compId="c1"
        sequences={SEQS}
        total={360}
        frame={0}
        height={260}
        resolveMediaUrl={(src: string) => `/.design/${src}`}
        onRetime={() => {}}
        onSelect={() => {}}
        onClipVerb={(ref: unknown, verb: string, params: unknown) => {
          verbs.push([ref, verb, params]);
        }}
        onReorder={() => {}}
        onReorderMove={() => {}}
        onToggleHide={() => {}}
        onRemove={() => {}}
        {...props}
      />
    );
  });
  return verbs;
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

describe('a clip you pick is the right-hand inspector’s selection', () => {
  test('a beat is a Clip: its numbers, its label, and a pipe that writes to THAT clip', () => {
    const verbs = mount({ selectedClipId: 'b1' });
    const sel = timelineSelection.get();
    expect(sel?.kind).toBe('clip');
    expect(sel?.stableId).toBe('b1');
    expect(sel?.label).toBe('Touchdown');
    expect(sel?.seq.duration).toBe(90);
    expect(sel?.seq.mediaSrc).toBe('assets/Touchdown.mp4');
    expect(sel?.fps).toBe(30);
    expect(sel?.artboardId).toBe('reel');
    sel?.onVerb('speed', { rate: 2 });
    sel?.onOp('fit', { fit: 'blur' });
    expect(verbs).toEqual([
      [{ stableId: 'b1', index: 1 }, 'speed', { rate: 2 }],
      [{ stableId: 'b1', index: 1 }, 'video.fit', { fit: 'blur' }],
    ]);
  });

  test('plain JSX on its own is a Title, with its words and its motion', () => {
    mount({ selectedClipId: 't' });
    const sel = timelineSelection.get();
    expect(sel?.kind).toBe('title');
    expect(sel?.seq.text).toBe('SRDCE');
    expect(sel?.seq.titleMotion).toEqual({ preset: 'fade', frames: null });
  });

  test('the join after a beat rides on it (Advanced › Transition frames)', () => {
    mount({
      selectedClipId: 'b1',
      transitions: [{ afterIndex: 1, dur: 20, presentation: 'wipe' }],
      transitionClips: [{ stableId: 'tr0' }],
    });
    expect(timelineSelection.get()?.transitionAfter).toEqual({
      k: 0,
      stableId: 'tr0',
      dur: 20,
      presentation: 'wipe',
    });
  });

  test('nothing picked, or a pick that goes away, leaves nothing selected; unmounting lets go', () => {
    mount();
    expect(timelineSelection.get()).toBeNull();
    mount({ selectedClipId: 'b0' });
    expect(timelineSelection.get()?.stableId).toBe('b0');
    act(() => root?.unmount());
    root = null;
    expect(timelineSelection.get()).toBeNull();
  });

  test('a canvas selection lets go of the clip, and the Timeline’s highlight with it', () => {
    let cleared = 0;
    mount({ selectedClipId: 'b0', onSelect: (id: unknown) => id === null && cleared++ });
    expect(timelineSelection.get()).not.toBeNull();
    timelineSelection.release();
    expect(timelineSelection.get()).toBeNull();
    expect(cleared).toBe(1);
  });

  test('double-click and Adjust… only select — there is no dialog any more', () => {
    const picked: unknown[] = [];
    mount({ onSelect: (id: unknown) => picked.push(id) });
    const block = q('timeline-seq-1');
    act(() => {
      block?.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 200, clientY: 80 })
      );
    });
    expect(picked).toEqual(['b1']);
    expect(q('timeline-inspector')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('a join (ve-transition)', () => {
  const props = {
    transitions: [{ afterIndex: 2, dur: 15, presentation: 'fade' }],
    transitionClips: [{ stableId: 'tr0' }],
  };
  const open = () => {
    const verbs = mount(props);
    act(() => {
      q('timeline-seam-0')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
      );
    });
    return verbs;
  };

  test('click the dot: a picker titled with both clips, six tiles, Fade lit, Length 0.5 s', () => {
    open();
    expect(q('timeline-transition-title')?.textContent).toBe('Oslava → Logo');
    const grid = q('timeline-transition-grid');
    expect([...(grid?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Cut',
      'Fade',
      'Slide',
      'Wipe',
      'Flip',
      'Clock wipe',
    ]);
    expect(grid?.querySelector('[data-on]')?.textContent).toBe('Fade');
    expect(q('timeline-transition-length-words')?.textContent).toBe('0.5 s');
    expect(q('timeline-inspector')).toBeNull(); // no v1 dialog
  });

  test('07: there is no preview slab — every tile’s picture holds the two real shots', () => {
    open();
    expect(q('timeline-transition-preview')).toBeNull();
    for (const key of ['cut', 'fade', 'slide', 'wipe', 'flip', 'clock']) {
      const vids = q(`timeline-transition-${key}`)?.querySelectorAll('.tj-pic video');
      expect(
        [...(vids ?? [])].map((v) => v.getAttribute('src')),
        key
      ).toEqual(['/.design/assets/Oslava.mp4#t=2.9', '/.design/assets/Logo.mp4#t=0.1']);
    }
  });

  test('07: the six tiles are a radiogroup — one tab stop on the lit tile, ← → ↑ ↓ move between them', () => {
    open();
    const tiles = [...(q('timeline-transition-grid')?.querySelectorAll('button') ?? [])];
    expect(tiles.map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]); // Fade is lit
    const fade = q('timeline-transition-fade') as HTMLElement;
    fade.focus();
    act(() => {
      fade.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(q('timeline-transition-slide'));
    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
      );
    });
    expect(document.activeElement).toBe(fade);
  });

  test('a tile is one video.transition.set on the TRANSITION; the length is written when let go', () => {
    const verbs = open();
    act(() => {
      q('timeline-transition-wipe')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(verbs).toEqual([
      [{ stableId: 'tr0', transition: true }, 'video.transition.set', { presentation: 'wipe' }],
    ]);
    const range = q('timeline-transition-length') as HTMLInputElement;
    act(() => {
      // the prototype's own setter, so React's value tracker sees a real change
      let proto = Object.getPrototypeOf(range);
      while (proto && !Object.getOwnPropertyDescriptor(proto, 'value')?.set)
        proto = Object.getPrototypeOf(proto);
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(range, '1');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(verbs).toHaveLength(1); // dragging writes nothing
    act(() => {
      range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    expect(verbs[1]).toEqual([
      { stableId: 'tr0', transition: true },
      'video.transition.set',
      { durationInFrames: 30 },
    ]);
  });

  test('hovering a tile plays it inside the tile’s own two shots (Web Animations), leaving cancels', () => {
    open();
    const tile = q('timeline-transition-fade') as HTMLElement;
    const [ia, ib] = [...tile.querySelectorAll('.tj-pic > i')] as (HTMLElement & {
      animate?: unknown;
    })[];
    const played: unknown[][] = [];
    let cancelled = 0;
    ib.animate = (keyframes: unknown[]) => {
      played.push(keyframes);
      return { cancel: () => cancelled++ };
    };
    ia.animate = () => ({ cancel: () => cancelled++ });
    // happy-dom does not fire React's mouseenter from a plain event: use the focus path the keyboard takes
    act(() => {
      tile?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(played.length).toBeGreaterThan(0);
    expect(played[0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    act(() => {
      tile?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(cancelled).toBeGreaterThan(0);
  });

  test('Esc closes it; the foot is the board’s one line — Remove transition (hard cut) lives under the clip inspector’s Advanced (V2-8.5 c4-video)', () => {
    open();
    expect(q('timeline-transition-picker')).not.toBeNull();
    // 07 ve-transition: "Hover a tile to play it." and nothing else under the Length row
    expect(q('timeline-transition-remove')).toBeNull();
    expect(q('timeline-transition-picker')?.querySelector('.tj-foot')?.textContent).toBe(
      'Hover a tile to play it.'
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('timeline-transition-picker')).toBeNull();
  });
});

describe('a vertical clip on a wide video (ve-fit-fill)', () => {
  const fake = (w: number, h: number) => () => {
    const el = { videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement;
    setTimeout(() => (el.onloadedmetadata as (() => void) | null)?.(), 0);
    return el;
  };

  test('asks once how it should sit; Blur behind is video.fit, and "Same" is remembered', async () => {
    await probeSize('/.design/assets/Tunel.mp4', { make: fake(1080, 1920) });
    const verbs = mount({ selectedClipId: 'b0' });
    await settle();
    expect(q('timeline-fit-ask-title')?.textContent).toBe(
      'Tunel.mp4 is vertical — how should it sit?'
    );
    expect(q('timeline-fit-same')).not.toBeNull();
    act(() => {
      q('timeline-fit-blur')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(verbs).toEqual([[{ stableId: 'b0', index: 0 }, 'video.fit', { fit: 'blur' }]]);
    expect(q('timeline-fit-ask')).toBeNull();
    expect(localStorage.getItem('maude.fitStanding')).toBe('blur');
  });

  test('Fill is the default: it writes nothing, and the clip is not asked again', async () => {
    await probeSize('/.design/assets/Tunel.mp4', { make: fake(1080, 1920) });
    const verbs = mount({ selectedClipId: 'b0' });
    await settle();
    act(() => {
      q('timeline-fit-fill')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(verbs).toEqual([]);
    expect(q('timeline-fit-ask')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    mount({ selectedClipId: 'b0' });
    await settle();
    expect(q('timeline-fit-ask')).toBeNull();
  });

  test('with a standing answer the next vertical clip is not asked: it gets the answer, once', async () => {
    localStorage.setItem('maude.fitStanding', 'fit');
    await probeSize('/.design/assets/Tunel.mp4', { make: fake(1080, 1920) });
    const verbs = mount({ selectedClipId: 'b0' });
    await settle();
    expect(q('timeline-fit-ask')).toBeNull();
    expect(verbs).toEqual([[{ stableId: 'b0', index: 0 }, 'video.fit', { fit: 'fit' }]]);
    // selecting it again later does not write again
    act(() => root?.unmount());
    host?.remove();
    const again = mount({ selectedClipId: 'b0' });
    await settle();
    expect(again).toEqual([]);
  });

  test('a wide clip, a clip with a fit already, or a vertical video asks nothing', async () => {
    await probeSize('/.design/assets/Tunel.mp4', { make: fake(1920, 1080) });
    mount({ selectedClipId: 'b0' });
    await settle();
    expect(q('timeline-fit-ask')).toBeNull();
    resetProbeCache();
    await probeSize('/.design/assets/Tunel.mp4', { make: fake(1080, 1920) });
    act(() => root?.unmount());
    mount({ selectedClipId: 'b0', comps: [{ ...WIDE[0], width: 1080, height: 1920 }] });
    await settle();
    expect(q('timeline-fit-ask')).toBeNull();
  });

  test('Esc closes the ask without an answer, and it does not come back for that clip', async () => {
    await probeSize('/.design/assets/Tunel.mp4', { make: fake(1080, 1920) });
    const verbs = mount({ selectedClipId: 'b0' });
    await settle();
    expect(q('timeline-fit-ask')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('timeline-fit-ask')).toBeNull();
    expect(verbs).toEqual([]);
  });
});

describe('a video with no sound', () => {
  const silent = SEQS.map((s) =>
    s.mediaTag === 'Video' ? { ...s, mediaProps: { muted: true } } : s
  );

  test('the Music track says so and offers music (and AI where it exists)', () => {
    mount({ sequences: silent, onDropMedia: () => {} });
    expect(q('timeline-music-hint')?.textContent).toContain('No sound in this video.');
    expect(q('timeline-music-add')?.textContent).toBe('Add music');
  });

  test('a clip with sound makes the track merely empty: no line', () => {
    mount();
    expect(q('timeline-music-hint')).toBeNull();
  });

  test('Add music hands the chosen file to the drop pipe like a dropped one', () => {
    const dropped: unknown[][] = [];
    mount({
      sequences: silent,
      onDropMedia: (files: File[], lane: unknown) => dropped.push([files.length, lane]),
    });
    const input = q('timeline-music-file') as HTMLInputElement;
    const file = new File(['x'], 'bed.mp3', { type: 'audio/mpeg' });
    act(() => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(dropped).toEqual([[1, null]]);
  });
});
