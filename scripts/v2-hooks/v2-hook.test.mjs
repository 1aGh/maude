// Fail-first tests for the Maude v2 run-harness hooks (plan V2-0.0).
//
//   node --test scripts/v2-hooks/v2-hook.test.mjs
//
// Each blocking hook gets a planted bad input that must be blocked. To watch the suite go red
// (memory: regression tests must fail first), point it at a hook that does nothing:
//   V2_HOOK_UNDER_TEST=scripts/v2-hooks/noop-hook.mjs node --test scripts/v2-hooks/v2-hook.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = resolve(REPO, process.env.V2_HOOK_UNDER_TEST || 'scripts/v2-hooks/v2-hook.mjs');
const LEAD = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const MATE = '33333333-3333-3333-3333-333333333333';

let root;
const tmpRoots = [];

function write(rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function fixture({ marker = true, progress = '', done = 1 } = {}) {
  root = mkdtempSync(join(tmpdir(), 'v2-hook-'));
  tmpRoots.push(root);
  if (marker) write('.ai/state/v2-run.json', JSON.stringify({ sessionId: LEAD, members: [MATE] }));
  write(
    '.ai/plans/feature-maude-v2-redesign.md',
    `# plan\n\n## Phase 0\n\n## Progress log\n\n${progress}\n`
  );
  const rows = [
    { id: 'V2-0.1', kind: 'task', status: 'open' },
    { id: 'V2-0.10', kind: 'task', status: 'open' },
    { id: 'S6', kind: 'package', status: 'open' },
    { id: '01/cf-hero', kind: 'artboard', canvas: '01', status: 'open', evidence: null },
    {
      id: '01/cf-done',
      kind: 'artboard',
      canvas: '01',
      status: 'built',
      evidence: '.ai/scenarios/maude-v2/fidelity/01/cf-done.png',
    },
  ];
  write(
    '.ai/scenarios/maude-v2/ledger.json',
    JSON.stringify({ format: 'maude.v2-ledger', v: 1, canvases: {}, rows })
  );
  write(
    'scripts/v2-done.sh',
    `#!/usr/bin/env bash\necho "FAIL  ledger: 3 open rows"\nexit ${done}\n`
  );
}

function run(event, input) {
  const r = spawnSync('node', [HOOK, event], {
    input: JSON.stringify({ cwd: root, hook_event_name: event, ...input }),
    encoding: 'utf8',
    env: { ...process.env, MAUDE_V2_ROOT: root, CLAUDE_PROJECT_DIR: '' },
  });
  let json = null;
  try {
    json = r.stdout ? JSON.parse(r.stdout) : null;
  } catch {
    /* not JSON */
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const blockedStop = (r) => r.code === 0 && r.json?.decision === 'block';
const refused = (r) => blockedStop(r);
const allowed = (r) => r.code === 0 && !r.json?.decision;

beforeEach(() => fixture());
after(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

describe('gating — no marker or another session means no-op', () => {
  test('no marker: a planted bad task passes untouched', () => {
    fixture({ marker: false });
    const r = run('task-created', { session_id: LEAD, task_subject: 'refactor stuff' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
  test('another session: Stop is not blocked even though v2-done is red', () => {
    assert.ok(allowed(run('stop', { session_id: OTHER })));
  });
  test('a teammate listed in members is gated in', () => {
    const r = run('task-created', { session_id: MATE, task_subject: 'refactor stuff' });
    assert.ok(refused(r), r.stdout);
  });
  test('every gated-in call is logged with its session id', () => {
    run('subagent-start', { session_id: LEAD, agent_id: 'a1', agent_type: 'Explore' });
    const log = readFileSync(join(root, '.ai/state/v2-hooks.log.jsonl'), 'utf8');
    assert.match(log, new RegExp(`"session_id":"${LEAD}".*"agent_type":"Explore"`));
  });
});

describe('SubagentStart — capture rules injected', () => {
  test('additionalContext carries the kg rule and the Decisions requirement', () => {
    const r = run('subagent-start', {
      session_id: LEAD,
      agent_id: 'a1',
      agent_type: 'general-purpose',
    });
    const ctx = r.json?.hookSpecificOutput?.additionalContext ?? '';
    assert.equal(r.json?.hookSpecificOutput?.hookEventName, 'SubagentStart');
    assert.match(ctx, /kg search/);
    assert.match(ctx, /## Decisions/);
    assert.match(ctx, /Context budget/);
    assert.match(ctx, /## Continue/);
  });
});

describe('SubagentStop — hand-back must carry ## Decisions', () => {
  test('planted: no Decisions block → blocked', () => {
    const r = run('subagent-stop', {
      session_id: LEAD,
      agent_type: 'Explore',
      last_assistant_message: 'Found 3 files.',
    });
    assert.ok(blockedStop(r), r.stdout);
  });
  test('Decisions block present → allowed', () => {
    const msg = 'Found 3 files.\n\n## Decisions\n- none of note';
    assert.ok(
      allowed(
        run('subagent-stop', {
          session_id: LEAD,
          agent_type: 'Explore',
          last_assistant_message: msg,
        })
      )
    );
  });
  test('"## Decisions: none" → allowed', () => {
    const msg = 'Done.\n## Decisions: none';
    assert.ok(
      allowed(
        run('subagent-stop', {
          session_id: LEAD,
          agent_type: 'Explore',
          last_assistant_message: msg,
        })
      )
    );
  });
  test('internal agent (empty agent_type) → allowed', () => {
    assert.ok(
      allowed(
        run('subagent-stop', { session_id: LEAD, agent_type: '', last_assistant_message: 'x' })
      )
    );
  });
  test('already retried once → allowed with a warning (no loop)', () => {
    const r = run('subagent-stop', {
      session_id: LEAD,
      agent_type: 'Explore',
      stop_hook_active: true,
      last_assistant_message: 'x',
    });
    assert.ok(allowed(r));
    assert.match(r.stderr, /without a ## Decisions block/);
  });
});

describe('TaskCreated — plan id or ledger reference required', () => {
  test('planted: no V2 id → refused (exit 2)', () => {
    const r = run('task-created', {
      session_id: LEAD,
      task_subject: 'Polish the toolbar',
      task_description: 'make it nicer',
    });
    assert.ok(refused(r), r.stdout);
    assert.match(r.json.reason, /V2-x\.y/);
  });
  test('planted: unknown V2 id → refused', () => {
    const r = run('task-created', { session_id: LEAD, task_subject: 'V2-9.9 invented task' });
    assert.ok(refused(r), r.stdout);
    assert.match(r.json.reason, /not in the ledger/);
  });
  test('known V2 id → allowed', () => {
    assert.ok(
      allowed(
        run('task-created', { session_id: LEAD, task_subject: 'V2-0.1 Characterization tests' })
      )
    );
  });
  test('ledger reference followed by prose → only the id counts (smoke-test finding)', () => {
    const r = run('task-created', {
      session_id: LEAD,
      task_subject: 'V2-0.1 smoke',
      task_description: 'ledger: V2-0.1 — smoke check of the teammate hook path',
    });
    assert.ok(allowed(r), r.stdout);
  });
  test('ledger reference → allowed', () => {
    const r = run('task-created', {
      session_id: LEAD,
      task_subject: 'S6 hero',
      task_description: 'ledger: 01/cf-hero',
    });
    assert.ok(allowed(r));
  });
});

describe('TaskCompleted — Progress-log SHA and evidence required', () => {
  test('planted: no Progress-log line → refused', () => {
    const r = run('task-completed', {
      session_id: LEAD,
      task_subject: 'V2-0.1 Characterization tests',
    });
    assert.ok(refused(r), r.stdout);
    assert.match(r.json.reason, /no Progress-log line/);
  });
  test('planted: Progress-log line without a SHA → refused', () => {
    fixture({ progress: '2026-10-08 · V2-0.1 · done · (commit pending)' });
    assert.ok(
      refused(
        run('task-completed', { session_id: LEAD, task_subject: 'V2-0.1 Characterization tests' })
      )
    );
  });
  test('planted: the line belongs to V2-0.10, not V2-0.1 → refused', () => {
    fixture({ progress: '2026-10-08 · V2-0.10 · done · a1b2c3d' });
    assert.ok(
      refused(
        run('task-completed', { session_id: LEAD, task_subject: 'V2-0.1 Characterization tests' })
      )
    );
  });
  test('done line with a SHA → allowed', () => {
    fixture({ progress: '2026-10-08 · V2-0.1 · done · 3f9e2a1 · test/ · notes' });
    assert.ok(
      allowed(
        run('task-completed', { session_id: LEAD, task_subject: 'V2-0.1 Characterization tests' })
      )
    );
  });
  test('planted: artboard ref without evidence → refused', () => {
    fixture({ progress: '2026-10-08 · S6 · done · 3f9e2a1' });
    const r = run('task-completed', {
      session_id: LEAD,
      task_subject: 'S6 hero section',
      task_description: 'ledger: 01/cf-hero',
    });
    assert.ok(refused(r), r.stdout);
    assert.match(r.json.reason, /still open/);
  });
  test('artboard ref with evidence → allowed', () => {
    fixture({ progress: '2026-10-08 · S6 · done · 3f9e2a1' });
    const r = run('task-completed', {
      session_id: LEAD,
      task_subject: 'S6 done section',
      task_description: 'ledger: 01/cf-done',
    });
    assert.ok(allowed(r));
  });
});

describe('Stop — the lead cannot end while v2-done.sh is red', () => {
  test('planted: v2-done red, nobody waiting → blocked with the next step', () => {
    const r = run('stop', { session_id: LEAD });
    assert.ok(blockedStop(r), r.stdout);
    assert.match(r.json.reason, /v2-done\.sh/);
    assert.match(r.json.reason, /V2-0\.1/);
  });
  test('waiting-for-Michal file → allowed', () => {
    write('.ai/state/v2-waiting-for-michal.md', '# Waiting\nTry the split.\n');
    assert.ok(allowed(run('stop', { session_id: LEAD })));
  });
  test('v2-done green → allowed', () => {
    fixture({ done: 0 });
    assert.ok(allowed(run('stop', { session_id: LEAD })));
  });
});
