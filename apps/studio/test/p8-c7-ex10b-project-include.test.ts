// P8 c7 (09 ex-huge) — the Include row on Whole project: leave a top-level folder, or the loose canvases, out.
// The spec carries `exclude: { folders?: string[], loose?: boolean }` (project scope only); the server resolves it
// over the canvases the session SEES and the estimate names the folders / loose canvases to tick.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { estimateSpec } from '../exporters/estimate.ts';
import { resolveScope, resolveSpecV2, type SpecCanvas } from '../exporters/scope.ts';
import { validateSpecV2 } from '../exporters/spec-v2.ts';

const AB = (id: string) => ({ id, label: id, kind: 'digital', w: 1080, h: 1350 });
const CANVASES: SpecCanvas[] = [
  { rel: 'social/matchday.tsx', artboards: [AB('post')] },
  { rel: 'social/2026/combine.tsx', artboards: [AB('c1'), AB('c2')] },
  { rel: 'print/flyer.tsx', artboards: [AB('f1')] },
  { rel: 'test.tsx', artboards: [AB('t1')] },
  { rel: 'ahoj.tsx', artboards: [AB('a1')] },
];
const ctx = { designRel: '.design', canvases: CANVASES, activeCanvas: 'test.tsx' };
const bad = (raw: unknown) => {
  const v = validateSpecV2(raw);
  return v.ok ? null : v.error.field;
};
const resolve = (raw: unknown) => {
  const v = validateSpecV2(raw);
  if (!v.ok) throw new Error(JSON.stringify(v.error));
  const r = resolveSpecV2(v.spec, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { spec: v.spec, r };
};
const base = { v: 2, scope: 'project', format: 'png' };

describe('exclude — validated like every other path in the spec', () => {
  test('only the Whole project scope takes it', () => {
    expect(bad({ ...base, scope: 'canvas', canvas: 'test.tsx', exclude: { loose: true } })).toBe(
      'exclude'
    );
    expect(bad({ ...base, scope: 'folder', folder: 'social', exclude: { loose: true } })).toBe(
      'exclude'
    );
    expect(bad({ ...base, exclude: { loose: true } })).toBeNull();
  });
  test('a folder stays inside the design root and out of runtime state', () => {
    expect(bad({ ...base, exclude: { folders: ['../x'] } })).toBe('exclude.folders[0]');
    expect(bad({ ...base, exclude: { folders: ['/etc'] } })).toBe('exclude.folders[0]');
    expect(bad({ ...base, exclude: { folders: ['_history'] } })).toBe('exclude.folders[0]');
    expect(bad({ ...base, exclude: { folders: ['a\\b'] } })).toBe('exclude.folders[0]');
    expect(bad({ ...base, exclude: { folders: 'social' } })).toBe('exclude.folders');
    expect(bad({ ...base, exclude: { nope: 1 } })).toBe('exclude.nope');
    expect(bad({ ...base, exclude: { loose: 'yes' } })).toBe('exclude.loose');
    expect(
      bad({ ...base, exclude: { folders: Array.from({ length: 65 }, (_, i) => `f${i}`) } })
    ).toBe('exclude.folders');
  });
});

describe('exclude — resolved over the canvases the session sees', () => {
  test('without it, nothing moves', () => {
    expect(resolve(base).r.canvases).toHaveLength(5);
  });
  test('a folder (and what sits under it) is left out; a prefix is not a folder', () => {
    const { r } = resolve({ ...base, exclude: { folders: ['social'] } });
    expect(r.canvases).toEqual(['print/flyer.tsx', 'test.tsx', 'ahoj.tsx']);
    const nested = resolve({ ...base, exclude: { folders: ['social/2026'] } });
    expect(nested.r.canvases).toContain('social/matchday.tsx');
    expect(nested.r.canvases).not.toContain('social/2026/combine.tsx');
    const prefixOnly = resolve({ ...base, exclude: { folders: ['soc'] } });
    expect(prefixOnly.r.canvases).toHaveLength(5);
  });
  test('loose leaves out the canvases at the top level', () => {
    const { r } = resolve({ ...base, exclude: { loose: true } });
    expect(r.canvases).toEqual([
      'social/matchday.tsx',
      'social/2026/combine.tsx',
      'print/flyer.tsx',
    ]);
  });
  test('the ZIP honours it too', () => {
    const { r } = resolve({
      ...base,
      format: 'zip',
      exclude: { folders: ['social'], loose: true },
    });
    expect(r.canvases).toEqual(['print/flyer.tsx']);
  });
});

describe('the estimate names what Include can tick', () => {
  test('folder names and the loose canvases, files follow the exclusion', () => {
    const facts = {
      canvases: CANVASES,
      canvas: 'test.tsx',
      canvasOnly: false,
      history: [],
      renderLane: 'local' as const,
    };
    const all = resolve(base);
    const e1 = estimateSpec(all.spec, all.r, facts);
    expect(e1.canvasCounts.folderNames).toEqual(['social', 'print']);
    expect(e1.canvasCounts.looseNames).toEqual(['test', 'ahoj']);
    const cut = resolve({ ...base, exclude: { folders: ['social'] } });
    const e2 = estimateSpec(cut.spec, cut.r, facts);
    expect(e2.files).toBe(e1.files - 3);
    expect(e2.canvasCounts.folderNames).toEqual(['social', 'print']);
  });
});

describe('the project ZIP walk honours the same hint', () => {
  test('a folder and the loose canvases (all their files) stay out of the pack', async () => {
    const root = mkdtempSync(join(tmpdir(), 'c7-incl-'));
    try {
      const design = join(root, '.design');
      mkdirSync(join(design, 'social'), { recursive: true });
      mkdirSync(join(design, 'print'), { recursive: true });
      writeFileSync(join(design, 'social', 'a.tsx'), 'a');
      writeFileSync(join(design, 'print', 'b.tsx'), 'b');
      writeFileSync(join(design, 'test.tsx'), 't');
      writeFileSync(join(design, 'test.meta.json'), '{}');
      writeFileSync(join(design, 'config.json'), '{}');
      const walk = async (exclude?: unknown) => {
        const t = await resolveScope({
          scope: 'project-raw',
          activeJson: { active: null, selected: null },
          designRoot: design,
          options: exclude ? { exclude } : {},
        });
        return t[0] && 'paths' in t[0] ? [...(t[0].paths as string[])].sort() : [];
      };
      expect(await walk()).toEqual(
        ['config.json', 'print/b.tsx', 'social/a.tsx', 'test.meta.json', 'test.tsx'].sort()
      );
      expect(await walk({ folders: ['social'], loose: false })).not.toContain('social/a.tsx');
      const cut = await walk({ folders: ['social'], loose: true });
      expect(cut).toEqual(['config.json', 'print/b.tsx']);
      // a hint that climbs out is dropped, not followed
      expect(await walk({ folders: ['../x'], loose: false })).toHaveLength(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
