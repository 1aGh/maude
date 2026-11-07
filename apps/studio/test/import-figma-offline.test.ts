// #155 — the offline `--fig` importer: fidelity and robustness fixes.
//
// Every fixture here is a hand-built node tree or byte buffer. No real org file
// is in the repo and none is needed: each test names the one property of the
// file that used to break the import.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs verb, no declaration file
import {
  buildClusterSvg,
  decodeLocalFig,
  importBoard,
  importFrames,
  instanceLines,
  nodeErrorLines,
  resolveArchiveAssetsMany,
  selectFramePages,
  selectFrames,
} from '../bin/_import-figma.mjs';
import { ImportReport } from '../figma/sanitize.ts';
import { normalizeDocument } from '../figma/types.ts';

const KEY = 'figTESTKEY0123456789';
const REF = 'aabbccddeeff00112233445566778899aabbccdd';
// A real 1x1 PNG, so the ingest sniff accepts it.
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
);

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const solid = [{ type: 'SOLID', visible: true, color: { r: 0.2, g: 0.2, b: 0.8, a: 1 } }];

function doc(surface: 'design' | 'board', pageChildren: unknown[]) {
  return normalizeDocument(
    {
      id: '0:0',
      name: 'Doc',
      type: 'DOCUMENT',
      children: [{ id: '0:1', name: 'Page', type: 'CANVAS', children: pageChildren }],
    },
    { fileKey: KEY, surface, origin: 'fig' }
  );
}

function localOf(document: ReturnType<typeof doc>, files: Record<string, Uint8Array> = {}) {
  return {
    document,
    vectors: new Map(),
    zip: { get: (name: string) => files[name] },
    fileKey: KEY,
    surface: document.surface,
    report: {
      containerVersion: 106,
      schemaSha256: 'c22712ff',
      unmappedTypes: [],
      lossyFields: [],
      internalNodesSkipped: 0,
      nodeErrors: [],
      nodeErrorCount: 0,
    },
  };
}

let sandbox: string;
let realFetch: typeof fetch;
let fetchCalls: number;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'maude-figma-offline-'));
  mkdirSync(join(sandbox, '.design'), { recursive: true });
  realFetch = globalThis.fetch;
  fetchCalls = 0;
  // The offline door has no network. Any request is the bug.
  globalThis.fetch = mock(async () => {
    fetchCalls++;
    throw new Error('network is off in the offline door');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('#155 §1 — an offline board resolves its images from the archive', () => {
  const boardWithPicture = () =>
    doc('board', [
      {
        id: '1:1',
        name: 'Photo',
        type: 'RECTANGLE',
        absoluteBoundingBox: box(0, 0, 200, 100),
        fills: [{ type: 'IMAGE', visible: true, imageRef: REF }],
      },
    ]);

  test('the picture is promoted from images/<ref>, with no REST call', async () => {
    const local = localOf(boardWithPicture(), { [`images/${REF}`]: PNG });
    const r = await importBoard({ root: sandbox, slug: 'jam', local });
    expect(fetchCalls).toBe(0);
    expect(
      r.report.entries.some((e: { disposition: string }) => e.disposition === 'asset-skipped')
    ).toBe(false);
    const assets = join(sandbox, '.design', 'assets');
    expect(existsSync(assets)).toBe(true);
    expect(readdirSync(assets).some((f) => f.endsWith('.png'))).toBe(true);
  });

  test('a picture missing from the archive is reported, not fetched', async () => {
    const local = localOf(boardWithPicture(), {});
    const r = await importBoard({ root: sandbox, slug: 'jam', local });
    expect(fetchCalls).toBe(0);
    expect(
      r.report.entries.some((e: { disposition: string }) => e.disposition === 'asset-skipped')
    ).toBe(true);
  });
});

describe('#155 §3 / §8 — frames inside SECTIONs and GROUPs are found', () => {
  const frame = (id: string, extra: object = {}) => ({
    id,
    name: `Frame ${id}`,
    type: 'FRAME',
    absoluteBoundingBox: box(0, 0, 100, 100),
    fills: solid,
    ...extra,
  });
  const wrapper = (type: 'SECTION' | 'GROUP', id: string, children: unknown[], extra = {}) => ({
    id,
    name: `${type} ${id}`,
    type,
    absoluteBoundingBox: box(0, 0, 500, 500),
    children,
    ...extra,
  });
  const ids = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id);

  test('top-level frames still win, unchanged', () => {
    const d = doc('design', [frame('2:1'), frame('2:2')]);
    expect(ids(selectFrames(d, null))).toEqual(['2:1', '2:2']);
  });

  test('frames inside a SECTION are selected', () => {
    const d = doc('design', [wrapper('SECTION', '3:1', [frame('3:2'), frame('3:3')])]);
    expect(ids(selectFrames(d, null))).toEqual(['3:2', '3:3']);
  });

  test('frames inside a GROUP inside a SECTION are selected, in document order', () => {
    const d = doc('design', [
      frame('4:0'),
      wrapper('SECTION', '4:1', [wrapper('GROUP', '4:2', [frame('4:3')]), frame('4:4')]),
    ]);
    expect(ids(selectFrames(d, null))).toEqual(['4:0', '4:3', '4:4']);
  });

  test('a hidden SECTION hides the frames inside it', () => {
    const d = doc('design', [
      wrapper('SECTION', '5:1', [frame('5:2')], { visible: false }),
      frame('5:3'),
    ]);
    expect(ids(selectFrames(d, null))).toEqual(['5:3']);
  });

  test('a file with only top-level GROUPs falls back to those groups', () => {
    const rect = {
      id: '6:9',
      name: 'r',
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 10, 10),
      fills: solid,
    };
    const d = doc('design', [
      wrapper('GROUP', '6:1', [rect]),
      wrapper('GROUP', '6:2', [rect], { visible: false }),
    ]);
    expect(ids(selectFrames(d, null))).toEqual(['6:1']);
  });

  test('importFrames no longer rejects a file whose frames sit inside a SECTION', async () => {
    const d = doc('design', [wrapper('SECTION', '7:1', [frame('7:2')])]);
    const r = await importFrames({ root: sandbox, slug: 'deck', dryRun: true, local: localOf(d) });
    expect(r.frameCount).toBe(1);
  });
});

