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
  // fix/207 — shared code from the project's hub: Sync details' held row and the canvas-waiting card
  // open the consent sheet; `POST /_api/sync/code-consent/set { allow }` records the answer on this
  // Mac (the window's own fetch only, Can edit).
  pick('sync.allow-code', 'Allow shared code…'),
  pick('sync.stop-code', 'Stop allowing shared code…'),
  // Issue #207 — Sync details › a long run of pictures going up: leave its folder out, or bring a
  // left-out folder back (`POST /_api/sync/settings { addIgnoreFolder | removeIgnoreFolder }`).
  pick('sync.ignore-folder', 'Don’t sync this folder'),
  pick('sync.sync-folder-again', 'Sync it again'),
  // Issue #207 (7b) — Sync details › Deleted on this Mac, held: send the held deletes to the hub as
  // one confirmed batch, or keep the files on the hub (`POST /_api/sync/held-deletes { answer }`).
  pick('sync.delete-held-on-hub', 'Move to the hub’s trash too…'),
  pick('sync.keep-held-on-hub', 'Keep on the hub'),
  // Get latest (moved here from Version history) and Sign in again: every role keeps them
  { id: 'sync.get-latest', label: 'Get latest', kind: 'command', exec: 'shell', search: ROW },
  { id: 'sync.sign-in-again', label: 'Sign in again', kind: 'command', exec: 'shell', search: ROW },
];
