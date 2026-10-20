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
const VIEW: Pred = { minRole: 'view' };
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
  // S10.6 — the Design system canvas. Both are for anyone who can open the project: opening it
  // and previewing it in Light or Dark read the canvas and write nothing.
  row('ds.open', 'Design system', VIEW),
  row('ds.set-theme-preview', 'Show the system in Light or Dark', VIEW),
  // S10.8 — the entries into the review (contracts/S10-ds-review-entry.md). All three are reached from a
  // surface that names the thing (the inspector's "Update … for every canvas…", "Go to …", the Update
  // button of an out-of-date instance), so none is a ⌘K row. The second is for anyone who can open the
  // project (it only moves the view); the other two write.
  row('ds.review-update', 'Update for every canvas…'),
  row('ds.go-to', 'Go to the design system', VIEW),
  row('ds.instance-update', 'Update to the current look'),
  // S10.7 — edit a token on the Design system canvas (13 · ds-edit-colour): the inspector's picker, value box and
  // "Dark follows automatically" switch. Each is one waiting edit (`dsPending`), never a file write; the review
  // ("Update N canvases", S10.8) is what reaches canvases. Reached from the selected token, so not ⌘K rows.
  row('ds.set-token', 'Change a token'),
  row('ds.set-dark-follows', 'Dark follows Light'),
  // S10.10 — edit a component master on the Design system canvas (13 · ds-edit-master): Corners · Fill · Text ·
  // Height from the inspector. One waiting edit per property; Update canvases (ds.publish) is what reaches canvases.
  row('ds.set-master', 'Change a component'),
  // S10.16a — making a system (13 · ds-make-*). The door (Home starter, the empty pinned row) and the direction bar
  // name the system and the direction, so none is a ⌘K row; the engine is ds/make.ts, the AI writes through the
  // verbs. Can edit on the whole project.
  row('ds.make', 'Make a design system'),
  row('ds.draft', 'Write a direction'),
  row('ds.use-direction', 'Use this direction'),
  row('ds.mix', 'Mix directions'),
  row('ds.make-done', 'Finish the design system'),
];
