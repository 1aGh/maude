// client/home/home-api.js — every request the Home page makes, and the native shell bridge.
//
// HTTP: the Home server (`maude-server --home`, apps/studio/home/routes.ts) answers no route without
// the header `x-maude-home: 1` (V2-1.1 §5.3 — a custom header forces a CORS preflight from any other
// origin, and the Home server answers every preflight 405). So EVERY fetch on this page goes through
// `homeFetch`, `/_config` included. A failure never throws to the caller: it comes back as
// `{ ok: false, status, json: null }` and the page shows its offline words.
//
// Shell: Rust's commands (V2-1.1 §5.4) reached through `window.__TAURI__`. Outside the desktop app
// (the page opened in a browser for development) `inShell()` is false, `shellInvoke` resolves
// `null` and `shellListen` is a no-op — the page shows the index without shell actions.

export const HOME_HEADER = 'x-maude-home';

/** fetch with the Home header; never throws. */
export async function homeFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}), [HOME_HEADER]: '1' };
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { cache: 'no-store', ...opts, headers });
  } catch {
    return { ok: false, status: 0, json: null };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

const post = (path, body) => homeFetch(path, { method: 'POST', body: JSON.stringify(body) });
const pidParam = (pids) => (Array.isArray(pids) ? pids : []).map(encodeURIComponent).join(',');

export const getConfig = () => homeFetch('/_config');
export const getIndex = (pids, running = []) =>
  homeFetch(`/_home/index?pids=${pidParam(pids)}&running=${pidParam(running)}`);
export const getCloud = (profile) =>
  homeFetch(`/_home/cloud?profile=${encodeURIComponent(profile)}`);
export const search = (q, pids) =>
  homeFetch(`/_home/search?q=${encodeURIComponent(q)}&pids=${pidParam(pids)}`);
export const getRecentSearches = () => homeFetch('/_home/recent-searches');
export const saveRecentSearch = (q, results) => post('/_home/recent-searches', { q, results });
export const setPin = (pid, canvas, pinned) => post('/_home/pins', { pid, canvas, pinned });
export const prepareCloud = (profile, server, projectId) =>
  post('/_home/cloud/prepare', { profile, server, projectId });

// ── the native shell ───────────────────────────────────────────────────────────────────────────
function tauri() {
  return typeof window !== 'undefined' ? window.__TAURI__ || null : null;
}

/** True inside the desktop app (a Tauri webview with IPC). */
export const inShell = () => !!tauri()?.core?.invoke;

/** Invoke a shell command. Outside the app resolves `null`; a refused command rejects. */
export function shellInvoke(cmd, args) {
  const t = tauri();
  if (!t?.core?.invoke) return Promise.resolve(null);
  return t.core.invoke(cmd, args);
}

/** Listen to a shell event; resolves to an unlisten fn (a no-op outside the app). */
export async function shellListen(event, handler) {
  const t = tauri();
  if (!t?.event?.listen) return () => {};
  try {
    return await t.event.listen(event, (e) => handler(e?.payload));
  } catch {
    return () => {};
  }
}

// The commands Home calls, with the argument shapes V2-1.1 §5.4 fixes — one place to look.
export const shellState = () => shellInvoke('shell_state');
/** `{pid}` (or `{root}`), optional `target: {canvas, artboard?}` → `{label, opened}`. */
export const openProject = (where, target) =>
  shellInvoke('open_project', target ? { ...where, target } : { ...where });
export const openProjectFolder = () => shellInvoke('open_project_folder');
export const relinkProject = (pid) => shellInvoke('relink_project', { pid });
/** The existing command (github.js `managedProjectOpen`): resolves the managed copy's folder. */
export const managedProjectOpen = (p) =>
  shellInvoke('managed_project_open', {
    serverUrl: p.serverUrl,
    projectId: p.projectId,
    name: p.name || p.projectId,
    canvasGroups: p.canvasGroups || [],
  });
export const openCloudUrl = (url) => shellInvoke('open_cloud_url', { url });
