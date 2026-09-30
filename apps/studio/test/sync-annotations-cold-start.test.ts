// Per-lane annotations cold start — the 2026-08-14 annotations eraser (DDR-223),
// ported to the annotations-v2 element model (DDR-242).
//
// The eraser: annotations used to follow the BODY winner at cold start, and
// the emptiness guard was `!== ''` — so a hub doc holding the bare 72-byte
// wrapper (`<svg …></svg>`, a non-empty STRING carrying zero strokes)
// overwrote a peer's real strokes whenever the hub won the body, taking the
// `assets/<sha8>` references the asset pull scans with them. Confirmed on
// alligators: a sidecar committed with two `<image>` strokes at 12:45 was the
// empty wrapper on every peer two minutes after the next fleet roll.
//
// The fix has three parts, each pinned here:
//   1. `isEmptyAnnotationsSvg` — emptiness is ZERO ELEMENTS (v2 empty board,
//      the legacy wrapper, '' and null alike), never a byte heuristic.
//   2. `decideAnnotationsColdStart` — per-lane table; unstamped emptiness
//      never beats content, stamped delete-all is honored by time.
//   3. `stampAnnotationsEdit` riding every local→doc annotations apply
//      (applyFromFs, cold-start seed, adopt) in the same transaction.
//
// In v2 the hub's "stale emptiness" can arrive in two shapes, and every
// end-to-end scenario runs against both:
//   - `v2-empty`   — the replica written with zero elements;
//   - `v1-wrapper` — a not-yet-migrated hub doc whose legacy
//                    `Y.Map('annotations').svg` is the 72-byte wrapper.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { LEGACY_TYPE, writeReplica } from '../annotations/replica.ts';
import type { Stroke } from '../annotations-model.ts';
import { type CanvasSyncAgent, createCanvasSyncAgent } from '../sync/agent.ts';
import {
  annotationsEditAtFromDoc,
  annotationsFromDoc,
  applyAnnotationsToDoc,
  applyHtmlToDoc,
  isEmptyAnnotationsSvg,
  stampAnnotationsEdit,
} from '../sync/codec.ts';
import { type AnnotationsColdStartInput, decideAnnotationsColdStart } from '../sync/cold-start.ts';
import { createEchoGuard, hashBytes } from '../sync/echo-guard.ts';
import { migrateSeed } from '../sync/migrate-seed.ts';
import {
  board,
  boardIds,
  EMPTY_BOARD,
  image,
  sticky,
  v1,
} from './fixtures/annotations-v2/boards.ts';

/** The exact serialization `strokesToSvg([])` emits — the eraser's payload. */
const EMPTY_WRAPPER = v1([]).svg;
/** Real content with an asset reference — what the eraser destroyed. */
const STROKES = board(image('s_1', 'assets/0327a8e5.png'));
const STROKES_B = board(sticky('s_2', 'other'));
/** The same content as a legacy v1 sidecar. */
const LEGACY = v1([
  { id: 's_1', tool: 'image', x: 0, y: 0, w: 160, h: 160, href: 'assets/0327a8e5.png' } as Stroke,
]);

/* ------------------------------------------------- isEmptyAnnotationsSvg */

describe('isEmptyAnnotationsSvg (zero elements)', () => {
  test('null / empty / whitespace are empty', () => {
    expect(isEmptyAnnotationsSvg(null)).toBe(true);
    expect(isEmptyAnnotationsSvg('')).toBe(true);
    expect(isEmptyAnnotationsSvg('  \n\t ')).toBe(true);
  });

  test('the v2 empty board is empty', () => {
    expect(isEmptyAnnotationsSvg(EMPTY_BOARD)).toBe(true);
  });

  test('the bare legacy wrapper is empty — the eraser regression pin', () => {
    expect(EMPTY_WRAPPER).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1"></svg>'
    );
    expect(isEmptyAnnotationsSvg(EMPTY_WRAPPER)).toBe(true);
    expect(isEmptyAnnotationsSvg(`  ${EMPTY_WRAPPER}\n`)).toBe(true);
  });

  test('a single element is NOT empty — board or legacy SVG', () => {
    expect(isEmptyAnnotationsSvg(STROKES)).toBe(false);
    expect(isEmptyAnnotationsSvg(LEGACY.svg)).toBe(false);
    expect(LEGACY.board).toBe(STROKES);
  });
});

