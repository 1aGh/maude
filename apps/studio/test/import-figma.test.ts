// `maude design import-figma --board` — the write path (DDR-216 T6).
//
// The translation itself is covered by `figma/to-strokes.test.ts`. What this
// file owns is the VERB's own contract:
//
//   • the output goes through the canonical serializer + `sanitizeAnnotationSvg`
//     (D6's annotation row) and lands at a code-computed slug;
//   • assets/artifacts stage OUTSIDE the design root and are promoted only on
//     success, so a failure leaves nothing in a versioned, Syncthing-replicated
//     directory (D5 — "gitignored" is NOT "not replicated");
//   • the write is realpath-contained;
//   • the summary is enum + node ids ONLY, never node text, because this verb
//     is run BY an agent and everything it prints is model input (D10).

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBoard } from '../annotations/schema.ts';
import { elementsToStrokes } from '../annotations/v1-adapter.ts';
import { strokesToSvg } from '../annotations-model.ts';

import {
  formatSummary,
  ImportFigmaError,
  importBoard,
  importFrames,
  importPages,
  importTokens,
  withSansFallback,
} from '../bin/_import-figma.mjs';

const TOKEN = 'figd_VERBCANARY_0123456789abcdef';
const BOARD_URL = 'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/Analyza';

let sandbox: string;
let keysDir: string;
let realFetch: typeof fetch;

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/** A board carrying a hostile layer name, a hidden node and an unmappable one. */
const DOC = {
  document: {
    id: '0:0',
    name: 'Document',
    type: 'CANVAS',
    children: [
      {
        id: '1:8',
        name: 'Sticky',
        type: 'STICKY',
        absoluteBoundingBox: box(-3244, -6272, 240, 240),
        characters: 'Persona A',
      },
      {
        id: '2:17',
        name: 'Příliš žluťoučký — "test" / <b> & \'x\'',
        type: 'SHAPE_WITH_TEXT',
        shapeType: 'SQUARE',
        absoluteBoundingBox: box(0, 0, 200, 200),
        characters: 'SECRET_BODY_TEXT',
      },
      {
        id: '2:40',
        name: 'Parallelogram',
        type: 'SHAPE_WITH_TEXT',
        shapeType: 'PARALLELOGRAM_RIGHT',
        absoluteBoundingBox: box(400, 0, 200, 200),
      },
      {
        id: '9:1',
        name: 'hidden',
        type: 'STICKY',
        visible: false,
        characters: 'you cannot see me',
        absoluteBoundingBox: box(800, 0, 240, 240),
      },
    ],
  },
};

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'maude-figma-verb-'));
  mkdirSync(join(sandbox, '.design'), { recursive: true });
  keysDir = mkdtempSync(join(tmpdir(), 'maude-figma-verb-keys-'));
  const keysPath = join(keysDir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({ keys: { figma: TOKEN } }), { mode: 0o600 });
  process.env.MAUDE_GEN_KEYS_PATH = keysPath;
  realFetch = globalThis.fetch;
  globalThis.fetch = mock(
    async () =>
      new Response(JSON.stringify(DOC), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(keysDir, { recursive: true, force: true });
  delete process.env.MAUDE_GEN_KEYS_PATH;
});

/**
 * DDR-242 — the import writes a v2 board (`.annotations.json`). Render it to
 * the v1 SVG these assertions (sanitizer-clean, paint order, sections) read.
 */
function boardSvgAt(path: string): string {
  return strokesToSvg(elementsToStrokes(parseBoard(readFileSync(path, 'utf8')).elements));
}

