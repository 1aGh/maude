// T2.5 (#163) — "Add comment" is in the object menu's main group, next to Ask AI, not under Advanced ▸. Its id
// (testid `canvas-menu-item-add-comment`), label, shortcut and handler are the v1 row's, untouched.
import { describe, expect, test } from 'bun:test';

import type { ContextTarget, MenuItem } from '../context-menu.tsx';
import { objectMenuSections } from '../editing/object-menu.tsx';

const picked: string[] = [];
const v1: MenuItem[][] = [
  [
    {
      id: 'add-comment',
      label: 'Add comment',
      shortcut: 'C',
      onSelect: () => picked.push('add-comment'),
    },
    { id: 'copy-css', label: 'Copy CSS', onSelect: () => {} },
    { id: 'inspect', label: 'Inspect', onSelect: () => {} },
  ],
];
const sections = () =>
  objectMenuSections(v1, { elementsFor: () => [], run: () => {}, selectMatching: () => {} });

describe('object menu · Add comment', () => {
  test('sits in the first group, right after Ask AI', () => {
    const first = sections()[0] ?? [];
    expect(first.map((i) => i.id)).toEqual(['ask-ai-object', 'add-comment']);
    const row = first[1] as MenuItem;
    expect(row.label).toBe('Add comment');
    expect(row.shortcut).toBe('C');
    row.onSelect({} as ContextTarget);
    expect(picked).toEqual(['add-comment']);
  });
  test('is no longer under Advanced ▸ (the read rows stay there)', () => {
    const adv = sections()
      .flat()
      .find((i) => i.id === 'advanced');
    const ids = ((adv?.submenu as MenuItem[] | undefined) ?? []).map((i) => i.id);
    expect(ids).not.toContain('add-comment');
    expect(ids).toEqual(['copy-css', 'inspect']);
  });
  test('a v1 menu with no Add comment row (a role that cannot comment) draws none', () => {
    const s = objectMenuSections([[{ id: 'copy-css', label: 'Copy CSS', onSelect: () => {} }]], {
      elementsFor: () => [],
      run: () => {},
      selectMatching: () => {},
    });
    expect(s.flat().some((i) => i.id === 'add-comment')).toBe(false);
  });
});
