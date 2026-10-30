// A state judged on an older build is judged again on the current one (dead-controls.mjs --resume … --redo): its
// stale rows and the errors they drew are replaced by the redo shard's.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeShards, planResume, staleStates } from '../v2-verify/dead-controls/resume.mjs';

const row = (surface, control, effect, extra = {}) => ({
  shell: 'project',
  mode: 'browser',
  surface,
  control,
  key: `tid:${control}`,
  frame: 'shell',
  effect,
  note: '',
  ...extra,
});
const at = (surface) => ({ mode: 'browser', shell: 'project', surface });

const old = {
  results: [
    row('s › menu', 'locked-eye', 'dom(3)'),
    row('s › menu', 'Hide Frame', 'dom(9)'),
    row('s › sheet', 'greyed', 'disabled', { note: '' }),
    row('s › sheet', 'fine', 'disabled', { note: 'Needs a canvas' }),
    row('s › hist', 'vh-row-r4', 'DEAD'),
    row('s › ok', 'plain', 'dom(2)'),
  ],
  errors: [
    {
      mode: 'browser',
      shell: 'project',
      kind: 'http 409',
      control: 'shell:Hide Frame',
      text: 'POST /_api/edit-op',
    },
    {
      mode: 'browser',
      shell: 'project',
      kind: 'http 404 (canvas removed)',
      control: '<idle>',
      text: 'x',
    },
    {
      mode: 'browser',
      shell: 'project',
      kind: 'http 409',
      control: 'shell:plain',
      text: 'unrelated, kept',
    },
  ],
};

test('staleStates names the states with a reasonless disabled row, a DEAD row or a row that drew a real error', () => {
  assert.deepEqual([...staleStates([old])].sort(), [
    'browser|project|s › hist',
    'browser|project|s › menu',
    'browser|project|s › ok',
    'browser|project|s › sheet',
  ]);
});

test('planResume with redo seeds the stale states again and does not count their rows as judged', () => {
  const p = planResume([old], { mode: 'browser', shell: 'project', redo: true });
  assert.deepEqual(
    [...p.seeds].sort(),
    ['s › hist', 's › menu', 's › ok', 's › sheet'],
    'the state whose row drew the 409 is stale too'
  );
  assert.ok(!p.judged.has('shell|tid:Hide Frame'));
  assert.ok(
    !p.judged.has('shell|tid:fine'),
    'the whole state is judged again, not only its stale row'
  );
  assert.deepEqual(planResume([old], { mode: 'browser', shell: 'project' }).seeds, []);
});

test('mergeShards replaces the rows and errors of a redone state with the redo shard’s', () => {
  const redo = {
    results: [row('s › menu', 'Hide Frame', 'dom(9)'), row('s › hist', 'vh-row-r4', 'dom(4)')],
    redone: [at('s › menu'), at('s › hist'), at('s › sheet'), at('s › ok')],
    statesDone: [at('s › sheet'), at('s › ok')],
    errors: [],
  };
  const m = mergeShards([old, redo]);
  assert.equal(m.results.filter((r) => r.surface === 's › menu').length, 1);
  assert.equal(m.results.filter((r) => r.effect === 'DEAD').length, 0);
  assert.equal(m.results.filter((r) => r.surface === 's › sheet').length, 0);
  assert.deepEqual(m.errors.map((e) => e.control).sort(), ['<idle>']);
});

test('a redone state the redo shard could not reach stays listed as not reached', () => {
  const redo = {
    results: [{ ...row('s › menu', '(surface)', 'unreachable'), key: undefined }],
    redone: [at('s › menu')],
    statesDone: [],
    errors: [],
  };
  const m = mergeShards([old, redo]);
  assert.deepEqual(
    m.results.filter((r) => r.surface === 's › menu').map((r) => r.effect),
    ['unreachable']
  );
});
