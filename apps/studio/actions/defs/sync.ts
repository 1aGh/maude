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
];
