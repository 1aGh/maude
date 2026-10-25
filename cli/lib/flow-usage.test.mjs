import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  findTranscript,
  formatUsage,
  projectSlug,
  resolveBudget,
  scanTranscript,
  sessionUsage,
} from './flow-usage.mjs';

const turn = (id, model, read, write, input = 0) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model,
      usage: {
        cache_read_input_tokens: read,
        cache_creation_input_tokens: write,
        input_tokens: input,
        output_tokens: 5,
      },
    },
  });

test('scanTranscript counts each message id once and tracks the peak', () => {
  const t = [
    turn('a', 'claude-sonnet-5-5', 100, 50),
    turn('a', 'claude-sonnet-5-5', 100, 50),
    turn('b', '<synthetic>', 400, 0, 10),
    'not json',
  ].join('\n');
  const s = scanTranscript(t);
  assert.equal(s.turns, 2);
  assert.equal(s.read, 500);
  assert.equal(s.write, 50);
  assert.equal(s.peak, 410);
  assert.equal(s.model, 'claude-sonnet-5-5');
});

test('resolveBudget: preset defaults, explicit keys win, unknown preset = default', () => {
  assert.equal(resolveBudget(null).agentContextK, 300);
  assert.equal(resolveBudget({ run: { budget: { preset: 'small' } } }).agentContextK, 150);
  assert.equal(
    resolveBudget({ run: { budget: { preset: 'small', agentContextK: 220 } } }).agentContextK,
    220
  );
  assert.equal(resolveBudget({ run: { budget: { preset: 'huge' } } }).agentTurns, 150);
});

test('findTranscript + sessionUsage + formatUsage on an isolated HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'flow-usage-'));
  const root = '/work/repo';
  const dir = join(home, '.claude/projects', projectSlug(root));
  mkdirSync(join(dir, 'S1/subagents'), { recursive: true });
  writeFileSync(join(dir, 'S1.jsonl'), turn('l1', 'claude-opus-5-5', 1000, 100));
  writeFileSync(
    join(dir, 'S1/subagents/agent-x.jsonl'),
    turn('w1', 'claude-sonnet-5-5', 350_000, 5_000)
  );
  writeFileSync(
    join(dir, 'S1/subagents/agent-x.meta.json'),
    JSON.stringify({ agentType: 'flow:worker', description: 'Task 1' })
  );
  const p = findTranscript('S1', { root, home, configDir: '' });
  assert.equal(p, join(dir, 'S1.jsonl'));
  assert.equal(
    findTranscript('S1', { root: '/elsewhere', home, configDir: '' }),
    p,
    'falls back to scanning every project'
  );
  assert.equal(findTranscript('nope', { root, home, configDir: '' }), null);
  const u = sessionUsage(p);
  assert.equal(u.agents[0].type, 'flow:worker');
  const out = formatUsage(u, { contextK: 300 });
  assert.match(out, /flow:worker\s+Task 1\s+! peak>300k/);
  assert.doesNotMatch(formatUsage(u, { contextK: 400 }), /!/);
});

test('findTranscript refuses a session id that is not a plain id (no path traversal)', () => {
  assert.equal(
    findTranscript('../../etc/x', { root: '/work/repo', home: '/nonexistent', configDir: '' }),
    null
  );
});
