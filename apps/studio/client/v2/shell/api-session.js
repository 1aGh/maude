// client/v2/shell/api-session.js — a desktop project tab opens its session with its own server
// (contract client/v2/contracts/sec-loopback-bearer.md §7.4).
//
// A server the desktop app starts requires its per-spawn key from every caller, this page
// included. The tab asks the shell for the key once (`project_api_session`, caller-checked in
// Rust: this tab's label AND its own server's origin) and trades it for an HttpOnly session
// cookie (`POST /_api/shell/session`). From then on every request — fetch, images, media, fonts,
// WebSockets — carries the cookie by itself; the key is not kept.
//
// Until the trade settles, the fetch wrapper holds every same-origin `fetch`, so nothing the shell
// starts at boot races it. Outside a project tab of the app (a browser, Home, the strip, a cloud
// tab) it does nothing: the session is "ready" at once.
//
// A session ends after 12 h unused or 24 h in all (§7.2). When the server then answers a request
// `401 api-key-required`, the wrapper trades the key again — once, shared by every request that hit
// it at the same moment — and resends the request; the person never sees it.

export const SESSION_PATH = '/_api/shell/session';
export const API_KEY_HEADER = 'x-maude-api-key';
const ATTEMPTS = 3;
const RETRY_MS = 300;

/** A project tab of the desktop app (`p-<pid>`) — the only caller the shell hands a key to. */
export function isProjectTab(win) {
  const meta = win?.__TAURI_INTERNALS__?.metadata;
  const label = meta?.currentWebview?.label ?? meta?.currentWindow?.label;
  return typeof label === 'string' && label.startsWith('p-') && !!win?.__TAURI__?.core?.invoke;
}

function sameOrigin(input, win) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    return new URL(raw, win.location.href).origin === win.location.origin;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open the session once per page. Resolves true when the cookie is set, false otherwise (outside a
 * project tab, or the shell/server said no — the page's requests then answer 401 and the shell
 * shows its usual "can't reach the project" states). Never rejects.
 */
async function tradeKey(win, rawFetch) {
  if (!isProjectTab(win)) return false;
  const invoke = win.__TAURI__.core.invoke;
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i > 0) await sleep(RETRY_MS);
    try {
      const answer = await invoke('project_api_session');
      const key = typeof answer?.key === 'string' ? answer.key : '';
      if (!key) continue;
      const res = await rawFetch(SESSION_PATH, {
        method: 'POST',
        headers: { [API_KEY_HEADER]: key },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.ok) return true;
    } catch {
      /* the server may still be coming up — retry */
    }
  }
  return false;
}

export function openApiSession(win, rawFetch) {
  if (win.__maudeApiSession) return win.__maudeApiSession;
  win.__maudeApiSession = tradeKey(win, rawFetch);
  return win.__maudeApiSession;
}

/** One re-trade at a time: every request that met the ended session waits on the same one. */
function renewApiSession(win, rawFetch) {
  if (!win.__maudeApiSessionRenew) {
    win.__maudeApiSessionRenew = tradeKey(win, rawFetch).finally(() => {
      win.__maudeApiSessionRenew = null;
    });
  }
  return win.__maudeApiSessionRenew;
}

/** A request that can be sent twice: no Request object (its body is spent) and no streamed body. */
function resendable(input, init) {
  if (!(typeof input === 'string' || input instanceof URL)) return false;
  const body = init?.body;
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

/** The gate's own answer for a request with no live session (shell/api-key.ts `refuse`). */
async function sessionEnded(res) {
  if (res.status !== 401) return false;
  try {
    const body = await res.clone().json();
    return body?.error === 'api-key-required';
  } catch {
    return false;
  }
}

/**
 * Hold every same-origin `fetch` until the session is open. Idempotent; a no-op outside a
 * project tab of the app.
 */
export function installApiSession(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || win.__maudeApiSessionFetch || !isProjectTab(win)) return Promise.resolve(false);
  const rawFetch = win.fetch.bind(win);
  win.__maudeApiSessionFetch = true;
  const ready = openApiSession(win, rawFetch);
  win.fetch = (input, init) => {
    if (!sameOrigin(input, win)) return rawFetch(input, init);
    return ready.then(async () => {
      const res = await rawFetch(input, init);
      if (!resendable(input, init) || !(await sessionEnded(res))) return res;
      return (await renewApiSession(win, rawFetch)) ? rawFetch(input, init) : res;
    });
  };
  return ready;
}

/** The boot waits on this before it renders (sockets open from effects, after the first render). */
export function apiSessionReady(win = typeof window !== 'undefined' ? window : undefined) {
  return win?.__maudeApiSession ?? Promise.resolve(false);
}
