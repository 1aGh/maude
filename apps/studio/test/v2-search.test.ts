// V2-4.6 — ⌘K Search and the "?" sheet, as models. Done when ⌘K finds every Advanced item by name
// ("hub", "figma", "api key", "print guides", "New artboard — A4"…) with its where-path, Ask AI is the
// last row, and "?" lists every registry key plus the "Keys and tools that moved" fold.

import { describe, expect, test } from 'bun:test';
import { MOVED_KEYS } from '../actions/help.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { holds, isVisible } from '../actions/resolve.ts';
import { buildHelpSheet, filterHelpSheet } from '../client/v2/search/help-model.js';
import { MOVED_LOCAL, movedKeys } from '../client/v2/search/moved-keys.js';
import {
  actionSearchRows,
  assemble,
  emptyCopy,
  rankRows,
  remoteRows,
  resultsCount,
  sanitizeQuery,
  settingsSearchRows,
  toolbarOf,
} from '../client/v2/search/search-model.js';
import { SETTINGS_ROWS } from '../client/v2/settings/settings-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const desktop = menuCtx({ native: true, canvasOpen: true });
const browser = menuCtx({ native: false, canvasOpen: true });

const localFor = (ctx = desktop, cloud: object | null = null, isRunnable = () => true) => [
  ...actionSearchRows(ctx, { isRunnable }),
  ...settingsSearchRows({ cloud }),
];
const LOCAL = localFor();
const find = (q: string, local = LOCAL, canAskAI = true) => assemble({ query: q, local, canAskAI });
const rowsOf = (res: ReturnType<typeof find>) => res.groups.flatMap((g) => g.rows);

describe('the probes: Advanced things found by name, each with where it lives', () => {
  test('"hub" finds the team server, the hub address and the sync rows', () => {
    const rows = rowsOf(find('hub'));
    const byName = (n: string) => rows.find((r) => r.name === n);
    expect(byName('Add a team server…')?.where).toBe(
      'Settings › Connections › Your team’s own server'
    );
    expect(byName('Hub address')?.where).toBe('Settings › Connections › Maude Cloud');
    expect(rows.some((r) => r.actionId === 'sync.resync')).toBe(true);
    expect(rows.some((r) => r.actionId === 'diag.sync')).toBe(true);
  });

  test('"figma" finds Import from Figma… and the Figma connection', () => {
    const rows = rowsOf(find('figma'));
    expect(rows.find((r) => r.actionId === 'import.figma')?.where).toBe('Menu › File');
    const conn = rows.find((r) => r.name === 'Figma');
    expect(conn?.where).toBe('Settings › Connections');
    expect(conn?.section).toBe('connections');
  });

  test('"api key" finds where keys live, in Settings', () => {
    const rows = rowsOf(find('api key'));
    expect(rows.find((r) => r.name === 'AI images, video and voice')?.where).toBe(
      'Settings › Connections'
    );
    expect(rows.find((r) => r.name === 'Keys are kept in')?.where).toBe(
      'Settings › Advanced › This Mac'
    );
  });

  test('"print guides" is the View › Advanced toggle', () => {
    const res = find('print guides');
    const top = rowsOf(res)[0];
    expect(top.actionId).toBe('view.print-guides');
    expect(top.where).toBe('Menu › View › Advanced');
    expect(top.advanced).toBe(true);
    expect(res.groups[0].id).toBe('actions');
    expect(res.groups[0].aside).toBe('1 hidden tool');
  });

  test('"New artboard — A4" (with the dash) is New artboard: A4, and only that', () => {
    const res = find('New artboard — A4');
    const rows = rowsOf(res);
    expect(rows[0].actionId).toBe('artboard.new-a4');
    expect(rows[0].where).toBe('Menu › Edit › Advanced › New artboard');
    expect(rows.filter((r) => r.actionId?.startsWith('artboard.new-')).length).toBe(1);
  });

  test('every action that lives under an Advanced fold or Diagnostics is found by its own label', () => {
    const adv = LOCAL.filter((r) => r.group === 'actions' && r.advanced);
    expect(adv.length).toBeGreaterThanOrEqual(15);
    for (const r of adv) {
      const found = rowsOf(find(r.name));
      expect(
        found.map((x) => x.id),
        `⌘K "${r.name}"`
      ).toContain(r.id);
      expect(found.find((x) => x.id === r.id)?.where).toBe(r.where);
    }
  });

  test('every Settings row is found by its own name, and says its section', () => {
    const rows = LOCAL.filter((r) => r.group === 'settings');
    // one result per control (the two Sync project files rows are one)
    expect(rows.length).toBe(SETTINGS_ROWS.length - 1);
    for (const r of rows) {
      const found = rowsOf(find(r.name));
      const hit = found.find((x) => x.id === r.id);
      expect(hit, `⌘K "${r.name}"`).toBeDefined();
      expect(hit?.where.startsWith('Settings › ')).toBe(true);
      expect(typeof hit?.section).toBe('string');
    }
  });

  test('a cloud tab has no local-machine settings rows (as in the sheet), and none are found', () => {
    const cloudRows = localFor(browser, { url: 'https://hub.example' });
    expect(
      cloudRows.filter((r) => r.group === 'settings').every((r) => r.section === 'general')
    ).toBe(true);
    expect(rowsOf(find('keychain', cloudRows)).length).toBe(0);
  });
});

