// --resume … --seed-from: seed only the states one shard left unreached, even when an earlier shard's rows were
// superseded (the planner works on copies, so the shard is matched by position, not identity).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planResume } from '../v2-verify/dead-controls/resume.mjs';

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
const unreached = (surface) => ({ ...row(surface, '(surface)', 'unreachable'), key: undefined });

const old = {
  results: [row('s › menu', 'Hide Frame', 'dom(9)'), row('s › ok', 'plain', 'dom(2)')],
};
const failed = { results: [unreached('s › menu')], redone: [at('s › menu')], statesDone: [] };
const other = { results: [unreached('t › deep')] };

test('a redone state whose walk failed is a seed again; its stale rows are not counted as judged', () => {
  const all = planResume([old, failed, other], { mode: 'browser', shell: 'project' });
  assert.deepEqual([...all.seeds].sort(), ['s › menu', 't › deep']);
  assert.ok(!all.judged.has('shell|tid:Hide Frame'));
  assert.ok(all.judged.has('shell|tid:plain'));
});

test('--seed-from limits the seeds to what the named shard left behind', () => {
  const parts = [old, failed, other];
  assert.deepEqual(
    planResume(parts, { mode: 'browser', shell: 'project', seedFrom: [failed] }).seeds,
    ['s › menu']
  );
  assert.deepEqual(
    planResume(parts, { mode: 'browser', shell: 'project', seedFrom: [other] }).seeds,
    ['t › deep']
  );
});
