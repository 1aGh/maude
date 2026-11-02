// clip-ops.test.ts — feature-enhanced-video-editing. Golden-file fixtures for
// the composed clip operations (canvas-edit primitives + the ripple engine).

import { describe, expect, test } from 'bun:test';

import { enumerateClips } from '../canvas-edit.ts';
import {
  applyClipAudio,
  applyClipFraming,
  applyClipGrade,
  applyDetachAudio,
  applyEditTransition,
  applyInsertClipAt,
  applyInsertTransition,
  applyMoveClipToOverlay,
  applyMoveClipToStoryline,
  applyRemoveClipRippled,
  applyRemoveTransition,
  applyReorderOverlayLayer,
  applyResolvePlaceholder,
  applySeriesMove,
  applySetClipText,
  applySetPlaybackRate,
  applySplitClip,
  applyTrimIn,
  clipAbsoluteStart,
  filterToGrade,
  gradeToFilter,
  transitionDurationFrames,
} from '../clip-ops.ts';

const CANVAS = '/abs/Canvas.tsx';

// Adversarial fixture (security review 2026-07-30) — a prompt embedding a
// fake </AIPlaceholder> close tag + template-literal/env-var syntax, proving
// the JSON.stringify escaping discipline (DDR-150 P1) holds under attack.
const EVIL = '*/ `backtick` ${process.env.HOME} </AIPlaceholder> "q" \\';

const SERIES = [
  "import { TransitionSeries } from '@remotion/transitions';",
  'const S1 = 90;',
  'const S2 = 120;',
  'const S3 = 60;',
  'const XF = 15;',
  'const TOTAL = S1 + S2 + S3 - XF - XF;',
  'const Comp = () => (',
  '  <TransitionSeries>',
  '    <TransitionSeries.Sequence name="s1" durationInFrames={S1}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />',
  '    <TransitionSeries.Sequence name="s2" durationInFrames={S2}><Video src="b.mp4" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />',
  '    <TransitionSeries.Sequence name="s3" durationInFrames={S3}><Video src="c.mp4" /></TransitionSeries.Sequence>',
  '  </TransitionSeries>',
  ');',
  'function Canvas() {',
  '  return (',
  '    <DCArtboard id="a"><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '  );',
  '}',
].join('\n');

const STANDALONE = [
  'const TOTAL = 300;',
  'const Comp = () => (',
  '  <>',
  '    <Sequence name="base" from={0} durationInFrames={300}><Video src="a.mp4" /></Sequence>',
  '    <Sequence name="title" from={30} durationInFrames={90}><Title /></Sequence>',
  '  </>',
  ');',
  'const Title = () => <AbsoluteFill />;',
  'function Canvas() {',
  '  return (',
  '    <DCArtboard id="a"><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '  );',
  '}',
].join('\n');

describe('transitionDurationFrames', () => {
  test('parses the const-fed timing duration', () => {
    const { clips } = enumerateClips(CANVAS, SERIES, 'a');
    const t = clips.find((c) => c.kind === 'transition');
    expect(t).toBeTruthy();
    expect(transitionDurationFrames(SERIES, t!)).toBe(15);
  });
});

describe('applyRemoveClipRippled — series beat (the magnetic Delete)', () => {
  test('removes the beat + one transition and shrinks TOTAL by dur − overlap', () => {
    const r = applyRemoveClipRippled(CANVAS, SERIES, 'a', 'name:s2', undefined);
    expect(r.rippled).toBe(true);
    // S2 (120) leaves, one XF (15) transition leaves with it → TOTAL −105.
    expect(r.source).toContain('const TOTAL = S1 + S2 + S3 - XF - XF - 105;');
    expect(r.source).not.toContain('name="s2"');
    // still a valid alternation: s1 ⧓ s3
    const after = enumerateClips(CANVAS, r.source, 'a');
    expect(after.clips.map((c) => c.kind)).toEqual(['sequence', 'transition', 'sequence']);
  });

  test('removing the LAST beat drops its preceding transition', () => {
    const r = applyRemoveClipRippled(CANVAS, SERIES, 'a', 'name:s3', undefined);
    expect(r.source).not.toContain('name="s3"');
    expect(r.source).toContain('- 45;'); // 60 − 15
    const after = enumerateClips(CANVAS, r.source, 'a');
    expect(after.clips.map((c) => c.kind)).toEqual(['sequence', 'transition', 'sequence']);
  });
});

