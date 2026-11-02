// client/v2/ai/ai-may.js — P8 c7 (03 `ai-advanced`, "AI may"): what the person lets AI use, per Mac.
//
//   Change canvases        is the ask-before mode ("AI changes nothing" modes = off) — not stored here
//   Use Assets and footage \ stored here, sent as the `may` field of every prompt / warm frame (ask-frame.js) and
//   Search the web         /  HELD by the server: an off switch is a deny rule the session is spawned with plus a
//                             refusal in the bridge's permission gate (acp/may-scope.ts, decision
//                             maude/v2-p8-c7-ai-may-enforced). The agent is also told with ONE bracket line
//                             (`[maude-may no-assets no-web]`): a hint that saves it wasted calls, never the control.
// Both default ON; no bracket line while both are on, so the ask text is byte-for-byte what it was.
//
// V2-8.9 M1 (decisions maude/v2-8.9-lead-m1-canvas-navigation-gate, maude/v2-8.9-m1-tab-web-flag-tauri-command):
// in the desktop app "Search the web" is also told to the SHELL — on load and on every change — through the
// caller-checked `set_tab_web` command, so the native navigation gate keeps this tab's canvas frames on
// loopback while it is off (windows.rs `navigation_allowed_for`). A browser / cloud tab has no
// `window.__TAURI__` and sends nothing.

export const MAY_KEY = 'maude-ai-may';
export const MAY_DEFAULT = Object.freeze({ assets: true, web: true });

export function readMay(storage) {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(MAY_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return { assets: o?.assets !== false, web: o?.web !== false };
  } catch {
    return { ...MAY_DEFAULT };
  }
}

export function writeMay(may, storage, win) {
  try {
    (storage ?? globalThis.localStorage)?.setItem(
      MAY_KEY,
      JSON.stringify({ assets: may.assets !== false, web: may.web !== false })
    );
  } catch {
    /* private window / blocked storage — the switch just doesn't persist */
  }
  tellShellWeb(may, win === undefined ? globalThis.window : win);
}

/**
 * Tell the desktop shell this tab's "Search the web" switch (`set_tab_web`, caller-checked in Rust: the
 * tab is the calling webview, never an argument). Fire-and-forget: a refusal (an older app, a page not on
 * its own server) is swallowed — the shell then keeps its default. Returns whether it was sent.
 */
export function tellShellWeb(may, win) {
  const invoke = win?.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') return false;
  try {
    Promise.resolve(invoke('set_tab_web', { on: may?.web !== false })).catch(() => {});
  } catch {
    /* the shell refused synchronously — same as a rejection */
  }
  return true;
}

// On load: the shell learns the stored switch before any canvas frame of this page exists.
if (typeof globalThis.window !== 'undefined') {
  let stored = null;
  try {
    stored = globalThis.window.localStorage; // a blocked-storage window throws on the read itself
  } catch {
    /* readMay(null) → the defaults */
  }
  tellShellWeb(readMay(stored), globalThis.window);
}

/** The one line a prompt carries when something is off; `null` when AI may use everything. */
export function mayLine(may) {
  const off = [];
  if (may?.assets === false) off.push('no-assets');
  if (may?.web === false) off.push('no-web');
  return off.length ? `[maude-may ${off.join(' ')}]` : null;
}
