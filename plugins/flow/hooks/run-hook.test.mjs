// Fail-first tests for the /flow:run hooks.
//
//   node --test plugins/flow/hooks/run-hook.test.mjs
//
// Every blocking case plants a bad input that must be blocked; every gate case must stay silent.
// Watch the suite go red against a hook that does nothing:
//   FLOW_HOOK_UNDER_TEST=plugins/flow/hooks/noop-hook.mjs node --test plugins/flow/hooks/run-hook.test.mjs
//
// Guardrail 5: every hook runs with an isolated HOME and a stub `claude` first on PATH, and the
// suite asserts the hooks wrote nothing at all under that HOME (so they cannot have touched the
// real one either) and the stub was never called. The real ~/.claude.json's mtime is no witness:
// every other Claude session on the machine rewrites it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BUDGET_PRESETS } from '../../../cli/lib/flow-usage.mjs';
import { PRESETS, planOpen } from './run-hook.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const HOOK = resolve(REPO, process.env.FLOW_HOOK_UNDER_TEST || 'plugins/flow/hooks/run-hook.mjs');
const LEAD = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const SANDBOX = mkdtempSync(join(tmpdir(), 'flow-run-hook-'));
const FAKE_HOME = join(SANDBOX, 'home');
const STUB_BIN = join(SANDBOX, 'bin');
const STUB_HIT = join(SANDBOX, 'claude-was-called');
mkdirSync(FAKE_HOME, { recursive: true });
mkdirSync(STUB_BIN, { recursive: true });
writeFileSync(join(STUB_BIN, 'claude'), `#!/bin/sh\ntouch "${STUB_HIT}"\nexit 0\n`);
chmodSync(join(STUB_BIN, 'claude'), 0o755);

let n = 0;
function fixture({
  hooks = true,
  marker = {},
  plan = '## Acceptance Criteria\n\n- [x] done\n',
  config = {},
} = {}) {
  const root = join(SANDBOX, `repo-${n++}`);
  mkdirSync(join(root, '.ai/state'), { recursive: true });
  mkdirSync(join(root, '.ai/plans'), { recursive: true });
  writeFileSync(
    join(root, '.ai/workflows.config.json'),
    JSON.stringify({ name: 't', run: { hooks, ...config } })
  );
  writeFileSync(join(root, '.ai/plans/p.md'), `# Plan\n\n${plan}`);
  if (marker !== null)
    writeFileSync(
      join(root, '.ai/state/run.json'),
      JSON.stringify({
        sessionId: LEAD,
        plan: '.ai/plans/p.md',
        expires: new Date(Date.now() + 3600e3).toISOString(),
        ...marker,
      })
    );
  return root;
}

function run(root, event, input = {}, env = {}) {
  const r = spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify({ session_id: LEAD, cwd: root, ...input }),
    encoding: 'utf8',
    env: {
      PATH: `${STUB_BIN}:${process.env.PATH}`,
      HOME: FAKE_HOME,
      XDG_CONFIG_HOME: join(FAKE_HOME, '.config'),
      FLOW_RUN_ROOT: root,
      ...env,
    },
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { ...r, json, blocked: json?.decision === 'block' };
}

after(() => {
  assert.equal(existsSync(STUB_HIT), false, 'a hook spawned claude');
  assert.deepEqual(readdirSync(FAKE_HOME), [], 'a hook wrote under HOME');
  rmSync(SANDBOX, { recursive: true, force: true });
});