describe('a rendered SVG never falls back to a SERIF (live-migration report)', () => {
  // Measured on the StudyFi cover page: Figma renders text as
  // `font-family="Inter"` and nothing else. An SVG behind `<img src>` renders
  // in an isolated document — the page CSS, its @font-face rules and the DS
  // webfonts do not reach inside — so an uninstalled family lands on the
  // browser default, which is a serif. A sans-serif product design arrived in
  // Times, and every count-based check called it a success.
  test('a bare family gains a generic sans fallback', () => {
    expect(withSansFallback('<text font-family="Inter">x</text>')).toContain(
      'font-family="Inter, sans-serif"'
    );
    expect(withSansFallback('<text style="font-family: SF Pro Text">x</text>')).toContain(
      'font-family:SF Pro Text, sans-serif'
    );
  });

  test('a stack that already ends in a generic is left alone', () => {
    for (const already of [
      '<text font-family="Inter, sans-serif">x</text>',
      '<text font-family="Georgia, serif">x</text>',
      '<text font-family="ui-monospace, monospace">x</text>',
      '<text font-family="system-ui">x</text>',
    ]) {
      expect(withSansFallback(already)).toBe(already);
    }
  });

  test('it is a FALLBACK, not a substitution — the requested family still wins', () => {
    const out = withSansFallback('<text font-family="Hanken Grotesk">x</text>');
    expect(out.indexOf('Hanken Grotesk')).toBeLessThan(out.indexOf('sans-serif'));
  });

  test('it rewrites nothing but font-family', () => {
    const svg = '<svg><rect fill="#fff"/><text font-size="12" font-family="Inter">hi</text></svg>';
    const out = withSansFallback(svg);
    expect(out).toContain('fill="#fff"');
    expect(out).toContain('font-size="12"');
    expect(out).toContain('>hi<');
  });

  test('an unterminated / oversized attribute cannot run away', () => {
    const huge = `<text font-family="${'A'.repeat(500)}">x</text>`;
    expect(withSansFallback(huge)).toBe(huge);
  });
});

describe('--pages contains a page failure instead of losing the rest of the file', () => {
  // Measured on the first live migration: a fault entering page 4 of 6 cost
  // pages 4, 5 and 6 — twice in a row — because the loop caught `too_large`,
  // empty pages and comment failures but NOT a page fetch failure. There is no
  // resume, so the retry re-fetched and re-rendered the three that had already
  // succeeded.
  const PAGES = {
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [
        { id: '1:1', name: 'One', type: 'CANVAS' },
        { id: '2:2', name: 'Two', type: 'CANVAS' },
        { id: '3:3', name: 'Three', type: 'CANVAS' },
      ],
    },
  };
  const PAGE_BODY = (id: string) => ({
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

  /** Page two's document fetch drops the connection; one and three are fine. */
  function stubWithPageTwoDown() {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/images'))
        return new Response(JSON.stringify({ images: {} }), { status: 200 });
      if (url.includes('/comments'))
        return new Response(JSON.stringify({ comments: [] }), { status: 200 });
      if (
        url.includes('depth=1') ||
        /\/files\/[^/]+\?/.test(url) ||
        url.endsWith('/files/2H6a9YUgPAu0AGdEiwP895')
      ) {
        return new Response(JSON.stringify(PAGES), { status: 200 });
      }
      const m = /ids=([^&]+)/.exec(url);
      const id = m ? decodeURIComponent(m[1]) : '';
      if (id.startsWith('2:2')) throw new TypeError('fetch failed');
      if (id) return new Response(JSON.stringify(PAGE_BODY(id)), { status: 200 });
      return new Response(JSON.stringify(PAGES), { status: 200 });
    }) as unknown as typeof fetch;
  }

  test('the pages either side of the fault still import, and the fault is REPORTED', async () => {
    stubWithPageTwoDown();
    const r = await importPages({
      url: 'https://www.figma.com/design/2H6a9YUgPAu0AGdEiwP895/x',
      root: sandbox,
      folder: 'f',
    });
    // Page three is the one the old behaviour lost: it comes AFTER the fault.
    expect(r.written.length).toBeGreaterThanOrEqual(2);
    const failed = r.skipped.find((x: { page?: string }) => x.page === '2:2');
    expect(failed).toBeDefined();
    // Reported by node id + a code-owned reason, never document text (D10).
    expect(String(failed?.why)).toMatch(/^(network|bad_response|failed \(\w+\))$/);
  });

  test('a MISCONFIGURED request stays fatal — a partial folder must not look complete', async () => {
    stubWithPageTwoDown();
    await expect(
      importPages({
        url: 'https://www.figma.com/design/2H6a9YUgPAu0AGdEiwP895/x',
        root: sandbox,
        folder: 'NOT A SLUG',
      })
    ).rejects.toBeInstanceOf(ImportFigmaError);
  });
});

