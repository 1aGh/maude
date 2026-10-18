// figjam-into — S4.5 / C23: a FigJam board lands in an EXISTING canvas as one section of annotation
// ops (`import-figma --board <url> --into <canvas>`): comments -> stickies carrying their author,
// widgets -> pictures, every item `source: figjam`, one batch through the op route or the board file.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonical, parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { ImportFigmaError, importBoardInto } from '../bin/_import-figma.mjs';
import { FIGJAM_SECTION_TITLE, strokesIntoOps } from '../figma/into-board.ts';
import { ImportReport } from '../figma/sanitize.ts';
import { toStrokes } from '../figma/to-strokes.ts';
import { normalizeDocument } from '../figma/types.ts';

const TOKEN = 'figd_VERBCANARY_0123456789abcdef';
const BOARD_URL = 'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/Retro';
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/** Two stickies, two shapes joined by a connector, a widget, and one hidden node. */
const DOC = {
  document: {
    id: '0:0',
    name: 'Document',
    type: 'CANVAS',
    children: [
      {
        id: '1:1',
        name: 'Sticky',
        type: 'STICKY',
        absoluteBoundingBox: box(-1000, -500, 240, 240),
        characters: 'Ship it on Friday',
      },
      {
        id: '1:2',
        name: 'Sticky',
        type: 'STICKY',
        absoluteBoundingBox: box(-700, -500, 240, 240),
        characters: 'Too many meetings',
      },
      {
        id: '2:1',
        name: 'Box',
        type: 'SHAPE_WITH_TEXT',
        shapeType: 'SQUARE',
        absoluteBoundingBox: box(-1000, 0, 200, 100),
        characters: 'Plan',
      },
      {
        id: '2:2',
        name: 'Box',
        type: 'SHAPE_WITH_TEXT',
        shapeType: 'ELLIPSE',
        absoluteBoundingBox: box(-600, 0, 200, 100),
        characters: 'Do',
      },
      {
        id: '3:1',
        name: 'Arrow',
        type: 'CONNECTOR',
        absoluteBoundingBox: box(-800, 40, 200, 20),
        connectorStart: '2:1',
        connectorEnd: '2:2',
        connectorEndCap: 'ARROW_LINES',
      },
      {
        id: '4:1',
        name: 'Voting',
        type: 'WIDGET',
        absoluteBoundingBox: box(-300, -400, 300, 200),
      },
      {
        id: '9:1',
        name: 'hidden',
        type: 'STICKY',
        visible: false,
        characters: 'you cannot see me',
        absoluteBoundingBox: box(0, 0, 240, 240),
      },
    ],
  },
};

const COMMENTS = {
  comments: [
    {
      id: '501',
      message: 'Warmer sun?',
      client_meta: { node_id: '1:1', node_offset: { x: 10, y: 20 } },
      user: { handle: 'Klara' },
      created_at: '2026-10-01T10:00:00Z',
    },
    {
      id: '502',
      message: 'Agreed',
      parent_id: '501',
      user: { handle: 'Jonas' },
      created_at: '2026-10-01T11:00:00Z',
    },
    {
      id: '503',
      message: 'Done already',
      client_meta: { x: -200, y: 300 },
      resolved_at: '2026-10-02T10:00:00Z',
      user: { handle: 'Tereza' },
    },
  ],
};

let sandbox: string;
let keysDir: string;
let realFetch: typeof fetch;

/** Route the Figma API (document / comments / images); anything else goes to the real network. */
function mockFigma(): void {
  globalThis.fetch = mock(async (input: unknown, init?: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/^http:\/\/127\.0\.0\.1:/.test(url)) return realFetch(input as never, init as never);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url.includes('/comments')) return json(COMMENTS);
    if (url.includes('/images/')) return json({ images: {} });
    return json(DOC);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'maude-figjam-into-'));
  mkdirSync(join(sandbox, '.design', 'ui'), { recursive: true });
  writeFileSync(join(sandbox, '.design', 'ui', 'Retro.tsx'), '// a canvas\n');
  keysDir = mkdtempSync(join(tmpdir(), 'maude-figjam-into-keys-'));
  const keysPath = join(keysDir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({ keys: { figma: TOKEN } }), { mode: 0o600 });
  process.env.MAUDE_GEN_KEYS_PATH = keysPath;
  realFetch = globalThis.fetch;
  mockFigma();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(keysDir, { recursive: true, force: true });
  delete process.env.MAUDE_GEN_KEYS_PATH;
});