describe('the list', () => {
  test('Ask AI is always the last row, and ⌘↵ names it', () => {
    for (const q of ['hub', 'export', 'zzzz nothing']) {
      const res = find(q);
      const last = res.items[res.items.length - 1];
      expect(last.id).toBe('ask-ai');
      expect(last.keys).toBe('⌘↵');
    }
    // the words follow what is above it (S1.4): hits → "Ask AI — find “hub” by what it looks like",
    // none → "Ask AI to find “zzzz nothing” — it looks inside canvases too"
    expect(find('hub').ask).toMatchObject({
      name: 'Ask AI',
      meta: ' — find “hub” by what it looks like',
    });
    expect(find('zzzz nothing').ask?.name).toBe('Ask AI to find “zzzz nothing”');
  });

  test('no AI on this surface → no Ask AI row, and the empty copy drops "or ask AI"', () => {
    const res = find('hub', LOCAL, false);
    expect(res.items.some((r) => r.id === 'ask-ai')).toBe(false);
    expect(emptyCopy('pricng', false)).toEqual({
      headline: 'Nothing called “pricng”.',
      next: 'Try another word.',
    });
  });

  test('"Nothing called …" copy is CONTRACT §4 verbatim', () => {
    expect(emptyCopy('pricng', true)).toEqual({
      headline: 'Nothing called “pricng”.',
      next: 'Try another word, or ask AI to find it.',
    });
    const res = find('pricng qqqq');
    expect(res.empty).toBe(true);
    expect(res.total).toBe(0);
    expect(res.items.map((r) => r.id)).toEqual(['ask-ai']);
  });

  test('"N results", never "1 results"', () => {
    expect(resultsCount(1)).toBe('1 result');
    expect(resultsCount(7)).toBe('7 results');
  });

  test('group order: canvases, artboards, actions, tools, settings', () => {
    const remote = remoteRows({
      q: 'size',
      rows: [
        {
          group: 'artboards',
          key: 'ui/a/Kampan.tsx#a4',
          name: 'A4 size',
          meta: 'Kampan a',
          score: 3,
          close: false,
          marks: [],
        },
        {
          group: 'canvases',
          key: 'ui/a/Kampan.tsx',
          name: 'Sizes',
          meta: 'ui/a',
          score: 3,
          close: false,
          marks: [],
        },
      ],
    });
    const res = assemble({ query: 'size', local: LOCAL, remote, canAskAI: true });
    const ids = res.groups.map((g) => g.id);
    const order = ['canvases', 'artboards', 'actions', 'tools', 'settings'];
    expect(ids).toEqual(order.filter((g) => ids.includes(g)));
    expect(ids.slice(0, 2)).toEqual(['canvases', 'artboards']);
  });

  test('canvas and artboard hits open by designRoot-relative path; artboards say "artboard in …"', () => {
    const rows = remoteRows(
      {
        q: 'letak',
        rows: [
          {
            group: 'canvases',
            key: 'ui/2026/combine/Combine-letak.tsx',
            name: 'Combine-letak',
            meta: 'ui/2026/combine',
            score: 4,
            close: false,
            marks: [[0, 7]],
          },
          {
            group: 'artboards',
            key: 'ui/2026/LetakA6.tsx#front',
            name: 'Leták A6',
            meta: 'LetakA6 ui print',
            score: 4,
            close: false,
            marks: [],
          },
        ],
      },
      { designRel: '.design' }
    );
    expect(rows[0]).toMatchObject({
      group: 'canvases',
      path: '.design/ui/2026/combine/Combine-letak.tsx',
      artboardId: null,
    });
    expect(rows[1]).toMatchObject({
      group: 'artboards',
      path: '.design/ui/2026/LetakA6.tsx',
      artboardId: 'front',
      meta: 'artboard in LetakA6',
    });
  });

  test('when every hit is a typo match the list says so and names the word', () => {
    const remote = remoteRows({
      q: 'unifromy',
      rows: [
        {
          group: 'canvases',
          key: 'ui/Uniformy.tsx',
          name: 'Uniformy',
          meta: 'ui',
          score: 0.5,
          close: true,
          marks: [],
        },
      ],
    });
    const res = assemble({ query: 'unifromy', local: [], remote, canAskAI: true });
    expect(res.closeOnly).toBe(true);
    expect(res.closeWord).toBe('Uniformy');
  });
});

