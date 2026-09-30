// annotations-v2 (DDR-242 §5) — the Yjs replica: per-element diffs, legacy fallback, stale-peer safety.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  applyOpsToReplica,
  hasReplica,
  isEmptyBoardText,
  LEGACY_TYPE,
  observeReplica,
  REPLICA_TYPE,
  readReplica,
  replicaActionId,
  replicaBoardText,
  writeReplica,
} from '../annotations/replica.ts';
import { serializeBoard, validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { strokesToSvg } from '../annotations-model.ts';

const els = (raw: unknown[]): AnnotationElement[] => validateElements(raw).elements;
const s1 = { id: 's1', type: 'sticky', index: 'a0', x: 0, y: 0, w: 200, h: 200, text: 'one' };
const s2 = { id: 's2', type: 'sticky', index: 'a1', x: 300, y: 0, w: 200, h: 200, text: 'two' };

/** Bytes of the Yjs update a mutation produces. */
function updateBytes(doc: Y.Doc, fn: () => void): number {
  let bytes = 0;
  const h = (u: Uint8Array) => {
    bytes += u.byteLength;
  };
  doc.on('update', h);
  fn();
  doc.off('update', h);
  return bytes;
}

test('the sync byte cap equals the board byte cap', async () => {
  const { MAX_ANNOTATIONS_BYTES } = await import('../sync/limits.ts');
  const { MAX_BOARD_BYTES } = await import('../annotations/constants.ts');
  expect(MAX_ANNOTATIONS_BYTES).toBe(MAX_BOARD_BYTES);
});

describe('replica', () => {
  test('never-populated doc reads null; an empty v2 board reads []', () => {
    const doc = new Y.Doc();
    expect(readReplica(doc)).toBeNull();
    writeReplica(doc, []);
    expect(readReplica(doc)?.elements).toEqual([]);
    expect(hasReplica(doc)).toBe(true);
  });

  test('write → read round-trips canonically', () => {
    const doc = new Y.Doc();
    const board = els([s1, s2]);
    writeReplica(doc, board, 'test', { actionId: 'act-1' });
    expect(replicaBoardText(doc)).toBe(serializeBoard(board));
    expect(replicaActionId(doc)).toBe('act-1');
  });

  test('an edit crosses the wire as a per-element update, independent of board size', () => {
    const small = new Y.Doc();
    const big = new Y.Doc();
    const many = Array.from({ length: 2000 }, (_, i) => ({
      ...s1,
      id: `n${i}`,
      index: `a${i}`.replace(/0+$/, '') || 'a1',
    }));
    writeReplica(small, els([s1, s2]));
    writeReplica(big, els([s1, s2, ...many]));
    const edit = (doc: Y.Doc) =>
      updateBytes(doc, () =>
        writeReplica(
          doc,
          (readReplica(doc)?.elements ?? []).map((e) => (e.id === 's1' ? { ...e, x: 5 } : e))
        )
      );
    const a = edit(small);
    const b = edit(big);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(120);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(8);
  });

  test('two docs editing different fields of one element converge with both edits', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    writeReplica(a, els([s1]));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyOpsToReplica(a, [{ op: 'patch', id: 's1', set: { x: 50 } }]);
    applyOpsToReplica(b, [{ op: 'patch', id: 's1', set: { fill: '#ffffff' } }]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(replicaBoardText(a)).toBe(replicaBoardText(b));
    expect(readReplica(a)?.elements[0]).toMatchObject({ x: 50, fill: '#ffffff' });
  });

  test('a legacy SVG is read through the migration until v2 writes', () => {
    const doc = new Y.Doc();
    const svg = strokesToSvg([
      {
        id: 'st',
        tool: 'sticky',
        color: '#fce8a6',
        x: 1,
        y: 2,
        w: 100,
        h: 100,
        text: 'legacy',
        fontSize: 14,
      },
    ]);
    doc.getMap(LEGACY_TYPE).set('svg', svg);
    expect(readReplica(doc)?.elements[0]).toMatchObject({
      id: 'st',
      type: 'sticky',
      text: 'legacy',
    });
    expect(hasReplica(doc)).toBe(false);
  });

  test('a stale v1 peer writing the legacy key cannot erase a v2 board', () => {
    const doc = new Y.Doc();
    writeReplica(doc, els([s1, s2]));
    // Old client: writes the empty 72-byte wrapper (the DDR-223 eraser shape).
    doc.getMap(LEGACY_TYPE).set('svg', strokesToSvg([]));
    expect(readReplica(doc)?.elements.map((e) => e.id)).toEqual(['s1', 's2']);
  });

  test('hostile peer data in the replica is validated on read', () => {
    const doc = new Y.Doc();
    writeReplica(doc, els([s1]));
    const bad = new Y.Map<unknown>();
    bad.set('type', 'image');
    bad.set('index', 'a5');
    bad.set('x', 0);
    bad.set('y', 0);
    bad.set('w', 10);
    bad.set('h', 10);
    bad.set('href', 'javascript:alert(1)');
    doc.getMap(REPLICA_TYPE).set('evil', bad);
    const garbage = new Y.Map<unknown>();
    garbage.set('type', 42);
    doc.getMap(REPLICA_TYPE).set('junk', garbage);
    const r = readReplica(doc);
    expect(r?.elements.find((e) => e.id === 'evil')?.href).toBeUndefined();
    expect(r?.elements.some((e) => e.id === 'junk')).toBe(false);
  });

  test('observeReplica reports changed ids and the action', () => {
    const doc = new Y.Doc();
    writeReplica(doc, els([s1, s2]));
    const seen: Array<{ changed: string[]; action: string | undefined }> = [];
    const off = observeReplica(doc, (_e, changed, action) =>
      seen.push({ changed: [...changed], action })
    );
    applyOpsToReplica(doc, [{ op: 'patch', id: 's2', set: { text: 'edited' } }], 'ui', {
      actionId: 'a-9',
    });
    off();
    expect(seen[0]?.changed).toEqual([]); // initial emit
    expect(seen[1]).toEqual({ changed: ['s2'], action: 'a-9' });
  });

  test('emptiness: null, blank, [] board and the legacy wrapper are empty; content is not', () => {
    expect(isEmptyBoardText(null)).toBe(true);
    expect(isEmptyBoardText('')).toBe(true);
    expect(isEmptyBoardText(serializeBoard([]))).toBe(true);
    expect(isEmptyBoardText(strokesToSvg([]))).toBe(true);
    expect(isEmptyBoardText(serializeBoard(els([s1])))).toBe(false);
  });
});
