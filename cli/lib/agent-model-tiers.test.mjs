// Guardrail 4 of the flow refactor: plugin agents pick a model by TIER alias, never a dated model
// id — a literal id breaks the day that model is retired, in every downstream repo at once.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ALIASES = new Set(['sonnet', 'opus', 'haiku', 'inherit']);

test('every plugin agent model: is a tier alias', () => {
  const bad = [];
  for (const plugin of ['flow', 'design']) {
    const dir = join('plugins', plugin, 'agents');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const fm = readFileSync(join(dir, f), 'utf8').split(/^---$/m)[1] ?? '';
      const m = fm.match(/^model:\s*(.+)$/m);
      if (m && !ALIASES.has(m[1].trim())) bad.push(`${plugin}/${f}: ${m[1].trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the flow role agents exist with their tiers', () => {
  const tier = (f) =>
    readFileSync(join('plugins/flow/agents', f), 'utf8').match(/^model:\s*(\S+)/m)?.[1];
  assert.equal(tier('worker.md'), 'sonnet');
  assert.equal(tier('spike.md'), 'opus');
  assert.equal(tier('scout.md'), 'sonnet');
});
