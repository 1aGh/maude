// Ad blockers hide our admin if a class looks like an ad.
//
// Live finding 2026-11-25: in Zen (Firefox + uBlock Origin, EasyList) the team
// server admin and every Maude Cloud page rendered only the nav. EasyList's
// generic cosmetic rules include `##.ad-main`, `##.ad-head`, `##.ad-card`,
// `##.ad-link`, `##.ad-row`, `##.ad-table`, `##.ad-note`, … and the pages used
// `ad-` (admin) as their class prefix. The prefix is now `ma-`; this keeps the
// `ad-` prefix (and the bare words EasyList hides) out of both admins.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FILES = [
  ...['index.html', 'app.js', 'style.css'].map((f) => join(REPO, 'apps/hub/src/admin', f)),
  ...['join-page.mjs', 'studio-door.mjs', 'browser-auth.mjs'].map((f) =>
    join(REPO, 'apps/hub/src', f)
  ),
  ...readdirSync(join(REPO, 'apps/cloud'))
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .map((f) => join(REPO, 'apps/cloud', f)),
];

// A sample of EasyList's generic hide rules that once matched our classes.
const HIDDEN = ['ad-main', 'ad-head', 'ad-card', 'ad-link', 'ad-row', 'ad-table', 'ad-note'];

test('no admin page uses an ad-looking class', () => {
  const found = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?<![A-Za-z0-9_-])ad-(?!hoc\b)[a-z][a-z0-9-]*/g)) {
      found.push(`${file.slice(REPO.length + 1)}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    found.slice(0, 10),
    [],
    `ad-looking classes:\n  ${found.slice(0, 10).join('\n  ')}`
  );
  for (const word of HIDDEN) {
    for (const file of FILES) {
      assert.ok(
        !new RegExp(`\\.${word}\\b|class="${word}\\b`).test(readFileSync(file, 'utf8')),
        `${word} in ${file}`
      );
    }
  }
});
