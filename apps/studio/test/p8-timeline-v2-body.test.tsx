// P8 C3 (07 · ve-select, ve-play, ve-long, ve-transition; 08 · ak-video) — the timeline island runs the board's
// body, not v1's: a quiet header (play · loop · time / length · the video's name · four tools · Expand), one icon chip
// per track in a narrow gutter (no "V1 STORYLINE", no ƒ / ▶ glyph columns), clips that carry their names, round join
// dots with a real name, no "+" in the lanes at rest, the poster flag even at the default frame, a playhead with no
// "0.00s" tag, and everything the old header had one disclosure down (Advanced), not deleted.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  });
});
afterAll(async () => {
  // React's scheduler and the stores' timers can still be queued when the last test ends; let them run while
  // `window` exists, or they fire into a destroyed DOM ("window is not defined", unhandled between tests)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseCompTimeline } from '../client/panels/timeline-parse.js';
import { foldStore } from '../client/v2/fold/use-fold.js';
import { TimelineIslandContext } from '../client/v2/timeline/island-context.js';
import { playbackStore } from '../client/v2/timeline/playhead.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  playbackStore.reset();
});

const beat = (id: string, from: number, duration: number) => ({
  stableId: id,
  label: id,
  series: true,
  mediaTag: 'Video',
  mediaSrc: `assets/${id}.mp4`,
  from,
  duration,
  keyframes: [],
});
const SEQ = [
  beat('Oslava', 0, 240),
  beat('Touchdown', 240, 210),
  {
    stableId: 'dr',
    label: 'DŘINA',
    series: false,
    mediaTag: null,
    from: 45,
    duration: 60,
    keyframes: [],
  },
  {
    stableId: 'sr',
    label: 'SRDCE',
    series: false,
    mediaTag: null,
    from: 300,
    duration: 60,
    keyframes: [],
  },
  {
    stableId: 'lg',
    label: 'LogoBug',
    series: false,
    mediaTag: null,
    from: 0,
    duration: 450,
    keyframes: [],
  },
];
const TRANS = [{ afterIndex: 0, dur: 15, presentation: 'fade' }];

function mount({
  sequences = SEQ as unknown[],
  island = {} as Record<string, unknown>,
  playing = false,
  extra = {} as Record<string, unknown>,
} = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <TimelineIslandContext.Provider value={{ canvas: 'v.tsx', ...island }}>
        <TimelinePanel
          comps={[
            {
              id: 'c1',
              fps: 30,
              durationInFrames: 450,
              artboardId: 'reel',
              artboardLabel: 'Hype trailer · Reels',
            },
          ]}
          compId="c1"
          sequences={sequences}
          transitions={TRANS}
          total={450}
          frame={120}
          playing={playing}
          height={300}
          onSelect={() => {}}
          onSeek={() => {}}
          onClipVerb={() => {}}
          onSplitAtPlayhead={() => {}}
          onAddTitle={() => {}}
          onAddImage={() => {}}
          onAddAiClip={() => {}}
          onAddComment={() => {}}
          onToggleMute={() => {}}
          onVolume={() => {}}
          onDropMedia={() => {}}
          onClose={() => {}}
          {...extra}
        />
      </TimelineIslandContext.Provider>
    );
  });
}
const q = (sel: string) => document.querySelector(sel);
const all = (sel: string) => [...document.querySelectorAll(sel)];
const head = () => q('.tl-head') as HTMLElement;

