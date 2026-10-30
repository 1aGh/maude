// gate-b-c4h (c4g open item) — `maude design import-figma` never writes a NEW canvas whose sync key
// (S1.23b, sync-name-key.ts) an existing different canvas already has: the two would share one sync
// document and every slug-keyed sidecar (comments, board, EDL). A re-import over the same path stays
// allowed. Figma is a stub (no network, a fake token in a temp keys file).

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  ImportFigmaError,
  importBoard,
  importFramePictures,
  importFrames,
  importPages,
  slugTwinOf,
} from '../bin/_import-figma.mjs';
import { syncKeyOf } from '../sync-name-key.ts';

const TOKEN = 'figd_TWINCANARY_0123456789abcdef';
const BOARD_URL = 'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/Analyza';
const DESIGN_URL = 'https://www.figma.com/design/dGNzRC2kmrmGnOxaBa0RI7/Fixtures';
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const BOARD = {
  document: {
    id: '0:0',
    name: 'Document',
    type: 'CANVAS',
    children: [
      {
        id: '1:8',
        name: 'Sticky',
        type: 'STICKY',
        absoluteBoundingBox: box(0, 0, 240, 240),
        characters: 'Persona A',
      },
    ],
  },
};
const DESIGN = {
  document: {
    id: '0:1',
    name: 'Page 1',
    type: 'CANVAS',
    children: [
      {
        id: '1:2',
        name: 'Card',
        type: 'FRAME',
        absoluteBoundingBox: box(0, 0, 400, 100),
        children: [],
      },
    ],
  },
};
// importFramePictures: the pages list, the page, no comments, no renders
const PAGES = {
  name: 'Uniformy-2027',
  document: { id: '0:0', type: 'DOCUMENT', children: [{ id: '1:1', name: 'P', type: 'CANVAS' }] },
};
const PAGE = {
  nodes: {
    '1:1': {
      document: {
        id: '1:1',
        name: 'P',
        type: 'CANVAS',
        children: [
          {
            id: '2:1',
            name: 'Dres',
            type: 'FRAME',
            visible: true,
            absoluteBoundingBox: box(0, 0, 900, 1280),
            fills: [],
            children: [],
          },
        ],
      },
    },
  },
};

let sandbox: string;
let keysDir: string;
let realFetch: typeof fetch;
const design = () => join(sandbox, '.design');

function stub(body: (url: string) => unknown) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    return new Response(JSON.stringify(body(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}
const picturesBody = (url: string) =>
  url.includes('/comments')
    ? { comments: [] }
    : url.includes('/images/')
      ? { images: {} }
      : url.includes('/nodes')
        ? PAGE
        : PAGES;

/** A DIFFERENT file whose sync key is `rel`'s (`~` sanitises away; the slug is otherwise the same). */
const twinOf = (rel: string) => rel.replace(/\.tsx$/, '~.tsx');
function plant(rel: string, text = 'export default () => <p>THE-TWIN</p>;\n') {
  mkdirSync(dirname(join(design(), rel)), { recursive: true });
  writeFileSync(join(design(), rel), text);
}
async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'maude-figma-twins-'));
  mkdirSync(join(sandbox, '.design', 'ui'), { recursive: true });
  keysDir = mkdtempSync(join(tmpdir(), 'maude-figma-twins-keys-'));
  const keysPath = join(keysDir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({ keys: { figma: TOKEN } }), { mode: 0o600 });
  process.env.MAUDE_GEN_KEYS_PATH = keysPath;
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(keysDir, { recursive: true, force: true });
  delete process.env.MAUDE_GEN_KEYS_PATH;
});

describe('slugTwinOf', () => {
  test('a different canvas on the same key is a twin; the same path and runtime dirs are not', () => {
    plant('ui/a/b.tsx');
    plant('_draw/ui-a-b.tsx');
    expect(syncKeyOf('ui/a-b.tsx')).toBe(syncKeyOf('ui/a/b.tsx'));
    expect(slugTwinOf(design(), 'ui/a-b.tsx')).toBe('ui/a/b.tsx');
    expect(slugTwinOf(design(), 'ui/a/b.tsx')).toBeNull();
    expect(slugTwinOf(design(), 'ui/c.tsx')).toBeNull();
  });
});