const boardPath = () => join(sandbox, '.design', 'ui-retro.annotations.json');
const readBoard = (): AnnotationElement[] => parseBoard(readFileSync(boardPath(), 'utf8')).elements;

describe('widgets -> pictures (toStrokes widgetsAsPictures)', () => {
  const doc = () =>
    normalizeDocument(DOC.document, { fileKey: 'Em6NOwaOFTYV7NlQT4NK8l', surface: 'board' });

  test('a widget becomes an image stroke asking Figma for the node, alt says what it was', () => {
    const r = toStrokes(doc(), { resetIds: true, widgetsAsPictures: true });
    const pic = r.strokes.find((s) => s.tool === 'image') as
      | { alt?: string; w: number }
      | undefined;
    expect(pic?.alt).toBe('Widget “Voting” — as a picture');
    expect(pic?.w).toBe(300);
    expect(r.pendingImages).toEqual([
      { strokeId: expect.any(String), nodeId: '4:1', imageRef: null, format: 'png' },
    ]);
    expect(r.report.entries.find((e) => e.nodeId === '4:1')).toMatchObject({
      disposition: 'asset-pending',
    });
  });

  test('without the option a widget is still skipped, reported (the --board behaviour is unchanged)', () => {
    const r = toStrokes(doc(), { resetIds: true });
    expect(r.strokes.some((s) => s.tool === 'image')).toBe(false);
    expect(r.report.entries.find((e) => e.nodeId === '4:1')?.disposition).toBe('unmappable-type');
  });
});

