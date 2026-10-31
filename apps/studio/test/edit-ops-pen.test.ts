// S2.14 (ed-pen) — the Pen's path as numbers, its two writers (`object.insert-path`, `path.edit`) and Combine shapes
// (`shape.combine.*`). Plain TSX, tokens only, one write each. The canvas half is test/edit-pen-client.test.tsx.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import {
  insertPoint,
  moveHandle,
  movePoint,
  nearestOnPath,
  type PathModel,
  PathParseError,
  parsePathD,
  pathBounds,
  pointCount,
  pointType,
  removePoint,
  serializePath,
  snap45,
  togglePointType,
} from '../edit-ops/path-model.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

// ── the model ───────────────────────────────────────────────────────────────────────────────

// ed-pen's swoosh, as the canvas draws it
const SWOOSH = 'M120 520 C 200 570, 300 590, 380 570 S 560 500, 640 490 S 820 470, 900 450';
const SWOOSH_CANON =
  'M120 520C200 570 300 590 380 570C460 550 560 500 640 490C720 480 820 470 900 450';

describe('the path model round-trips the SVG d', () => {
  test('a hand-written d reads and writes in the canonical form', () => {
    expect(serializePath(parsePathD(SWOOSH))).toBe(SWOOSH_CANON);
  });

  test('the canonical form is a fixed point, closed paths and straight lines included', () => {
    for (const d of [
      SWOOSH_CANON,
      'M0 0L40 0L40 40L0 40Z',
      'M10 10C20 0 30 0 40 10C50 20 60 20 70 10Z',
      'M0 0L10 10M20 20L30 5',
    ]) {
      expect(serializePath(parsePathD(d))).toBe(d);
      const m = parsePathD(d);
      expect(parsePathD(serializePath(m))).toEqual(m);
    }
  });

  test('relative commands, H V, Q and a duplicated closing point read as absolute cubics / lines', () => {
    expect(serializePath(parsePathD('m10 10 l20 0 v20 h-20 z'))).toBe('M10 10L30 10L30 30L10 30Z');
    expect(serializePath(parsePathD('M0 0L10 0L10 10L0 0Z'))).toBe('M0 0L10 0L10 10Z');
    // Q → the equal cubic: controls two thirds of the way to the quadratic control
    expect(serializePath(parsePathD('M0 0Q30 30 60 0'))).toBe('M0 0C20 20 40 20 60 0');
  });

  test('an arc or a stray token is refused with a PathParseError', () => {
    expect(() => parsePathD('M0 0A10 10 0 0 1 20 20')).toThrow(PathParseError);
    expect(() => parsePathD('hello')).toThrow(PathParseError);
    expect(() => parsePathD('')).toThrow(PathParseError);
  });

  test('bounds are the drawn extremes, not the control hull', () => {
    // a bump whose controls stick out to y=-40 but whose curve peaks at -30
    const b = pathBounds(parsePathD('M0 0C0 -40 100 -40 100 0'));
    expect(b.x).toBe(0);
    expect(b.w).toBe(100);
    expect(b.y).toBeCloseTo(-30, 5);
    expect(b.h).toBeCloseTo(30, 5);
  });
});

