// V2-5 A3 lead (S9.4 × S9.5) — the file plane names a canvas's document with the
// SAME slug the document door does (`docSlugOf`), so a non-ASCII canvas name
// (`Plakát.tsx` → document slug `plak-t`) still reaches its canvas-only session.
// Before, `access-files` used `canvasSlugFromRel` (`plakát`), the names never
// matched, and that canvas's document pokes were silently dropped.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { docSlugOf } from '../src/access-docs.mjs';
import { createPokeVisibility, fileAccessForClaim } from '../src/access-files.mjs';

const PLAKAT = 'ui/Plakát.tsx';
const OTHER = 'ui/Jiný.tsx';
const claim = { v: 1, role: null, grants: [{ c: PLAKAT, r: 'member' }] };
const docName = (canvas) => `ws/local/main/${docSlugOf(canvas)}`;

describe('a non-ASCII canvas name on the file plane', () => {
  test('the document door and the file plane agree on the slug', () => {
    assert.equal(docSlugOf(PLAKAT), 'ui-plak-t');
    const files = fileAccessForClaim(claim);
    assert.equal(files.seesDocument(docName(PLAKAT)), true);
    assert.equal(files.seesDocument(docName(OTHER)), false);
  });

  test('the granted canvas’s document pokes reach the canvas-only connection', () => {
    const pokes = createPokeVisibility({ designRoot: null, journal: null });
    const connection = { context: { user: { access: claim } } };
    assert.equal(pokes.documentsVisible(connection, [{ documentName: docName(PLAKAT) }]), true);
    assert.equal(pokes.documentsVisible(connection, [{ documentName: docName(OTHER) }]), false);
  });
});
