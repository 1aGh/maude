import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { createDocumentEvents } from '../src/document-events.mjs';
import { createFilesPoke, parsePoke } from '../src/files-ctl.mjs';

test('stored membership/retirement announce; ordinary content edits do not rescan the project', () => {
  let notifications = 0;
  const events = createDocumentEvents({ poke: { schedule: () => notifications++ } });
  const doc = new Y.Doc();
  doc.getMap('syncMeta').set('path', 'ui/Board.tsx');
  const input = { documentName: 'ui-board', document: doc };
  events.stored(input);
  doc.getText('html').insert(0, 'first body');
  events.stored(input);
  assert.equal(notifications, 2, 'empty persisted document becoming materializable is a change');
  for (let i = 0; i < 100; i++) {
    doc.getText('html').insert(0, 'x');
    events.stored(input);
  }
  assert.equal(notifications, 2, 'keystrokes do not trigger discovery');
  doc.getMap('syncMeta').set('movedTo', 'ui/Nested/Board.tsx');
  events.stored(input);
  assert.equal(notifications, 3);
  events.changed();
  assert.equal(notifications, 4, 'explicit deletion/revival invalidates');
  events.stored({ ...input, documentName: 'maude.files' });
  assert.equal(notifications, 4, 'control document never invalidates itself');
  doc.destroy();
});

test('document-only invalidation is payload-free and remains readable by old file-control clients', () => {
  const frames = [];
  const poke = createFilesPoke({
    instance: {
      documents: new Map([['maude.files', { broadcastStateless: (frame) => frames.push(frame) }]]),
    },
    documentsOnly: true,
  });
  for (let i = 0; i < 100; i++) poke.schedule(0);
  poke.flushNow();
  assert.equal(frames.length, 1);
  assert.deepEqual(JSON.parse(frames[0]), { t: 'files', head: 0, documents: true });
  assert.deepEqual(parsePoke(frames[0]), { head: 0, documents: true });
  poke.stop();
});

test('malformed document metadata cannot abort the storage hook', () => {
  const events = createDocumentEvents({ poke: { schedule() {} } });
  assert.doesNotThrow(() =>
    events.stored({
      documentName: 'ui-bad',
      document: {
        getMap() {
          throw new Error('different Yjs shared type');
        },
      },
    })
  );
});
