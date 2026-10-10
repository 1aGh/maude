// actions/menu.ts — CONTRACT §1 "the one menu" as data (V2-1.3 contract §5.9). Nodes name action
// ids; labels, keys and visibility come from the registry, so the menu cannot drift from ⌘K or
// "?". `where` paths ("Menu › File › Export…") are DERIVED from this tree, never typed by hand.
//
// PROJECT_MENU is the v2 target (Phase 4 builds the menu from it). Ids it names that the
// registry does not hold yet are the v2 actions their work packages add.

import type { ActionDef, ActionId } from './types.ts';

export type MenuNode =
  | { id: ActionId }
  | { sep: true }
  | { submenu: string; advanced?: boolean; items: MenuNode[] };

const SEP = { sep: true } as const;

export const PROJECT_MENU: readonly MenuNode[] = [
  { id: 'nav.home' },
  {
    submenu: 'File',
    items: [
      { id: 'canvas.new' },
      { id: 'project.new' },
      { id: 'project.open' },
      SEP,
      { id: 'canvas.duplicate' },
      { id: 'canvas.rename' },
      { id: 'canvas.move' },
      SEP,
      { id: 'import.figma' },
      { id: 'import.brand' },
      { id: 'video.assemble' },
      SEP,
      { id: 'export.open' },
      { id: 'handoff.open' },
      { id: 'canvas.close' },
      SEP,
      { id: 'account.switch' },
    ],
  },
  {
    submenu: 'Edit',
    items: [
      { id: 'edit.undo' },
      { id: 'edit.redo' },
      { id: 'edit.undo-history' },
      SEP,
      { id: 'edit.cut' },
      { id: 'edit.copy' },
      { id: 'edit.paste' },
      { id: 'edit.copy-properties' },
      { id: 'edit.paste-properties' },
      SEP,
      { id: 'select.all' },
      { id: 'select.none' },
      { id: 'select.all-annotations' },
      {
        submenu: 'Advanced',
        advanced: true,
        items: [
          {
            submenu: 'New artboard',
            items: [
              { id: 'artboard.new-desktop' },
              { id: 'artboard.new-laptop' },
              { id: 'artboard.new-tablet' },
              { id: 'artboard.new-mobile' },
              { id: 'artboard.new-a4' },
              { id: 'artboard.new-letter' },
            ],
          },
        ],
      },
    ],
  },
  {
    submenu: 'View',
    items: [
      { id: 'view.panels' },
      { id: 'view.comments' },
      { id: 'view.assets' },
      { id: 'view.exports' },
      { id: 'view.annotations' },
      { id: 'present.canvas' },
      SEP,
      { id: 'view.zoom-in' },
      { id: 'view.zoom-out' },
      { id: 'view.zoom-fit' },
      { id: 'view.zoom-actual' },
      {
        submenu: 'Advanced',
        advanced: true,
        items: [
          { id: 'view.layers-panel' },
          { id: 'view.inspector' },
          { id: 'view.inspector-on-select' },
          { id: 'view.timeline-keep-open' },
          { id: 'view.minimap' },
          { id: 'view.zoom-controls' },
          { id: 'view.print-guides' },
          { id: 'view.hidden-files' },
          { id: 'view.pin-panels' },
        ],
      },
    ],
  },
  {
    submenu: 'Help',
    items: [
      { id: 'help.shortcuts' },
      { id: 'help.guides' },
      { id: 'help.whats-new' },
      { id: 'help.tour' },
      { id: 'help.setup' },
      { id: 'help.intro' },
      { id: 'help.sharing' },
      { id: 'help.report-bug' },
    ],
  },
  { id: 'history.open' },
  { id: 'share.open' },
  // CONTRACT §1 lists Export… both at the top level and under File.
  { id: 'export.open' },
  {
    submenu: 'Diagnostics',
    items: [
      { id: 'diag.sync' },
      { id: 'diag.server' },
      { id: 'diag.ai' },
      { id: 'diag.logs' },
      { id: 'canvas.reload' },
      { id: 'diag.ai-recheck' },
      {
        submenu: 'Advanced',
        advanced: true,
        items: [
          { id: 'diag.address' },
          { id: 'diag.process' },
          { id: 'diag.project-folder' },
          { id: 'sync.resync' },
          { id: 'sync.download-all' },
        ],
      },
    ],
  },
  { id: 'settings.open' },
];

/** Every action id the tree names, in tree order (duplicates kept). */
export function menuIds(tree: readonly MenuNode[] = PROJECT_MENU): ActionId[] {
  const out: ActionId[] = [];
  const walk = (nodes: readonly MenuNode[]) => {
    for (const n of nodes) {
      if ('sep' in n) continue;
      if ('submenu' in n) walk(n.items);
      else out.push(n.id);
    }
  };
  walk(tree);
  return out;
}

export interface MenuPath {
  /** "Menu › File › Export…" */
  path: string;
  /** True when the path passes through an Advanced group (the "N hidden tools" count, §5.10). */
  advanced: boolean;
}

/** Every menu path an action appears at. Derived — never declared (§5.9). */
export function menuPaths(
  byId: ReadonlyMap<ActionId, ActionDef>,
  tree: readonly MenuNode[] = PROJECT_MENU
): Map<ActionId, MenuPath[]> {
  const out = new Map<ActionId, MenuPath[]>();
  const walk = (nodes: readonly MenuNode[], trail: string[], advanced: boolean) => {
    for (const n of nodes) {
      if ('sep' in n) continue;
      if ('submenu' in n) {
        walk(n.items, [...trail, n.submenu], advanced || !!n.advanced);
        continue;
      }
      const label = byId.get(n.id)?.label ?? n.id;
      const list = out.get(n.id) ?? [];
      list.push({ path: [...trail, label].join(' › '), advanced });
      out.set(n.id, list);
    }
  };
  walk(tree, ['Menu'], false);
  return out;
}
