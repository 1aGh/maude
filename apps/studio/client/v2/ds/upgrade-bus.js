// client/v2/ds/upgrade-bus.js — S10.15b: how a registry action (or the switch sheet) reaches the bring-up host.
//
// `ds.upgrade` (menu-runner.js) runs from a system's own menu or its amber dot, places that own no React state;
// the switch sheet (switch-sheet.jsx) asks for it when a level-11 system is in the switch. The host
// (upgrade-host.jsx) is mounted once in the shell and listens here. A request made before the host mounted waits
// and is handed over when it does (the same shape as switch-bus.js).
//
//   { ds }   open "Bring <system> up to the schema?" for that system

const listeners = new Set();
let waiting = null;

/** @param {{ ds: string }} req @returns whether a host heard it now */
export function requestDsUpgrade(req) {
  if (!req || typeof req.ds !== 'string' || !req.ds) return false;
  if (listeners.size === 0) {
    waiting = req;
    return false;
  }
  for (const fn of [...listeners]) fn(req);
  return true;
}

export function onDsUpgradeRequest(fn) {
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
export function resetDsUpgradeBus() {
  listeners.clear();
  waiting = null;
}
