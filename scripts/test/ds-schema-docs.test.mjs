// V2-8.15 — the design-system schema page says what the registry says.
//
// site/content/docs/design-system-schema.mdx is written by hand from apps/studio/schema/ds-schema-v1.json.
// This test is the tripwire: when the registry gains or loses a role, a slot, a component, an icon or a
// type role, the page has to follow. The page abbreviates in three ways, and each is handled here and
// nowhere else: a status role listed once with its -fg / -soft / -text forms, a numbered range
// (--space-0 to --space-8, --lh-xs to --lh-3xl), and the colour-role asterisk.
//
//   node --test scripts/test/ds-schema-docs.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PAGE_PATH = join(ROOT, 'site', 'content', 'docs', 'design-system-schema.mdx');
const REGISTRY = JSON.parse(
  readFileSync(join(ROOT, 'apps', 'studio', 'schema', 'ds-schema-v1.json'), 'utf8')
);

const page = process.env.DS_SCHEMA_PAGE_UNDER_TEST
  ? readFileSync(process.env.DS_SCHEMA_PAGE_UNDER_TEST, 'utf8')
  : readFileSync(PAGE_PATH, 'utf8');

/** Names the page may print once for a whole family. */
function coveredByAbbreviation(name) {
  // --status-warn-fg: the page lists --status-warn and says "each also with -fg, -soft and -text".
  const sub = /^(--status-[a-z]+)-(fg|soft|text)$/.exec(name);
  if (sub) return page.includes(`\`${sub[1]}\``) && page.includes('`-fg`, `-soft` and `-text`');
  // --space-1..8 and --lh-sm..3xl: the first and last of the range are printed.
  if (/^--space-[1-7]$/.test(name)) return page.includes('`--space-0` to `--space-8`');
  if (/^--lh-/.test(name)) return page.includes('`--lh-xs` to `--lh-3xl`');
  return false;
}

test('the page says how many core roles there are, and the number is the registry’s', () => {
  assert.equal(REGISTRY.roles.length, 95);
  assert.match(page, /\b95 named roles\b/);
  assert.match(page, /\*\*69 aliases\*\*/);
  assert.equal(REGISTRY.aliases.length, 69);
});

test('every core role is on the page (printed, or covered by a range the page states)', () => {
  const missing = REGISTRY.roles
    .map((r) => r.name)
    .filter((n) => !page.includes(`\`${n}\``) && !coveredByAbbreviation(n));
  assert.deepEqual(missing, [], 'the registry has roles the page does not list');
});

test('a colour role carries the asterisk and a non-colour role does not', () => {
  const wrong = REGISTRY.roles.filter((r) => {
    if (coveredByAbbreviation(r.name) && !page.includes(`\`${r.name}\``)) return false;
    const starred = page.includes(`\`${r.name}\`*`);
    return r.perTheme ? !starred : starred;
  });
  assert.deepEqual(
    wrong.map((r) => r.name),
    []
  );
});

test('every slot kind, core component, type role and icon is named', () => {
  for (const s of REGISTRY.slots) assert.ok(page.includes(`\`${s.kind}\``), `slot ${s.kind}`);
  for (const c of [...REGISTRY.components.core, ...REGISTRY.components.brand])
    assert.ok(page.includes(c.name), `component ${c.name}`);
  for (const c of REGISTRY.components.extended)
    assert.ok(page.includes(c.name), `extended component ${c.name}`);
  for (const r of REGISTRY.typeRoles) {
    const cls = r.class.endsWith('-n') ? `${r.class.slice(0, -1)}N` : r.class;
    assert.ok(page.includes(`\`${cls}\``), `type role ${cls}`);
  }
  for (const i of REGISTRY.icons.vocabulary) assert.ok(page.includes(`\`${i}\``), `icon ${i}`);
  assert.equal(REGISTRY.icons.vocabulary.length, 40);
  assert.match(page, /Forty names/);
});

test('every canvas rule and every exit code is named', () => {
  for (const r of REGISTRY.canvasRules) assert.ok(page.includes(`| ${r.id} |`), `rule ${r.id}`);
  for (const [, code] of Object.entries(REGISTRY.levels.exit))
    assert.ok(page.includes(`\`${code}\``), `exit ${code}`);
});
