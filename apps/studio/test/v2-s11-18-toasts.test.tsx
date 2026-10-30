// S11.18 (design W5) — toast copy and the toast's own look: say what happens, one short line, one action in the
// accent text colour, a soft shadow from the elevation token. Open all Advanced sections answers with a toast whose
// one action is Close all (06 ad-open-all).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOLD_PANELS } from '../client/v2/fold/fold-store.js';
import { foldStore } from '../client/v2/fold/use-fold.js';
import { toastLine } from '../client/whats-new.jsx';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('toast copy', () => {
  test('the What’s new toast is the first sentence, 90 characters at most', () => {
    expect(toastLine('Share a canvas in one click. Invite people by email. Pick a role.')).toBe(
      'Share a canvas in one click.'
    );
    const long = `${'A very long sentence about many things '.repeat(5)}ends here.`;
    const out = toastLine(long);
    expect(out.length).toBeLessThanOrEqual(90);
    expect(out.endsWith('…')).toBe(true);
    expect(toastLine('')).toBe('');
    expect(toastLine(undefined)).toBe('');
  });

  test('the Edit hint says what happens, not what it resembles', () => {
    const src = read('client/shell/util.js');
    expect(src).not.toMatch(/like Figma/);
    expect(src).toContain('Click selects. Switch to Preview (top right) to use the design live.');
  });

  test('the What’s new toast title uses a curly apostrophe', () => {
    expect(read('client/whats-new.jsx')).toContain('`What’s new${');
  });
});

describe('the toast’s look', () => {
  const css = read('notifications.tsx');

  test('its action is a button in the accent text colour, not a black underlined link', () => {
    const rule = /\.maude-notice-action \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('var(--accent-text');
    expect(rule).not.toContain('underline');
  });

  test('its shadow comes from the elevation token', () => {
    const rule = /\.maude-notice \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('box-shadow: var(--shadow-md');
  });
});

describe('Open all Advanced sections', () => {
  test('answers with one toast whose one action is Close all, and Close all folds them again', async () => {
    const { createMenuHandlers } = await import('../client/v2/shell/menu-runner.js');
    const calls: { m: string; ok?: boolean; action?: { label: string; onClick: () => void } }[] =
      [];
    const h = createMenuHandlers({
      toast: (m: string, ok?: boolean, action?: { label: string; onClick: () => void }) =>
        calls.push({ m, ok, action }),
    });
    foldStore.reset();
    h['view.advanced-open-all']();
    expect(FOLD_PANELS.every((id: string) => foldStore.get(id))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].m).toBe('All Advanced sections are open.');
    expect(calls[0].ok).toBe(true);
    expect(calls[0].action?.label).toBe('Close all');
    calls[0].action?.onClick();
    expect(FOLD_PANELS.some((id: string) => foldStore.get(id))).toBe(false);
  });
});
