// Codec unit tests — Phase 9 Task 4.
//
// Verify Y.Doc <-> disk round-trips for the three classes of files the sync
// agent shuttles: HTML body, comments JSON, annotations board (DDR-242).

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import { REPLICA_TYPE } from '../annotations/replica.ts';
import { Y_TYPES } from '../collab/persistence.ts';
import {
  annotationsFromDoc,
  applyAnnotationsToDoc,
  applyCommentsToDoc,
  applyHtmlToDoc,
  bodyEditAtFromDoc,
  commentsFromDoc,
  htmlFromDoc,
  isEmptyAnnotationsSvg,
  stampBodyEdit,
  Y_SYNC_TYPES,
} from '../sync/codec.ts';
import { board, EMPTY_BOARD, sticky, v1, v1Sticky } from './fixtures/annotations-v2/boards.ts';

describe('HTML codec', () => {
  test('htmlFromDoc returns empty string for a fresh doc', () => {
    const doc = new Y.Doc();
    expect(htmlFromDoc(doc)).toBe('');
  });

  test('applyHtmlToDoc → htmlFromDoc round-trip', () => {
    const doc = new Y.Doc();
    applyHtmlToDoc(doc, '<button>hello</button>');
    expect(htmlFromDoc(doc)).toBe('<button>hello</button>');
  });

  test('applyHtmlToDoc with identical content is a no-op', () => {
    const doc = new Y.Doc();
    applyHtmlToDoc(doc, '<button>hi</button>');
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    const changed = applyHtmlToDoc(doc, '<button>hi</button>');
    expect(changed).toBe(false);
    expect(updates).toBe(0);
  });

  test('applyHtmlToDoc emits a minimal op via common prefix + suffix', () => {
    const doc = new Y.Doc();
    applyHtmlToDoc(doc, '<button class="cta">Click</button>');

    // Yjs requires `event.changes.delta` to be read inside the observer.
    let inserts = '';
    let deletes = 0;
    const yText = doc.getText(Y_SYNC_TYPES.html);
    yText.observe((evt) => {
      for (const d of evt.changes.delta) {
        if (typeof d.insert === 'string') inserts += d.insert;
        if (typeof d.delete === 'number') deletes += d.delete;
      }
    });

    applyHtmlToDoc(doc, '<button class="cta">Tap</button>');
    expect(htmlFromDoc(doc)).toBe('<button class="cta">Tap</button>');

    // The change is "Click" → "Tap". With shared prefix
    // `<button class="cta">` and shared suffix `</button>`, the delta should
    // only touch the middle.
    expect(inserts).toBe('Tap');
    expect(deletes).toBe('Click'.length);
  });

  test('applyHtmlToDoc handles complete replace (no shared prefix)', () => {
    const doc = new Y.Doc();
    applyHtmlToDoc(doc, 'aaaa');
    applyHtmlToDoc(doc, 'bbbb');
    expect(htmlFromDoc(doc)).toBe('bbbb');
  });

  test('applyHtmlToDoc tags transaction with origin', () => {
    const doc = new Y.Doc();
    applyHtmlToDoc(doc, 'seed');

    let observedOrigin: unknown = 'unset';
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      observedOrigin = origin;
    });

    const myOrigin = { id: 'sync-agent' };
    applyHtmlToDoc(doc, 'changed', myOrigin);
    expect(observedOrigin).toBe(myOrigin);
  });
});

describe('Comments codec', () => {
  test('commentsFromDoc returns empty array for a fresh doc', () => {
    expect(commentsFromDoc(new Y.Doc())).toEqual([]);
  });

  test('applyCommentsToDoc → commentsFromDoc round-trip', () => {
    const doc = new Y.Doc();
    const snap = [{ id: 'c1', body: 'hi' }];
    applyCommentsToDoc(doc, snap);
    expect(commentsFromDoc(doc)).toEqual(snap);
  });

  test('applyCommentsToDoc with identical content is a no-op', () => {
    const doc = new Y.Doc();
    applyCommentsToDoc(doc, [{ id: 'c1' }]);
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    const changed = applyCommentsToDoc(doc, [{ id: 'c1' }]);
    expect(changed).toBe(false);
    expect(updates).toBe(0);
  });

  test('applyCommentsToDoc replaces existing entries on disk-wins update', () => {
    const doc = new Y.Doc();
    applyCommentsToDoc(doc, [{ id: 'c1' }, { id: 'c2' }]);
    applyCommentsToDoc(doc, [{ id: 'c3' }]);
    expect(commentsFromDoc(doc)).toEqual([{ id: 'c3' }]);
  });

  test('comments share Y_TYPES.comments name with Phase 6 persistence', () => {
    const doc = new Y.Doc();
    applyCommentsToDoc(doc, [{ id: 'c1' }]);
    // The Phase 6 persistence layer reads from this name directly.
    expect(doc.getArray(Y_TYPES.comments).toArray()).toEqual([{ id: 'c1' }]);
  });
});