describe('strokesIntoOps — one section, per-import ids, source on every item', () => {
  const strokes = () => {
    const r = toStrokes(
      normalizeDocument(DOC.document, { fileKey: 'Em6NOwaOFTYV7NlQT4NK8l', surface: 'board' }),
      { resetIds: true }
    );
    return r.strokes;
  };
  const existing = () => [
    canonical({
      id: 'old',
      type: 'sticky',
      index: 'a5',
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      text: 'mine',
    } as never),
  ];

  test('the first op is the section, every other item is inside it, parents come first', () => {
    const r = strokesIntoOps(strokes(), {
      tag: 'ab12c',
      existing: existing() as never,
      at: { x: 5000, y: 100 },
    });
    const els = r.ops.map((o) => (o as { el: AnnotationElement }).el);
    expect(els[0]).toMatchObject({
      id: r.section,
      type: 'section',
      label: FIGJAM_SECTION_TITLE,
      x: 5000,
      y: 100,
    });
    expect(r.count).toBe(els.length - 1);
    const ids = new Set(els.map((e) => e.id));
    const placed = new Set<string>();
    for (const e of els) {
      if (e.parent) {
        expect(ids.has(e.parent as string)).toBe(true);
        expect(placed.has(e.parent as string)).toBe(true); // the parent was put first
      }
      placed.add(e.id);
    }
    // Everything but the section hangs somewhere under it.
    const rootOf = (e: AnnotationElement): string => {
      let cur = e;
      while (cur.parent) cur = els.find((x) => x.id === cur.parent) as AnnotationElement;
      return cur.id;
    };
    expect(els.slice(1).every((e) => rootOf(e) === r.section)).toBe(true);
  });

  test('ids are minted per import; references (parent, bound ends) point at the minted ids', () => {
    const bound = [
      { id: 'r1', tool: 'rect', color: '#222', width: 2, x: 10, y: 10, w: 100, h: 60 },
      { id: 'r2', tool: 'rect', color: '#222', width: 2, x: 300, y: 10, w: 100, h: 60 },
      {
        id: 'a1',
        tool: 'arrow',
        color: '#222',
        width: 2,
        x1: 110,
        y1: 40,
        x2: 300,
        y2: 40,
        startBind: { hostId: 'r1', nx: 1, ny: 0.5 },
        endBind: { hostId: 'r2', nx: 0, ny: 0.5 },
      },
    ] as never[];
    const r = strokesIntoOps(bound, { tag: 'ab12c' });
    const els = r.ops.map((o) => (o as { el: AnnotationElement }).el);
    expect(els.every((e) => e.id.startsWith('fjab12c_'))).toBe(true);
    const arrow = els.find((e) => e.type === 'arrow');
    const ends = [arrow?.start, arrow?.end] as Array<{ el?: string }>;
    expect(ends.every((e) => typeof e.el === 'string' && els.some((x) => x.id === e.el))).toBe(
      true
    );
    // A second import mints different ids — it stacks, it never collides.
    const again = strokesIntoOps(bound, { tag: 'zz99z' });
    const a = new Set(els.map((e) => e.id));
    expect(again.ops.some((o) => a.has((o as { el: AnnotationElement }).el.id))).toBe(false);
  });

  test('every item carries source {kind: figjam}; a comment thread also its author', () => {
    const cards = [
      {
        id: 'figc_501',
        tool: 'sticky',
        color: '#fff2a8',
        x: 10,
        y: 10,
        w: 240,
        h: 120,
        text: 'Klara: Warmer sun?',
        fontSize: 13,
      },
    ] as never;
    const r = strokesIntoOps([...strokes(), ...(cards as never[])], {
      tag: 'ab12c',
      authors: new Map([['figc_501', 'Klara']]),
    });
    const els = r.ops.map((o) => (o as { el: AnnotationElement }).el);
    expect(els.every((e) => (e.source as { kind: string }).kind === 'figjam')).toBe(true);
    expect(els.find((e) => e.id === 'fjab12c_figc_501')?.source).toEqual({
      kind: 'figjam',
      author: 'Klara',
    });
    expect(els.find((e) => e.type === 'sticky' && e.id !== 'fjab12c_figc_501')?.source).toEqual({
      kind: 'figjam',
    });
  });

  test('the section lands above what is already on the board and keeps the imported author marker', () => {
    const r = strokesIntoOps(strokes(), { tag: 'ab12c', existing: existing() as never });
    const section = (r.ops[0] as { el: AnnotationElement }).el;
    expect(String(section.index) > 'a5').toBe(true);
    const sticky = r.ops
      .map((o) => (o as { el: AnnotationElement }).el)
      .find((e) => e.type === 'sticky');
    expect(sticky?.author).toMatchObject({ name: 'imported-figma' });
  });

  test('an oversized author handle is bounded and never costs the item', () => {
    const r = strokesIntoOps(
      [
        {
          id: 'figc_1',
          tool: 'sticky',
          color: '#fff2a8',
          x: 1,
          y: 1,
          w: 200,
          h: 100,
          text: 'x',
        } as never,
      ],
      { tag: 'ab12c', authors: new Map([['figc_1', 'x'.repeat(500)]]) }
    );
    const el = (r.ops.at(-1) as { el: AnnotationElement }).el;
    expect((el.source as { kind: string }).kind).toBe('figjam');
    expect(String((el.source as { author?: string }).author ?? '').length).toBeLessThanOrEqual(64);
  });
});

