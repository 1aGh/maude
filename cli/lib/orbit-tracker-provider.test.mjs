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
