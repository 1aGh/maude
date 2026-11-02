// client/v2/ds/advanced-bus.js — S10.19: how a registry action reaches the Advanced host.
//
// The menu runner (menu-runner.js) runs `ds.check-system` from a system's own menu and `ds.reveal-files` from
// the Advanced files list — places that own no React state. The host (advanced-host.jsx) is mounted once in the
// shell and listens here. A request made before the host mounted waits and is handed over when it does (the same
// shape as review-bus.js).
//
//   { kind: 'check',  ds? }   ds.check-system: run the check, say the outcome, and show the system
//   { kind: 'reveal', ds? }   ds.reveal-files: Finder opens the system's folder (the Mac app only)

const listeners = new Set();
let waiting = null;

/** @param {{ kind: 'check' | 'reveal', ds?: string }} req */
export function requestDsAdvanced(req) {
  if (listeners.size === 0) {
    waiting = req;
    return false;
  }
  for (const fn of [...listeners]) fn(req);
  return true;
}

export function onDsAdvancedRequest(fn) {
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
export function resetDsAdvancedBus() {
  listeners.clear();
  waiting = null;
}
