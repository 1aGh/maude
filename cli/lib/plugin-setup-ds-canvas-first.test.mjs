// r4 #10 — "I had a design system created, but it came out as a static page and offers Convert". The chat's
// agent follows the BUNDLED design plugin (DDR-168). Its "create a design system" path must start the system on
// its Design system canvas (`maude design ds make`), not scaffold a v1 folder. This pins the words the agent
// reads: the command and the skill both send a new system through `ds make` before any scaffold.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'design');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('setup-ds starts a new system with `ds make` before the scaffold steps', () => {
  const md = read('commands/setup-ds.md');
  const make = md.indexOf('maude design ds make <name>');
  assert.ok(make > 0, 'setup-ds.md must tell the agent to run `maude design ds make <name>`');
  assert.ok(
    make < md.indexOf('### Step 1.5'),
    '`ds make` comes before the inspiration-library / scaffold steps'
  );
  assert.match(md, /never as a static folder page/i);
  assert.match(md, /fallback/i);
});

test('the design-system skill bootstraps first-bootstrap / additional-ds through `ds make`', () => {
  const skill = read('skills/design-system/SKILL.md');
  assert.match(skill, /A new system in a Maude project starts on its canvas/);
  assert.match(skill, /maude design ds make <target_ds>/);
  const boot = read('skills/design-system/_bootstrap.md');
  assert.match(boot, /every new system you start yourself in a Maude project/);
});
