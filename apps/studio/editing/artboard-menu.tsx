// editing/artboard-menu.tsx — the right-click menu of an artboard (S2.10, artboard ed-ab-menu; D6).
// It RE-ARRANGES the v1 `artboard-chrome` sections rather than replacing their closures (canvas-shell
// builds them as before; every handler and every `canvas-menu-item-<id>` testid stays), in the v2 order:
//
//   Ask AI about this artboard ⌘/   (a menu label is static, so it says "this artboard", not its name)
//   Duplicate ⌘D · Duplicate at another width ▸ Laptop 1280 · Tablet 834 · Mobile 390 · Custom width… · Rename
//   Add comment
//   Export… ⇧⌘E
//   Advanced ▸  Fit just this artboard · Reset position · Convert layout to absolute… · Open Timeline ·
//               Fit to view · Reset view · Align… · Distribute… · Theme ▸ · Kind ▸
//   Move to trash ⌫
//
// "Nothing deleted": every v1 row is either in the main list or under Advanced ▸; "Duplicate at width ▸"
// replaces v1's "Duplicate at width…" flyout (same widths, plus Custom). Copy / Paste of an artboard are
// drawn in the design but need an artboard clipboard that does not exist yet — not faked here.
// Pure over the item structure — testable without a DOM.

import type { ContextTarget, MenuItem, MenuSection } from '../context-menu.tsx';
import { ASK_ARTBOARD_EVENT } from './ask-bubble.tsx';

/** The widths the submenu offers, in the order the design draws them (the registry's web widths). */
export const DUPLICATE_WIDTHS: ReadonlyArray<{ id: string; label: string; width: number }> = [
  { id: 'laptop', label: 'Laptop', width: 1280 },
  { id: 'tablet', label: 'Tablet', width: 834 },
  { id: 'mobile', label: 'Mobile', width: 390 },
];

export interface ArtboardMenuDeps {
  duplicate(target: ContextTarget): void;
  duplicateAtWidth(target: ContextTarget, width: number): void;
  customWidth(target: ContextTarget): void;
  rename(target: ContextTarget): void;
  resetPosition(target: ContextTarget): void;
}

/** v1 ids that move out of Advanced into the main list (relabelled) or are replaced. */
const MAIN = new Set(['add-comment', 'export-artboard', 'delete-artboard']);
const REPLACED = new Set(['duplicate-at-breakpoint']);

export function artboardMenuSections(v1: MenuSection[], deps: ArtboardMenuDeps): MenuSection[] {
  const byId = new Map<string, MenuItem>();
  for (const sec of v1) for (const it of sec) byId.set(it.id, it);
  const reuse = (id: string, over: Partial<MenuItem> = {}): MenuItem[] => {
    const it = byId.get(id);
    return it ? [{ ...it, ...over }] : [];
  };

  const advanced: MenuItem[] = [];
  const reset: MenuItem = {
    id: 'reset-position',
    label: 'Reset position',
    onSelect: (t) => deps.resetPosition(t),
  };
  for (const sec of v1) {
    for (const it of sec) {
      if (MAIN.has(it.id) || REPLACED.has(it.id)) continue;
      advanced.push(it);
      // Reset position sits right after "Fit just this artboard", as the two rows were named together
      if (it.id === 'fit-one') advanced.push(reset);
    }
  }
  if (!advanced.includes(reset)) advanced.unshift(reset);

  const sections: MenuSection[] = [
    [
      {
        id: 'ask-ai',
        label: 'Ask AI about this artboard',
        shortcut: '⌘/',
        // S2.21 — the same bubble ⌘/ on a selection opens (ask-bubble.tsx), scoped to this artboard.
        onSelect: (t) => {
          if (t.artboardId)
            window.dispatchEvent(
              new CustomEvent(ASK_ARTBOARD_EVENT, { detail: { artboardId: t.artboardId } })
            );
        },
      },
    ],
    [
      { id: 'duplicate-artboard', label: 'Duplicate', shortcut: '⌘D', onSelect: deps.duplicate },
      {
        id: 'duplicate-at-width',
        label: 'Duplicate at another width',
        onSelect: () => {},
        submenu: [
          ...DUPLICATE_WIDTHS.map(
            (w): MenuItem => ({
              id: `duplicate-at-${w.id}`,
              label: `${w.label} — ${w.width}`,
              onSelect: (t) => deps.duplicateAtWidth(t, w.width),
            })
          ),
          { id: 'duplicate-at-custom', label: 'Custom width…', onSelect: deps.customWidth },
        ],
      },
      { id: 'rename-artboard', label: 'Rename', onSelect: deps.rename },
    ],
    reuse('add-comment'),
    reuse('export-artboard', { label: 'Export…', shortcut: '⇧⌘E' }),
    [{ id: 'advanced', label: 'Advanced', onSelect: () => {}, submenu: advanced }],
    reuse('delete-artboard', { label: 'Move to trash' }),
  ];
  return sections.filter((s) => s.length > 0);
}
