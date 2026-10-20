// client/v2/ds/review-bus.js — S10.8: how a registry action reaches the review host.
//
// The menu runner (menu-runner.js) and the Inspector's links run `ds.publish` / `ds.review-update` /
// `ds.cancel-pending` from places that own no React state. The host (review-host.jsx) is mounted once in the
// shell and listens here. A request made before the host mounted waits and is handed over when it does.
//
//   { kind: 'review', ds?, canvas? }                             open "Update N canvases" for a system
//   { kind: 'push',   canvas, elementId, target, ds? }           ds.review-update: the same sheet, after the push
//   { kind: 'cancel', ds?, canvas? }                             ds.cancel-pending: put the swatch back
//   { kind: 'reach',  css | component, name?, swatch?, ds?, canvas? }  ds.show-reach: draw where it lands (S10.9)

const listeners = new Set();
let waiting = null;

/** @param {{ kind: 'review' | 'push' | 'cancel' | 'reach', ds?: string, canvas?: string, [k: string]: unknown }} req */
export function requestDsReview(req) {
  if (listeners.size === 0) {
    waiting = req;
    return false;
  }
  for (const fn of [...listeners]) fn(req);
  return true;
}

export function onDsReviewRequest(fn) {
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
export function resetDsReviewBus() {
  listeners.clear();
  waiting = null;
}