describe('applySeriesMove — magnetic drag-to-reorder', () => {
  const order = (src) =>
    enumerateClips(CANVAS, src, 'a')
      .clips.filter((c) => c.kind === 'sequence')
      .map((c) => c.stableId);

  test('move the last beat before the first (multi-slot, not a swap)', () => {
    const r = applySeriesMove(
      CANVAS,
      SERIES,
      'a',
      'name:s3',
      undefined,
      'name:s1',
      undefined,
      'before'
    );
    expect(order(r.source)).toEqual(['name:s3', 'name:s1', 'name:s2']);
    expect(r.stableId).toBe('name:s3');
    const kinds = enumerateClips(CANVAS, r.source, 'a').clips.map((c) => c.kind);
    expect(kinds).toEqual(['sequence', 'transition', 'sequence', 'transition', 'sequence']);
  });

  test('move the first beat after the last', () => {
    const r = applySeriesMove(
      CANVAS,
      SERIES,
      'a',
      'name:s1',
      undefined,
      'name:s3',
      undefined,
      'after'
    );
    expect(order(r.source)).toEqual(['name:s2', 'name:s3', 'name:s1']);
    const kinds = enumerateClips(CANVAS, r.source, 'a').clips.map((c) => c.kind);
    expect(kinds).toEqual(['sequence', 'transition', 'sequence', 'transition', 'sequence']);
  });

  test('adjacent move behaves like the ▲ swap', () => {
    const r = applySeriesMove(
      CANVAS,
      SERIES,
      'a',
      'name:s2',
      undefined,
      'name:s1',
      undefined,
      'before'
    );
    expect(order(r.source)).toEqual(['name:s2', 'name:s1', 'name:s3']);
  });

  test('refuses a self-move and a standalone target', () => {
    expect(() =>
      applySeriesMove(CANVAS, SERIES, 'a', 'name:s1', undefined, 'name:s1', undefined, 'after')
    ).toThrow();
    expect(() =>
      applySeriesMove(
        CANVAS,
        STANDALONE,
        'a',
        'name:base',
        undefined,
        'name:title',
        undefined,
        'after'
      )
    ).toThrow();
  });
});

describe('applyInsertClipAt — the drop caret', () => {
  test('storyline insert at index 1 lands between s1 and s2, TOTAL grows', () => {
    const r = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'storyline',
      index: 1,
      durationInFrames: 45,
      mediaTag: 'Video',
      src: 'assets/new.mp4',
    });
    const cc = enumerateClips(CANVAS, r.source, 'a');
    const beats = cc.clips.filter((c) => c.kind === 'sequence');
    expect(beats.length).toBe(4);
    expect(beats[1]?.mediaSrc).toBe('assets/new.mp4');
    expect(beats[1]?.stableId).toBe(r.stableId);
    // alternation survived
    const kinds = cc.clips.map((c) => c.kind);
    expect(kinds).toEqual([
      'sequence',
      'transition',
      'sequence',
      'transition',
      'sequence',
      'transition',
      'sequence',
    ]);
    // TOTAL bumped by 45 − 15 (cloned transition overlap)
    expect(r.source).toContain('const TOTAL = S1 + S2 + S3 - XF - XF + 30;');
  });

  test('storyline insert at index 0 keeps the series starting with a Sequence', () => {
    const r = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'storyline',
      index: 0,
      durationInFrames: 30,
      mediaTag: 'Video',
      src: 'assets/head.mp4',
    });
    const cc = enumerateClips(CANVAS, r.source, 'a');
    expect(cc.clips[0]?.kind).toBe('sequence');
    expect(cc.clips[0]?.mediaSrc).toBe('assets/head.mp4');
  });

  test('audio lane inserts a standalone <Sequence from> OUTSIDE the series', () => {
    const r = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'audio',
      from: 60,
      durationInFrames: 240,
      mediaTag: 'Audio',
      src: 'assets/music.mp3',
    });
    const cc = enumerateClips(CANVAS, r.source, 'a');
    const standalone = cc.clips.filter((c) => c.tag === 'Sequence');
    expect(standalone.length).toBe(1);
    expect(standalone[0]?.from).toBe(60);
    expect(standalone[0]?.mediaSrc).toBe('assets/music.mp3');
    // alternation of the series untouched
    expect(() => enumerateClips(CANVAS, r.source, 'a')).not.toThrow();
  });

  test('refuses a traversal/scheme src', () => {
    expect(() =>
      applyInsertClipAt(CANVAS, SERIES, 'a', {
        lane: 'storyline',
        index: 1,
        durationInFrames: 30,
        mediaTag: 'Video',
        src: '../evil.mp4',
      })
    ).toThrow();
  });
});

