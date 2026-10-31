// rc.1 finding 9, option A (decision `v2-michal-ds-specimens-own-artboards`, superseding the fold-only
// shape of `v2-S10-deterministic-conversion-map`): converting a system folder keeps EVERY original
// specimen page on the Design system canvas as its own `ds-own-<slug>` artboard, one row under the
// section it belongs to; the seven generated sections stay. Michal: the converted maude canvas showed
// none of the original specimens (36 of 38 pages were folded away).
//
//   1. every page of this repo's two systems is an artboard (source + meta), in section rows;
//   2. deterministic: a second conversion of the same folder writes the same bytes, ids never move;
//   3. the board's frame loads every page it draws (C4 closure — one unit, nothing widened);
//   4. guard: the COMMITTED canvases of this repo keep every page, so no change can drop them again.
import { afterAll, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closureFor, type ProjectReader } from '../access/closure.ts';
import { resolveAccess } from '../access/scope.ts';
import {
  designSystemCanvasMeta,
  designSystemCanvasSource,
  OWN_ARTBOARD,
} from '../ds/board/template.ts';
import { patternSrcs } from '../ds/board/section-patterns.tsx';
import { SECTIONS } from '../ds/board/types.ts';
import { createDsConvert } from '../ds/convert.ts';
import { isSpecimenFile, mapSpecimens, SECTION_ORDER, sectionOf } from '../ds/convert-map.ts';
import { createDsEngine } from '../ds/engine.ts';

const REPO_DESIGN = path.resolve(import.meta.dir, '../../../.design');
const SYSTEMS = ['maude', 'maude-v2'] as const;
const PERSON = { kind: 'person', name: 'Tereza' } as const;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const pagesOf = (ds: string) =>
  readdirSync(path.join(REPO_DESIGN, 'system', ds, 'preview'))
    .filter(isSpecimenFile)
    .sort();
const specimenSrcs = (src: string) =>
  [...src.matchAll(/<Specimen src="([^"]+)" \/>/g)].map((m) => m[1] as string);
const artboardIds = (src: string) =>
  [...src.matchAll(/<DCArtboard id="([^"]+)"/g)].map((m) => m[1] as string);

