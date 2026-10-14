// shell-bus.js — the one way a page hears the Rust shell (finding 1d, V2-3.7/V2-3.10).
//
// Tauri delivers every `emit_to(<label>)` to each JS listener registered with the `Any` target,
// in EVERY webview — a project page that called the global `event.listen` read Home's
// `shell://state` (every project's root, name, profile …), a sibling tab's device code and
// more. So the shell no longer emits events to pages and no page capability grants
// `core:event:*`. Instead the page hands the shell ONE `Channel` (`shell_subscribe`), which the
// shell keeps under this page's own label; every message is `{kind, payload}` with the old
// event names as `kind`. `listen(kind, handler)` keeps the old event-listener shape (resolves
// to an unlisten fn) so callers did not change.
//
// Outside the desktop app (a plain browser) there is no shell: `listen` resolves a no-op
// unlisten and never calls the handler.

const KEY = '__maudeShellBus';

function tauriGlobal() {
  return typeof window !== 'undefined' ? window.__TAURI__ : null;
}

/** The page's one bus (a window singleton, so two bundles in one page share a channel). */
function bus() {
  const w = typeof window !== 'undefined' ? window : null;
  if (!w) return null;
  if (w[KEY]) return w[KEY];
  const t = tauriGlobal();
  const Channel = t?.core?.Channel;
  if (!Channel || !t?.core?.invoke) return null;
  const handlers = new Map(); // kind → Set<handler>
  const ch = new Channel();
  ch.onmessage = (m) => {
    const set = m && typeof m.kind === 'string' ? handlers.get(m.kind) : null;
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(m.payload);
      } catch (e) {
        console.error('[maude] shell message handler failed', e);
      }
    }
  };
  const b = { handlers, ready: null };
  b.ready = Promise.resolve()
    .then(() => t.core.invoke('shell_subscribe', { onMessage: ch }))
    .then(
      () => true,
      (err) => {
        // Refused (or an older shell): the next `listen` asks again.
        if (w[KEY] === b) delete w[KEY];
        throw err;
      }
    );
  w[KEY] = b;
  return b;
}

/**
 * Hear the shell's `kind` messages (`shell://state`, `github://device-code`, …) addressed to
 * THIS page. Resolves to an unlisten fn once the shell accepted the subscription; rejects when
 * it refused (a page off its own origin) — callers already treat a rejected listen as "no
 * events". Outside the app: a no-op unlisten.
 */
export function listen(kind, handler) {
  const b = bus();
  if (!b) return Promise.resolve(() => {});
  let set = b.handlers.get(kind);
  if (!set) {
    set = new Set();
    b.handlers.set(kind, set);
  }
  set.add(handler);
  const off = () => {
    set.delete(handler);
  };
  return b.ready.then(
    () => off,
    (err) => {
      off();
      throw err;
    }
  );
}
