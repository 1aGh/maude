// Phase 11 (flow ⇄ design integration) regression guard.
//
// The slash-command orchestration (/flow:plan canvas detection, /flow:done
// handoff sweep, codebase-intelligence design section, ddr-keeper canvas prompt)
// is LLM-driven markdown — not unit-testable. What IS deterministic, and what
// this test locks down, is the *contract* that wiring depends on:
//
//   1. The canvas `.meta.json` schema accepts the Phase 11 fields
//      (status enum, handoffCommit, tags, brief_sha) and rejects a bad status.
//   2. The flow config schema accepts `paths.designRoot`, the real skeleton
//      config validates, and the field stays OPTIONAL (no regression for
//      projects without the design plugin).
//   3. The /flow:done status round-trip (ready-for-handoff → handed-off +
//      handoffCommit) produces schema-valid output at both ends.
//   4. The markdown wiring for all four integrations is present (grep guard) —
//      a future edit that deletes a section fails loudly here.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { lintConfig } from './config-lint.mjs';

const read = (p) => readFileSync(resolve(p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const META_SCHEMA = readJson('apps/studio/canvas-meta.schema.json');
const FLOW_SCHEMA = readJson('plugins/flow/.claude-plugin/config.schema.json');
const SKELETON = readJson('plugins/flow/templates/ai-skeleton/workflows.config.json');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateMeta = ajv.compile(META_SCHEMA);

// ── 1. canvas-meta schema accepts the Phase 11 fields ──────────────────────

test('canvas-meta: accepts status + tags (ready-for-handoff)', () => {
  const ok = validateMeta({
    title: 'Dark Mode Toggle',
    sections: [{ id: 'hero', label: 'Hero' }],
    tags: ['dark-mode'],
    status: 'ready-for-handoff',
  });
  assert.equal(ok, true, JSON.stringify(validateMeta.errors));
});

test('canvas-meta: accepts handed-off + handoffCommit + brief_sha', () => {
  const ok = validateMeta({
    title: 'Settings',
    sections: [],
    status: 'handed-off',
    handoffCommit: '8dd832b',
    brief_sha: 'abc123def456',
  });
  assert.equal(ok, true, JSON.stringify(validateMeta.errors));
});

test('canvas-meta: every status enum value is accepted', () => {
  for (const status of ['draft', 'in-review', 'ready-for-handoff', 'handed-off']) {
    const ok = validateMeta({ title: 'X', sections: [], status });
    assert.equal(ok, true, `status=${status}: ${JSON.stringify(validateMeta.errors)}`);
  }
});

test('canvas-meta: a bogus status enum is REJECTED', () => {
  const ok = validateMeta({ title: 'X', sections: [], status: 'shipped' });
  assert.equal(ok, false, 'expected status="shipped" to be rejected by the enum');
});

test('canvas-meta: back-compat — a sidecar without any Phase 11 field still validates', () => {
  const ok = validateMeta({ title: 'Legacy', sections: [{ id: 's', label: 'S' }] });
  assert.equal(ok, true, JSON.stringify(validateMeta.errors));
});

test('canvas-meta: tags must be unique strings', () => {
  assert.equal(validateMeta({ title: 'X', sections: [], tags: ['a', 'a'] }), false);
  assert.equal(validateMeta({ title: 'X', sections: [], tags: [1, 2] }), false);
});

// ── 2. flow config schema: paths.designRoot ────────────────────────────────

test('flow config: the real skeleton config (with paths.designRoot) validates', async () => {
  const r = await lintConfig({ config: SKELETON, schema: FLOW_SCHEMA });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('flow config: skeleton declares paths.designRoot = .design', () => {
  assert.equal(SKELETON.paths.designRoot, '.design');
});

test('flow config: paths.designRoot is OPTIONAL (no-regression for non-design projects)', async () => {
  const r = await lintConfig({
    config: { name: 'x', paths: { prd: '.ai/x-prd.md' } },
    schema: FLOW_SCHEMA,
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('flow config: a non-string paths.designRoot is rejected', async () => {
  const r = await lintConfig({
    config: { name: 'x', paths: { designRoot: 42 } },
    schema: FLOW_SCHEMA,
  });
  assert.equal(r.ok, false);
});

test('flow config: paths.designRoot carries a default of .design', () => {
  assert.equal(FLOW_SCHEMA.properties.paths.properties.designRoot.default, '.design');
});

// ── 3. /flow:done status round-trip stays schema-valid ─────────────────────

test('done sweep round-trip: ready-for-handoff → handed-off + handoffCommit both valid', () => {
  const before = { title: 'Canvas', sections: [], status: 'ready-for-handoff', tags: ['feat'] };
  assert.equal(validateMeta(before), true, `before: ${JSON.stringify(validateMeta.errors)}`);

  // what /flow:done step 5b writes:
  const after = { ...before, status: 'handed-off', handoffCommit: 'deadbeef0123' };
  assert.equal(validateMeta(after), true, `after: ${JSON.stringify(validateMeta.errors)}`);
});

// ── 4. markdown wiring guards (a deleted section fails here) ────────────────

const PLAN = read('plugins/flow/commands/plan.md');
const DONE = read('plugins/flow/commands/done.md');
// Commands and skills are an index plus linked stage/guide files; read the
// index and every local markdown file it links, one level deep.
const withLinked = (p) => {
  const text = read(p);
  const dir = p.split('/').slice(0, -1).join('/');
  const linked = [...text.matchAll(/\]\((\.{0,2}\/?[^)#\s]+\.md)\)/g)]
    .map((m) => `${dir}/${m[1]}`)
    .filter((q, i, all) => all.indexOf(q) === i)
    .map((q) => {
      try {
        return read(q);
      } catch {
        return '';
      }
    });
  return [text, ...linked].join('\n');
};
const MAP_CMD = withLinked('plugins/flow/commands/setup-codebase-map.md');
const CI_SKILL = withLinked('plugins/flow/skills/codebase-intelligence/SKILL.md');
const DDR_SKILL = read('plugins/flow/skills/ddr-keeper/SKILL.md');
const RECORD_DDR = read('plugins/flow/commands/record-ddr.md');

test('wiring: /flow:plan has Design Canvas Detection', () => {
  assert.match(PLAN, /Design Canvas Detection/);
  assert.match(PLAN, /paths\.designRoot/);
  assert.match(PLAN, /### Design canvases/); // the Context References subsection
});

test('wiring: /flow:done has the handoff sweep + soft-gate DDR-066 reference', () => {
  assert.match(DONE, /Design handoff sweep/);
  assert.match(DONE, /ready-for-handoff/);
  assert.match(DONE, /handed-off/);
  assert.match(DONE, /handoffCommit/);
  assert.match(DONE, /DDR-066/);
});

test('wiring: codebase map command + skill have the Design artifacts section', () => {
  assert.match(MAP_CMD, /Map Design Artifacts/);
  assert.match(MAP_CMD, /## Design artifacts/);
  assert.match(CI_SKILL, /Design Artifact Scanning/);
  assert.match(CI_SKILL, /### Design artifacts/);
});

test('wiring: ddr-keeper + record-ddr have the canvas-reference prompt', () => {
  assert.match(DDR_SKILL, /Canvas reference for UI-affecting decisions/);
  assert.match(DDR_SKILL, /Related canvas/);
  assert.match(RECORD_DDR, /Related canvas/);
});

test('wiring: DDR-066 exists and is indexed', () => {
  const ddr = read('.ai/archive/decisions/DDR-066-soft-handoff-prompt-in-flow-done.md');
  assert.match(ddr, /soft prompt/i);
  const index = read('.ai/archive/decisions/README.md');
  assert.match(index, /DDR-066/);
});
