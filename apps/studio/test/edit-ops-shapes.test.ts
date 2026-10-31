// S2.13 (ed-shape) — the Frame / Shape tools' drag ends in ONE edit-op (`object.insert-shape`, `artboard.draw`) and
// the corner dot's drag in another (`object.set-corner-radius`): one write, one undo step, plain TSX, tokens only.
// Goldens per kind and per corner; the canvas half is test/edit-shapes-client.test.tsx.

import { describe, expect, test } from 'bun:test';

import { readAttributeState } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { polygonClip } from '../edit-ops/insert-shape.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult, LayoutPatch } from '../edit-ops/types.ts';
import { walkIdElements } from '../element-ids.ts';

const FILE = 'ui/Home.tsx';

const HOME = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <section data-cd-id="hero" style={{ width: "600px", height: "400px" }}>
          <div data-cd-id="title">Hello</div>
        </section>
        <section data-cd-id="empty" style={{ position: "relative", width: "200px", height: "200px" }} />
        <section data-cd-id="locker" data-cd-locked="true" />
        <div data-cd-id="round" style={{ borderRadius: "8px", width: "100px", height: "100px" }} />
        <div data-cd-id="four" style={{ borderRadius: "var(--radius-md) 4px 0 var(--radius-sm)" }} />
        <div data-cd-id="bare" />
        <div data-cd-id="calc" style={{ borderRadius: styles.r }} />
      </DCArtboard>
      <DCArtboard id="mobile" label="Mobile" width={390} height={800}></DCArtboard>
    </DesignCanvas>
  );
}
const styles = { r: "4px" };
`;

function harness(initial = HOME) {
  const files = new Map<string, string>([[FILE, initial]]);
  const snapshots: string[] = [];
  const layouts: LayoutPatch[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, before, after) => {
      snapshots.push(before);
      files.set(rel, after);
    },
    writeLayout: async (_rel, patch) => {
      layouts.push(patch);
    },
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (
    op: string,
    targets: string[],
    params?: Record<string, unknown>,
    artboard = 'desktop'
  ) =>
    dispatchEditOp(
      {
        file: FILE,
        op,
        targets: targets.map((element) => ({ artboard, element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  return { files, snapshots, layouts, deps, run, src: () => files.get(FILE) as string };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const style = (src: string, id: string, prop: string) => {
  const s = readAttributeState(FILE, src, id, `style.${prop}`);
  return s.kind === 'literal' ? s.value : s.kind;
};
const BOX = { x: 40, y: 24, w: 216, h: 216 };
const draw = { artboard: 'desktop', rect: BOX };

describe('the ops are in the table', () => {
  test.each(['object.insert-shape', 'artboard.draw', 'object.set-corner-radius'])('%s', (id) => {
    expect(EDIT_OPS.some((o) => o.id === id)).toBe(true);
  });
});

describe('object.insert-shape', () => {
  test('a rectangle into an artboard: one write, a readable id, data-shape, tokens only', async () => {
    const h = harness();
    const r = good(await h.run('object.insert-shape', [], { ...draw, kind: 'rectangle' }));
    expect(h.snapshots).toHaveLength(1);
    expect(h.snapshots[0]).toBe(HOME);
    expect(r.created).toEqual([{ artboard: 'desktop', element: 'rectangle' }]);
    expect(h.src()).toContain('data-cd-id="rectangle" data-shape="rectangle"');
    expect(style(h.src(), 'rectangle', 'position')).toBe('absolute');
    expect(style(h.src(), 'rectangle', 'left')).toBe('40px');
    expect(style(h.src(), 'rectangle', 'top')).toBe('24px');
    expect(style(h.src(), 'rectangle', 'width')).toBe('216px');
    expect(style(h.src(), 'rectangle', 'height')).toBe('216px');
    expect(style(h.src(), 'rectangle', 'background')).toBe('var(--accent, currentColor)');
    // it landed inside the desktop artboard, not the mobile one
    const walk = walkIdElements(h.src(), FILE);
    if (!walk.ok) throw new Error('parse');
    expect(walk.elements.find((e) => e.id === 'rectangle')?.artboard).toBe('desktop');
    expect(h.src()).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  test('a second one gets the next id; undo (one writeId) restores the file', async () => {
    const h = harness();
    good(await h.run('object.insert-shape', [], { ...draw, kind: 'rectangle' }));
    const second = good(await h.run('object.insert-shape', [], { ...draw, kind: 'rectangle' }));
    expect(second.created?.[0]?.element).toBe('rectangle-2');
    const undo = good(
      await dispatchEditOp(
        { file: FILE, op: 'revert', targets: [], params: { writeId: second.writeId } },
        h.deps
      )
    );
    expect(undo.ok).toBe(true);
    expect(h.src()).not.toContain('rectangle-2');
    expect(h.src()).toContain('data-cd-id="rectangle"');
  });

  test('a frame has no data-shape and a surface fill token', async () => {
    const h = harness();
    good(await h.run('object.insert-shape', [], { ...draw, kind: 'frame' }));
    expect(h.src()).toContain('data-cd-id="frame"');
    expect(h.src()).not.toContain('data-shape="frame"');
    expect(style(h.src(), 'frame', 'background')).toBe('var(--bg-1)');
  });

  test('into a frame (target): last child, the frame untouched unless it is static', async () => {
    const h = harness();
    good(
      await h.run('object.insert-shape', ['hero'], {
        ...draw,
        kind: 'ellipse',
        relativeParent: true,
      })
    );
    expect(h.src()).toMatch(/<div data-cd-id="title">Hello<\/div>\s*<div data-cd-id="ellipse"/);
    expect(style(h.src(), 'ellipse', 'borderRadius')).toBe('50%');
    // hero was static: now relative so left/top mean what they say
    expect(style(h.src(), 'hero', 'position')).toBe('relative');
    expect(style(h.src(), 'hero', 'width')).toBe('600px');
  });

  test('a self-closing frame opens up to take its child', async () => {
    const h = harness();
    good(await h.run('object.insert-shape', ['empty'], { ...draw, kind: 'rectangle' }));
    expect(h.src()).toMatch(
      /<section data-cd-id="empty"[^>]*>\s*<div data-cd-id="rectangle"[^>]*\/>\s*<\/section>/
    );
  });

  test('an empty artboard takes it too', async () => {
    const h = harness();
    good(
      await h.run(
        'object.insert-shape',
        [],
        { artboard: 'mobile', rect: BOX, kind: 'frame' },
        'mobile'
      )
    );
    expect(h.src()).toMatch(/<DCArtboard id="mobile"[^>]*>\s*<div data-cd-id="frame"/);
  });

  test('a line is a rotated hairline from its first point', async () => {
    const h = harness();
    good(
      await h.run('object.insert-shape', [], {
        artboard: 'desktop',
        kind: 'line',
        line: { x1: 10, y1: 20, x2: 10, y2: 120 },
      })
    );
    expect(style(h.src(), 'line', 'left')).toBe('10px');
    expect(style(h.src(), 'line', 'top')).toBe('20px');
    expect(style(h.src(), 'line', 'width')).toBe('100px');
    expect(style(h.src(), 'line', 'height')).toBe('0');
    expect(style(h.src(), 'line', 'borderTop')).toBe('2px solid var(--fg-0, currentColor)');
    expect(style(h.src(), 'line', 'transform')).toBe('rotate(90deg)');
    expect(h.src()).toContain('data-shape="line"');
  });

  test('a horizontal line needs no rotation', async () => {
    const h = harness();
    good(
      await h.run('object.insert-shape', [], {
        artboard: 'desktop',
        kind: 'line',
        line: { x1: 0, y1: 5, x2: 80, y2: 5 },
      })
    );
    expect(style(h.src(), 'line', 'transform')).toBe('absent');
  });

  test('a polygon is a clip-path of N points, the first at the top', async () => {
    const h = harness();
    good(await h.run('object.insert-shape', [], { ...draw, kind: 'polygon', sides: 3 }));
    expect(style(h.src(), 'polygon', 'clipPath')).toBe(polygonClip(3));
    expect(polygonClip(3)).toBe('polygon(50% 0%, 93.3% 75%, 6.7% 75%)');
    expect(h.src()).toContain('data-shape="polygon"');
  });

  test('refused, nothing written: a speck, a bad kind, a bad side count, a locked frame, a missing frame', async () => {
    const h = harness();
    bad(
      await h.run('object.insert-shape', [], {
        artboard: 'desktop',
        kind: 'rectangle',
        rect: { x: 0, y: 0, w: 0, h: 5 },
      })
    );
    bad(await h.run('object.insert-shape', [], { ...draw, kind: 'star' }));
    bad(await h.run('object.insert-shape', [], { ...draw, kind: 'polygon', sides: 2 }));
    expect(
      bad(await h.run('object.insert-shape', ['locker'], { ...draw, kind: 'frame' })).code
    ).toBe('locked');
    bad(await h.run('object.insert-shape', ['nope'], { ...draw, kind: 'frame' }));
    expect(h.snapshots).toHaveLength(0);
    expect(h.src()).toBe(HOME);
  });
});

describe('artboard.draw', () => {
  test('a Fixed size artboard of the drawn size, its place in the layout lane, one write', async () => {
    const h = harness();
    const r = good(await h.run('artboard.draw', [], { rect: { x: 1600, y: 80, w: 390, h: 844 } }));
    expect(h.snapshots).toHaveLength(1);
    expect(r.created).toEqual([{ artboard: 'artboard-3', element: 'artboard-3' }]);
    const tag = /<DCArtboard\b[^>]*\bid="artboard-3"[^>]*>/.exec(h.src())?.[0] ?? '';
    for (const part of ['label="Artboard 3"', 'width={390}', 'height={844}', 'kind="digital"'])
      expect(tag).toContain(part);
    expect(tag).toMatch(/\bfixed\b/);
    expect(h.layouts).toEqual([{ set: [{ id: 'artboard-3', x: 1600, y: 80 }] }]);
  });

  test('a speck is floored at the smallest artboard', async () => {
    const h = harness();
    good(await h.run('artboard.draw', [], { rect: { x: 0, y: 0, w: 5, h: 5 } }));
    expect(h.src()).toMatch(/id="artboard-3"[^>]*width=\{64\} height=\{64\}/);
  });
});

describe('object.set-corner-radius — goldens per corner', () => {
  test('all four, a number: one value', async () => {
    const h = harness();
    good(await h.run('object.set-corner-radius', ['bare'], { corner: 'all', radius: { px: 12 } }));
    expect(style(h.src(), 'bare', 'border-radius')).toBe('12px');
  });

  test.each([
    ['tl', '8px 0 0 0'],
    ['tr', '0 8px 0 0'],
    ['br', '0 0 8px 0'],
    ['bl', '0 0 0 8px'],
  ])('only %s on a square object writes the four values in CSS order', async (corner, css) => {
    const h = harness();
    good(await h.run('object.set-corner-radius', ['bare'], { corner, radius: { px: 8 } }));
    expect(style(h.src(), 'bare', 'border-radius')).toBe(css);
  });

  test('one corner of a linked 8px object keeps the other three at 8', async () => {
    const h = harness();
    good(await h.run('object.set-corner-radius', ['round'], { corner: 'bl', radius: { px: 2 } }));
    expect(style(h.src(), 'round', 'border-radius')).toBe('8px 8px 8px 2px');
  });

  test('unlinked corners keep their tokens; one changes; the longhands never appear', async () => {
    const h = harness();
    good(
      await h.run('object.set-corner-radius', ['four'], {
        corner: 'br',
        radius: { token: '--radius-lg' },
      })
    );
    expect(style(h.src(), 'four', 'border-radius')).toBe(
      'var(--radius-md) 4px var(--radius-lg) var(--radius-sm)'
    );
    expect(h.src()).not.toContain('border-top-left-radius');
  });

  test('all four set again re-links them', async () => {
    const h = harness();
    good(
      await h.run('object.set-corner-radius', ['four'], {
        corner: 'all',
        radius: { token: '--radius-md' },
      })
    );
    expect(style(h.src(), 'four', 'border-radius')).toBe('var(--radius-md)');
  });

  test('zero on all four takes the declaration out', async () => {
    const h = harness();
    good(await h.run('object.set-corner-radius', ['round'], { corner: 'all', radius: { px: 0 } }));
    expect(style(h.src(), 'round', 'border-radius')).toBe('absent');
  });

  test('the same value writes nothing (one undo step is never empty)', async () => {
    const h = harness();
    good(await h.run('object.set-corner-radius', ['round'], { corner: 'tl', radius: { px: 8 } }));
    expect(h.snapshots).toHaveLength(0);
  });

  test('refused: a raw string, a negative, a token of another family, a computed radius, a locked object', async () => {
    const h = harness();
    bad(
      await h.run('object.set-corner-radius', ['bare'], {
        corner: 'all',
        radius: { css: '4px / 8px' },
      })
    );
    bad(await h.run('object.set-corner-radius', ['bare'], { corner: 'all', radius: { px: -1 } }));
    bad(
      await h.run('object.set-corner-radius', ['bare'], {
        corner: 'all',
        radius: { token: '--space-4' },
      })
    );
    bad(await h.run('object.set-corner-radius', ['bare'], { corner: 'nw', radius: { px: 4 } }));
    bad(await h.run('object.set-corner-radius', ['calc'], { corner: 'all', radius: { px: 4 } }));
    bad(await h.run('object.set-corner-radius', [], { corner: 'all', radius: { px: 4 } }));
    expect(h.src()).toBe(HOME);
  });
});

// S2.22 G8 — a frame that several artboards share cannot take one drawing for one artboard: the op addresses source,
// not an instance, so it refuses in CONTRACT words (what happened · what is safe · one verb) and writes nothing.
describe('drawing onto a component shared by several artboards', () => {
  const SHARED = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
function Card() {
  return <div data-cd-id="card" style={{ width: "300px", height: "300px" }} />;
}
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}><Card /></DCArtboard>
      <DCArtboard id="mobile" label="Mobile" width={390} height={800}><Card /></DCArtboard>
    </DesignCanvas>
  );
}
`;
  const draw = { artboard: 'mobile', rect: { x: 10, y: 10, w: 100, h: 100 } };

  test('a shape: refused in the contract words, nothing written', async () => {
    const h = harness(SHARED);
    const r = await h.run(
      'object.insert-shape',
      ['card'],
      { ...draw, kind: 'rectangle' },
      'mobile'
    );
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toBe(
      'That frame is shared by several artboards, so a drawing would appear in all of them. Nothing was drawn. Detach it to draw on this artboard only.'
    );
    expect(h.snapshots).toHaveLength(0);
    expect(h.src()).toBe(SHARED);
  });
});

describe('G5 — a corner dot on a freshly drawn shape writes React style keys', () => {
  test('a new radius is `borderRadius`, not a quoted kebab key', async () => {
    const h = harness();
    good(await h.run('object.insert-shape', [], { ...draw, kind: 'rectangle' }));
    good(
      await h.run('object.set-corner-radius', ['rectangle'], {
        corner: 'all',
        radius: { token: '--radius-md' },
      })
    );
    expect(h.src()).toContain('borderRadius: "var(--radius-md)"');
    expect(h.src()).not.toContain('"border-radius"');
    expect(style(h.src(), 'rectangle', 'border-radius')).toBe('var(--radius-md)');
  });

  test('a file that already says "border-radius" keeps that key (no second one)', async () => {
    const h = harness(HOME.replace('borderRadius: "8px"', '"border-radius": "8px"'));
    good(await h.run('object.set-corner-radius', ['round'], { corner: 'all', radius: { px: 12 } }));
    expect(h.src()).toContain('"border-radius": "12px"');
    expect(
      h
        .src()
        .match(/<div data-cd-id="round"[^>]*>/)?.[0]
        .match(/adius/g)?.length
    ).toBe(1);
  });
});
