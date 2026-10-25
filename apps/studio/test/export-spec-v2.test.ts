// S8.1 — ExportSpec v2 validation (contract S8-export-spec.md §5.1) and its mapping onto the
// engine scopes (§5.2, §5.8). Pure: no server, no browser.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRegionArg } from '../bin/_region.mjs';
import { isScopeValidForFormat, VALID_SCOPES_BY_FORMAT } from '../exporters/format-scopes.ts';
import { FORMATS, getAdapter } from '../exporters/index.ts';
import {
  annotationsExportPolicy,
  resolveScope,
  resolveSpecV2,
  type SpecCanvas,
} from '../exporters/scope.ts';
import { type ExportSpecV2, isV2Body, validateSpecV2 } from '../exporters/spec-v2.ts';

const ok = (raw: unknown): ExportSpecV2 => {
  const v = validateSpecV2(raw);
  if (!v.ok) throw new Error(`expected valid: ${JSON.stringify(v.error)}`);
  return v.spec;
};
const field = (raw: unknown): string => {
  const v = validateSpecV2(raw);
  if (v.ok) throw new Error('expected a refusal');
  expect(v.error.error).toBe('bad-spec');
  return v.error.field;
};

describe('validateSpecV2', () => {
  test('a minimal spec passes; v1 bodies are not v2', () => {
    expect(ok({ v: 2, scope: 'canvas', format: 'jpg' })).toEqual({
      v: 2,
      scope: 'canvas',
      format: 'jpg',
    });
    expect(isV2Body({ v: 2, spec: {} })).toBe(true);
    expect(isV2Body({ format: 'png', scope: 'artboard', options: {} })).toBe(false);
  });

  test('unknown keys are refused by name, at every depth', () => {
    expect(field({ v: 2, scope: 'canvas', format: 'png', extra: 1 })).toBe('extra');
    expect(field({ v: 2, scope: 'canvas', format: 'png', options: { dpiX: 1 } })).toBe(
      'options.dpiX'
    );
    expect(
      field({
        v: 2,
        scope: 'canvas',
        format: 'png',
        region: { rect: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
      })
    ).toBe('region.rect.z');
  });

  test('numbers out of range name their field', () => {
    const base = { v: 2, scope: 'canvas', format: 'png' };
    expect(field({ ...base, options: { size: { scale: 5 } } })).toBe('options.size.scale');
    expect(field({ ...base, options: { size: { scale: 0.1 } } })).toBe('options.size.scale');
    expect(field({ ...base, options: { size: { dpi: 601 } } })).toBe('options.size.dpi');
    expect(field({ ...base, options: { jpgQuality: 0 } })).toBe('options.jpgQuality');
    expect(field({ ...base, region: { rect: { x: 0, y: 0, w: 0, h: 10 } } })).toBe('region.rect.w');
    expect(field({ ...base, region: { rect: { x: 0, y: 0, w: 40000, h: 10 } } })).toBe(
      'region.rect.w'
    );
    expect(field({ ...base, region: { rect: { x: Number.NaN, y: 0, w: 1, h: 1 } } })).toBe(
      'region.rect.x'
    );
  });

  test('paths: no escape, no runtime state, folder needs the Folder scope', () => {
    expect(field({ v: 2, scope: 'canvas', format: 'png', canvas: '../x.tsx' })).toBe('canvas');
    expect(field({ v: 2, scope: 'canvas', format: 'png', canvas: '/etc/a.tsx' })).toBe('canvas');
    expect(field({ v: 2, scope: 'canvas', format: 'png', canvas: 'ui\\a.tsx' })).toBe('canvas');
    expect(field({ v: 2, scope: 'canvas', format: 'png', canvas: '_chat/a.tsx' })).toBe('canvas');
    expect(field({ v: 2, scope: 'canvas', format: 'png', canvas: 'ui/a.json' })).toBe('canvas');
    expect(field({ v: 2, scope: 'folder', format: 'png', folder: 'ui/../..' })).toBe('folder');
    expect(field({ v: 2, scope: 'folder', format: 'png', folder: '_history' })).toBe('folder');
    expect(field({ v: 2, scope: 'folder', format: 'png' })).toBe('folder');
    expect(field({ v: 2, scope: 'project', format: 'png', folder: 'ui' })).toBe('folder');
    expect(field({ v: 2, scope: 'project', format: 'png', canvas: 'ui/a.tsx' })).toBe('canvas');
    expect(
      field({ v: 2, scope: 'project', format: 'png', region: { rect: { x: 0, y: 0, w: 1, h: 1 } } })
    ).toBe('region');
    expect(ok({ v: 2, scope: 'folder', format: 'zip', folder: 'ui/2026/' }).folder).toBe('ui/2026');
  });

  test('at.sha is a commit id; selection ids are bounded', () => {
    expect(field({ v: 2, scope: 'canvas', format: 'png', at: { sha: 'HEAD~1' } })).toBe('at.sha');
    expect(ok({ v: 2, scope: 'canvas', format: 'png', at: { sha: 'abc1234' } }).at).toEqual({
      sha: 'abc1234',
    });
    const many = Array.from({ length: 257 }, (_, i) => `a${i}`);
    expect(field({ v: 2, scope: 'selection', format: 'png', selection: { artboards: many } })).toBe(
      'selection.artboards'
    );
    expect(
      field({ v: 2, scope: 'selection', format: 'png', selection: { elements: ['"]{x'] } })
    ).toBe('selection.elements[0]');
  });
});

describe('format × scope coherence', () => {
  test('jpg has png’s row and a real adapter; audio is an engine format since S8.6', () => {
    expect(VALID_SCOPES_BY_FORMAT.jpg).toEqual(VALID_SCOPES_BY_FORMAT.png);
    expect(FORMATS).toContain('jpg');
    expect(getAdapter('jpg')).not.toBeNull();
    expect(isScopeValidForFormat('jpg', 'project-raw')).toBe(false);
    expect(FORMATS).toContain('audio');
    expect(VALID_SCOPES_BY_FORMAT.audio).toEqual(['artboard']);
  });

  test('parseRegionArg takes a world rect', () => {
    expect(parseRegionArg('{"rect":{"x":-10,"y":20,"w":300,"h":200}}')).toEqual({
      kind: 'rect',
      rect: { x: -10, y: 20, w: 300, h: 200 },
    });
    expect(() => parseRegionArg('{"rect":{"x":0,"y":0,"w":0,"h":1}}')).toThrow();
  });
});

const AB = (id: string, kind: string | null = 'digital', w = 1080, h = 1350) => ({
  id,
  label: id.toUpperCase(),
  kind,
  w,
  h,
});
const CANVASES: SpecCanvas[] = [
  { rel: 'ui/a.tsx', artboards: [AB('hero'), AB('story', 'digital', 1080, 1920)] },
  {
    rel: 'ui/b.tsx',
    artboards: [AB('poster', 'print', 559, 794), AB('reel', 'video', 1080, 1920)],
  },
  { rel: 'ui/sub/c.tsx', artboards: [AB('one')] },
  { rel: 'other/d.tsx', artboards: [AB('d1')] },
];
const ctx = (canvases = CANVASES) => ({ designRel: '.design', canvases, activeCanvas: 'ui/a.tsx' });
const resolve = (raw: unknown, canvases = CANVASES) => {
  const r = resolveSpecV2(ok(raw), ctx(canvases));
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
};

describe('resolveSpecV2 — the §5.2 mapping', () => {
  test('selection artboards, each → one `artboard` unit per artboard', () => {
    const r = resolve({
      v: 2,
      scope: 'selection',
      format: 'png',
      selection: { artboards: ['hero', 'story'] },
    });
    expect(r.units.map((u) => [u.scope, u.options.artboardId, u.options.canvasFile])).toEqual([
      ['artboard', 'hero', '.design/ui/a.tsx'],
      ['artboard', 'story', '.design/ui/a.tsx'],
    ]);
  });

  test('selection elements → `selection` by data-cd-id; + one → `selection-bounds`', () => {
    const each = resolve({
      v: 2,
      scope: 'selection',
      format: 'svg',
      selection: { elements: ['e1'] },
    });
    expect(each.units[0]?.scope).toBe('selection');
    expect(each.units[0]?.options.selection).toEqual({
      selector: '[data-cd-id="e1"]',
      file: '.design/ui/a.tsx',
    });
    const one = resolve({
      v: 2,
      scope: 'selection',
      format: 'png',
      unit: 'one',
      selection: { elements: ['e1', 'e2'], artboards: ['hero'] },
    });
    expect(one.units).toHaveLength(1);
    expect(one.units[0]?.scope).toBe('selection-bounds');
    expect(one.units[0]?.options.selectionAll).toEqual([
      '[data-dc-screen="hero"]',
      '[data-cd-id="e1"]',
      '[data-cd-id="e2"]',
    ]);
  });

  test('a region is a world rect on `selection-bounds` / `canvas-whole`', () => {
    const rect = { x: 10, y: -20, w: 400, h: 300 };
    const sel = resolve({ v: 2, scope: 'selection', format: 'jpg', region: { rect } });
    expect([sel.units[0]?.scope, sel.units[0]?.options.regionRect]).toEqual([
      'selection-bounds',
      rect,
    ]);
    const cv = resolve({ v: 2, scope: 'canvas', format: 'pdf', region: { rect } });
    expect([cv.units[0]?.scope, cv.units[0]?.options.regionRect]).toEqual(['canvas-whole', rect]);
    // an incoherent format for a region is skipped with a reason, never silently
    const svg = resolve({ v: 2, scope: 'canvas', format: 'svg', region: { rect } });
    expect(svg.units).toHaveLength(0);
    expect(svg.skipped[0]?.reason).toBe('format-unit');
  });

  test('canvas each → `canvas-as-separate`; one → `canvas-whole`', () => {
    const each = resolve({ v: 2, scope: 'canvas', format: 'png' });
    expect(each.units.map((u) => [u.scope, u.artboards.length])).toEqual([
      ['canvas-as-separate', 2],
    ]);
    const one = resolve({ v: 2, scope: 'canvas', format: 'png', unit: 'one' });
    expect(one.units[0]?.scope).toBe('canvas-whole');
  });

  test('byKind splits a canvas per artboard; temporal formats take only video artboards', () => {
    const r = resolve({
      v: 2,
      scope: 'canvas',
      canvas: 'ui/b.tsx',
      format: 'pdf',
      byKind: { video: { format: 'mp4' } },
    });
    expect(r.units.map((u) => [u.format, u.scope, u.options.artboardId])).toEqual([
      ['pdf', 'artboard', 'poster'],
      ['mp4', 'artboard', 'reel'],
    ]);
    const gif = resolve({ v: 2, scope: 'canvas', canvas: 'ui/b.tsx', format: 'gif' });
    expect(gif.units.map((u) => u.options.artboardId)).toEqual(['reel']);
    expect(gif.skipped).toEqual([{ name: 'POSTER', reason: 'format-unit' }]);
  });

  test('folder expands the visible subtree; project every visible canvas; zip → project-raw', () => {
    const f = resolve({ v: 2, scope: 'folder', folder: 'ui', format: 'png' });
    expect(f.canvases).toEqual(['ui/a.tsx', 'ui/b.tsx', 'ui/sub/c.tsx']);
    const hidden = resolve({ v: 2, scope: 'project', format: 'png' }, CANVASES.slice(0, 1));
    expect(hidden.canvases).toEqual(['ui/a.tsx']);
    const z = resolve({ v: 2, scope: 'folder', folder: 'ui/sub', format: 'zip' });
    expect(z.units.map((u) => [u.format, u.scope, u.options.folder])).toEqual([
      ['zip', 'project-raw', 'ui/sub'],
    ]);
    expect(
      resolve({ v: 2, scope: 'project', format: 'zip' }).units[0]?.options.folder
    ).toBeUndefined();
  });

  test('a canvas outside the visible set answers like a missing one', () => {
    const r = resolveSpecV2(
      ok({ v: 2, scope: 'canvas', canvas: 'other/d.tsx', format: 'png' }),
      ctx(CANVASES.slice(0, 2))
    );
    expect(r).toEqual({ ok: false, reason: 'not-in-scope' });
    const missing = resolveSpecV2(
      ok({ v: 2, scope: 'canvas', canvas: 'ui/nope.tsx', format: 'png' }),
      ctx()
    );
    expect(missing).toEqual(r);
  });

  test('annotations: print PDF, video, zip and decks never carry them (degradation line)', () => {
    expect(annotationsExportPolicy('pdf', { kind: 'print' })).toBe('never');
    expect(annotationsExportPolicy('mp4')).toBe('never');
    expect(annotationsExportPolicy('png')).toBe('optional');
    const r = resolve({
      v: 2,
      scope: 'selection',
      canvas: 'ui/b.tsx',
      format: 'pdf',
      selection: { artboards: ['poster'] },
      options: { annotations: true },
    });
    expect(r.units[0]?.options.includeAnnotations).toBeUndefined();
    expect(r.units[0]?.degraded).toEqual(['annotations-print']);
    const png = resolve({ v: 2, scope: 'canvas', format: 'png', options: { annotations: true } });
    expect(png.units[0]?.options.includeAnnotations).toBe(true);
  });

  test('v2 sizes and JPG quality reach the engine option bag', () => {
    const r = resolve({
      v: 2,
      scope: 'canvas',
      format: 'jpg',
      options: { size: { scale: 0.5 }, jpgQuality: 70 },
    });
    expect(r.units[0]?.options).toMatchObject({ scaleExact: 0.5, quality: 70 });
  });

  test('P8 c7 ex-advanced: GIF colours is a spec field in 2..256 and reaches the engine as gifColors', () => {
    const base = { v: 2, scope: 'canvas', format: 'gif' };
    expect(field({ ...base, options: { video: { gifColors: 1 } } })).toBe('options.video.gifColors');
    expect(field({ ...base, options: { video: { gifColors: 300 } } })).toBe('options.video.gifColors');
    const r = resolve({ ...base, canvas: 'ui/b.tsx', options: { video: { gifColors: 64 } } });
    expect(r.units[0]?.options).toMatchObject({ gifColors: 64 });
  });
});

describe('resolveScope — the engine half', () => {
  test('a regionRect hint becomes a {rect} region', async () => {
    const t = await resolveScope({
      scope: 'canvas-whole',
      activeJson: { active: '.design/ui/a.tsx', selected: null },
      designRoot: '/x/.design',
      options: { regionRect: { x: 1, y: 2, w: 3, h: 4 } },
    });
    expect(t[0]).toMatchObject({ kind: 'element', region: { rect: { x: 1, y: 2, w: 3, h: 4 } } });
  });

  test('project-raw with a folder packs only that subtree, never through a symlink out', async () => {
    const root = mkdtempSync(join(tmpdir(), 's81-raw-'));
    try {
      const design = join(root, '.design');
      mkdirSync(join(design, 'ui', 'sub'), { recursive: true });
      mkdirSync(join(root, 'outside'), { recursive: true });
      writeFileSync(join(design, 'ui', 'a.tsx'), 'a');
      writeFileSync(join(design, 'ui', 'sub', 'b.tsx'), 'b');
      writeFileSync(join(design, 'top.tsx'), 't');
      writeFileSync(join(root, 'outside', 'secret.txt'), 's');
      symlinkSync(join(root, 'outside'), join(design, 'link'));
      const sub = await resolveScope({
        scope: 'project-raw',
        activeJson: { active: null, selected: null },
        designRoot: design,
        options: { folder: 'ui' },
      });
      expect(sub).toEqual([{ kind: 'file-tree', paths: ['ui/a.tsx', 'ui/sub/b.tsx'] }]);
      const escaped = await resolveScope({
        scope: 'project-raw',
        activeJson: { active: null, selected: null },
        designRoot: design,
        options: { folder: 'link' },
      });
      expect(escaped).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