describe('--board (the host canvas ui/<title>.tsx)', () => {
  test('refused beside a twin; the twin is untouched and nothing is written', async () => {
    stub(() => BOARD);
    const first = (await importBoard({ url: BOARD_URL, root: sandbox })) as { canvas: string };
    rmSync(join(sandbox, '.design'), { recursive: true, force: true });
    mkdirSync(join(sandbox, '.design', 'ui'), { recursive: true });
    plant(twinOf(first.canvas));
    const e = await refusal(importBoard({ url: BOARD_URL, root: sandbox }));
    expect(e).toBeInstanceOf(ImportFigmaError);
    expect(String((e as Error).message)).toContain('is too close to');
    expect(existsSync(join(design(), first.canvas))).toBe(false);
    expect(readFileSync(join(design(), twinOf(first.canvas)), 'utf8')).toContain('THE-TWIN');
  });
  test('a re-import over the same path is allowed', async () => {
    stub(() => BOARD);
    const a = (await importBoard({ url: BOARD_URL, root: sandbox })) as { canvas: string };
    const b = (await importBoard({ url: BOARD_URL, root: sandbox })) as { canvas: string };
    expect(b.canvas).toBe(a.canvas);
  });
});

describe('--frames (ui/<slug>.tsx)', () => {
  test('refused beside a twin; a re-import over the same path is allowed', async () => {
    stub(() => DESIGN);
    const r = (await importFrames({ url: DESIGN_URL, root: sandbox })) as {
      written: Array<{ slug: string }>;
    };
    const rel = `ui/${r.written[0]?.slug}.tsx`;
    expect(existsSync(join(design(), rel))).toBe(true);
    expect(await refusal(importFrames({ url: DESIGN_URL, root: sandbox }))).toBeNull();
    rmSync(join(design(), rel));
    plant(twinOf(rel));
    const e = await refusal(importFrames({ url: DESIGN_URL, root: sandbox }));
    expect(e).toBeInstanceOf(ImportFigmaError);
    expect(existsSync(join(design(), rel))).toBe(false);
  });
});

describe('--frames … --pick (Import from Figma: one canvas of pictures)', () => {
  test('a twin of the name counts as taken: the canvas becomes "<name> (Figma)"', async () => {
    stub(picturesBody);
    plant(twinOf('ui/Uniformy-2027.tsx'));
    const r = (await importFramePictures({
      url: 'https://www.figma.com/design/k8Fq2abcdEFGH12345678/Uniformy-2027',
      root: sandbox,
      frames: ['2:1'],
      folder: 'ui',
    })) as { canvas: string };
    expect(r.canvas).toBe('ui/Uniformy-2027 (Figma).tsx');
    expect(existsSync(join(design(), 'ui/Uniformy-2027.tsx'))).toBe(false);
  });
});

describe('--pages (ui/<folder>/<page title>.tsx)', () => {
  const PAGES_DOC = {
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [
        { id: '1:1', name: 'One', type: 'CANVAS' },
        { id: '2:2', name: 'Two', type: 'CANVAS' },
      ],
    },
  };
  const pageBody = (id: string) => ({
    nodes: {
      [id]: {
        document: {
          id,
          name: 'P',
          type: 'CANVAS',
          children: [
            {
              id: `${id}0`,
              name: 'Frame',
              type: 'FRAME',
              visible: true,
              absoluteBoundingBox: box(0, 0, 100, 100),
            },
          ],
        },
      },
    },
  });
  const pagesBody = (url: string) => {
    if (url.includes('/images')) return { images: {} };
    if (url.includes('/comments')) return { comments: [] };
    const m = /ids=([^&]+)/.exec(url);
    const id = m ? decodeURIComponent(m[1] as string) : '';
    return id && !url.includes('depth=1') ? pageBody(id) : PAGES_DOC;
  };
  const URL_P = 'https://www.figma.com/design/2H6a9YUgPAu0AGdEiwP895/x';

  test('a page whose canvas would twin another refuses the import before any page lands', async () => {
    stub(pagesBody);
    await importPages({ url: URL_P, root: sandbox, folder: 'f' });
    const one = 'ui/f/One.tsx';
    const two = 'ui/f/Two.tsx';
    expect(existsSync(join(design(), one))).toBe(true);
    expect(existsSync(join(design(), two))).toBe(true);
    // a re-import over the same paths is allowed
    expect(await refusal(importPages({ url: URL_P, root: sandbox, folder: 'f' }))).toBeNull();
    rmSync(join(design(), 'ui', 'f'), { recursive: true, force: true });
    plant(twinOf(two));
    const e = await refusal(importPages({ url: URL_P, root: sandbox, folder: 'f' }));
    expect(e).toBeInstanceOf(ImportFigmaError);
    expect(existsSync(join(design(), one))).toBe(false); // page One (before the twin) did not land
    expect(existsSync(join(design(), two))).toBe(false);
    expect(readFileSync(join(design(), twinOf(two)), 'utf8')).toContain('THE-TWIN');
  });
});
