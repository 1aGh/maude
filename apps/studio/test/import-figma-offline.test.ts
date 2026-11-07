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
  nodeErrorLines,
  selectFrames,
} from '../bin/_import-figma.mjs';
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