describe('applyRemoveClipRippled — standalone overlay clip', () => {
  test('removes WITHOUT ripple (overlays must not move the cut)', () => {
    const r = applyRemoveClipRippled(CANVAS, STANDALONE, 'a', 'name:title', undefined);
    expect(r.rippled).toBe(false);
    expect(r.source).toContain('const TOTAL = 300;');
    expect(r.source).not.toContain('name="title"');
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — parametric verbs.

describe('applySetPlaybackRate (Task 10)', () => {
  test('2× halves the duration, writes playbackRate, ripples TOTAL', () => {
    const r = applySetPlaybackRate(CANVAS, SERIES, 'a', 'name:s2', undefined, 2);
    expect(r.newDuration).toBe(60); // 120 / 2
    expect(r.source).toContain('playbackRate={2}');
    expect(r.source).toMatch(/name="s2" durationInFrames=\{60\}/);
    expect(r.source).toContain('const TOTAL = S1 + S2 + S3 - XF - XF - 60;');
  });

  test('rate 1 removes the attr and restores the duration', () => {
    const twice = applySetPlaybackRate(CANVAS, SERIES, 'a', 'name:s2', undefined, 2).source;
    const back = applySetPlaybackRate(CANVAS, twice, 'a', 'name:s2', undefined, 1);
    expect(back.source).not.toContain('playbackRate');
    expect(back.newDuration).toBe(120);
  });

  test('refuses a wrapper-media clip and absurd rates', () => {
    expect(() => applySetPlaybackRate(CANVAS, SERIES, 'a', 'name:s1', undefined, 0)).toThrow();
    const NOMEDIA = SERIES.replace('<Video src="b.mp4" />', '<Card />');
    expect(() => applySetPlaybackRate(CANVAS, NOMEDIA, 'a', 'name:s2', undefined, 2)).toThrow();
  });
});

// The e2e fixture shape: a faded two-beat storyline with a standalone title that STARTS INSIDE
// the first beat. Ripple like an editor — only pieces starting at/after the edited beat's old
// end move; a title inside the span stays put (it used to shift to -20 and refuse the edit).
const STORYLINE_TITLE = [
  "import { TransitionSeries } from '@remotion/transitions';",
  'const TOTAL = 105;',
  'const Comp = () => (',
  '  <>',
  '    <TransitionSeries>',
  '      <TransitionSeries.Sequence name="oslava" durationInFrames={60}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />',
  '      <TransitionSeries.Sequence name="logo" durationInFrames={60}><Card /></TransitionSeries.Sequence>',
  '    </TransitionSeries>',
  '    <Sequence name="title" from={10} durationInFrames={45}><Title /></Sequence>',
  '    <Sequence name="outro" from={70} durationInFrames={20}><Title /></Sequence>',
  '  </>',
  ');',
  'function Canvas() {',
  '  return (',
  '    <DCArtboard id="a"><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '  );',
  '}',
].join('\n');

describe('ripple like an editor — only pieces after the edited clip old end move', () => {
  test('Speed 2x on a beat leaves a title that starts inside its span alone', () => {
    const r = applySetPlaybackRate(CANVAS, STORYLINE_TITLE, 'a', 'name:oslava', undefined, 2);
    expect(r.newDuration).toBe(30);
    expect(r.source).toContain('name="title" from={10}'); // inside the old 0-60 span: stays
    expect(r.source).toContain('name="outro" from={40}'); // started after frame 60: 70 - 30
    expect(r.source).toContain('const TOTAL = 75;');
  });

  test('in-point trim: same rule', () => {
    const r = applyTrimIn(CANVAS, STORYLINE_TITLE, 'a', 'name:oslava', undefined, 20);
    expect(r.source).toContain('name="title" from={10}');
    expect(r.source).toContain('name="outro" from={50}');
  });

  test('a piece starting exactly at the old end moves', () => {
    const exact = STORYLINE_TITLE.replace('name="outro" from={70}', 'name="outro" from={60}');
    const r = applySetPlaybackRate(CANVAS, exact, 'a', 'name:oslava', undefined, 2);
    expect(r.source).toContain('name="outro" from={30}');
  });
});

describe('applyTrimIn (Task 11)', () => {
  test('trims into the clip: trimBefore + shorter duration + ripple', () => {
    const r = applyTrimIn(CANVAS, SERIES, 'a', 'name:s2', undefined, 20);
    expect(r.trimBefore).toBe(20);
    expect(r.newDuration).toBe(100);
    expect(r.source).toContain('trimBefore={20}');
    expect(r.source).toContain('- 20;'); // TOTAL shrank
  });

  test('standalone clip: from moves right with the in-point', () => {
    const r = applyTrimIn(CANVAS, STANDALONE, 'a', 'name:base', undefined, 10);
    expect(r.source).toMatch(/name="base" from=\{10\} durationInFrames=\{290\}/);
    // a JSX-only clip (no media) refuses
    expect(() => applyTrimIn(CANVAS, STANDALONE, 'a', 'name:title', undefined, 10)).toThrow();
  });

  test('legacy startFrom is read and retired', () => {
    const LEGACY = SERIES.replace('<Video src="b.mp4" />', '<Video src="b.mp4" startFrom={30} />');
    const r = applyTrimIn(CANVAS, LEGACY, 'a', 'name:s2', undefined, 10);
    expect(r.trimBefore).toBe(40);
    expect(r.source).toContain('trimBefore={40}');
    expect(r.source).not.toContain('startFrom');
  });

  test('clamps at trim 0 and refuses a <1-frame result', () => {
    expect(() => applyTrimIn(CANVAS, SERIES, 'a', 'name:s2', undefined, 120)).toThrow();
  });
});

describe('applyClipAudio + applyDetachAudio (Task 12)', () => {
  test('mute + volume write onto the media element', () => {
    const r = applyClipAudio(CANVAS, SERIES, 'a', 'name:s2', undefined, {
      muted: true,
      volume: 0.4,
    });
    expect(r.source).toMatch(/<Video muted volume=\{0.4\} src="b.mp4" \/>/);
    const off = applyClipAudio(CANVAS, r.source, 'a', 'name:s2', undefined, {
      muted: false,
      volume: 1,
    });
    expect(off.source).toContain('<Video src="b.mp4" />');
  });

  test('detach: video muted + audio-band <Sequence><Audio same-src> at the beat start', () => {
    const r = applyDetachAudio(CANVAS, SERIES, 'a', 'name:s2', undefined);
    expect(r.source).toMatch(/<Video muted src="b.mp4" \/>/);
    const cc = enumerateClips(CANVAS, r.source, 'a');
    const audioClip = cc.clips.find((c) => c.stableId === r.audioStableId);
    expect(audioClip?.mediaTag).toBe('Audio');
    expect(audioClip?.mediaSrc).toBe('b.mp4');
    // s2 starts at S1 − XF = 75
    expect(audioClip?.from).toBe(75);
    expect(audioClip?.durationInFrames).toBe(120);
  });
});

describe('clipAbsoluteStart', () => {
  test('series cursor walk subtracts transition overlaps', () => {
    expect(clipAbsoluteStart(SERIES, CANVAS, 'a', 'name:s1')).toBe(0);
    expect(clipAbsoluteStart(SERIES, CANVAS, 'a', 'name:s2')).toBe(75);
    expect(clipAbsoluteStart(SERIES, CANVAS, 'a', 'name:s3')).toBe(180);
  });
});

describe('grade (Task 14)', () => {
  test('params ↔ filter round-trip is lossless', () => {
    const p = { brightness: 1.2, contrast: 0.9, saturation: 1.5, hue: 30, sepia: 0.2 };
    expect(filterToGrade(gradeToFilter(p))).toEqual(p);
    expect(filterToGrade('blur(4px)')).toBe(null); // unrecognized → read-only badge
  });

  test('sets ONE filter string on the media style, clears on null', () => {
    const r = applyClipGrade(CANVAS, SERIES, 'a', 'name:s2', undefined, {
      brightness: 1.1,
      grayscale: 1,
    });
    expect(r.source).toContain("style={{ filter: 'brightness(1.1) grayscale(1)' }}");
    const cleared = applyClipGrade(CANVAS, r.source, 'a', 'name:s2', undefined, null);
    expect(cleared.source).not.toContain('filter:');
  });
});

describe('applyClipFraming (Task 13)', () => {
  test('wrap → rewrap → unwrap round-trips to the original media', () => {
    const r1 = applyClipFraming(CANVAS, SERIES, 'a', 'name:s2', undefined, {
      scale: 1.5,
      x: 10,
      y: -5,
    });
    expect(r1.source).toContain('data-mframe="1.5,10,-5"');
    expect(r1.source).toContain("transform: 'scale(1.5) translate(10%, -5%)'");
    const r2 = applyClipFraming(CANVAS, r1.source, 'a', 'name:s2', undefined, {
      scale: 2,
      x: 0,
      y: 0,
    });
    expect(r2.source).toContain('data-mframe="2,0,0"');
    expect(r2.source).not.toContain('data-mframe="1.5');
    const r3 = applyClipFraming(CANVAS, r2.source, 'a', 'name:s2', undefined, null);
    expect(r3.source).not.toContain('data-mframe');
    expect(r3.source).toContain('<Video src="b.mp4" />');
  });
});

// Hard-cut series (no transitions — valid Remotion), the split playground.
const HARDCUT = [
  "import { TransitionSeries } from '@remotion/transitions';",
  'const TOTAL = 270;',
  'const Comp = () => (',
  '  <TransitionSeries>',
  '    <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="two" durationInFrames={120}><Video src="b.mp4" trimBefore={30} /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="three" durationInFrames={60}><Video src="c.mp4" /></TransitionSeries.Sequence>',
  '  </TransitionSeries>',
  ');',
  'function Canvas() {',
  '  return (',
  '    <DCArtboard id="a"><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '  );',
  '}',
].join('\n');

describe('applySplitClip (Task 16)', () => {
  test('splits a hard-cut beat: two halves, trimBefore shifted, no TOTAL change', () => {
    // "two" spans 90–210; split at 150 → halves 60 + 60, second trim 30+60=90.
    const r = applySplitClip(CANVAS, HARDCUT, 'a', 'name:two', undefined, 150);
    const cc = enumerateClips(CANVAS, r.source, 'a');
    const seqs = cc.clips.filter((c) => c.kind === 'sequence');
    expect(seqs.length).toBe(4);
    expect(r.firstStableId).toBe('name:two');
    expect(r.secondStableId).toBe('name:two-150');
    expect(seqs[1]?.durationInFrames).toBe(60);
    expect(seqs[2]?.durationInFrames).toBe(60);
    expect(r.source).toContain('trimBefore={90}');
    expect(r.source).toContain('const TOTAL = 270;'); // halves sum — no ripple
  });

  test('standalone split: second half gets from + trimBefore', () => {
    const r = applySplitClip(CANVAS, STANDALONE, 'a', 'name:base', undefined, 120);
    expect(r.source).toMatch(/from=\{120\} durationInFrames=\{180\}/);
    expect(r.source).toContain('trimBefore={120}');
  });

  test('corruption fixtures: off-by-one at the cut frame refuses', () => {
    expect(() => applySplitClip(CANVAS, HARDCUT, 'a', 'name:two', undefined, 90)).toThrow(); // at start
    expect(() => applySplitClip(CANVAS, HARDCUT, 'a', 'name:two', undefined, 210)).toThrow(); // at end
  });

  test('corruption fixture: a beat touching a transition refuses with guidance', () => {
    let err: unknown;
    try {
      applySplitClip(CANVAS, SERIES, 'a', 'name:s2', undefined, 100);
    } catch (e) {
      err = e;
    }
    expect(String(err?.message)).toContain('remove the transition first');
  });

  test('speed-carrying clip: second-half trim accounts for the rate', () => {
    const fast = applySetPlaybackRate(CANVAS, HARDCUT, 'a', 'name:two', undefined, 2).source;
    // two now 60f (90–150). split at 120 → offset 30 → trim 30 + 30×2 = 90.
    const r = applySplitClip(CANVAS, fast, 'a', 'name:two', undefined, 120);
    expect(r.source).toContain('trimBefore={90}');
  });
});

describe('applyInsertTransition + applyRemoveTransition (Task 17)', () => {
  test('insert into a hard cut: fade + linearTiming + TOTAL shrinks', () => {
    const r = applyInsertTransition(CANVAS, HARDCUT, 'a', 'name:one', undefined, 'fade', 12);
    expect(r.source).toContain(
      '<TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />'
    );
    expect(r.source).toContain("import { fade } from '@remotion/transitions/fade';");
    expect(r.source).toMatch(
      /import \{ linearTiming, TransitionSeries \} from '@remotion\/transitions';/
    );
    expect(r.source).toContain('const TOTAL = 258;');
    expect(r.transitionStableId).toBeTruthy();
    const kinds = enumerateClips(CANVAS, r.source, 'a').clips.map((c) => c.kind);
    expect(kinds).toEqual(['sequence', 'transition', 'sequence', 'sequence']);
  });

  test('refuses an already-transitioned seam + a standalone pair', () => {
    expect(() =>
      applyInsertTransition(CANVAS, SERIES, 'a', 'name:s1', undefined, 'fade', 12)
    ).toThrow(/already has a transition/);
    expect(() =>
      applyInsertTransition(CANVAS, STANDALONE, 'a', 'name:base', undefined, 'fade', 12)
    ).toThrow(/standalone/);
  });

  test('remove: seam becomes a hard cut, TOTAL grows back', () => {
    const cc = enumerateClips(CANVAS, SERIES, 'a');
    const t = cc.clips.find((c) => c.kind === 'transition');
    const r = applyRemoveTransition(CANVAS, SERIES, 'a', t.stableId, undefined);
    const kinds = enumerateClips(CANVAS, r.source, 'a').clips.map((c) => c.kind);
    expect(kinds).toEqual(['sequence', 'sequence', 'transition', 'sequence']);
    expect(r.source).toContain('+ 15;'); // TOTAL grew by the removed overlap
  });
});

describe('applyInsertClipAt — Title overlay (Task 19)', () => {
  test('title block is a quoted literal (injection-safe) and lands in the overlay', () => {
    const evil = `*/ backtick \` \${process.env.HOME} "quote"`;
    const r = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'overlay',
      from: 10,
      durationInFrames: 60,
      mediaTag: 'Title',
      src: evil,
    });
    expect(r.source).toContain(JSON.stringify(evil));
    const cc = enumerateClips(CANVAS, r.source, 'a');
    expect(cc.clips.some((c) => c.tag === 'Sequence')).toBe(true);
  });

  test('overlapping overlays are ALLOWED — each is its own layer (z = document order)', () => {
    const first = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'overlay',
      from: 10,
      durationInFrames: 60,
      mediaTag: 'Title',
      src: 'Hello',
    }).source;
    const second = applyInsertClipAt(CANVAS, first, 'a', {
      lane: 'overlay',
      from: 30,
      durationInFrames: 60,
      mediaTag: 'Title',
      src: 'World',
    });
    expect(second.stableId).toBeTruthy();
    const cc = enumerateClips(CANVAS, second.source, 'a');
    expect(cc.clips.filter((c) => c.tag === 'Sequence').length).toBe(2);
  });
});

