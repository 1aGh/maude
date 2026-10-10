// handoff-schema.test.mjs — contract V2-1.18 §7 (V2-2.4b): the shipped maude.agent-handoff/1 schema
// + validator (cli/lib/handoff.mjs) that `maude design check` and the SubagentStop hook share.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  criticVerdictToHandoff,
  HANDOFF_CONTRACT,
  handoffSchema,
  handoffToCriticVerdict,
  isBoundedWriter,
  ownsPath,
  readHandoff,
  runDirOf,
  validateHandoff,
} from './handoff.mjs';

const RUN = '.design/_runs/3f2a9c1e-uuid/';
const IN = {
  contract: HANDOFF_CONTRACT,
  role: 'in',
  runId: 'r_abcd1234',
  agent: 'design:design-critic',
  task: 'Review the pricing canvas — "make it calmer" (the person’s words)',
  scope: { canvas: '.design/ui/Pricing.tsx', artboardIds: ['hero'] },
  owns: [`${RUN}handoff/design-critic-0.out.json`],
  reads: ['.design/ui/**'],
  context: { ds: 'acme', fidelity: 'strict' },
  checks: ['maude design check .design/ui/Pricing.tsx'],
  budget: { maxIterations: 3 },
  output: `${RUN}handoff/design-critic-0.out.json`,
};
const OUT = {
  contract: HANDOFF_CONTRACT,
  role: 'out',
  runId: 'r_abcd1234',
  agent: 'design:design-critic',
  status: 'done',
  summary: '1 blocker',
  changed: [],
  evidence: [{ kind: 'screenshot', path: '.design/_screenshots/p.png' }],
  decisions: [{ decision: 'flag contrast', why: 'below 4.5:1', confidence: 'high' }],
  findings: [
    { severity: 'blocker', where: 'a11y:245', what: 'contrast 3.1:1', fix: 'var(--fg-1)' },
  ],
  open_questions: [],
};

test('the shipped schema is the V2-1.18 prototype, tightened only where the contract says', () => {
  const proto = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../apps/studio/test/agent-evals/harness/handoff.schema.json', import.meta.url)
      ),
      'utf8'
    )
  );
  const shipped = handoffSchema();
  assert.equal(shipped.$id, 'https://maude.sh/schema/agent-handoff/1');
  assert.equal(shipped.$id, proto.$id);
  assert.deepEqual(Object.keys(shipped.$defs).sort(), Object.keys(proto.$defs).sort());
  assert.deepEqual(shipped.$defs.out, proto.$defs.out);
  assert.equal(shipped.$defs.in.properties.context.additionalProperties, false); // "additionalProperties: false"
});

test('samples in the prototype’s spirit validate, for the role they declare', () => {
  assert.deepEqual(validateHandoff(IN, { runDir: RUN }), { ok: true, role: 'in', errors: [] });
  assert.deepEqual(validateHandoff(OUT), { ok: true, role: 'out', errors: [] });
});

test('faults are errors with a where · what · fix', () => {
  const cases = [
    [{ ...OUT, role: 'in' }, { role: 'out' }, '/role'],
    [{ ...OUT, contract: 'x' }, {}, '/contract'],
    [{ ...OUT, status: 'maybe' }, {}, '/status'],
    [{ ...OUT, verdict: {} }, {}, '/verdict'],
    [{ ...IN, owns: [] }, {}, '/owns'],
    [{ ...IN, output: '../escape.json' }, {}, '/output'],
    [{ ...IN, context: { mood: 'x' } }, {}, '/context/mood'],
    [{ ...OUT, result: { blob: 'x'.repeat(70 * 1024) } }, {}, '/result'],
    [[], {}, '/'],
  ];
  for (const [doc, opts, where] of cases) {
    const r = validateHandoff(doc, opts);
    assert.equal(r.ok, false, JSON.stringify(doc).slice(0, 80));
    assert.ok(
      r.errors.some((e) => e.where === where && e.what && e.fix),
      `${where}: ${JSON.stringify(r.errors)}`
    );
  }
  assert.doesNotThrow(() => validateHandoff(null));
});

test('`owns` outside the hand-off’s own run folder is refused for a read-only agent, allowed for a bounded writer', () => {
  const wide = { ...IN, owns: ['.design/ui/Pricing.tsx'] };
  const r = validateHandoff(wide, { runDir: RUN });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].where, '/owns/0');
  assert.match(r.errors[0].what, /outside the run folder/);
  // a glob that starts inside the run folder but escapes via a wildcard prefix is still outside
  assert.equal(validateHandoff({ ...IN, owns: ['.design/_runs/*/x'] }, { runDir: RUN }).ok, false);
  assert.equal(isBoundedWriter('design:draw-agent'), true);
  assert.equal(validateHandoff({ ...wide, agent: 'design:draw-agent' }, { runDir: RUN }).ok, true);
  // without a run folder the rule is skipped (validateHandoff(doc) alone)
  assert.equal(validateHandoff(wide).ok, true);
});

test('ownsPath: `*` within a segment, `**` across', () => {
  const doc = { owns: [`${RUN}handoff/*.out.json`, '.design/assets/**/*.svg'] };
  assert.equal(ownsPath(doc, `${RUN}handoff/a-0.out.json`), true);
  assert.equal(ownsPath(doc, `${RUN}handoff/x/a-0.out.json`), false);
  assert.equal(ownsPath(doc, '.design/assets/logo.svg'), true);
  assert.equal(ownsPath(doc, '.design/assets/a/b/logo.svg'), true);
  assert.equal(ownsPath(doc, '.design/ui/Pricing.tsx'), false);
  assert.equal(ownsPath(doc, '.design/assets/../ui/x.svg'), false);
});

test('readHandoff finds the run folder from the file’s own path, and never throws', () => {
  const root = mkdtempSync(join(tmpdir(), 'maude-handoff-'));
  try {
    const dir = join(root, '.design', '_runs', '3f2a9c1e-uuid', 'handoff');
    mkdirSync(dir, { recursive: true });
    const abs = join(dir, 'design-critic-0.in.json');
    writeFileSync(abs, JSON.stringify(IN));
    assert.equal(runDirOf(abs, root), RUN);
    const r = readHandoff(abs, { role: 'in', root });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.runDir, RUN);
    writeFileSync(abs, JSON.stringify({ ...IN, owns: ['.design/ui/x.tsx'] }));
    assert.equal(readHandoff(abs, { role: 'in', root }).ok, false);
    writeFileSync(abs, '{nope');
    assert.match(readHandoff(abs, { root }).errors[0].what, /not valid JSON/);
    assert.match(readHandoff(join(dir, 'missing.out.json')).errors[0].what, /does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a critic verdict → HandoffOut.findings[] round-trips (S12 critics adopt HandoffOut)', () => {
  const verdict = {
    agent: 'design-critic',
    iter: 2,
    blockers: 2,
    warnings: 1,
    top_blockers: [
      {
        category: 'a11y',
        line: 245,
        summary: 'Color contrast 3.1:1',
        fix: 'Switch to var(--fg-1).',
      },
      {
        category: 'ds-tokens',
        line: 312,
        summary: 'Hardcoded #FF6B6B',
        fix: 'Use var(--presence-1).',
      },
    ],
    passed: false,
  };
  const out = criticVerdictToHandoff(verdict, { runId: 'r_abcd1234' });
  assert.deepEqual(validateHandoff(out, { role: 'out' }).errors, []);
  assert.equal(out.agent, 'design:design-critic');
  assert.deepEqual(handoffToCriticVerdict(out), verdict);
});
