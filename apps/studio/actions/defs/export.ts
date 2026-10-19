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
    // S8.9 (Gate 0 A19): Can view has no export at all — hidden, not greyed; the server refuses (403) anyway.
    visible: { minRole: 'comment' },
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
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    fromCanvas: true,
    // S8.9: Can comment sees Handoff, greyed with "Needs Can edit" (the sheet says the same words).
    enabled: { minRole: 'edit' },
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
    visible: { minRole: 'comment' },
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
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
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
    // S9.20: the Share sheet's Move-to-cloud offer (share/move-to-cloud.jsx) is the row; the route
    // answers only the desktop project window, so only that shell shows it.
    visible: { shell: ['desktop'], notFacts: ['linkedHub'] },
  },
  {
    // S9.20 (10 co-share-advanced): Share › Advanced › This link — who can open the link, the role
    // it gives, when it ends. The owner's; the server refuses every other session
    // (routes/share.ts), and the rows are drawn only where the hub has links (Q13).
    id: 'share.link-settings',
    label: 'Link settings…',
    kind: 'command',
    icon: 'link',
    exec: 'shell',
    visible: { minRole: 'owner', facts: ['linkedHub'] },
    search: { keywords: ['link', 'expires', 'anyone with the link', 'team only', 'turn off link'] },
  },
  // S9.19 (10 co-share-sheet · co-share-roles): who has access is the OWNER's to change. Each opens
  // the Share sheet, where the row lives (an invite needs an address, a role a person); the sheet
  // sends it through routes/share.ts to the linked hub, which decides. Hidden below owner and on a
  // project with no hub — and refused there too (test/_role-refusals.ts).
  {
    id: 'share.invite',
    label: 'Invite people…',
    kind: 'command',
    icon: 'people',
    exec: 'shell',
    visible: { minRole: 'owner', facts: ['linkedHub'] },
    search: { keywords: ['invite', 'add people', 'collaborator', 'email'] },
  },
  {
    id: 'share.set-role',
    label: 'Change what someone can do…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'owner', facts: ['linkedHub'] },
    search: {
      keywords: ['role', 'permission', 'can edit', 'can comment', 'can view', 'make owner'],
    },
  },
  {
    id: 'share.remove',
    label: 'Remove someone…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'owner', facts: ['linkedHub'] },
    search: { keywords: ['remove', 'revoke', 'access'] },
  },
  {
    id: 'share.resend',
    label: 'Resend an invite…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'owner', facts: ['linkedHub'] },
    search: { keywords: ['resend', 'invitation', 'pending'] },
  },
];