describe('importBoardInto — the verb function', () => {
  const into = (extra: Record<string, unknown> = {}) =>
    importBoardInto({ url: BOARD_URL, root: sandbox, into: 'ui/Retro.tsx', ...extra });

  test('without a studio it writes the canonical board: one section, comments as stickies, author kept', async () => {
    const r = await into();
    expect(r.via).toBe('file');
    expect(r.comments).toBe(2); // the reply is folded into its thread
    const text = readFileSync(boardPath(), 'utf8');
    const parsed = parseBoard(text);
    expect(parsed.dropped).toEqual([]);
    expect(serializeBoard(parsed.elements)).toBe(text); // canonical
    const els = parsed.elements;
    const sections = els.filter((e) => e.type === 'section');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe(r.section);
    const klara = els.find(
      (e) => (e.source as { author?: string } | undefined)?.author === 'Klara'
    );
    expect(klara?.type).toBe('sticky');
    expect(String(klara?.text)).toContain('Warmer sun?');
    // The reply rides in the thread's text, the resolved thread is on grey paper.
    expect(String(klara?.text)).toContain('Jonas');
    const tereza = els.find(
      (e) => (e.source as { author?: string } | undefined)?.author === 'Tereza'
    );
    expect(tereza?.fill).not.toBe(klara?.fill);
    // A widget whose picture could not be fetched is reported and NOT written as an empty frame.
    expect(els.some((e) => e.type === 'image')).toBe(false);
    expect(r.report.entries.some((e) => e.nodeId === '4:1')).toBe(true);
    // The hidden node never arrives.
    expect(els.some((e) => String(e.text ?? '').includes('cannot see me'))).toBe(false);
  });

  test('what is already on the board stays; a second import adds a second section', async () => {
    writeFileSync(
      boardPath(),
      serializeBoard([
        canonical({
          id: 'mine',
          type: 'sticky',
          index: 'a0',
          x: 0,
          y: 0,
          w: 200,
          h: 200,
          text: 'mine',
        } as never),
      ])
    );
    const first = await into();
    const second = await into();
    expect(first.section).not.toBe(second.section);
    const els = readBoard();
    expect(els.find((e) => e.id === 'mine')?.text).toBe('mine');
    expect(els.filter((e) => e.type === 'section')).toHaveLength(2);
    // Right of what was there, not on top of it.
    const sec = els.find((e) => e.id === first.section);
    expect(Number(sec?.x)).toBeGreaterThan(200);
  });

  test('--at places the section; the meta.json artboards push the default origin right', async () => {
    await into({ at: { x: 7000, y: 300 } });
    const sec = readBoard().find((e) => e.type === 'section');
    expect(sec).toMatchObject({ x: 7000, y: 300 });
    rmSync(boardPath());
    writeFileSync(
      join(sandbox, '.design', 'ui', 'Retro.meta.json'),
      JSON.stringify({ layout: { artboards: [{ id: 'a', x: 100, y: 50, w: 1000 }] } })
    );
    await into();
    expect(readBoard().find((e) => e.type === 'section')).toMatchObject({ x: 1220, y: 50 });
  });

  test('--dry-run writes nothing and still counts', async () => {
    const r = await into({ dryRun: true });
    expect(r.via).toBeNull();
    expect(r.items).toBeGreaterThan(0);
    expect(existsSync(boardPath())).toBe(false);
  });

  test('a canvas that is not there, or outside the design root, is refused before any fetch', async () => {
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls;
    const before = calls.length;
    for (const target of ['ui/Nope.tsx', '../outside.tsx', 'ui/Retro.json']) {
      const err = await into({ into: target }).catch((e) => e);
      expect(err).toBeInstanceOf(ImportFigmaError);
      expect((err as ImportFigmaError).code).toBe(2);
    }
    expect(calls.length).toBe(before);
  });

  test('a live studio gets ONE batch of put ops on the op route; the board file is not written', async () => {
    const got: Array<{
      file: string;
      actionId: string;
      ops: Array<{ op: string; el: { id: string } }>;
    }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        got.push((await req.json()) as never);
        return Response.json({ ok: true, changed: true, rejected: [] });
      },
    });
    const serverJson = join(sandbox, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      const r = await into();
      expect(r.via).toBe('server');
      expect(got).toHaveLength(1);
      expect(got[0]?.file).toBe('.design/ui/Retro.tsx');
      expect(got[0]?.actionId).toBe(`figjam-import-${r.section}`);
      expect(got[0]?.ops.every((o) => o.op === 'put')).toBe(true);
      expect(got[0]?.ops[0]?.el.id).toBe(r.section);
      expect(existsSync(boardPath())).toBe(false);
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });

  test('a server that refuses an item fails the import (no silent partial)', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ ok: true, rejected: [{ reason: 'invalid' }] }),
    });
    const serverJson = join(sandbox, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      await expect(into()).rejects.toThrow(/server refused 1 imported item/);
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });

  test('the report text is code-owned: no sticky text or author handle is echoed (D10)', async () => {
    const r = await into({ dryRun: true });
    const dump = JSON.stringify(r.report.entries);
    for (const secret of ['Ship it on Friday', 'Warmer sun', 'Klara', 'Voting']) {
      expect(dump).not.toContain(secret);
    }
    expect(r.report instanceof ImportReport).toBe(true);
  });
});
