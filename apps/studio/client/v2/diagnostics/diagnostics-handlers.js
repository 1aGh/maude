// client/v2/diagnostics/diagnostics-handlers.js — V2-4.7b: what the Diagnostics rows RUN.
//
// Spread into `createMenuHandlers` (shell/menu-runner.js), so a row and its ⌘K twin are the one
// function — there is no second handler. The sheet/views are the host's (diagnostics-host.jsx); a
// row here only asks for one (diagnostics-bus.js) or performs the single action it names.

import { diagnosticsFacts, openDiagnostics } from './diagnostics-bus.js';
import { requestOffline, requestResync } from './sync-actions.js';

const noop = () => {};

async function copy(text) {
  try {
    await globalThis.navigator?.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param d the shell's closures — only `toast(msg)` is used.
 * @param io test seams: `fetchFn`, `open`, `facts`, `write`
 */
export function createDiagnosticsHandlers(d, io = {}) {
  const toast = (m) => (d.toast ?? noop)(m);
  const open = io.open ?? openDiagnostics;
  const facts = io.facts ?? diagnosticsFacts;
  const write = io.write ?? copy;

  /** Advanced › Address / Process / Project folder: copy the exact value, say so. */
  const copyFact = (label, pick) => async () => {
    const value = pick(facts());
    if (value === '' || value == null) {
      toast(`${label} isn’t known here.`);
      return;
    }
    toast(
      (await write(String(value)))
        ? `${label} copied.`
        : `Couldn’t copy the ${label.toLowerCase()}.`
    );
  };

  return {
    'diag.sync': () => open('sync'),
    'diag.server': () => open('server'),
    'diag.ai': () => open('ai'),
    'diag.logs': () => open('logs'),
    'diag.ai-recheck': () => open('ai', { recheck: true }),
    'diag.address': copyFact('Address', (f) => f.address),
    'diag.process': copyFact('Process number', (f) => f.pid),
    'diag.project-folder': copyFact('Project folder', (f) => f.folder),
    'sync.resync': async () => {
      toast('Resyncing…');
      const { note } = await requestResync(io.fetchFn);
      if (note) toast(note);
    },
    'sync.download-all': async () => {
      toast('Downloading everything for offline…');
      toast(await requestOffline(io.fetchFn));
    },
  };
}