describe('every specimen page is its own artboard', () => {
  for (const ds of SYSTEMS)
    test(`${ds}: all ${pagesOf(ds).length} pages are ds-own artboards, after the seven sections`, () => {
      const pages = pagesOf(ds);
      expect(pages.length).toBeGreaterThanOrEqual(38);
      const m = mapSpecimens(readdirSync(path.join(REPO_DESIGN, 'system', ds, 'preview')));
      const src = designSystemCanvasSource(ds, ds, m.pages);
      const meta = designSystemCanvasMeta(ds, m.pages) as {
        layout: { artboards: { id: string; x: number; y: number; w: number; h: number }[] };
      };
      // every page, once
      expect(specimenSrcs(src).sort()).toEqual(pages.map((f) => `preview/${f}`));
      const ids = artboardIds(src);
      expect(ids.slice(0, 7)).toEqual(SECTIONS.map((s) => s.id));
      expect(ids.length).toBe(7 + pages.length);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids.slice(7)) expect(id).toMatch(/^ds-own-[a-z0-9-]+$/);
      // the meta places every artboard the source draws
      expect(meta.layout.artboards.map((a) => a.id)).toEqual(ids);
      // the showcase ids the S10 conversion gave never move (V2-2.19)
      expect(ids).toContain('ds-own-ui-kits-desktop-index');
      expect(ids).toContain('ds-own-ui-kits-desktop-showcase');
      // the generated sections still map the pages (their content is unchanged)
      expect(m.sections.colour).toContain('colors-accent');
      expect(m.own.map((o) => o.slug)).toEqual([
        'ui_kits-desktop-index',
        'ui_kits-desktop-showcase',
      ]);
    });

  test('one row per section, below the section grid, in section order; nothing overlaps', () => {
    const m = mapSpecimens(readdirSync(path.join(REPO_DESIGN, 'system', 'maude', 'preview')));
    const meta = designSystemCanvasMeta('maude', m.pages) as {
      layout: { artboards: { id: string; x: number; y: number; w: number; h: number }[] };
    };
    const at = new Map(meta.layout.artboards.map((a) => [a.id, a]));
    const gridBottom = Math.max(...SECTIONS.map((s) => s.y + s.h));
    const rowY: number[] = [];
    for (const kind of SECTION_ORDER) {
      const row = m.pages.filter((p) => p.section === kind);
      if (!row.length) continue;
      const boxes = row.map((p) => at.get(p.id) as { x: number; y: number; w: number });
      expect(new Set(boxes.map((b) => b.y)).size).toBe(1); // one row
      expect(boxes.map((b) => b.x)).toEqual(
        row.map((_, i) => i * (OWN_ARTBOARD.w + OWN_ARTBOARD.gap))
      );
      rowY.push(boxes[0]?.y as number);
    }
    expect(rowY[0]).toBeGreaterThan(gridBottom);
    expect([...rowY].sort((a, b) => a - b)).toEqual(rowY); // section order, top to bottom
    for (let i = 1; i < rowY.length; i++)
      expect((rowY[i] as number) - (rowY[i - 1] as number)).toBeGreaterThan(OWN_ARTBOARD.h);
    // a page no section claims sits in the Patterns row
    expect(m.pages.find((p) => p.slug === 'ui_kits-desktop-showcase')?.section).toBe('patterns');
    expect(m.pages.find((p) => p.slug === 'logo')?.section).toBe('brand');
  });

  test('an id never depends on the section a page lands in, nor on listing order', () => {
    const files = pagesOf('maude');
    const a = mapSpecimens(files);
    const b = mapSpecimens([...files].reverse().concat(files));
    expect(b.pages).toEqual(a.pages);
    for (const p of a.pages)
      expect(p.id).toBe(`ds-own-${p.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    expect(sectionOf('ui_kits-desktop-showcase')).toBeNull();
  });
});

describe('Patterns still shows only the showcases', () => {
  test('a page that belongs to another section is never a Patterns tile', () => {
    const m = mapSpecimens(pagesOf('maude'));
    expect(patternSrcs(m.pages.map((p) => p.src))).toEqual([
      'preview/ui_kits-desktop-index.tsx',
      'preview/ui_kits-desktop-showcase.tsx',
    ]);
  });
});

/** A throwaway project whose system folder has this repo's maude page names (stub bodies). */
function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-r1-ds-specimens-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  const write = (rel: string, text: string) => {
    const abs = path.join(designRoot, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  write(
    'config.json',
    `${JSON.stringify(
      {
        designSystems: [{ name: 'gator', path: 'system/gator', rootClass: 'gator' }],
        defaultDesignSystem: 'gator',
        canvasGroups: [{ path: 'ui' }, { path: 'system' }],
      },
      null,
      2
    )}\n`
  );
  write('system/gator/colors_and_type.css', ':root {\n  --accent: oklch(0.55 0.15 150);\n}\n');
  write('system/gator/preview/_layout.css', '.x{}\n');
  for (const f of pagesOf('maude'))
    write(`system/gator/preview/${f}`, `export default () => <p>${f}</p>;\n`);
  let clock = Date.parse('2026-10-31T10:00:00Z');
  const engine = createDsEngine({ designRoot, kernel: null, log: { warn() {}, error() {} } });
  const eng = { ...engine, now: () => (clock += 1000) };
  return { designRoot, convert: createDsConvert(eng) };
}

const read = (designRoot: string, rel: string) => readFileSync(path.join(designRoot, rel), 'utf8');

describe('the conversion run', () => {
  test('the written canvas + meta carry every page; the dry run counts them', async () => {
    const p = project();
    const plan = p.convert.plan(['gator']);
    expect(plan.systems[0]?.specimens).toBe(pagesOf('maude').length);
    // maude.ds-convert/1 is frozen (ds-convert-verbs.test.ts): no new key on a row or an own item
    expect(Object.keys(plan.systems[0] ?? {}).sort()).not.toContain('pages');
    for (const o of plan.systems[0]?.own ?? [])
      expect(Object.keys(o).sort()).toEqual(['id', 'label', 'slug', 'src']);
    await p.convert.convert({ systems: ['gator'], by: PERSON });
    const src = read(p.designRoot, 'system/gator/design-system.tsx');
    expect(specimenSrcs(src).sort()).toEqual(pagesOf('maude').map((f) => `preview/${f}`));
    const meta = JSON.parse(read(p.designRoot, 'system/gator/design-system.meta.json'));
    expect(meta.layout.artboards.map((a: { id: string }) => a.id)).toEqual(artboardIds(src));
  });

  test('idempotent: convert → Restore → convert writes the same canvas bytes and ids', async () => {
    const p = project();
    await p.convert.convert({ systems: ['gator'], by: PERSON });
    const first = {
      src: read(p.designRoot, 'system/gator/design-system.tsx'),
      meta: read(p.designRoot, 'system/gator/design-system.meta.json'),
    };
    await p.convert.restore({ ds: 'gator', by: PERSON });
    await p.convert.convert({ systems: ['gator'], by: PERSON });
    expect(read(p.designRoot, 'system/gator/design-system.tsx')).toBe(first.src);
    expect(read(p.designRoot, 'system/gator/design-system.meta.json')).toBe(first.meta);
    // a second convert of a converted system writes nothing (refused, nothing changes)
    await expect(p.convert.convert({ systems: ['gator'], by: PERSON })).rejects.toMatchObject({
      code: 'ds-convert-refused',
    });
    expect(read(p.designRoot, 'system/gator/design-system.tsx')).toBe(first.src);
  });
});

/** This repo's design root as the access closure reads it (files under system/<ds>/ + config). */
function repoReader(ds: string, board: string): ProjectReader {
  const files = new Map<string, string | null>();
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(REPO_DESIGN, rel))) {
      const r = `${rel}/${e}`;
      if (e === 'revisions' || e === 'assets') continue;
      if (statSync(path.join(REPO_DESIGN, r)).isDirectory()) walk(r);
      else files.set(r, null);
    }
  };
  walk(`system/${ds}`);
  files.set('config.json', null);
  files.set(`system/${ds}/design-system.tsx`, board);
  return {
    list: () => [...files.keys()],
    text: (r) => {
      if (!files.has(r)) return null;
      const v = files.get(r);
      if (typeof v === 'string') return v;
      try {
        return readFileSync(path.join(REPO_DESIGN, r), 'utf8');
      } catch {
        return null;
      }
    },
    head: () => 'h1',
  };
}

describe('the board frame loads every page it draws (C4, one unit — not widened)', () => {
  for (const ds of SYSTEMS)
    test(`${ds}: a member granted only the board reads every specimen page and is not blocked`, () => {
      const m = mapSpecimens(readdirSync(path.join(REPO_DESIGN, 'system', ds, 'preview')));
      const board = `system/${ds}/design-system.tsx`;
      const access = resolveAccess({ v: 1, role: null, grants: [{ c: board, r: 'member' }] });
      const c = closureFor(access, repoReader(ds, designSystemCanvasSource(ds, ds, m.pages)));
      expect(c.blocked.has(board)).toBe(false);
      for (const f of pagesOf(ds)) expect(c.read.has(`system/${ds}/preview/${f}`)).toBe(true);
      // its own stylesheet comes with it (colors-accent.tsx imports ./colors-accent.css)
      expect(c.read.has(`system/${ds}/preview/colors-accent.css`)).toBe(true);
      // the other system's pages stay out — the grant is this board's own system only
      const other = ds === 'maude' ? 'maude-v2' : 'maude';
      expect([...c.read].some((r) => r.startsWith(`system/${other}/`))).toBe(false);
    });
});

describe('guard — the committed Design system canvases keep every page', () => {
  for (const ds of SYSTEMS)
    test(`.design/system/${ds}/design-system.tsx draws every preview page as its own artboard`, () => {
      const src = read(REPO_DESIGN, `system/${ds}/design-system.tsx`);
      const meta = JSON.parse(read(REPO_DESIGN, `system/${ds}/design-system.meta.json`));
      expect(specimenSrcs(src).sort()).toEqual(pagesOf(ds).map((f) => `preview/${f}`));
      const placed = new Set(meta.layout.artboards.map((a: { id: string }) => a.id));
      for (const id of artboardIds(src)) expect(placed.has(id)).toBe(true);
      // and it is exactly what the converter writes today (re-running the conversion is a no-op)
      const m = mapSpecimens(readdirSync(path.join(REPO_DESIGN, 'system', ds, 'preview')));
      expect(src).toBe(designSystemCanvasSource(ds, meta.title, m.pages));
    });
});