/* ------------------------------------------- decideAnnotationsColdStart */

function input(over: Partial<AnnotationsColdStartInput>): AnnotationsColdStartInput {
  return {
    local: null,
    doc: '',
    isEmpty: isEmptyAnnotationsSvg,
    localMtimeMs: null,
    docEditAtMs: null,
    bodyWinner: 'hub',
    ...over,
  };
}

describe('decideAnnotationsColdStart — emptiness vs content', () => {
  for (const [name, EMPTY] of [
    ['v2 empty board', EMPTY_BOARD],
    ['legacy wrapper', EMPTY_WRAPPER],
  ] as const) {
    describe(name, () => {
      test('both empty → none', () => {
        expect(decideAnnotationsColdStart(input({})).winner).toBe('none');
        expect(decideAnnotationsColdStart(input({ local: EMPTY, doc: EMPTY })).winner).toBe('none');
      });

      test('THE ERASER: unstamped hub emptiness + local content + hub body winner → local', () => {
        const d = decideAnnotationsColdStart(
          input({ local: STROKES, doc: EMPTY, localMtimeMs: 1000, bodyWinner: 'hub' })
        );
        expect(d.winner).toBe('local');
      });

      test('STAMPED hub delete-all newer than local content → hub (deletes are honored)', () => {
        const d = decideAnnotationsColdStart(
          input({ local: STROKES, doc: EMPTY, localMtimeMs: 1000, docEditAtMs: 2000 })
        );
        expect(d.winner).toBe('hub');
      });

      test('stamped hub delete-all OLDER than local content → local', () => {
        const d = decideAnnotationsColdStart(
          input({ local: STROKES, doc: EMPTY, localMtimeMs: 2000, docEditAtMs: 1000 })
        );
        expect(d.winner).toBe('local');
      });

      test('local delete-all (empty on disk) newer than hub stamp → local', () => {
        const d = decideAnnotationsColdStart(
          input({ local: EMPTY, doc: STROKES, localMtimeMs: 2000, docEditAtMs: 1000 })
        );
        expect(d.winner).toBe('local');
      });

      test('local emptiness with no doc stamp → hub (unstamped local emptiness loses too)', () => {
        const d = decideAnnotationsColdStart(
          input({ local: EMPTY, doc: STROKES, localMtimeMs: 2000 })
        );
        expect(d.winner).toBe('hub');
      });
    });
  }

  test('unset hub lane + local content → local (seed up), even with hub body winner', () => {
    const d = decideAnnotationsColdStart(
      input({ local: STROKES, doc: '', localMtimeMs: 1000, bodyWinner: 'hub' })
    );
    expect(d.winner).toBe('local');
  });

  test('local absent + hub content → hub (clean first sync materializes)', () => {
    const d = decideAnnotationsColdStart(input({ doc: STROKES }));
    expect(d.winner).toBe('hub');
  });
});

describe('decideAnnotationsColdStart — both non-empty', () => {
  test('equal content → none', () => {
    const d = decideAnnotationsColdStart(input({ local: STROKES, doc: STROKES }));
    expect(d.winner).toBe('none');
  });

  test('newest wins by per-lane stamp: local newer → local', () => {
    const d = decideAnnotationsColdStart(
      input({ local: STROKES, doc: STROKES_B, localMtimeMs: 2000, docEditAtMs: 1000 })
    );
    expect(d.winner).toBe('local');
  });

  test('newest wins by per-lane stamp: doc newer → hub', () => {
    const d = decideAnnotationsColdStart(
      input({ local: STROKES, doc: STROKES_B, localMtimeMs: 1000, docEditAtMs: 2000 })
    );
    expect(d.winner).toBe('hub');
  });

  test('no per-lane stamp → follows the body winner (legacy coupling)', () => {
    expect(
      decideAnnotationsColdStart(
        input({ local: STROKES, doc: STROKES_B, localMtimeMs: 1000, bodyWinner: 'local' })
      ).winner
    ).toBe('local');
    expect(
      decideAnnotationsColdStart(
        input({ local: STROKES, doc: STROKES_B, localMtimeMs: 1000, bodyWinner: 'hub' })
      ).winner
    ).toBe('hub');
  });
});

