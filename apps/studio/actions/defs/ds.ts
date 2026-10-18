// actions/defs/ds.ts — the design-system review actions (S10.2, contract V2-1.6 §5.11, S10 §2.1).
//
// Row and sheet actions of a CONVERTED system: the "Update N canvases" review, the outside-change
// review (Keep · Undo), the conflict pick, a canvas's update / leave, and the token trash. Each acts
// on a system, a token or a canvas the surface names, so they are hidden from ⌘K. The engine is
// ds/engine.ts; the routes (`/_api/ds/*`) and the `maude design ds …` verbs are S10.3's
// (agents.ts names the verb each row's agent path is). Permissions (S10 Q15): Can edit on the whole
// project; clearing a token out of the trash is the owner's.

import type { ActionDef, Pred } from '../types.ts';

const EDIT: Pred = { minRole: 'edit' };
const OWNER: Pred = { minRole: 'owner' };
const ROW = { hidden: true } as const;

const row = (id: string, label: string, visible: Pred = EDIT): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'shell',
  visible,
  search: ROW,
});

export const DS_ACTIONS: ActionDef[] = [
  row('ds.publish', 'Update canvases'),
  row('ds.cancel-pending', 'Cancel'),
  row('ds.keep-outside', 'Keep'),
  row('ds.undo-outside', 'Undo'),
  row('ds.pick', 'Use this'),
  row('ds.canvas-update', 'Update'),
  row('ds.canvas-leave', 'Keep this version'),
  row('ds.trash-token', 'Move to Trash'),
  row('ds.restore-token', 'Restore'),
  row('ds.clear-token', 'Clear out', OWNER),
];
