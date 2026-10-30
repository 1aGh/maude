// S2.10 — `artboard.duplicate` / `artboard.duplicate-at-width` through the one dispatch route (S2-edit-ops.md):
// ⌘D, the ⌥-drag and the artboard menu write ONE copy into the versioned file — fresh artboard id, fresh label,
// no element id or lock inherited (V2-1.4 §5.2) — and its position into the layout lane in the same request.
// Pure dispatcher harness (no server), the shape of v2-artboard-resize-op.test.ts.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applySetArtboardLabel } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { artboardLabels, copyId, copyName } from '../edit-ops/duplicate-at-width.ts';
import { mergeLayout } from '../edit-ops/layout-patch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult, LayoutPatch } from '../edit-ops/types.ts';
import { createEditRoutes } from '../routes/edit.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900} kind="web">
        <section data-cd-id="hero" data-cd-locked>Hello</section>
        <p data-cd-id="intro">World</p>
      </DCArtboard>
      <DCArtboard id="mobile" label="Příběh" width={390} height={844} fixed>
        <p>Hi</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(withLayout = true) {
  const files = new Map<string, string>([[FILE, SRC]]);
  const events: string[] = [];
  const layouts: LayoutPatch[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after, label) => {
      files.set(rel, after);
      events.push(`write:${label}`);
    },
    heldByAi: () => null,
    log: createWriteLog(),
    ...(withLayout
      ? {
          writeLayout: async (_rel: string, patch: LayoutPatch) => {
            layouts.push(patch);
            events.push('layout');
          },
        }
      : {}),
  };
  return {
    files,
    events,
    layouts,
    run: (op: string, params: Record<string, unknown>) =>
      dispatchEditOp({ file: FILE, op, targets: [], params }, deps),
  };
}
const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};