/* ------------------------------------------------------- codec round-trip */

describe('stampAnnotationsEdit / annotationsEditAtFromDoc', () => {
  test('round-trips; absent stamp reads null', () => {
    const doc = new Y.Doc();
    expect(annotationsEditAtFromDoc(doc)).toBe(null);
    stampAnnotationsEdit(doc, undefined, 12345);
    expect(annotationsEditAtFromDoc(doc)).toBe(12345);
  });
});

/* ------------------------------------------------------ agent integration */

let dir: string;
let agent: CanvasSyncAgent;
let docA: Y.Doc;
let docB: Y.Doc;

function paths() {
  return {
    html: join(dir, 'screen.html'),
    comments: join(dir, '_comments', 'screen.json'),
    annotations: join(dir, 'screen.annotations.json'),
  };
}
const legacyPath = () => join(dir, 'screen.annotations.svg');

/** Put the hub's stale, UNSTAMPED emptiness into `doc` in one of its two shapes. */
type HubEmpty = 'v2-empty' | 'v1-wrapper';
function hubEmptiness(doc: Y.Doc, shape: HubEmpty): void {
  if (shape === 'v2-empty') writeReplica(doc, [], 'hub');
  else doc.getMap(LEGACY_TYPE).set('svg', EMPTY_WRAPPER);
  // Precondition: the hub side genuinely reads as "populated but empty".
  expect(annotationsFromDoc(doc)).toBe(EMPTY_BOARD);
  expect(annotationsEditAtFromDoc(doc)).toBe(null);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-ann-cold-'));
  docA = new Y.Doc();
  docB = new Y.Doc();
  const TRANSPORT = Symbol('transport');
  docA.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === TRANSPORT) return;
    Y.applyUpdate(docB, update, TRANSPORT);
  });
  docB.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === TRANSPORT) return;
    Y.applyUpdate(docA, update, TRANSPORT);
  });
});

afterEach(() => {
  agent?.stop();
  rmSync(dir, { recursive: true, force: true });
});

function makeAgent(): CanvasSyncAgent {
  const a = createCanvasSyncAgent({
    slug: 'screen',
    doc: docB,
    paths: paths(),
    echoGuard: createEchoGuard(),
    flushMs: 0,
  });
  a.start();
  return a;
}