describe('gate: a no-op unless every condition holds', () => {
  const red = '## Acceptance Criteria\n\n- [ ] not yet\n';
  test('control: an armed run with an open criterion blocks', () => {
    assert.equal(run(fixture({ plan: red }), 'stop').blocked, true);
  });
  test('run.hooks off (default) → silent', () => {
    const r = run(fixture({ plan: red, hooks: false }), 'stop');
    assert.equal(r.stdout, '');
  });
  test('no marker → silent', () => {
    assert.equal(run(fixture({ plan: red, marker: null }), 'stop').stdout, '');
  });
  test('another session → silent', () => {
    assert.equal(run(fixture({ plan: red }), 'stop', { session_id: OTHER }).stdout, '');
  });
  test('a listed member session is gated in', () => {
    assert.equal(
      run(fixture({ plan: red, marker: { members: [OTHER] } }), 'stop', { session_id: OTHER })
        .blocked,
      true
    );
  });
  test('expired marker → silent', () => {
    const root = fixture({
      plan: red,
      marker: { expires: new Date(Date.now() - 1000).toISOString() },
    });
    assert.equal(run(root, 'stop').stdout, '');
  });
  test('marker without expiry → silent', () => {
    assert.equal(run(fixture({ plan: red, marker: { expires: undefined } }), 'stop').stdout, '');
  });
  test('FLOW_RUN_HOOKS=0 → silent', () => {
    assert.equal(run(fixture({ plan: red }), 'stop', {}, { FLOW_RUN_HOOKS: '0' }).stdout, '');
  });
});

describe('stop', () => {
  test('green plan + green doneCmd → allowed', () => {
    const r = run(fixture({ marker: { doneCmd: 'true' } }), 'stop');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
  test('red doneCmd → blocked, reason names the command and the kill switch', () => {
    const r = run(fixture({ marker: { doneCmd: 'echo "FAIL lint" ; exit 3' } }), 'stop');
    assert.equal(r.blocked, true);
    assert.match(r.json.reason, /exit 3/);
    assert.match(r.json.reason, /FAIL lint/);
    assert.match(r.json.reason, /FLOW_RUN_HOOKS=0/);
    assert.match(r.json.reason, /--pause/);
  });
  test('open acceptance criterion → blocked with the criterion', () => {
    const r = run(
      fixture({
        plan: '## Acceptance Criteria\n\n- [x] a\n- [ ] ship the thing\n\n## Notes\n- [ ] not a criterion\n',
      }),
      'stop'
    );
    assert.equal(r.blocked, true);
    assert.match(r.json.reason, /1 acceptance criteria open/);
    assert.match(r.json.reason, /ship the thing/);
  });
  test('waiting file → allowed even while red', () => {
    const root = fixture({ marker: { doneCmd: 'exit 1' } });
    writeFileSync(join(root, '.ai/state/run-waiting.md'), 'need a key');
    assert.equal(run(root, 'stop').stdout, '');
  });
  test('after maxStopBlocks identical reds the run pauses itself and allows the stop', () => {
    const root = fixture({
      marker: { doneCmd: 'echo same; exit 1' },
      config: { maxStopBlocks: 2 },
    });
    assert.equal(run(root, 'stop').blocked, true);
    assert.equal(run(root, 'stop').blocked, true);
    const third = run(root, 'stop');
    assert.equal(third.blocked, false);
    assert.match(readFileSync(join(root, '.ai/state/run-waiting.md'), 'utf8'), /repeated 2 times/);
  });
  test('a changed red resets the counter', () => {
    const root = fixture({
      marker: { doneCmd: 'cat .ai/state/msg; exit 1' },
      config: { maxStopBlocks: 2 },
    });
    for (const m of ['a', 'b', 'c']) {
      writeFileSync(join(root, '.ai/state/msg'), m);
      assert.equal(run(root, 'stop').blocked, true, `red "${m}" should block`);
    }
  });
  test('default cap is 3', () => {
    const root = fixture({ marker: { doneCmd: 'exit 1' } });
    for (let i = 0; i < 3; i++) assert.equal(run(root, 'stop').blocked, true);
    assert.equal(run(root, 'stop').blocked, false);
  });
  test('maxRunTokens reached → checkpoint pause, stop allowed', () => {
    const root = fixture({
      marker: { doneCmd: 'exit 1' },
      config: { budget: { maxRunTokens: 1000 } },
    });
    const t = join(root, 'lead.jsonl');
    writeFileSync(
      t,
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm',
          usage: { cache_read_input_tokens: 900, cache_creation_input_tokens: 200 },
        },
      })
    );
    assert.equal(run(root, 'stop', { transcript_path: t }).blocked, false);
    assert.match(readFileSync(join(root, '.ai/state/run-waiting.md'), 'utf8'), /Token ceiling/);
  });
});

