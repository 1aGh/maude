// V2-2.4b (lead answer c, decision:maude/v2-2.4b-held-and-prompting-verbs) — `ds-upgrade`'s
// read-only steps are sub-verbs, so the AI chat can auto-allow them with a prefix rule, and a
// step flag after a sub-verb is refused (a prefix rule can't see what follows it).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SUB_VERBS, subVerbArgs } from './sub-verbs.mjs';

const MAUDE = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'maude.mjs');

test('analyse / plan map to the read-only step flags', () => {
  assert.deepEqual(subVerbArgs('ds-upgrade', ['analyse', 'acme']), { args: ['acme', '--analyse'] });
  assert.deepEqual(subVerbArgs('ds-upgrade', ['plan', 'acme', '--root', '/p']), {
    args: ['acme', '--root', '/p', '--plan-mechanical'],
  });
});

test('validate takes the plan file as its second word', () => {
  assert.deepEqual(subVerbArgs('ds-upgrade', ['validate', 'acme', 'p.json', '--json']), {
    args: ['acme', '--json', '--validate', 'p.json'],
  });
  assert.match(subVerbArgs('ds-upgrade', ['validate', 'acme']).error, /plan/);
});

test('a step flag after a sub-verb is refused — no escalation through the prefix rule', () => {
  for (const flag of ['--apply', '--stage', '--validate', '--analyse', '--plan-mechanical']) {
    const r = subVerbArgs('ds-upgrade', ['analyse', 'acme', flag, 'p.json']);
    assert.ok(r.error, flag);
    assert.match(r.error, /sub-verb/);
  }
  assert.ok(subVerbArgs('ds-upgrade', ['plan', 'acme', '--apply=p.json']).error);
});

test('the flag form and other verbs pass through unchanged', () => {
  assert.deepEqual(subVerbArgs('ds-upgrade', ['acme', '--apply', 'p.json']), {
    args: ['acme', '--apply', 'p.json'],
  });
  assert.deepEqual(subVerbArgs('slug', ['analyse']), { args: ['analyse'] });
});

test('SUB_VERBS names exactly the auto sub-verbs of the tier table', () => {
  assert.deepEqual(Object.keys(SUB_VERBS['ds-upgrade']).sort(), ['analyse', 'plan', 'validate']);
});

test('the dispatcher exits 2 on an escalating flag before spawning the helper', () => {
  const r = spawnSync(
    process.execPath,
    [MAUDE, 'design', 'ds-upgrade', 'analyse', 'acme', '--apply', 'p.json'],
    {
      encoding: 'utf8',
      env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1' },
    }
  );
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /sub-verb/);
});
