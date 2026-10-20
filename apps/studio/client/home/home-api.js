// client/home/home-api.js — every request the Home page makes, and the native shell bridge.
//
// HTTP: the Home server (`maude-server --home`, apps/studio/home/routes.ts) answers no route without
// the header `x-maude-home` (V2-1.1 §5.3 — a custom header forces a CORS preflight from any other
// origin, and the Home server answers every preflight 405). Its VALUE is the per-spawn Home PAGE
// secret (V2-3.6 H1): any local process can send a header, so a constant `1` let the agent's
// `maude design curl-local` read every profile's cloud listing. The page gets the secret once from
// Rust — `home_session()`, which only the `home` window on the Home origin may call — and sends it
// on every request. So EVERY fetch on this page goes through `homeFetch`, `/_config` included. A
// failure never throws to the caller: it comes back as `{ ok: false, status, json: null }` and the
// page shows its offline words.
//
// In a plain browser (development, no Tauri) there is no `home_session`: start the Home server with
// `MAUDE_HOME_PAGE_SECRET=<64 hex>` and put the same value in this origin's
// `sessionStorage['maude-home-page-secret']` (devtools). Without it nothing is sent, every helper
// answers `{ ok: false, status: 403 }`, and a loopback browser falls back to the project shell.
//
// Shell: Rust's commands (V2-1.1 §5.4) reached through `window.__TAURI__`. Outside the desktop app
// (the page opened in a browser for development) `inShell()` is false, `shellInvoke` resolves
// `null` and `shellListen` is a no-op — the page shows the index without shell actions.

import { listen as busListen } from '../shell-bus.js';
import { openBrowserDoor } from '../v2/cloud/browser-door.js';

export const HOME_HEADER = 'x-maude-home';
export const DEV_SECRET_KEY = 'maude-home-page-secret';

let secretP = null; // Promise<string|null> — one home_session() per page load

async function loadSecret() {
  if (inShell()) {
    try {
      const r = await tauri().core.invoke('home_session');
      return typeof r?.secret === 'string' && r.secret ? r.secret : null;
    } catch {
      return null;
    }
  }
  try {
    return globalThis.sessionStorage?.getItem(DEV_SECRET_KEY) || null;
  } catch {
    return null;
  }
}

/** The Home page secret, or null (refused / not in the app). A miss is not remembered. */
export function homeSecret() {
  if (!secretP) {
    const p = loadSecret();
    secretP = p;
    p.then((s) => {
      if (!s && secretP === p) secretP = null;
    });
  }
  return secretP;
}

/** Tests only: forget the cached secret. */
export function resetHomeSecret() {
  secretP = null;
}

