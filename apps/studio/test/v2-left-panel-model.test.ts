// V2-4.4a — the left panel: Canvases · Layers · Assets. Model-level pins (no DOM): the tab strip's
// words and order, the pinned Design system rows, the Trash row's words, the registry ids this task
// registered, and the D4 / D5 re-homing table checked against the ledger and the source.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { DOCK_PANELS, PANEL_SIDES_DEFAULTS } from '../client/shell/dock.jsx';
import {
  CAPABILITY_HOMES,
  dsPinnedModel,
  dsPinnedRows,
  leftTabs,
  trashRowCount,
  trashSummary,
} from '../client/v2/left-panel/left-panel-model.js';
import { visibleTrash } from '../client/v2/left-panel/use-trash.js';
import { PENDING_MENU_IDS } from '../client/v2/shell/project-menu-model.js';

const STUDIO = join(import.meta.dir, '..');
const REPO = join(STUDIO, '..', '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

describe('the tab strip', () => {
  test('reads Canvases · Layers · Assets, in that order', () => {
    const left = leftTabs({ layersMode: 'separate' });
    expect(left.map((t) => t.label)).toEqual(['Canvases', 'Layers', 'Assets']);
    expect(left.map((t) => t.id)).toEqual(['tree', 'layers', 'assets']);
  });

  test('"Files" is not a word the strip uses; the ids the tests and the e2e hook on stay', () => {
    expect(DOCK_PANELS.find((p) => p.id === 'tree')?.label).toBe('Canvases');
    expect(DOCK_PANELS.map((p) => p.label)).not.toContain('Files');
    expect(PANEL_SIDES_DEFAULTS.assets).toBe('left');
    expect(DOCK_PANELS.some((p) => p.id === 'tree')).toBe(true); // dock-tab-tree
  });

  test('Layers inside the Inspector (View › Advanced › Layers as a panel off) leaves Canvases · Assets', () => {
    expect(leftTabs({ layersMode: 'in-inspector' }).map((t) => t.label)).toEqual([
      'Canvases',
      'Assets',
    ]);
  });
});

describe('the pinned Design system row', () => {
  const ds = (names: string[]) => [
    {
      label: 'Design system',
      kind: 'canvas',
      dsFolders: names.map((n) => ({ name: n, folder: n })),
    },
    { label: 'UI kit', kind: 'canvas' },
  ];
  test('one system is just "Design system"; several are each named after their system', () => {
    expect(dsPinnedRows(ds(['alligators']))).toEqual([
      { dsName: 'alligators', label: 'Design system' },
    ]);
    expect(dsPinnedRows(ds(['club', 'campaign'])).map((r) => r.label)).toEqual([
      'club',
      'campaign',
    ]);
  });
  test('a project with no system pins nothing', () => {
    expect(dsPinnedRows([{ label: 'UI kit', kind: 'canvas' }])).toEqual([]);
    expect(dsPinnedRows(undefined)).toEqual([]);
  });
});

describe('the Trash row', () => {
  test('counts what is there and says nothing for an empty trash', () => {
    expect(trashRowCount(null)).toBe('');
    expect(trashRowCount({ total: 0 })).toBe('');
    expect(trashRowCount({ total: 12 })).toBe('12');
  });
  test('the bookkeeping manifest a moved canvas leaves is not a thing in the list or the count', () => {
    const entries = [
      { trashRel: '_trash/a__x/_trash-manifest.json' },
      { trashRel: '_trash/a__x/x.tsx' },
      { trashRel: '_trash/b/_trash-manifest.json' },
    ];
    const v = visibleTrash({ entries, total: 3, bytes: 1 });
    expect(v.entries.map((e) => e.trashRel)).toEqual(['_trash/a__x/x.tsx']);
    expect(v.total).toBe(1);
  });
  test('the summary never says "deleted"', () => {
    expect(trashSummary({ total: 1 })).toBe('1 thing kept until you clear it out.');
    expect(trashSummary({ total: 3 })).toBe('3 things kept until you clear it out.');
    expect(trashSummary({ total: 0 })).not.toMatch(/delet/i);
  });
});

describe('the registry half', () => {
  test('view.assets, view.layers-panel and the Trash action are registered, with the contract words', () => {
    expect(ACTIONS_BY_ID.get('view.assets')?.label).toBe('Assets');
    expect(ACTIONS_BY_ID.get('view.layers-panel')?.label).toBe('Layers as a panel');
    expect(ACTIONS_BY_ID.get('view.trash')?.label).toBe('Trash');
  });
  test('…and are off the pending list', () => {
    expect(PENDING_MENU_IDS['view.assets']).toBeUndefined();
    expect(PENDING_MENU_IDS['view.layers-panel']).toBeUndefined();
  });
  test('Assets has no key (CONTRACT §7), Trash has no key (CONTRACT §1)', () => {
    expect(ACTIONS_BY_ID.get('view.assets')?.keys ?? []).toEqual([]);
    expect(ACTIONS_BY_ID.get('view.trash')?.keys ?? []).toEqual([]);
  });
});

describe('G0-D/D4 and G0-D/D5 stay reachable', () => {
  const ledger = JSON.parse(readFileSync(join(REPO, '.ai/scenarios/maude-v2/ledger.json'), 'utf8'));
  const rows = (ledger.rows as { id: string }[]).filter((r) => /^G0-D\/D[45]$/.test(r.id));

  test('the ledger still has both rows', () => {
    expect(rows.map((r) => r.id).sort()).toEqual(['G0-D/D4', 'G0-D/D5']);
  });

  test('every capability has a home, and the control that homes it exists', () => {
    expect(CAPABILITY_HOMES.length).toBeGreaterThanOrEqual(12);
    const testids = new Set(
      (JSON.parse(read('client/testids.json')) as { hook: string }[]).map((e) => e.hook)
    );
    for (const c of CAPABILITY_HOMES) {
      expect(['G0-D/D4', 'G0-D/D5']).toContain(c.row);
      expect(c.home, c.feature).toBeTruthy();
      expect(existsSync(join(STUDIO, c.file)), `${c.feature}: ${c.file}`).toBe(true);
      const src = read(c.file);
      if (c.testid) {
        expect(testids.has(c.testid), `${c.feature}: testids.json has ${c.testid}`).toBe(true);
        // a pattern hook (`tree-folder-<slug>`) is produced as a template literal
        const stem = c.testid.replace(/<.*$/, '');
        expect(src.includes(stem), `${c.feature}: ${c.file} produces ${c.testid}`).toBe(true);
      }
      if (c.actionId) {
        expect(ACTIONS_BY_ID.has(c.actionId), `${c.feature}: ${c.actionId} registered`).toBe(true);
      }
      if (c.label)
        expect(src.includes(c.label), `${c.feature}: "${c.label}" in ${c.file}`).toBe(true);
    }
  });

  test('the five D4 keys and the eight D5 features are all listed', () => {
    const feats = CAPABILITY_HOMES.map((c) => c.feature);
    for (const f of [
      'Refresh tree',
      'Toggle the tree',
      'Hidden files',
      'Design system view',
      'New canvas',
      'New folder',
      'Inline composer',
      'Folder menu',
      'Drag and drop',
      'Keyboard tree navigation',
      'Open-comment count',
      'Figma and experimental badges',
      'Non-canvas file preview',
    ])
      expect(feats, f).toContain(f);
  });
});

// S10.13 — the pinned rows of 13 · ds-where-studio, ds-where-gator, ds-multi-panel: two lines, grouped when
// more than one system is in use, an amber dot, the empty row.
describe('the pinned system rows (S10.13)', () => {
  const GROUPS = [
    {
      label: 'Design system',
      kind: 'canvas',
      fullPath: '.design/system',
      dsFolders: [
        { name: 'alligators', folder: 'alligators' },
        { name: 'combine-2026', folder: 'combine-2026' },
        { name: 'alligators-2023', folder: 'alligators-2023' },
      ],
    },
    { label: 'UI', kind: 'canvas', fullPath: '.design/ui' },
  ];
  const SYSTEMS = [
    { name: 'alligators', path: 'system/alligators', label: 'Alligators brand system' },
    { name: 'combine-2026', path: 'system/combine-2026', label: 'Combine 2026' },
    { name: 'alligators-2023', path: 'system/alligators-2023', label: 'Alligators 2023' },
  ];
  const canvases = (n: number, ds: string, dir: string) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`.design/ui/${dir}/C${i}.tsx`, ds] as const)
    );
  const MAP = {
    ...canvases(87, 'alligators', 'club'),
    ...canvases(6, 'combine-2026', '2026/combine'),
    // a system's own folder is not a canvas that uses it
    '.design/system/alligators/design-system.tsx': 'alligators',
  };
  const info = (over: Record<string, unknown> = {}) => ({
    designSystems: SYSTEMS,
    canvasDesignSystems: MAP,
    defaultDs: 'alligators',
    designRel: '.design',
    state: {},
    canMake: true,
    ...over,
  });
  type Row = {
    label: string;
    sub: string;
    isDefault: boolean;
    amber: unknown;
    draft: boolean;
    count: number;
  };
  const rowsOf = (over: Record<string, unknown> = {}) =>
    dsPinnedModel(GROUPS, info(over)).rows as Row[];

  test('without the shell config the rows are exactly what V2-4.4a pinned', () => {
    const one = [{ ...GROUPS[0], dsFolders: [GROUPS[0].dsFolders[0]] }];
    expect(dsPinnedRows(one)).toEqual([{ dsName: 'alligators', label: 'Design system' }]);
  });

  test('one system: "Design system" over "<system name> · N canvases"', () => {
    const one = [{ ...GROUPS[0], dsFolders: [GROUPS[0].dsFolders[0]] }, GROUPS[1]];
    const m = dsPinnedModel(one, info({ designSystems: [SYSTEMS[0]] }));
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({
      label: 'Design system',
      sub: 'Alligators brand system · 87 canvases',
      count: 87,
    });
    expect(m.header).toBeNull();
  });

  test('several systems: named rows, the default says so, a folder for the campaign, a draft', () => {
    const rows = rowsOf();
    expect(rows.map((r) => r.label)).toEqual([
      'Alligators brand system',
      'Combine 2026',
      'Alligators 2023',
    ]);
    expect(rows.map((r) => r.sub)).toEqual([
      'Default · 87 canvases',
      '6 canvases · 2026/combine',
      'Draft · no canvas uses it',
    ]);
    expect(rows[2].draft).toBe(true);
    // "Design systems · 2 in use" over them once more than one is in use
    expect(dsPinnedModel(GROUPS, info()).header).toEqual({
      title: 'Design systems',
      note: '2 in use',
    });
  });

  test('the default moves with the config; an unknown default falls back to the first system', () => {
    expect(rowsOf({ defaultDs: 'combine-2026' }).map((r) => r.isDefault)).toEqual([
      false,
      true,
      false,
    ]);
    expect(rowsOf({ defaultDs: 'gone' }).map((r) => r.isDefault)).toEqual([true, false, false]);
  });

  test('the amber dot: level 11, or level 10 with a reason beyond missing-functional — nothing else', () => {
    const dot = (state: Record<string, unknown>) => rowsOf({ state }).map((r) => !!r.amber);
    expect(dot({})).toEqual([false, false, false]);
    expect(dot({ 'combine-2026': { level: 11, reasons: ['missing-functional'] } })).toEqual([
      false,
      true,
      false,
    ]);
    expect(dot({ alligators: { level: 10, reasons: ['missing-functional'] } })).toEqual([
      false,
      false,
      false,
    ]);
    expect(
      dot({ alligators: { level: 10, reasons: ['missing-functional', 'manifest-stale'] } })
    ).toEqual([true, false, false]);
    expect(dot({ alligators: { level: 0, reasons: [] } })).toEqual([false, false, false]);
    // a system made before the schema says so on its second line (13 · ds-multi-panel)
    expect(rowsOf({ state: { 'combine-2026': { level: 11, reasons: [] } } })[1].sub).toBe(
      'Made before the schema'
    );
  });

  test('a project with no system offers "Make a design system" — to someone who can edit', () => {
    const none = [{ label: 'UI', kind: 'canvas' }];
    expect(dsPinnedModel(none, info({ designSystems: [] })).empty).toEqual({
      label: 'Make a design system',
    });
    expect(dsPinnedModel(none, info({ designSystems: [], canMake: false })).empty).toBeNull();
    // …and never next to a system
    expect(dsPinnedModel(GROUPS, info()).empty).toBeNull();
  });

  test('ds.set-default and ds.make are registered and hidden from ⌘K; ds.go-to is live', () => {
    for (const id of ['ds.set-default', 'ds.make']) {
      const def = ACTIONS_BY_ID.get(id);
      expect(def, id).toBeTruthy();
      expect(def?.search?.hidden).toBe(true);
    }
    expect(PENDING_MENU_IDS['ds.set-default']).toBeUndefined();
    expect(ACTIONS_BY_ID.get('ds.go-to')).toBeTruthy();
    expect(PENDING_MENU_IDS['ds.go-to']).toBeUndefined();
  });
});
