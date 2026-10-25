// editing/artboard-menu.tsx — the right-click menu of an artboard (S2.10, artboard ed-ab-menu; D6).
// It RE-ARRANGES the v1 `artboard-chrome` sections rather than replacing their closures (canvas-shell
// builds them as before; every handler and every `canvas-menu-item-<id>` testid stays), in the v2 order:
//
//   Ask AI about “<artboard name>” ⌘/   (`labelOf` names it per click; the static label stays "this artboard")
//   Duplicate ⌘D · Duplicate at another width ▸ Laptop 1280 · Tablet 834 · Mobile 390 · Custom width… · Rename
//   Copy ⌘C · Paste ⌘V   (V2-clipboard-objects, editing/clipboard.ts)
//   Export… ⇧⌘E
//   Move to trash ⌫
//
// P8 round 7: exactly the rows 14 ed-ab-menu draws ("the settled set"). The rows it does not draw left the
// menu and stay reachable elsewhere: Add comment (C, the comment tool), Start a vote… (⌘K
// `annotations.start-vote`), and the old Advanced ▸ (Fit just this artboard / Fit to view / Reset view: the
// zoom keys and the View menu; Reset position: ⌘K `artboard.reset-position`; Convert layout to absolute: ⌘K
// `layout.convert-to-absolute`; Align / Distribute: the align bar; Theme / Kind: the inspector; Open Timeline:
// the video artboard's own chrome). `artboardMenuAdvanced` still returns that list for callers that want it.
// "Duplicate at width ▸" replaces v1's "Duplicate at width…" flyout (same widths, plus Custom).
// Pure over the item structure — testable without a DOM.

import type { ContextTarget, MenuItem, MenuSection } from '../context-menu.tsx';
import { ASK_ARTBOARD_EVENT, askAboutWords } from './ask-bubble.tsx';

/** The widths the submenu offers, in the order the design draws them (the registry's web widths). */
export const DUPLICATE_WIDTHS: ReadonlyArray<{ id: string; label: string; width: number }> = [
  { id: 'laptop', label: 'Laptop', width: 1280 },
  { id: 'tablet', label: 'Tablet', width: 834 },
  { id: 'mobile', label: 'Mobile', width: 390 },
];

/** The name the right-clicked artboard wears (DCArtboard stamps it as `data-dc-label`); null when unknown. */
export function artboardNameOf(t: ContextTarget): string | null {
  const board =
    t.el?.closest?.('[data-dc-screen]') ??
    (t.artboardId && typeof document !== 'undefined'
      ? document.querySelector(`[data-dc-screen="${CSS.escape(t.artboardId)}"]`)
      : null);
  const name = board?.getAttribute('data-dc-label')?.replace(/\s+/g, ' ').trim();
  return name || null;
}

export interface ArtboardMenuDeps {
  duplicate(target: ContextTarget): void;
  duplicateAtWidth(target: ContextTarget, width: number): void;
  customWidth(target: ContextTarget): void;
  rename(target: ContextTarget): void;
  resetPosition(target: ContextTarget): void;
  /** V2-clipboard-objects — absent: no Copy / Paste rows */
  copy?(target: ContextTarget): void;
  paste?(target: ContextTarget): void;
}

/** v1 ids that move out of Advanced into the main list (relabelled) or are replaced. */
const MAIN = new Set(['add-comment', 'export-artboard', 'delete-artboard']);
const REPLACED = new Set(['duplicate-at-breakpoint']);

/** The v1 rows the drawn menu leaves out (they are reachable elsewhere — see the header). */
export function artboardMenuAdvanced(v1: MenuSection[], deps: ArtboardMenuDeps): MenuItem[] {
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
  return advanced;
}

export function artboardMenuSections(v1: MenuSection[], deps: ArtboardMenuDeps): MenuSection[] {
  const byId = new Map<string, MenuItem>();
  for (const sec of v1) for (const it of sec) byId.set(it.id, it);
  const reuse = (id: string, over: Partial<MenuItem> = {}): MenuItem[] => {
    const it = byId.get(id);
    return it ? [{ ...it, ...over }] : [];
  };
  const clip: MenuItem[] = [
    ...(deps.copy
      ? [{ id: 'copy-artboard', label: 'Copy', shortcut: '⌘C', onSelect: deps.copy } as MenuItem]
      : []),
    ...(deps.paste
      ? [{ id: 'paste-artboard', label: 'Paste', shortcut: '⌘V', onSelect: deps.paste } as MenuItem]
      : []),
  ];

  const sections: MenuSection[] = [
    [
      {
        id: 'ask-ai',
        label: 'Ask AI about this artboard',
        // 14 Editing, ed-ab-menu: Ask AI about “Desktop” (typographic quotes, the artboard's own name)
        labelOf: (t) => {
          const name = artboardNameOf(t);
          return name ? askAboutWords(name) : null;
        },
        shortcut: '⌘/',
        icon: 'spark',
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
      {
        id: 'duplicate-artboard',
        label: 'Duplicate',
        shortcut: '⌘D',
        icon: 'duplicate',
        onSelect: deps.duplicate,
      },
      {
        id: 'duplicate-at-width',
        label: 'Duplicate at another width',
        icon: 'web',
        onSelect: () => {},
        submenu: [
          ...DUPLICATE_WIDTHS.map(
            (w): MenuItem => ({
              id: `duplicate-at-${w.id}`,
              // 14: "Laptop" with the width right-aligned beside it
              label: w.label,
              shortcut: String(w.width),
              onSelect: (t) => deps.duplicateAtWidth(t, w.width),
            })
          ),
          { id: 'duplicate-at-custom', label: 'Custom width…', onSelect: deps.customWidth },
        ],
      },
      { id: 'rename-artboard', label: 'Rename', icon: 'edit', onSelect: deps.rename },
    ],
    clip,
    reuse('export-artboard', { label: 'Export…', shortcut: '⇧⌘E', icon: 'export' }),
    // 14 ed-ab-menu owns this menu and draws Move to trash as a plain row with the trash glyph and ⌫ (01's
    // `danger` variant loses to the owning board): not red, and the key it really has.
    reuse('delete-artboard', {
      label: 'Move to trash',
      shortcut: '⌫',
      icon: 'trash',
      destructive: false,
    }),
  ];
  return sections.filter((s) => s.length > 0);
}
