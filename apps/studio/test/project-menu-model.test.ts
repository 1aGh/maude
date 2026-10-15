// V2-4.2 — the one menu (CONTRACT §1) as a render model. The tree is data (actions/menu.ts), the
// labels / keys / visibility are the registry's; this pins the seam between them:
//  · every menu id is either in the registry or on PENDING_MENU_IDS with its owning task, and
//    nothing on that list is registered (a registered id must leave it, a missing one must join it);
//  · the menu renders only registry ids, in tree order, and never invents a row.
import { describe, expect, test } from 'bun:test';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { menuIds, PROJECT_MENU } from '../actions/menu.ts';
import {
  buildProjectMenu,
  keyHint,
  menuCtx,
  modelIds,
  PENDING_MENU_IDS,
} from '../client/v2/shell/project-menu-model.js';

describe('the registry half of the menu', () => {
  test('every menu id is registered or on the pending list; the list holds nothing registered', () => {
    const missing = [...new Set(menuIds())].filter((id) => !ACTIONS_BY_ID.has(id)).sort();
    expect(missing).toEqual(Object.keys(PENDING_MENU_IDS).sort());
  });

  test('each pending id names the task that registers it', () => {
    for (const [id, owner] of Object.entries(PENDING_MENU_IDS))
      expect(owner, id).toMatch(/^(V2-\d+\.\d+|S\d+ \(.+\))$/);
    // the owners the plan names
    expect(PENDING_MENU_IDS['view.exports']).toBe('V2-4.3');
    expect(PENDING_MENU_IDS['view.layers-panel']).toBe('V2-4.4');
    expect(PENDING_MENU_IDS['diag.logs']).toBe('V2-4.7');
    expect(PENDING_MENU_IDS['sync.resync']).toBe('V2-4.7');
  });

  test('the nine ids this task registers are registered, with the contract’s words', () => {
    const words: Record<string, string> = {
      'nav.home': 'Back to Home',
      'canvas.duplicate': 'Duplicate canvas',
      'canvas.rename': 'Rename canvas',
      'canvas.move': 'Move to…',
      'import.figma': 'Import from Figma…',
      'import.brand': 'Import a brand…',
      'account.switch': 'Sign in as another account…',
      'edit.cut': 'Cut',
      'edit.paste': 'Paste',
    };
    for (const [id, label] of Object.entries(words)) {
      expect(ACTIONS_BY_ID.get(id)?.label, id).toBe(label);
    }
  });
});

describe('buildProjectMenu', () => {
  const desktop = menuCtx({ native: true, canvasOpen: true });
  const browser = menuCtx({ native: false, canvasOpen: true });

  test('renders only registry ids, in PROJECT_MENU order, minus the pending list', () => {
    const want = menuIds().filter((id) => ACTIONS_BY_ID.has(id));
    // the desktop shell sees every registered id (no registered action is hidden there)
    expect(modelIds(buildProjectMenu(desktop))).toEqual(want);
  });

  test('Back to Home is the first row on the desktop and absent in the browser shell', () => {
    expect(modelIds(buildProjectMenu(desktop))[0]).toBe('nav.home');
    expect(modelIds(buildProjectMenu(browser))).not.toContain('nav.home');
    expect(modelIds(buildProjectMenu(browser))[0]).not.toBe('nav.home');
  });

  test('top level is Back to Home · File · Edit · View · Help · Version history · Share… · Export… · Diagnostics · Settings…', () => {
    const top = buildProjectMenu(desktop)
      .filter((n) => n.type !== 'sep')
      .map((n) => (n.type === 'sub' ? n.label : n.label));
    expect(top.slice(0, 5)).toEqual(['Back to Home', 'File', 'Edit', 'View', 'Help']);
    expect(top.slice(5)).toEqual(['Version history', 'Share…', 'Export…', 'Diagnostics', 'Settings…']);
  });

  test('Advanced groups are one quiet submenu row, flagged advanced', () => {
    const view = buildProjectMenu(desktop).find((n) => n.type === 'sub' && n.label === 'View');
    const adv = view.children.filter((n) => n.type === 'sub');
    expect(adv.map((n) => [n.label, n.advanced])).toEqual([['Advanced', true]]);
  });

  test('a read-only role does not lose rows the registry shows it (rule 12: one predicate)', () => {
    const ro = modelIds(buildProjectMenu(menuCtx({ native: true, readOnly: true })));
    expect(ro).toContain('settings.open');
  });

  test('the key hint is the primary binding live in this shell', () => {
    expect(keyHint(ACTIONS_BY_ID.get('export.open'), desktop)).toBe('⇧⌘E');
    // ⌘N is a desktop binding; the browser shell shows the bare-N one (N) or nothing, never ⌘N
    expect(keyHint(ACTIONS_BY_ID.get('canvas.new'), browser)).not.toBe('⌘N');
    expect(keyHint(ACTIONS_BY_ID.get('canvas.new'), desktop)).toBe('⌘N');
  });

  test('Hide panels flips to Show panels with the panels’ state', () => {
    const label = (state) =>
      buildProjectMenu(desktop, state)
        .find((n) => n.type === 'sub' && n.label === 'View')
        .children.find((n) => n.id === 'view.panels').label;
    expect(label({ panelsHidden: false })).toBe('Hide panels');
    expect(label({ panelsHidden: true })).toBe('Show panels');
  });

  test('an unregistered id leaves no row, no empty submenu and no doubled separator', () => {
    const tree = [
      { submenu: 'Empty', items: [{ id: 'nope.nothing' }] },
      { id: 'canvas.new' },
      { sep: true },
      { sep: true },
      { id: 'nope.nothing' },
      { sep: true },
      { id: 'settings.open' },
      { sep: true },
    ];
    const m = buildProjectMenu(desktop, {}, { tree });
    expect(m.map((n) => (n.type === 'item' ? n.id : n.type))).toEqual([
      'canvas.new',
      'sep',
      'settings.open',
    ]);
  });

  test('the tree still names Export… twice (top level and File) — both render', () => {
    expect(PROJECT_MENU.filter((n) => 'id' in n && n.id === 'export.open').length).toBe(1);
    expect(modelIds(buildProjectMenu(desktop)).filter((i) => i === 'export.open').length).toBe(2);
  });
});
