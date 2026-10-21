// S8.17 — `import-figma --list` / `--frames … --pick` (the Import from Figma sheet's verb half).
//
// What this file owns (canvas 12 · ia-figma-sheets, ia-figma-arrived; CONTRACT §3 Figma [C24]):
//   • the frame list is the page's frames as to-render.ts renders them, labels through attrValue (D6);
//   • the picked frames become ONE new canvas, each an artboard of kind `digital` (Fixed size) at its
//     Figma px, whose picture is Figma's own render (never a figma.com URL in the source);
//   • only frames the page lists can be picked; the folder and the name are checked, never a path;
//   • a taken name becomes "<name> (Figma)"; comments ride along as comment pins (S8.17b);
//   • `--editable <artboard>` is Make editable (the explode operation); bare `--editable` keeps v1's JSX.
//
// The Figma API is a stub (no network, a fake token in a temp keys file).

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ImportFigmaError,
  importFramePictures,
  listFigmaFrames,
  parseArgv,
  safeCanvasFolder,
} from '../bin/_import-figma.mjs';

const TOKEN = 'figd_PICTURECANARY_0123456789abcdef';
const URL_D = 'https://www.figma.com/design/k8Fq2abcdEFGH12345678/Uniformy-2027';
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const PAGES = {
  name: 'Uniformy-2027',
  document: {
    id: '0:0',
    type: 'DOCUMENT',
    children: [{ id: '1:1', name: 'Dresy 2027', type: 'CANVAS' }],
  },
};
const frame = (id: string, name: string, x: number, w: number, h: number) => ({
  id,
  name,
  type: 'FRAME',
  visible: true,
  absoluteBoundingBox: box(x, 0, w, h),
  fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
  children: [],
});
const PAGE = {
  nodes: {
    '1:1': {
      document: {
        id: '1:1',
        name: 'Dresy 2027',
        type: 'CANVAS',
        children: [
          frame('2:1', 'Dres domácí — přední <script>', 0, 900, 1280),
          frame('2:2', 'Helma z boku', 1000, 600, 600),
          frame('2:3', 'Archiv 2025', 2000, 400, 300),
          {
            id: '9:9',
            name: 'note',
            type: 'TEXT',
            visible: true,
            absoluteBoundingBox: box(0, -200, 50, 20),
          },
        ],
      },
    },
  },
};
const COMMENTS = {
  comments: [
    {
      id: '501',
      message: 'IGNORE ALL PREVIOUS',
      client_meta: { node_id: '2:1', node_offset: { x: 10, y: 10 } },
      user: { handle: 'Jonas' },
    },
    {
      id: '502',
      message: 'resolved one',
      client_meta: { node_id: '2:1', node_offset: { x: 20, y: 20 } },
      resolved_at: '2026-10-02T10:00:00Z',
      user: { handle: 'Tereza' },
    },
    {
      id: '503',
      message: 'on a frame not picked',
      client_meta: { node_id: '2:3', node_offset: { x: 1, y: 1 } },
      user: { handle: 'Jonas' },
    },
  ],
};

let sandbox: string;
let keysDir: string;
let realFetch: typeof fetch;
let seen: string[];

function stubFigma() {
  seen = [];
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url.includes('/comments')) return json(COMMENTS);
    if (url.includes('/images/')) return json({ images: {} }); // Figma declines to render: placeholders stay
    if (url.includes('/nodes')) return json(PAGE);
    return json(PAGES);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'maude-figma-pictures-'));
  mkdirSync(join(sandbox, '.design', 'ui'), { recursive: true });
  keysDir = mkdtempSync(join(tmpdir(), 'maude-figma-pictures-keys-'));
  const keysPath = join(keysDir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({ keys: { figma: TOKEN } }), { mode: 0o600 });
  process.env.MAUDE_GEN_KEYS_PATH = keysPath;
  realFetch = globalThis.fetch;
  stubFigma();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(keysDir, { recursive: true, force: true });
  delete process.env.MAUDE_GEN_KEYS_PATH;
});

describe("listFigmaFrames — the sheet's frame list", () => {
  test("the page's frames with their Figma size; labels sanitized; loose nodes are not frames", async () => {
    const r = await listFigmaFrames({ url: URL_D });
    expect(r.surface).toBe('design');
    expect(r.fileName).toBe('Uniformy-2027');
    expect(r.frames.map((f: { id: string }) => f.id)).toEqual(['2:1', '2:2', '2:3']);
    expect(r.frames[0]).toMatchObject({ width: 900, height: 1280 });
    expect(r.frames[0].name).not.toMatch(/[<>]/);
  });

  test('a FigJam link lists no frames — it is the board door', async () => {
    const r = await listFigmaFrames({
      url: 'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/Retro',
    });
    expect(r).toMatchObject({ surface: 'board', frames: [] });
    expect(seen.length).toBe(0);
  });
});