describe('greenfield first drop (Task 20)', () => {
  const EMPTY = [
    "import { DesignCanvas, DCSection, DCArtboard, VideoComp } from '@maude/canvas-lib';",
    "import { AbsoluteFill } from 'remotion';",
    'const Comp = () => (',
    "  <AbsoluteFill style={{ background: 'var(--bg-0)' }}>",
    "    <AbsoluteFill style={{ display: 'grid', placeItems: 'center' }}>",
    '      <div>Drop clips on the timeline to start the cut</div>',
    '    </AbsoluteFill>',
    '  </AbsoluteFill>',
    ');',
    'export default function NewVideo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCSection title="Assembled reel">',
    '        <DCArtboard id="reel" label="Reel" width={1920} height={1080}>',
    '          <VideoComp component={Comp} durationInFrames={150} fps={30} width={1920} height={1080} />',
    '        </DCArtboard>',
    '      </DCSection>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('first storyline drop authors the <TransitionSeries> around the beat', () => {
    const r = applyInsertClipAt('/abs/NewVideo.tsx', EMPTY, 'reel', {
      lane: 'storyline',
      index: 0,
      durationInFrames: 90,
      mediaTag: 'Video',
      src: 'assets/first.mp4',
    });
    expect(r.source).toContain("import { TransitionSeries } from '@remotion/transitions';");
    const cc = enumerateClips('/abs/NewVideo.tsx', r.source, 'reel');
    expect(cc.clips.length).toBe(1);
    expect(cc.clips[0]?.mediaSrc).toBe('assets/first.mp4');
    expect(cc.clips[0]?.tag).toBe('TransitionSeries.Sequence');
    expect(r.stableId).toBe(cc.clips[0]?.stableId);
    // a SECOND drop inserts a sibling beat normally
    const r2 = applyInsertClipAt('/abs/NewVideo.tsx', r.source, 'reel', {
      lane: 'storyline',
      index: 1,
      durationInFrames: 60,
      mediaTag: 'Video',
      src: 'assets/second.mp4',
    });
    const cc2 = enumerateClips('/abs/NewVideo.tsx', r2.source, 'reel');
    expect(cc2.clips.filter((c) => c.kind === 'sequence').length).toBe(2);
  });
});

