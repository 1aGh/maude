// actions/defs/export.ts — export and handoff (V2-2.4: v1 bindings under their v2 ids).

import type { ActionDef } from '../types.ts';
import { IN_CANVAS_ANY, kb } from './_v1.ts';

export const EXPORT_ACTIONS: ActionDef[] = [
  {
    id: 'export.open',
    label: 'Export…',
    kind: 'command',
    icon: 'download',
    exec: 'shell',
    fromCanvas: true,
    keys: [kb('⇧⌘E', 'global', { inText: true })],
    legacy: { palette: 'Export…', menu: 'Export…', sheet: 'Export…' },
  },
  {
    id: 'handoff.open',
    label: 'Handoff to production',
    kind: 'command',
    icon: 'external',
    exec: 'shell',
    fromCanvas: true,
    keys: [kb('⇧⌘H', 'global', { inText: true })],
    legacy: {
      palette: 'Handoff to production',
      menu: 'Handoff to production',
      sheet: 'Handoff to production',
    },
  },
  // The canvas palette's own export dialog (export-dialog.tsx, a window listener in the iframe
  // that never checked focus). v2 (D3): ⌘E is unbound — in Phase 4, with the in-canvas dialog —
  // and ⇧⌘E is the one export sheet, so the iframe no longer binds it.
  {
    id: 'export.canvas-dialog',
    label: 'Export from the canvas',
    kind: 'command',
    exec: 'canvas',
    keys: [kb('⌘E', 'tools', { inText: true, when: IN_CANVAS_ANY })],
  },
  // "Export again" (D3, decision:maude/v2-2.8-shift-cmd-e-one-sheet). v1 bound ⇧⌘E to the iframe's
  // `rerunLast()`, which ran next to the forwarded `export.open` and silently re-submitted the
  // last export (V2-1.3 defect 2). It now lives on every Recent row of the shell's Export sheet
  // (client/dialogs/export-dialog.jsx, testid `export-recent-again-<i>`): no key, shell-side.
  // Phase 5's S8 Exports panel restyles the row.
  {
    id: 'export.rerun-last',
    label: 'Export again',
    kind: 'command',
    exec: 'shell',
    legacy: { sheet: 'Export again' },
  },
  // ── no key in v1 ──
  {
    id: 'share.open',
    label: 'Share…',
    kind: 'command',
    icon: 'share',
    exec: 'shell',
    legacy: { menu: 'Share link…' },
  },
  {
    id: 'share.copy-link',
    label: 'Copy link',
    kind: 'command',
    icon: 'link',
    exec: 'shell',
    legacy: { palette: 'Copy share link' },
  },
];