describe('point arithmetic', () => {
  const open = (d: string) => parsePathD(d).subs[0] as PathModel['subs'][number];

  test('smooth when the handles mirror through the anchor, sharp when they do not or are absent', () => {
    const s = open('M0 0C10 0 20 10 30 10C40 10 50 0 60 0');
    expect(pointType(s, 0)).toBe('smooth'); // an end with its one handle
    expect(pointType(s, 1)).toBe('smooth');
    expect(pointType(open('M0 0L30 10L60 0'), 1)).toBe('sharp');
    expect(pointType(open('M0 0C10 0 20 10 30 10C40 30 50 0 60 0'), 1)).toBe('sharp');
  });

  test('toggle: smooth → sharp drops the handles; sharp → smooth makes mirrored ones', () => {
    const s = open('M0 0C10 0 20 10 30 10C40 10 50 0 60 0');
    const sharp = togglePointType(s, 1);
    expect(pointType(sharp, 1)).toBe('sharp');
    expect(sharp.points[1]?.in).toBeUndefined();
    expect(sharp.points[1]?.out).toBeUndefined();
    const back = togglePointType(sharp, 1);
    expect(pointType(back, 1)).toBe('smooth');
    // the neighbours' own handles are untouched
    expect(back.points[0]).toEqual(s.points[0]);
  });

  test('point-type toggle round-trips through d: a corner of lines becomes a curve and back to lines', () => {
    const corner = open('M0 0L30 30L60 0');
    expect(pointType(corner, 1)).toBe('sharp');
    const smooth = togglePointType(corner, 1);
    expect(serializePath({ subs: [smooth] })).toContain('C');
    const again = togglePointType(smooth, 1);
    expect(serializePath({ subs: [again] })).toBe('M0 0L30 30L60 0');
  });

  test('moving an anchor takes its handles along; the others stay', () => {
    const s = open('M0 0C10 0 20 10 30 10C40 10 50 0 60 0');
    const moved = movePoint(s, 1, { x: 35, y: 20 });
    expect(moved.points[1]).toEqual({ x: 35, y: 20, in: { x: 25, y: 20 }, out: { x: 45, y: 20 } });
    expect(moved.points[0]).toEqual(s.points[0]);
  });

  test('bending a smooth point turns the other handle opposite (its length kept); ⌥ breaks it', () => {
    const s = open('M0 0C10 0 20 10 30 10C40 10 50 0 60 0');
    const bent = moveHandle(s, 1, 'out', { x: 30, y: 30 });
    expect(bent.points[1]?.out).toEqual({ x: 30, y: 30 });
    expect(bent.points[1]?.in?.x).toBeCloseTo(30, 5);
    expect(bent.points[1]?.in?.y).toBeCloseTo(0, 5); // 10 away on the other side, length kept
    expect(pointType(bent, 1)).toBe('smooth');
    const broken = moveHandle(s, 1, 'out', { x: 30, y: 30 }, true);
    expect(broken.points[1]?.in).toEqual({ x: 20, y: 10 });
    expect(pointType(broken, 1)).toBe('sharp');
  });

  test('a point inserted on a curve keeps the curve; on a line it stays a line', () => {
    const curve = open('M0 0C0 40 100 40 100 0');
    const cut = insertPoint(curve, 0, 0.5);
    expect(pointCount({ subs: [cut] })).toBe(3);
    expect(cut.points[1]?.x).toBeCloseTo(50, 5);
    expect(cut.points[1]?.y).toBeCloseTo(30, 5);
    expect(pathBounds({ subs: [cut] }).h).toBeCloseTo(pathBounds({ subs: [curve] }).h, 5);
    expect(serializePath({ subs: [insertPoint(open('M0 0L100 0'), 0, 0.25)] })).toBe(
      'M0 0L25 0L100 0'
    );
  });

  test('removing a point joins its neighbours; a path of two cannot lose one', () => {
    const s = open('M0 0L10 0L20 10L30 0');
    expect(serializePath({ subs: [removePoint(s, 1) as never] })).toBe('M0 0L20 10L30 0');
    expect(removePoint(open('M0 0L10 0'), 0)).toBeNull();
  });

  test('⇧ snaps a segment to a 45° step at the same length', () => {
    const p = snap45({ x: 0, y: 0 }, { x: 100, y: 30 });
    expect(p.y).toBeCloseTo(0, 5); // 16.7° is nearest 0°
    expect(p.x).toBeCloseTo(Math.hypot(100, 30), 5);
    const q = snap45({ x: 0, y: 0 }, { x: 60, y: 70 });
    expect(q.x).toBeCloseTo(q.y, 5);
  });

  test('the nearest point on the path names the segment and t', () => {
    const m = parsePathD('M0 0L100 0L100 100');
    const hit = nearestOnPath(m, { x: 100, y: 50 });
    expect(hit?.seg).toBe(1);
    expect(hit?.t).toBeCloseTo(0.5, 1);
    expect(hit?.dist).toBeLessThan(0.5);
  });
});

