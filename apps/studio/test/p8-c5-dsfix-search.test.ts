// P8 C5 dsfix (13 · ds-where-gator): ⌘K "design system" reads as the board draws it — the system, then
// "In the Design system" (colours, type, components by name), then Actions with the place each lives; the
// system's own canvas / boards are not listed a second time under Canvases / Artboards.
import { describe, expect, test } from 'bun:test';

import { dsSearchRows } from '../client/v2/search/search-ds.js';
import { assemble, remoteRows } from '../client/v2/search/search-model.js';

const BOARD = {
  label: 'Alligators brand system',
  tokens: [
    {
      css: '--brand-green',
      section: 'colour',
      group: 'brand',
      label: 'Klubová zelená',
      valueNames: {},
      used: 88,
    },
    {
      css: '--type-display',
      section: 'type',
      group: 'type',
      label: 'Plakát',
      valueNames: {},
      used: null,
    },
  ],
  components: [{ name: 'Button', label: 'Tlačítko', used: 34 }],
};
const SYSTEMS = [
  { name: 'alligators', label: 'Alligators brand system', converted: true, board: BOARD },
  {
    name: 'combine',
    label: 'Combine 2026',
    converted: true,
    board: { ...BOARD, label: 'Combine 2026', tokens: [], components: [] },
  },
];
const rowsOf = (v: ReturnType<typeof assemble>, g: string) =>
  (v.groups.find((x: { id: string }) => x.id === g)?.rows ?? []) as {
    name: string;
    where?: string;
    meta?: string;
  }[];

describe('⌘K "design system" — the three groups of the board', () => {
  const calls: [string, unknown][] = [];
  const local = dsSearchRows({
    systems: SYSTEMS,
    run: () => {},
    runAction: (id: string, p: unknown) => calls.push([id, p]),
  });
  const v = assemble({ query: 'design system', local });

  test('"In the Design system" lists the colours, type and components by their names', () => {
    expect(rowsOf(v, 'in-design-system').map((r) => r.name)).toEqual([
      'Klubová zelená',
      'Plakát',
      'Tlačítko',
    ]);
  });

  test('Actions carries Check the system and Switch…, each with where it lives', () => {
    const acts = rowsOf(v, 'actions');
    expect(acts.map((r) => [r.name, r.where])).toContainEqual([
      'Check the system',
      'Design system › Advanced',
    ]);
    expect(acts.map((r) => [r.name, r.where])).toContainEqual([
      'Switch canvases to another system…',
      'Design system row',
    ]);
  });

  test('an action row runs the registry action for the first system', () => {
    const row = local.find((r: { name: string }) => r.name === 'Check the system');
    row.run();
    expect(calls).toContainEqual(['ds.check-system', { ds: 'alligators' }]);
  });

  test('one system has nothing to switch to — no Switch row', () => {
    const one = dsSearchRows({ systems: SYSTEMS.slice(0, 1), run: () => {}, runAction: () => {} });
    expect(one.some((r: { name: string }) => r.name === 'Switch canvases to another system…')).toBe(
      false
    );
  });
});

describe('⌘K — a system’s own board is the Design system row, not a canvas', () => {
  const result = {
    rows: [
      {
        key: 'system/maude-v2/design-system.tsx',
        name: 'design-system',
        group: 'canvases',
        meta: 'system/maude-v2',
      },
      {
        key: 'system/maude-v2/design-system.tsx#colour',
        name: 'Colour',
        group: 'artboards',
        kind: 'web',
      },
      { key: 'ui/Homepage.tsx', name: 'Homepage', group: 'canvases', meta: '' },
    ],
  };
  test('the board and its artboards are dropped; a real canvas stays', () => {
    const rows = remoteRows(result, { query: 'design system' });
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['Homepage']);
  });
});
