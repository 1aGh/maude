// S2.10b — `artboard.trash` (⌫ / "Move to trash" on an artboard) and the dispatcher's op-log seam.
//
// Pure dispatcher: on an op-log home (`land`) the op is ONE plan — the source without the board, its
// layout entry removed, `kind: 'trash'` with `origin.trashed` — and no legacy revert record. With no
// such home it is one write + one revert record and the layout entry stays (an orphan entry is inert,
// the revert brings the board back at its own place). The shell's helpers post a legacy record only
// for a legacy write.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { legacyRecordPayload, trashArtboardBody } from '../client/edit-op-relay.ts';
import {
  type DispatchDeps,
  dispatchEditOp,
  EDIT_OPS,
  type LandPlan,
} from '../edit-ops/dispatch.ts';
import { mergeLayout, nextMetaText } from '../edit-ops/layout-patch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult, LayoutPatch } from '../edit-ops/types.ts';
import { createEditRoutes } from '../routes/edit.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <p>World</p>
      </DCArtboard>
      <DCArtboard id="mobile" label="Příběh" width={390} height={844}>
        <p>Hi</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(land?: DispatchDeps['land']) {
  const files = new Map<string, string>([[FILE, SRC]]);
  const layouts: LayoutPatch[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => void files.set(rel, after),
    writeLayout: async (_rel, patch) => void layouts.push(patch),
    heldByAi: () => null,
    log: createWriteLog(),
    ...(land ? { land } : {}),
  };
  const run = (op: string, params: Record<string, unknown>) =>
    dispatchEditOp({ file: FILE, op, targets: [], params }, deps);
  return { files, layouts, run };
}
const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};

