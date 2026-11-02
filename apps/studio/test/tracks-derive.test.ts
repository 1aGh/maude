// S7.8 — the four tracks are derived, never stored (C35; V2-1.12 §5.3): Text · Graphics · Video · Music, with
// an old comp's overlay lane landing on Video 2 and a second overlapping music bed on Music 2.
import { describe, expect, test } from 'bun:test';
import { deriveTracks, TRACKS, trackOfSequence } from '../client/v2/timeline/tracks.js';

const beat = (label: string, from: number, duration: number) => ({
  label,
  series: true,
  mediaTag: 'Video',
  from,
  duration,
});
const ids = (t: { id: string }[]) => t.map((x) => x.id);

describe('four fixed tracks, top covers bottom', () => {
  test('an empty comp still draws Text · Graphics · Video · Music, in that order', () => {
    expect(ids(deriveTracks({}))).toEqual(['text', 'gfx', 'video', 'music']);
  });

  test('the table is the order the canvas draws, Video 2 directly above Video', () => {
    expect(ids(TRACKS)).toEqual(['text', 'gfx', 'video2', 'video', 'music', 'music2']);
  });

  test('a storyline beat is Video', () => {
    expect(trackOfSequence(beat('Touchdown', 0, 60))).toBe('video');
  });
});

describe('C35 — an old comp’s overlay lanes become Video 2', () => {
  const sequences = [
    beat('Oslava', 0, 90),
    { label: 'pip.mp4', series: false, mediaTag: 'OffthreadVideo', from: 10, duration: 40 },
    { label: 'photo', series: false, mediaTag: 'Img', from: 20, duration: 30 },
    { label: 'bed.mp4', series: false, loose: true, mediaTag: 'Video', from: 0, duration: 90 },
  ];

  test('a standalone video, an image and a loose bed all derive to Video 2', () => {
    const tracks = deriveTracks({ sequences });
    expect(ids(tracks)).toEqual(['text', 'gfx', 'video2', 'video', 'music']);
    expect(tracks.find((t) => t.id === 'video2')?.members.map((m) => m.index)).toEqual([1, 2, 3]);
    expect(tracks.find((t) => t.id === 'video')?.members.map((m) => m.index)).toEqual([0]);
  });

  test('Video 2 is drawn only when something is on it, or the person added it', () => {
    expect(ids(deriveTracks({ sequences: [beat('A', 0, 30)] }))).not.toContain('video2');
    expect(ids(deriveTracks({ extra: ['video2'] }))).toContain('video2');
  });
});

describe('Text and Graphics', () => {
  test('a title scene is Text, a logo bug is Graphics', () => {
    const t = deriveTracks({
      sequences: [
        { label: 'DŘINA', series: false, mediaTag: null, from: 45, duration: 60 },
        { label: 'LogoBug', series: false, mediaTag: null, from: 0, duration: 360 },
      ],
    });
    expect(t.find((x) => x.id === 'text')?.members).toEqual([{ kind: 'seq', index: 0 }]);
    expect(t.find((x) => x.id === 'gfx')?.members).toEqual([{ kind: 'seq', index: 1 }]);
  });
});

describe('Music', () => {
  test('a bed is Music; a second one playing at the same time is Music 2', () => {
    const t = deriveTracks({
      audio: [
        { from: 0, duration: 450 },
        { from: 100, duration: 100 },
        { from: 460, duration: 30 },
      ],
    });
    expect(t.find((x) => x.id === 'music')?.members.map((m) => m.index)).toEqual([0, 2]);
    expect(t.find((x) => x.id === 'music2')?.members.map((m) => m.index)).toEqual([1]);
  });

  test('audio clips in the sequence list share the lane rule with the beds', () => {
    const t = deriveTracks({
      sequences: [{ label: 'sting', series: false, mediaTag: 'Audio', from: 0, duration: 30 }],
      audio: [{ from: 0, duration: 450 }],
    });
    expect(t.find((x) => x.id === 'music')?.members).toEqual([{ kind: 'seq', index: 0 }]);
    expect(t.find((x) => x.id === 'music2')?.members).toEqual([{ kind: 'audio', index: 0 }]);
  });
});
