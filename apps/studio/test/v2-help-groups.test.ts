// S1.21 — the "?" sheet's two navigation groups (11 Projects and Navigation, pn-switch-ai):
// "Tabs and windows" and "Finding a canvas". The rows come from the registry's own `help.group`
// (not the help-model fallback table), "Find a shortcut" finds them, and a browser tab — which has no
// tabs of its own to switch — shows "Finding a canvas" without the desktop-only tab rows.
import { describe, expect, test } from 'bun:test';
import { HELP_GROUPS } from '../actions/help.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { buildHelpSheet, filterHelpSheet } from '../client/v2/search/help-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const desktop = menuCtx({ native: true, canvasOpen: true });
const browser = menuCtx({ native: false, canvasOpen: true });

const rowsOf = (sheet: ReturnType<typeof buildHelpSheet>, group: string) =>
  sheet.groups.find((g) => g.id === group)?.rows ?? [];

describe('"?" sheet · Tabs and windows / Finding a canvas (S1.21)', () => {
  const sheet = buildHelpSheet(desktop);

  test('both groups exist with the drawn headings, after File, in the artboard order', () => {
    const labels = Object.fromEntries(HELP_GROUPS.map((g) => [g.id, g.label]));
    expect(labels['tabs-windows']).toBe('Tabs and windows');
    expect(labels.finding).toBe('Finding a canvas');
    const ids = sheet.groups.map((g) => g.id);
    expect(ids.indexOf('tabs-windows')).toBeGreaterThan(ids.indexOf('file'));
    expect(ids.indexOf('finding')).toBe(ids.indexOf('tabs-windows') + 1);
  });

  test('Tabs and windows lists the tab keys, Show Home and Close tab — read from the registry', () => {
    expect(rowsOf(sheet, 'tabs-windows').map((r) => r.id)).toEqual([
      'tab.next',
      'tab.prev',
      'home.open',
      'tab.close',
      'tab.select',
    ]);
    const keys = Object.fromEntries(rowsOf(sheet, 'tabs-windows').map((r) => [r.id, r.keys]));
    expect(keys['tab.next']).toEqual(['⌃tab']);
    expect(keys['tab.prev']).toEqual(['⌃⇧tab']);
    expect(keys['home.open']).toEqual(['⌘T']);
    expect(keys['tab.close']).toEqual(['⌘W']);
    expect(keys['tab.select']).toEqual(['⌘1–9']);
  });

  test('Finding a canvas lists Search, Open project… and Version history', () => {
    const rows = rowsOf(sheet, 'finding');
    expect(rows.map((r) => r.id)).toEqual(['search.open', 'project.open', 'history.open']);
    expect(rows.map((r) => r.keys[0])).toEqual(['⌘K', '⌘O', '⌥⌘H']);
  });

  test('the placement is the registry`s own help.group, not the help-model fallback', () => {
    for (const id of ['tab.next', 'tab.prev', 'home.open', 'tab.close']) {
      expect(ACTIONS_BY_ID.get(id)?.help?.group, id).toBe('tabs-windows');
    }
    for (const id of ['search.open', 'project.open', 'history.open']) {
      expect(ACTIONS_BY_ID.get(id)?.help?.group, id).toBe('finding');
    }
  });

  test('a row is on the sheet once: nothing of these is left in File or Panels and AI', () => {
    const all = sheet.groups.flatMap((g) => g.rows.map((r) => [g.id, r.id] as const));
    for (const id of ['tab.close', 'home.open', 'project.open', 'history.open', 'search.open']) {
      expect(
        all.filter(([, rid]) => rid === id).map(([g]) => g),
        id
      ).toHaveLength(1);
    }
    expect(rowsOf(sheet, 'file').map((r) => r.id)).not.toContain('tab.close');
    expect(rowsOf(sheet, 'panels-ai').map((r) => r.id)).not.toContain('search.open');
  });

  test('"Find a shortcut" finds them by label and by key', () => {
    const ids = (q: string) =>
      filterHelpSheet(sheet, q).groups.flatMap((g) => g.rows.map((r) => `${g.id}/${r.id}`));
    expect(ids('next tab')).toContain('tabs-windows/tab.next');
    expect(ids('close tab')).toContain('tabs-windows/tab.close');
    expect(ids('version history')).toEqual(['finding/history.open']);
    expect(ids('⌘K')).toContain('finding/search.open');
    expect(filterHelpSheet(sheet, 'tab').groups.map((g) => g.id)).toContain('tabs-windows');
  });

  test('a browser tab has no tab keys to teach, but still has Search and Version history', () => {
    const b = buildHelpSheet(browser);
    expect(b.groups.some((g) => g.id === 'tabs-windows')).toBe(false);
    expect(rowsOf(b, 'finding').map((r) => r.id)).toContain('search.open');
    expect(rowsOf(b, 'finding').map((r) => r.id)).toContain('history.open');
    expect(rowsOf(b, 'finding').map((r) => r.id)).not.toContain('project.open');
  });
});
