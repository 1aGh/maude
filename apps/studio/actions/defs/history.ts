// Version history — the panel's row actions (V2-1.9 §5.11 registry; S1.12b). `history.open`
// (⌥⌘H) lives in view.ts. Each of these needs the panel and a row, so they are hidden from ⌘K;
// the panel itself lands with S1.14. The server half is routes/history.ts
// (`/_api/project/versions|changes|name`), which refuses on its own whatever the panel drew.

import type { ActionDef } from '../types.ts';

const ROW = { hidden: true } as const;

export const HISTORY_ACTIONS: ActionDef[] = [
  {
    // All · Named · Made by AI · People (§5.1)
    id: 'history.filter',
    label: 'Filter versions',
    kind: 'command',
    exec: 'shell',
    search: ROW,
  },
  {
    // a row click: the canvas shows that version, read-only ("Viewing …", §5.6)
    id: 'history.view-version',
    label: 'View this version',
    kind: 'command',
    exec: 'shell',
    search: ROW,
  },
  {
    id: 'history.compare',
    label: 'Compare',
    kind: 'command',
    exec: 'shell',
    search: ROW,
  },
  {
    // Version history › Advanced › "Compare pictures": today's DiffView (S1.15; the words live in Compare)
    id: 'history.compare-pictures',
    label: 'Compare pictures',
    kind: 'command',
    exec: 'shell',
    search: ROW,
  },
  {
    // the Now row's "Name this version…" (§5.4)
    id: 'history.name',
    label: 'Name this version…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  // S1.13 — restores (§5.8): each lands as a NEW version, one undo step (the toast's Undo / ⌘Z).
  // The server half is POST /_api/project/restore, which refuses every role below edit itself.
  {
    // "Restore this version" — the whole canvas
    id: 'history.restore',
    label: 'Restore this version',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    // Compare › "Restore only <artboard>"
    id: 'history.restore-artboard',
    label: 'Restore only this artboard',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    // an object-history row's Restore
    id: 'history.restore-object',
    label: 'Restore this object',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    // the render-error card's "Go back to 14:05" (C5)
    id: 'history.go-back',
    label: 'Go back to the last good version',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  // S11.10 — Version history › Advanced, the git in plain words (06 · ad-history). Each is a button in the fold
  // (client/v2/history/git-advanced.jsx) and calls one `/_api/git/*` route, unchanged; the fold is hidden for
  // Can comment / Can view and the server refuses every write below edit whatever is drawn.
  {
    id: 'history.branch-switch',
    label: 'Switch branch',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    id: 'history.new-branch',
    label: 'New branch…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    // a fetch moves remote refs only: the role matrix allows it for a viewer, so no `minRole` here (the fold hides it)
    id: 'history.fetch',
    label: 'Fetch',
    kind: 'command',
    exec: 'shell',
    search: ROW,
  },
  {
    id: 'history.publish',
    label: 'Publish',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    id: 'history.save-with-note',
    label: 'Save a version with a note…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    id: 'history.open-pr',
    label: 'Add to main · opens a pull request',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    id: 'history.discard-file',
    label: 'Discard changes to a file',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    // "Drafts › Continue": back to the branch you were working on
    id: 'history.continue-draft',
    label: 'Continue on your draft',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
  {
    // a row's Undo on a change of yours (V2-1.5 §5.3); the teammate's later edits are kept
    id: 'history.undo-action',
    label: 'Undo this change',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: ROW,
  },
];
