// S5.V3 G1 — a "needs you" toast's Open must switch to the canvas that needs you. app.jsx's
// OPEN_AI_EVENT handler called `tabs.openTab(canvas)`, where `tabs` is the tab list (an array),
// so Open threw `openTab is not a function` and stayed on the other canvas. Pin the handler to the
// shell core's `openTab` (app.jsx is plain JS, so tsc cannot catch this).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, '..', 'client', 'app.jsx'), 'utf8');
const start = src.indexOf('const onOpenAi = (e) => {');
const body = src.slice(start, src.indexOf('};', start));

describe('Needs-you Open switches canvas', () => {
  test('the open-ai handler opens the canvas through openTab, not the tabs array', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toContain('tabs.openTab(');
    expect(body).toMatch(/\bopenTab\(canvas\)/);
  });
  test('openTab is in scope there: the enclosing component destructures it from the shell store', () => {
    // the first fix called a bare openTab that ShellProjectPill never took from useShellStore() —
    // a ReferenceError the release boot gate (check-client-boots-source) caught
    const fnStart = src.lastIndexOf('\nfunction ', start);
    const head = src.slice(fnStart, start);
    expect(head).toMatch(/tabs: \{[^}]*\bopenTab,/);
  });
});