describe('rows come from the registry, at call time', () => {
  test('a row nothing can run is not offered (no dead row)', () => {
    const none = actionSearchRows(desktop, { isRunnable: () => false });
    expect(none).toEqual([]);
    const only = actionSearchRows(desktop, { isRunnable: (id) => id === 'view.print-guides' });
    expect(only.map((r) => r.actionId)).toEqual(['view.print-guides']);
  });

  test('a viewer does not see what the registry hides from them (rule 12: one predicate)', () => {
    const viewer = menuCtx({ native: true, canvasOpen: true, readOnly: true });
    const ids = new Set(actionSearchRows(viewer).map((r) => r.actionId));
    for (const id of ids) {
      const def = ACTIONS_BY_ID.get(id as string)!;
      expect(
        ['edit', 'preview'].some((mode) => isVisible(def, { ...viewer, mode: mode as 'edit' }))
      ).toBe(true);
    }
    // and a row only an owner may use is among the owner's, not the viewer's
    const owner = new Set(actionSearchRows(desktop).map((r) => r.actionId));
    const hiddenFromViewer = [...owner].filter((id) => !ids.has(id));
    expect(hiddenFromViewer.length).toBeGreaterThan(0);
  });

  test('a row carries the key the registry holds now, not a copy', () => {
    const row = actionSearchRows(desktop).find((r) => r.actionId === 'export.open');
    expect(row?.keys).toBe('⇧⌘E');
    const moved = ACTIONS.map((a) =>
      a.id === 'export.open' ? { ...a, keys: [{ chord: '⌥⌘X', layer: 'global' }] } : a
    );
    const again = actionSearchRows(desktop, { actions: moved as never }).find(
      (r) => r.actionId === 'export.open'
    );
    expect(again?.keys).toBe('⌥⌘X');
  });

  test('tools say which toolbar they are on, from MODE_TOOLS', () => {
    // V2-4.5b: `tool.pen` is the Marker (a Preview tool); Edit's Pen P waits for S2.
    const pen = ACTIONS_BY_ID.get('tool.pen')!;
    expect(toolbarOf(pen)).toBe('Preview toolbar');
    expect(toolbarOf(ACTIONS_BY_ID.get('tool.select')!)).toBe('Edit toolbar');
    const sticky = ACTIONS_BY_ID.get('tool.sticky')!;
    expect(toolbarOf(sticky)).toBe('Preview toolbar');
    const tools = LOCAL.filter((r) => r.group === 'tools');
    expect(tools.length).toBeGreaterThan(3);
    expect(tools.every((r) => /^(Edit|Preview) toolbar$/.test(r.where))).toBe(true);
  });

  test('accents and punctuation do not matter; a word that matches nothing drops the row', () => {
    expect(sanitizeQuery('  New artboard — A4 ')).toBe('New artboard A4');
    expect(rankRows(LOCAL, 'hub zzzz')).toEqual([]);
    expect(rankRows(LOCAL, '—')).toEqual([]);
  });
});

