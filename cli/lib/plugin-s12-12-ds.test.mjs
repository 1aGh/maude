// S12.12 — pins for the design-system agents and /design:system (S12-slices §3, §2.3).
//
// The words ratchet keeps old strings out and plugin-name-namespace.test.mjs keeps the agent
// hygiene (bounded writers, description budget). These pins keep the behaviour S12.12 wired:
//   - /design:system is thin over `maude design ds …` + `import-tokens`; it proposes a switch with
//     --dry-run, migrates only through ds-migrator, and never relinks a library (human-only,
//     decision v2-gate-b-sec1-library-link-record);
//   - ds-migrator migrates through `maude design ds convert` (dry run first, then the verb), writes
//     only its review + result, and never computes Dark (decision v2-S10.21-dark-follows-in-engine);
//   - the keeper's Pass C and the completeness critic read the verbs' real `--json` formats;
//   - /design:critic --system-only runs check-system, spawns both on hand-offs and posts the
//     findings on the Design system canvas for "Ask AI to review";
//   - brand-critic's canonical mark source is the Design system canvas's Brand section.
// The recipes themselves run against real verb output in apps/studio/test/ds-agent-recipes.test.ts.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, 'plugins', 'design', rel), 'utf8');
const front = (text) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
/** fenced code (where a command is RUN), without the prose that says what never to run */
const code = (text) => [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
const RELINK = /maude design ds library link\b/;

test('S12.12: /design:system is a daily command over the ds verbs', () => {
  assert.ok(existsSync(join(ROOT, 'plugins/design/commands/system.md')), 'commands/system.md');
  const sys = read('commands/system.md');
  assert.match(front(sys), /^name: system$/m);
  assert.match(front(sys), /^category: daily$/m);
  for (const verb of [
    'maude design ds status',
    'maude design ds default',
    'maude design ds switch',
    'maude design ds keep',
    'maude design ds undo',
    'maude design ds check-system',
    'maude design import-tokens',
  ])
    assert.ok(sys.includes(verb), `system.md names \`${verb}\``);
  assert.match(sys, /ds switch [^\n`]*--dry-run/, 'a switch is proposed with --dry-run first');
  assert.match(sys, /design:ds-migrator/, 'migrate goes through the ds-migrator agent');
  assert.match(sys, /Update N canvases/, 'applying a token change is the "Update N canvases" card');
});

test("S12.12: relinking a library is the person's — no agent runs `ds library link`", () => {
  for (const rel of ['commands/system.md', 'agents/ds-migrator.md']) {
    const text = read(rel);
    assert.doesNotMatch(code(text), RELINK, `${rel}: no code block runs ds library link`);
    assert.match(text, /ds-library-relink/, `${rel}: names the relink refusal`);
    assert.match(text, /Link again/, `${rel}: points the person at "Link again"`);
  }
});

test('S12.12: ds-migrator converts through the verb, dry run first, and owns a review', () => {
  const mig = read('agents/ds-migrator.md');
  const fm = front(mig);
  assert.match(fm, /^name: ds-migrator$/m);
  assert.match(fm, /^tools: Read, Write, Glob, Grep, Bash$/m, 'no Edit: it never edits a file');
  const body = code(mig);
  const dry = body.indexOf('maude design ds convert "$DS" --dry-run --json');
  const real = body.indexOf('maude design ds convert "$DS" --json');
  assert.ok(dry >= 0, 'a dry run of ds convert');
  assert.ok(real > dry, 'the real convert comes after the dry run');
  assert.match(mig, /maude\.ds-convert\/1/);
  assert.match(mig, /maude design ds check-system "\$DS" --json/);
  assert.match(mig, /Sample hand-off/);
  assert.match(mig, /\.review\.md/);
  assert.match(mig, /v2-S10\.21-dark-follows-in-engine/, 'names the Dark-follows decision');
  assert.doesNotMatch(mig, /comput\w* (the )?Dark (value )?yourself(?! — )/i);
});

test('S12.12: keeper Pass C reads ds status / usage / check-system in their --json formats', () => {
  const k = read('agents/design-system-keeper.md');
  for (const s of [
    'maude design ds status "$DS" --json',
    'maude design ds usage "$DS" --json',
    'maude design ds check-system "$DS" --json',
    'maude.ds-state/1',
    'maude.ds-usage/1',
    'maude.ds-system-check/1',
    '<!-- recipe:keeper-ds-state -->',
  ])
    assert.ok(k.includes(s), `keeper names ${s}`);
  assert.match(k, /left out[^\n]*never drift/i, 'a left-out canvas is never drift');
  assert.match(k, /untrusted/i, "the verbs' labels are other people's text");
});

test('S12.12: completeness checks the Design system canvas sections and the determinism', () => {
  const c = read('agents/design-system-completeness-critic.md');
  for (const id of [
    'ds-brand',
    'ds-colour',
    'ds-type',
    'ds-space',
    'ds-motion',
    'ds-components',
    'ds-patterns',
  ])
    assert.ok(c.includes(`\`${id}\``), `completeness names the section artboard ${id}`);
  assert.ok(c.includes('<!-- recipe:completeness-determinism -->'));
  assert.match(
    c,
    /manifests\["tokens\.json"\]/,
    'α systems: ds-check says whether tokens.json is fresh'
  );
  assert.match(c, /maude\.agent-handoff\/1/);
  assert.match(c, /maude design check <output>/);
});

test('S12.12: /design:critic --system-only feeds "Ask AI to review"', () => {
  const cr = read('commands/critic.md');
  const at = cr.indexOf('### 2b.');
  const end = cr.indexOf('### 3.', at);
  const sec = cr.slice(at, end);
  assert.match(sec, /maude design ds check-system "\$DS" --json/);
  assert.match(sec, /design:design-system-completeness-critic/);
  assert.match(sec, /design:design-system-keeper/);
  assert.match(sec, /handoff\/design-system-completeness-critic-\$N\.in\.json/);
  assert.match(sec, /handoff\/design-system-keeper-\$N\.in\.json/);
  assert.match(sec, /comments add --as-ai [^\n]*--findings/);
  assert.match(sec, /design-system\.tsx/);
  assert.match(sec, /Ask AI to review/);
});

test('S12.12: brand-critic takes the canonical mark from the Brand section', () => {
  const b = read('agents/brand-critic.md');
  assert.match(b, /`ds-brand`/);
  assert.match(b, /assets\/logos\//);
  assert.match(b, /DDR-141/);
});
