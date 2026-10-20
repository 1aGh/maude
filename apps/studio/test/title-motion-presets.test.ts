// S7.10 — a title's six motion presets (07 ve-text "Motion") and a join's six transitions (07 ve-transition):
// `video.title.motion` and `video.transition.set` are edit ops (one write, one undo step), the presets are a pure
// function of the frame, <TitleMotion> draws them, and `maude design check` holds the shape.

import { describe, expect, test } from 'bun:test';
import { Thumbnail } from '@remotion/player';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { enumerateClips } from '../canvas-edit.ts';
import { TitleMotion } from '../canvas-lib.tsx';
import { checkFile } from '../check/index.ts';
import { TRANSITION_TILES } from '../edit-ops/clip/index.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { compClips } from '../video/derive.ts';
import {
  isTitleMotion,
  motionAt,
  TITLE_MOTION_LABELS,
  TITLE_MOTIONS,
  typedChars,
  wordMotionAt,
} from '../video/title-motion.ts';

const FILE = 'ui/Reel.tsx';
const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { Sequence } from 'remotion';",
  "import { TransitionSeries, linearTiming } from '@remotion/transitions';",
  "import { fade } from '@remotion/transitions/fade';",
  "import { Video } from '@remotion/media';",
  'const TOTAL = 240;',
  'const Comp = () => (',
  '  <>',
  '    <TransitionSeries>',
  '      <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />',
  '      <TransitionSeries.Sequence name="two" durationInFrames={120}><Video src="b.mp4" /></TransitionSeries.Sequence>',
  '    </TransitionSeries>',
  '    <Sequence name="title" from={20} durationInFrames={66}><div data-cd-id="t" style={{ color: "white" }}>{"PROČ ALLIGATORS"}</div></Sequence>',
  '  </>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" label="Recap" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} width={1080} height={1920} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

function run(source: string, op: string, params: Record<string, unknown>) {
  const o = EDIT_OPS.find((x) => x.id === op);
  if (!o) throw new Error(`no op ${op}`);
  return o.apply(source, { file: FILE, op, targets: [], params: { artboard: 'reel', ...params } });
}
const src = (source: string, op: string, params: Record<string, unknown>) =>
  run(source, op, params).source;
const motion = (source: string, preset: string, extra: Record<string, unknown> = {}) =>
  src(source, 'video.title.motion', { stableId: 'name:title', preset, ...extra });

describe('the six presets (video/title-motion.ts)', () => {
  test('None · Fade · Slide up · Pop · Type on · Per word, in the order the picker draws them', () => {
    expect([...TITLE_MOTIONS]).toEqual(['none', 'fade', 'slide-up', 'pop', 'type-on', 'per-word']);
    expect(TITLE_MOTIONS.map((id) => TITLE_MOTION_LABELS[id])).toEqual([
      'None',
      'Fade',
      'Slide up',
      'Pop',
      'Type on',
      'Per word',
    ]);
    expect(isTitleMotion('slide-up')).toBe(true);
    expect(isTitleMotion('spin')).toBe(false);
    expect(isTitleMotion(undefined)).toBe(false);
  });

  test('each starts hidden or displaced and ends at rest (a pure function of the frame)', () => {
    for (const id of ['fade', 'slide-up', 'pop'] as const) {
      expect(motionAt(id, 0).opacity).toBe(0);
      const end = motionAt(id, 12);
      expect(end).toEqual({ opacity: 1, y: 0, scale: 1 });
      expect(motionAt(id, 5)).toEqual(motionAt(id, 5));
    }
    expect(motionAt('slide-up', 0).y).toBe(48);
    expect(motionAt('pop', 0).scale).toBe(0.8);
    expect(motionAt('none', 0)).toEqual({ opacity: 1, y: 0, scale: 1 });
    expect(motionAt('fade', 30, 12).opacity).toBe(1); // past the entrance stays at rest
  });

  test('type on reveals characters; per word staggers each word', () => {
    expect(typedChars(15, 0)).toBe(0);
    expect(typedChars(15, 6)).toBe(7);
    expect(typedChars(15, 12)).toBe(15);
    expect(typedChars(15, 99)).toBe(15);
    const a = wordMotionAt(0, 2, 2);
    const b = wordMotionAt(1, 2, 2);
    expect(a.opacity).toBeGreaterThan(b.opacity);
    expect(wordMotionAt(1, 2, 30).opacity).toBe(1);
  });
});

