// actions/defs/ai-runs.ts — the AI run registry's actions (S5.3, contract V2-1.15 §5.10).
//
// Row actions on a run — the "✦ N" list, the run row, the waiting card, the stopped divider — so
// they are hidden from ⌘K: each needs the run it acts on. The server half is routes/ai.ts
// (`/_api/ai/runs*`); the client rows land with S5.11 (runs UI) and S5.14 (the stopped divider).
// Desktop only: an AI run is Claude Code on this Mac (a cell refuses the routes).

import type { ActionDef, Pred } from '../types.ts';

const DESKTOP_EDIT: Pred = { shell: ['desktop'], minRole: 'edit' };
const ROW = { hidden: true } as const;

export const AI_RUN_ACTIONS: ActionDef[] = [
  {
    id: 'ai.runs.list',
    label: 'AI runs',
    kind: 'command',
    icon: 'sparkle',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    id: 'ai.stop',
    label: 'Stop',
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    id: 'ai.cancel-waiting',
    label: 'Cancel the waiting prompt',
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    id: 'ai.keep-going',
    label: 'Keep going',
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
];
