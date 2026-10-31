// P6 T2 (inspector-ux-rules IR-8) — the colour picker's Recent row: the last 8 colours of this project, newest first, per
// Mac in prefs.json `recentColours` (the V2-4.10 fold-store pattern — no new runtime path).
import { describe, expect, test } from 'bun:test';
import {
  createRecentStore,
  projectKeyOf,
  pushRecent,
  RECENT_MAX,
} from '../client/v2/inspector/sections/recent-colours.js';
import { validateUiPrefsPatch } from '../ui-prefs.ts';

describe('pushRecent', () => {
  test('newest first, deduplicated, at most 8', () => {
    let list: string[] = [];
    for (let i = 0; i < 10; i += 1) list = pushRecent(list, `var(--c-${i})`);
    expect(list.length).toBe(RECENT_MAX);
    expect(list[0]).toBe('var(--c-9)');
    list = pushRecent(list, 'VAR(--c-5)');
    expect(list[0]).toBe('VAR(--c-5)');
    expect(list.filter((c) => c.toLowerCase() === 'var(--c-5)').length).toBe(1);
  });

  test('an inherited keyword or declaration syntax is never kept', () => {
    for (const bad of ['currentColor', 'inherit', 'transparent', 'red; top: 0', '<b>'])
      expect(pushRecent([], bad)).toEqual([]);
  });
});

describe('the store', () => {
  test('a push persists only this project’s list; hydrate merges what prefs hold', async () => {
    const writes: unknown[] = [];
    const s = createRecentStore({ persist: (p: unknown) => writes.push(p) });
    s.push('A', '#1e6bff');
    expect(writes).toEqual([{ recentColours: { A: ['#1e6bff'] } }]);
    s.hydrate({ recentColours: { A: ['var(--accent)'], B: ['#000000'] } });
    expect(s.get('A')).toEqual(['#1e6bff', 'var(--accent)']); // the colour used in this page stays first
    expect(s.get('B')).toEqual(['#000000']);
    expect(s.get('C')).toEqual([]);
  });

  test('projectKeyOf makes a safe prefs id', () => {
    expect(projectKeyOf({ cfg: { name: 'My project (2)' } })).toBe('My-project--2-');
    expect(projectKeyOf(undefined)).toBe('project');
  });
});

describe('ui-prefs accepts recentColours and refuses anything else under it', () => {
  test('a valid list per project', () => {
    const r = validateUiPrefsPatch({
      recentColours: { 'My-project': ['var(--accent)', '#1e6bff', 'oklch(0.6 0.2 255 / 0.5)'] },
    });
    expect(r.ok).toBe(true);
  });
  test('more than 8, a non-string, markup or a prototype key is refused', () => {
    expect(validateUiPrefsPatch({ recentColours: { p: Array(9).fill('#000000') } }).ok).toBe(false);
    expect(validateUiPrefsPatch({ recentColours: { p: [1] } }).ok).toBe(false);
    expect(validateUiPrefsPatch({ recentColours: { p: ['red; x: url(a)'] } }).ok).toBe(false);
    expect(validateUiPrefsPatch({ recentColours: { p: ['<script>'] } }).ok).toBe(false);
    expect(
      validateUiPrefsPatch({ recentColours: JSON.parse('{"__proto__": ["#000000"]}') }).ok
    ).toBe(false);
    expect(validateUiPrefsPatch({ recentColours: ['#000000'] }).ok).toBe(false);
  });
});
