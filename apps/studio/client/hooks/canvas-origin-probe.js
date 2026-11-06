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

/** 2.0.7 (#2) — how often a loading canvas whose build is still running is asked about again. */
export const BUILDING_RECHECK_MS = 15000;

/**
 * The loading cap's question (2.0.7, #2): is this canvas still being built? A cold design system on a
 * team server can need longer than the cap, and its frame now waits for the build (`importWhenBuilt`
 * in _shell.html) — so while the server says `building`, the cap answers `building` and the studio
 * keeps the loading screen instead of raising "can't be drawn right now" over a build that is fine.
 * Otherwise the origin probe's answer, as before: `compile` (the origin is up, the canvas never drew)
 * or `server`. Same-origin `/_api/canvas-errors`, the route the card itself reads.
 */
export async function loadCapVerdict({ path, canvasOrigin, fetchImpl = fetch }) {
  try {
    const r = await fetchImpl(`/_api/canvas-errors?canvas=${encodeURIComponent(path)}`, {
      cache: 'no-store',
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.building === true && !(j.errors && j.errors.length)) return 'building';
    }
  } catch {
    /* no answer — the origin probe decides */
  }
  return probeCanvasOrigin(canvasOrigin, fetchImpl);
}

/**
 * The reason the load-failure card names when the server recorded none (2.0.7): which wait ran out.
 * `no-shell` — the canvas frame never started; `slow` — it started and never drew.
 */
export function capReason(shellAlive) {
  return shellAlive ? 'slow' : 'no-shell';
}
