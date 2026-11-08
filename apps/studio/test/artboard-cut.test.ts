// #122 (122-A) — `artboard.cut` (contract §5.3): `artboard.copy` + `artboard.trash`'s removal in ONE write,
// `kind: 'trash'`, so a cut artboard that is never pasted is in the Trash, not only in a forgettable server clip.

import { beforeEach, describe, expect, test } from 'bun:test';

import { _resetClips } from '../edit-ops/clipboard.ts';
import { type DispatchDeps, dispatchEditOp, type LandPlan } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Home.tsx';
const OTHER = 'ui/Other.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <p>World</p>
      </DCArtboard>
      <DCArtboard id="mobile" label="Phone" width={390} height={844}>
        <p>Hi</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const ONE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Other() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post" width={1080} height={1080}>
        <p>Post</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(land?: DispatchDeps['land']) {
  const files = new Map<string, string>([
    [FILE, SRC],
    [OTHER, ONE],
  ]);
  const writes: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes.push(rel);
      files.set(rel, after);
    },
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
    ...(land ? { land } : {}),
  };
  const run = (op: string, file: string, params: Record<string, unknown>) =>
    dispatchEditOp({ file, op, targets: [], params }, deps);
  return { files, writes, run };
}
const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};

beforeEach(() => _resetClips());

describe('artboard.cut', () => {
  test('one write: the board leaves the source, a handle comes back', async () => {
    const h = harness();
    const r = ok(await h.run('artboard.cut', FILE, { artboards: ['mobile'] }));
    expect(h.writes).toEqual([FILE]);
    expect(h.files.get(FILE)).not.toContain('id="mobile"');
    expect(r.writeId).not.toBe('');
    expect(
      (r.detail as { clip: { kind: string; count: number; from: string } }).clip
    ).toMatchObject({ kind: 'artboards', count: 1, from: FILE });
  });

  test('on an op-log home: ONE trash action the Trash lists, the layout entry out in the same action', async () => {
    const plans: LandPlan[] = [];
    const h = harness(async (plan) => {
      plans.push(plan);
      return { ok: true, actionId: 'act_1' };
    });
    ok(await h.run('artboard.cut', FILE, { artboards: ['mobile'] }));
    expect(plans.length).toBe(1);
    expect(plans[0]?.action).toEqual({
      kind: 'trash',
      label: 'Cut “Phone”',
      trashed: [{ artboard: 'mobile', label: 'Phone' }],
    });
    expect(plans[0]?.layout).toEqual({ remove: ['mobile'] });
  });

  test('the canvas keeps one artboard: cutting every board is refused, nothing written', async () => {
    const plans: LandPlan[] = [];
    const h = harness(async (plan) => {
      plans.push(plan);
      return { ok: true, actionId: 'act_1' };
    });
    const all = await h.run('artboard.cut', FILE, { artboards: ['desktop', 'mobile'] });
    expect(all.ok).toBe(false);
    if (!all.ok) expect(all.message).toBe('A canvas keeps at least one artboard.');
    expect(plans).toEqual([]);
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('⌘Z puts it back; the clip still pastes on another canvas', async () => {
    const h = harness();
    const cut = ok(await h.run('artboard.cut', FILE, { artboards: ['mobile'] }));
    const clip = (cut.detail as { clip: { id: string } }).clip.id;
    ok(await h.run('revert', FILE, { writeId: cut.writeId }));
    expect(h.files.get(FILE)).toBe(SRC);
    ok(await h.run('canvas.paste', OTHER, { clip, artboard: 'post' }));
    expect(h.files.get(OTHER)).toMatch(/label="Phone( 2)?"/);
  });

  test('an AI lease on the artboard refuses the cut', async () => {
    const h = harness();
    const deps = {
      resolve: (f: string) => f,
      read: (rel: string) => h.files.get(rel) ?? null,
      write: async () => {},
      heldByAi: () => null,
      heldArtboard: (_rel: string, a: string) => (a === 'mobile' ? { mine: true } : null),
      log: createWriteLog(),
    } satisfies DispatchDeps;
    const r = await dispatchEditOp(
      { file: FILE, op: 'artboard.cut', targets: [], params: { artboards: ['mobile'] } },
      deps
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('held-by-ai');
  });
});