describe('#155 §10 — buildClusterSvg keeps a gradient fill', () => {
  test('a gradient blob is composed with a <linearGradient>, not collapsed to one colour', () => {
    const fixture = new URL('../../../.ai/fixtures/figma/2026-08-03/design.fig', import.meta.url)
      .pathname;
    const local = decodeLocalFig(fixture);
    const svg = buildClusterSvg(local, '2:18');
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('stop-color="#e32412"');
    expect(svg).toMatch(/fill="url\(#g\d+\)"/);
  });
});

describe('#155 §5 — the import report names the nodes that could not be read', () => {
  test('nodeErrorLines prints one line per node and the true total', () => {
    const lines = nodeErrorLines({
      nodeErrors: [
        { nodeId: '9:1', type: 'frame', message: 'transform component m00 is not a finite number' },
      ],
      nodeErrorCount: 3,
    });
    expect(lines).toContain('9:1');
    expect(lines).toContain('not a finite number');
    expect(lines).toMatch(/3 node/);
  });

  test('a clean decode prints nothing', () => {
    expect(nodeErrorLines({ nodeErrors: [], nodeErrorCount: 0 })).toBe('');
  });
});

describe('#155 §10 (T4.1) — one browser session for all SVG promotions', () => {
  const fixture = new URL('../../../.ai/fixtures/figma/2026-08-03/design.fig', import.meta.url)
    .pathname;

  function fakeDeps(stagingDir: string, opts: { failFirstChunk?: boolean } = {}) {
    let n = 0;
    const calls = { batch: [] as number[], single: 0 };
    let batchCalls = 0;
    return {
      calls,
      deps: {
        stagingPath: (_id: string, ext: string) => join(stagingDir, `s${n++}.${ext}`),
        async promote() {
          calls.single++;
          return { ref: '/assets/single.svg' };
        },
        async promoteSvgBatch(paths: string[]) {
          calls.batch.push(paths.length);
          batchCalls++;
          // the first chunk fails on both attempts
          if (opts.failFirstChunk && batchCalls <= 2) throw new Error('canary timed out');
          return paths.map((_p, i) => `/assets/b${batchCalls}-${i}.svg`);
        },
        discard: () => {},
      },
    };
  }
  const pending = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => ({
      nodeId: '2:18',
      format: 'svg',
      placeholder: `/assets/pending-${tag}-${i}.svg`,
      collapsed: false,
    }));

  test('vector clusters from every frame go through the batch lane in chunks of 24', async () => {
    const local = decodeLocalFig(fixture);
    const staging = join(sandbox, 'staging');
    mkdirSync(staging, { recursive: true });
    const { deps, calls } = fakeDeps(staging);
    const entries = [pending(30, 'a'), pending(20, 'b'), pending(10, 'c')].map((p) => ({
      pendingExports: p,
      report: new ImportReport(),
    }));
    const out = await resolveArchiveAssetsMany(local, entries, {
      root: sandbox,
      designRootRel: '.design',
      stagingDir: staging,
      deps,
    });
    // 60 SVGs across three frames: three browser sessions, not sixty
    expect(calls.single).toBe(0);
    expect(calls.batch).toEqual([24, 24, 12]);
    expect(out.map((o: { resolved: unknown[] }) => o.resolved.length)).toEqual([30, 20, 10]);
    expect(out[1].rewrites.get('/assets/pending-b-0.svg')).toMatch(/^\/assets\/b/);
  });

  test('a failed chunk costs only itself and is named in its frame’s report', async () => {
    const local = decodeLocalFig(fixture);
    const staging = join(sandbox, 'staging');
    mkdirSync(staging, { recursive: true });
    const { deps } = fakeDeps(staging, { failFirstChunk: true });
    const a = { pendingExports: pending(30, 'a'), report: new ImportReport() };
    const b = { pendingExports: pending(5, 'b'), report: new ImportReport() };
    const out = await resolveArchiveAssetsMany(local, [a, b], {
      root: sandbox,
      designRootRel: '.design',
      stagingDir: staging,
      deps,
    });
    expect(a.report.entries.filter((e) => e.disposition === 'asset-skipped')).toHaveLength(24);
    expect(out[0].resolved).toHaveLength(6);
    expect(out[1].resolved).toHaveLength(5);
  });

  test('a raster still goes straight through, with no browser', async () => {
    const local = localOf(doc('design', []), { [`images/${REF}`]: PNG });
    const staging = join(sandbox, 'staging');
    mkdirSync(staging, { recursive: true });
    const { deps, calls } = fakeDeps(staging);
    const report = new ImportReport();
    const out = await resolveArchiveAssetsMany(
      local,
      [
        {
          pendingExports: [
            {
              nodeId: '3:1',
              format: 'png',
              placeholder: '/assets/p.png',
              collapsed: false,
              imageRef: REF,
            },
          ],
          report,
        },
      ],
      { root: sandbox, designRootRel: '.design', stagingDir: staging, deps }
    );
    expect(calls.single).toBe(1);
    expect(calls.batch).toEqual([]);
    expect(out[0].resolved).toHaveLength(1);
  });
});

