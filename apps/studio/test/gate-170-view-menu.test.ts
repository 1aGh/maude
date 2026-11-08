// #170 R25 (burndown T2.4b, lead default D15) — View names what it shows: Layers and the Inspector are
// first-level View rows (they were under View › Advanced, where the Inspector hid behind a fold), and the
// AI chat has a View row. All through the registry tree (actions/menu.ts) and the one runner — no new key.
import { describe, expect, test } from 'bun:test';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { menuPaths } from '../actions/menu.ts';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import { buildProjectMenu, menuCtx } from '../client/v2/shell/project-menu-model.js';

type Node = { type: string; id?: string; label?: string; advanced?: boolean; children?: Node[] };

const viewOf = (ctx: ReturnType<typeof menuCtx>) =>
  (buildProjectMenu(ctx) as Node[]).find((n) => n.type === 'sub' && n.label === 'View') as Node;
const firstLevel = (view: Node) =>
  (view.children ?? []).filter((n) => n.type !== 'sub' && n.type !== 'sep').map((n) => n.id);
const advancedIds = (view: Node) =>
  ((view.children ?? []).find((n) => n.type === 'sub' && n.advanced)?.children ?? []).map(
    (n) => n.id
  );

describe('R25 — View lists Layers, the Inspector and the AI chat', () => {
  const desktop = menuCtx({ native: true, canvasOpen: true });

  test('Layers, Inspector and AI chat are first-level View rows, in that order after Hide panels', () => {
    const ids = firstLevel(viewOf(desktop));
    for (const id of ['view.layers', 'view.inspector', 'ai.chat']) expect(ids).toContain(id);
    expect(ids.slice(0, 3)).toEqual(['view.panels', 'view.layers', 'view.inspector']);
  });

  test('the Inspector left View › Advanced; the Layers-as-a-panel switch stays there', () => {
    const adv = advancedIds(viewOf(desktop));
    expect(adv).not.toContain('view.inspector');
    expect(adv).toContain('view.layers-panel');
  });

  test('the derived paths say View, not View › Advanced', () => {
    const paths = menuPaths(ACTIONS_BY_ID);
    expect(paths.get('view.inspector')).toEqual([
      { path: 'Menu › View › Inspector', advanced: false },
    ]);
    expect(paths.get('view.layers')).toEqual([{ path: 'Menu › View › Layers', advanced: false }]);
    expect(paths.get('ai.chat')?.some((p) => p.path === 'Menu › View › AI chat')).toBe(true);
  });

  test('a cloud tab lists the AI chat row greyed; a browser tab on the desktop server has none', () => {
    const cloud = viewOf(menuCtx({ cloudTab: true, canvasOpen: true }));
    const row = (cloud.children ?? []).find((n) => n.id === 'ai.chat') as
      | (Node & { disabled?: boolean })
      | undefined;
    expect(row).toBeDefined();
    expect(row?.disabled).toBe(true);
    expect(firstLevel(viewOf(menuCtx({ canvasOpen: true })))).not.toContain('ai.chat');
  });
});

describe('R25 — the View › Layers row runs', () => {
  const run = (layersMode: string) => {
    const calls: string[] = [];
    const d = new Proxy(
      { layersMode, toggleRightPanel: (id: string) => calls.push(id) } as Record<string, unknown>,
      { get: (t, k) => (k in t ? t[k as string] : () => {}) }
    );
    createMenuHandlers(d)['view.layers']?.();
    return calls;
  };

  test('Layers as a panel (the default): the Layers panel toggles', () => {
    expect(run('separate')).toEqual(['layers']);
  });

  test('Layers inside the Inspector: the Inspector toggles, where Layers lives', () => {
    expect(run('in-inspector')).toEqual(['inspector']);
  });
});
