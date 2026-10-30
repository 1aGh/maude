// S11.19: no row's `v2.where` names a v1 component (SyncPanel, GitPanel, CloudBar, ...). The name list is
// derived from the frozen v1 manifest and the v1 component files (scripts/v2-manifest/v1-names.mjs); the
// check itself is also criterion 4 of scripts/check-v2-nothing-deleted.mjs, so the 100 % gate holds it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { v1ComponentNames, v1NamesInWhere } from '../v2-manifest/v1-names.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const manifest = json('apps/studio/client/v2/v1-manifest.json');
const nd = json('apps/studio/client/v2/nothing-deleted.json');
const names = v1ComponentNames(ROOT, manifest);

test('the derived list holds the v1 panels the slice plan names', () => {
  for (const n of ['SyncPanel', 'GitPanel', 'CloudBar', 'SettingsPanel', 'IdentityBar', 'DiffView'])
    assert.ok(names.includes(n), `${n} missing from the derived v1 names`);
});

test('single-word and brand names are never banned', () => {
  for (const n of ['Sidebar', 'Welcome', 'Row', 'GitHub', 'FigJam']) assert.ok(!names.includes(n));
});

test('v1NamesInWhere matches whole words only', () => {
  const rows = [
    { id: 'a', v2: { where: 'Menu › Diagnostics › Sync (not the SyncPanel)' } },
    { id: 'b', v2: { where: 'Settings › Connections › GitHub › Sign in' } },
    { id: 'c', v2: { where: 'mounts GitPanelX, SyncPanels and xCloudBar' } },
    { id: 'd', orphaned: true, v2: { where: 'CloudBar' } },
  ];
  assert.deepEqual(v1NamesInWhere(rows, ['SyncPanel', 'GitPanel', 'CloudBar']), [
    { id: 'a', name: 'SyncPanel' },
  ]);
});

test('no row names a v1 component in its v2.where', () => {
  const hits = v1NamesInWhere(nd.rows, names);
  assert.deepEqual(
    hits,
    [],
    `v2.where must name the v2 surface a person follows, not the v1 body:\n${hits.map((h) => `  ${h.id}: ${h.name}`).join('\n')}`
  );
});

test('nothing was deleted to get there: every row still has a where and an id', () => {
  const live = nd.rows.filter((r) => !r.orphaned);
  assert.ok(live.length >= 144, `only ${live.length} live rows`);
  for (const r of live) assert.ok(r.v2?.where && (r.v2.action || r.v2.testid), r.id);
});
