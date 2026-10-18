// editing/object-menu.tsx — the right-click menu of an object in Edit mode (S2.6, artboard
// ed-obj-order; inventory §B). It RE-ARRANGES the v1 element menu rather than replacing its closures:
// canvas-shell builds the v1 sections as before (every handler stays where it was, every
// `canvas-menu-item-<id>` testid stays), and `objectMenuSections` lays them out in the v2 order:
//
//   Duplicate ⌘D · Copy properties ⌥⌘C · Paste properties ⌥⌘V · Select matching
//   Frame selection ⌥⌘G · Remove frame ⇧⌘G (greyed when it does not apply)
//   Bring to front ⌘] · Bring forward ] · Send backward [ · Send to back ⌘[
//   Lock ⇧⌘L (Unlock) · Hide (Show)
//   Advanced ▸  Add comment · Inspect · Select layer ▸ · Insert ▸ · Replace image… · Edit Photo… ·
//               Convert children to absolute position · Copy CSS · Copy data-cd-id ·
//               Export selection… · Deselect
//   Remove ⌫
//
// "Nothing deleted": every v1 row is either in the main list or under Advanced ▸ (D6). Ask AI ⌘/ and
// Cut / Copy / Paste of objects are the first section's rows once S2.19 / an object clipboard exist;
// they are not faked here. Pure over the item structure — testable without a DOM.

import type { ContextTarget, MenuItem, MenuSection } from '../context-menu.tsx';
import type { ObjectOpAction } from './object-ops.ts';

export interface ObjectMenuDeps {
  /** The elements the menu acts on: the whole selection when `target` is part of it, else `target`. */
  elementsFor(target: ContextTarget): Element[];
  run(action: ObjectOpAction, target: ContextTarget): void;
  selectMatching(target: ContextTarget): void;
}

/** v1 ids that move into the v2 main list (relabelled); everything else goes under Advanced ▸. */
const MAIN = new Set(['duplicate-element', 'copy-style', 'paste-style', 'delete-element', 'hide']);

// ── what the rows say about the selection ─────────────────────────────────────────────────────

export interface ObjectState {
  locked: boolean;
  hidden: boolean;
  canUnframe: boolean;
}

/** A frame the server will unframe: a plain element (not a component) holding only objects. */
export function isUnframable(el: Element): boolean {
  if (el.hasAttribute('data-dc-component') || el.hasAttribute('data-dc-screen')) return false;
  if (!el.hasAttribute('data-cd-id') || el.children.length === 0) return false;
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 1) continue;
    if (n.nodeType === 3 && !(n.textContent ?? '').trim()) continue;
    return false;
  }
  return true;
}

export function objectState(els: readonly Element[]): ObjectState {
  const some = els.length > 0;
  return {
    locked: some && els.every((e) => e.hasAttribute('data-cd-locked')),
    hidden: some && els.every((e) => e.hasAttribute('data-cd-hidden')),
    canUnframe: some && els.every(isUnframable),
  };
}

// ── the layout ────────────────────────────────────────────────────────────────────────────────

export function objectMenuSections(v1: MenuSection[], deps: ObjectMenuDeps): MenuSection[] {
  const byId = new Map<string, MenuItem>();
  for (const sec of v1) for (const it of sec) byId.set(it.id, it);
  const state = (t: ContextTarget) => objectState(deps.elementsFor(t));
  const act =
    (action: ObjectOpAction) =>
    (t: ContextTarget): void =>
      deps.run(action, t);
  const row = (
    id: string,
    label: string,
    action: ObjectOpAction,
    shortcut?: string,
    extra: Partial<MenuItem> = {}
  ): MenuItem => ({
    id,
    label,
    ...(shortcut ? { shortcut } : {}),
    onSelect: act(action),
    ...extra,
  });
  /** v1 item `id` with a new label / shortcut, its handler untouched */
  const reuse = (id: string, over: Partial<MenuItem>): MenuItem[] => {
    const it = byId.get(id);
    return it ? [{ ...it, ...over }] : [];
  };

  const advanced: MenuItem[] = [];
  for (const sec of v1) {
    for (const it of sec) {
      if (MAIN.has(it.id)) continue;
      advanced.push(it);
    }
  }
  const dedup = (items: MenuItem[]): MenuItem[] => {
    const seen = new Set<string>();
    return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  };

  const sections: MenuSection[] = [
    [
      ...reuse('duplicate-element', { label: 'Duplicate', shortcut: '⌘D' }),
      ...reuse('copy-style', { label: 'Copy properties', shortcut: '⌥⌘C' }),
      ...reuse('paste-style', { label: 'Paste properties', shortcut: '⌥⌘V' }),
      {
        id: 'select-matching',
        label: 'Select matching',
        onSelect: (t) => deps.selectMatching(t),
      },
    ],
    [
      row('frame', 'Frame selection', 'object.frame', '⌥⌘G'),
      row('unframe', 'Remove frame', 'object.unframe', '⇧⌘G', {
        disabled: (t) => !state(t).canUnframe,
        disabledHint: 'Select a frame of objects',
      }),
    ],
    [
      row('bring-front', 'Bring to front', 'object.bring-front', '⌘]'),
      row('bring-forward', 'Bring forward', 'object.bring-forward', ']'),
      row('send-backward', 'Send backward', 'object.send-backward', '['),
      row('send-back', 'Send to back', 'object.send-back', '⌘['),
    ],
    [
      row('lock', 'Lock', 'object.lock', '⇧⌘L', { hidden: (t) => state(t).locked }),
      row('unlock', 'Unlock', 'object.lock', '⇧⌘L', { hidden: (t) => !state(t).locked }),
      row('hide', 'Hide', 'object.hide', undefined, { hidden: (t) => state(t).hidden }),
      row('show', 'Show', 'object.hide', undefined, { hidden: (t) => !state(t).hidden }),
    ],
    [
      {
        id: 'advanced',
        label: 'Advanced',
        onSelect: () => {},
        submenu: dedup(advanced),
      },
    ],
    [...reuse('delete-element', { label: 'Remove', shortcut: '⌫' })],
  ];
  return sections.filter((s) => s.length > 0);
}