describe('AIPlaceholder insert + resolve (Tasks 21–22)', () => {
  test('prompt is JSON.stringified into the JSX (injection fixtures) and enumerates back', () => {
    const r = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'storyline',
      index: 3,
      durationInFrames: 150,
      placeholder: { prompt: EVIL, kind: 'veo' },
    });
    // Paired-tag emit (inline-editable): the prompt is a JSON.stringified
    // literal inside the <span> child, never raw text in the JSX.
    expect(r.source).toContain(`<span>{${JSON.stringify(EVIL)}}</span>`);
    expect(r.source).toContain("import { AIPlaceholder } from '@maude/canvas-lib';");
    const cc = enumerateClips(CANVAS, r.source, 'a');
    const ph = cc.clips.find((c) => c.stableId === r.stableId);
    expect(ph?.placeholder?.prompt).toBe(EVIL);
    expect(ph?.placeholder?.kind).toBe('veo');
  });

  test('resolve swaps the slate for media in place — identity survives', () => {
    const withPh = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'storyline',
      index: 3,
      durationInFrames: 150,
      placeholder: { prompt: 'sunset over Brno', kind: 'veo' },
    });
    const id = withPh.stableId;
    const r = applyResolvePlaceholder(
      CANVAS,
      withPh.source,
      'a',
      id,
      undefined,
      'assets/deadbeef.mp4',
      'video'
    );
    expect(r.source).not.toContain('AIPlaceholder prompt');
    const cc = enumerateClips(CANVAS, r.source, 'a');
    const clip = cc.clips.find((c) => c.stableId === id);
    expect(clip?.mediaSrc).toBe('assets/deadbeef.mp4');
    expect(clip?.placeholder).toBe(null);
    // traversal src refused
    expect(() =>
      applyResolvePlaceholder(CANVAS, withPh.source, 'a', id, undefined, '../x.mp4', 'video')
    ).toThrow();
  });

  test('resolve is not fooled by a fake </AIPlaceholder> inside the prompt (F-A3)', () => {
    // Adversarial: the prompt embeds a literal close tag. The emit keeps it
    // inside the `{"…"}` string; resolve must find the REAL closer (the last
    // one), overwrite the whole element, and produce valid source.
    const withPh = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'storyline',
      index: 3,
      durationInFrames: 150,
      placeholder: { prompt: 'foo</AIPlaceholder>bar', kind: 'veo' },
    });
    const id = withPh.stableId;
    const r = applyResolvePlaceholder(
      CANVAS,
      withPh.source,
      'a',
      id,
      undefined,
      'assets/deadbeef.mp4',
      'video'
    );
    expect(r.source).not.toContain('<AIPlaceholder'); // element gone (import may remain)
    expect(r.source).not.toContain('</AIPlaceholder>');
    const cc = enumerateClips(CANVAS, r.source, 'a');
    expect(cc.clips.find((c) => c.stableId === id)?.mediaSrc).toBe('assets/deadbeef.mp4');
  });
});