describe('subagents', () => {
  test('subagent-start injects the budget rules from the preset', () => {
    const r = run(fixture({ config: { budget: { preset: 'small' } } }), 'subagent-start');
    const ctx = r.json?.hookSpecificOutput?.additionalContext ?? '';
    assert.match(ctx, /## Decisions/);
    assert.match(ctx, /150k context/);
    assert.match(ctx, /\.ai\/plans\/p\.md/);
  });
  test('subagent-stop without ## Decisions → blocked once', () => {
    const r = run(fixture(), 'subagent-stop', {
      agent_type: 'flow:worker',
      last_assistant_message: 'done',
    });
    assert.equal(r.blocked, true);
  });
  test('…then allowed with a warning on the retry', () => {
    const r = run(fixture(), 'subagent-stop', {
      agent_type: 'flow:worker',
      last_assistant_message: 'done',
      stop_hook_active: true,
    });
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /without ## Decisions/);
  });
  test('with ## Decisions → allowed; internal agents (no agent_type) → allowed', () => {
    assert.equal(
      run(fixture(), 'subagent-stop', {
        agent_type: 'flow:worker',
        last_assistant_message: 'x\n## Decisions: none',
      }).stdout,
      ''
    );
    assert.equal(run(fixture(), 'subagent-stop', { last_assistant_message: 'x' }).stdout, '');
  });
});

test('helpers: planOpen and preset parity with the CLI', () => {
  assert.deepEqual(planOpen('## Acceptance Criteria\n- [ ] a\n- [x] b\n## Next\n- [ ] c'), ['a']);
  assert.deepEqual(planOpen('no section'), []);
  assert.deepEqual(PRESETS, BUDGET_PRESETS);
});

describe('state verbs (/flow:run)', () => {
  const verbRun = (root, ...args) =>
    spawnSync(process.execPath, [HOOK, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: `${STUB_BIN}:${process.env.PATH}`, HOME: FAKE_HOME, FLOW_RUN_ROOT: root },
    });
  test('arm refuses while run.hooks is off and writes nothing', () => {
    const root = fixture({ hooks: false, marker: null });
    const r = verbRun(root, 'arm', '--plan', '.ai/plans/p.md', '--session', LEAD);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /maude config set run\.hooks true/);
    assert.equal(existsSync(join(root, '.ai/state/run.json')), false);
  });
  test('arm writes the marker, prints the budget and the /goal line; the Stop gate then blocks', () => {
    const root = fixture({ marker: null, plan: '## Acceptance Criteria\n- [ ] x\n' });
    const r = verbRun(
      root,
      'arm',
      '--plan',
      '.ai/plans/p.md',
      '--session',
      LEAD,
      '--done-cmd',
      'true'
    );
    assert.equal(r.status, 0);
    assert.match(
      r.stdout,
      /^GOAL: \/goal Every acceptance criterion in \.ai\/plans\/p\.md is ticked and `true` passes$/m
    );
    const m = JSON.parse(readFileSync(join(root, '.ai/state/run.json'), 'utf8'));
    assert.equal(m.sessionId, LEAD);
    assert.ok(Date.parse(m.expires) > Date.now() + 23 * 3600e3);
    assert.equal(run(root, 'stop').blocked, true);
  });
  test('pause opens the gate, resume moves the run to a new session, disarm silences every hook', () => {
    const root = fixture({ plan: '## Acceptance Criteria\n- [ ] x\n' });
    assert.equal(verbRun(root, 'pause', '--reason', 'need a key').status, 0);
    assert.equal(run(root, 'stop').stdout, '');
    assert.equal(verbRun(root, 'resume', '--session', OTHER).status, 0);
    assert.equal(
      run(root, 'stop', { session_id: LEAD }).stdout,
      '',
      'the old session is no longer the run'
    );
    assert.equal(run(root, 'stop', { session_id: OTHER }).blocked, true);
    const s = verbRun(root, 'status');
    assert.match(s.stdout, /open acceptance criteria: 1/);
    assert.equal(verbRun(root, 'disarm').status, 0);
    assert.equal(existsSync(join(root, '.ai/state/run.json')), false);
    assert.equal(run(root, 'stop', { session_id: OTHER }).stdout, '');
  });
});
