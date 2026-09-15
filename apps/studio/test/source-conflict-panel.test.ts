// Plan T28 — the conflict panel's line diff (pure).
import { describe, expect, test } from 'bun:test';

import { lineDiff } from '../client/panels/SourceConflictPanel.jsx';

describe('lineDiff', () => {
  test('marks what only mine has, what only the project has, and what both share', () => {
    const rows = lineDiff('a\nb mine\nc', 'a\nb theirs\nc');
    expect(rows).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'mine', text: 'b mine' },
      { kind: 'theirs', text: 'b theirs' },
      { kind: 'same', text: 'c' },
    ]);
  });
  test('identical inputs are all shared; empty sides still diff', () => {
    expect(lineDiff('x\ny', 'x\ny').every((r) => r.kind === 'same')).toBe(true);
    expect(lineDiff('', 'z')).toEqual([
      { kind: 'mine', text: '' },
      { kind: 'theirs', text: 'z' },
    ]);
  });
});
