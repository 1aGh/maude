// actions/defs/diagnostics.ts — Menu › Diagnostics (V2-4.7b, CONTRACT §1 "Diagnostics + Advanced"):
// a status word per source (Sync · Server · AI setup), Logs, Check AI setup again, and under Advanced
// the copy-value rows (Address · Process · Project folder) plus Resync / Download all. Each runs in the
// shell through menu-runner.js → client/v2/diagnostics/diagnostics-handlers.js; none has a key
// (Reload canvas ⌘R is `canvas.reload`).

import type { ActionDef, ActionId } from '../types.ts';

// Decision v2-A6c-can-view-menu-minrole: Diagnostics is an app-level row — every role keeps it.
const row = (
  id: ActionId,
  label: string,
  rest: Pick<ActionDef, 'visible' | 'enabled'> = {}
): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'shell',
  ...rest,
});

export const DIAGNOSTICS_ACTIONS: ActionDef[] = [
  row('diag.sync', 'Sync'),
  row('diag.server', 'Server'),
  row('diag.ai', 'AI setup'),
  row('diag.logs', 'Logs'),
  // S11.11 — the Logs sheet's two buttons, also reachable from ⌘K. Copy goes to the clipboard in the
  // shell; Show in Finder is the Tauri command `diagnostics_reveal_logs` (S11.16), so it is `native`
  // and only runs where that command exists (menu-runner.js NATIVE_COMMANDS).
  row('diag.copy-logs', 'Copy logs'),
  { id: 'diag.logs-show-in-finder', label: 'Show logs in Finder', kind: 'command', exec: 'native' },
  row('diag.ai-recheck', 'Check AI setup again'),
  row('diag.address', 'Address'),
  row('diag.process', 'Process'),
  row('diag.project-folder', 'Project folder'),
  // S11.15 (06 ad-edge-where): Resync is a Can edit write (the route refuses a read-only session), and
  // both Advanced rows need the internet — offline they stay in the menu, greyed.
  row('sync.resync', 'Resync now', {
    visible: { minRole: 'edit' },
    enabled: { facts: ['online'] },
  }),
  row('sync.download-all', 'Download all', { enabled: { facts: ['online'] } }),
];