describe('video.title.motion', () => {
  test('wraps the title once; changing the preset rewrites the one prop; None takes it off again', () => {
    const a = motion(SRC, 'slide-up');
    expect(a).toContain(
      '<Sequence name="title" from={20} durationInFrames={66}><TitleMotion preset="slide-up"><div data-cd-id="t"'
    );
    expect(a).toContain(
      "import { DCArtboard, DesignCanvas, VideoComp, TitleMotion } from '@maude/canvas-lib';"
    );
    const b = motion(a, 'pop');
    expect(b).toContain('<TitleMotion preset="pop">');
    expect(b.match(/<TitleMotion/g)?.length).toBe(1);
    const c = motion(b, 'none');
    expect(c).not.toContain('<TitleMotion');
    expect(c.replace(', TitleMotion', '')).toBe(SRC);
  });

  test('the entrance length is a literal prop; the default length writes none', () => {
    const a = motion(SRC, 'fade', { frames: 20 });
    expect(a).toContain('<TitleMotion preset="fade" frames={20}>');
    const b = motion(a, 'fade', { frames: 12 });
    expect(b).not.toContain('frames=');
  });

  test('the Timeline still reads the title through the wrapper, and its text is still editable', () => {
    const a = motion(SRC, 'type-on');
    const clip = compClips(FILE, a, 'reel').clips.find((c) => c.stableId === 'name:title');
    expect(clip?.kind).not.toBe('transition');
    const edited = src(a, 'clip.set-text', { stableId: 'name:title', text: 'Nábor 2027' });
    expect(edited).toContain('{"Nábor 2027"}');
    expect(edited).toContain('<TitleMotion preset="type-on">');
  });

  test('the enumerator reads the preset and the length back, as literal text (the inspector’s Motion row)', () => {
    const read = (source: string) =>
      enumerateClips(FILE, source, 'reel').clips.find((c) => c.stableId === 'name:title')
        ?.titleMotion ?? null;
    expect(read(SRC)).toBeNull();
    expect(read(motion(SRC, 'pop', { frames: 20 }))).toEqual({ preset: 'pop', frames: 20 });
    expect(read(motion(SRC, 'pop'))).toEqual({ preset: 'pop', frames: null });
  });

  test('the enumerator reads a clip’s picture fit (Fill · Fit · Blur behind) off its <Reframe>', () => {
    const fit = (source: string) =>
      enumerateClips(FILE, source, 'reel').clips.find((c) => c.stableId === 'name:one')?.fit ??
      null;
    expect(fit(SRC)).toBeNull();
    expect(fit(src(SRC, 'video.fit', { stableId: 'name:one', fit: 'blur' }))).toBe('blur');
    expect(fit(src(SRC, 'video.fit', { stableId: 'name:one', fit: 'fit' }))).toBe('fit');
  });

  test('inside a <Place> the motion goes inside it (Place > TitleMotion > content)', () => {
    const placed = src(SRC, 'video.place', { stableId: 'name:title', at: [0.5, 0.8] });
    const a = motion(placed, 'slide-up');
    expect(a).toMatch(/<Place at=\{\[0\.5,0\.8\]\}><TitleMotion preset="slide-up"><div/);
    // …and a Place added AFTER the motion wraps the motion, not the other way round
    const b = src(motion(SRC, 'slide-up'), 'video.place', { stableId: 'name:title', at: [0.5, 0.8] });
    expect(b).toMatch(/<Place at=\{\[0\.5,0\.8\]\}><TitleMotion preset="slide-up">/);
  });

  test('refuses a preset it does not know, a bad length, a clip with nothing to move, a missing clip', () => {
    expect(() => motion(SRC, 'spin')).toThrow('The motion is one of');
    expect(() => motion(SRC, 'fade', { frames: 0 })).toThrow('1 to 90 frames');
    expect(() => motion(SRC, 'fade', { frames: 2.5 })).toThrow('1 to 90 frames');
    expect(() => src(SRC, 'video.title.motion', { stableId: 'name:nope', preset: 'fade' })).toThrow(
      'not on the timeline'
    );
    expect(() => src(SRC, 'video.title.motion', { preset: 'fade' })).toThrow('names no clip');
  });

  test('it is an artboard-scoped op (the lease and the role gate are the dispatcher’s)', () => {
    const o = EDIT_OPS.find((x) => x.id === 'video.title.motion');
    expect(o?.scope).toBe('artboard');
  });
});

