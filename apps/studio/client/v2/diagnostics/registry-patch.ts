// client/v2/diagnostics/registry-patch.ts — V2-4.7b: the registry rows for Menu › Diagnostics.
//
// NOT WIRED. The registry (apps/studio/actions/**) is the lead's file, so this is the patch as code:
//   1. move `DIAG_ACTIONS` to actions/defs/diagnostics.ts and spread it into `ALL` in actions/index.ts;
//   2. spread `DIAG_AGENT_PATHS` into `AGENT_PATHS` in actions/agents.ts (rule 14: a new action lands
//      with its AI path in the same change);
//   3. empty `PENDING_MENU_IDS` of the ten ids below (client/v2/shell/project-menu-model.js) and drop the
//      two `diag.logs` / `sync.resync` lines of test/project-menu-model.test.ts;
//   4. regenerate the manifests (scripts/gen-actions.mjs).
// test/v2-diagnostics-menu.test.tsx registers this file's defs into the in-process registry for its
// own run (and takes them out again), so it is green before AND after the patch lands.
//
// The ten ids are the ones PROJECT_MENU (actions/menu.ts) names under Diagnostics. Each runs through
// menu-runner.js → diagnostics-handlers.js; none has a key (CONTRACT §1 gives Reload canvas ⌘R, which
// is `canvas.reload`, already registered).

import type { ActionDef, ActionDefAI, ActionId } from '../../../actions/types.ts';

const row = (id: ActionId, label: string): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'shell',
});

export const DIAG_ACTIONS: ActionDef[] = [
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

const PREF = (note: string): ActionDefAI => ({
  effect: 'none',
  agent: { path: 'human', because: 'view-pref', note },
});

export const DIAG_AGENT_PATHS: Record<string, ActionDefAI> = {
  'diag.sync': { effect: 'none', agent: { path: 'cli', verb: 'maude design status' } },
  'diag.server': { effect: 'none', agent: { path: 'cli', verb: 'maude design status' } },
  'diag.ai': { effect: 'none', agent: { path: 'cli', verb: 'maude design preflight' } },
  'diag.ai-recheck': { effect: 'none', agent: { path: 'cli', verb: 'maude design preflight' } },
  'diag.logs': PREF('opens the log sheet; the files sit in ~/.maude/logs'),
  'diag.address': PREF('copies a value the agent already has from `maude design status`'),
  'diag.process': PREF('copies a value the agent already has from `maude design status`'),
  'diag.project-folder': PREF('copies the project path the agent already works in'),
  'sync.resync': {
    effect: 'shared',
    agent: {
      path: 'human',
      because: 'hub-link',
      note: 'restarts the sync link; read its state with `maude design status`',
    },
  },
  'sync.download-all': {
    effect: 'none',
    agent: {
      path: 'human',
      because: 'hub-link',
      note: 'pulls every file of a linked project onto this Mac',
    },
  },
};
