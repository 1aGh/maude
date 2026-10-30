// client/github.js — thin bridge from the React client to (a) the Tauri shell's
// GitHub commands and (b) the dev-server's /_api/github/* endpoints. Phase 28 (E3).
//
// Sign-in / sign-out / keychain live in the Tauri shell (oauth.rs / keychain.rs),
// reached via `window.__TAURI__` (withGlobalTauri). The profile + create-repo +
// invite + repos go through the dev-server endpoints (which read the token from
// the loopback bridge). In a plain browser (no Tauri) `isNativeApp()` is false and
// the IdentityBar shows the "open the desktop app" state instead of sign-in.

import { listen as shellListen } from './shell-bus.js';
import { browserDoorOf, openBrowserDoor } from './v2/cloud/browser-door.js';

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

/** Hear a shell message (`github://device-code`, `menu://action`, `update-ready`, …) addressed
 *  to THIS page; resolves to an unlisten fn. Finding 1d: not a Tauri event — Tauri delivers an
 *  `emit_to` to every `Any`-target listener in every webview, so a sibling tab would read this
 *  one's device code. The shell writes to the Channel this page handed `shell_subscribe`
 *  (shell-bus.js). Outside the app: a no-op unlisten. */
export function listen(event, handler) {
  return shellListen(event, handler);
}

/** Same as `listen` — every shell message is addressed to one page now. Kept for callers. */
export function listenHere(event, handler) {
  return shellListen(event, handler);
}

// ── Tauri shell commands ──────────────────────────────────────────────────────
/** Run the device flow; resolves to the login (public handle) on success. */
export const signIn = () => invoke('github_sign_in');
export const signOut = () => invoke('github_sign_out');
/** V2-3.8 — a Maude Cloud sign-in keeps its project's own profile. Call before
 *  the device flow: `true` means this project already held a cloud sign-in and
 *  was moved to a fresh profile (its server restarts and the page reloads —
 *  stop, the person starts again there). In a plain browser there is no shell:
 *  `false`. */
export const cloudSignInPrepare = () =>
  isNativeApp() ? invoke('cloud_sign_in_prepare') : Promise.resolve(false);
/** V2-3.8 — after the server stored the cloud credential: the shell records the
 *  account and, when it would re-sign a profile other projects use under another
 *  account, moves it to this project's own profile (`true`: reloading). */
export const cloudSignedIn = () =>
  isNativeApp() ? invoke('cloud_signed_in') : Promise.resolve(false);
/** S1.22a — every account on this Mac with the projects bound to it, for the account card:
 *  `[{ id, label, email, projects: string[] }]`. A shell command that returns it FOR THE CALLER
 *  (patch request S1.22a-1); an older shell has none, so this resolves `null` — the card then says
 *  only what the tab itself knows. Never throws. */
export const accountsList = () =>
  isNativeApp()
    ? Promise.resolve()
        .then(() => invoke('accounts_list'))
        .then(
          (v) => (Array.isArray(v) ? v : null),
          () => null
        )
    : Promise.resolve(null);
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
export const onDeviceCode = (cb) => listenHere('github://device-code', cb);
/** Fire when sign-in completes in THIS window so its other surfaces can flip live. cb(login). */
export const onSignedIn = (cb) => listenHere('github://signed-in', cb);
/** Fire when a native menu item whose registry action runs in the webview is chosen
 *  (`menu://action {id}`, sent to the focused window only — V2-1.3 §5.8). cb(actionId).
 *  Returns an unlisten promise. */
export const onMenuAction = (cb) => listenHere('menu://action', (p) => cb(p?.id));

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
export const createRepo = (body) =>
  api('/_api/github/create-repo', { method: 'POST', body: JSON.stringify(body) });
export const invite = (username) =>
  api('/_api/github/invite', { method: 'POST', body: JSON.stringify({ username }) });
export const cloneRepo = (body) =>
  api('/_api/github/clone', { method: 'POST', body: JSON.stringify(body) });
export const createProject = (body) =>
  api('/_api/github/create-project', { method: 'POST', body: JSON.stringify(body) });
/** Create a local-only project (git init + .design scaffold, no GitHub remote). body: { name, parentDir }. */
export const createLocalProject = (body) =>
  api('/_api/project/create-local', { method: 'POST', body: JSON.stringify(body) });
export const initDesign = (dir) =>
  api('/_api/design/init', { method: 'POST', body: JSON.stringify({ dir }) });
/** Phase 29 (E4) Door C — connect to a team hub (saves the global hub credential). */
export const hubLink = (body) =>
  api('/_api/hub/link', { method: 'POST', body: JSON.stringify(body) });

