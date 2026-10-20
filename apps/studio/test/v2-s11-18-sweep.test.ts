// S11.18 — the sweep over the menu, ⌘K and "?" (06 ad-menus, ad-search, ad-open-all, ad-pinned).
// Done when: ⌘K "copy" lists the hidden tools with their homes and Copy link under Also; every Advanced item is
// found by name WITH a where-path; the menu has the kit's separators; the "?" sheet lists each key once, the
// moved keys once each (Toggle theme and New video… included), and says "Panels" where it has no AI row.

import { describe, expect, test } from 'bun:test';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { PROJECT_MENU } from '../actions/menu.ts';
import { buildHelpSheet } from '../client/v2/search/help-model.js';
import {
  actionSearchRows,
  assemble,
  settingsSearchRows,
} from '../client/v2/search/search-model.js';
import { buildProjectMenu, menuCtx } from '../client/v2/shell/project-menu-model.js';

const withSelection = (native: boolean) => ({
  ...menuCtx({ native, canvasOpen: true }),
  selection: 'object' as const,
});
const desktop = withSelection(true);
const localFor = (ctx = desktop) => [
  ...actionSearchRows(ctx, { isRunnable: () => true }),
  ...settingsSearchRows({ cloud: null }),
];
const find = (q: string, ctx = desktop) =>
  assemble({ query: q, local: localFor(ctx), canAskAI: true });

describe('⌘K "copy": the hidden tools with their homes, the rest under Also', () => {
  const res = find('copy');
  const group = (id: string) => res.groups.find((g) => g.id === id);

  test('Actions holds the hidden tools, each saying where it lives, with their count', () => {
    const rows = group('actions')?.rows ?? [];
    const byName = new Map(rows.map((r) => [r.name, r.where]));
    expect(byName.get('Copy code')).toBe('Inspector › Advanced');
    expect(byName.get('Copy element id')).toBe('Inspector › Advanced');
    expect(byName.get('Copy CSS')).toBe('Inspector › Advanced');
    expect(byName.get('Copy file path')).toBe(
      'Canvases panel › Advanced › row menu › Copy file path'
    );
    expect(byName.get('Copy logs')).toBe('Menu › Diagnostics › Logs');
    expect(rows.every((r) => r.advanced)).toBe(true);
    expect(group('actions')?.aside).toBe(`${rows.length} hidden tools`);
  });

  test('Copy link sits under Also, and says Share', () => {
    const also = group('also')?.rows ?? [];
    expect(also.find((r) => r.name === 'Copy link')?.where).toBe('Share');
    expect(also.every((r) => !r.advanced)).toBe(true);
    expect(res.groups.map((g) => g.id).indexOf('also')).toBeGreaterThan(
      res.groups.map((g) => g.id).indexOf('actions')
    );
  });

  test('a search with no hidden tool in it keeps the actions in one group', () => {
    const r = find('trash');
    expect(r.groups.some((g) => g.id === 'also')).toBe(false);
  });
});

describe('every hidden tool is found by its own name and says where it lives', () => {
  test('an action with an Advanced or Diagnostics home carries a non-empty where-path', () => {
    const rows = actionSearchRows(desktop, { isRunnable: () => true }).filter((r) => r.advanced);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.where).map((r) => r.actionId)).toEqual([]);
  });

  test('the registry names a home for the Inspector › Advanced and Logs tools', () => {
    const where = (id: string) => ACTIONS_BY_ID.get(id)?.search?.where;
    for (const id of [
      'inspector.copy-code',
      'inspector.copy-css',
      'inspector.edit-css-as-text',
      'element.copy-id',
      'element.set-id',
      'element.detach',
    ])
      expect(where(id)).toBe('Inspector › Advanced');
    expect(where('diag.copy-logs')).toBe('Menu › Diagnostics › Logs');
    expect(where('diag.logs-show-in-finder')).toBe('Menu › Diagnostics › Logs');
    expect(where('share.copy-link')).toBe('Share');
  });

  test('"advanced" finds Open all / Close all with the home the canvas draws', () => {
    const rows = find('advanced').groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.actionId === 'view.advanced-open-all')?.where).toBe(
      'Once · every panel'
    );
    expect(rows.find((r) => r.actionId === 'view.advanced-close-all')?.where).toBe(
      'Settings › Advanced › Reset'
    );
  });
});

