// Plan T30 — a crash DURING the import, not before it.
//
// `mode-switch-resume.test.mjs` covers the seam the switch is most likely to
// die on: the mode is persisted and nothing is imported yet. The import itself
// is CHUNKED, though, and `runBaselineImport`'s contract is that a chunk the
// kernel refuses leaves the resume note set so the next start finishes it —
// "idempotent against the store: it creates only what the store lacks".
//
// That sentence was a comment. This is the test: a first pass that dies after
// its first chunk, then a second pass against a store that now holds what the
// first one wrote. The second must create exactly the remainder, never a
// duplicate, and never re-write a document the store already has.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as Y from 'yjs';
import { importBaseline } from '../src/project-transactions/baseline.mjs';

const CANVAS = (title) => `export default function C() {\n  return <h1>${title}</h1>;\n}\n`;

/** 250 documents — more than one chunk's worth of operations. */
function project(count) {
  const docs = [];
  for (let i = 0; i < count; i++) {
    const name = `ws/local/main/ui-c${i}`;
    const doc = new Y.Doc();
    doc.getText('html').insert(0, CANVAS(`Canvas ${i}`));
    doc.getMap('syncMeta').set('path', `ui/c${i}.tsx`);
    docs.push({ name, doc });
  }
  return docs;
}

/**
 * A store that remembers what the kernel accepted, so a second import sees the
 * first one's work exactly as the real store would.
 */
function fakeStore() {
  const held = new Map();
  return {
    held,
    async manifest() {
      return { revision: held.size, docs: [...held.values()] };
    },
    async state() {
      return { mode: 'transactions', epoch: 1, revision: held.size, importPending: true };
    },
  };
}

/** A kernel that accepts whole chunks, and can be told to refuse from one on. */
function fakeKernel(store, { failFromChunk = Infinity } = {}) {
  let chunk = 0;
  const seen = [];
  return {
    seen,
    async submit(envelope) {
      chunk += 1;
      const body = JSON.parse(
        typeof envelope === 'string' ? envelope : new TextDecoder().decode(envelope)
      );
      if (chunk >= failFromChunk)
        return { status: 409, body: { code: 'store-unavailable', reason: 'the disk went away' } };
      for (const op of body.action?.operations ?? []) {
        if (op.op !== 'doc.create') continue;
        seen.push(op.doc);
        store.held.set(op.doc, { doc: op.doc, path: op.path, retired: false, lanes: {} });
      }
      return { status: 200, body: { status: 'accepted', revision: store.held.size } };
    },
  };
}

function deps(docs, store, kernel, over = {}) {
  return {
    hocuspocus: {
      async openDirectConnection(name) {
        const found = docs.find((d) => d.name === name);
        return {
          async transact(fn) {
            fn(found.doc);
          },
          async disconnect() {},
        };
      },
    },
    store,
    kernel,
    projectId: 'local',
    listDocuments: () => docs.map((d) => ({ name: d.name })),
    canvasGroups: () => ['ui'],
    designRel: '.design',
    ...over,
  };
}

describe('an import that died half-way is finished, not repeated', () => {
  test('the second pass creates only what the store lacks', async () => {
    const docs = project(250);
    const store = fakeStore();

    // First pass: the store goes away on the second chunk.
    const first = await importBaseline(deps(docs, store, fakeKernel(store, { failFromChunk: 2 })));
    assert.ok(first.failed, 'the first pass must report where it stopped');
    assert.equal(first.failed.chunk, 2);
    const landed = store.held.size;
    assert.ok(landed > 0 && landed < 250, `a partial import, not all or nothing: ${landed}`);

    // Second pass: a fresh kernel, the store carrying the first pass's work.
    const resumeKernel = fakeKernel(store);
    const second = await importBaseline(deps(docs, store, resumeKernel));
    assert.equal(second.failed, undefined, JSON.stringify(second.failed ?? null));
    assert.equal(store.held.size, 250, 'every document is in the project');

    // THE POINT. Not one document the first pass had already written is
    // created again — a duplicate logical action is the failure this seam is
    // most likely to produce, and the one the plan forbids by name.
    const again = resumeKernel.seen.filter((d, i) => resumeKernel.seen.indexOf(d) !== i);
    assert.deepEqual(again, [], 'no document created twice within the resume');
    assert.equal(
      resumeKernel.seen.length,
      250 - landed,
      'the resume created exactly the remainder'
    );
  });

  test('a finished import re-run creates nothing at all', async () => {
    const docs = project(12);
    const store = fakeStore();
    await importBaseline(deps(docs, store, fakeKernel(store)));
    assert.equal(store.held.size, 12);
    const again = fakeKernel(store);
    const report = await importBaseline(deps(docs, store, again));
    assert.deepEqual(again.seen, [], 'nothing is created a second time');
    assert.equal(report.created, 0);
  });
});