describe('cold start — the eraser scenario end to end', () => {
  for (const shape of ['v2-empty', 'v1-wrapper'] as const) {
    test(`unstamped hub emptiness (${shape}) does NOT erase local content; local seeds up + stamps`, async () => {
      // Hub holds stale emptiness with no per-lane stamp — the exact pre-fix
      // state of every wiped canvas.
      hubEmptiness(docA, shape);
      // Local disk holds real content with an image reference.
      writeFileSync(paths().annotations, STROKES);

      agent = makeAgent();
      await agent.reconcile();

      // Disk keeps the content; the doc now carries it, stamped.
      expect(readFileSync(paths().annotations, 'utf8')).toBe(STROKES);
      expect(annotationsFromDoc(docB)).toBe(STROKES);
      expect(annotationsFromDoc(docA)).toBe(STROKES); // propagated to the hub side
      expect(annotationsEditAtFromDoc(docB)).not.toBe(null);
      expect(annotationsEditAtFromDoc(docA)).not.toBe(null);
    });
  }

  test('a local board still stored as a legacy .annotations.svg (boot migration not yet run) is not erased', async () => {
    // The race `readLocalAnnotations` exists for: without the legacy fallback
    // the cold start sees "no local" and the hub's emptiness wins by default.
    hubEmptiness(docA, 'v2-empty');
    writeFileSync(legacyPath(), LEGACY.svg);

    agent = makeAgent();
    await agent.reconcile();

    expect(annotationsFromDoc(docB)).toBe(LEGACY.board);
    expect(annotationsFromDoc(docA)).toBe(LEGACY.board);
    expect(annotationsEditAtFromDoc(docA)).not.toBe(null);
    expect(boardIds(annotationsFromDoc(docA))).toEqual(['s_1']);
    // The legacy file is left for the boot migration, never deleted here.
    expect(readFileSync(legacyPath(), 'utf8')).toBe(LEGACY.svg);
  });

  test('stamped hub delete-all newer than local content IS honored on disk', async () => {
    writeFileSync(paths().annotations, STROKES);
    // Backdate the local file so the hub's delete-all stamp is provably newer.
    const past = new Date(Date.now() - 60_000);
    utimesSync(paths().annotations, past, past);
    docA.transact(() => {
      writeReplica(docA, [], 'hub');
    });
    stampAnnotationsEdit(docA, undefined, Date.now());

    agent = makeAgent();
    await agent.reconcile();

    expect(readFileSync(paths().annotations, 'utf8')).toBe(EMPTY_BOARD);
    expect(annotationsFromDoc(docB)).toBe(EMPTY_BOARD);
  });

  test('clean first sync still materializes hub content to disk', async () => {
    applyAnnotationsToDoc(docA, STROKES);
    expect(existsSync(paths().annotations)).toBe(false);

    agent = makeAgent();
    await agent.reconcile();

    expect(readFileSync(paths().annotations, 'utf8')).toBe(STROKES);
  });

  test('clean first sync from a not-yet-migrated v1 hub doc materializes the migrated board', async () => {
    docA.getMap(LEGACY_TYPE).set('svg', LEGACY.svg);

    agent = makeAgent();
    await agent.reconcile();

    expect(readFileSync(paths().annotations, 'utf8')).toBe(LEGACY.board);
  });

  for (const shape of ['v2-empty', 'v1-wrapper'] as const) {
    test(`SHARED-DOC eraser: migrateSeed rescues local content from unstamped hub emptiness (${shape})`, async () => {
      // The cell-side copy of the eraser: hub doc has a newer body (so the body
      // resolution keeps the hub) and stale unstamped emptiness in the
      // annotations lane; local disk has real content.
      const doc = new Y.Doc();
      applyHtmlToDoc(doc, '<main>hub body</main>');
      hubEmptiness(doc, shape);
      writeFileSync(paths().html, '<main>hub body</main>'); // body identical → noop path
      writeFileSync(paths().annotations, STROKES);

      await migrateSeed({ slug: 'screen', doc, paths: paths() });

      // The doc now carries the local content, stamped — so the collab room's
      // persistJson materializes content, not emptiness.
      expect(annotationsFromDoc(doc)).toBe(STROKES);
      expect(annotationsEditAtFromDoc(doc)).not.toBe(null);
    });
  }

  test('applyFromFs stamps annotationsEditAt in the same update', () => {
    agent = makeAgent();
    // Count the updates reaching the other peer: content + stamp must be ONE.
    let updates = 0;
    docA.on('update', () => {
      updates++;
    });
    const bytes = new TextEncoder().encode(STROKES);
    const changed = agent.applyFromFs({
      path: paths().annotations,
      bytes,
      hash: hashBytes(STROKES),
    });
    expect(changed).toBe(true);
    expect(annotationsFromDoc(docB)).toBe(STROKES);
    expect(annotationsEditAtFromDoc(docB)).not.toBe(null);
    // The stamp crossed to the other peer with the same update.
    expect(annotationsEditAtFromDoc(docA)).not.toBe(null);
    expect(annotationsFromDoc(docA)).toBe(STROKES);
    expect(updates).toBe(1);
  });

  test('applyFromFs of a local delete-all stamps it, so it survives the next cold start', () => {
    applyAnnotationsToDoc(docA, STROKES);
    agent = makeAgent();
    const bytes = new TextEncoder().encode(EMPTY_BOARD);
    expect(
      agent.applyFromFs({ path: paths().annotations, bytes, hash: hashBytes(EMPTY_BOARD) })
    ).toBe(true);
    expect(annotationsFromDoc(docA)).toBe(EMPTY_BOARD);
    expect(annotationsEditAtFromDoc(docA)).not.toBe(null);
  });
});
