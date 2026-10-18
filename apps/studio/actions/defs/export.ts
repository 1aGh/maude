// actions/defs/export.ts — export and handoff (V2-2.4: v1 bindings under their v2 ids).

import type { ActionDef } from '../types.ts';
import { kb } from './_v1.ts';

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
    // S8.8 (09 Export › ex-inspector): the quickest export skips the sheet — what is selected, rendered as a PNG
    // and put on the clipboard, to paste into a chat or a post. Shell-side (it needs the clipboard and a render),
    // reachable from the canvas iframe (the chord is forwarded). Can view has no export at all (hidden, not greyed:
    // there is no key to swallow with a denial line — the server refuses the render anyway).
    id: 'export.copy-png',
    label: 'Copy as PNG',
    kind: 'command',
    icon: 'image',
    exec: 'shell',
    fromCanvas: true,
    visible: { minRole: 'comment' },
    enabled: { facts: ['canvasOpen'] },
    keys: [
      kb('⇧⌘C', 'selection', {
        inText: false,
        when: { selection: ['artboard', 'object', 'video-artboard', 'generated-image'] },
      }),
    ],
    search: { keywords: ['clipboard', 'image', 'paste', 'png'] },
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
