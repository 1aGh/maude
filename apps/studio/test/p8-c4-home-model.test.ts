// P8 C4 (11 pn-home): the Projects list groups by account, the account with the most recently used project first
// (the board draws Work above Personal — Work holds the project open in a tab).
import { describe, expect, test } from 'bun:test';
import { buildHomeModel, capProjectGroups } from '../client/home/home-model.js';

const shell = {
  projects: [
    { pid: 'p-personal', root: '/x/a', name: 'Studio site', profile: 'default', place: 'closed' },
    { pid: 'p-work', root: '/x/b', name: 'Alligators brand', profile: 'work', place: 'tab' },
    { pid: 'p-work2', root: '/x/c', name: 'Sponzoři 2027', profile: 'work', place: 'closed' },
  ],
  profiles: [
    { id: 'default', label: 'Personal' },
    { id: 'work', label: 'Work' },
  ],
  recent: ['p-work', 'p-personal', 'p-work2'],
};

describe('the Projects groups', () => {
  test('the account whose project was used most recently comes first', () => {
    const m = buildHomeModel({ shell, index: null, clouds: null });
    expect(m.groups.map((g: { profile: { id: string } }) => g.profile.id)).toEqual([
      'work',
      'default',
    ]);
  });

  test('with no recency the shell’s own order stays', () => {
    const m = buildHomeModel({ shell: { ...shell, recent: [] }, index: null, clouds: null });
    expect(m.groups.map((g: { profile: { id: string } }) => g.profile.id)).toEqual([
      'default',
      'work',
    ]);
  });
});

describe('the list foot: "N more"', () => {
  const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
  const groups = [
    { profile: { id: 'work' }, rows: rowsOf(4) },
    { profile: { id: 'default' }, rows: rowsOf(5) },
  ];

  test('keeps the first rows across groups and counts what is left', () => {
    const r = capProjectGroups(groups, 6);
    expect(r.groups.map((g: { rows: unknown[] }) => g.rows.length)).toEqual([4, 2]);
    expect(r.more).toBe(3);
  });

  test('a list that fits has nothing hidden; a group with no row left is dropped', () => {
    expect(capProjectGroups(groups, 20).more).toBe(0);
    const r = capProjectGroups(groups, 4);
    expect(r.groups.map((g: { profile: { id: string } }) => g.profile.id)).toEqual(['work']);
    expect(r.more).toBe(5);
  });
});