describe('--board writes a sanitized annotation layer', () => {
  test('lands at a code-computed slug under the design root', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    // The slug is the HOST CANVAS's slug — an annotation layer named anything
    // else has nothing to render it (found on the first live board import).
    expect(result.slug).toMatch(/^ui-[a-z0-9_]+$/);
    expect(result.path?.startsWith(join(sandbox, '.design'))).toBe(true);
    expect(existsSync(result.path as string)).toBe(true);
  });

  test('the slug is NEVER derived from a Figma string', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    expect(result.slug).not.toContain('žlu');
    expect(result.slug).not.toContain('<');
    expect(result.slug).toMatch(/^[a-z0-9_-]{1,64}$/);
  });

  test('the written SVG is sanitizer-clean — no markup from the hostile name', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    const svg = boardSvgAt(result.path as string);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('<script');
    expect(svg).not.toMatch(/\son[a-z]+=/i);
  });

  test('a hidden node is not written', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    const svg = boardSvgAt(result.path as string);
    expect(svg).not.toContain('you cannot see me');
  });

  // A FigJam board is not a screen, and framing it as one was wrong twice: the
  // artboard drew screen chrome around whiteboard content, and it took the DS
  // surface colour — which paints a white board near-black on a dark-default
  // design system. Reported from a live migration into `studyfi-design`.
  test('the host canvas has NO artboard — the board is not a screen', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    const tsx = readFileSync(join(sandbox, '.design', result.canvas as string), 'utf8');
    expect(tsx).not.toContain('<DCArtboard');
    expect(tsx).not.toContain('DCArtboard,');
    expect(tsx).toContain('<DesignCanvas />');
  });

  test('the board gets an OPAQUE light paper — a section is only a 6% tint', async () => {
    // `annotations-model.ts` paints a section at a hardcoded fill-opacity of
    // 0.06, so it cannot be the ground: white-at-6% over a dark-default DS is
    // still dark. Measured on the first migration into `studyfi-design`.
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    const svg = boardSvgAt(result.path as string);
    expect(svg).toContain('data-id="figma-board-paper"');
    expect(svg.toLowerCase()).toContain('fill="#ffffff"');
  });

  test('the region is a labelled SECTION, on the annotation layer', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    const svg = boardSvgAt(result.path as string);
    expect(svg).toContain('data-tool="section"');
    expect(svg).toContain('data-id="figma-board-region"');
  });

  test('paint order is paper -> region -> content; either one later would veil the board', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    const svg = boardSvgAt(result.path as string);
    const paper = svg.indexOf('data-id="figma-board-paper"');
    const region = svg.indexOf('data-id="figma-board-region"');
    const firstContent = svg.search(/data-tool="(sticky|image|text|ellipse|arrow)"/);
    expect(paper).toBeGreaterThan(-1);
    expect(paper).toBeLessThan(region);
    if (firstContent > -1) expect(region).toBeLessThan(firstContent);
  });

  test('an explicit --slug is honoured when it is a valid slug', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox, slug: 'retro-q3' });
    // `--slug` names the CANVAS; the annotation layer follows from it.
    expect(result.canvas).toBe('ui/Retro Q3.tsx');
    expect(result.slug).toBe('ui-retro_q3');
    expect(result.path?.endsWith('ui-retro_q3.annotations.json')).toBe(true);
  });

  test.each([
    ['traversal', '../../etc/passwd'],
    ['absolute', '/etc/passwd'],
    ['uppercase + spaces', 'My Board'],
    ['too long', 'a'.repeat(65)],
  ])('a hostile --slug is rejected (%s), nothing is written', async (_label, slug) => {
    await expect(importBoard({ url: BOARD_URL, root: sandbox, slug })).rejects.toBeInstanceOf(
      ImportFigmaError
    );
    expect(readdirSync(join(sandbox, '.design'))).toEqual([]);
  });
});

