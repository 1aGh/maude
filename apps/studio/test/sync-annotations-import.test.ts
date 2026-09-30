// DDR-242 — a board file event is imported into the shared doc as the CHANGE it
// made, never as a replacement. The multiplayer rig (L09 toolbar edits and
// deletes) lost every edit that returned a field to an earlier value: the room
// projected width 6, the user set width 3, and the file event of the width-6
// projection — processed after — replaced the doc back to 6.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { noteAnnotationsOnDisk, readReplica, writeReplica } from '../annotations/replica.ts';
import { serializeBoard, validateElements } from '../annotations/schema.ts';
import { importAnnotationsFromDisk } from '../sync/codec.ts';

const rect = (width: number, extra: Record<string, unknown> = {}) =>
  validateElements([
    { id: 'r', type: 'shape', index: 'a0', x: 0, y: 0, w: 100, h: 70, width, ...extra },
  ]).elements;

const widthOf = (doc: Y.Doc) => readReplica(doc)?.elements.find((e) => e.id === 'r')?.width;

describe('importAnnotationsFromDisk', () => {
  test('the event of an older projection does not undo a newer edit', () => {
    const doc = new Y.Doc();
    writeReplica(doc, rect(3));
    noteAnnotationsOnDisk(doc, serializeBoard(rect(3)));
    // Edit 1 → projected (noted before the write, as every projector does).
    writeReplica(doc, rect(6));
    const projected = serializeBoard(rect(6));
    noteAnnotationsOnDisk(doc, projected);
    // Edit 2 lands before the file event of edit 1's projection is processed.
    writeReplica(doc, rect(3));
    expect(importAnnotationsFromDisk(doc, projected)).toBe(false);
    expect(widthOf(doc)).toBe(3);
  });

  test('a genuine external change is applied, alongside the doc’s own newer edit', () => {
    const doc = new Y.Doc();
    writeReplica(doc, rect(3));
    noteAnnotationsOnDisk(doc, serializeBoard(rect(3)));
    writeReplica(doc, rect(6)); // not yet projected
    // Someone else changed the fill on disk.
    expect(importAnnotationsFromDisk(doc, serializeBoard(rect(3, { fill: '#fbe0e1' })))).toBe(true);
    const r = readReplica(doc)?.elements[0];
    expect(r?.fill).toBe('#fbe0e1');
    expect(r?.width).toBe(6);
  });

  test('a delete on disk deletes; a stale file never resurrects a deleted element', () => {
    const doc = new Y.Doc();
    writeReplica(doc, rect(3));
    const withRect = serializeBoard(rect(3));
    noteAnnotationsOnDisk(doc, withRect);
    writeReplica(doc, []); // deleted in the doc
    expect(importAnnotationsFromDisk(doc, withRect)).toBe(false);
    expect(readReplica(doc)?.elements).toEqual([]);
  });

  test('first sight of the file (no base): a full apply', () => {
    const doc = new Y.Doc();
    writeReplica(doc, rect(3));
    expect(importAnnotationsFromDisk(doc, serializeBoard(rect(9)))).toBe(true);
    expect(widthOf(doc)).toBe(9);
  });
});