describe('applyReorderOverlayLayer — vertical z-order (dogfood 2026-07-30)', () => {
  const LAYERED = [
    'const TOTAL = 300;',
    'const Comp = () => (',
    '  <>',
    '    <Sequence name="base" from={0} durationInFrames={300}><Video src="a.mp4" /></Sequence>',
    '    <Sequence name="mid" from={10} durationInFrames={90}><Img src="b.png" /></Sequence>',
    '    <Sequence name="top" from={20} durationInFrames={60}><Title /></Sequence>',
    '    <Sequence name="bed" from={0} durationInFrames={300}><Audio src="m.mp3" /></Sequence>',
    '  </>',
    ');',
    'const Title = () => <AbsoluteFill />;',
    'function Canvas() {',
    '  return (',
    '    <DCArtboard id="a"><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
    '  );',
    '}',
  ].join('\n');

  const names = (src: string) => [...src.matchAll(/<Sequence name="([^"]+)"/g)].map((m) => m[1]);

  test('moves a layer to the top of the paint order (audio excluded from the ladder)', () => {
    const cc = enumerateClips(CANVAS, LAYERED, 'a');
    const base = cc.clips.find(
      (c) => c.kind === 'sequence' && /name="base"/.test(LAYERED.slice(c.start, c.end))
    );
    const r = applyReorderOverlayLayer(CANVAS, LAYERED, 'a', base!.stableId, undefined, 2);
    expect(names(r.source)).toEqual(['mid', 'top', 'base', 'bed']);
  });

  test('one-step down + same-index no-op + audio refused', () => {
    const cc = enumerateClips(CANVAS, LAYERED, 'a');
    const spanOf = (n: string) =>
      cc.clips.find(
        (c) =>
          c.kind === 'sequence' && new RegExp(`name="${n}"`).test(LAYERED.slice(c.start, c.end))
      );
    const top = spanOf('top');
    const down = applyReorderOverlayLayer(CANVAS, LAYERED, 'a', top!.stableId, undefined, 1);
    expect(names(down.source)).toEqual(['base', 'top', 'mid', 'bed']);
    const noop = applyReorderOverlayLayer(CANVAS, LAYERED, 'a', top!.stableId, undefined, 2);
    expect(noop.source).toBe(LAYERED);
    const bed = spanOf('bed');
    expect(() =>
      applyReorderOverlayLayer(CANVAS, LAYERED, 'a', bed!.stableId, undefined, 0)
    ).toThrow();
  });

  test('a series beat is refused (horizontal reorder owns it)', () => {
    const cc = enumerateClips(CANVAS, SERIES, 'a');
    const beat = cc.clips.find((c) => c.kind === 'sequence');
    expect(() =>
      applyReorderOverlayLayer(CANVAS, SERIES, 'a', beat!.stableId, undefined, 1)
    ).toThrow();
  });
});

