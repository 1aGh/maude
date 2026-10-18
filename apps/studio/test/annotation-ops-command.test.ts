// annotation-ops-command (DDR-242 AD4) — one gesture = one op batch; undo is its inverse.
import { describe, expect, test } from 'bun:test';
import { AiBatch } from '../annotations/ai-write.ts';
import { applyOps, type Op } from '../annotations/ops.ts';
import { canonical } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  type AnnotationOpsFn,
  buildAnnotationOpsRecord,
  createAnnotationOpsCommand,
} from '../commands/annotation-ops-command.ts';

describe('annotation-ops command', () => {
  const ops = [{ op: 'patch' as const, id: 's1', set: { x: 5 }, expect: { x: 0 } }];
  const inverse = [
    { op: 'patch' as const, id: 's1', set: { x: 0 }, expect: { x: 5 }, strict: true },
  ];

  test('do sends the batch, undo its inverse — each with the canvas it belongs to', async () => {
    const calls: Array<[unknown, string | undefined]> = [];
    const fn: AnnotationOpsFn = (o, file) => {
      calls.push([o, file]);
    };
    const record = buildAnnotationOpsRecord({
      ops,
      inverse,
      label: 'move',
      file: '.design/ui/A.tsx',
    });
    const cmd = createAnnotationOpsCommand(record, fn);
    await cmd.do();
    await cmd.undo();
    expect(calls).toEqual([
      [ops, '.design/ui/A.tsx'],
      [inverse, '.design/ui/A.tsx'],
    ]);
  });

  // S4.5 — "Undo this chat" (S4.15) reverts the AI's resolves with the design change: the agent's
  // resolve batch is an ordinary op record whose inverse reopens exactly what it resolved.
  test('an AI resolve batch is one undoable record: do resolves, undo reopens', async () => {
    const sticky = canonical({
      id: 's1',
      type: 'sticky',
      index: 'a0',
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      text: 'warmer sun?',
    } as never) as unknown as AnnotationElement;
    const batch = new AiBatch([sticky]);
    batch.resolveStickies({ ids: ['s1'] });
    const base = new Map([[sticky.id, sticky]]);
    const { inverse } = applyOps(base, batch.ops);
    let state = base;
    const fn: AnnotationOpsFn = (o) => {
      state = applyOps(state, o as Op[]).state;
    };
    const cmd = createAnnotationOpsCommand(
      buildAnnotationOpsRecord({ ops: batch.ops, inverse, label: 'resolve' }),
      fn
    );
    await cmd.do();
    expect(state.get('s1')?.resolved).toMatchObject({ by: 'AI' });
    await cmd.undo();
    expect(state.get('s1')?.resolved).toBeUndefined();
    expect(state.get('s1')?.text).toBe('warmer sun?');
  });

  test('the record is a deep copy (the caller may reuse its arrays)', () => {
    const mine = structuredClone(ops);
    const record = buildAnnotationOpsRecord({ ops: mine, inverse, label: 'x' });
    (mine[0] as { set: Record<string, unknown> }).set.x = 99;
    expect((record.payload.ops[0] as { set: Record<string, unknown> }).set.x).toBe(5);
    expect(record.payload.file).toBeUndefined();
  });
});
