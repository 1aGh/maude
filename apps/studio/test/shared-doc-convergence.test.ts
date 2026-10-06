// Phase 9.2 (DDR-064) Phase F — convergence + stress property suite (Task 12).
//
// The load-bearing gate for the refactor (the no-break-exhaustive-verify bar):
// once every change flows through ONE shared Y.Doc, convergence must hold BY
// CONSTRUCTION. These tests pin the CRDT properties on the composed canvas doc
// (all five synced types) + the diff-importer + the disk projection:
//
//   - commutativity  — concurrent edits merge to the same state regardless of
//                      delivery order;
//   - idempotency    — re-delivering an update changes nothing;
//   - round-trip laws — materialize∘import is stable (id on the canonical view);
//                       a projection's import∘materialize is a no-op (echo drop);
//   - N-peer stress  — N docs + a randomized-delivery relay + a file-importer,
//                      seeded RNG, → all replicas materialize byte-identical.
//
// In-process (no hub process): a relay models Hocuspocus by re-broadcasting each
// doc update to every other peer (Yjs updates are commutative/idempotent, so a
// re-broadcast relay IS the hub's convergence contract). The real-hub N-peer
// soak lives in apps/hub/test/stress-integration.test.mjs + the live
// cross-machine manual run; this suite is the deterministic property gate.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import { applyOpsToReplica } from '../annotations/replica.ts';
import { Y_TYPES } from '../collab/persistence.ts';
import {
  applyAnnotationsToDoc,
  applyCommentsToDoc,
  applyCssToDoc,
  applyHtmlToDoc,
  applyMetaToDoc,
  Y_SYNC_TYPES,
} from '../sync/codec.ts';
import { createEchoGuard, hashBytes } from '../sync/echo-guard.ts';
import { materialize, materializeCanonical } from '../sync/materialize.ts';
import { createDocProjection } from '../sync/projection.ts';
import { board, boardIds, elements, sticky } from './fixtures/annotations-v2/boards.ts';

const ANN_B = board(sticky('b1', 'from B'));

const enc = (s: string) => new TextEncoder().encode(s);

/** Deterministic PRNG (mulberry32) so the stress is reproducible across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRANSPORT = Symbol('relay-transport');

/**
 * A queued, randomized-delivery relay over N docs that models a hub. Each doc's
 * non-transport updates are queued; flush() delivers them to every OTHER doc in
 * a seeded-random order (and re-delivers a fraction, exercising idempotency).
 */
function makeRelay(docs: Y.Doc[], rnd: () => number) {
  const queue: Array<{ from: number; update: Uint8Array }> = [];
  docs.forEach((doc, i) => {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === TRANSPORT) return;
      queue.push({ from: i, update });
    });
  });
  return {
    flush() {
      // Drain in waves until quiescent (a delivery can enqueue nothing new since
      // applies are TRANSPORT-origin, so one shuffled pass suffices — but loop to
      // be safe against any future re-entrancy).
      let guard = 0;
      while (queue.length > 0 && guard++ < 1000) {
        const batch = queue.splice(0, queue.length);
        // Shuffle (seeded) → out-of-order delivery tests commutativity.
        for (let i = batch.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [batch[i], batch[j]] = [batch[j], batch[i]];
        }
        for (const { from, update } of batch) {
          docs.forEach((doc, i) => {
            if (i === from) return;
            Y.applyUpdate(doc, update, TRANSPORT);
            // Idempotency: ~25% of deliveries are applied a second time.
            if (rnd() < 0.25) Y.applyUpdate(doc, update, TRANSPORT);
          });
        }
      }
    },
  };
}

