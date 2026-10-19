// S5.18 G8 (03 `ai-adv-edges`, `chat-cmd-menu`) — the "/" menu is the short v2 list: one-line notes, no argument
// hints, "More…" for the rest. Every v1 command stays reachable (nothing deleted).
// Red first: the menu was the v1 list — 8 rows, long manifest descriptions and argument hints.
import { describe, expect, test } from 'bun:test';
import {
  buildCommandModel,
  FEATURED,
  MENU_ROWS,
  STATIC_COMMANDS,
  shortNote,
  trimmedCommands,
} from '../client/panels/slash-commands.js';

const live = [
  {
    name: 'flow:plan',
    description: 'Create a feature implementation plan grounded in project requirements.',
  },
  {
    name: 'desktop-e2e',
    description: 'Run or author DOM-driven end-to-end scenarios against the app.',
  },
];
const model = () => buildCommandModel(STATIC_COMMANDS, live);

describe('the short list', () => {
  test('"/" leads with the four design verbs (03 words), then your own commands; ≤ 5 rows; no arg hints', () => {
    const { items } = trimmedCommands(model().all, '');
    expect(items).toHaveLength(MENU_ROWS);
    expect(items.slice(0, 4).map((c: { name: string }) => c.name)).toEqual(
      FEATURED.map((f) => f.name)
    );
    expect(items.slice(0, 4).map((c: { note: string }) => c.note)).toEqual([
      'Review this canvas',
      'Change the selection',
      'Capture an artboard',
      'Export this canvas',
    ]);
    expect(items[4].group).not.toBe('design'); // "Your own commands too"
    expect(items.every((c: { argHint: string }) => c.argHint === '')).toBe(true);
  });

  test('notes are one short line (the manifest sentence, cut), never the long description', () => {
    expect(
      shortNote({
        name: 'flow:plan',
        description: 'Create a feature implementation plan grounded in project requirements.',
      }).length
    ).toBeLessThanOrEqual(44);
    expect(shortNote({ name: 'x', description: 'Short one. And a second sentence.' })).toBe(
      'Short one'
    );
  });

  test('"More…" counts what is hidden; picking it (expanded) shows every command', () => {
    const all = model().all;
    const short = trimmedCommands(all, '');
    expect(short.more).toBe(all.length - short.items.length);
    expect(short.more).toBeGreaterThan(0);
    const full = trimmedCommands(all, '', { expanded: true });
    expect(full.more).toBe(0);
    expect(full.items).toHaveLength(all.length);
  });

  test('typing searches the whole catalogue; five rows and "More…" for the rest', () => {
    const all = model().all;
    const hit = trimmedCommands(all, 'design:');
    expect(hit.items.length).toBeLessThanOrEqual(MENU_ROWS);
    expect(hit.items.every((c: { name: string }) => c.name.includes('design:'))).toBe(true);
    const one = trimmedCommands(all, 'desktop-e');
    expect(one.items.map((c: { name: string }) => c.name)).toEqual(['desktop-e2e']);
    expect(one.more).toBe(0);
  });

  test('nothing deleted: every command the v1 menu offered is reachable through More…', () => {
    const { all } = model();
    const reachable = new Set(
      trimmedCommands(all, '', { expanded: true }).items.map((c: { name: string }) => c.name)
    );
    for (const c of all) expect(reachable.has(c.name)).toBe(true);
    for (const c of STATIC_COMMANDS) expect(reachable.has(c.name.toLowerCase())).toBe(true);
  });
});
