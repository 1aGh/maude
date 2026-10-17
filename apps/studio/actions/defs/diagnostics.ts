// actions/defs/diagnostics.ts — Menu › Diagnostics (V2-4.7b, CONTRACT §1 "Diagnostics + Advanced"):
// a status word per source (Sync · Server · AI setup), Logs, Check AI setup again, and under Advanced
// the copy-value rows (Address · Process · Project folder) plus Resync / Download all. Each runs in the
// shell through menu-runner.js → client/v2/diagnostics/diagnostics-handlers.js; none has a key
// (Reload canvas ⌘R is `canvas.reload`).

import type { ActionDef, ActionId } from '../types.ts';

const row = (id: ActionId, label: string): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'shell',
});

export const DIAGNOSTICS_ACTIONS: ActionDef[] = [
  row('diag.sync', 'Sync'),
  row('diag.server', 'Server'),
  row('diag.ai', 'AI setup'),
  row('diag.logs', 'Logs'),
  row('diag.ai-recheck', 'Check AI setup again'),
  row('diag.address', 'Address'),
  row('diag.process', 'Process'),
  row('diag.project-folder', 'Project folder'),
  row('sync.resync', 'Resync now'),
  row('sync.download-all', 'Download all'),
];
