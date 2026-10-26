// P8 round 7 (07 · M1): a video artboard's label reads "Name · Format · Length" and, selected, ends with the
// size chip ("Hype trailer · Reels · 0:14   1080 × 1920"); the length is the SAME whole second the Length row,
// the timeline readout and the ruler read (floor, never a round that says 0:29 beside 0:28).
import { describe, expect, test } from 'bun:test';
import { videoLabelParts, videoLabelTail } from '../editing/video-label.ts';

const reels = { fps: 30, durationInFrames: 14 * 30 + 29, width: 1080, height: 1920 };

describe('videoLabelParts', () => {
  test('floors the length, names the format, keeps the size for the chip', () => {
    const p = videoLabelParts('Hype trailer', reels);
    expect(p.length).toBe('0:14');
    expect(p.format).toBe('Reels');
    expect(p.dims).toBe('1080 × 1920');
  });

  test('a 16:9, a 1:1 and an odd ratio', () => {
    expect(
      videoLabelParts('Recap', { fps: 30, durationInFrames: 900, width: 1920, height: 1080 }).format
    ).toBe('16:9');
    expect(
      videoLabelParts('Recap', { fps: 30, durationInFrames: 900, width: 1080, height: 1080 }).format
    ).toBe('1:1');
    // 1280 x 720 reduces to 16:9, 320 x 180 too
    expect(
      videoLabelParts('Trailer', { fps: 30, durationInFrames: 900, width: 1280, height: 720 })
        .format
    ).toBe('16:9');
    expect(
      videoLabelParts('Trailer', { fps: 30, durationInFrames: 900, width: 317, height: 211 }).format
    ).toBe('');
  });

  test('a label that already says it is not told twice', () => {
    // length already there
    expect(videoLabelParts('Recap · Reels · 0:30', reels)).toEqual({
      format: '',
      length: '',
      dims: '1080 × 1920',
    });
    // a size already there: no format word, no chip
    const p = videoLabelParts('Reel · 320×180', {
      fps: 30,
      durationInFrames: 210,
      width: 320,
      height: 180,
    });
    expect(p.format).toBe('');
    expect(p.dims).toBe('');
    expect(p.length).toBe('0:07');
  });

  test('no frames yet = nothing to say', () => {
    expect(
      videoLabelParts('Trailer', { fps: 0, durationInFrames: 0, width: 0, height: 0 })
    ).toEqual({
      format: '',
      length: '',
      dims: '',
    });
  });
});

describe('videoLabelTail', () => {
  test('rest: " · Format · Length"; selected adds the size chip after an em space', () => {
    expect(videoLabelTail('Hype trailer', reels, false)).toBe(' · Reels · 0:14');
    expect(videoLabelTail('Hype trailer', reels, true)).toBe(' · Reels · 0:14  1080 × 1920');
  });
  test('empty when there is nothing to add', () => {
    expect(
      videoLabelTail('Trailer', { fps: 0, durationInFrames: 0, width: 0, height: 0 }, true)
    ).toBe('');
  });
});

describe('wiring', () => {
  const read = (p: string) => Bun.file(new URL(p, import.meta.url)).text();
  test('the comp stamps the tail on its label, the label draws it, the selection adds the chip', async () => {
    expect(await read('../video-comp.tsx')).toContain("'data-dc-vtail'");
    expect(await read('../canvas-lib.tsx')).toContain('content: attr(data-dc-vtail)');
    const h = await read('../editing/artboard-handles.tsx');
    expect(h).toContain('videoLabelTail(');
    expect(h).toContain('[data-dc-vtail]::after');
  });
});
