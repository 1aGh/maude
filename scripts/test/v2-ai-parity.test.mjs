// V2-8.16 — scripts/check-v2-ai-parity.mjs: every registry action has an agent path, and the
// audit bites on each way a path can be a lie (planted fixtures), and is green on the real registry.
//
// AI_PARITY_SCRIPT_UNDER_TEST=<file> points it at another copy (how the red-first run proved each
// planted case fails on a weakened script).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = process.env.AI_PARITY_SCRIPT_UNDER_TEST
  ? resolve(process.env.AI_PARITY_SCRIPT_UNDER_TEST)
  : join(ROOT, 'scripts', 'check-v2-ai-parity.mjs');
const { auditParity } = await import(pathToFileURL(SCRIPT).href);

const verbs = [
  { scope: 'design', verb: 'index', effect: 'none' },
  { scope: 'design', verb: 'link', effect: 'human' },
  { scope: 'top', verb: 'kg ingest', effect: 'project', hold: 'x' },
];
const verbTier = (v) => (v.effect === 'human' ? 'human' : v.hold ? 'prompt' : 'auto');
const parity = { humanMax: 5, humanDecisions: { keys: 'decision:maude/x' } };
const listedVerbs = new Set(['index', 'link']);
const run = (agentPaths, extra = {}) =>
  auditParity({
    actions: Object.keys(agentPaths).map((id) => ({ id, kind: 'command' })),
    agentPaths,
    verbs,
    verbTier,
    parity,
    listedVerbs,
    ...extra,
  }).gaps.map((g) => `${g.id}: ${g.why}`);

const ok = { effect: 'none', agent: { path: 'cli', verb: 'maude design index' } };

test('a clean registry has no gaps', () => {
  assert.deepEqual(
    run({ a: ok, b: { effect: 'none', agent: { path: 'human', because: 'keys' } } }),
    []
  );
});

test('an action with no entry, no agent path or no effect is a gap', () => {
  const gaps = run({
    a: { effect: 'none' },
    b: { agent: { path: 'cli', verb: 'maude design index' } },
  });
  assert.deepEqual(gaps, ['a: no agent path', 'b: no effect']);
  assert.deepEqual(
    auditParity({
      actions: [{ id: 'gone', kind: 'command' }],
      agentPaths: {},
      verbs,
      verbTier,
      parity,
    }).gaps.map((g) => g.why),
    ['no entry in actions/agents.ts']
  );
});

test('a place action needs no path', () => {
  const r = auditParity({
    actions: [{ id: 'p', kind: 'place' }],
    agentPaths: {},
    verbs,
    verbTier,
    parity,
  });
  assert.deepEqual(r.gaps, []);
});

test('pending is a gap (pendingMax is 0)', () => {
  assert.match(
    run({ a: { effect: 'none', agent: { path: 'pending', package: 'S1', want: ok.agent } } })[0],
    /pending \(S1\)/
  );
});

test('a human-only reason must cite a decision, and the count stays under humanMax', () => {
  const h = (because) => ({ effect: 'none', agent: { path: 'human', because } });
  assert.match(run({ a: h('nope') })[0], /cites no decision/);
  const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, h('keys')]));
  assert.match(run(many).join('\n'), /exceed humanMax 5/);
});

test('a cli path must name a tiered verb that is not human-tier and is listed by help', () => {
  const cli = (verb) => ({ effect: 'none', agent: { path: 'cli', verb } });
  assert.match(run({ a: cli('maude design nonesuch') })[0], /not in the tier table/);
  assert.match(run({ a: cli('maude design link') })[0], /human-tier/);
  assert.match(
    run({ a: cli('maude design index') }, { listedVerbs: new Set(['link']) })[0],
    /not listed by `maude design help`/
  );
  // a sub-verb entry is matched before its verb; flags and placeholders are not verb words
  assert.deepEqual(
    run({ a: cli('maude kg ingest --x'), b: cli('maude design index <canvas> --all') }),
    []
  );
});

test('a file path must name a skill that exists', () => {
  const f = (skill, how = 'edit the file by hand') => ({
    effect: 'project',
    agent: { path: 'file', format: 'canvas-tsx', skill, how },
  });
  assert.deepEqual(run({ a: f('design:design') }), []);
  assert.match(run({ a: f('design:no-such-skill') })[0], /does not exist/);
  assert.match(run({ a: f('design:design', 'x') })[0], /without a how/);
});

test('the real registry is at 100 % (the gate scripts/v2-gates.mjs runs)', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1' },
    timeout: 120_000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /AI parity: (\d+)\/\1 actions/);
});
