// V2-3.7 contract §7.5 (V2-3.9 T7): desktop e2e scenarios never close a tab with WebDriver's
// `closeWindow()` (DELETE /window). Every tab is a child webview of the one `shell` window, and
// that call closes the webview behind the shell's back — no close guard, no grace, no reap, no
// strip update — so a scenario would pass against a state the app can never be in. Close through
// `helpers/windows.ts` `closeTab` (→ `e2e_close_window` → `tabs::close_tab`).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const E2E = join(ROOT, 'apps/desktop/e2e');

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(m?[jt]s|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every `closeWindow(` call in `text`, by line. */
export function closeWindowCalls(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((l) => /\bcloseWindow\s*\(/.test(l.text));
}

test('the scan finds a closeWindow( call', () => {
  assert.equal(closeWindowCalls('await browser.closeWindow();').length, 1);
  assert.equal(closeWindowCalls('await browser.closeWindow ( )').length, 1);
  assert.equal(closeWindowCalls('await closeTab(label, next);').length, 0);
});

test('no desktop e2e scenario or helper calls closeWindow(', () => {
  const files = sources(E2E);
  assert.ok(files.length > 10, `only ${files.length} e2e sources found under ${E2E}`);
  const hits = files.flatMap((f) =>
    closeWindowCalls(readFileSync(f, 'utf8')).map(
      (h) => `${relative(ROOT, f)}:${h.line}: ${h.text.trim()}`
    )
  );
  assert.deepEqual(hits, [], 'close tabs through helpers/windows.ts closeTab, never closeWindow()');
});