describe('staging is outside the design root, and leaves nothing behind', () => {
  test('a successful run leaves the layer + its host canvas, and no staging residue', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox });
    const entries = readdirSync(join(sandbox, '.design'));
    expect(entries.sort()).toEqual([`${result.slug}.annotations.json`, 'ui'].sort());
    // The host canvas — without it the strokes are on disk and invisible.
    expect(readdirSync(join(sandbox, '.design', 'ui')).sort()).toEqual([
      'Figjam Em6nowao.meta.json',
      'Figjam Em6nowao.tsx',
    ]);
    // No `.tmp-*` / staging directory anywhere under the design root.
    expect(entries.some((e) => e.startsWith('.tmp') || e.startsWith('maude-figma-'))).toBe(false);
  });

  test('a dry run writes NOTHING but still reports', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox, dryRun: true });
    expect(result.path).toBeUndefined();
    expect(result.strokeCount).toBeGreaterThan(0);
    expect(readdirSync(join(sandbox, '.design'))).toEqual([]);
  });
});

describe('the summary is model input — enum + node ids only (D10)', () => {
  test('names and body text never appear in the summary', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox, dryRun: true });
    const summary = formatSummary(result.report);
    expect(summary).not.toContain('žluťoučký');
    expect(summary).not.toContain('SECRET_BODY_TEXT');
    expect(summary).not.toContain('you cannot see me');
    expect(summary).not.toContain('Persona A');
  });

  test('every non-clean disposition is named by node id and a fixed reason', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox, dryRun: true });
    const summary = formatSummary(result.report);
    // The unmappable shape is reported, not silently dropped.
    expect(summary).toContain('2:40');
    expect(summary).toContain('unmappable-shape');
    // The hidden node is reported too.
    expect(summary).toContain('9:1');
    expect(summary).toContain('hidden-node-skipped');
  });

  test('the origin shift is reported so a huge negative-space board is explicable', async () => {
    const result = await importBoard({ url: BOARD_URL, root: sandbox, dryRun: true });
    expect(result.origin).toEqual({ x: -3244, y: -6272 });
  });
});

// ── --frames (Phase 3) ──────────────────────────────────────────────────────

const DESIGN_DOC = {
  document: {
    id: '0:1',
    name: 'Page 1',
    type: 'CANVAS',
    children: [
      {
        id: '1:2',
        name: 'AL Horizontal (-> flex row)',
        type: 'FRAME',
        layoutMode: 'HORIZONTAL',
        itemSpacing: 16,
        absoluteBoundingBox: box(0, 0, 400, 100),
        children: [
          {
            id: '1:3',
            name: 'Chip One',
            type: 'RECTANGLE',
            absoluteBoundingBox: box(0, 0, 80, 40),
          },
        ],
      },
      {
        id: '2:23',
        name: 'Karta — "uvozovky" / <script> & {curly}',
        type: 'FRAME',
        absoluteBoundingBox: box(500, 0, 400, 300),
        children: [
          {
            id: '2:20',
            name: 'H',
            type: 'TEXT',
            characters: 'Nadpis',
            style: { fontSize: 32 },
            absoluteBoundingBox: box(520, 20, 200, 40),
          },
        ],
      },
      // A loose non-frame node at page level — must not become a canvas.
      { id: '3:1', name: 'stray', type: 'RECTANGLE', absoluteBoundingBox: box(0, 400, 10, 10) },
    ],
  },
};