describe('the header is the board’s', () => {
  test('play · loop · time / length · the video’s name, four tools, Expand — nothing else at rest', () => {
    mount({ island: { size: 'compact', onToggleSize: () => {} } });
    const h = head();
    expect(q('[data-testid="timeline-playpause"]')?.classList.contains('icon-btn')).toBe(true);
    expect(q('[data-testid="timeline-readout"]')?.textContent).toBe('0:04 / 0:15');
    expect(q('[data-testid="timeline-name"]')?.textContent).toBe('Hype trailer · Reels');
    const tools = all('.tl-tools button').map((b) => b.getAttribute('title'));
    expect(tools).toEqual([
      'Split at the playhead · S',
      'Add text',
      'Captions from speech',
      'Add music',
    ]);
    // v1 header pieces are gone from the header: jump-to-start, mute, volume, image / AI / comment tools,
    // the frame meter, the zoom range (compact) and the close ×
    expect(h.querySelector('[aria-label="Jump to start"]')).toBeNull();
    expect(h.querySelector('.tl-volume')).toBeNull();
    expect(h.querySelector('.tl-meta')).toBeNull();
    expect(h.querySelector('[data-testid="timeline-add-image"]')).toBeNull();
    expect(h.querySelector('[data-testid="timeline-placeholder-add"]')).toBeNull();
    expect(h.querySelector('[data-testid="timeline-comment-tool"]')).toBeNull();
    expect(h.querySelector('[data-testid="timeline-zoom"]')).toBeNull();
    expect(h.querySelector('[aria-label="Close timeline"]')).toBeNull();
    expect(h.textContent).not.toContain('fps');
  });

  test('Full adds the zoom (− bar +) and Fit; Compact is the size button', () => {
    mount({ island: { size: 'full', onToggleSize: () => {} } });
    expect(head().querySelector('[data-testid="timeline-zoom"]')).not.toBeNull();
    expect(head().querySelector('[data-testid="timeline-zoom-fit"]')?.textContent).toBe('Fit');
    expect(q('[data-testid="timeline-size"]')?.textContent).toBe('Compact');
  });

  test('while it plays with sound the header says “Sound on”; the button mutes', () => {
    let muted = 0;
    mount({ playing: true, extra: { onToggleMute: () => muted++ } });
    const s = q('[data-testid="timeline-sound"]') as HTMLButtonElement;
    expect(s?.textContent).toBe('Sound on');
    act(() => s.click());
    expect(muted).toBe(1);
  });

  test('the old tools are one disclosure down: Advanced keeps them', () => {
    foldStore.set('timeline', true);
    mount({ island: { size: 'full', onToggleSize: () => {} } });
    const more = q('[data-testid="timeline-more-tools"]') as HTMLElement;
    expect(more).not.toBeNull();
    for (const id of [
      'timeline-add-image',
      'timeline-placeholder-add',
      'timeline-comment-tool',
      'timeline-volume',
    ]) {
      expect(more.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
    foldStore.set('timeline', false);
  });
});

describe('tracks: one icon chip each, no code-made columns', () => {
  test('each track has its chip; no V1 / STORYLINE / ƒ / ▶ text anywhere in the lanes', () => {
    mount();
    for (const id of ['text', 'gfx', 'video', 'music']) {
      expect(q(`[data-track="${id}"] .tl-lab-ic`)).not.toBeNull();
    }
    const text = (q('[data-testid="timeline-track"]') as HTMLElement).textContent ?? '';
    expect(text).not.toMatch(/STORYLINE|storyline|\bV1\b|ƒ|▶|◫|♪/);
    expect(q('.tl-lane-id')).toBeNull();
    expect(q('.tl-kind')).toBeNull();
  });

  test('titles side by side share a lane; a clip names itself', () => {
    mount();
    // DŘINA (45–105) and SRDCE (300–360) do not overlap: one lane, the second row joins the first
    expect(q('[data-testid="timeline-row-3"]')?.getAttribute('data-lane-join')).toBe('1');
    expect(q('[data-testid="timeline-row-2"]')?.getAttribute('data-lane-join')).toBeNull();
    expect(q('[data-testid="timeline-seq-0"] .tl-clip-lab')?.textContent).toBe('Oslava');
  });

  test('an empty Music track still draws its lane', () => {
    mount();
    expect(q('[data-track="music"] .tl-row--empty')).not.toBeNull();
    act(() => root?.unmount());
    host?.remove();
    // a Text track with no titles keeps its lane even though the captions lane is there (and draws nothing)
    mount({ sequences: SEQ.slice(0, 2) });
    expect(q('[data-track="text"] .tl-row--empty')).not.toBeNull();
  });
});

describe('display names (07 · ve-text)', () => {
  test('“+ Title” goes by its words: the parser reads the literal, the block shows it, not “AbsoluteFill”', () => {
    const src = `function C(){ return <><Sequence from={30} durationInFrames={90}>
      <AbsoluteFill style={{ display: 'grid' }}>
        <div style={{ color: 'white' }}>{"PROČ ALLIGATORS"}</div>
      </AbsoluteFill></Sequence></>; }`;
    const r = parseCompTimeline(src, 450);
    expect(r.sequences[0]).toMatchObject({ label: 'AbsoluteFill', text: 'PROČ ALLIGATORS' });
    mount({ sequences: [...SEQ.slice(0, 2), { ...r.sequences[0], stableId: 't1' }] });
    const lab = q('[data-track="text"] .tl-clip-lab')?.textContent;
    expect(lab).toBe('PROČ ALLIGATORS');
    expect((q('[data-testid="timeline-track"]') as HTMLElement).textContent).not.toContain(
      'AbsoluteFill'
    );
  });
});

describe('joins, the ruler and the playhead', () => {
  test('a join is a round dot named by the two clips it joins; no “+” buttons are drawn at rest', () => {
    mount();
    const j = q('[data-testid="timeline-seam-0"]') as HTMLElement;
    expect(j.getAttribute('aria-label')).toBe('Transition Oslava → Touchdown');
    expect(j.textContent).not.toContain('⧓');
    expect(j.querySelector('svg')).not.toBeNull();
  });

  test('the poster flag is on the ruler at the default frame too (35 %)', () => {
    mount();
    const f = q('[data-testid="timeline-poster-flag"]') as HTMLElement;
    expect(f?.textContent).toBe('Poster');
    expect(f.getAttribute('data-frame')).toBe(String(Math.round(450 * 0.35)));
  });

  test('the playhead carries no seconds tag', () => {
    mount();
    expect(q('[data-testid="timeline-playhead"]')?.textContent).toBe('');
  });
});

describe('the styles hold the board’s rules (cheap pins)', () => {
  const css = readFileSync(join(import.meta.dir, '../client/v2/timeline/timeline.css'), 'utf8');
  test('add-transition “+” is hidden at rest and comes back on keyboard focus', () => {
    expect(css).toMatch(/\.tl-seam-add\s*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.tl-seam-add:focus-visible[^{]*\{[^}]*opacity:\s*1/);
  });
  test('the ruler reads in the body face, not mono; clips are the board’s filmstrip material', () => {
    expect(css).toMatch(/\.tl-tick-label\s*\{[^}]*font-family:\s*inherit/);
    expect(css).toMatch(/\.tl-seq-block\.tl-beat\s*\{[^}]*background:\s*var\(--object-ink\)/);
  });
});

describe('a purely digital comp keeps its rows, but its beats share one Video lane (07 · ve-select) — V2-8.5 c4-video', () => {
  const scene = (id: string, from: number, duration: number, layers = 0) => ({
    stableId: id,
    label: id,
    series: true,
    mediaTag: null,
    from,
    duration,
    keyframes: [],
    ...(layers
      ? { layers: Array.from({ length: layers }, (_, n) => ({ label: `layer ${n}`, kind: 'jsx' })) }
      : {}),
  });
  const joins = () =>
    all('[data-track="video"] .tl-row[data-testid^="timeline-row-"]').map((r) => [
      r.getAttribute('data-testid'),
      r.getAttribute('data-lane-join'),
    ]);
  test('three beats that never overlap are ONE lane: the 2nd and 3rd rows are drawn onto the first', () => {
    mount({
      sequences: [scene('beat-one', 0, 150), scene('beat-two', 150, 150), scene('beat-three', 300, 150)],
    });
    expect(joins()).toEqual([
      ['timeline-row-0', null],
      ['timeline-row-1', '1'],
      ['timeline-row-2', '1'],
    ]);
  });
  test('a lifted beat lifts, and the lane shows the landing line with "Drop before …" (07 · ve-move-transition)', () => {
    mount({
      sequences: [scene('Oslava', 0, 150), scene('Touchdown', 150, 150), scene('Logo', 300, 150)],
      extra: { onReorderMove: () => {} },
    });
    const block = q('[data-testid="timeline-seq-0"]') as HTMLElement;
    expect(q('[data-testid="timeline-landing-tip"]')).toBeNull();
    act(() => {
      block.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100 })
      );
    });
    act(() => {
      // drag right past Touchdown's centre: it would land before Logo
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100 + 520 }));
    });
    expect((q('[data-testid="timeline-seq-0"]') as HTMLElement).className).toContain('is-dragging');
    expect(q('[data-testid="timeline-landing-line"]')).not.toBeNull();
    expect(q('[data-testid="timeline-landing-tip"]')?.textContent).toMatch(/^Drop before /);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 620 }));
    });
    expect(q('[data-testid="timeline-landing-line"]')).toBeNull();
  });
  test('pressing a clip selects it at once — the lifted clip wears the selection while it is dragged (07 · ve-move-transition)', () => {
    const picked: unknown[] = [];
    mount({
      sequences: [scene('Oslava', 0, 150), scene('Touchdown', 150, 150)],
      extra: { onReorderMove: () => {}, onSelect: (id: unknown) => picked.push(id) },
    });
    act(() => {
      (q('[data-testid="timeline-seq-1"]') as HTMLElement).dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 300 })
      );
    });
    expect(picked).toEqual(['Touchdown']);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 300 }));
    });
  });
  test('a beat that opens into layers keeps a lane to itself (the layer view stays)', () => {
    mount({
      sequences: [scene('beat-one', 0, 150), scene('beat-two', 150, 150, 3), scene('beat-three', 300, 150)],
    });
    const byId = Object.fromEntries(joins());
    expect(byId['timeline-row-1']).toBeNull(); // the layered beat is its own lane
    expect(byId['timeline-row-0']).toBeNull();
    expect(byId['timeline-row-2']).toBe('1'); // the plain beats still share
  });
});
