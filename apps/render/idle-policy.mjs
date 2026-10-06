// When the render container may go to sleep — decided on OUR clock.
//
// `@cloudflare/containers` sleeps a container once `sleepAfter` passes with
// `inflightRequests === 0`. That counter is decremented, for any response with
// a body, only when the body has been piped all the way to the client
// (`res.body.pipeTo(writable).finally(decrementInflight)`). A client that stops
// reading — `/_api/export-warmup` aborts its `/_health` after 8 s while a cold
// container is still booting — leaves the pipe unsettled forever, the counter
// never returns to zero, and the container never sleeps. September 2026: one
// instance up 24/7 at ~30 requests a day, ~$23 of a ~$65 bill.
//
// So the library's counter is ignored here. The DO counts the requests it is
// actually serving (entry → the container answered), and a request still
// "open" after the longest a render job may run is treated as leaked. A render
// answers only when it is finished, so "open" really does mean "working".

/** Matches `sleepAfter` on the class. */
export const IDLE_AFTER_MS = 10 * 60 * 1000;

/**
 * The longest one job may legitimately hold a request open: server.ts's flat
 * RENDER_TIMEOUT_MS ceiling (60 min) plus a margin for the container's own
 * cold start in front of it.
 */
export const JOB_MAX_MS = 75 * 60 * 1000;

/**
 * @param {object} o
 * @param {number} o.now
 * @param {number} o.lastActivityAt  last request start OR finish
 * @param {Iterable<number>} o.openSince  start times of requests not yet answered
 */
export function renderIdleExpired({
  now,
  lastActivityAt,
  openSince,
  idleAfterMs = IDLE_AFTER_MS,
  jobMaxMs = JOB_MAX_MS,
}) {
  for (const started of openSince) {
    if (now - started < jobMaxMs) return false; // a job is genuinely running
  }
  return now - lastActivityAt >= idleAfterMs;
}
