// #122 (122-A) — contract §5.4: a cut on canvas A and a paste on canvas B are TWO actions, each in its own
// canvas's ⌘Z. Undoing the paste on B leaves A cut (the clip is still held); undoing the cut on A puts the
// originals back. The carried imports/declarations leave with the paste (the same write).

import { beforeEach, describe, expect, test } from 'bun:test';

import { _resetClips } from '../edit-ops/clipboard.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const A = 'ui/Home.tsx';
const B = 'ui/Other.tsx';
const A_SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
const W = 1440;
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={W} height={900}>
        <div data-cd-id="page">
          <p data-cd-id="hello" style={{ width: W }}>Hello</p>
          <p data-cd-id="stay">Stay</p>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const B_SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Other() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post" width={1080} height={1080}>
        <div data-cd-id="box">
          <h1 data-cd-id="head">Hi</h1>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness() {
  const files = new Map<string, string>([
    [A, A_SRC],
    [B, B_SRC],
  ]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => void files.set(rel, after),
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (op: string, file: string, artboard: string, targets: string[], params = {}) =>
    dispatchEditOp(
      { file, op, targets: targets.map((element) => ({ artboard, element })), params },
      deps
    );
  return { files, run };
}
const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};

beforeEach(() => _resetClips());

describe('cut on A, paste on B', () => {
  test('two writes, two undo records — each canvas undoes only its own', async () => {
    const h = harness();
    const cut = ok(await h.run('object.cut', A, 'desktop', ['hello']));
    const clip = (cut.detail as { clip: { id: string } }).clip.id;
    const paste = ok(await h.run('canvas.paste', B, 'post', ['head'], { clip }));
    expect(cut.writeId).not.toBe(paste.writeId);
    expect(h.files.get(B)).toContain('const W = 1440;');

    // ⌘Z on B: the paste and its carried declaration leave together; A stays cut
    ok(await h.run('revert', B, 'post', [], { writeId: paste.writeId }));
    expect(h.files.get(B)).toBe(B_SRC);
    expect(h.files.get(A)).not.toContain('Hello');

    // the clip is still held: paste again
    ok(await h.run('canvas.paste', B, 'post', ['head'], { clip }));
    expect(h.files.get(B)).toContain('Hello');

    // ⌘Z on A: the original comes back on A; B keeps its paste
    ok(await h.run('revert', A, 'desktop', [], { writeId: cut.writeId }));
    expect(h.files.get(A)).toBe(A_SRC);
    expect(h.files.get(B)).toContain('Hello');
  });

  test('a B undo record can not undo A', async () => {
    const h = harness();
    const cut = ok(await h.run('object.cut', A, 'desktop', ['hello']));
    const r = await h.run('revert', B, 'post', [], { writeId: cut.writeId });
    expect(r.ok).toBe(false);
  });
});