describe('the menu has the kit’s separators', () => {
  const ctx = menuCtx({ native: true, canvasOpen: true });
  const menu = buildProjectMenu(ctx);
  const shape = (nodes: { type?: string; label?: string }[]) =>
    nodes.map((n) => (n.type === 'sep' ? '|' : (n.label ?? '?')));

  test('top level: Home | File Edit View Help | Version history Share Export | Diagnostics Settings', () => {
    const s = shape(menu).join(' ');
    expect(s).toMatch(
      /^Back to Home \| File Edit View Help \| Version history Share… Export… \| Diagnostics Settings…$/
    );
  });

  test('View sets Advanced apart; Help sets Report a bug apart', () => {
    const sub = (name: string) =>
      (
        menu.find((n: { label?: string }) => n.label === name) as {
          children: { type?: string; label?: string }[];
        }
      ).children;
    const view = shape(sub('View'));
    expect(view[view.length - 2]).toBe('|');
    expect(view[view.length - 1]).toBe('Advanced');
    const help = shape(sub('Help'));
    expect(help[help.length - 2]).toBe('|');
    expect(help[help.length - 1]).toBe('Report a bug…');
  });

  test('the tree itself holds the separators (the menu cannot drift from it)', () => {
    expect(PROJECT_MENU.some((n) => 'sep' in n)).toBe(true);
  });
});

describe('the "?" sheet', () => {
  const sheet = buildHelpSheet(menuCtx({ native: true, canvasOpen: true }));

  test('each old key is listed once under "Keys and tools that moved"', () => {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9⌘⇧⌥⌃]+/g, ' ')
        .trim();
    const words = (s: string) => new Set(norm(s).split(' '));
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const m of sheet.moved) {
      // "Hidden files H" and "H hidden files" are one old key: compare as a bag of words
      const key = [...words(m.was)].sort().join(' ');
      if (seen.has(key)) dup.push(`${seen.get(key)} / ${m.was}`);
      seen.set(key, m.was);
    }
    expect(dup).toEqual([]);
  });

  test('Toggle theme and New video… are on it', () => {
    const was = sheet.moved.map((m) => m.was);
    expect(was).toContain('Toggle theme');
    expect(was).toContain('New video…');
    expect(sheet.moved.find((m) => m.was === 'Toggle theme')?.now).toContain('Settings › General');
    expect(sheet.moved.find((m) => m.was === 'New video…')?.now).toContain('New artboard › Video');
  });

  test('a group lists one row for the same words on the same keys', () => {
    const dup: string[] = [];
    for (const g of sheet.groups) {
      const seen = new Set<string>();
      for (const r of g.rows) {
        const k = `${r.label}|${r.keys.join(' ')}`;
        if (seen.has(k)) dup.push(`${g.label}: ${k}`);
        seen.add(k);
      }
    }
    expect(dup).toEqual([]);
    const remove = sheet.groups
      .find((g) => g.id === 'objects')
      ?.rows.filter((r) => r.label === 'Remove');
    expect(remove).toHaveLength(1);
  });

  test('in a browser the group that has no AI row is called Panels', () => {
    const browser = buildHelpSheet(menuCtx({ native: false, canvasOpen: true }));
    const g = browser.groups.find((x) => x.id === 'panels-ai');
    const hasAi = g?.rows.some((r) => r.id === 'ai.chat');
    expect(g?.label).toBe(hasAi ? 'Panels and AI' : 'Panels');
    expect(sheet.groups.find((x) => x.id === 'panels-ai')?.label).toBe('Panels and AI');
  });
});

describe('the registry still says canvas, not board', () => {
  test('the brief door is "New brief"', () => {
    expect(ACTIONS_BY_ID.get('canvas.new-brief')?.label).toBe('New brief');
    expect(ACTIONS.filter((a) => /\bboard\b/i.test(a.label)).map((a) => a.id)).toEqual([]);
  });
});
