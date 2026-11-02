// S11.18 (design W5) — toast copy and the toast's own look: say what happens, one short line, one action in the
// accent text colour, a soft shadow from the elevation token. Open all Advanced sections answers with a toast whose
// one action is Close all (06 ad-open-all).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOLD_PANELS } from '../client/v2/fold/fold-store.js';
import { foldStore } from '../client/v2/fold/use-fold.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

// r2-p3 (Michal TD5): What's new is never a canvas toast (Home's line and Help › What's new say it) and the
// first-run "You're in Edit" hint is dropped — test/r2-p3-modes.test.tsx pins both; the copy rules below stay.
describe('toast copy', () => {
  test('no canvas toast for What’s new and no mode hint any more', () => {
    expect(read('client/shell/util.js')).not.toContain('Switch to Preview (top right)');
    expect(read('client/whats-new.jsx')).not.toContain('toastLine');
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
