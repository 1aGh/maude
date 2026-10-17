// The nothing-deleted mapper's precedence rules (Phase 4 gate,
// apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md), on fixtures — no tree scan.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapEntries } from '../v2-manifest/map-entries.mjs';

const rows = [
  { id: 'A-resync', v2: { action: 'sync.resync', testid: 'project-menu-row-sync.resync' } },
  { id: 'D6', v2: { action: null, testid: null } },
];
const actions = new Map([
  ['sync.resync', { id: 'sync.resync', label: 'Resync now' }],
  ['edit.undo', { id: 'edit.undo', label: 'Undo', legacy: { menu: 'Undo' } }],
]);
const hooks = [
  { hook: 'canvas-list', v2: 'stable' },
  { hook: 'project-menu-row-sync.resync', v2: 'new' },
  { hook: '.dc-artboard-ghost', v2: 'historical' },
  { hook: 'menubar', v2: 'moves' },
];
const rules = [{ file: /context-menu\.tsx$/, to: 'D6' }];
const labelFiles = [/menubar\.jsx$/];
const e = (id, extra) => ({ id, file: `apps/${id.split(':')[1].split('#')[0]}`, ...extra });

function run(frozen, late = [], live = new Set()) {
  return mapEntries({ frozen, late, live, rows, actions, hooks, hand: {}, rules, labelFiles });
}

test('a hook re-emitted in v2 maps to itself, or to the row that names it', () => {
  const res = run([
    e('testid:studio/client/app.jsx#sidebar/canvas-list', {
      kind: 'testid',
      testid: 'canvas-list',
    }),
    e('testid:studio/x.jsx#r/project-menu-row-sync.resync', {
      kind: 'testid',
      testid: 'project-menu-row-sync.resync',
    }),
  ]);
  assert.equal(res.map['testid:studio/client/app.jsx#sidebar/canvas-list'], 'testid:canvas-list');
  assert.equal(res.map['testid:studio/x.jsx#r/project-menu-row-sync.resync'], 'A-resync');
});

test('a historical hook is excluded, never mapped', () => {
  const id = 'testid:studio/client/testids.json#c/.dc-artboard-ghost';
  const res = run([e(id, { kind: 'testid', testid: '.dc-artboard-ghost' })]);
  assert.equal(res.map[id], undefined);
  assert.match(res.excluded[id], /historical/);
});

test('a menu row resolves to its registry action — or to the row that owns that action', () => {
  const undo = e('item:studio/client/menus/menubar.jsx#EditDropdown/undo', {
    kind: 'item',
    label: 'Undo',
  });
  const resync = e('item:studio/client/menus/menubar.jsx#SyncDropdown/resync', {
    kind: 'item',
    label: 'Resync now…',
  });
  const res = run([undo, resync]);
  assert.equal(res.map[undo.id], 'action:edit.undo');
  assert.equal(res.map[resync.id], 'A-resync');
});

test('label matching only runs in menu / palette files', () => {
  const other = e('button:studio/client/panels/X.jsx#X/undo', { kind: 'button', label: 'Undo' });
  const res = run([other]);
  assert.deepEqual(
    res.unmapped.map((x) => x.id),
    [other.id]
  );
});

test('a late entry that only re-keyed a gone frozen entry inherits its target', () => {
  const was = e('item:studio/context-menu.tsx#A/fit', { kind: 'item', label: 'Fit' });
  const now = e('item:studio/context-menu.tsx#B/fit', { kind: 'item', label: 'Fit' });
  const res = run([was], [now], new Set([now.id]));
  assert.equal(res.map[now.id], 'D6');
  assert.match(res.via[now.id], /^continues /);
});

test('late v2 code is excluded; late v1 code without a home stays open', () => {
  const v2 = e('button:studio/client/home/home-app.jsx#HomeApp/retry', {
    kind: 'button',
    label: 'Retry',
  });
  const v1 = e('button:studio/client/panels/New.jsx#New/go', { kind: 'button', label: 'Go' });
  const res = run([], [v2, v1], new Set([v2.id, v1.id]));
  assert.match(res.excluded[v2.id], /v2 code/);
  assert.deepEqual(
    res.unmapped.map((x) => x.id),
    [v1.id]
  );
});

test('a rule pointing at an unknown row / action / hook is reported, not written', () => {
  const x = e('item:studio/context-menu.tsx#A/fit', { kind: 'item', label: 'Fit' });
  const res = mapEntries({
    frozen: [x],
    late: [],
    live: new Set(),
    rows,
    actions,
    hooks,
    hand: { [x.id]: 'action:nope' },
    rules,
    labelFiles,
  });
  assert.deepEqual(res.invalid, [{ id: x.id, target: 'action:nope' }]);
  assert.equal(res.map[x.id], undefined);
});
