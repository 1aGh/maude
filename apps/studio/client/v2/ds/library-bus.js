// client/v2/ds/library-bus.js — S10.18c: how a registry action reaches the library host.
//
// The menu runner (menu-runner.js) runs `ds.library-link` / `ds.library-update` / `ds.library-unlink` from places
// that own no React state. The host (library-host.jsx) is mounted once in the shell (inside review-host.jsx) and
// listens here. A request made before the host mounted waits and is handed over when it does.
//
//   { kind: 'link' }               open "Link a team library"
//   { kind: 'update', ds? }        open "Update from <system>? N changes" for a linked system
//   { kind: 'unlink', ds? }        ask "Unlink <system>?"
//
// `ds` may be left out: the open linked system, else the only linked one. The server re-checks the role and that
// the system is a linked library, whatever this page says.

const listeners = new Set();
let waiting = null;

/** @param {{ kind: 'link' | 'update' | 'unlink', ds?: string }} req */
export function requestDsLibrary(req) {
  if (listeners.size === 0) {
    waiting = req;
    return false;
  }
  for (const fn of [...listeners]) fn(req);
  return true;
}

export function onDsLibraryRequest(fn) {
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
export function resetDsLibraryBus() {
  listeners.clear();
  waiting = null;
}
