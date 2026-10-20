// S7.22 — kinds/safe-zones.ts: the closed preset table, the band geometry and the "under a band" flags
// (08 ak-safe-zones). Pure — no DOM.

import { describe, expect, test } from 'bun:test';

import {
  bandRects,
  cropRects,
  flagsUnderBands,
  isSafeZoneId,
  SAFE_ZONE_IDS,
  SAFE_ZONE_OPTIONS,
  SAFE_ZONE_PRESETS,
  SAFE_ZONES_CHECKED,
  SAFE_ZONES_FOOT,
  safeZonePreset,
} from '../kinds/safe-zones.ts';

describe('the preset table', () => {
  test('the menu is the canvas menu: None, then six platforms, in order', () => {
    expect(SAFE_ZONE_OPTIONS.map((o) => o.label)).toEqual([
      'None',
      'Instagram story',
      'Instagram Reels',
      'Instagram profile grid',
      'TikTok',
      'YouTube Shorts',
      'Facebook event cover',
    ]);
    expect(SAFE_ZONE_OPTIONS[0]?.value).toBe('');
  });

  test('ids are kebab-case, unique, and the prop value (canvas-tsx.md: "instagram-reels")', () => {
    expect(SAFE_ZONE_IDS).toContain('instagram-reels');
    expect(new Set(SAFE_ZONE_IDS).size).toBe(SAFE_ZONE_IDS.length);
    for (const id of SAFE_ZONE_IDS) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });

  test('the foot says "never exported" and carries the date the figures were checked', () => {
    expect(SAFE_ZONES_CHECKED).toBe('Oct 2026');
    expect(SAFE_ZONES_FOOT).toBe(
      'Shown on the canvas only — never exported. Zones as each platform publishes them, checked Oct 2026.'
    );
  });

  test('every preset has a note, and either bands or a crop', () => {
    for (const p of SAFE_ZONE_PRESETS) {
      expect(p.note.length).toBeGreaterThan(10);
      expect(p.bands.length > 0 || !!p.crop).toBe(true);
    }
  });

  test("an unknown id (a newer peer's) is no preset, never an error", () => {
    expect(isSafeZoneId('instagram-reels')).toBe(true);
    expect(isSafeZoneId('snapchat')).toBe(false);
    expect(isSafeZoneId('__proto__')).toBe(false);
    expect(isSafeZoneId(42)).toBe(false);
    expect(safeZonePreset('snapchat')).toBeNull();
    expect(safeZonePreset('constructor')).toBeNull();
    expect(safeZonePreset(undefined)).toBeNull();
  });
});

describe('bandRects', () => {
  test("Reels on 1080 × 1920 is the canvas's bands: top 11.5%, bottom 21.9%, buttons 13% between them", () => {
    const r = bandRects(safeZonePreset('instagram-reels'), 1080, 1920);
    const by = Object.fromEntries(r.map((b) => [b.edge, b]));
    expect(by.top).toMatchObject({ x: 0, y: 0, w: 1080, label: 'Profile and progress bar' });
    expect(by.top?.h).toBeCloseTo(220.8, 1);
    expect(by.bottom).toMatchObject({ x: 0, w: 1080, label: 'Caption and audio' });
    expect(by.bottom?.h).toBeCloseTo(420.48, 1);
    expect(by.bottom?.y).toBeCloseTo(1920 - 420.48, 1);
    expect(by.right?.w).toBeCloseTo(140.4, 1);
    expect(by.right?.x).toBeCloseTo(1080 - 140.4, 1);
    // the side band runs between the two, so a corner is covered once
    expect(by.right?.y).toBeCloseTo(by.top?.h ?? -1, 5);
    expect((by.right?.y ?? 0) + (by.right?.h ?? 0)).toBeCloseTo(by.bottom?.y ?? -1, 5);
  });

  test('story has no side band; the bands scale with the artboard, not with 1080', () => {
    const big = bandRects(safeZonePreset('instagram-story'), 1080, 1920);
    const small = bandRects(safeZonePreset('instagram-story'), 540, 960);
    expect(big.map((b) => b.edge)).toEqual(['top', 'bottom']);
    expect(small[0]?.h).toBeCloseTo((big[0]?.h ?? 0) / 2, 5);
  });

  test('a grid crop has no bands; none and unknown draw nothing; a zero-size artboard draws nothing', () => {
    expect(bandRects(safeZonePreset('instagram-grid'), 1080, 1080)).toEqual([]);
    expect(bandRects(null, 1080, 1920)).toEqual([]);
    expect(bandRects(safeZonePreset('tiktok'), 0, 1920)).toEqual([]);
    expect(bandRects(safeZonePreset('tiktok'), Number.NaN, 1920)).toEqual([]);
  });
});

