// S7.20 — the preset catalogue is ONE table: the F size picker, the `artboard.insert-preset` op, the search index and
// the v1 Edit › Advanced ▸ New artboard rows all read it (08 `ak-picker`, `ak-picker-full`).

import { describe, expect, test } from 'bun:test';

import { SCREEN_PRESETS } from '../client/inspector/css-vocab.jsx';
import { ARTBOARD_PRESET } from '../client/v2/shell/menu-runner.js';
import {
  customSpec,
  groupOf,
  KIND_WORD,
  PRESET_GROUPS,
  PRESET_ID_RE,
  PRESETS,
  presetById,
  pushRecent,
  RECENT_MAX,
  recentPresets,
  searchPresets,
  specOf,
} from '../kinds/presets.ts';
import { readSizeMm } from '../kinds/print-custom.ts';
import { resolvePrintArtboard } from '../print/units.ts';

describe('the catalogue', () => {
  test('five groups in the canvas order, with the 08 badges and counts', () => {
    expect(PRESET_GROUPS.map((g) => [g.id, g.title, g.badge, g.presets.length])).toEqual([
      ['app', 'App', 'Fixed size', 4],
      ['web', 'Web page', 'Grows as you add', 4],
      ['social', 'Social', 'Fixed size', 6],
      ['print', 'Print', 'mm, with bleed', 7],
      ['video', 'Video', 'Has a timeline', 3],
    ]);
  });

  test('three sizes up front per group ("All N" opens the rest)', () => {
    for (const g of PRESET_GROUPS) expect(g.presets.filter((p) => p.top)).toHaveLength(3);
  });

  test('ids are unique and readable; names are unique within a group', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(PRESET_ID_RE);
    for (const g of PRESET_GROUPS) {
      const names = g.presets.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test('App and Social both make "Fixed size"; the four kinds have one word each', () => {
    expect(groupOf('app').kind).toBe('digital');
    expect(groupOf('social').kind).toBe('digital');
    expect(KIND_WORD).toEqual({
      digital: 'Fixed size',
      web: 'Web page',
      print: 'Print',
      video: 'Video',
    });
    for (const p of PRESETS) expect(p.kind).toBe(groupOf(p.group).kind);
  });

  test('sizes the canvas names: FB event cover 1920 × 1005, A6 with bleed 419 × 581 px, Letter in inches', () => {
    expect(presetById('social-fb-event')).toMatchObject({
      name: 'FB event cover',
      sizeText: '1920 × 1005',
      widthPx: 1920,
      heightPx: 1005,
    });
    expect(presetById('print-a6')).toMatchObject({
      sizeText: '105 × 148 mm',
      widthPx: 419,
      heightPx: 581,
    });
    expect(presetById('print-letter')?.sizeText).toBe('8.5 × 11 in');
    expect(presetById('print-business-card')?.sizeText).toBe('85 × 55 mm');
    expect(presetById('web-desktop')?.sizeText).toBe('1440 wide');
  });

  test('a print preset carries the paper it is, and its px come from resolvePrintArtboard', () => {
    for (const p of PRESETS.filter((x) => x.kind === 'print')) {
      const r = resolvePrintArtboard({ paper: p.print?.paper as string });
      expect([p.widthPx, p.heightPx]).toEqual([r.widthPx, r.heightPx]);
    }
  });
});

describe('search ("A5", "story", "1920")', () => {
  test('A5 finds A5 first', () => {
    expect(searchPresets('A5')[0]?.id).toBe('print-a5');
    expect(searchPresets('a5').map((p) => p.id)).toEqual(['print-a5']);
  });

  test('story finds the still and the moving one', () => {
    const ids = searchPresets('story').map((p) => p.id);
    expect(ids[0]).toBe('social-story');
    expect(ids).toContain('video-reels');
  });

  test('1920 finds every size with that number', () => {
    const ids = searchPresets('1920').map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['social-story', 'social-fb-event', 'video-reels', 'video-landscape'])
    );
    expect(ids).not.toContain('app-desktop');
  });

  test('every word has to match; diacritics and case do not matter', () => {
    expect(searchPresets('social 4:5').map((p) => p.id)).toEqual(['social-post-4-5']);
    expect(searchPresets('VISITKA').map((p) => p.id)).toEqual(['print-business-card']);
    expect(searchPresets('')).toEqual([]);
    expect(searchPresets('zzzz')).toEqual([]);
    expect(searchPresets(undefined)).toEqual([]);
  });
});

