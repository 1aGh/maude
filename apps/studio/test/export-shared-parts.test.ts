// S8.3 — Folder / Whole project leave out the canvases that hold shared parts (no artboards), BY NAME
// (09 Export ex-batch: "_broadcast, _social and _video hold shared parts, not artboards — left out").
// The estimate carries them in `skipped` with reason 'shared-part'; they are never an export unit.

import { describe, expect, test } from 'bun:test';

import { estimateSpec } from '../exporters/estimate.ts';
import { resolveSpecV2, type SpecCanvas } from '../exporters/scope.ts';
import { validateSpecV2 } from '../exporters/spec-v2.ts';

const AB = (id: string, kind = 'digital') => ({ id, label: id, kind, w: 1080, h: 1350 });
const CANVASES: SpecCanvas[] = [
  { rel: 'social/matchday.tsx', artboards: [AB('post'), AB('story')] },
  { rel: 'social/_broadcast/lower-third.tsx', artboards: [] },
  { rel: 'social/_social.tsx', artboards: [] },
  { rel: 'social/video-hype.tsx', artboards: [AB('reel', 'video')] },
  { rel: 'other/x.tsx', artboards: [AB('x1')] },
];
const ctx = { designRel: '.design', canvases: CANVASES, activeCanvas: 'social/matchday.tsx' };
const run = (raw: unknown, canvases = CANVASES) => {
  const v = validateSpecV2(raw);
  if (!v.ok) throw new Error(JSON.stringify(v.error));
  const r = resolveSpecV2(v.spec, { ...ctx, canvases });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { spec: v.spec, r };
};

describe('shared parts are left out by name', () => {
  test('Folder: the artboard-less canvases are skipped, named, and never a unit', () => {
    const { r } = run({ v: 2, scope: 'folder', folder: 'social', format: 'png' });
    expect(r.skipped.filter((s) => s.reason === 'shared-part').map((s) => s.name)).toEqual([
      '_broadcast',
      '_social',
    ]);
    expect(r.canvases).toEqual(['social/matchday.tsx', 'social/video-hype.tsx']);
    expect(r.units.every((u) => u.artboards.length > 0)).toBe(true);
  });

  test('Whole project: the same rule, and the estimate counts only artboards', () => {
    const { spec, r } = run({ v: 2, scope: 'project', format: 'png' });
    expect(r.skipped.map((s) => [s.name, s.reason])).toEqual([
      ['_broadcast', 'shared-part'],
      ['_social', 'shared-part'],
    ]);
    const est = estimateSpec(spec, r, {
      canvases: CANVASES,
      canvas: 'social/matchday.tsx',
      canvasOnly: false,
      history: [],
      renderLane: 'local',
    });
    expect(est.counts.project).toBe(4);
    expect(est.skipped.map((s) => s.name)).toEqual(['_broadcast', '_social']);
  });

  test('a canvas named on its own is still asked for as asked (only the expansion skips)', () => {
    const { r } = run({ v: 2, scope: 'canvas', canvas: 'social/_social.tsx', format: 'png' });
    expect(r.skipped.filter((s) => s.reason === 'shared-part')).toEqual([]);
  });

  test('a name is listed once however many canvases sit under it', () => {
    const more: SpecCanvas[] = [...CANVASES, { rel: 'social/_broadcast/bug.tsx', artboards: [] }];
    const { r } = run({ v: 2, scope: 'project', format: 'png' }, more);
    expect(r.skipped.filter((s) => s.name === '_broadcast')).toHaveLength(1);
  });
});
