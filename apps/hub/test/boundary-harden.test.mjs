// p8-boundary-harden — the hub half of the final-3 security pair over the hub folder boundary
// (decision maude/v2-michal-hub-is-the-folder-boundary-before-config).
//
// M1 / attacker L3: an undeclared hub's kernel takes any folder (`allowUndeclaredGroup`), and the
// shared validator let that folder start with `_` or `-`, or be `node_modules` — a teammate could
// propose a canvas into `_state/`, `_history/<slug>/` or `node_modules/`. The kernel uses the same
// validator as the studio, so the first-component rule applies here too.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { body, rig } from './_kernel-rig.mjs';

const slugOf = (rel) => rel.replace(/\.tsx$/, '').replace(/\//g, '-').toLowerCase();

describe('M1 — an undeclared kernel refuses runtime and node_modules folders', () => {
  for (const rel of [
    '_state/x.tsx',
    '_history/s/x.tsx',
    '_comments/x.tsx',
    '-x/y.tsx',
    'node_modules/p/index.tsx',
    'NODE_MODULES/p/index.tsx',
  ]) {
    test(`doc.create at ${rel} is refused`, async () => {
      const r = rig(null);
      const doc = `ws/local/main/${slugOf(rel)}`;
      const res = await r.propose('you', [
        { op: 'doc.create', doc, path: rel, lanes: { html: body() } },
      ]);
      assert.notEqual(res.status, 200, JSON.stringify(res.body));
      assert.match(JSON.stringify(res.body), /no group may be/);
      assert.equal(await r.docRow(doc), null);
    });
  }

  test('an ordinary undeclared folder is still accepted', async () => {
    const r = rig(null);
    await r.create('you', 'ws/local/main/screens-home', 'screens/home.tsx');
    assert.ok(await r.docRow('ws/local/main/screens-home'));
  });
});