describe('cropRects', () => {
  test('a 1:1 post shows as 3:4 in the grid: 12.5% off each side (the pale sides)', () => {
    const c = cropRects(safeZonePreset('instagram-grid'), 1080, 1080);
    expect(c?.frame).toEqual({ x: 135, y: 0, w: 810, h: 1080 });
    expect(c?.cut).toEqual([
      { x: 0, y: 0, w: 135, h: 1080 },
      { x: 945, y: 0, w: 135, h: 1080 },
    ]);
  });

  test('a 1.91:1 event cover shows as 5:2 on a computer: top and bottom are cut', () => {
    const c = cropRects(safeZonePreset('facebook-event-cover'), 1920, 1005);
    expect(c?.frame.w).toBe(1920);
    expect(c?.frame.h).toBeCloseTo(768, 5);
    expect(c?.cut.length).toBe(2);
    expect(c?.cut[0]?.h).toBeCloseTo((1005 - 768) / 2, 5);
  });

  test("an artboard that already has the platform's shape loses nothing", () => {
    expect(cropRects(safeZonePreset('instagram-grid'), 810, 1080)).toBeNull();
    expect(cropRects(safeZonePreset('tiktok'), 1080, 1920)).toBeNull();
  });
});

describe('flagsUnderBands', () => {
  const bands = bandRects(safeZonePreset('instagram-reels'), 1080, 1920);

  test('text in the caption band is flagged "Under the caption" (the canvas\'s own example)', () => {
    const flags = flagsUnderBands(bands, [
      { x: 80, y: 1000, w: 600, h: 80 }, // in the open middle
      { x: 80, y: 1600, w: 500, h: 60 }, // under the caption
    ]);
    expect(flags.map((f) => f.band.under)).toEqual(['Under the caption']);
    expect(flags[0]?.item).toEqual({ x: 80, y: 1600, w: 500, h: 60 });
  });

  test('one flag per band, and only the first item under it', () => {
    const flags = flagsUnderBands(bands, [
      { x: 80, y: 1600, w: 500, h: 60 },
      { x: 80, y: 1700, w: 500, h: 60 },
    ]);
    expect(flags.length).toBe(1);
    expect(flags[0]?.item.y).toBe(1600);
  });

  test('an item only grazing a band is not under it; one mostly inside is', () => {
    // the bottom band starts at 1499.52; an item 100 tall with 10 inside is 10% → clear
    expect(flagsUnderBands(bands, [{ x: 80, y: 1409.52, w: 400, h: 100 }])).toEqual([]);
    expect(flagsUnderBands(bands, [{ x: 80, y: 1449.52, w: 400, h: 100 }]).length).toBe(1);
  });

  test('buttons: text in the right band is flagged; empty boxes and no bands flag nothing', () => {
    expect(
      flagsUnderBands(bands, [{ x: 960, y: 800, w: 100, h: 50 }]).map((f) => f.band.under)
    ).toEqual(['Under the buttons']);
    expect(flagsUnderBands(bands, [{ x: 960, y: 800, w: 0, h: 50 }])).toEqual([]);
    expect(flagsUnderBands([], [{ x: 0, y: 0, w: 10, h: 10 }])).toEqual([]);
  });
});
