// client/v2/ds/switch-bus.js — S10.14: how a registry action reaches the switch host.
//
// The menu runner (menu-runner.js) runs `ds.switch` / `ds.preview` from a system's own menu, a place that owns no
// React state. The host (switch-host.jsx) is mounted once in the shell and listens here. A request made before the
// host mounted waits and is handed over when it does (the same shape as review-bus.js).
//
//   { kind: 'switch',  from?, to?, scope?, canvas?, quiet? }   open "Switch canvases to …?"
//   { kind: 'preview', from? }                                  step through the systems, every open canvas re-renders
//
// `finishedMaking` is how S10.16a's `done` reaches the switch review for the canvases that already exist: a system
// that has just become the project default offers the whole project one review (13 · "switch review for existing
// canvases"), quietly — a project with nothing to move says nothing.

const listeners = new Set();
let waiting = null;

/** @param {{ kind: 'switch' | 'preview', from?: string, to?: string, scope?: 'canvas' | 'folder' | 'all', canvas?: string, quiet?: boolean }} req */
export function requestDsSwitchHost(req) {
  if (listeners.size === 0) {
    waiting = req;
    return false;
  }
  for (const fn of [...listeners]) fn(req);
  return true;
}

export const requestDsSwitch = (p = {}) => requestDsSwitchHost({ kind: 'switch', ...p });
export const requestDsPreview = (p = {}) => requestDsSwitchHost({ kind: 'preview', ...p });

/**
 * The answer of `ds.make-done` (`maude.ds-result` with `system` + `defaultSet`): when the new system became the
 * default, offer the existing canvases the switch review. Returns whether it asked.
 */
export function finishedMaking(result) {
  if (!result || typeof result.system !== 'string' || result.defaultSet !== true) return false;
  requestDsSwitch({ to: result.system, scope: 'all', quiet: true });
  return true;
}

export function onDsSwitchRequest(fn) {
  listeners.add(fn);
  if (waiting) {
    const req = waiting;
    waiting = null;
    fn(req);
  }
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam. */
export function resetDsSwitchBus() {
  listeners.clear();
  waiting = null;
}
