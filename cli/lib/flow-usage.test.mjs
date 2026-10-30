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
    null,
    'never scans another project folder (A3: no cross-project read)'
  );
  assert.equal(findTranscript('S1', { home, configDir: '' }), null, 'no root, no search');
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

test('maude flow usage in an AI session: --root other than the project is refused, descriptions are dropped (A3)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const bin = fileURLToPath(new URL('../bin/maude.mjs', import.meta.url));
  const home = mkdtempSync(join(tmpdir(), 'flow-usage-cli-'));
  const root = join(home, 'proj');
  const other = join(home, 'other');
  mkdirSync(root, { recursive: true });
  mkdirSync(other, { recursive: true });
  const mk = (r, sid, desc) => {
    const dir = join(home, '.claude/projects', projectSlug(r));
    mkdirSync(join(dir, `${sid}/subagents`), { recursive: true });
    writeFileSync(join(dir, `${sid}.jsonl`), turn('l1', 'claude-opus-5-5', 1000, 100));
    writeFileSync(join(dir, `${sid}/subagents/a.jsonl`), turn('w1', 'claude-sonnet-5-5', 5, 5));
    writeFileSync(
      join(dir, `${sid}/subagents/a.meta.json`),
      JSON.stringify({ agentType: 'flow:worker', description: desc })
    );
  };
  mk(root, 'MINE', 'my-own-task');
  mk(other, 'THEIRS', 'secret-other-project-text');
  const run = (args, env) =>
    spawnSync(process.execPath, [bin, 'flow', 'usage', ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CLAUDE_PROJECT_DIR: root, ...env },
    });
  const refused = run(['THEIRS', '--root', other], { MAUDE_CHAT_ID: 'c1' });
  assert.notEqual(refused.status, 0);
  assert.doesNotMatch(refused.stdout, /secret-other-project-text/);
  const crossSid = run(['THEIRS'], { MAUDE_CHAT_ID: 'c1' });
  assert.doesNotMatch(
    crossSid.stdout,
    /secret-other-project-text/,
    'a sid of another project is not found'
  );
  const ai = run(['MINE', '--json'], { MAUDE_CHAT_ID: 'c1' });
  assert.equal(ai.status, 0, ai.stderr);
  assert.doesNotMatch(ai.stdout, /my-own-task/, 'no subagent description in an AI session');
  const person = run(['MINE'], { MAUDE_CHAT_ID: '' });
  assert.match(person.stdout, /my-own-task/, 'a person at a terminal still sees it');
  const personOther = run(['THEIRS', '--root', other], { MAUDE_CHAT_ID: '' });
  assert.match(personOther.stdout, /secret-other-project-text/, '--root works for a person');
});
