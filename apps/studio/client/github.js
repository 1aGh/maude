// client/github.js — thin bridge from the React client to (a) the Tauri shell's
// GitHub commands and (b) the dev-server's /_api/github/* endpoints. Phase 28 (E3).
//
// Sign-in / sign-out / keychain live in the Tauri shell (oauth.rs / keychain.rs),
// reached via `window.__TAURI__` (withGlobalTauri). The profile + create-repo +
// invite + repos go through the dev-server endpoints (which read the token from
// the loopback bridge). In a plain browser (no Tauri) `isNativeApp()` is false and
// the IdentityBar shows the "open the desktop app" state instead of sign-in.

export function isNativeApp() {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

function tauri() {
  const t = typeof window !== 'undefined' ? window.__TAURI__ : null;
  if (!t) throw new Error('GitHub sign-in is only available in the Maude desktop app.');
  return t;
}

/** Invoke a Tauri command (throws outside the app). */
export function invoke(cmd, args) {
  return tauri().core.invoke(cmd, args);
}

/** Subscribe to a Tauri event; resolves to an async unlisten fn. */
export function listen(event, handler) {
  return tauri().event.listen(event, (e) => handler(e.payload));
}

// ── Tauri shell commands ──────────────────────────────────────────────────────
/** Run the device flow; resolves to the login (public handle) on success. */
export const signIn = () => invoke('github_sign_in');
export const signOut = () => invoke('github_sign_out');
/** Whether a token is in the keychain (boolean). Safe to call on launch. */
export const isSignedIn = () => invoke('github_is_signed_in');
export const openVerification = () =>
  invoke('github_open_verification', { url: 'https://github.com/login/device' });
/** Open a github.com URL (PR link, repo page) in the OS browser. Native only; the
 *  Rust side host-locks it to github.com. Throws on an older desktop build without
 *  the command — callers fall back to copy-to-clipboard. */
export const openGitHubUrl = (url) => invoke('open_github_url', { url });
/** Open a Maude Cloud URL (device activation, share view, dashboard) in the OS
 *  browser. Native only — `window.open` is a silent no-op in WKWebView, which is
 *  what stranded people mid-sign-in. The Rust side zone-locks it against the
 *  address it resolves per call, so this argument can't widen where it goes.
 *  Throws on an older desktop build without the command — every caller must keep
 *  a visible link the person can use by hand. */
export const openCloudUrl = (url) => invoke('open_cloud_url', { url });
/** Show the device code as soon as the shell has it. Returns an unlisten promise. */
export const onDeviceCode = (cb) => listen('github://device-code', cb);
/** Fire when sign-in completes (any surface) so other surfaces can flip live. cb(login). */
export const onSignedIn = (cb) => listen('github://signed-in', cb);
/** Fire when the native File ▸ New Project… menu item is chosen. Returns an unlisten promise. */
export const onMenuNewProject = (cb) => listen('menu://new-project', cb);
/** Fire when the native Help ▸ Report a Bug… menu item is chosen. Returns an unlisten promise. */
export const onMenuReportBug = (cb) => listen('menu://report-bug', cb);

// ── dev-server endpoints ────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { ...opts, headers });
  } catch {
    return { ok: false, status: 0, json: { error: 'Maude isn’t reachable right now.' } };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

export const fetchIdentity = () => api('/_api/github/identity');
export const listRepos = () => api('/_api/github/repos');
export const createRepo = (body) => api('/_api/github/create-repo', { method: 'POST', body: JSON.stringify(body) });
export const invite = (username) => api('/_api/github/invite', { method: 'POST', body: JSON.stringify({ username }) });
export const cloneRepo = (body) => api('/_api/github/clone', { method: 'POST', body: JSON.stringify(body) });
export const createProject = (body) => api('/_api/github/create-project', { method: 'POST', body: JSON.stringify(body) });
/** Create a local-only project (git init + .design scaffold, no GitHub remote). body: { name, parentDir }. */
export const createLocalProject = (body) => api('/_api/project/create-local', { method: 'POST', body: JSON.stringify(body) });
export const initDesign = (dir) => api('/_api/design/init', { method: 'POST', body: JSON.stringify({ dir }) });
/** Phase 29 (E4) Door C — connect to a team hub (saves the global hub credential). */
export const hubLink = (body) => api('/_api/hub/link', { method: 'POST', body: JSON.stringify(body) });

// ── Tauri shell: app-state (first-run / last-project / recent) — Phase 29 (E4) ──
// In a plain browser these throw via tauri(); the wizard only mounts in the native
// app (isNativeApp()), so call sites guard accordingly.
/** True on a fresh install with no usable last project → show the onboarding wizard. */
export const appIsFirstRun = () => invoke('app_is_first_run');
export const appGetLastProject = () => invoke('app_get_last_project');
export const appSetLastProject = (path) => invoke('app_set_last_project', { path });
export const appRecentProjects = () => invoke('app_recent_projects');

// ── Tauri shell commands for "pull a local copy" ────────────────────────────────
/** Native folder picker → chosen parent dir, or null if cancelled. */
export const pickDirectory = () => invoke('pick_directory');
/** Switch the app to a local project folder (the freshly cloned copy). */
export const openLocalProject = (path, open) => invoke('open_local_project', { path, open });
export const resolveProjectForLink = (project) => invoke('resolve_project_for_link', { project });
/**
 * Native "Save As…" for an export — opens an OS save dialog seeded with
 * `filename`, then has the Rust side fetch the finished `jobId`'s bytes
 * directly from the local dev-server and stream them to the chosen path, and
 * resolves to that path (or null if cancelled). Only callable in the native
 * app; the browser build uses the `<a download>` blob instead.
 *
 * Deliberately does NOT take the bytes as an argument (it used to — RCA
 * issue-desktop-print-pdf-save-as-hang-large-payload): shipping a large export
 * (a print-ready PDF can be hundreds of MB) through Tauri's JSON-serialized
 * IPC as `Array.from(new Uint8Array(...))` froze the renderer. Rust fetches
 * the bytes itself now; the webview never sees the payload.
 */
export const saveExport = (filename, jobId) => invoke('save_export', { filename, jobId });

/**
 * Native "open file" for media upload — the read counterpart to saveExport.
 * WKWebView won't present the file panel for an HTML <input type=file>, so the
 * AssetPicker uses this in the desktop app. Returns { name, bytes:[...] } or null
 * (cancelled). Browser build uses the <input type=file> path instead.
 */
export const pickMediaFile = () => invoke('pick_media_file');

/**
 * feature-bulk-media-insert — multi-select counterpart to pickMediaFile.
 * Resolves to `[{name, bytes:[...]}, ...]` (empty array if cancelled).
 */
export const pickMediaFiles = () => invoke('pick_media_files');

// ── Tauri shell: auto-update (Phase 32 / Task 1) ────────────────────────────────
// The shell downloads + stages a newer build in the background and emits
// `update-ready` with { version, notes }. The client shows a banner; clicking
// "Restart now" applies the staged update.
/** Subscribe to the staged-update notice. Returns an unlisten promise. cb({version,notes}). */
export const onUpdateReady = (cb) => listen('update-ready', cb);
/** Apply the staged update by relaunching the app (kills the sidecar first). */
export const restartToUpdate = () => invoke('restart_to_update');

// ── Tauri shell: opt-in crash reporting (Phase 32 / Task 4) ─────────────────────
// Local-file-only, default OFF. The first-run wizard's opt-in checkbox flips it.
/** Current opt-in state (boolean). */
export const getCrashReporting = () => invoke('prefs_get_crash_reporting');
/** Set the opt-in state. */
export const setCrashReporting = (enabled) => invoke('prefs_set_crash_reporting', { enabled });

// ── Tauri shell: AI-editing auto-setup opt-out (DDR-166 Decision 5) ─────────────
// Local-file-only, DEFAULT ON (unlike crash reporting — this is an opt-OUT).
// Reachable from the readiness checklist, without a terminal.
/** Current opt-in state (boolean) — whether install/sign-in buttons are offered. */
export const getClaudeAutoSetup = () => invoke('prefs_get_claude_auto_setup');
/** Set the opt-in state. Takes effect on the next sidecar spawn (app launch / project switch). */
export const setClaudeAutoSetup = (enabled) => invoke('prefs_set_claude_auto_setup', { enabled });