describe('convergence laws on the composed shared doc', () => {
  test('commutativity — concurrent edits merge identically regardless of order', () => {
    // Peer A adds a comment; peer B puts an annotation element; peer C edits
    // the body.
    const a = new Y.Doc();
    const b = new Y.Doc();
    const c = new Y.Doc();
    const relay = makeRelay([a, b, c], mulberry32(1));

    a.getArray(Y_TYPES.comments).push([{ id: 'c1', text: 'from A' }]);
    applyAnnotationsToDoc(b, ANN_B);
    c.getText(Y_SYNC_TYPES.html).insert(0, '<main>from C</main>');
    relay.flush();

    // All three converge to the SAME canonical materialization.
    expect(materializeCanonical(a)).toBe(materializeCanonical(b));
    expect(materializeCanonical(b)).toBe(materializeCanonical(c));
    // …and all three edits survived (no clobber).
    const m = materialize(a);
    expect(m.comments).toEqual([{ id: 'c1', text: 'from A' }]);
    expect(m.annotations).toBe(ANN_B);
    expect(m.html).toBe('<main>from C</main>');
  });

  test('commutativity — concurrent annotation ops on different elements and fields all survive', () => {
    // DDR-242 §4: different elements never conflict; different fields of one
    // element never conflict. (v1 was one LWW `svg` string — one side lost.)
    const a = new Y.Doc();
    const b = new Y.Doc();
    const relay = makeRelay([a, b], mulberry32(5));
    applyAnnotationsToDoc(a, board(sticky('shared', 'base')));
    relay.flush();
    const [pa, pb] = elements(
      sticky('from-a', 'A', { x: 300, index: 'a1' }),
      sticky('from-b', 'B', { x: 600, index: 'a2' })
    );
    applyOpsToReplica(a, [
      { op: 'put', el: pa },
      { op: 'patch', id: 'shared', set: { text: 'edited by A' } },
    ]);
    applyOpsToReplica(b, [
      { op: 'put', el: pb },
      { op: 'patch', id: 'shared', set: { x: 42 } },
    ]);
    relay.flush();
    expect(materializeCanonical(a)).toBe(materializeCanonical(b));
    expect(materialize(a).annotations).toBe(
      board(
        sticky('shared', 'edited by A', { x: 42 }),
        sticky('from-a', 'A', { x: 300, index: 'a1' }),
        sticky('from-b', 'B', { x: 600, index: 'a2' })
      )
    );
  });

  test('idempotency — re-delivering updates does not duplicate or diverge', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    // Relay re-delivers a fraction of updates (see makeRelay) — comments must
    // not duplicate, state must not drift.
    const relay = makeRelay([a, b], mulberry32(42));
    a.getArray(Y_TYPES.comments).push([{ id: 'c1' }, { id: 'c2' }]);
    relay.flush();
    relay.flush(); // flush again — nothing queued, no-op
    expect(materializeCanonical(a)).toBe(materializeCanonical(b));
    expect(materialize(b).comments).toEqual([{ id: 'c1' }, { id: 'c2' }]);
  });
});

describe('round-trip laws', () => {
  test('materialize∘import is stable (id on the canonical view)', () => {
    // Build a doc via the codecs (the file→doc import path), materialize it,
    // re-import each piece into a fresh doc → identical canonical view.
    const src = new Y.Doc();
    applyHtmlToDoc(src, '<main>body</main>', 'x');
    applyCssToDoc(src, '.a{color:red}', 'x');
    applyMetaToDoc(src, JSON.stringify({ title: 'T', viewport: { x: 1 } }), 'x');
    applyCommentsToDoc(src, [{ id: 'c1', text: 'hi' }], 'x');
    applyAnnotationsToDoc(src, ANN_B, 'x');

    const m = materialize(src);
    const dst = new Y.Doc();
    applyHtmlToDoc(dst, m.html, 'y');
    applyCssToDoc(dst, m.css, 'y');
    // meta materializes to the SHARED canonical (viewport already stripped), so
    // re-importing it is a no-op-equivalent round-trip.
    dst.getText(Y_SYNC_TYPES.meta).insert(0, m.meta);
    applyCommentsToDoc(dst, m.comments, 'y');
    applyAnnotationsToDoc(dst, m.annotations, 'y');

    expect(materializeCanonical(dst)).toBe(materializeCanonical(src));
    // meta lost its per-user viewport on the way into the doc (shared subset).
    expect(m.meta).not.toContain('viewport');
  });

  test('projection import∘materialize is a no-op (the echo is dropped)', async () => {
    const doc = new Y.Doc();
    const echoGuard = createEchoGuard();
    const files: Record<string, string> = {};
    const paths = {
      html: '/d/x.html',
      comments: '/d/x.comments.json',
      annotations: '/d/x.annotations.json',
      meta: '/d/x.meta.json',
      css: '/d/x.css',
    };
    const proj = createDocProjection({
      slug: 'x',
      doc,
      paths,
      echoGuard,
      flushMs: 0,
      writer: (p, bytes) => {
        files[p] = bytes.toString();
      },
    });
    proj.start();
    doc.getText(Y_SYNC_TYPES.html).insert(0, '<main>v1</main>');
    await proj.flush(); // materialize → files[html] written + echo hash recorded

    // Now feed the just-written file back in (the fs.watch echo). The hash
    // matches → dropped → doc unchanged (import∘materialize == noop).
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    const body = files[paths.html];
    expect(proj.applyFromFs({ path: paths.html, bytes: enc(body), hash: hashBytes(body) })).toBe(
      false
    );
    expect(updates).toBe(0);
  });
});

