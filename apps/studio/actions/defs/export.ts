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
  // last export (V2-1.3 defect 2). It lives on every row of the Exports panel (S8.4,
  // client/v2/export/job-row.jsx, testid `export-job-again-<id>`) and on every Recent row of the
  // Export sheet (`export-recent-again-<i>`): no key, shell-side.
  {
    id: 'export.rerun-last',
    label: 'Export again',
    kind: 'command',
    exec: 'shell',
    legacy: { sheet: 'Export again' },
  },
  // S8.4 — "Retry <name>" on a partly done export ("Exported 114 of 115"): runs only the items that
  // did not make it, through POST /_api/export-jobs/retry (the export class, the owner's jobs only).
  // A row action, so it is hidden from ⌘K: it needs the job it acts on.
  {
    id: 'export.retry',
    label: 'Retry',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'comment' },
    search: { hidden: true },
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
  {
    // S6.0c — CONTRACT §6: a local project's "Move to cloud…" lives inside the Share sheet (S9.20
    // builds it). `POST /_api/cloud/move` answers only the Maude window's own fetch; the AI never
    // starts it (decision:maude/v2-lead-cloud-move-window-only). A linked project has moved already.
    id: 'share.move-to-cloud',
    label: 'Move to cloud…',
    kind: 'command',
    exec: 'shell',
    // A6b-2 lead patch: S9.20 (the Share sheet's Move-to-cloud row) is not built yet, so no shell
    // shows this action; S9.20 restores `shell: ['desktop']` when it mounts the row.
    visible: { shell: [], notFacts: ['linkedHub'] },
  },
];