describe('#155 §7 (T4.1) — a multi-page design file keeps every page', () => {
  const frame = (id: string) => ({
    id,
    name: `Frame ${id}`,
    type: 'FRAME',
    absoluteBoundingBox: box(0, 0, 100, 100),
    fills: solid,
  });
  const twoPages = (extra: Record<string, unknown> = {}) =>
    normalizeDocument(
      {
        id: '0:0',
        name: 'Doc',
        type: 'DOCUMENT',
        children: [
          { id: '0:1', name: 'One', type: 'CANVAS', children: [frame('1:1'), frame('1:2')] },
          { id: '0:2', name: 'Two', type: 'CANVAS', children: [frame('2:1')], ...extra },
          { id: '0:3', name: 'Three', type: 'CANVAS', children: [frame('3:1')] },
        ],
      },
      { fileKey: KEY, surface: 'design', origin: 'fig' }
    );
  const ids = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id);

  test('frames from every page are selected, in page order', () => {
    expect(ids(selectFrames(twoPages(), null))).toEqual(['1:1', '1:2', '2:1', '3:1']);
  });

  test('a hidden page contributes nothing', () => {
    expect(ids(selectFrames(twoPages({ visible: false }), null))).toEqual(['1:1', '1:2', '3:1']);
  });

  test('selectFramePages keeps the page each frame came from', () => {
    const pages = selectFramePages(twoPages(), null);
    expect(
      pages.map((p: { page: { id: string }; frames: unknown[] }) => [p.page.id, p.frames.length])
    ).toEqual([
      ['0:1', 2],
      ['0:2', 1],
      ['0:3', 1],
    ]);
  });

  test('importFrames imports them all, not only the first page', async () => {
    const r = await importFrames({
      root: sandbox,
      slug: 'multi',
      dryRun: true,
      local: localOf(twoPages()),
    });
    expect(r.frameCount).toBe(4);
  });
});

