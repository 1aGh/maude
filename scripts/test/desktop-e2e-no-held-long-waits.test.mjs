// #171 (T8.2): a long wait in a desktop e2e spec re-queries; it never polls one held element handle.
//
// `const el = await $(sel); await el.waitForDisplayed({ timeout: 120_000 })` waits on ONE node for two
// minutes. A node the app remounts after the find is a dead handle, and the macOS driver used to report that as
// WebKit's opaque "A JavaScript exception occurred" so webdriverio never refetched (the V2-8.3 tabs red,
// scripts/test/desktop-e2e-tabs-requery.test.mjs). The driver maps it now, but the four specs that waited longest
// on a held handle go through `helpers/poll.ts` `waitShown`, which asks the page again every round, and this
// keeps them there. Short waits (a click's own settle) stay as they are.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SPECS = ['git-branch-switcher', 'file-tree-move', 'offline-conflict', 'team-project'];
/** A wait this long outlives a remount. */
const LONG_MS = 60_000;

/** Every `.waitForDisplayed/Exist/Clickable({ …timeout: N… })` of LONG_MS or more: `[line, ms]`. */
export function longHandleWaits(text) {
  const found = [];
  const re = /\.waitFor(?:Displayed|Exist|Clickable|Enabled)\(\s*\{([^}]*)\}/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const ms = /timeout:\s*([\d_]+)/.exec(m[1]);
    const n = ms ? Number(ms[1].replaceAll('_', '')) : 0;
    if (n >= LONG_MS) found.push([text.slice(0, m.index).split('\n').length, n]);
  }
  return found;
}

test('longHandleWaits finds a long handle wait, over lines, and ignores short ones', () => {
  assert.deepEqual(longHandleWaits('await el.waitForDisplayed({ timeout: 120_000 });'), [
    [1, 120000],
  ]);
  assert.deepEqual(
    longHandleWaits('x\nawait row.waitForExist({\n  reverse: true,\n  timeout: 60_000,\n});'),
    [[2, 60000]]
  );
  assert.deepEqual(longHandleWaits('await el.waitForDisplayed({ timeout: 15_000 });'), []);
  assert.deepEqual(longHandleWaits('await waitShown(sel, 120_000);'), []);
});

for (const name of SPECS) {
  test(`${name}: no wait of ${LONG_MS / 1000} s or more on a held handle`, () => {
    const text = readFileSync(join(ROOT, `apps/desktop/e2e/scenarios/${name}.e2e.ts`), 'utf8');
    assert.deepEqual(
      longHandleWaits(text),
      [],
      'wait through helpers/poll.ts waitShown(selector, ms), which re-queries every round'
    );
  });
}