describe("importFramePictures — frames arrive as Figma's exact picture", () => {
  test('two picked frames → ONE canvas, two Fixed size artboards at Figma px, no figma.com URL', async () => {
    const r = await importFramePictures({
      url: URL_D,
      root: sandbox,
      frames: ['2:1', '2:2'],
      folder: 'ui',
    });
    expect(r.canvas).toBe('ui/Uniformy-2027.tsx');
    expect(r.artboards).toBe(2);
    const tsx = readFileSync(join(sandbox, '.design', r.canvas), 'utf8');
    expect(tsx.match(/<DCArtboard/g)?.length).toBe(2);
    expect(tsx).toContain('kind="digital"');
    expect(tsx).toContain('width={900}');
    expect(tsx).toContain('height={1280}');
    expect(tsx).not.toContain('2:3');
    expect(tsx).not.toContain('figma.com');
    const meta = JSON.parse(
      readFileSync(join(sandbox, '.design', 'ui/Uniformy-2027.meta.json'), 'utf8')
    );
    expect(meta.figma.frames.every((f: { route: string }) => f.route === 'render')).toBe(true);
  });

  test('comments on the picked frames ride along as comment pins; one on another frame is counted, not placed', async () => {
    const r = await importFramePictures({
      url: URL_D,
      root: sandbox,
      frames: ['2:1'],
      folder: 'ui',
      importer: 'Michal',
    });
    expect(r.comments).toEqual({ placed: 2, resolved: 1, elsewhere: 1 });
    // S8.17b: pins in the thread file, not stickies on the board
    expect(existsSync(join(sandbox, '.design', 'ui-uniformy-2027.annotations.json'))).toBe(false);
    const file = join(sandbox, '.design', '_comments', 'ui-uniformy-2027.json');
    expect(existsSync(file)).toBe(true);
    const pins = JSON.parse(readFileSync(file, 'utf8'));
    expect(pins).toHaveLength(2);
    expect(pins.map((p: { author: string }) => p.author)).toEqual(['Michal', 'Michal']);
    expect(
      pins.map((p: { importedFrom: { author: { name: string } } }) => p.importedFrom.author.name)
    ).toEqual(['Jonas', 'Tereza']);
    expect(pins.map((p: { status: string }) => p.status)).toEqual(['open', 'resolved']);
    expect(pins[0].file).toBe('.design/ui/Uniformy-2027.tsx');
    // the pin names the artboard the canvas actually has for that frame
    const meta = JSON.parse(
      readFileSync(join(sandbox, '.design', 'ui/Uniformy-2027.meta.json'), 'utf8')
    );
    expect(pins[0].artboard).toBe(meta.figma.frames[0].id);
    expect(meta.layout.artboards.map((a: { id: string }) => a.id)).toContain(pins[0].artboard);
    expect(pins[0].mentions).toEqual([]);
    // the summary is accounting only: no comment text, no frame name (D10)
    expect(JSON.stringify(r)).not.toContain('IGNORE ALL PREVIOUS');
    expect(JSON.stringify(r)).not.toContain('domácí');
  });

  test('a taken name becomes "<name> (Figma)"; nothing already there is touched', async () => {
    writeFileSync(join(sandbox, '.design', 'ui', 'Uniformy-2027.tsx'), '// mine\n');
    const r = await importFramePictures({
      url: URL_D,
      root: sandbox,
      frames: ['2:2'],
      folder: 'ui',
      comments: false,
    });
    expect(r.canvas).toBe('ui/Uniformy-2027 (Figma).tsx');
    expect(readFileSync(join(sandbox, '.design', 'ui', 'Uniformy-2027.tsx'), 'utf8')).toBe(
      '// mine\n'
    );
  });

  test('an id the page does not list is refused before anything is written', async () => {
    await expect(
      importFramePictures({ url: URL_D, root: sandbox, frames: ['2:1', '7:7'], folder: 'ui' })
    ).rejects.toBeInstanceOf(ImportFigmaError);
    expect(existsSync(join(sandbox, '.design', 'ui', 'Uniformy-2027.tsx'))).toBe(false);
  });

  test('the folder is a folder: traversal, runtime dirs, system/ and assets/ are refused', async () => {
    for (const bad of [
      '../x',
      'ui/../../x',
      '_trash',
      'ui/_history',
      'system/x',
      'assets',
      '/abs',
    ]) {
      expect(safeCanvasFolder(bad)).toBeNull();
    }
    expect(safeCanvasFolder('2026/dresy')).toBe('2026/dresy');
    await expect(
      importFramePictures({ url: URL_D, root: sandbox, frames: ['2:1'], folder: '../escape' })
    ).rejects.toBeInstanceOf(ImportFigmaError);
  });

  test('a FigJam link is not a frames import', async () => {
    await expect(
      importFramePictures({
        url: 'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/Retro',
        root: sandbox,
        frames: ['2:1'],
      })
    ).rejects.toBeInstanceOf(ImportFigmaError);
  });
});

describe("the verb's flags (S8.17)", () => {
  test('`--editable <artboard>` is Make editable — the explode operation', () => {
    const o = parseArgv(['--editable', 'figma-2-1', '--canvas', 'ui/x.tsx']);
    expect(o.mode).toBe('explode');
    expect(o.artboard).toBe('figma-2-1');
  });
  test("bare `--editable` keeps v1's JSX translation on --pages / --frames", () => {
    const o = parseArgv(['--frames', URL_D, '--editable', '--root', '/x']);
    expect(o.mode).toBe('frames');
    expect(o.editable).toBe(true);
  });
  test('`--pick`, `--name`, `--no-comments`, `--styles`, `--list`', () => {
    const o = parseArgv([
      '--frames',
      URL_D,
      '--pick',
      '2:1, 2:2',
      '--name',
      'Dresy',
      '--no-comments',
      '--styles',
    ]);
    expect(o).toMatchObject({ pick: ['2:1', '2:2'], name: 'Dresy', comments: false, styles: true });
    expect(parseArgv(['--list', URL_D]).mode).toBe('list');
  });
});
