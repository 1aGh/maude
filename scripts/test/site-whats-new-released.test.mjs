// The public site never names a PENDING What's New entry (version + date null until
// scripts/bump-version.sh stamps them). site/components/v2 reads the feed only through
// released.ts; reading entries[0] directly broke the site build (`newest.version` possibly null)
// the moment a pending 2.0.4 entry sat on top of the feed, and would have announced it on the home page.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'site/components/v2');

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? files(join(dir, d.name))
      : /\.(ts|tsx)$/.test(d.name)
        ? [join(dir, d.name)]
        : []
  );
}

test("site/components/v2 reads the What's New feed only through released.ts", () => {
  const offenders = files(DIR).filter(
    (f) => !f.endsWith('/released.ts') && /@\/lib\/whats-new\.json/.test(readFileSync(f, 'utf8'))
  );
  assert.deepEqual(
    offenders.map((f) => f.slice(ROOT.length + 1)),
    []
  );
});

test('released.ts keeps only entries with a version and a date', () => {
  const src = readFileSync(join(DIR, 'released.ts'), 'utf8');
  assert.match(src, /typeof e\.version === 'string'/);
  assert.match(src, /typeof e\.date === 'string'/);
});
