// S2.24 G3 — every edit-op's undo step is named by what it did ("Locked See pricing"), never "Edit canvas".
// 14 `ed-edge-undo`: the history row reads "Headline text" / "Moved See pricing 10 px"; the row used to say
// "Edit canvas" for every write the person made, because only a few ops carried an action label.

import { describe, expect, test } from 'bun:test';

import {
  type DispatchDeps,
  dispatchEditOp,
  EDIT_OPS,
  type LandPlan,
} from '../edit-ops/dispatch.ts';
import { nameOf, opLabel, targetsName } from '../edit-ops/op-label.ts';
import { createWriteLog } from '../edit-ops/revert.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <h1 data-cd-id="see-pricing">Pricing</h1>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(land?: DispatchDeps['land']) {
  const writes: Array<{ label: string; said?: string }> = [];
  const files = new Map<string, string>([[FILE, SRC]]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after, label, said) => {
      files.set(rel, after);
      writes.push({ label, ...(said ? { said } : {}) });
    },
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
    ...(land ? { land } : {}),
  };
  return { writes, run: (req: object) => dispatchEditOp({ file: FILE, ...req }, deps) };
}

describe('the words of an op', () => {
  test('a readable authored id is a name; a generated one is not', () => {
    expect(nameOf('see-pricing')).toBe('See pricing');
    expect(nameOf('cc8caada')).toBe('');
    expect(targetsName([{ artboard: 'desktop', element: 'see-pricing' }])).toBe('See pricing');
    expect(targetsName([{ artboard: 'desktop', element: 'cc8caada' }])).toBe('an object');
    expect(
      targetsName([
        { artboard: 'desktop', element: 'a' },
        { artboard: 'desktop', element: 'b' },
      ])
    ).toBe('2 objects');
  });

  test('a few lines, as the canvas says them', () => {
    const one = [{ artboard: 'desktop', element: 'see-pricing' }];
    expect(opLabel('text.set', { text: 'x' }, one)).toBe('See pricing text');
    expect(opLabel('object.lock', {}, one)).toBe('Locked See pricing');
    expect(opLabel('object.lock', { locked: false }, one)).toBe('Unlocked See pricing');
    expect(opLabel('object.insert-shape', { kind: 'rectangle' }, [])).toBe('Drew a rectangle');
    expect(opLabel('text.reset-style', {}, one)).toBe('Reset the text style of See pricing');
    // an artboard op names its board in params, not in targets
    expect(opLabel('artboard.resize', { artboard: 'desktop', width: 1280 }, [])).toBe(
      'Resized Desktop to 1280 px wide'
    );
  });

  test('every op in the table has a line of its own — none is "Edit canvas", none is empty', () => {
    for (const op of EDIT_OPS) {
      const said = opLabel(op.id, {}, [{ artboard: 'desktop', element: 'see-pricing' }]);
      expect(said.length).toBeGreaterThan(2);
      expect(said).not.toBe('Edit canvas');
    }
  });
});

describe('the dispatcher says it', () => {
  test('an ordinary write carries the line to the writer (the local home records the row with it)', async () => {
    const h = harness();
    const r = await h.run({
      op: 'object.lock',
      targets: [{ artboard: 'desktop', element: 'see-pricing' }],
      params: {},
    });
    expect(r.ok).toBe(true);
    expect(h.writes).toEqual([{ label: 'pre-object.lock', said: 'Locked See pricing' }]);
  });

  test('a layout write on an op-log home lands as an action with that line, not the default', async () => {
    const plans: LandPlan[] = [];
    const h = harness(async (p) => (plans.push(p), { ok: true, actionId: 'act_1' }));
    const r = await h.run({
      op: 'artboard.draw',
      targets: [],
      params: { rect: { x: 0, y: 1000, w: 400, h: 300 } },
    });
    expect(r.ok).toBe(true);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.action).toEqual({ kind: 'edit', label: 'Drew an artboard' });
  });
});
