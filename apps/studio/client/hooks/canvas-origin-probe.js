// Is the canvas listener up? — the question the loading cap asks when a canvas
// has not reported `loaded` in time (issue #115: a dead server vs a canvas that
// never finished compiling).
//
// The canvas origin is a DIFFERENT origin from the shell (DDR-054), and it sends
// no CORS header — on purpose: nothing on the main origin may read canvas-origin
// bodies, and widening that for a liveness bit would be the wrong trade. A plain
// cross-origin `fetch` therefore ALWAYS throws, so the probe used to report
// every slow canvas as `server` (and print two console errors doing it).
//
// `mode: 'no-cors'` asks only "did it answer": a listener that answers gives an
// opaque response (status 0, unreadable, and that is all we need), a dead one
// rejects. A same-origin probe (a cloud cell, or the split off) keeps reading
// `ok`, so a 5xx there still means `server`.
export async function probeCanvasOrigin(canvasOrigin, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${canvasOrigin || ''}/_health`, {
      cache: 'no-store',
      mode: 'no-cors',
    });
    if (r.type === 'opaque') return 'compile';
    return r.ok ? 'compile' : 'server';
  } catch {
    return 'server';
  }
}