describe('Recent', () => {
  test('keeps ids that still name a preset, newest first, at most three', () => {
    const got = recentPresets([
      'social-fb-event',
      'gone',
      'social-post-4-5',
      'print-a6',
      'app-desktop',
    ]);
    expect(got.map((p) => p.id)).toEqual(['social-fb-event', 'social-post-4-5', 'print-a6']);
    expect(got).toHaveLength(RECENT_MAX);
    expect(recentPresets('nope')).toEqual([]);
  });

  test('a pick moves to the front once', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(pushRecent(undefined, 'x')).toEqual(['x']);
    expect(
      pushRecent(
        Array.from({ length: 12 }, (_, i) => `p${i}`),
        'new'
      )
    ).toHaveLength(8);
  });
});

describe('what a pick writes', () => {
  test('digital is fixed; web hugs; print carries its paper; video has a rate', () => {
    expect(specOf(presetById('app-desktop') as never)).toMatchObject({
      kind: 'digital',
      fixed: true,
      width: 1440,
      height: 1024,
    });
    expect(specOf(presetById('web-tablet') as never)).toMatchObject({
      kind: 'web',
      fixed: false,
      width: 834,
    });
    expect(specOf(presetById('print-a4') as never).print).toEqual({
      paper: 'a4',
      orientation: 'portrait',
    });
    expect(specOf(presetById('video-landscape') as never)).toMatchObject({
      kind: 'video',
      fps: 30,
      width: 1920,
      height: 1080,
    });
  });

  test('a custom size is sizeMm on the nearest larger paper, never paper "custom"', () => {
    const r = customSpec({ widthMm: 99, heightMm: 210, bleedMm: 3 });
    if (!r.ok) throw new Error(r.message);
    expect(r.spec.kind).toBe('print');
    expect(readSizeMm(r.spec.print)).toEqual([99, 210]);
    expect(r.spec.print).toMatchObject({ paper: 'dl', bleedMm: 3 });
    expect(r.spec.print?.paper).not.toBe('custom');
    // trim 99 × 210 mm + 3 mm bleed each side, at 96 px/in
    expect([r.spec.width, r.spec.height]).toEqual([374 + 2 * 11, 794 + 2 * 11]);
    expect(r.spec.label).toBe('99 × 210 mm');
  });

  test('a custom size out of range says why and writes nothing', () => {
    expect(customSpec({ widthMm: 5, heightMm: 100 })).toMatchObject({ ok: false });
    expect(customSpec({ widthMm: 100, heightMm: Number.NaN })).toMatchObject({ ok: false });
    expect(customSpec({ widthMm: 100, heightMm: 100, bleedMm: -1 })).toMatchObject({ ok: false });
  });
});

describe('Edit › Advanced ▸ New artboard agrees with the catalogue', () => {
  const toPreset = (key: string): string => (key.startsWith('print-') ? key : `app-${key}`);

  test('every v1 row names a preset with the size the v1 shell inserts', () => {
    for (const key of Object.values(ARTBOARD_PRESET)) {
      const p = presetById(toPreset(key));
      expect(p).not.toBeNull();
      if (key.startsWith('print-')) {
        const r = resolvePrintArtboard({ paper: key.slice('print-'.length) });
        expect([p?.widthPx, p?.heightPx]).toEqual([r.widthPx, r.heightPx]);
      } else {
        const v1 = (
          SCREEN_PRESETS as Record<string, { label: string; width: number; height: number }>
        )[key];
        expect([p?.name, p?.widthPx, p?.heightPx]).toEqual([v1?.label, v1?.width, v1?.height]);
      }
    }
  });
});