describe('#155 §10 (T4.1) — one canvas per file, in a target folder', () => {
  const frame = (id: string, x = 0) => ({
    id,
    name: `Frame ${id}`,
    type: 'FRAME',
    absoluteBoundingBox: box(x, 0, 300, 200),
    fills: solid,
  });
  const file = () =>
    normalizeDocument(
      {
        id: '0:0',
        name: 'Doc',
        type: 'DOCUMENT',
        children: [
          { id: '0:1', name: 'One', type: 'CANVAS', children: [frame('1:1'), frame('1:2', 400)] },
          { id: '0:2', name: 'Two', type: 'CANVAS', children: [frame('2:1')] },
        ],
      },
      { fileKey: KEY, surface: 'design', origin: 'fig' }
    );
  const run = (extra: Record<string, unknown> = {}) =>
    importFrames({
      root: sandbox,
      slug: 'deck',
      oneCanvas: true,
      folder: 'figma/deck',
      local: localOf(file()),
      ...extra,
    });

  test('three frames on two pages become ONE canvas with three artboards, in the folder', async () => {
    const r = await run();
    expect(r.written).toHaveLength(1);
    expect(r.frameCount).toBe(3);
    const path = join(sandbox, '.design', 'figma', 'deck', 'deck.tsx');
    expect(r.written[0].path).toBe(path);
    const tsx = await Bun.file(path).text();
    expect((tsx.match(/<DCArtboard/g) ?? []).length).toBe(3);
    const meta = await Bun.file(join(sandbox, '.design', 'figma', 'deck', 'deck.meta.json')).json();
    expect(meta.layout.artboards).toHaveLength(3);
    expect(meta.source.importedAt).not.toBeNull();
    // nothing is scattered flat in ui/
    expect(existsSync(join(sandbox, '.design', 'ui'))).toBe(false);
  });

  test('the folder defaults to ui and the name to the slug', async () => {
    await run({ folder: '' });
    expect(existsSync(join(sandbox, '.design', 'ui', 'deck.tsx'))).toBe(true);
  });

  test('a second import never overwrites the first', async () => {
    await run();
    await run();
    expect(existsSync(join(sandbox, '.design', 'figma', 'deck', 'deck (Figma).tsx'))).toBe(true);
    expect(existsSync(join(sandbox, '.design', 'figma', 'deck', 'deck.tsx'))).toBe(true);
  });

  test('a dry run writes nothing', async () => {
    const r = await run({ dryRun: true });
    expect(r.canvasCount).toBe(1);
    expect(existsSync(join(sandbox, '.design', 'figma'))).toBe(false);
  });

  test.each([
    '../escape',
    'system',
    '_state',
    '/abs',
  ])('the folder %p is refused', async (folder) => {
    await expect(run({ folder })).rejects.toMatchObject({ code: 2 });
  });

  test('a canvas name with a separator is refused', async () => {
    await expect(run({ name: '../x' })).rejects.toMatchObject({ code: 2 });
  });
});

describe('#155 §6 (T4.1) — the import says how instances were handled', () => {
  test('counts only: drawn, left empty and why, resized', () => {
    const lines = instanceLines({
      instances: { expanded: 12, cycle: 1, budget: 3, missing: 2, resized: 4 },
    });
    expect(lines).toContain('12 drawn from their component');
    expect(lines).toContain('1 in a component cycle');
    expect(lines).toContain('3 past the node cap');
    expect(lines).toContain('2 with no component in the file');
    expect(lines).toContain('4 instance(s) differ in size');
  });

  test('a file with no instances prints nothing', () => {
    expect(
      instanceLines({ instances: { expanded: 0, cycle: 0, budget: 0, missing: 0, resized: 0 } })
    ).toBe('');
    expect(instanceLines({})).toBe('');
  });
});

describe('#155 §3 (T4.1, D8) — an imported frame renders in the project type stack', () => {
  test('the text family lands on the DS --font-body variable, never on the Figma name', async () => {
    mkdirSync(join(sandbox, '.design', 'system', 'ds'), { recursive: true });
    await Bun.write(
      join(sandbox, '.design', 'system', 'ds', 'tokens.css'),
      ":root { --font-body: 'Hanken Grotesk', system-ui, sans-serif; --font-mono: 'JetBrains Mono', monospace; }\n"
    );
    await Bun.write(
      join(sandbox, '.design', 'config.json'),
      JSON.stringify({
        defaultDesignSystem: 'ds',
        designSystems: [{ name: 'ds', tokensCssRel: 'system/ds/tokens.css' }],
      })
    );
    const text = (id: string, family: string, y: number) => ({
      id,
      name: 'label',
      type: 'TEXT',
      characters: 'Hello',
      absoluteBoundingBox: box(10, y, 100, 20),
      style: { fontFamily: family, fontSize: 16 },
      fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    const d = doc('design', [
      {
        id: '8:1',
        name: 'Card',
        type: 'FRAME',
        absoluteBoundingBox: box(0, 0, 300, 100),
        fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
        children: [text('8:2', 'Nunito', 10), text('8:3', 'Fira Code', 40)],
      },
    ]);
    const r = await importFrames({ root: sandbox, slug: 'fonts', local: localOf(d) });
    const tsx = await Bun.file(r.written[0].path).text();
    expect(tsx).toContain('fontFamily: "var(--font-body)"');
    expect(tsx).toContain('fontFamily: "var(--font-mono)"');
    expect(tsx).not.toContain('Nunito');
    expect(tsx).not.toContain('Fira Code');
    const subs = r.reports[0].entries.filter(
      (e: { disposition: string }) => e.disposition === 'font-substituted'
    );
    expect(subs).toHaveLength(2);
  });
});