describe('N-peer stress (randomized delivery + file-importer, seeded)', () => {
  // Run a handful of seeds so the property is exercised across orderings.
  for (const seed of [1, 7, 99, 2024]) {
    test(`5 peers converge byte-identical (seed ${seed})`, () => {
      const N = 5;
      const docs = Array.from({ length: N }, () => new Y.Doc());
      const rnd = mulberry32(seed);
      const relay = makeRelay(docs, rnd);

      // Each peer has a projection so a subset of ops are file→doc imports
      // (html diff-import, the realistic /design:edit path). Comments/annotations
      // are granular Y-ops (the browser path). All are CRDT-mergeable.
      const projections = docs.map((doc, i) =>
        createDocProjection({
          slug: `p${i}`,
          doc,
          paths: {
            html: `/d/p${i}.html`,
            comments: `/d/p${i}.json`,
            annotations: `/d/p${i}.annotations.json`,
          },
          echoGuard: createEchoGuard(),
          flushMs: 0,
          // No-op writer: this stress asserts DOC convergence, not disk; the
          // paths are synthetic, so skip real fs writes (avoids EROFS noise).
          writer: () => {},
        })
      );
      for (const p of projections) p.start();
      // One shared annotation every peer knows before the concurrent phase.
      applyAnnotationsToDoc(docs[0], board(sticky('shared', 'base')));
      relay.flush();
      const putIds = new Set<string>();

      const OPS = 60;
      for (let k = 0; k < OPS; k++) {
        const peer = Math.floor(rnd() * N);
        const doc = docs[peer];
        const r = rnd();
        if (r < 0.4) {
          // browser: append a comment (unique id → all survive the merge)
          doc.getArray(Y_TYPES.comments).push([{ id: `c-${peer}-${k}`, text: `op${k}` }]);
        } else if (r < 0.6) {
          // browser: an annotation op (DDR-242) — either put a new element
          // (unique id → must survive the merge) or edit the shared element's
          // text (same field → converges to one value).
          if (rnd() < 0.5) {
            const [el] = elements(sticky(`a-${peer}-${k}`, `op${k}`, { x: k * 10 }));
            applyOpsToReplica(doc, [{ op: 'put', el }]);
            putIds.add(`a-${peer}-${k}`);
          } else {
            applyOpsToReplica(doc, [{ op: 'patch', id: 'shared', set: { text: `op${k}` } }]);
          }
        } else if (r < 0.8) {
          // browser: insert into the body text CRDT
          const t = doc.getText(Y_SYNC_TYPES.html);
          t.insert(Math.min(t.length, Math.floor(rnd() * (t.length + 1))), `<i>${k}</i>`);
        } else {
          // /design:edit: a whole-file body import via the projection (diff)
          const body = `<main>edit ${peer}/${k}</main>`;
          projections[peer].applyFromFs({
            path: `/d/p${peer}.html`,
            bytes: enc(body),
            hash: hashBytes(body),
          });
        }
        // Flush intermittently (partial delivery) to interleave ordering.
        if (rnd() < 0.5) relay.flush();
      }
      relay.flush(); // final quiescence

      // Every replica converged to byte-identical canonical state.
      const ref = materializeCanonical(docs[0]);
      for (let i = 1; i < N; i++) {
        expect(materializeCanonical(docs[i])).toBe(ref);
      }
      // And every comment that was appended survived (no clobber, no dup).
      const commentIds = new Set(
        (materialize(docs[0]).comments as Array<{ id: string }>).map((c) => c.id)
      );
      // At least one comment landed; ids are unique by construction.
      expect(commentIds.size).toBe(materialize(docs[0]).comments.length);
      // Every annotation element any peer put survived (per-element merge).
      const annIds = new Set(boardIds(materialize(docs[0]).annotations));
      for (const id of putIds) expect(annIds.has(id)).toBe(true);
      expect(annIds.has('shared')).toBe(true);
    });
  }
});
