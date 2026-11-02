// S8.15 (12 · ia-photo-inspector) — the eight looks and Light / Colour over a plain v1 PhotoEdit.
import { describe, expect, test } from 'bun:test';
import {
  cutOutOn,
  LOOKS,
  lookOf,
  signed,
  sliderOf,
  withCutOut,
  withLook,
  withSlider,
} from '../client/v2/photo/looks.js';
import { validatePhotoEdit } from '../photo/schema.ts';

describe('looks', () => {
  test('the eight looks, in the canvas order and words', () => {
    expect(LOOKS.map((l) => l.label)).toEqual([
      'Original',
      'Brighter',
      'Warmer',
      'Cooler',
      'Punchy',
      'Mono',
      'Club green',
      'Night',
    ]);
  });

  test('each look is a valid v1 PhotoEdit and reads back as itself', () => {
    for (const look of LOOKS) {
      const e = withLook({}, look.id);
      expect(validatePhotoEdit(e).ok).toBe(true);
      expect(lookOf(e)).toBe(look.id);
    }
  });

  test('Original is the empty edit; an empty or missing edit is Original', () => {
    expect(withLook({ adjustments: { contrast: 0.25 } }, 'original')).toEqual({});
    expect(lookOf({})).toBe('original');
    expect(lookOf(null)).toBe('original');
  });

  test('a look keeps the sliders and everything Advanced holds', () => {
    const before = {
      version: 1,
      adjustments: { exposure: 0.12, saturation: 0.24, invert: 0.5, contrast: 0.9 },
      grain: { enabled: true, amount: 0.3 },
      mask: { preset: 'vignette', strength: 0.4 },
      backgroundRemoved: { enabled: true, maskAsset: 'assets/aaaaaaaa.png' },
    };
    const e = withLook(before, 'mono');
    expect(e).toEqual({
      version: 1,
      adjustments: { exposure: 0.12, saturation: 0.24, invert: 0.5, grayscale: 1 },
      grain: { enabled: true, amount: 0.3 },
      mask: { preset: 'vignette', strength: 0.4 },
      backgroundRemoved: { enabled: true, maskAsset: 'assets/aaaaaaaa.png' },
    });
    expect(lookOf(e)).toBe('mono');
    expect(before.adjustments.contrast).toBe(0.9); // not mutated
  });

  test('a duotone look replaces and is replaced', () => {
    const green = withLook({}, 'club-green');
    expect(green.duotone?.enabled).toBe(true);
    expect(withLook(green, 'warmer').duotone).toBeUndefined();
  });

  test('an edit of its own is no look', () => {
    expect(lookOf({ adjustments: { contrast: 0.61 } })).toBeNull();
    expect(lookOf({ duotone: { enabled: true, colorA: '#000000', colorB: '#ffffff' } })).toBeNull();
    // a duotone switched off draws nothing: still the look underneath
    expect(lookOf({ duotone: { enabled: false, colorA: '#000000' } })).toBe('original');
  });
});

describe('Light and Colour', () => {
  test('map to exposure and saturation, −100 … +100', () => {
    let e = withSlider({}, 'light', 12);
    e = withSlider(e, 'colour', -24);
    expect(e).toEqual({ adjustments: { exposure: 0.12, saturation: -0.24 } });
    expect(sliderOf(e, 'light')).toBe(12);
    expect(sliderOf(e, 'colour')).toBe(-24);
    expect(validatePhotoEdit(e).ok).toBe(true);
  });

  test('never move the look; 0 removes the field; values clamp', () => {
    const punchy = withLook({}, 'punchy');
    expect(lookOf(withSlider(punchy, 'colour', 40))).toBe('punchy');
    expect(withSlider(withSlider({}, 'light', 30), 'light', 0)).toEqual({});
    expect(sliderOf(withSlider({}, 'light', 500), 'light')).toBe(100);
  });

  test('said with a sign', () => {
    expect([signed(12), signed(-8), signed(0)]).toEqual(['+12', '−8', '0']);
  });
});

describe('background cut-out', () => {
  test('on needs a mask; off keeps it for later', () => {
    expect(cutOutOn({})).toBe(false);
    const on = withCutOut({}, true, 'assets/bbbbbbbb.png');
    expect(cutOutOn(on)).toBe(true);
    const off = withCutOut(on, false);
    expect(off.backgroundRemoved).toEqual({ enabled: false, maskAsset: 'assets/bbbbbbbb.png' });
    expect(cutOutOn(withCutOut(off, true))).toBe(true);
    expect(validatePhotoEdit(off).ok).toBe(true);
  });
});
