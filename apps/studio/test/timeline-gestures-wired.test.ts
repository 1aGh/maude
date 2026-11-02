// S7.9 — the shell hands the Timeline's three gesture callbacks to the ONE verb pipe. A trim / move, a beat dragged to a
// new place and a footage drop used to call /_api/retime-sequence, /_api/reorder-sequence and /_api/insert-sequence
// and push a timeline-local revert `seq`; they are `clip.retime` / `clip.move` / `clip.insert` edit ops now (one write,
// one `writeId`, one undo step). The old routes stay served for v1 callers — only the shell stops using them for these
// three. A source pin, because app.jsx cannot be mounted in a unit test.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = readFileSync(join(import.meta.dir, '../client/app.jsx'), 'utf8');

/** The JSX prop `name={…}` of the Timeline, from its opening to the next sibling prop at the same indent. */
function prop(name: string): string {
  const start = APP.indexOf(`      ${name}={`);
  expect(start).toBeGreaterThan(-1);
  const next = APP.slice(start + 1).search(/\n {6}[a-zA-Z]+=\{/);
  return APP.slice(start, next < 0 ? undefined : start + 1 + next);
}

describe('the shell wires the three gestures to the verb pipe', () => {
  test('onRetime is one clip.retime', () => {
    const body = prop('onRetime');
    expect(body).toContain("timelineClipVerb(clipRef, 'retime', patch)");
    expect(body).not.toContain('/_api/retime-sequence');
    expect(body).not.toContain('pushTlUndo');
  });

  test('onReorderMove is one clip.move beside the named clip', () => {
    const body = prop('onReorderMove');
    expect(body).toContain("timelineClipVerb(movedRef2, 'move', { refRef: targetRef, position })");
    expect(body).not.toContain('/_api/reorder-sequence');
    expect(body).not.toContain('pushTlUndo');
  });

  test('onDropMedia adds each band’s files with ONE clip.insert, never a write per file', () => {
    const body = prop('onDropMedia');
    expect(body).not.toContain('/_api/insert-sequence');
    expect(body).not.toContain('pushTlUndo');
    expect(body).toContain("timelineClipVerb(null, 'insert', g)");
    expect(body).toContain('items:');
  });
});
