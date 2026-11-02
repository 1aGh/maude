// V2-1.16 L3 — the `maude.files` control channel and pokes (S9.4).
//
// The poke broadcast `{t:'files', head}` to every ctl connection of every
// scope: a timing signal for every write anywhere, and the documents poke fired
// on any canvas's create / rename / delete. Now a connection admitted with a
// canvas-only claim hears a frame only when the appended journal row or the
// document event is one it can see, with ITS visible head; project connections
// keep the broadcast. The payload stays one integer (V2-1.12).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createPokeVisibility, resetFileAccessCaches } from '../src/access-files.mjs';
import { createDocumentEvents } from '../src/document-events.mjs';
import { createFilesPoke, FILES_CTL_DOC } from '../src/files-ctl.mjs';
import { closeJournal, openJournal } from '../src/journal.mjs';
import { writeProject } from './_acl-files-fixture.mjs';

let dataDir;
let designRoot;
let journal;

before(() => {
  resetFileAccessCaches();
  dataDir = mkdtempSync(join(tmpdir(), 'maude-acl-l3-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'maude-acl-l3-design-'));
  writeProject(designRoot);
  journal = openJournal(dataDir);
  for (const p of [
    'assets/a-only.png',
    'assets/b-only.png',
    'assets/shared.png',
    'ui/a-styles.css',
    'ui/b-styles.css',
  ]) {
    journal.recordWrite({ designRoot, path: p, source: 'peer-put' });
  }
});
after(() => {
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

/** A connection as Hocuspocus hands it to `getConnections()`. */
function connection(user) {
  const frames = [];
  return { context: { user }, frames, sendStateless: (p) => frames.push(JSON.parse(p)) };
}

/** A fake instance whose ctl document fans out like Hocuspocus's (filter honoured). */
function instanceWith(connections) {
  const doc = {
    getConnections: () => connections,
    broadcastStateless(payload, filter) {
      for (const c of filter ? connections.filter(filter) : connections) c.sendStateless(payload);
    },
  };
  return { documents: new Map([[FILES_CTL_DOC, doc]]) };
}

const GRANT_A = { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] };

function rig({ documentsOnly = false } = {}) {
  const project = connection({ name: 'member', scope: '*' });
  const projectV2 = connection({ name: 'viewer2', scope: '*', access: { v: 1, role: 'viewer' } });
  const canvasA = connection({ name: 'canvas-a', scope: 'canvas-a', access: GRANT_A });
  const poke = createFilesPoke({
    instance: instanceWith([project, projectV2, canvasA]),
    documentsOnly,
    coalesceMs: 1,
    visibility: createPokeVisibility({ designRoot, journal }),
  });
  return { project, projectV2, canvasA, poke };
}

const touch = (rel, body) => {
  writeFileSync(join(designRoot, rel), body);
  journal.recordWrite({ designRoot, path: rel, source: 'peer-put' });
  return journal.head();
};

describe('file pokes reach a canvas-only connection only for what it sees', () => {
  test('a B write: project connections hear it, A’s connection hears nothing', () => {
    const { project, projectV2, canvasA, poke } = rig();
    const head = touch('assets/b-only.png', Buffer.from([1, 2, 3, 4]));
    poke.schedule(head);
    poke.flushNow();
    assert.deepEqual(project.frames, [{ t: 'files', head }]);
    assert.deepEqual(projectV2.frames, [{ t: 'files', head }]);
    assert.deepEqual(canvasA.frames, []);
  });

  test('an A write: A’s connection hears it, with A’s own visible head', () => {
    const { project, canvasA, poke } = rig();
    const aHead = touch('assets/a-only.png', Buffer.from([5, 6, 7, 8]));
    poke.schedule(aHead);
    poke.flushNow();
    assert.deepEqual(canvasA.frames, [{ t: 'files', head: aHead }]);
    // …and a later B write in the same window does not raise it.
    const bHead = touch('ui/b-styles.css', '.b { color: green; }\n');
    poke.schedule(bHead);
    poke.flushNow();
    assert.deepEqual(canvasA.frames, [{ t: 'files', head: aHead }]);
    assert.deepEqual(project.frames.at(-1), { t: 'files', head: bHead });
  });

  test('without the visibility hook a canvas-only connection hears nothing (fail closed)', () => {
    const canvasA = connection({ name: 'canvas-a', access: GRANT_A });
    const project = connection({ name: 'member', scope: '*' });
    const poke = createFilesPoke({ instance: instanceWith([project, canvasA]), coalesceMs: 1 });
    const head = touch('assets/a-only.png', Buffer.from([9, 9, 9, 9]));
    poke.schedule(head);
    poke.flushNow();
    assert.deepEqual(canvasA.frames, []);
    assert.equal(project.frames.length, 1);
  });
});

describe('document pokes', () => {
  test('B’s rename produces no frame on A’s connection; A’s does', () => {
    const { project, canvasA, poke } = rig({ documentsOnly: true });
    const events = createDocumentEvents({ poke });
    const docFor = (path, html) => ({
      getMap: () => new Map([['path', path]]),
      getText: () => ({ length: html.length }),
    });
    events.stored({ documentName: 'ws/w/main/ui-b', document: docFor('ui/b-renamed.tsx', 'x') });
    poke.flushNow();
    assert.deepEqual(project.frames, [{ t: 'files', head: 0, documents: true }]);
    assert.deepEqual(canvasA.frames, []);
    events.stored({ documentName: 'ws/w/main/ui-a', document: docFor('ui/a.tsx', 'x') });
    poke.flushNow();
    assert.deepEqual(canvasA.frames, [{ t: 'files', head: 0, documents: true }]);
  });

  test('an event that names nothing is not told to a canvas-only connection', () => {
    const { project, canvasA, poke } = rig({ documentsOnly: true });
    createDocumentEvents({ poke }).changed();
    poke.flushNow();
    assert.equal(project.frames.length, 1);
    assert.deepEqual(canvasA.frames, []);
  });
});