describe('--frames writes one canvas per top-level frame', () => {
  function stubDesign() {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify(DESIGN_DOC), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as unknown as typeof fetch;
  }

  const URL_D = 'https://www.figma.com/design/dGNzRC2kmrmGnOxaBa0RI7/Fixtures';

  test('emits a .tsx + .meta.json pair per frame, and skips loose nodes', async () => {
    stubDesign();
    const r = await importFrames({ url: URL_D, root: sandbox });
    expect(r.frameCount).toBe(2);
    const files = readdirSync(join(sandbox, '.design', 'ui')).sort();
    expect(files.length).toBe(4);
    expect(files.filter((f) => f.endsWith('.tsx')).length).toBe(2);
    expect(files.filter((f) => f.endsWith('.meta.json')).length).toBe(2);
  });

  test('the meta stamps kind + a real importedAt', async () => {
    stubDesign();
    const r = await importFrames({ url: URL_D, root: sandbox });
    const metaPath = (r.written[0].path as string).replace(/\.tsx$/, '.meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    expect(meta.kind).toBe('imported-figma');
    expect(meta.source.nodeId).toMatch(/^[0-9]+:[0-9]+$/);
    expect(Number.isNaN(Date.parse(meta.source.importedAt))).toBe(false);
  });

  test('a hostile frame name never reaches a FILENAME', async () => {
    stubDesign();
    await importFrames({ url: URL_D, root: sandbox });
    for (const f of readdirSync(join(sandbox, '.design', 'ui'))) {
      expect(f).toMatch(/^[a-z0-9-]+\.(tsx|meta\.json)$/);
    }
  });

  test('a dry run writes nothing but reports metrics', async () => {
    stubDesign();
    const r = await importFrames({ url: URL_D, root: sandbox, dryRun: true });
    expect(r.written[0].metrics.bytes).toBeGreaterThan(0);
    expect(existsSync(join(sandbox, '.design', 'ui'))).toBe(false);
  });

  test('a document with no frame refuses rather than writing an empty canvas', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({ document: { id: '0:1', name: 'P', type: 'CANVAS', children: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as unknown as typeof fetch;
    await expect(importFrames({ url: URL_D, root: sandbox })).rejects.toBeInstanceOf(
      ImportFigmaError
    );
  });
});

// ── --tokens (Phase 4) ──────────────────────────────────────────────────────

describe('--tokens degrades from Variables to styles without surfacing an error', () => {
  const URL_D = 'https://www.figma.com/design/dGNzRC2kmrmGnOxaBa0RI7/Fixtures';

  test('a 403 on the Enterprise-gated Variables endpoint falls back to styles', async () => {
    // This is the COMMON case, not an error state — the dogfood account is Pro.
    let call = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      call += 1;
      const url = String(input);
      if (url.includes('/variables/local')) {
        return new Response(JSON.stringify({ err: 'plan' }), { status: 403 });
      }
      if (url.includes('/styles')) {
        return new Response(
          JSON.stringify({
            meta: {
              styles: [{ key: 'k', name: 'Brand/Primary', style_type: 'FILL', node_id: '1:1' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          nodes: {
            '1:1': {
              document: {
                id: '1:1',
                name: 'swatch',
                type: 'RECTANGLE',
                fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0, a: 1 } }],
              },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const r = await importTokens({ url: URL_D, root: sandbox, dryRun: true });
    expect(r.source).toBe('styles');
    expect(r.count).toBe(1);
    expect(r.tokens).toEqual({ brand: { primary: { $type: 'color', $value: '#ff0000' } } });
    expect(call).toBeGreaterThan(1);
  });

  test('the emitted file is plain JSON, staged outside then promoted', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/variables/local')) return new Response('{}', { status: 403 });
      if (url.includes('/styles')) {
        return new Response(JSON.stringify({ meta: { styles: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await importTokens({ url: URL_D, root: sandbox });
    expect(r.path).toContain('_history');
    expect(() => JSON.parse(readFileSync(r.path as string, 'utf8'))).not.toThrow();
  });
});

describe('the asset pipeline is actually WIRED into --frames', () => {
  const URL_D = 'https://www.figma.com/design/dGNzRC2kmrmGnOxaBa0RI7/Fixtures';

  const VECTOR_DOC = {
    document: {
      id: '0:1',
      name: 'Page 1',
      type: 'CANVAS',
      children: [
        {
          id: '1:1',
          name: 'Frame with a mark',
          type: 'FRAME',
          absoluteBoundingBox: box(0, 0, 400, 300),
          children: [
            {
              id: '2:1',
              name: 'Mark wrapper',
              type: 'GROUP',
              absoluteBoundingBox: box(0, 0, 90, 72),
              children: [
                { id: '2:2', name: 'v', type: 'VECTOR', absoluteBoundingBox: box(0, 0, 20, 20) },
                { id: '2:3', name: 'v', type: 'VECTOR', absoluteBoundingBox: box(20, 0, 20, 20) },
              ],
            },
          ],
        },
      ],
    },
  };

  /** Answer the document, and decline to render anything. */
  function stubDeclineRender() {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/images/')) {
        return new Response(JSON.stringify({ images: { '2:1': null } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(VECTOR_DOC), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  test('a collapsed cluster reaches the image endpoint as ONE batched request', async () => {
    const seen: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/v1/images/')) {
        return new Response(JSON.stringify({ images: { '2:1': null } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(VECTOR_DOC), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const r = await importFrames({ url: URL_D, root: sandbox });
    const imageCalls = seen.filter((u) => u.includes('/v1/images/'));
    const byFormat = (f: string) =>
      imageCalls.filter((u) => new URL(u).searchParams.get('format') === f);

    // ONE call for the whole cluster — the collapse is what keeps this at 1
    // instead of 2 (or, on a real logo, 14). Asserted PER FORMAT, because this
    // stub returns `{ '2:1': null }`, i.e. Figma DECLINING to render, which the
    // later SVG→PNG degradation path answers with a second, legitimate request.
    // The original `imageCalls.length === 1` conflated "the collapse batched the
    // cluster" with "nothing retried", and went red in main when the degradation
    // landed — the same incomplete change that left `asset-degraded` outside the
    // Disposition union (DDR-219 D9). The collapse claim is what this test owns.
    expect(byFormat('svg')).toHaveLength(1);
    expect(new URL(byFormat('svg')[0]).searchParams.get('ids')).toBe('2:1');
    // The degradation is intended behaviour, so it is asserted rather than
    // tolerated: one retry, for the same collapsed id, never one per leaf.
    expect(byFormat('png')).toHaveLength(1);
    expect(new URL(byFormat('png')[0]).searchParams.get('ids')).toBe('2:1');
    expect(r.pendingExports).toBe(1);
  });

  test('an unresolved asset is REPORTED and its placeholder survives in the source', async () => {
    stubDeclineRender();
    const r = await importFrames({ url: URL_D, root: sandbox });
    expect(r.resolvedAssets).toBe(0);
    const tsx = readFileSync(r.written[0].path as string, 'utf8');
    // A visibly broken image beats a silently missing element.
    expect(tsx).toContain('/assets/pending-');
    const dispositions = r.reports.flatMap((rep) => rep.entries.map((e) => e.disposition));
    expect(dispositions).toContain('asset-skipped');
  });

  test('the emitted canvas NEVER references a figma.com URL, resolved or not', async () => {
    stubDeclineRender();
    const r = await importFrames({ url: URL_D, root: sandbox });
    const tsx = readFileSync(r.written[0].path as string, 'utf8');
    expect(tsx).not.toContain('figma.com');
    expect(tsx).not.toMatch(/src="https?:/);
  });
});