/** fetch with the Home header; never throws. */
export async function homeFetch(path, opts = {}) {
  const secret = await homeSecret();
  if (!secret) return { ok: false, status: 403, json: null };
  const headers = { ...(opts.headers || {}), [HOME_HEADER]: secret };
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
/** "Just a local project" (V2-1.1 §5.3): `~/Maude/<name>` scaffolded → `{ok, root, pid, name}`. */
export const createLocal = (name) => post('/_home/projects/create-local', { name });
/** S6.4: "a new project" from Home's question — named from the sentence on the server (C4). */
export const createLocalFromPrompt = (fromPrompt) =>
  post('/_home/projects/create-local', { fromPrompt });
export const prepareCloud = (profile, server, projectId) =>
  post('/_home/cloud/prepare', { profile, server, projectId });
/** A connect link's project (`maude://open/<project>?code=…`): the same prepare, with the link's
 *  one-shot handoff code beside the project it claims (V2-3.5). */
export const prepareCloudLink = (profile, link) =>
  post('/_home/cloud/prepare', { profile, projectId: link.project, code: link.code });

// S6.8 — signing in to Maude Cloud from Home (contract S6-S9 §5.1). The device code and the token stay in
// the Home server process: the page holds only the attempt's `state` and the `userCode` the person may
// type on the activate page. The browser is opened by RUST (`home_cloud_sign_in_open`), which composes
// the URL itself — the page never sees or builds it.
/** → `{ok, userCode, state, expiresIn}` | `{ok:false, reason, error}` (502 unreachable, 403 not-prepared). */
export const cloudSignInStart = (profile) =>
  post('/_home/cloud/signin/start', profile ? { profile } : {});
/** → `{status:'pending'|'done'|'expired'|'cancelled', email?, landing?}` | 409 `{reason:'stale-state'}`. */
export const cloudSignInPoll = (state) => post('/_home/cloud/signin/poll', { state });
export const cloudSignInCancel = (state) => post('/_home/cloud/signin/cancel', { state });
/** Rust picks (or makes) the profile the next sign-in may write → its id. A refusal rejects with words. */
export const signInPrepare = (forInvite) =>
  shellInvoke('home_cloud_sign_in_prepare', forInvite ? { forInvite } : {});
export const signInOpenBrowser = (userCode, state) =>
  shellInvoke('home_cloud_sign_in_open', { userCode, state });
/** After the Home server stored the credential: Rust records the account → the profile it landed in. */
export const signInDone = (profile) => shellInvoke('home_cloud_signed_in', { profile });
// S6.9 — the Advanced sheets' routes (S6.6). Nothing here keeps or logs what it carries: the hub
// password is posted once, in the body, and the answer never contains it.
/** "Test connection": one tokenless GET /health on the server → `{ok, reachable, url, version}`. */
export const hubTest = (url) => post('/_home/hub/test', { url });
/** "Connect": `creds` ({email, password}) signs in; without it, a hub this Mac already holds a sign-in for. */
export const hubPrepare = (profile, url, creds) =>
  post('/_home/hub/prepare', {
    profile,
    url,
    ...(creds ? { email: creds.email, password: creds.password } : {}),
  });
/** Claude readiness → `{available, claudeInstalled, reason, install:{phase,ok?,reason?}, signinInFlight}`. */
export const aiStatus = () => homeFetch('/_home/ai/status');
/** step: 'install' | 'signin' | 'cancel'. */
export const aiConnect = (step) => post('/_home/ai/connect', { step });
/** The maude command → `{state, link, claude, plugin:{phase,ok?}}`. */
export const cliStatus = () => homeFetch('/_home/cli/status');
export const cliInstall = () => post('/_home/cli/install', {});
// S6.11 — an invite (contract S6-S9 §5.3). The invite id is a bearer secret: it rides only in these POST
// bodies (never a URL, a log or the DOM), and the Home server sends it only to the control plane.
/** → 200 `{ok, projectName, fromName, email, role, canvas?, thread?}` · 404 `{reason:'gone', error}` · 429. */
export const invitePeek = (id) => post('/_home/invite/peek', { id });
/** → 200 `{ok, code, landing}` · 401 signed-out · 403 `{reason:'other-account', email}` · 404 gone · 426. */
export const inviteAccept = (id, profile) => post('/_home/invite/accept', { id, profile });
/** The invite id a `maude://invite/<id>` link parked for Home (deep_link.rs), once; null when none. */
export const takePendingInvite = () => shellInvoke('take_pending_invite');
/** The What's New feed and this Mac's one seen mark (S6.6, `/_home/whats-new`). */
export const getWhatsNew = () => homeFetch('/_home/whats-new');
export const markWhatsNewSeen = (seen) => post('/_home/whats-new', { seen });

// Pictures: `/_home/thumb/<pid>/<key>.jpg` is guarded like every other route, and an <img src>
// cannot send a header — so the page fetches the bytes (with the header) and shows a blob: URL.
// A key names immutable bytes, so one object URL per picture lives for the page (capped).
const THUMB_CAP = 400;
const thumbCache = new Map(); // src → Promise<string|null>

/** A blob: URL for a Home picture, or null (missing, refused, offline). Never throws. */
export function thumbObjectUrl(src) {
  if (!src) return Promise.resolve(null);
  const hit = thumbCache.get(src);
  if (hit) return hit;
  const p = (async () => {
    try {
      const secret = await homeSecret();
      if (!secret) return null;
      const res = await fetch(src, { headers: { [HOME_HEADER]: secret } });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.size || typeof URL.createObjectURL !== 'function') return null;
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  })();
  thumbCache.set(src, p);
  if (thumbCache.size > THUMB_CAP) {
    const [oldest, url] = thumbCache.entries().next().value;
    thumbCache.delete(oldest);
    url.then((u) => u && URL.revokeObjectURL?.(u));
  }
  // a failed fetch is not remembered: the next render may find the picture
  p.then((u) => {
    if (!u && thumbCache.get(src) === p) thumbCache.delete(src);
  });
  return p;
}

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

/**
 * Hear a shell message addressed to Home (`shell://state`, `index://changed`, a parked
 * `maude://deep-link` nudge); resolves to an unlisten fn (a no-op outside the app or when the
 * shell refuses). Finding 1d: not a Tauri event — an `emit_to('home')` also reached every
 * `Any`-target listener in every project page. The shell writes to the Channel Home handed
 * `shell_subscribe` (shell-bus.js), under Home's own label.
 */
export async function shellListen(event, handler) {
  try {
    return await busListen(event, (p) => handler(p));
  } catch {
    return () => {};
  }
}

// The commands Home calls, with the argument shapes V2-1.1 §5.4 fixes — one place to look.
export const shellState = () => shellInvoke('shell_state');
/** `{pid}` (or `{root}`), optional `target: {canvas, artboard?}` and `intent: {kind, prompt,
 *  projectHint?, moveToCloud?}` (S6.4 — Rust parks it for the new window; the prompt is never in a
 *  URL) → `{label, opened}`. */
export const openProject = (where, target, intent) =>
  shellInvoke('open_project', {
    ...where,
    ...(target ? { target } : {}),
    ...(intent ? { intent } : {}),
  });
export const openProjectFolder = () => shellInvoke('open_project_folder');
export const relinkProject = (pid) => shellInvoke('relink_project', { pid });
/** The existing command (github.js `managedProjectOpen`): resolves the managed copy's folder. */
export const managedProjectOpen = (p) =>
  shellInvoke('managed_project_open', {
    serverUrl: p.serverUrl,
    projectId: p.projectId,
    name: p.name || p.projectId,
    canvasGroups: p.canvasGroups || [],
    // N-H1: the profile the prepare ran for — Rust binds the copy to it before it spawns
    ...(typeof p.profile === 'string' ? { profile: p.profile } : {}),
  });
export const openCloudUrl = (url) => shellInvoke('open_cloud_url', { url });
/** S9.17b — a browser door (`{url}` from a prepare's 409) as a cell tab of `profile`; outside the
 *  app, in the browser. → `{ok, via}` | `{ok: false, error}`. */
export const openCellDoor = (url, profile) =>
  openBrowserDoor({ url, profile }, { invoke: inShell() ? shellInvoke : null });
/** The `maude://` link parked for THIS window (deep_link.rs), once; null when none. */
export const takePendingDeepLink = () => shellInvoke('take_pending_deep_link');