// ── managed team projects (plan T21/T22) ───────────────────────────────────────
/**
 * Sign in / hold the credential and describe a team project, so its own copy can
 * be created without choosing a folder. body: { kind: 'cloud', projectId } |
 * { kind: 'handoff', code, claimedProject } | { kind: 'hub', url, email, password }
 * | { kind: 'known-hub', url }.
 */
export const prepareProject = (body) =>
  api('/_api/projects/prepare', { method: 'POST', body: JSON.stringify(body) });
/** Create (first time) or reuse the project's managed copy, then switch to it. */
export const managedProjectOpen = (p) =>
  invoke('managed_project_open', {
    serverUrl: p.serverUrl,
    projectId: p.projectId,
    name: p.name || p.projectId,
    canvasGroups: p.canvasGroups || [],
  });
/** The team projects this computer keeps a copy of, most recent first. */
// Outside the app there are no managed copies — and invoke() throws synchronously there, which a
// caller's `.catch()` never sees (the P8 sweep: Settings › Add a team server… crashed the browser shell).
export const managedProjectsList = () =>
  isNativeApp() ? invoke('managed_projects_list') : Promise.resolve([]);

/**
 * Prepare, then open. Resolves `{ ok: true, path }` once the switch has started
 * (the webview reloads onto the project), or `{ ok: false, error }`. A Can view
 * account's browser door (S9.17b) opens the cell as a tab instead — `{ ok: true,
 * via }`, nothing switches here; a project tab names no profile (Rust uses its own).
 */
export async function openTeamProject(input) {
  const r = await prepareProject(input);
  const door = browserDoorOf(r.json);
  if (door) return openBrowserDoor({ url: door.url }, { invoke: isNativeApp() ? invoke : null });
  if (!r.ok || !r.json?.ok) {
    return {
      ok: false,
      error: r.json?.error || 'The project could not be opened.',
      status: r.status,
    };
  }
  try {
    const path = await managedProjectOpen(r.json);
    return { ok: true, path, project: r.json };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || 'The project could not be opened.') };
  }
}

// ── Tauri shell: app-state (last-project / recent) — Phase 29 (E4) ──
// In a plain browser these throw via tauri(), so call sites guard on isNativeApp().
// (S6.15 retired `appIsFirstRun`: first launch boots Home, there is no wizard to show.)
export const appGetLastProject = () => invoke('app_get_last_project');
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
 * AssetPicker uses this in the desktop app. Returns `{ token, name, size }` or
 * null (cancelled) — never the bytes: read them with {@link pickedMediaSource}.
 * Browser build uses the <input type=file> path instead.
 */
export const pickMediaFile = () => invoke('pick_media_file');

/**
 * feature-bulk-media-insert — multi-select counterpart to pickMediaFile.
 * Resolves to `[{ token, name, size }, ...]` (empty array if cancelled).
 */
export const pickMediaFiles = () => invoke('pick_media_files');

/**
 * A picked file as an upload source (`asset-upload.ts` ChunkSource): bytes are
 * read one slice at a time as a raw ArrayBuffer over IPC, so a 500 MB clip is
 * never held whole in the page. Call `release()` when the upload is done.
 */
export function pickedMediaSource(ref, type) {
  return {
    size: ref.size,
    type: type || '',
    name: ref.name,
    async read(start, end) {
      const buf = await invoke('read_picked_media', {
        token: ref.token,
        offset: start,
        len: end - start,
      });
      return new Uint8Array(buf);
    },
    release: () => invoke('release_picked_media', { token: ref.token }).catch(() => {}),
  };
}

/** A small picked file read whole (screenshots). Releases the pick. */
export async function readPickedMediaBlob(ref, type) {
  const src = pickedMediaSource(ref, type);
  try {
    return new Blob([await src.read(0, ref.size)], type ? { type } : undefined);
  } finally {
    src.release();
  }
}

// ── Tauri shell: auto-update (Phase 32 / Task 1) ────────────────────────────────
// The shell downloads + stages a newer build in the background and emits
// `update-ready` with { version, notes }. The client shows a banner; clicking
// "Restart now" applies the staged update.
/** Subscribe to the staged-update notice. Returns an unlisten promise. cb({version,notes}). */
export const onUpdateReady = (cb) => listen('update-ready', cb);
/** Apply the staged update by relaunching the app (kills the sidecar first). */
export const restartToUpdate = () => invoke('restart_to_update');
/**
 * V2-4.7c — Settings › Advanced › Check for updates: the menu's Maude ▸ Check for Updates… path
 * (signed feed, native "up to date" / "failed" dialogs, a found build stages → `update-ready`).
 * No arguments by design; the shell throttles repeat calls.
 */
export const checkForUpdates = () => invoke('check_for_updates');

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
