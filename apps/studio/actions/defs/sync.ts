// actions/defs/sync.ts — the object-conflict card's three picks (S9.24, 10 · co-conflict).
//
// Row actions on ONE held conflict (a sticky both Macs changed) — hidden from ⌘K: each needs the
// conflict it acts on. The card (client/v2/sync-states/conflict-card.jsx) runs them; the server half
// is `POST /_api/sync/conflicts/resolve` (routes/sync-conflicts.ts) — one lane edit = one undo step.

import type { ActionDef, Pred } from '../types.ts';

const EDIT: Pred = { minRole: 'edit' };
const ROW = { hidden: true } as const;
const pick = (id: string, label: string, icon?: string): ActionDef => ({
  id,
  label,
  kind: 'command',
  ...(icon ? { icon } : {}),
  exec: 'shell',
  visible: EDIT,
  search: ROW,
});

export const SYNC_ACTIONS: ActionDef[] = [
  pick('sync.conflict.keep-mine', 'Keep yours'),
  // the card says "Keep <first name>'s" when the other side's author is known (CONTRACT §4 words)
  pick('sync.conflict.keep-theirs', 'Keep theirs'),
  pick('sync.conflict.keep-both', 'Keep both', 'duplicate'),
  // S11.17 (C37) — the Not saved status's Retry while a full disk holds writes (the Share cluster runs
  // it; hidden from ⌘K like the picks: it only means something while the status says Not saved).
  pick('save.retry-held', 'Retry saving'),
  // S11.12 (06 ad-syncd) — Sync details. A held SOURCE conflict (the whole canvas file, not one
  // element): `POST /_api/project/conflict { choice: mine | theirs | keep-both }`. Keep both writes
  // this Mac's version as a new canvas "<name> this Mac" (sync/keep-both.ts).
  pick('sync.keep-mine', 'Keep mine'),
  pick('sync.use-theirs', 'Use theirs'),
  pick('sync.keep-both', 'Keep both', 'duplicate'),
  // p8-held-conflict-status — the Not saved status's Compare while a held source conflict waits (and its
  // one-time toast's): Diagnostics › Sync details at that conflict, both versions side by side. It only reads
  // (`GET /_api/project/conflict`), so every role keeps it; hidden from ⌘K — it needs the conflict it opens.
  { id: 'sync.compare', label: 'Compare', kind: 'command', exec: 'shell', search: ROW },
  // the unfinished AI edit held on this Mac: `POST /_api/project/ai-action { choice }`
  pick('sync.publish-ai-edit', 'Publish'),
  pick('sync.discard-ai-edit', 'Discard'),
  // Moving now's ✕: `POST /_api/sync/cancel-assets` (the sweep stops; uploads are idempotent)
  pick('sync.cancel-transfer', 'Cancel the transfer'),
  // Get latest (moved here from Version history) and Sign in again: every role keeps them
  { id: 'sync.get-latest', label: 'Get latest', kind: 'command', exec: 'shell', search: ROW },
  { id: 'sync.sign-in-again', label: 'Sign in again', kind: 'command', exec: 'shell', search: ROW },
];
