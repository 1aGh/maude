// P8 e2e r4 (ds-make): picking a design-system DIRECTION with the AI chat open is the system's choice, not the ask's
// scope. Board 13 · ds-make-mix draws the chat open (scope "Direction A") AND the pick bar "Use A · Mix with…" — and
// making a system always runs with the chat open (the brief is sent as the person's message). The board-03 rule
// "a whole-artboard pick with the chat open opens no Inspector" kept the direction bar (an Inspector kind) away, so
// the person could not pick at all.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('a direction pick with the chat open still brings its bar (13 ds-make-mix)', () => {
  test('a ds-dir-* artboard is not an ask-scope pick; any other artboard still is (board 03)', async () => {
    const { isAskScopePick } = await import('../client/v2/shell/inspector-follow.js');
    expect(isAskScopePick({ selector: '[data-dc-screen="ds-dir-a"]' })).toBe(false);
    expect(isAskScopePick({ selector: '[data-dc-screen="ds-dir-c"]' })).toBe(false);
    expect(isAskScopePick({ selector: '[data-dc-screen="post"]' })).toBe(true);
    expect(isAskScopePick({ selector: '[data-dc-screen="ds-dir-"]' })).toBe(true);
    expect(isAskScopePick({ id: 'hero', selector: '[data-cd-id="hero"]' })).toBe(false);
    expect(isAskScopePick(null)).toBe(false);
  });
  test('the bar on a direction ARTBOARD pick is live: only read-only access turns it off, not a missing element id', async () => {
    // The Inspector's generic `editable` needs an element id (an artboard pick has none), so "Use A · Mix with…" came
    // up greyed on exactly the pick board 13 draws. The direction's writes go to /_api/ds/make, not to an element.
    const { directionEditable } = await import('../client/v2/ds/direction-bar.jsx');
    expect(directionEditable({ editable: false, readOnly: false })).toBe(true);
    expect(directionEditable({ editable: false, readOnly: true })).toBe(false);
    expect(directionEditable({ editable: true, readOnly: true })).toBe(false);
    expect(directionEditable({ editable: false })).toBe(false); // an older frame without readOnly: as it said
    expect(directionEditable(undefined)).toBe(true);
    const frame = readFileSync(
      new URL('../client/v2/inspector/frame.jsx', import.meta.url),
      'utf8'
    );
    expect(frame).toMatch(/readOnly: !!readOnly,/);
  });
  test('the shell asks that rule, not the bare artboard test', () => {
    const src = readFileSync(
      new URL('../client/hooks/use-shell-core.jsx', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/askingAi: assistantOpenRef\.current && isAskScopePick\(sel\)/);
  });
});