// ── the writers ─────────────────────────────────────────────────────────────────────────────

const FILE = 'ui/Home.tsx';
const HOME = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <section data-cd-id="hero" style={{ width: "600px", height: "400px" }}>
          <div data-cd-id="title">Hello</div>
        </section>
        <div data-cd-id="rectangle" data-shape="rectangle" style={{ position: "absolute", left: "10px", top: "10px", width: "100px", height: "60px", background: "var(--bg-2)" }} />
        <div data-cd-id="ellipse" data-shape="ellipse" style={{ position: "absolute", left: "60px", top: "30px", width: "80px", height: "80px", borderRadius: "50%", background: "var(--accent)" }} />
        <div data-cd-id="line" data-shape="line" style={{ position: "absolute", left: "0px", top: "0px", width: "50px", height: "0", borderTop: "2px solid var(--fg-0)" }} />
        <div data-cd-id="tilted" data-shape="rectangle" style={{ transform: "rotate(10deg)" }} />
        <div data-cd-id="plain" />
        <section data-cd-id="other" style={{ position: "relative" }}>
          <div data-cd-id="inner" data-shape="rectangle" />
        </section>
        <section data-cd-id="empty" style={{ position: "relative", width: "200px", height: "200px" }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial = HOME) {
  const files = new Map<string, string>([[FILE, initial]]);
  const writes: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _before, after) => {
      writes.push(after);
      files.set(rel, after);
    },
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (op: string, targets: string[], params?: Record<string, unknown>) =>
    dispatchEditOp(
      {
        file: FILE,
        op,
        targets: targets.map((element) => ({ artboard: 'desktop', element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  return { files, writes, run, src: () => files.get(FILE) as string };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};

const model = (d: string): PathModel => parsePathD(d);
const element = (src: string, id: string): string => {
  const at = src.indexOf(`data-cd-id="${id}"`);
  const start = src.lastIndexOf('<', at);
  const m = /<(\w+)/.exec(src.slice(start)) as RegExpExecArray;
  const close = src.indexOf(`</${m[1]}>`, at);
  const self = src.indexOf('/>', at);
  const end = m[1] === 'svg' && close > 0 ? close + 6 : self + 2;
  return src.slice(start, end);
};

describe('object.insert-path', () => {
  test('writes one plain <svg> in the artboard: tokens, no hex, a readable id', async () => {
    const h = harness();
    const r = good(
      await h.run('object.insert-path', [], {
        artboard: 'desktop',
        path: model('M100 200L200 100C260 60 320 140 380 200'),
      })
    );
    expect(h.writes).toHaveLength(1);
    expect(r.created).toEqual([{ artboard: 'desktop', element: 'path' }]);
    const svg = element(h.src(), 'path');
    expect(svg).toBe(
      '<svg data-cd-id="path" data-shape="path" width="280" height="110.77" viewBox="0 0 280 110.77" ' +
        'style={{ position: "absolute", left: "100px", top: "89.23px", overflow: "visible", fill: "none", ' +
        'stroke: "var(--accent, currentColor)", strokeWidth: "4px", strokeLinecap: "round", strokeLinejoin: "round" }}>' +
        '<path d="M0 110.77L100 10.77C160 -29.23 220 50.77 280 110.77" /></svg>'
    );
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  test('into a frame: that frame is the parent; a static one is pinned relative; a second path gets a new id', async () => {
    const h = harness();
    await h.run('object.insert-path', ['hero'], {
      artboard: 'desktop',
      relativeParent: true,
      path: model('M0 0L50 50'),
    });
    expect(h.src()).toMatch(/data-cd-id="hero" style=\{\{[^}]*position: "relative"/);
    const hero = h.src().slice(h.src().indexOf('data-cd-id="hero"'), h.src().indexOf('</section>'));
    expect(hero).toContain('data-cd-id="path"');
    const r = good(
      await h.run('object.insert-path', ['hero'], { artboard: 'desktop', path: model('M0 0L9 9') })
    );
    expect(r.created?.[0]?.element).toBe('path-2');
  });

  test('refuses a path of one point, a non-finite number, and an unknown artboard — nothing written', async () => {
    const h = harness();
    bad(await h.run('object.insert-path', [], { artboard: 'desktop', path: model('M0 0') }));
    bad(
      await h.run('object.insert-path', [], {
        artboard: 'desktop',
        path: {
          subs: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: Number.NaN, y: 1 },
              ],
            },
          ],
        },
      })
    );
    bad(await h.run('object.insert-path', [], { artboard: 'nope', path: model('M0 0L1 1') }));
    expect(h.writes).toHaveLength(0);
  });
});

describe('path.edit', () => {
  const draw = async () => {
    const h = harness();
    await h.run('object.insert-path', [], {
      artboard: 'desktop',
      path: model('M100 200L200 100C260 60 320 140 380 200'),
    });
    return h;
  };

  test('rewrites d, the box and left / top — one write — and nothing else', async () => {
    const h = await draw();
    const before = h.src();
    // pull the middle anchor up and left: the box grows up and left, every point keeps its container position
    const next = model('M100 200L150 20C260 60 320 140 380 200');
    good(await h.run('path.edit', ['path'], { path: next }));
    expect(h.writes).toHaveLength(2);
    const svg = element(h.src(), 'path');
    expect(svg).toContain('left: "100px", top: "20px"');
    expect(svg).toContain('width="280" height="180" viewBox="0 0 280 180"');
    expect(svg).toContain('<path d="M0 180L50 0C160 40 220 120 280 180" />');
    // everything outside the svg is byte-identical
    const cut = (s: string) => s.replace(element(s, 'path'), '');
    expect(cut(h.src())).toBe(cut(before));
  });

  test('a straight horizontal line keeps a 1px box (an svg of height 0 would not paint)', async () => {
    const h = await draw();
    good(await h.run('path.edit', ['path'], { path: model('M10 50L110 50') }));
    expect(element(h.src(), 'path')).toContain('width="100" height="1" viewBox="0 0 100 1"');
  });

  test('refuses what is not a Pen path, and a path whose d the file computes', async () => {
    const h = await draw();
    bad(await h.run('path.edit', ['plain'], { path: model('M0 0L1 1') }));
    bad(await h.run('path.edit', ['rectangle'], { path: model('M0 0L1 1') }));
    const computed = harness(
      HOME.replace(
        '<div data-cd-id="plain" />',
        '<svg data-cd-id="calc" data-shape="path"><path d={PATH} /></svg>'
      )
    );
    bad(await computed.run('path.edit', ['calc'], { path: model('M0 0L1 1') }));
    bad(await h.run('path.edit', ['path'], { path: { subs: [] } }));
  });
});

// ── Combine ─────────────────────────────────────────────────────────────────────────────────

const OPERANDS = [
  { x: 10, y: 10, w: 100, h: 60, radii: [0, 0, 0, 0] }, // rectangle
  { x: 60, y: 30, w: 80, h: 80 }, // ellipse
];

describe('shape.combine', () => {
  test('union: one <path> of both outlines, nonzero; the operands go; one write', async () => {
    const h = harness();
    const r = good(
      await h.run('shape.combine.union', ['rectangle', 'ellipse'], { operands: OPERANDS })
    );
    expect(h.writes).toHaveLength(1);
    expect(r.created).toEqual([{ artboard: 'desktop', element: 'union' }]);
    expect(h.src()).not.toContain('data-cd-id="rectangle"');
    expect(h.src()).not.toContain('data-cd-id="ellipse"');
    const svg = element(h.src(), 'union');
    expect(svg).toContain('data-shape="path" data-combine="union"');
    expect(svg).toContain('width="130" height="100" viewBox="0 0 130 100"');
    expect(svg).toContain('left: "10px", top: "10px"');
    expect(svg).toContain('fill: "var(--bg-2)"'); // the bottom shape's token
    expect(svg).toMatch(/<path d="M0 0L100 0L100 60L0 60ZM[^"]+Z" fillRule="nonzero" \/>/);
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  test('exclude: the same outlines, evenodd', async () => {
    const h = harness();
    good(await h.run('shape.combine.exclude', ['rectangle', 'ellipse'], { operands: OPERANDS }));
    expect(element(h.src(), 'exclude')).toContain('fillRule="evenodd"');
  });

  test('subtract: the bottom shape stays the first <path>; a mask holds white and the others in black', async () => {
    const h = harness();
    good(await h.run('shape.combine.subtract', ['rectangle', 'ellipse'], { operands: OPERANDS }));
    const svg = element(h.src(), 'subtract');
    expect(
      svg.indexOf('<path d="M0 0L100 0L100 60L0 60Z" mask="url(#subtract-mask)" />')
    ).toBeGreaterThan(-1);
    expect(svg).toContain('<mask id="subtract-mask" maskUnits="userSpaceOnUse"');
    expect(svg).toContain('fill="white"');
    expect(svg).toContain('fill="black"');
    // the base path comes before <defs>: path.edit and the Pen reach it first
    expect(svg.indexOf('<path')).toBeLessThan(svg.indexOf('<defs>'));
  });

  test('intersect: the bottom shape is clipped by each other shape; three shapes nest', async () => {
    const h = harness();
    good(await h.run('shape.combine.intersect', ['rectangle', 'ellipse'], { operands: OPERANDS }));
    const svg = element(h.src(), 'intersect');
    expect(svg).toContain('clipPath="url(#intersect-clip-1)"');
    expect(svg).toContain('<clipPath id="intersect-clip-1"><path d=');
  });

  test('intersect of three: the second clip wraps the first in a <g>', async () => {
    const three = harness(
      HOME.replace(
        '<div data-cd-id="line"',
        '<div data-cd-id="third" data-shape="rectangle" style={{ position: "absolute", background: "var(--fg-1)" }} /><div data-cd-id="line"'
      )
    );
    good(
      await three.run('shape.combine.intersect', ['rectangle', 'ellipse', 'third'], {
        operands: [...OPERANDS, { x: 30, y: 20, w: 60, h: 60 }],
      })
    );
    const svg = element(three.src(), 'intersect');
    expect(svg).toContain('<g clipPath="url(#intersect-clip-2)"><path d=');
    expect(svg).toContain('<clipPath id="intersect-clip-2">');
  });

  test('the Pen can edit what Combine made: its first <path> is the one path.edit rewrites', async () => {
    const h = harness();
    good(await h.run('shape.combine.union', ['rectangle', 'ellipse'], { operands: OPERANDS }));
    good(await h.run('path.edit', ['union'], { path: model('M10 10L50 10L50 50Z') }));
    expect(element(h.src(), 'union')).toContain('<path d="M0 0L40 0L40 40Z" fillRule="nonzero" />');
  });

  test('refuses fewer than two, a line, a frame, a rotated shape, shapes in different frames, a missing measure', async () => {
    const h = harness();
    const run = (ids: string[], operands = [...OPERANDS, OPERANDS[0]]) =>
      h.run('shape.combine.union', ids, { operands });
    expect(bad(await run(['rectangle'])).message).toMatch(/two or more/i);
    expect(bad(await run(['rectangle', 'line'])).message).toMatch(/line/i);
    expect(bad(await run(['rectangle', 'plain'])).message).toMatch(/shapes and paths/i);
    expect(bad(await run(['rectangle', 'tilted'])).message).toMatch(/rotation/i);
    expect(bad(await run(['rectangle', 'inner'])).message).toMatch(/same frame/i);
    expect(bad(await h.run('shape.combine.union', ['rectangle', 'ellipse'], {})).message).toMatch(
      /measure/i
    );
    expect(h.writes).toHaveLength(0);
  });

  test('a Pen path can be an operand: its d is read from the file and placed by its measured origin', async () => {
    const h = harness();
    await h.run('object.insert-path', [], {
      artboard: 'desktop',
      path: model('M100 100L160 100L160 160L100 160Z'),
    });
    good(
      await h.run('shape.combine.union', ['rectangle', 'path'], {
        operands: [OPERANDS[0], { x: 100, y: 100, w: 60, h: 60 }],
      })
    );
    expect(element(h.src(), 'union')).toContain('width="150" height="150"');
  });
});

// ── render: the output is the same picture after export ─────────────────────────────────────

const rsvg = spawnSync('rsvg-convert', ['--version']);
const haveRsvg = rsvg.status === 0 && spawnSync('magick', ['-version']).status === 0;

/** The combine output as standalone SVG markup (what export writes): JSX attribute names → SVG, style object → CSS. */
function exported(jsx: string): string {
  return jsx
    .replace(/ data-[a-z-]+="[^"]*"/g, '')
    .replace(/style=\{\{.*?\}\}/, 'style="overflow:visible;fill:#2a6"')
    .replace(/fillRule=/g, 'fill-rule=')
    .replace(/clipPath="url/g, 'clip-path="url')
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
}

function raster(dir: string, name: string, svg: string): string {
  const svgPath = join(dir, `${name}.svg`);
  const pngPath = join(dir, `${name}.png`);
  writeFileSync(svgPath, svg);
  const r = spawnSync('rsvg-convert', [
    '-w',
    '260',
    '-h',
    '200',
    '-b',
    'white',
    '-o',
    pngPath,
    svgPath,
  ]);
  if (r.status !== 0) throw new Error(`rsvg-convert: ${r.stderr}`);
  return pngPath;
}

describe.skipIf(!haveRsvg)(
  'Combine output renders identically to the same composition drawn with primitives',
  () => {
    // The reference draws a <rect> and an <ellipse> with the renderer's own primitives and combines them the same way
    // the spec says (mask / clip-path / evenodd); the output must match pixel for pixel (a sliver at curve edges allowed).
    const dir = mkdtempSync(join(tmpdir(), 'maude-combine-'));
    const P = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="130" height="100" viewBox="0 0 130 100" style="overflow:visible;fill:#2a6">${inner}</svg>`;
    const RECT = '<rect x="0" y="0" width="100" height="60"/>';
    const ELL = '<ellipse cx="90" cy="60" rx="40" ry="40"/>';
    const reference: Record<string, string> = {
      union: P(`${RECT}${ELL}`),
      exclude: P(
        `<path fill-rule="evenodd" d="M0 0H100V60H0Z M50 60a40 40 0 1 0 80 0a40 40 0 1 0 -80 0"/>`
      ),
      subtract: P(
        `<mask id="m" maskUnits="userSpaceOnUse" x="-200" y="-200" width="530" height="500"><rect x="-200" y="-200" width="530" height="480" fill="white"/><ellipse cx="90" cy="60" rx="40" ry="40" fill="black"/></mask><rect width="100" height="60" mask="url(#m)"/>`
      ),
      intersect: P(
        `<clipPath id="c"><ellipse cx="90" cy="60" rx="40" ry="40"/></clipPath><rect width="100" height="60" clip-path="url(#c)"/>`
      ),
    };
    for (const kind of ['union', 'exclude', 'subtract', 'intersect'] as const) {
      test(kind, async () => {
        const h = harness();
        good(
          await h.run(`shape.combine.${kind}`, ['rectangle', 'ellipse'], { operands: OPERANDS })
        );
        const ours = exported(element(h.src(), kind));
        const a = raster(dir, `${kind}-ours`, ours);
        const b = raster(dir, `${kind}-ref`, reference[kind] as string);
        const cmp = spawnSync('magick', [
          'compare',
          '-metric',
          'AE',
          '-fuzz',
          '12%',
          a,
          b,
          'null:',
        ]);
        const diff = Number.parseFloat(`${cmp.stderr}`.trim().split(' ')[0] ?? 'NaN');
        expect(diff).toBeLessThan(40); // 40 of 20 800 px: the cubic circle vs the true one at the rim
        // and it actually painted something
        const ink = spawnSync('magick', [
          a,
          '-fuzz',
          '12%',
          '-fill',
          'black',
          '-opaque',
          '#2a6',
          '-format',
          '%[fx:mean]',
          'info:',
        ]);
        expect(Number.parseFloat(`${ink.stdout}`)).toBeLessThan(0.98);
      });
    }
  }
);
