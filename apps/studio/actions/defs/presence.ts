// actions/defs/presence.ts — who is here and where: Follow, Go to, Bring everyone here, Stop (S9.23;
// contract S9-slices.md row S9.23, canvas 10 co-presence · co-follow · co-bring · co-spotlight).
//
// All four run in the canvas iframe (the canvas owns the room's awareness), reached over the
// parent-gated `run-action` lane. Follow and Go to take a person (`params.clientID`), so they have a
// home only on a face in the Share cluster and in the people list — `search.hidden` keeps them out of
// ⌘K, where there is no one in hand. Bring everyone here has a ⌘K row ("from ⌘K or any face") and is
// owner / editor only (CONTRACT §6 [C33]): hidden below Can edit here, and the awareness field it
// publishes (`summon`) is stripped by the hub and the room for a connection without the `summon`
// capability — hidden ≠ refused (rule 12), the server holds the line. Stop ends the spotlight for
// everyone (the leader) or leaves a Follow (a follower).

import type { ActionDef, Pred } from '../types.ts';

const IN_CANVAS: Pred = { facts: ['canvasOpen'] };
const FACE = { hidden: true } as const;

export const PRESENCE_ACTIONS: ActionDef[] = [
  {
    id: 'presence.follow',
    label: 'Follow',
    kind: 'command',
    icon: 'eye',
    exec: 'canvas',
    visible: IN_CANVAS,
    search: FACE,
  },
  {
    id: 'presence.go-to',
    label: 'Go to',
    kind: 'command',
    exec: 'canvas',
    visible: IN_CANVAS,
    search: FACE,
  },
  {
    id: 'presence.bring-everyone',
    label: 'Bring everyone here',
    kind: 'command',
    icon: 'share',
    exec: 'canvas',
    visible: { minRole: 'edit', facts: ['canvasOpen'] },
    search: { keywords: ['summon', 'spotlight', 'follow me', 'gather', 'everyone', 'people'] },
  },
  {
    id: 'presence.stop',
    label: 'Stop following',
    kind: 'command',
    exec: 'canvas',
    visible: IN_CANVAS,
    search: FACE,
  },
];
