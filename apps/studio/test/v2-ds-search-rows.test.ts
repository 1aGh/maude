// S10.13 — the Design system in Search ⌘K (13 · ds-where-gator): "design system" opens it; every colour, type
// style and component is found by its own name, Czech names too, and runs `ds.go-to` on that thing.
import { describe, expect, test } from 'bun:test';

import { dsSearchRows } from '../client/v2/search/search-ds.js';
import { assemble, GROUPS } from '../client/v2/search/search-model.js';

const BOARD = {
  format: 'maude.ds-board',
  label: 'Alligators brand system',
  tokens: [
    {
      css: '--brand-green',
      section: 'colour',
      group: 'brand',
      label: 'Klubová zelená',
      valueNames: { light: 'Gator green', dark: 'Světlá zelená' },
      used: 88,
    },
    {
      css: '--type-display',
      section: 'type',
      group: 'type',
      label: 'Plakát — STAŇ SE GATOREM',
      valueNames: {},
      used: null,
    },
    { css: '--space-2', section: 'space', group: 'space', label: '', valueNames: {}, used: 1 },
  ],
  components: [{ name: 'Button', label: 'Tlačítko — ZAPIŠ SE', used: 34 }],
};
const SYSTEMS = [
  { name: 'alligators', label: 'Alligators brand system', converted: true, board: BOARD },
  { name: 'old', label: 'Old system', converted: false },
];

function view(query: string, run: (p: Record<string, unknown>) => void = () => {}) {
  const local = dsSearchRows({ systems: SYSTEMS, run });
  return { view: assemble({ query, local }), local };
}
const names = (v: ReturnType<typeof assemble>, g: string) =>
  (v.groups.find((x: { id: string }) => x.id === g)?.rows ?? []).map(
    (r: { name: string }) => r.name
  );

describe('⌘K — the Design system', () => {
  test('the two groups lead, with the contract’s titles', () => {
    expect(GROUPS.slice(0, 2).map((g: { id: string; title: string }) => [g.id, g.title])).toEqual([
      ['design-system', 'Design system'],
      ['in-design-system', 'In the Design system'],
    ]);
  });

  test('"design system" finds the system itself, first', () => {
    const { view: v } = view('design system');
    expect(v.groups[0].id).toBe('design-system');
    expect(names(v, 'design-system')).toEqual(['Alligators brand system', 'Old system']);
  });

  test('a token is found by its Czech label — with or without the accents', () => {
    expect(names(view('klubová zelená').view, 'in-design-system')).toEqual(['Klubová zelená']);
    expect(names(view('klubova zelena').view, 'in-design-system')).toEqual(['Klubová zelená']);
  });

  test('…by a value’s own name, in either mode', () => {
    expect(names(view('gator green').view, 'in-design-system')).toEqual(['Klubová zelená']);
    expect(names(view('světlá').view, 'in-design-system')).toEqual(['Klubová zelená']);
  });

  test('a component is found by its label and by its name', () => {
    expect(names(view('zapiš').view, 'in-design-system')).toEqual(['Tlačítko — ZAPIŠ SE']);
    expect(names(view('button').view, 'in-design-system')).toContain('Tlačítko — ZAPIŠ SE');
  });

  test('the line under a hit says what it is and how much it is used', () => {
    // one system: no system suffix
    const only = assemble({
      query: 'klubova',
      local: dsSearchRows({ systems: [SYSTEMS[0]], run: () => {} }),
    });
    expect(only.groups.find((g: { id: string }) => g.id === 'in-design-system').rows[0].meta).toBe(
      'Colour · brand · used in 88 canvases'
    );
    const v = view('klubova').view;
    const row = v.groups.find((g: { id: string }) => g.id === 'in-design-system').rows[0];
    // several systems: the hit says which one it is in
    expect(row.meta).toBe('Colour · brand · used in 88 canvases · Alligators brand system');
    const comp = view('zapis').view.groups.find((g: { id: string }) => g.id === 'in-design-system')
      .rows[0];
    expect(comp.meta).toBe('Component · used in 34 canvases · Alligators brand system');
  });

  test('↵ runs ds.go-to on that thing — the system, the section, the token or the component', () => {
    const ran: Array<Record<string, unknown>> = [];
    const { view: v } = view('klubova', (p) => ran.push(p));
    v.groups.find((g: { id: string }) => g.id === 'in-design-system').rows[0].run();
    const c = view('zapis', (p) => ran.push(p)).view;
    c.groups.find((g: { id: string }) => g.id === 'in-design-system').rows[0].run();
    const s = view('design system', (p) => ran.push(p)).view;
    s.groups[0].rows[0].run();
    expect(ran).toEqual([
      { ds: 'alligators', section: 'colour', token: '--brand-green' },
      { ds: 'alligators', component: 'Button' },
      { ds: 'alligators' },
    ]);
  });

  test('a system not on a canvas yet has its one row and nothing inside it; a token with no label is skipped', () => {
    const local = dsSearchRows({ systems: SYSTEMS, run: () => {} });
    expect(local.filter((r: { id: string }) => r.id.startsWith('ds:')).length).toBe(2);
    expect(local.some((r: { id: string }) => r.id.includes(':old:'))).toBe(false);
    expect(local.some((r: { id: string }) => r.id.endsWith('--space-2'))).toBe(false);
    expect(local.find((r: { id: string }) => r.id === 'ds:old')?.meta).toBe(
      'Design system · not on a canvas yet'
    );
  });

  test('several systems: a hit names the system it is in', () => {
    const second = {
      name: 'camp',
      label: 'Combine 2026',
      converted: true,
      board: { ...BOARD, label: 'Combine 2026' },
    };
    const local = dsSearchRows({ systems: [SYSTEMS[0], second], run: () => {} });
    const tokenRows = local.filter((r: { id: string }) => r.id.includes('--brand-green'));
    expect(tokenRows.map((r: { meta: string }) => r.meta.split(' · ').pop())).toEqual([
      'Alligators brand system',
      'Combine 2026',
    ]);
  });
});
