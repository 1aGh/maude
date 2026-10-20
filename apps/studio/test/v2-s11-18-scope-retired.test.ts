// S11.18 — the v1 edit-scope badge ("Shared · Card · edits N places", Detach) is retired from the Inspector's
// header: Inspector › Advanced › Used in says the same and keeps Detach (S11.8). Nothing is deleted: the hook is
// marked retired and the nothing-deleted row points at the row that took over.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('the edit-scope badge is retired into Inspector › Advanced › Used in', () => {
  test('the inspector header no longer draws .st-scope, and its CSS is gone', () => {
    expect(read('client/inspector/inspector-panel.jsx')).not.toMatch(/st-scope/);
    expect(read('client/styles/3-shell-maude.css')).not.toMatch(/\.st-scope/);
  });

  test('the same words and Detach stay in the Advanced row', () => {
    const src = read('client/v2/inspector/advanced-rows-default.jsx');
    expect(src).toContain('adv-used-in');
    expect(src).toContain('adv-detach');
    expect(src).toMatch(/Shared · \$\{n\}/);
  });

  test('the hook is retired in testids.json and the nothing-deleted row points at the new home', () => {
    const hooks = JSON.parse(read('client/testids.json')) as { hook: string; v2: string }[];
    expect(hooks.find((h) => h.hook === '.st-scope')?.v2).toBe('retired');
    expect(hooks.find((h) => h.hook === 'adv-used-in')?.v2).not.toBe('retired');
    const map = JSON.parse(read('client/v2/nothing-deleted.json')) as {
      rows: { id: string; v2: { testid: string } }[];
    };
    const row = map.rows.find((r) => r.id === 'A-edit-scope-local-shared-detach');
    expect(row?.v2.testid).toBe('adv-used-in');
  });
});