describe('artboard.trash', () => {
  test('is in the op table the route dispatches', () => {
    expect(EDIT_OPS.some((o) => o.id === 'artboard.trash')).toBe(true);
  });

  test('an op-log home gets ONE plan: no board, no entry, kind trash with origin.trashed', async () => {
    const plans: LandPlan[] = [];
    const h = harness(async (p) => {
      plans.push(p);
      return { ok: true, actionId: 'act_1' };
    });
    const r = ok(await h.run('artboard.trash', { artboards: ['mobile'] }));
    expect(r.actionId).toBe('act_1');
    expect(r.writeId).toBe(''); // the op log undoes it — never a second, legacy way
    expect(plans).toHaveLength(1);
    expect(plans[0]?.after).not.toContain('id="mobile"');
    expect(plans[0]?.layout).toEqual({ remove: ['mobile'] });
    expect(plans[0]?.action).toEqual({
      kind: 'trash',
      label: 'Moved “Příběh” to the trash',
      trashed: [{ artboard: 'mobile', label: 'Příběh' }],
    });
    // the home wrote it, not the legacy writers
    expect(h.files.get(FILE)).toBe(SRC);
    expect(h.layouts).toEqual([]);
  });

  test('a legacy link: one write + one revert record; the layout entry stays; revert restores', async () => {
    const h = harness();
    const r = ok(await h.run('artboard.trash', { artboards: ['mobile'] }));
    expect(r.actionId).toBeNull();
    expect(r.writeId).toMatch(/^w_[0-9a-f]{16}$/);
    expect(h.files.get(FILE)).not.toContain('id="mobile"');
    expect(h.layouts).toEqual([]);
    ok(await h.run('revert', { writeId: r.writeId }));
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('a home that is not one here (null) falls back to the legacy path', async () => {
    const h = harness(async () => null);
    const r = ok(await h.run('artboard.trash', { artboards: ['mobile'] }));
    expect(r.writeId).toMatch(/^w_/);
    expect(h.files.get(FILE)).not.toContain('id="mobile"');
  });

  test('a refused action writes nothing and says why', async () => {
    const h = harness(async () => ({
      ok: false,
      code: 'stale',
      message: 'The canvas changed underneath; try again.',
    }));
    const r = await h.run('artboard.trash', { artboards: ['mobile'] });
    expect(r).toEqual({
      ok: false,
      code: 'stale',
      message: 'The canvas changed underneath; try again.',
    });
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('refuses the last board, an unknown id, an empty list', async () => {
    const h = harness();
    for (const [params, message] of [
      [{ artboards: ['desktop', 'mobile'] }, 'A canvas keeps at least one artboard.'],
      [{ artboards: ['nope'] }, 'That artboard is not on this canvas.'],
      [{ artboards: [] }, 'Nothing to move to the trash.'],
    ] as const) {
      expect(await h.run('artboard.trash', params)).toMatchObject({
        ok: false,
        code: 'invalid',
        message,
      });
    }
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('an op that writes no layout keeps the ordinary source path', async () => {
    const plans: LandPlan[] = [];
    const h = harness(async (p) => {
      plans.push(p);
      return { ok: true, actionId: 'act_x' };
    });
    const r = ok(await h.run('artboard.resize', { artboard: 'mobile', width: 500 }));
    expect(plans).toEqual([]);
    expect(r.writeId).toMatch(/^w_/);
    expect(h.files.get(FILE)).toContain('width={500}');
  });

  test('a copy lands as one edit plan with its place', async () => {
    const plans: LandPlan[] = [];
    const h = harness(async (p) => {
      plans.push(p);
      return { ok: true, actionId: 'act_2' };
    });
    ok(
      await h.run('artboard.duplicate', { items: [{ artboard: 'desktop', at: { x: 3000, y: 0 } }] })
    );
    expect(plans[0]?.action).toEqual({ kind: 'edit', label: 'Duplicate artboard' });
    expect(plans[0]?.layout).toEqual({ set: [{ id: 'desktop-2', x: 3000, y: 0 }] });
  });
});

describe('the route on a legacy link (a hub runtime not in accepted mode)', () => {
  test('nothing is proposed: one write, one revert record, the layout through its own writer', async () => {
    const root = mkdtempSync(join(tmpdir(), 's210b-legacy-'));
    try {
      const designRoot = join(root, '.design');
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      writeFileSync(join(designRoot, FILE), SRC);
      const proposed: unknown[] = [];
      const patches: unknown[] = [];
      const [spec] = createEditRoutes({
        designRoot,
        designRel: '.design',
        repoRoot: root,
        emit: () => {},
        control: () => ({
          acceptedMode: () => false,
          proposeLanes: (...a: unknown[]) => {
            proposed.push(a);
            return null;
          },
        }),
        meta: {
          load: async () => ({ layout: { artboards: [] } }),
          patch: async (_f, p) => void patches.push(p),
        },
      });
      const res = await spec.handle(
        new Request('http://localhost/_api/edit-op', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            file: FILE,
            op: 'artboard.duplicate',
            targets: [],
            params: { items: [{ artboard: 'desktop', at: { x: 3000, y: 0 } }] },
          }),
        }),
        {}
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ ok: true, actionId: null });
      expect(body.writeId).toMatch(/^w_[0-9a-f]{16}$/);
      expect(proposed).toEqual([]);
      expect(patches).toHaveLength(1);
      expect(readFileSync(join(designRoot, FILE), 'utf8')).toContain('id="desktop-2"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the layout lane text', () => {
  test('remove takes an entry out; the rest keeps its order', () => {
    const list = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 1, y: 0 },
      { id: 'c', x: 2, y: 0 },
    ];
    expect(mergeLayout(list, { remove: ['b'] }).map((e) => e.id)).toEqual(['a', 'c']);
  });

  test('nextMetaText keeps other keys, drops viewport, stamps last_modified', () => {
    const cur = JSON.stringify({
      title: 'Home',
      viewport: { x: 1 },
      layout: { note: 'keep', artboards: [{ id: 'a', x: 0, y: 0 }] },
    });
    const next = nextMetaText(cur, { remove: ['a'] }, new Date('2026-10-18T10:00:00.000Z'));
    expect(JSON.parse(next ?? '')).toEqual({
      title: 'Home',
      layout: { note: 'keep', artboards: [] },
      last_modified: '2026-10-18T10:00:00.000Z',
    });
    expect(nextMetaText('[1]', { remove: ['a'] }, new Date())).toBeNull();
  });
});

describe('the shell posts a legacy undo record only for a legacy write', () => {
  test('trashArtboardBody pins the active canvas', () => {
    expect(trashArtboardBody('ui/Home.tsx', ['mobile'])).toEqual({
      file: 'ui/Home.tsx',
      op: 'artboard.trash',
      targets: [],
      params: { artboards: ['mobile'] },
    });
  });

  test('an action id or a queued write posts none; a legacy write posts one', () => {
    const base = { ok: true as const, rev: 'r', refs: [] };
    expect(legacyRecordPayload({ ...base, actionId: 'act_1', writeId: '' }, 'L')).toBeNull();
    expect(
      legacyRecordPayload({ ...base, actionId: null, writeId: '', queued: true }, 'L')
    ).toBeNull();
    expect(
      legacyRecordPayload({ ...base, actionId: null, writeId: 'w_0123456789abcdef' }, 'L')
    ).toEqual({ op: 'edit-op', writeId: 'w_0123456789abcdef', label: 'L' });
    expect(legacyRecordPayload({ ok: false, code: 'invalid', message: 'x' }, 'L')).toBeNull();
  });
});
