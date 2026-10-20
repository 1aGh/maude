// S7.5 — the comp vocabulary renders from its literal props + the build's injected data
// (V2-1.10 §5.3): <Captions> follows the frame, <Duck> multiplies the dip into the one <Audio>'s
// volume, <Reframe> picks the per-format focus in SOURCE time, <Place> anchors a title per format.
// Rendered at a frame through @remotion/player's <Thumbnail> (server markup, no browser).

import { describe, expect, test } from 'bun:test';
import { Thumbnail } from '@remotion/player';
import { type ComponentType, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Captions, Duck, Place, Reframe } from '../canvas-lib.tsx';
import { captionAt, captionGroups, focusAt, reframeBox, sourceSecond } from '../video/framing.ts';

const at = (Comp: ComponentType, frame: number, w = 1080, h = 1920) =>
  renderToStaticMarkup(
    createElement(Thumbnail, {
      component: Comp,
      compositionWidth: w,
      compositionHeight: h,
      durationInFrames: 300,
      fps: 30,
      frameToDisplay: frame,
    })
  );

const W = (wordId: string, f0: number, f1: number, text: string, clip = 'name:a') => ({
  wordId,
  clip,
  f0,
  f1,
  text,
});
const WORDS = [
  W('w1', 15, 27, 'Ahoj'),
  W('w2', 28, 40, 'vsichni,'),
  W('w3', 41, 55, 'tady.'),
  W('w4', 100, 112, 'Druha'),
  W('w5', 113, 130, "it's `x` ${y} </script><b>"),
];