describe('<TitleMotion> draws the presets', () => {
  const at = (props: Record<string, unknown>, text: string, frame: number) =>
    renderToStaticMarkup(
      createElement(Thumbnail, {
        component: () => createElement(TitleMotion, props, createElement('h1', null, text)),
        compositionWidth: 1080,
        compositionHeight: 1920,
        durationInFrames: 90,
        fps: 30,
        frameToDisplay: frame,
      })
    );

  test('slide up starts low and transparent, then rests', () => {
    expect(at({ preset: 'slide-up' }, 'Ahoj', 0)).toContain('translateY(48px)');
    expect(at({ preset: 'slide-up' }, 'Ahoj', 20)).toContain('translateY(0px) scale(1)');
  });

  test('type on plays the text inside the one element that carries it', () => {
    const half = at({ preset: 'type-on' }, 'ABCDEFGH', 6);
    expect(half).toContain('<h1>ABCD<span style="visibility:hidden">EFGH</span></h1>');
    expect(at({ preset: 'type-on' }, 'ABCDEFGH', 20)).toContain('<h1>ABCDEFGH<span');
  });

  test('per word keeps the words as text, never markup', () => {
    const html = at({ preset: 'per-word' }, 'one <b>two</b>', 30);
    expect(html).toContain('one');
    expect(html).toContain('&lt;b&gt;two&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  test('none draws the content untouched', () => {
    expect(at({ preset: 'none' }, 'Ahoj', 0)).toContain('<h1>Ahoj</h1>');
  });
});

describe('maude design check holds the shape', () => {
  const codes = (body: string) =>
    checkFile(
      'ui/Reel.tsx',
      [
        "import { DCArtboard, TitleMotion, VideoComp } from '@maude/canvas-lib';",
        `const Reel = () => (<>${body}</>);`,
        'export default () => (',
        '  <DCArtboard id="reel"><VideoComp component={Reel} durationInFrames={90} fps={30} /></DCArtboard>',
        ');',
      ].join('\n')
    )
      .errors.map((e) => e.code)
      .filter((c) => c.startsWith('video-'));
  test('a known preset and a whole length pass; anything else is video-title-motion', () => {
    expect(codes('<TitleMotion preset="pop" frames={12}>x</TitleMotion>')).toEqual([]);
    expect(codes('<TitleMotion preset="spin">x</TitleMotion>')).toEqual(['video-title-motion']);
    expect(codes('<TitleMotion preset="pop" frames={0}>x</TitleMotion>')).toEqual([
      'video-title-motion',
    ]);
  });
});

describe('video.transition.set', () => {
  const transitionId = () =>
    enumerateClips(FILE, SRC, 'reel').clips.find((c) => c.kind === 'transition')?.stableId as string;

  test('the six tiles are today’s six presentations (Cut is the empty one)', () => {
    expect(TRANSITION_TILES.cut).toBe('none');
    expect(TRANSITION_TILES.clock).toBe('clock-wipe');
    expect(Object.hasOwn(TRANSITION_TILES, 'constructor')).toBe(false);
  });

  test('a tile changes the presentation and its imports; Length changes the frames', () => {
    const id = transitionId();
    const a = src(SRC, 'video.transition.set', { stableId: id, presentation: 'wipe' });
    expect(a).toContain('presentation={wipe(');
    expect(a).toContain("@remotion/transitions/wipe'");
    const b = src(a, 'video.transition.set', { stableId: id, durationInFrames: 24 });
    expect(b).toContain('durationInFrames: 24');
    const c = src(SRC, 'video.transition.set', { stableId: id, presentation: 'cut' });
    expect(c).toContain('presentation={none()}');
  });

  test('refuses a tile it does not know, a bad length, and a request that changes nothing', () => {
    const id = transitionId();
    expect(() => src(SRC, 'video.transition.set', { stableId: id, presentation: 'spin' })).toThrow(
      'Cut, Fade, Slide, Wipe, Flip or Clock wipe'
    );
    expect(() =>
      src(SRC, 'video.transition.set', { stableId: id, presentation: 'constructor' })
    ).toThrow('Cut, Fade');
    expect(() => src(SRC, 'video.transition.set', { stableId: id, durationInFrames: 0 })).toThrow(
      '1 to 600'
    );
    expect(() => src(SRC, 'video.transition.set', { stableId: id })).toThrow('nothing to change');
    expect(() =>
      src(SRC, 'video.transition.set', { stableId: 'name:one', presentation: 'fade' })
    ).toThrow('is not a transition');
  });
});
