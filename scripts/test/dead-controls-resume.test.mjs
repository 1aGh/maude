// A sweep that ran out of time continues from its shards (dead-controls.mjs --resume): what an earlier shard
// judged is a twin here, the states it never entered become seeds, and the merge drops an unreachable row once
// a later shard entered that state.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Crawler } from '../v2-verify/dead-controls/crawl.mjs';
import { collapseTwins, summarize } from '../v2-verify/dead-controls/report.mjs';
import { judgeKey, mergeShards, planResume } from '../v2-verify/dead-controls/resume.mjs';

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
const unreached = (surface, mode = 'browser') => ({
  shell: 'project',
  mode,
  surface,
  control: '(surface)',
  effect: 'unreachable',
  note: 'time budget spent before this state',
});

const early = {
  results: [
    row('canvas Landing', 'a', 'dom(9)'),
    row('canvas Landing', 'b', 'twin', { twin: 'x · y' }),
    row('canvas Landing › menu', 'c', 'DEAD'),
    row('canvas Landing › menu', 'd', 'disabled'),
    unreached('canvas Landing › menu › deep'),
    unreached('canvas Landing › tab'),
    unreached('canvas Landing › tab › sub', 'tauri'),
  ],
};

test('planResume seeds the judged map from rows that were judged, never from twins or unreached states', () => {
  const { judged, queued } = planResume([early], { mode: 'browser', shell: 'project' });
  assert.deepEqual(
    [...judged.keys()].sort(),
    ['shell|tid:a', 'shell|tid:c', 'shell|tid:d'],
    'twin rows were not clicked'
  );
  assert.equal(judged.get('shell|tid:a'), 'canvas Landing · a');
  assert.ok(queued.has('canvas Landing › menu>tid:c'));
  assert.ok(!queued.has('canvas Landing>tid:b'));
});

test('planResume seeds the unreached states of ONE mode, shallowest first, and splits them across shards', () => {
  const p = planResume([early], { mode: 'browser', shell: 'project' });
  assert.deepEqual(p.seeds, ['canvas Landing › tab', 'canvas Landing › menu › deep']);
  const a = planResume([early], { mode: 'browser', shell: 'project', shard: [1, 2] }).seeds;
  const b = planResume([early], { mode: 'browser', shell: 'project', shard: [2, 2] }).seeds;
  assert.deepEqual([...a, ...b].sort(), [...p.seeds].sort());
  assert.equal(a.length + b.length, 2);
  assert.deepEqual(
    planResume([early], { mode: 'browser', shell: 'project', accept: (s) => s.endsWith('tab') })
      .seeds,
    ['canvas Landing › tab']
  );
});

test('a state another shard entered is not a seed, and a sub-menu row is judged per menu', () => {
  const later = { results: [row('canvas Landing › tab', 'z', 'dom(3)')] };
  assert.deepEqual(planResume([early, later], { mode: 'browser', shell: 'project' }).seeds, [
    'canvas Landing › menu › deep',
  ]);
  const quiet = {
    results: [],
    statesDone: [{ mode: 'browser', shell: 'project', surface: 'canvas Landing › tab' }],
  };
  assert.deepEqual(planResume([early, quiet], { mode: 'browser', shell: 'project' }).seeds, [
    'canvas Landing › menu › deep',
  ]);
  assert.notEqual(
    judgeKey('shell', 'tid:project-menu-row-sub-advanced', 'a'),
    judgeKey('shell', 'tid:project-menu-row-sub-advanced', 'b')
  );
});

test('mergeShards drops an unreachable row once a later shard entered that state, and counts the rest once', () => {
  const later = {
    results: [
      row('canvas Landing › tab', 'z', 'dom(3)'),
      unreached('canvas Landing › menu › deep'),
    ],
    statesDone: [{ mode: 'tauri', shell: 'project', surface: 'canvas Landing › tab › sub' }],
  };
  const m = mergeShards([early, later]);
  const left = m.results.filter((r) => r.effect === 'unreachable').map((r) => r.surface);
  assert.deepEqual(left, ['canvas Landing › menu › deep']);
  const s = summarize(collapseTwins(m.results), []);
  assert.equal(s.notReached, 1);
  assert.equal(s.found, m.results.length);
});

test('a Crawler seeded from earlier shards reports a control they judged as already clicked', () => {
  const c = new Crawler({ browser: null, mode: 'browser', url: 'x', label: 'project' });
  c.resume(planResume([early], { mode: 'browser', shell: 'project' }));
  assert.equal(
    c.clicked.get(c.judgeKeyOf({ frame: 'shell', key: 'tid:a' }, 'canvas Landing › other')),
    'canvas Landing · a'
  );
  assert.equal(c.clicked.has(c.judgeKeyOf({ frame: 'shell', key: 'tid:new' }, 's')), false);
});

test('walkPath waits for a frame control that lands after a writing step reloads the canvas', async () => {
  const c = new Crawler({ browser: null, mode: 'tauri', url: 'x', label: 'project' });
  let calls = 0;
  c.replay = async () => true;
  // the tile's click reloads the canvas: its frame's controls are there only from the fourth read on
  const tile = { id: 's1', tid: 'size-picker-tile-web-laptop', frame: 'shell', key: 'tid:tile' };
  const fit = { id: 'f1', name: 'Fit to screen', frame: 'canvas', key: 'name:fit', role: 'button' };
  c.controls = async () => (++calls < 4 ? [tile] : [tile, fit]);
  const st = await c.walkPath(
    [{ name: 'canvas Smoke', steps: [] }],
    'canvas Smoke › size-picker-tile-web-laptop › Fit to screen'
  );
  assert.equal(st.name, 'canvas Smoke › size-picker-tile-web-laptop › Fit to screen');
  assert.equal(st.steps.at(-1).key, 'name:fit');
});
