// client/v2/empty/fill-ask.js — S11.2: the one door between the registry action `ai.ask-fill-artboard` (⌘K, the
// menu runner) and the empty-artboard hint that knows which board it is about.
//
// The host (empty-host.jsx) binds a runner while it is mounted; the menu runner calls `runFillAsk()`. Unbound,
// nothing happens (a surface with no shell, a test, a stray mount) — it cannot ask the AI by accident.

let runner = null;

/** @param {() => boolean|void} fn @returns an unbind that only unbinds its own binding */
export function bindFillAsk(fn) {
  runner = fn;
  return () => {
    if (runner === fn) runner = null;
  };
}

/** Run the bound ask. @returns true when something ran */
export function runFillAsk() {
  if (!runner) return false;
  runner();
  return true;
}
