// client/v2/shell/native-doors.js — S11.16: the page side of the desktop app's native doors
// (apps/desktop/src-tauri/src/doors.rs) and the crash notice (lifecycle.rs).
//
//   revealPath(rel)   → `project_reveal_path`    Finder opens the folder with the file selected
//   openInEditor(rel) → `project_open_in_editor` $VISUAL / $EDITOR / the default text editor
//   revealLogs()      → `diagnostics_reveal_logs` the diagnostics log folder
//   takeCrashNotice() → `take_crash_notice`      `{ kind: 'app://crashed', startedAt }` once, after an
//                                                 unclean exit, for a tab the relaunch reopened
//
// `rel` is PROJECT-relative (`.design/ui/Pricing.tsx`) — `projectRel(designRel, canvasPath)` builds it
// from a designRoot-relative canvas path. Rust is the gate (caller = this project's tab in front;
// `..`, absolute paths and symlinks out of the root refused); the checks here only spare a round trip.
// In a browser tab there is no shell: `available` is false and every door answers
// `{ ok: false, reason: 'browser' }` — callers hide the row or say "Open in the Mac app".
//
// Pure but for `window.__TAURI__`, which `nativeDoors(win)` reads; `invoke` can be injected.

/** Registry ids → the Tauri command each one runs (exec 'native'). */
export const DOOR_COMMANDS = Object.freeze({
  'canvas.reveal-in-finder': 'project_reveal_path',
  'canvas.open-in-editor': 'project_open_in_editor',
  'diag.logs-show-in-finder': 'diagnostics_reveal_logs',
});

export const CRASHED_KIND = 'app://crashed';

/** A project-relative path the shell can take: relative, no `..`, no NUL, no drive / backslash root. */
export function isProjectRel(rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return false;
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)) return false;
  return !rel.split(/[\\/]/).includes('..');
}

/** `.design` + `ui/Pricing.tsx` → `.design/ui/Pricing.tsx` (slashes trimmed, never doubled). */
export function projectRel(designRel, canvasPath) {
  const d = String(designRel ?? '').replace(/^\/+|\/+$/g, '');
  const p = String(canvasPath ?? '').replace(/^\/+/, '');
  return d ? `${d}/${p}` : p;
}

function invokeOf(win) {
  const t = win?.__TAURI__;
  return t?.core?.invoke ? (cmd, args) => t.core.invoke(cmd, args) : null;
}

async function call(invoke, cmd, args) {
  if (!invoke) return { ok: false, reason: 'browser' };
  try {
    await invoke(cmd, args);
    return { ok: true };
  } catch (e) {
    // Rust answers in words ("That file isn't in this project.", "Switch to this tab first.").
    return {
      ok: false,
      reason: 'refused',
      error: typeof e === 'string' ? e : String(e?.message ?? e),
    };
  }
}

const NOT_IN_PROJECT = "That file isn't in this project.";

/**
 * The doors for this page. `opts.invoke` overrides the Tauri global (tests).
 * @returns {{ available: boolean, revealPath(rel: string), openInEditor(rel: string), revealLogs(),
 *   takeCrashNotice(): Promise<{kind: string, startedAt: number|null}|null>, run(id: string, rel?: string) }}
 */
export function nativeDoors(win = typeof window !== 'undefined' ? window : null, opts = {}) {
  const invoke = opts.invoke ?? invokeOf(win);
  const withRel = (cmd) => (rel) =>
    isProjectRel(rel)
      ? call(invoke, cmd, { rel })
      : Promise.resolve(
          invoke
            ? { ok: false, reason: 'refused', error: NOT_IN_PROJECT }
            : { ok: false, reason: 'browser' }
        );
  const doors = {
    available: !!invoke,
    revealPath: withRel(DOOR_COMMANDS['canvas.reveal-in-finder']),
    openInEditor: withRel(DOOR_COMMANDS['canvas.open-in-editor']),
    revealLogs: () => call(invoke, DOOR_COMMANDS['diag.logs-show-in-finder'], {}),
    async takeCrashNotice() {
      if (!invoke) return null;
      try {
        const n = await invoke('take_crash_notice', {});
        return n && n.kind === CRASHED_KIND ? n : null;
      } catch {
        return null; // refused (off its origin) or an older shell: no notice
      }
    },
    /** Run a registry id (exec 'native'); `rel` for the two path doors. */
    run(id, rel) {
      if (id === 'canvas.reveal-in-finder') return doors.revealPath(rel);
      if (id === 'canvas.open-in-editor') return doors.openInEditor(rel);
      if (id === 'diag.logs-show-in-finder') return doors.revealLogs();
      return Promise.resolve({ ok: false, reason: 'unknown' });
    },
  };
  return doors;
}

let crashTaken = null;

/**
 * Hear `app://crashed` once per page: asks the shell when first called and hands the notice to
 * `handler` (later callers get the same answer, the shell is asked once). Resolves to the notice or
 * null.
 */
export function onCrashed(handler, win, opts) {
  if (!crashTaken) crashTaken = nativeDoors(win, opts).takeCrashNotice();
  return crashTaken.then((n) => {
    if (n && typeof handler === 'function') handler(n);
    return n;
  });
}

/** Tests only: forget the page's one ask. */
export function resetCrashNoticeForTest() {
  crashTaken = null;
}
