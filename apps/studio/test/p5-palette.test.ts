// P5 (UX audit F09) — ⌘K noise: the artboard presets are ONE "New artboard ›" row, New canvas leads, the New rows
// carry a one-line hint, and "Ask AI" is the verb (not "Generate with AI…").
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import {
  actionSearchRows,
  assemble,
  NEW_ARTBOARD_ROW,
  settingsSearchRows,
} from '../client/v2/search/search-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const desktop = menuCtx({ native: true, canvasOpen: true });
const LOCAL = [...actionSearchRows(desktop, { isRunnable: () => true }), ...settingsSearchRows({})];
const find = (q: string) => assemble({ query: q, local: LOCAL, canAskAI: true });
const rowsOf = (res: ReturnType<typeof find>) => res.groups.flatMap((g) => g.rows);
const src = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('typing "new"', () => {
  const rows = rowsOf(find('new'));

  test('the presets are one row, "New artboard ›", not seven', () => {
    const presets = rows.filter(
      (r) => r.actionId?.startsWith('artboard.new-') && r.actionId !== 'artboard.new-menu'
    );
    expect(presets.map((r) => r.actionId)).toEqual([]);
    const door = rows.filter((r) => r.actionId === 'artboard.new-menu');
    expect(door.length).toBe(1);
    expect(door[0].name).toBe('New artboard ›');
    expect(door[0].drill).toBe(NEW_ARTBOARD_ROW.drill);
    expect(door[0].hint).toContain('Mobile');
  });

  test('New canvas ranks first among the actions', () => {
    const acts = rows.filter((r) => r.group === 'actions');
    expect(acts[0].actionId).toBe('canvas.new');
  });

  test('the New rows say in one line what they make; the door has no menu-path chip', () => {
    for (const id of ['canvas.new', 'canvas.new-brief', 'canvas.new-video']) {
      const r = rows.find((x) => x.actionId === id);
      expect(r?.hint, id).toBeTruthy();
    }
    expect(rows.find((r) => r.actionId === 'artboard.new-menu')?.where).toBe('');
  });
});

describe('drilling into New artboard', () => {
  test('"New artboard: " lists the presets themselves', () => {
    const ids = rowsOf(find('New artboard: ')).map((r) => r.actionId);
    expect(ids).toContain('artboard.new-a4');
    expect(ids).toContain('artboard.new-mobile');
    expect(ids).not.toContain('artboard.new-menu');
  });
  test('a query that already narrows to one preset keeps that row', () => {
    const ids = rowsOf(find('New artboard — A4')).map((r) => r.actionId);
    expect(ids[0]).toBe('artboard.new-a4');
  });
});

describe('Ask AI is the verb', () => {
  test('no ⌘K, menu or dialog label says "Generate with AI"; v1 palette strings match the registry', () => {
    expect(ACTIONS_BY_ID.get('ai.generate')?.label).toMatch(/^Ask AI/);
    expect(src('client/generate-dialog.jsx').includes('Generate with AI')).toBe(false);
    for (const id of ['share.copy-link', 'view.design-system', 'ai.generate']) {
      const def = ACTIONS_BY_ID.get(id);
      expect(def?.legacy?.palette, id).toBe(def?.label);
    }
  });
});

describe('the palette runs a door by drilling, not by closing', () => {
  test('command-palette.jsx drills a row that carries `drill`', () => {
    const palette = src('client/dialogs/command-palette.jsx');
    expect(palette.includes('item.drill')).toBe(true);
    expect(palette.includes('close, drill }')).toBe(true);
  });
});
