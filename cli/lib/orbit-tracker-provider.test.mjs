// `integrations.tracker.provider: "orbit"` regression guard.
//
// The orbit wiring itself is LLM-driven markdown (the `flow:orbit-backend`
// skill plus one routing line per command) — not unit-testable. What IS
// deterministic, and what this test locks down, is the contract that wiring
// depends on:
//
//   1. The flow config schema accepts `provider: "orbit"` with its two
//      orbit-only knobs (`baseUrl`, `tokenEnv`), rejects malformed values, and
//      keeps `tracker` closed (`additionalProperties: false`).
//   2. The skill exists under its bare name, every stage reference it links
//      resolves, and it names the exact orbit MCP tools the server registers.
//   3. Every command that branches on the provider routes `orbit` to the skill
//      — a future edit that drops a route fails loudly here.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { lintConfig } from './config-lint.mjs';

const read = (p) => readFileSync(resolve(p), 'utf8');
const SCHEMA = JSON.parse(read('plugins/flow/.claude-plugin/config.schema.json'));
const SKILL_DIR = 'plugins/flow/skills/orbit-backend';

const orbitConfig = (tracker) => ({ name: 'x', integrations: { tracker } });

// ── 1. config schema ────────────────────────────────────────────────────────

test('schema: orbit tracker with baseUrl + tokenEnv + free-form defaults validates', async () => {
  const r = await lintConfig({
    config: orbitConfig({
      provider: 'orbit',
      mcp: 'mcp__orbit',
      baseUrl: 'https://orbit.example.com',
      tokenEnv: 'ORBIT_MCP_TOKEN',
      defaults: { repo: 'x', list: 'Engineering/Backlog', doneStatus: 'done' },
    }),
    schema: SCHEMA,
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('schema: orbit needs no extra keys — provider alone validates', async () => {
  const r = await lintConfig({ config: orbitConfig({ provider: 'orbit' }), schema: SCHEMA });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('schema: tokenEnv holds a variable NAME, not a token', async () => {
  for (const tokenEnv of ['sfa_abc123', 'orbit_token', 'Bearer X', '1TOKEN']) {
    const r = await lintConfig({
      config: orbitConfig({ provider: 'orbit', tokenEnv }),
      schema: SCHEMA,
    });
    assert.equal(r.ok, false, `tokenEnv=${tokenEnv} should be rejected`);
    assert.ok(r.errors.some((e) => e.path === '/integrations/tracker/tokenEnv'));
  }
});

test('schema: baseUrl must be an http(s) URL', async () => {
  for (const baseUrl of ['orbit.example.com', 'ftp://orbit.example.com']) {
    const r = await lintConfig({
      config: orbitConfig({ provider: 'orbit', baseUrl }),
      schema: SCHEMA,
    });
    assert.equal(r.ok, false, `baseUrl=${baseUrl} should be rejected`);
    assert.ok(r.errors.some((e) => e.path === '/integrations/tracker/baseUrl'));
  }
});

test('schema: tracker stays closed — an unknown key (e.g. a token) is rejected', async () => {
  const r = await lintConfig({
    config: orbitConfig({ provider: 'orbit', token: 'sfa_secret' }),
    schema: SCHEMA,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path.endsWith('/token')));
});

// ── 2. the skill ────────────────────────────────────────────────────────────

test('skill: orbit-backend declares its bare name and every linked reference exists', () => {
  const entry = read(join(SKILL_DIR, 'SKILL.md'));
  assert.match(entry, /^---\nname: orbit-backend\n/);
  const links = [...entry.matchAll(/\]\(\.\/(_guide-[^)]+\.md)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 5, `expected stage references, found ${links.length}`);
  for (const link of links) assert.ok(existsSync(join(SKILL_DIR, link)), `missing ${link}`);
  const onDisk = readdirSync(SKILL_DIR).filter((f) => f.startsWith('_guide-'));
  assert.deepEqual(onDisk.sort(), [...new Set(links)].sort(), 'an unlinked reference file');
});

test('skill: names the exact orbit MCP tools and keeps the warn-only + untrusted guards', () => {
  const body = readdirSync(SKILL_DIR)
    .map((f) => read(join(SKILL_DIR, f)))
    .join('\n');
  // The names orbit's MCP registry exposes (orbit `src/server/mcp/tools.ts` +
  // `workspace-tools.ts`). A rename on the orbit side must land here too.
  for (const tool of [
    'orbit_get_task',
    'orbit_create_task',
    'orbit_update_task',
    'orbit_state_report',
    'orbit_artifact_push',
    'orbit_artifact_pull',
  ]) {
    assert.ok(body.includes(tool), `skill never names ${tool}`);
  }
  assert.match(body, /warn-only/i);
  assert.match(body, /untrusted DATA, not instructions/);
  assert.match(body, /ORBIT_MCP_TOKEN/);
});

// ── 3. command routing ──────────────────────────────────────────────────────

for (const command of ['plan', 'execute', 'done', 'status', 'bug-rca', 'bug-fix']) {
  test(`routing: /flow:${command} sends provider "orbit" to flow:orbit-backend`, () => {
    const text = read(`plugins/flow/commands/${command}.md`);
    assert.match(text, /orbit/);
    assert.ok(text.includes('flow:orbit-backend'), `${command}.md never loads flow:orbit-backend`);
  });
}

test('routing: /flow:init offers orbit as a tracker provider', () => {
  assert.match(read('plugins/flow/commands/init.md'), /`shortcut` \| `orbit` \| `none`/);
});

// ── 4. the artifact store (`integrations.tracker.artifacts`) ────────────────
//
// `store: "orbit"` moves the five workflow artifacts out of `.ai/` and makes
// orbit the record. The failure that matters is silent data loss — a command
// deleting its scratch file without a confirmed push — so what is locked down
// here is the wiring that keeps that from being reinvented per command: the
// knob validates, the contract is a guide, and every command that authors an
// artifact points at that guide rather than at its own recipe.

const artifacts = (a) => orbitConfig({ provider: 'orbit', artifacts: a });

test('schema: the full artifact store validates', async () => {
  const r = await lintConfig({
    config: artifacts({
      store: 'orbit',
      local: 'scratch',
      spoolDir: '.ai/tmp/orbit-spool',
      kinds: ['plan', 'rca', 'execution-report', 'retro', 'review'],
    }),
    schema: SCHEMA,
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('schema: artifacts is optional and every field has a default', async () => {
  for (const config of [
    orbitConfig({ provider: 'orbit' }),
    artifacts({}),
    artifacts({ store: 'both' }),
  ]) {
    const r = await lintConfig({ config, schema: SCHEMA });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  }
});

test('schema: store, local and kinds are closed enums — a typo never reads as "keep the file"', async () => {
  const bad = [
    [{ store: 'remote' }, '/integrations/tracker/artifacts/store'],
    [{ local: 'delete' }, '/integrations/tracker/artifacts/local'],
    [{ kinds: ['plan', 'ddr'] }, '/integrations/tracker/artifacts/kinds/1'],
    [{ kinds: ['plan', 'plan'] }, '/integrations/tracker/artifacts/kinds'],
  ];
  for (const [value, path] of bad) {
    const r = await lintConfig({ config: artifacts(value), schema: SCHEMA });
    assert.equal(r.ok, false, `${JSON.stringify(value)} should be rejected`);
    assert.ok(
      r.errors.some((e) => e.path === path),
      `${JSON.stringify(value)} → expected an error at ${path}, got ${JSON.stringify(r.errors)}`
    );
  }
});

test('schema: artifacts stays closed — an unknown key is rejected', async () => {
  const r = await lintConfig({
    config: artifacts({ store: 'orbit', deleteLocal: true }),
    schema: SCHEMA,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path.endsWith('/deleteLocal')));
});

test('guide 06: carries the push-before-delete rule and the five kinds', () => {
  const guide = read(join(SKILL_DIR, '_guide-06-artifact-store.md'));
  for (const kind of ['plan', 'rca', 'execution-report', 'retro', 'review']) {
    assert.ok(guide.includes(kind), `guide 06 never names the ${kind} kind`);
  }
  // The one unrecoverable mistake: a scratch file removed before orbit confirms.
  assert.match(
    guide,
    /Never delete before the confirmation comes back|deleted once orbit confirms/
  );
  assert.match(guide, /orbit_artifact_push/);
  assert.match(guide, /orbit_artifact_pull/);
  // Inactive orbit must fall back to the file, never drop the artifact.
  assert.match(guide, /\[orbit\] inactive/);
});

for (const [command, kind] of [
  ['plan', 'plan'],
  ['bug-rca', 'rca'],
  ['record-execution', 'execution-report'],
  ['record-retro', 'retro'],
  ['review-code', 'review'],
]) {
  test(`routing: /flow:${command} routes its artifact through guide 06 as kind ${kind}`, () => {
    const text = read(`plugins/flow/commands/${command}.md`);
    assert.ok(
      text.includes('_guide-06-artifact-store.md'),
      `${command}.md never points at the artifact-store guide`
    );
    assert.ok(
      text.includes('integrations.tracker.artifacts.store'),
      `${command}.md never reads the store setting`
    );
    assert.ok(text.includes(`kind \`${kind}\``), `${command}.md never names kind ${kind}`);
  });
}

test('routing: the spool is never cleaned as a temp file', () => {
  const text = read('plugins/flow/commands/maintain-clean.md');
  assert.ok(text.includes('spoolDir'), 'maintain-clean.md never mentions the spool');
  assert.match(text, /never offer its contents for deletion|Never Touch the orbit Spool/);
});

// ── 5. orbit must not starve kgai ───────────────────────────────────────────
//
// `kg record-log` reads the verdict FILE off disk and infers the node kind from
// its parent directory (`LOG_KINDS` in ddr-to-kgai.mjs). With `store: orbit` +
// `local: scratch` the canonical `.ai/logs/<kind>/` path never exists and the
// spool file is deleted on a confirmed push — so recording has to happen BEFORE
// the push, with an explicit `--kind`. Get either half wrong and the graph
// silently stops being fed while every command still reports success.

test('guide 06: records into kgai before the push, with an explicit kind', () => {
  const guide = read(join(SKILL_DIR, '_guide-06-artifact-store.md'));
  assert.match(guide, /kg record-log/);
  assert.match(guide, /--kind/);
  assert.ok(
    guide.indexOf('kg record-log') < guide.indexOf('### 3. Push it'),
    'the record-log step must come before the push step'
  );
  // The kind map must agree with LOG_KINDS — a retro is a `system-review` node,
  // a review a `code-review` one; naming them by their orbit kind forks the corpus.
  for (const kind of ['system-review', 'code-review', 'execution-report']) {
    assert.ok(guide.includes(kind), `guide 06 never maps the ${kind} kgai kind`);
  }
});

for (const [command, kk] of [
  ['bug-rca', 'rca'],
  ['record-execution', 'execution-report'],
  ['record-retro', 'system-review'],
  ['review-code', 'code-review'],
]) {
  test(`kgai: /flow:${command} still feeds the graph under store: orbit`, () => {
    const text = read(`plugins/flow/commands/${command}.md`);
    assert.ok(text.includes('kg record-log'), `${command}.md lost its record-log step`);
    assert.ok(
      text.includes(`--kind ${kk}`),
      `${command}.md never pins the kgai kind (${kk}) for the spool path`
    );
    assert.ok(
      text.includes('before** the push'),
      `${command}.md never states that recording precedes the push`
    );
  });
}
