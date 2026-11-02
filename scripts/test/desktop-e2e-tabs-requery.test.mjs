// V2-8.3 red (2026-10-28, lane e2e:tabs): `waitBranch` polls `triggerText()` inside a 120 s `waitUntil`.
// `triggerText` used to find the project pill once and then `waitForDisplayed({ timeout: 120_000 })` on
// that handle. The reopened tab remounted the pill right after the find, and the vendored macOS
// WebDriver (tauri-plugin-wdio-webdriver 1.2.0) reports a stale element as the opaque WebKit text
// "A JavaScript exception occurred" — not "stale element reference" — so webdriverio never refetched.
// The dead handle was polled for the whole budget and the step failed while the pill was on screen.
// A poll predicate must re-query every round and never wait on a handle it holds.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SPECS = ['project-tabs', 'git-switch-repos'].map((n) =>
  join(ROOT, `apps/desktop/e2e/scenarios/${n}.e2e.ts`)
);

/** The body of `async function <name>(…) { … }` in `text` (brace-matched), or null. */
export function functionBody(text, name) {
  const at = text.search(new RegExp(`async function ${name}\\s*\\(`));
  if (at < 0) return null;
  const open = text.indexOf('{', text.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

test('functionBody finds a brace-matched body', () => {
  const src = 'async function f(a) {\n  if (a) { return 1; }\n  return 2;\n}\nconst x = 1;';
  assert.equal(functionBody(src, 'f'), '\n  if (a) { return 1; }\n  return 2;\n');
  assert.equal(functionBody(src, 'g'), null);
});

for (const spec of SPECS) {
  const name = spec.split('/').pop();
  test(`${name}: the branch poll re-queries the pill and never waits on a held handle`, () => {
    const body = functionBody(readFileSync(spec, 'utf8'), 'triggerText');
    assert.ok(body, `triggerText() not found in ${name}`);
    assert.doesNotMatch(
      body,
      /\bwaitFor(Displayed|Exist|Clickable)\s*\(/,
      'triggerText runs inside a waitUntil: a long wait on one handle outlives a remount'
    );
  });
}