describe('"?" — the shortcuts sheet', () => {
  const sheet = buildHelpSheet(desktop);

  test('every registry key that is visible to the person is on the sheet', () => {
    const onSheet = new Set(
      [...sheet.groups.flatMap((g) => g.rows), ...sheet.advanced].flatMap((r) => [
        r.id,
        ...((r as { also?: string[] }).also ?? []),
      ])
    );
    const expected = ACTIONS.filter(
      (a) =>
        a.keys?.length &&
        ['edit', 'preview'].some((mode) => isVisible(a, { ...desktop, mode: mode as 'edit' })) &&
        a.keys.some(
          (b) => !b.hold && holds({ ...b.when, focus: undefined, selection: undefined }, desktop)
        ) &&
        !/^tab\.(select-|next|prev)/.test(a.id)
    );
    expect(expected.length).toBeGreaterThan(40);
    for (const a of expected) expect(onSheet.has(a.id), `"?" lists ${a.id}`).toBe(true);
    expect(onSheet.has('tab.select')).toBe(true);
  });

  test('a key is listed once: no repeats across focus lanes, no "any modifier" spellings, one row per meaning', () => {
    const rows = sheet.groups.flatMap((g) => g.rows);
    for (const r of rows) {
      const all = [...r.keys, ...r.alt];
      expect(new Set(all).size, `${r.id} repeats a key: ${all.join(' ')}`).toBe(all.length);
    }
    const stepBack = rows.find((r) => r.id === 'ui.step-back');
    expect(stepBack?.keys).toEqual(['esc']);
    expect(stepBack?.alt).toEqual([]);
    expect(rows.find((r) => r.id === 'object.remove')?.alt).toEqual([]);
    // A meaningful one-modifier variant stays: ⇧-arrows nudge further.
    expect(rows.find((r) => r.id === 'object.nudge')?.alt).toEqual(['⇧←', '⇧→', '⇧↑', '⇧↓']);
    // ⌥⌘1 … ⌥⌘9 is one key to learn, shown as a range like "Show tab 1–9".
    expect(rows.find((r) => r.id === 'view.jump-artboard')).toMatchObject({
      keys: ['⌥⌘1–9'],
      alt: [],
    });
    const objects = sheet.groups.find((g) => g.id === 'objects')?.rows ?? [];
    expect(objects.filter((r) => r.label === 'Nudge')).toHaveLength(1);
    expect(objects.find((r) => r.label === 'Nudge')).toMatchObject({ also: ['annotation.nudge'] });
  });

  test('chords are read from the registry when the sheet is built', () => {
    const rebound = ACTIONS.map((a) =>
      a.id === 'tool.pen' ? { ...a, keys: [{ chord: 'P', layer: 'tools' }] } : a
    );
    const s = buildHelpSheet(desktop, { actions: rebound as never });
    const row = s.groups.flatMap((g) => g.rows).find((r) => r.id === 'tool.pen');
    expect(row?.keys).toEqual(['P']);
  });

  test('groups follow HELP_GROUPS order and tools split by toolbar', () => {
    const ids = sheet.groups.map((g) => g.id);
    const order = [
      'edit-tools',
      'preview-tools',
      'file',
      'canvas',
      'panels-ai',
      'objects',
      'timeline',
      'present',
    ];
    expect(ids).toEqual(order.filter((g) => ids.includes(g)));
    const preview = sheet.groups.find((g) => g.id === 'preview-tools');
    expect(preview?.note).toBe('The key switches to Preview');
    expect(preview?.rows.map((r) => r.id)).toContain('tool.sticky');
    expect(sheet.groups.find((g) => g.id === 'edit-tools')?.rows.map((r) => r.id)).toContain(
      'tool.select'
    );
    expect(preview?.rows.map((r) => r.id)).toContain('tool.pen'); // the Marker (V2-4.5b)
  });

  test('the Advanced fold holds View › Advanced and Diagnostics keys with their path', () => {
    const inspector = sheet.advanced.find((r) => r.id === 'view.inspector');
    expect(inspector?.path).toBe('Menu › View › Advanced › Inspector');
    expect(sheet.advanced.find((r) => r.id === 'canvas.reload')?.path).toBe(
      'Menu › Diagnostics › Reload canvas'
    );
    expect(sheet.groups.flatMap((g) => g.rows).some((r) => r.id === 'view.inspector')).toBe(false);
  });

  test('"Keys and tools that moved" lists CONTRACT §2 old → new, with live keys', () => {
    const wasList = sheet.moved.map((m) => m.was);
    for (const was of [
      'Pen B',
      'Rect R',
      'Section ⇧S',
      'Export ⌘E',
      'Files tree T',
      'Hidden files H',
      'New board N',
      'Toggle theme',
      'New video…',
      'Actual size ⌘1',
      'Browse tool',
      'Ellipse O',
    ]) {
      expect(wasList, was).toContain(was);
    }
    expect(MOVED_LOCAL.length).toBeGreaterThanOrEqual(10);
    expect(sheet.moved.find((m) => m.was === 'Export ⌘E')?.now).toBe('Export… ⇧⌘E — ⌘E is unbound');
    // a registry row of the same `was` (rule 13, the commit that removes the binding) wins
    const merged = movedKeys(() => '', {
      local: MOVED_LOCAL,
      registry: [{ was: 'Pen B', now: 'Pen P', note: 'the registry says so' }],
    });
    expect(merged.filter((m) => m.was === 'Pen B')).toEqual([
      { was: 'Pen B', now: 'Pen P — the registry says so' },
    ]);
    expect(MOVED_KEYS.length >= 0).toBe(true);
  });

  test('a key a browser keeps for itself is shown as the menu path', () => {
    const s = buildHelpSheet(browser);
    const all = [...s.groups.flatMap((g) => g.rows), ...s.advanced];
    const reserved = all.filter((r) => (r as { path?: string }).path && r.keys.length);
    // none of those are lost: the row is still there
    expect(all.length).toBeGreaterThan(30);
    expect(reserved.every((r) => typeof (r as { path?: string }).path === 'string')).toBe(true);
  });

  test('"Find a shortcut" uses the same fold and every-word rule', () => {
    const f = filterHelpSheet(sheet, 'zoom fit');
    expect(f.groups.flatMap((g) => g.rows).map((r) => r.id)).toContain('view.zoom-fit');
    expect(f.groups.flatMap((g) => g.rows).length).toBeLessThan(5);
    expect(filterHelpSheet(sheet, '').count).toBe(sheet.count);
    expect(filterHelpSheet(sheet, 'pen b').moved.map((m) => m.was)).toContain('Pen B');
  });
});

describe('Ask AI reaches the composer (V2-4.6, lead)', () => {
  test('a parked query is taken once on mount, a later one by event; text only, capped, never sent', async () => {
    const { sendToAskAI, subscribeAskAI, ASK_AI_MAX, ASK_AI_PENDING_KEY } = await import(
      '../client/v2/search/search-env.js'
    );
    const target = new EventTarget() as EventTarget & Record<string, unknown>;
    sendToAskAI('make the hero calmer', target);
    const got: string[] = [];
    const off = subscribeAskAI((t: string) => got.push(t), target);
    expect(got).toEqual(['make the hero calmer']);
    expect(target[ASK_AI_PENDING_KEY]).toBeUndefined();
    sendToAskAI('x'.repeat(ASK_AI_MAX + 50), target);
    expect(got[1]?.length).toBe(ASK_AI_MAX);
    sendToAskAI('   ', target);
    expect(got.length).toBe(2);
    off();
    sendToAskAI('after unsubscribe', target);
    expect(got.length).toBe(2);
  });
});
