// P8 c6 (14 ed-ab-tidy) — the align / Tidy-up bar over a group of artboards clears their NAME LABELS (it used to sit
// on them: the labels read through the bar), and an object group is measured as before.
import { describe, expect, test } from 'bun:test';
import { ARTBOARD_LABEL_H, barPlacement, clearLabels } from '../editing/align-bar.tsx';

describe('the bar clears the artboard labels', () => {
  const box = { l: 400, t: 300, r: 800, b: 600 };
  const bar = { w: 320, h: 40 };
  const win = { w: 1600, h: 1000 };

  test('an artboard group is lifted by the label row; an object group is not', () => {
    expect(clearLabels(box, 'artboards')).toEqual({ ...box, t: 300 - ARTBOARD_LABEL_H });
    expect(clearLabels(box, 'objects')).toBe(box);
  });

  test('so the bar sits a gap above the LABELS, not above the body', () => {
    const over = barPlacement(clearLabels(box, 'artboards'), bar, win);
    const body = barPlacement(box, bar, win);
    expect(body.top - over.top).toBe(ARTBOARD_LABEL_H);
  });
});
