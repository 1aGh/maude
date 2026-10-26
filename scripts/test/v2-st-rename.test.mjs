// V2-8.0 part C — the st-* family rename and its inverse (the nothing-deleted ledger reads through it).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPlan, renameText, toV1Names } from '../v2-verify/st-rename.mjs';

const plan = { share: 'sh', cp: 'insp', ex: 'sh', _keep: ['st-ex-keepme'] };

test('a family moves whole, dynamic suffixes included', () => {
  assert.equal(
    renameText('<b className={`st-share-ic st-cp-row--${k}`}/> .st-share{} st-share', plan),
    '<b className={`sh-share-ic insp-cp-row--${k}`}/> .sh-share{} sh-share'
  );
});

test('only a whole family token is renamed — never a substring, a custom property or a data attribute', () => {
  const src = 'first-share --st-share data-st-share st-shares st-export st-ex';
  assert.equal(
    renameText(src, plan),
    'first-share --st-share data-st-share st-shares st-export sh-ex'
  );
});

test('_keep names (frozen testids) stay', () => {
  assert.equal(renameText('st-ex-keepme st-ex-other', plan), 'st-ex-keepme sh-ex-other');
});

test('toV1Names inverts the rename; inSlug also reads `-`-joined slugs', () => {
  const live = 'sh-share-ic insp-cp-row';
  assert.equal(toV1Names(renameText('st-share-ic st-cp-row', plan), plan), 'st-share-ic st-cp-row');
  assert.equal(toV1Names(live, plan), 'st-share-ic st-cp-row');
  assert.equal(toV1Names('x/insp-cp-a-insp-cp-b', plan), 'x/st-cp-a-insp-cp-b');
  assert.equal(toV1Names('x/insp-cp-a-insp-cp-b', plan, { inSlug: true }), 'x/st-cp-a-st-cp-b');
});

test('the committed plan maps every family to a namespace other than st', () => {
  const p = readPlan();
  for (const [fam, ns] of Object.entries(p)) {
    if (fam.startsWith('_')) continue;
    assert.match(fam, /^[a-z0-9]+$/);
    assert.notEqual(ns, 'st', fam);
  }
});
