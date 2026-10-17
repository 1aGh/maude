// client/v2/search/moved-keys.js — V2-4.6: "Keys and tools that moved" (CONTRACT §2, rule 13).
//
// What the "?" sheet's Advanced fold lists, old → new. Derived from CONTRACT §2's moved list and the
// ten rows 06 ad-search draws. A row names its new home in words; where the new home is a registry
// action (`to`), the key in `now` is `{key}` and is read from the registry when the sheet draws —
// so V2-4.5b's re-binding (and any later one) cannot make this table lie.
//
// The registry's own `MOVED_KEYS` (actions/help.ts, append-only, lands with the commit that removes
// a binding) is merged in by `movedKeys()`: a row there wins over a row here with the same `was`.

import { MOVED_KEYS } from '../../../actions/help.ts';

/** @type {readonly { was: string, now: string, to?: string }[]} */
export const MOVED_LOCAL = Object.freeze([
  // — drawn in 06 ad-search —
  { was: 'Changes ⇧⌘G', now: 'Version history {key}', to: 'history.open' },
  { was: 'Assistant ⇧⌘A', now: 'Ask AI {key} — ⇧⌘A now selects all annotations', to: 'ai.chat' },
  { was: 'Files tree T', now: 'Hide panels {key} — T is Text', to: 'view.panels' },
  { was: 'Hidden files H', now: 'Canvases › Advanced — H is Hand' },
  { was: 'Design system S', now: '⌘K “design system” — S is Section' },
  { was: 'New board N', now: 'New canvas {key} — N is Sticky, in Preview', to: 'canvas.new' },
  { was: 'Search / and ⌘F', now: '{key}', to: 'search.open' },
  {
    was: 'Arrow, Highlighter',
    now: 'Preview’s toolbar — Arrow A; Highlighter is Marker’s second tip',
  },
  { was: 'Section, Eraser', now: 'Preview’s toolbar — Section S; Eraser is a Marker option' },
  { was: 'Insert', now: 'Edit’s toolbar — Image I · Component ⇧I' },
  // — CONTRACT §2 —
  { was: 'Browse tool', now: 'Preview mode — Hand + click uses the design' },
  { was: 'Pen B', now: 'Pen P' },
  { was: 'Rect R', now: 'Shape R' },
  { was: 'Ellipse O', now: 'Edit › More › Ellipse' },
  { was: 'Section ⇧S', now: 'Section S' },
  { was: 'Export ⌘E', now: 'Export… {key} — ⌘E is unbound', to: 'export.open' },
  { was: 'Refresh tree ⇧⌘R', now: 'Canvases › Advanced and ⌘K — the key stays' },
  { was: 'Toggle theme', now: '⌘K “Theme” and Settings › General' },
  { was: 'New video…', now: '⌘K “New video” and New artboard › Video' },
  { was: 'Actual size ⌘1', now: 'Actual size {key} — ⌘1–9 pick a tab', to: 'view.zoom-actual' },
]);

/**
 * The fold's rows, ready to draw: `{ was, now }` with `{key}` already replaced by the registry's
 * primary key for `to` (or removed, with its separator space, when the action has none yet).
 * @param keyOf (actionId) => string — the live primary key, '' when none
 */
export function movedKeys(keyOf = () => '', { local = MOVED_LOCAL, registry = MOVED_KEYS } = {}) {
  const fromRegistry = registry.map((m) => ({
    was: m.was,
    now: m.note ? `${m.now} — ${m.note}` : m.now,
    to: m.to,
  }));
  const wanted = new Set(fromRegistry.map((r) => r.was));
  return [...fromRegistry, ...local.filter((r) => !wanted.has(r.was))].map((r) => {
    const key = r.to ? keyOf(r.to) : '';
    const now = r.now
      .replace(/\s*\{key\}/, key ? ` ${key}` : '')
      .replace(/^\s+/, '')
      .replace(/\s+—\s+—/, ' —');
    return { was: r.was, now };
  });
}