describe('artboard.duplicate', () => {
  test('both ops are in the op table the route dispatches', () => {
    expect(EDIT_OPS.some((o) => o.id === 'artboard.duplicate')).toBe(true);
    expect(EDIT_OPS.some((o) => o.id === 'artboard.duplicate-at-width')).toBe(true);
  });

  test('⌘D writes a "Desktop 2" right after its source: new id, same width, own position', async () => {
    const h = harness();
    const r = ok(
      await h.run('artboard.duplicate', {
        items: [{ artboard: 'desktop', at: { x: 1520, y: 0 } }],
      })
    );
    const out = h.files.get(FILE) as string;
    expect(out).toContain(
      '<DCArtboard id="desktop-2" label="Desktop 2" width={1440} height={900} kind="web">'
    );
    // spliced after the source, before the next artboard
    expect(out.indexOf('id="desktop-2"')).toBeGreaterThan(out.indexOf('id="desktop"'));
    expect(out.indexOf('id="desktop-2"')).toBeLessThan(out.indexOf('id="mobile"'));
    expect(r.created).toEqual([{ artboard: 'desktop-2', element: 'desktop-2' }]);
    expect(h.layouts).toEqual([{ set: [{ id: 'desktop-2', x: 1520, y: 0 }] }]);
  });

  test('the copy inherits no element id and no lock; the original keeps both', async () => {
    const h = harness();
    ok(await h.run('artboard.duplicate', { items: [{ artboard: 'desktop' }] }));
    const out = h.files.get(FILE) as string;
    const copy = out.slice(out.indexOf('id="desktop-2"'), out.indexOf('id="mobile"'));
    expect(copy).not.toContain('data-cd-id');
    expect(copy).not.toContain('data-cd-locked');
    expect(copy).toContain('<section>Hello</section>');
    const original = out.slice(out.indexOf('id="desktop"'), out.indexOf('id="desktop-2"'));
    expect(original).toContain('data-cd-id="hero" data-cd-locked');
    expect(original).toContain('data-cd-id="intro"');
  });

  test('one request is one source write, and the layout lane is written first', async () => {
    const h = harness();
    ok(await h.run('artboard.duplicate', { items: [{ artboard: 'desktop', at: { x: 1, y: 2 } }] }));
    expect(h.events).toEqual(['layout', 'write:pre-artboard.duplicate']);
  });

  test('pressing it again keeps counting: Desktop 3, then a copy of the copy', async () => {
    const h = harness();
    ok(await h.run('artboard.duplicate', { items: [{ artboard: 'desktop' }] }));
    ok(await h.run('artboard.duplicate', { items: [{ artboard: 'desktop-2' }] }));
    const labels = artboardLabels(h.files.get(FILE) as string);
    expect([...labels.entries()]).toEqual([
      ['desktop', 'Desktop'],
      ['desktop-2', 'Desktop 2'],
      ['desktop-3', 'Desktop 3'],
      ['mobile', 'Příběh'],
    ]);
  });

  test('a Czech name keeps every háček and a number is appended', async () => {
    const h = harness();
    ok(await h.run('artboard.duplicate', { items: [{ artboard: 'mobile' }] }));
    expect(h.files.get(FILE)).toContain('label="Příběh 2"');
    expect(copyName('Příběh', new Set(['Příběh', 'Příběh 2']))).toBe('Příběh 3');
  });

  test('several artboards copy in one write, each landing where it was told', async () => {
    const h = harness();
    ok(
      await h.run('artboard.duplicate', {
        items: [
          { artboard: 'desktop', at: { x: 10, y: 20 } },
          { artboard: 'mobile', at: { x: 30, y: 40 } },
        ],
      })
    );
    expect(h.events.filter((e) => e.startsWith('write'))).toHaveLength(1);
    expect(h.layouts[0]?.set).toEqual([
      { id: 'desktop-2', x: 10, y: 20 },
      { id: 'mobile-2', x: 30, y: 40 },
    ]);
  });

  test('boards that still sit on the default grid are pinned, so the spliced copy cannot shift them', async () => {
    const h = harness();
    ok(
      await h.run('artboard.duplicate', {
        items: [{ artboard: 'desktop', at: { x: 1520, y: 0 } }],
        pin: [{ id: 'mobile', x: 1520, y: 0 }],
      })
    );
    expect(h.layouts[0]?.pin).toEqual([{ id: 'mobile', x: 1520, y: 0 }]);
  });

  test('refuses what is not on the canvas, writes nothing', async () => {
    const h = harness();
    const r = await h.run('artboard.duplicate', { items: [{ artboard: 'nope' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid');
    expect(h.events).toEqual([]);
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('refuses a position that is not a number, an empty list and a runaway list', async () => {
    const h = harness();
    for (const params of [
      { items: [{ artboard: 'desktop', at: { x: Number.NaN, y: 0 } }] },
      { items: [{ artboard: 'desktop', at: { x: 'a', y: 0 } }] },
      { items: [{ artboard: 'desktop', at: { x: 9e9, y: 0 } }] },
      { items: [] },
      {},
      { items: Array.from({ length: 51 }, () => ({ artboard: 'desktop' })) },
      { items: [{ artboard: 'desktop' }], pin: [{ id: 'a b', x: 0, y: 0 }] },
    ]) {
      const r = await h.run('artboard.duplicate', params as Record<string, unknown>);
      expect(r.ok).toBe(false);
    }
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('without a layout writer the source is still written', async () => {
    const h = harness(false);
    ok(await h.run('artboard.duplicate', { items: [{ artboard: 'desktop', at: { x: 1, y: 2 } }] }));
    expect(h.files.get(FILE)).toContain('id="desktop-2"');
  });
});

describe('artboard.duplicate-at-width', () => {
  test('a Mobile copy gets the width, the v1 name and an id from the width', async () => {
    const h = harness();
    const r = ok(
      await h.run('artboard.duplicate-at-width', {
        items: [{ artboard: 'desktop', width: 390, at: { x: 1520, y: 0 } }],
      })
    );
    expect(h.files.get(FILE)).toContain(
      '<DCArtboard id="desktop-390" label="Desktop (390px)" width={390} height={900} kind="web">'
    );
    expect(r.created).toEqual([{ artboard: 'desktop-390', element: 'desktop-390' }]);
    expect(h.layouts).toEqual([{ set: [{ id: 'desktop-390', x: 1520, y: 0 }] }]);
    const copy = (h.files.get(FILE) as string).split('id="desktop-390"')[1] ?? '';
    expect(copy.split('id="mobile"')[0]).not.toContain('data-cd-id');
  });

  test('a custom width is clamped to what resize accepts and a non-number is refused', async () => {
    const h = harness();
    ok(
      await h.run('artboard.duplicate-at-width', { items: [{ artboard: 'desktop', width: 99999 }] })
    );
    expect(h.files.get(FILE)).toContain('id="desktop-8192"');
    const r = await h.run('artboard.duplicate-at-width', {
      items: [{ artboard: 'desktop', width: 'wide' }],
    });
    expect(r.ok).toBe(false);
  });
});

describe('names and the layout merge', () => {
  test('copyId counts past what is taken and never exceeds 64 characters', () => {
    expect(copyId('desktop', new Set(['desktop']))).toBe('desktop-2');
    expect(copyId('desktop-390', new Set(['desktop', 'desktop-2']))).toBe('desktop-3');
    expect(copyId('a'.repeat(64), new Set()).length).toBeLessThanOrEqual(64);
  });

  test('mergeLayout: set wins, pin only fills a missing id, order is kept', () => {
    const existing = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 5, y: 5 },
    ];
    expect(
      mergeLayout(existing, {
        pin: [
          { id: 'b', x: 99, y: 99 },
          { id: 'c', x: 7, y: 7 },
        ],
        set: [{ id: 'a', x: 1, y: 1 }],
      })
    ).toEqual([
      { id: 'a', x: 1, y: 1 },
      { id: 'b', x: 5, y: 5 },
      { id: 'c', x: 7, y: 7 },
    ]);
  });
});

describe('rename in place keeps a Czech name whole', () => {
  test('label round-trips through the label writer with every háček', () => {
    const name = 'Post 1:1 · Combine v číslech — finále';
    const out = applySetArtboardLabel(FILE, SRC, 'desktop', name).source;
    expect(artboardLabels(out).get('desktop')).toBe(name);
  });
});

// ── through the route: the layout lane's writer gets the merge, the source is written once ─────────────

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('POST /_api/edit-op artboard.duplicate', () => {
  test('the copy and its position are written in one request; other layout keys survive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-ab-dup-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'Home.tsx'), SRC);
    const patches: Array<[string, Record<string, unknown>]> = [];
    const emitted: string[] = [];
    const [spec] = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: (e, p) => void emitted.push(`${e}:${String(p)}`),
      meta: {
        load: async () => ({
          title: 'Home',
          layout: { note: 'keep', artboards: [{ id: 'desktop', x: 0, y: 0 }] },
        }),
        patch: async (f, p) => void patches.push([f, p]),
      },
    });
    const res = await spec.handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file: 'ui/Home.tsx',
          op: 'artboard.duplicate',
          targets: [],
          params: {
            items: [{ artboard: 'desktop', at: { x: 1520, y: 0 } }],
            pin: [{ id: 'mobile', x: 1520, y: 0 }],
          },
        }),
      }),
      {}
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; created: unknown[] };
    expect(body.created).toEqual([{ artboard: 'desktop-2', element: 'desktop-2' }]);
    expect(readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8')).toContain('id="desktop-2"');
    expect(patches).toEqual([
      [
        '.design/ui/Home.tsx',
        {
          layout: {
            note: 'keep',
            artboards: [
              { id: 'desktop', x: 0, y: 0 },
              { id: 'mobile', x: 1520, y: 0 },
              { id: 'desktop-2', x: 1520, y: 0 },
            ],
          },
        },
      ],
    ]);
    expect(emitted).toContain('activity:suppress:ui/Home.tsx');
  });
});
