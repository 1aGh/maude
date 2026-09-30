// annotation-ops-command (DDR-242 AD4) — one gesture = one op batch; undo is its inverse.
import { describe, expect, test } from 'bun:test';
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

  test('the record is a deep copy (the caller may reuse its arrays)', () => {
    const mine = structuredClone(ops);
    const record = buildAnnotationOpsRecord({ ops: mine, inverse, label: 'x' });
    (mine[0] as { set: Record<string, unknown> }).set.x = 99;
    expect((record.payload.ops[0] as { set: Record<string, unknown> }).set.x).toBe(5);
    expect(record.payload.file).toBeUndefined();
  });
});
