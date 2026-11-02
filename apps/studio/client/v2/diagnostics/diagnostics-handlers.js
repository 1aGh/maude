// client/v2/diagnostics/diagnostics-handlers.js — V2-4.7b: what the Diagnostics rows RUN.
//
// Spread into `createMenuHandlers` (shell/menu-runner.js), so a row and its ⌘K twin are the one
// function — there is no second handler. The sheet/views are the host's (diagnostics-host.jsx); a
// row here only asks for one (diagnostics-bus.js) or performs the single action it names.

import { diagnosticsFacts, openDiagnostics } from './diagnostics-bus.js';
import { logLines, logsText } from './diagnostics-model.js';
import { runResync } from './resync-run.js';
import { requestOffline } from './sync-actions.js';
import { retryHeld } from '../shell/recovery-store.js';

const noop = () => {};

// The shared notice stack (notifications.tsx pulls in sonner + React); loaded on first use so this
// module stays importable where there is no DOM (the model tests, the verbs). One promise, so the
// updates of a running notice land in the order they were sent.
let stack = null;
const notify = (notice) => {
  stack ??= import('../../../notifications.tsx');
  stack.then((m) => m.notify(notice)).catch(noop);
};

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
 * @param io test seams: `fetchFn`, `open`, `facts`, `write`, `notify`, `sleep`, `pollMs`
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

  /** S11.11 — Copy logs: every source's lines as the sheet shows them (the server already redacted). */
  const copyLogs = async () => {
    let data = null;
    try {
      const r = await (io.fetchFn ?? globalThis.fetch)('/_api/diagnostics');
      data = r.ok ? await r.json() : null;
    } catch {
      /* said below */
    }
    const text = data?.sources ? logsText(logLines(data.sources)) : '';
    if (!text) {
      toast(data ? 'There are no log lines yet.' : 'Couldn’t read the logs.');
      return;
    }
    toast((await write(text)) ? 'Logs copied.' : 'Couldn’t copy the logs.');
  };

  return {
    'diag.sync': () => open('sync'),
    // p8-held-conflict-status — the Not saved status's Compare (and its toast's): Sync details at that
    // held conflict, its two versions side by side
    'sync.compare': (p) => open('sync', { conflict: typeof p?.slug === 'string' ? p.slug : null }),
    'diag.server': () => open('server'),
    'diag.ai': () => open('ai'),
    'diag.logs': () => open('logs'),
    'diag.ai-recheck': () => open('ai', { recheck: true }),
    'diag.address': copyFact('Address', (f) => f.address),
    'diag.process': copyFact('Process number', (f) => f.pid),
    'diag.project-folder': copyFact('Project folder', (f) => f.folder),
    'diag.copy-logs': copyLogs,
    // S11.11 — one notice that goes "Resyncing…" → "Resyncing… 1 204 of 1 318" → the result.
    // (`diag.logs-show-in-finder` has no handler here: it is exec 'native' — menu-runner NATIVE_COMMANDS.)
    'sync.resync': () =>
      runResync({
        notify: io.notify ?? notify,
        fetchFn: io.fetchFn,
        sleep: io.sleep,
        pollMs: io.pollMs,
      }),
    // S11.17 — Retry while a full disk holds writes (the Not saved status's own action)
    'save.retry-held': async () => {
      const r = await retryHeld(io.fetchFn);
      if (!r) toast('Couldn’t reach Maude. Try again in a moment.');
      else if (r.held) toast("Still out of space — your changes wait here until there's room.");
      else toast(r.landed ? 'Saved.' : 'Nothing is waiting to be saved.');
    },
    'sync.download-all': async () => {
      toast('Downloading everything for offline…');
      toast(await requestOffline(io.fetchFn));
    },
  };
}
