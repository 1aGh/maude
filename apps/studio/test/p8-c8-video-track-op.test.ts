// P8 C8 (07 · the per-track view / volume button): `clip.track` hides or mutes a whole track in ONE write,
// idempotently, skipping what has nothing to change.

import { describe, expect, test } from 'bun:test';

import { CLIP_OPS } from '../edit-ops/clip/index.ts';
import { applyTrack, trackPatch } from '../edit-ops/clip/track.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';

const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { Sequence } from 'remotion';",
  "import { Video } from '@remotion/media';",
  'const Comp = () => (',
  '  <>',
  '    <Sequence name="one" from={0} durationInFrames={90}><Video src="a.mp4" /></Sequence>',
  '    <Sequence name="two" from={90} durationInFrames={90}><Video src="b.mp4" muted /></Sequence>',
  '    <Sequence name="t1" from={0} durationInFrames={60}><div>Hello</div></Sequence>',
  '    <Sequence name="t2" from={60} durationInFrames={60}><div>World</div></Sequence>',
  '  </>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={180} fps={30} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');
const FILE = 'ui/Reel.tsx';

describe('clip.track', () => {
  test('is an artboard-scoped op in the one table', () => {
    const op = CLIP_OPS.find((o) => o.id === 'clip.track');
    expect(op?.scope).toBe('artboard');
    expect(EDIT_OPS).toContain(op as never);
  });

  test('hide: every named clip in one write; a second run changes nothing; show strips the wrapper', () => {
    const a = applyTrack(FILE, SRC, 'reel', { ids: ['name:t1', 'name:t2'], hidden: true });
    expect(a.changed).toBe(2);
    expect((a.source.match(/\{false && \(/g) ?? []).length).toBe(2);
    const again = applyTrack(FILE, a.source, 'reel', { ids: ['name:t1', 'name:t2'], hidden: true });
    expect(again.changed).toBe(0);
    expect(again.source).toBe(a.source);
    const back = applyTrack(FILE, a.source, 'reel', { ids: ['name:t1', 'name:t2'], hidden: false });
    expect(back.changed).toBe(2);
    expect(back.source).toBe(SRC);
  });

  test('hide: a half-hidden track hides the rest (set, never toggle)', () => {
    const one = applyTrack(FILE, SRC, 'reel', { ids: ['name:t1'], hidden: true }).source;
    const all = applyTrack(FILE, one, 'reel', { ids: ['name:t1', 'name:t2'], hidden: true });
    expect(all.changed).toBe(1);
    expect((all.source.match(/\{false && \(/g) ?? []).length).toBe(2);
  });

  test('mute: sets the bare attribute on each clip’s media, leaves a muted one, unmutes on false', () => {
    const m = applyTrack(FILE, SRC, 'reel', { ids: ['name:one', 'name:two'], muted: true });
    expect(m.changed).toBe(1);
    expect(m.source).toContain('<Video muted src="a.mp4" />');
    expect(m.source).toContain('<Video src="b.mp4" muted />');
    const u = applyTrack(FILE, m.source, 'reel', { ids: ['name:one', 'name:two'], muted: false });
    expect(u.changed).toBe(2);
    expect(u.source).not.toContain('muted');
  });

  test('a clip with nothing to change is skipped, not an error', () => {
    const r = applyTrack(FILE, SRC, 'reel', { ids: ['name:t1', 'name:nope'], muted: true });
    expect(r.changed).toBe(0);
    expect(r.skipped).toBe(2);
    expect(r.source).toBe(SRC);
  });

  test('the patch needs ids and exactly one of hidden / muted', () => {
    expect(() => trackPatch(FILE, { ids: [], hidden: true })).toThrow();
    expect(() => trackPatch(FILE, { ids: ['a'] })).toThrow();
    expect(() => trackPatch(FILE, { ids: ['a'], hidden: true, muted: true })).toThrow();
    expect(trackPatch(FILE, { ids: ['a', 3, ''], muted: false })).toEqual({
      ids: ['a'],
      hidden: undefined,
      muted: false,
    });
  });
});