describe('<Captions>', () => {
  test('a line shows its words and highlights the one being spoken', () => {
    const html = at(() => createElement(Captions, { words: 'line', __words: WORDS }), 30);
    expect(html).toContain('Ahoj');
    expect(html).toContain('vsichni,');
    expect(html).toContain('tady.');
    expect(html).not.toContain('Druha'); // the sentence ended: a new line
    expect(html).toMatch(/<span data-word="w2" style="color:var\(--accent, #ffd400\)">/);
  });

  test('words={1} shows only the word being spoken; nothing between lines', () => {
    const one = at(() => createElement(Captions, { words: 1, __words: WORDS }), 44);
    expect(one).toContain('tady.');
    expect(one).not.toContain('Ahoj');
    expect(at(() => createElement(Captions, { __words: WORDS }), 80)).not.toContain(
      'data-maude-caption-line'
    );
  });

  test('a word is text, never markup', () => {
    const html = at(() => createElement(Captions, { __words: WORDS }), 120);
    expect(html).toContain('it&#x27;s `x` ${y} &lt;/script&gt;&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  test('no injected words (a build that read no transcript) renders an empty layer', () => {
    const html = at(() => createElement(Captions, { 'data-cd-id': 'captions' }), 30);
    expect(html).toContain('data-cd-id="captions"');
    expect(html).not.toContain('data-maude-caption-line');
  });

  test('groups: a line breaks at maxChars, at a cut between clips, and holds over a short gap', () => {
    const g = captionGroups(
      [W('a', 0, 10, 'one'), W('b', 11, 20, 'two'), W('c', 21, 30, 'three', 'name:b')],
      'line',
      30
    );
    expect(g.map((x) => x.words.map((w) => w.wordId))).toEqual([['a', 'b'], ['c']]);
    expect(g[0]?.f1).toBe(21); // held to the next line's start, no flicker
    const narrow = captionGroups(
      [W('a', 0, 10, 'abcdef'), W('b', 11, 20, 'ghijkl')],
      'line',
      30,
      8
    );
    expect(narrow).toHaveLength(2);
    expect(captionAt(g, 25)?.group.words[0]?.wordId).toBe('c');
  });
});

describe('<Duck>', () => {
  // Stands in for the <Audio>: prints the volume it receives at a few of its own frames.
  const Probe = (p: { volume?: number | ((f: number) => number) }) => {
    const v = typeof p.volume === 'function' ? p.volume : () => p.volume ?? 1;
    return createElement(
      'i',
      null,
      [0, 30, 45, 60, 90].map((f) => `${f}:${v(f).toFixed(3)}`).join(' ')
    );
  };

  test('the music goes down under speech, ramps in and out, times its own volume', () => {
    const html = at(
      () =>
        createElement(
          Duck,
          { db: -12, attackMs: 500, releaseMs: 500, __speech: [[45, 60]] },
          createElement(Probe, { volume: 0.8 })
        ),
      0
    );
    // 0 and 90: untouched 0.8 · 45..60: 0.8 × 10^(−12/20) · 30: the attack ramp's start (15 frames before)
    expect(html).toContain('0:0.800');
    expect(html).toContain('45:0.201');
    expect(html).toContain('60:0.201');
    expect(html).toContain('30:0.800');
    expect(html).toContain('90:0.800');
  });

  test('a callback volume is kept and multiplied; no speech = untouched', () => {
    const html = at(
      () =>
        createElement(
          Duck,
          { __speech: [] },
          createElement(Probe, { volume: (f: number) => f / 100 })
        ),
      0
    );
    expect(html).toContain('90:0.900');
  });
});

describe('<Reframe>', () => {
  test('focus is picked per format and interpolated in SOURCE time, holding the ends', () => {
    const keys = [
      [0, 0.2, 0.5],
      [2, 0.6, 0.5],
    ] as const;
    expect(focusAt(1, keys, undefined, { w: 1080, h: 1920 })).toEqual([0.4, 0.5]);
    expect(focusAt(-1, keys, undefined, { w: 1080, h: 1920 })).toEqual([0.2, 0.5]);
    expect(focusAt(9, keys, undefined, { w: 1080, h: 1920 })).toEqual([0.6, 0.5]);
    const formats = { '16:9': [[0, 0.5, 0.9]] as const };
    expect(focusAt(1, keys, formats, { w: 1920, h: 1080 })).toEqual([0.5, 0.9]);
    expect(focusAt(1, keys, formats, { w: 1080, h: 1920 })).toEqual([0.4, 0.5]);
    expect(focusAt(1, undefined, undefined, { w: 1, h: 1 })).toEqual([0.5, 0.5]); // B3: centre
  });

  test('before the source size is known it is centred and filled; fit letterboxes; blur adds a muted copy', () => {
    const media = createElement('video', { src: 'assets/aaaaaaaa.mp4' });
    const fill = at(() => createElement(Reframe, { focus: [[0, 0.2, 0.5]] }, media), 0);
    expect(fill).toContain('object-fit:cover');
    const fit = at(() => createElement(Reframe, { fit: 'fit' }, media), 0);
    expect(fit).toContain('object-fit:contain');
    const blur = at(() => createElement(Reframe, { fit: 'blur' }, media), 0);
    expect(blur.match(/<video/g)).toHaveLength(2);
    expect(blur).toContain('filter:blur(24px)');
    expect(blur).toMatch(/<video src="[^"]*" muted=""/); // the blurred copy is silent
  });

  test('once the size is known: the window fills the output, centred on the focus, clamped', () => {
    // a 1920×1080 source into a 1080×1920 output: the window is 607.5 × 1080 source px, scaled ×16/9
    const centre = reframeBox([0.5, 0.5], { w: 1920, h: 1080 }, { w: 1080, h: 1920 }, 1);
    expect(centre.height).toBeCloseTo(1920, 6);
    expect(centre.width).toBeCloseTo(3413.33, 1);
    expect(centre.left).toBeCloseTo(-(3413.33 - 1080) / 2, 1);
    const edge = reframeBox([0.02, 0.5], { w: 1920, h: 1080 }, { w: 1080, h: 1920 }, 1);
    expect(edge.left).toBeCloseTo(0, 9); // clamped to the source's left edge, never past it
    const zoomed = reframeBox([0.5, 0.5], { w: 1920, h: 1080 }, { w: 1080, h: 1920 }, 2);
    expect(zoomed.height).toBeCloseTo(3840, 6);
    // a clip's own frame 15 with trimBefore 30 at 2× plays source second (30 + 30) / 30 = 2
    expect(sourceSecond(15, 30, 2, 30)).toBe(2);
  });
});

describe('<Place>', () => {
  test('the centre anchor per format, in output pixels', () => {
    const tall = at(
      () => createElement(Place, { at: [0.5, 0.8], formats: { '16:9': [0.5, 0.85] } }, 'Recap'),
      0
    );
    expect(tall).toContain('left:540px;top:1536px');
    const wide = at(
      () => createElement(Place, { at: [0.5, 0.8], formats: { '16:9': [0.5, 0.85] } }, 'Recap'),
      0,
      1920,
      1080
    );
    expect(wide).toContain('left:960px;top:918px');
    expect(wide).toContain('translate(-50%, -50%)');
  });
});