describe('applyEditTransition (Task 15)', () => {
  test('duration change rewrites the timing int + shrinks TOTAL', () => {
    const cc = enumerateClips(CANVAS, SERIES, 'a');
    const t = cc.clips.find((c) => c.kind === 'transition');
    const r = applyEditTransition(CANVAS, SERIES, 'a', t.stableId, undefined, {
      durationInFrames: 30,
    });
    expect(r.source).toContain('durationInFrames: 30');
    // overlap grew 15 → 30 ⇒ comp 15 shorter
    expect(r.source).toContain('- 15;');
  });

  test('presentation swap rewrites the factory + adds the import', () => {
    const cc = enumerateClips(CANVAS, SERIES, 'a');
    const t = cc.clips.find((c) => c.kind === 'transition');
    const r = applyEditTransition(CANVAS, SERIES, 'a', t.stableId, undefined, {
      presentation: 'wipe',
    });
    expect(r.source).toContain('presentation={wipe()}');
    expect(r.source).toContain("import { wipe } from '@remotion/transitions/wipe';");
    expect(() =>
      applyEditTransition(CANVAS, SERIES, 'a', t.stableId, undefined, { presentation: 'zoom' })
    ).toThrow();
  });
});

describe('applyEnsureVideoComp — kind="video" artboard upgrade', () => {
  const BRIEF = [
    'import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";',
    '',
    'export default function Video() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCSection id="brief-board" title="Brief">',
    '        <DCArtboard kind="video" id="brief" label="Brief" width={1280} height={800}>',
    '          <div>annotate me</div>',
    '        </DCArtboard>',
    '      </DCSection>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('storyline drop injects a VideoComp in place, then inserts the beat', () => {
    const r = applyInsertClipAt('/abs/Video.tsx', BRIEF, undefined, {
      lane: 'storyline',
      durationInFrames: 90,
      mediaTag: 'Video',
      src: 'assets/x.mp4',
    });
    expect(r.source).toContain('<VideoComp component={VideoCut}');
    expect(r.source).toContain('width={1280} height={800}');
    expect(r.source).toMatch(/import \{[^}]*AbsoluteFill[^}]*\} from 'remotion';/);
    // The canvas declares `export default function Video()`, so the inserted
    // media element is ALIASED to dodge the collision — it is no longer
    // rewritten to <OffthreadVideo>, which silently cost the audio track.
    expect(r.source).toContain('<MaudeVideo src="assets/x.mp4" />');
    expect(r.source).toContain(`import { Video as MaudeVideo } from '@remotion/media';`);
    const cc = enumerateClips('/abs/Video.tsx', r.source, 'brief');
    expect(cc.compName).toBe('VideoCut');
    expect(cc.clips.length).toBe(1);
    expect(cc.clips[0]?.mediaSrc).toBe('assets/x.mp4');
    expect(r.stableId).toBe(cc.clips[0]?.stableId);
  });

  test('a canvas with NO kind="video" artboard still refuses with guidance', () => {
    const PLAIN = BRIEF.replace(' kind="video"', '');
    expect(() =>
      applyInsertClipAt('/abs/Video.tsx', PLAIN, undefined, {
        lane: 'storyline',
        durationInFrames: 90,
        mediaTag: 'Video',
        src: 'assets/x.mp4',
      })
    ).toThrow(/Kind/);
  });
});