describe('Annotations codec (DDR-242 replica)', () => {
  const A = board(sticky('s1', 'one'));
  const B = board(sticky('s1', 'one'), sticky('s2', 'two', { x: 300, index: 'a1' }));

  test('annotationsFromDoc returns null for a fresh doc', () => {
    expect(annotationsFromDoc(new Y.Doc())).toBeNull();
  });

  test('applyAnnotationsToDoc → annotationsFromDoc round-trip (canonical board text)', () => {
    const doc = new Y.Doc();
    applyAnnotationsToDoc(doc, B);
    expect(annotationsFromDoc(doc)).toBe(B);
  });

  test('a legacy SVG value is converted on apply', () => {
    const doc = new Y.Doc();
    const legacy = v1([v1Sticky('a', 'x')]);
    applyAnnotationsToDoc(doc, legacy.svg);
    expect(annotationsFromDoc(doc)).toBe(legacy.board);
  });

  test('applyAnnotationsToDoc with null empties the board (zero elements, not "never populated")', () => {
    const doc = new Y.Doc();
    applyAnnotationsToDoc(doc, A);
    applyAnnotationsToDoc(doc, null);
    expect(annotationsFromDoc(doc)).toBe(EMPTY_BOARD);
    expect(isEmptyAnnotationsSvg(annotationsFromDoc(doc))).toBe(true);
  });

  test('applyAnnotationsToDoc with identical content is a no-op', () => {
    const doc = new Y.Doc();
    applyAnnotationsToDoc(doc, A);
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    const changed = applyAnnotationsToDoc(doc, A);
    expect(changed).toBe(false);
    expect(updates).toBe(0);
  });

  test('non-board text is refused, never treated as emptiness', () => {
    const doc = new Y.Doc();
    applyAnnotationsToDoc(doc, A);
    expect(applyAnnotationsToDoc(doc, 'not a board')).toBe(false);
    expect(annotationsFromDoc(doc)).toBe(A);
  });

  test('annotations live in the per-element replica, never the v1 `svg` key', () => {
    const doc = new Y.Doc();
    applyAnnotationsToDoc(doc, B);
    expect(doc.getMap<unknown>(Y_TYPES.annotations).has('svg')).toBe(false);
    const replica = doc.getMap<unknown>(REPLICA_TYPE);
    expect(replica.get('s1')).toBeInstanceOf(Y.Map);
    expect(replica.get('s2')).toBeInstanceOf(Y.Map);
  });
});

// syncMeta lane — DDR-102. The doc-side body-edit stamp the cold-start
// newest-wins decision reads. Dedicated Y.Map lane because meta's
// `last_modified` is in META_LOCAL_KEYS (per-machine, never syncs).
describe('syncMeta codec (DDR-102)', () => {
  test('bodyEditAtFromDoc returns null on a fresh doc (older-peer interop)', () => {
    const doc = new Y.Doc();
    expect(bodyEditAtFromDoc(doc)).toBeNull();
  });

  test('stampBodyEdit → bodyEditAtFromDoc round-trip with explicit nowMs', () => {
    const doc = new Y.Doc();
    stampBodyEdit(doc, undefined, 1_700_000_000_000);
    expect(bodyEditAtFromDoc(doc)).toBe(1_700_000_000_000);
    const by = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta).get('by');
    expect(typeof by).toBe('string');
    expect((by as string).length).toBeGreaterThan(0);
    expect((by as string).length).toBeLessThanOrEqual(32);
  });

  test('stampBodyEdit defaults to Date.now()', () => {
    const doc = new Y.Doc();
    const before = Date.now();
    stampBodyEdit(doc);
    const after = Date.now();
    const at = bodyEditAtFromDoc(doc);
    expect(at).not.toBeNull();
    expect(at as number).toBeGreaterThanOrEqual(before);
    expect(at as number).toBeLessThanOrEqual(after);
  });

  test('a hostile/garbage bodyEditAt value reads as null', () => {
    const doc = new Y.Doc();
    doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta).set('bodyEditAt', 'not-a-number');
    expect(bodyEditAtFromDoc(doc)).toBeNull();
    doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta).set('bodyEditAt', Number.POSITIVE_INFINITY);
    expect(bodyEditAtFromDoc(doc)).toBeNull();
  });

  test('body apply + stamp wrapped in one transaction emits ONE update', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    const origin = { agent: 'test' };
    doc.transact(() => {
      applyHtmlToDoc(doc, '<div>v1</div>', origin);
      stampBodyEdit(doc, origin, 123);
    }, origin);
    expect(updates).toBe(1);
    expect(htmlFromDoc(doc)).toBe('<div>v1</div>');
    expect(bodyEditAtFromDoc(doc)).toBe(123);
  });

  test('the stamp syncs to a peer doc via update exchange', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
    stampBodyEdit(a, undefined, 456);
    expect(bodyEditAtFromDoc(b)).toBe(456);
  });
});