describe('layers model — set-text + move between layers', () => {
  test('set-text rewrites a Title literal and an AIPlaceholder prompt', () => {
    const withTitle = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'overlay',
      from: 5,
      durationInFrames: 40,
      mediaTag: 'Title',
      src: 'Hello',
    });
    const r = applySetClipText(
      CANVAS,
      withTitle.source,
      'a',
      withTitle.stableId,
      undefined,
      'Nový titulek "s uvozovkami"'
    );
    expect(r.source).toContain(JSON.stringify('Nový titulek "s uvozovkami"'));
    const withPh = applyInsertClipAt(CANVAS, SERIES, 'a', {
      lane: 'storyline',
      index: 3,
      durationInFrames: 60,
      placeholder: { prompt: 'stary prompt', kind: 'veo' },
    });
    const r2 = applySetClipText(
      CANVAS,
      withPh.source,
      'a',
      withPh.stableId,
      undefined,
      'novy prompt'
    );
    const cc = enumerateClips(CANVAS, r2.source, 'a');
    expect(cc.clips.find((c) => c.stableId === withPh.stableId)?.placeholder?.prompt).toBe(
      'novy prompt'
    );
  });

  test('beat → overlay layer keeps timing and ripples the storyline', () => {
    const r = applyMoveClipToOverlay(CANVAS, HARDCUT, 'a', 'name:two', undefined);
    const cc = enumerateClips(CANVAS, r.source, 'a');
    const beats = cc.clips.filter((c) => c.tag !== 'Sequence' && c.kind === 'sequence');
    const overlays = cc.clips.filter((c) => c.tag === 'Sequence');
    expect(beats.length).toBe(2);
    expect(overlays.length).toBe(1);
    expect(overlays[0]?.from).toBe(90); // the beat started at 90
    expect(overlays[0]?.mediaProps?.trimBefore).toBe(30); // rode along
    expect(r.source).toContain('const TOTAL = 210;'); // comp ends where the overlay ends (90+120)
  });

  test('overlay → storyline round-trips: the moved-out beat comes back as a beat', () => {
    const out = applyMoveClipToOverlay(CANVAS, HARDCUT, 'a', 'name:two', undefined);
    const back = applyMoveClipToStoryline(CANVAS, out.source, 'a', out.stableId, undefined);
    const cc = enumerateClips(CANVAS, back.source, 'a');
    const beats = cc.clips.filter((c) => c.kind === 'sequence' && c.tag !== 'Sequence');
    expect(beats.length).toBe(3);
    expect(beats.some((c) => c.mediaSrc === 'b.mp4')).toBe(true);
    expect(cc.clips.filter((c) => c.tag === 'Sequence').length).toBe(0); // overlay row gone
    expect(back.source).toContain('const TOTAL = 270;'); // exact content end again
  });

  // Bug: issue #81 — an AI placeholder slate (no media src yet) was refused by
  // both move verbs, so it could never leave the storyline it was dropped
  // into. A placeholder has no <src> to graft, but it has a prompt + kind
  // that can ride over unchanged.
  test('AI placeholder beat → overlay layer keeps the prompt (no media src required)', () => {
    const withPh = applyInsertClipAt(CANVAS, HARDCUT, 'a', {
      lane: 'storyline',
      index: 3,
      durationInFrames: 60,
      placeholder: { prompt: 'drone shot over Brno', kind: 'veo' },
    });
    const r = applyMoveClipToOverlay(
      CANVAS,
      withPh.source,
      'a',
      withPh.stableId as string,
      undefined
    );
    const cc = enumerateClips(CANVAS, r.source, 'a');
    const overlays = cc.clips.filter((c) => c.tag === 'Sequence');
    expect(overlays.length).toBe(1);
    expect(overlays[0]?.placeholder?.prompt).toBe('drone shot over Brno');
    expect(overlays[0]?.mediaSrc).toBe(null);
    const beats = cc.clips.filter((c) => c.kind === 'sequence' && c.tag !== 'Sequence');
    expect(beats.length).toBe(3); // the placeholder beat left the storyline
  });

  test('AI placeholder overlay → storyline round-trips the prompt back into a beat', () => {
    const withPh = applyInsertClipAt(CANVAS, HARDCUT, 'a', {
      lane: 'overlay',
      from: 0,
      durationInFrames: 45,
      placeholder: { prompt: 'sunset time-lapse', kind: 'image' },
    });
    const back = applyMoveClipToStoryline(
      CANVAS,
      withPh.source,
      'a',
      withPh.stableId as string,
      undefined
    );
    const cc = enumerateClips(CANVAS, back.source, 'a');
    const beats = cc.clips.filter((c) => c.kind === 'sequence' && c.tag !== 'Sequence');
    expect(beats.some((c) => c.placeholder?.prompt === 'sunset time-lapse')).toBe(true);
    expect(cc.clips.filter((c) => c.tag === 'Sequence').length).toBe(0); // overlay row gone
  });

  // Adversarial (security review 2026-08-07): the move path must go through
  // the same JSON.stringify escaping as a fresh insert (DDR-150 P1) — prove
  // it with the same EVIL fixture the insert/resolve suite uses above, not
  // just infer it from code-path sharing.
  test('AI placeholder move preserves EVIL-prompt escaping (F-A3 companion)', () => {
    const withPh = applyInsertClipAt(CANVAS, HARDCUT, 'a', {
      lane: 'storyline',
      index: 3,
      durationInFrames: 60,
      placeholder: { prompt: EVIL, kind: 'veo' },
    });
    const moved = applyMoveClipToOverlay(
      CANVAS,
      withPh.source,
      'a',
      withPh.stableId as string,
      undefined
    );
    expect(moved.source).toContain(`<span>{${JSON.stringify(EVIL)}}</span>`);
    const back = applyMoveClipToStoryline(
      CANVAS,
      moved.source,
      'a',
      moved.stableId as string,
      undefined
    );
    expect(back.source).toContain(`<span>{${JSON.stringify(EVIL)}}</span>`);
    const cc = enumerateClips(CANVAS, back.source, 'a');
    const beats = cc.clips.filter((c) => c.kind === 'sequence' && c.tag !== 'Sequence');
    expect(beats.some((c) => c.placeholder?.prompt === EVIL)).toBe(true);
  });
});
