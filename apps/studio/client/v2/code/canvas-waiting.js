// client/v2/code/canvas-waiting.js — 2.0.4 task B + #189: the words for a canvas that can't load for a
// reason that is NOT a mistake in its code. The data half; canvas-waiting-card.jsx and
// canvas-error-card.jsx only draw it.
//
//   waiting       files it imports haven't reached this Mac yet (first sync) — "<Canvas> is still downloading."
//   refused       a file it imports is held back (code from a hub this Mac hasn't accepted, too big, …)
//   buildFailure  the build stopped on the app's side (engine unavailable, timed out, imports refused)
//   building      the build is still running on the server (2.0.4 task P) — not a failure
//
// The server answers with its own state and reason WORDS (`canvas-source/waiting.ts`,
// `canvas-source/errors.ts` `BuildFailure`); anything else is dropped here, so no hub text and no
// build text is ever drawn. File names are drawn as text nodes only.

const STATES = new Set(['downloading', 'waiting', 'refused']);
const REASONS = new Set([
  'code-consent',
  'too-large',
  'quota',
  'refused',
  'retrying',
  'not-shared',
]);
const FAILURES = new Set(['engine', 'timed-out', 'memory', 'imports-refused']);

/** Names the card lists before "and N more". */
export const SHOWN_FILES = 5;

const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The server's `waiting` → the card's shape, or null (nothing it waits for). */
export function normalizeWaiting(w) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.files)) return null;
  const files = w.files
    .filter((f) => f && typeof f.rel === 'string' && f.rel && STATES.has(f.state))
    .map((f) => ({
      rel: f.rel.slice(0, 512),
      state: f.state,
      ...(REASONS.has(f.reason) ? { reason: f.reason } : {}),
    }));
  if (!files.length) return null;
  const need =
    w.need && count(w.need.total) > 0
      ? { here: Math.min(count(w.need.here), count(w.need.total)), total: count(w.need.total) }
      : null;
  const progress =
    w.progress && count(w.progress.total) > 0
      ? {
          delivered: Math.min(count(w.progress.delivered), count(w.progress.total)),
          total: count(w.progress.total),
        }
      : null;
  return { files, more: count(w.more), need, progress };
}

/** The server's `buildFailure` → `{ class, count? }`, or null. */
export function normalizeBuildFailure(b) {
  if (!b || typeof b !== 'object' || !FAILURES.has(b.class)) return null;
  return b.class === 'imports-refused'
    ? { class: b.class, count: count(b.count) }
    : { class: b.class };
}

/** `ui/_uniform-template.ts` → `_uniform-template.ts`. */
export const baseName = (rel) =>
  String(rel ?? '')
    .split('/')
    .pop() || String(rel ?? '');

/** "5,041" — counts read the same on every Mac. */
export const num = (n) => count(n).toLocaleString('en-US');

/** Refused outranks waiting: the first held file decides the card, or null when nothing is held. */
export function refusedFile(waiting) {
  return waiting?.files.find((f) => f.state === 'refused') ?? null;
}

/** The card's title. */
export function waitingTitle(name, waiting) {
  return refusedFile(waiting)
    ? `${name} can't open on this Mac yet.`
    : `${name} is still downloading.`;
}

/** The card's sentence under the title: what happened · what is safe · what comes next. */
export function waitingBody(waiting) {
  const held = refusedFile(waiting);
  if (!held)
    return "Some of its files haven't reached this Mac yet. Nothing is lost. The canvas opens by itself when they arrive.";
  const file = baseName(held.rel);
  switch (held.reason) {
    case 'code-consent':
      // fix/207 — the card carries the answer itself (Allow shared code…), so the sentence names it
      return `This Mac hasn't allowed shared code from this project yet (${file}). Nothing is lost. Allow shared code to open it.`;
    case 'too-large':
      return `${file} is too big to sync, so it can't reach this Mac. Nothing is lost.`;
    case 'quota':
      return `This project's upload allowance is used up for now, so ${file} hasn't reached this Mac. Nothing is lost; it arrives once the allowance resets.`;
    default:
      return `The project's server refused ${file}, so it can't reach this Mac. Nothing is lost.`;
  }
}

/** The quiet note beside one listed file (none for a plain download). */
export function fileNote(f) {
  if (f.state === 'refused') return 'held back';
  if (f.reason === 'retrying') return 'retrying';
  if (f.reason === 'not-shared') return 'not shared yet';
  if (f.state === 'waiting') return 'waiting';
  return '';
}

/** "3 of 5 files" for the canvas's bar. */
export function needLabel(need) {
  return need
    ? `${num(need.here)} of ${num(need.total)} ${need.total === 1 ? 'file' : 'files'}`
    : '';
}

/** "Project sync: 5,029 of 5,041 files". */
export function projectLabel(progress) {
  return progress
    ? `Project sync: ${num(progress.delivered)} of ${num(progress.total)} ${progress.total === 1 ? 'file' : 'files'}`
    : '';
}

/** How many names past the first five ("and 3 more"). */
export function moreCount(waiting) {
  return Math.max(0, (waiting?.files.length ?? 0) - SHOWN_FILES) + (waiting?.more ?? 0);
}

// ── 2.0.4 task P: a build that is still running ──────────────────────────────────────────────────

/** The Design system canvas: `system/<ds>/design-system.tsx` (designRoot- or repo-relative). */
const DS_BOARD_RE = /(?:^|\/)system\/[^/]+\/design-system\.tsx$/;

/** The building card's title: the design system by its role, any other canvas by its name. */
export function buildingTitle(canvas, name) {
  return DS_BOARD_RE.test(String(canvas ?? ''))
    ? 'Building the design system…'
    : `Building ${name}…`;
}

export const BUILDING_BODY =
  "This can take a minute on a big project. Nothing is lost. The canvas opens by itself when it's ready.";

// ── #189: a build that stopped on the app's side ─────────────────────────────────────────────────

export const BUILD_FAILURE_BODY =
  "It couldn't be built, and the cause is on the app's side, not in its code. Nothing is lost.";

/** The reason class under Show details, in words. */
export function buildFailureReason(b) {
  switch (b?.class) {
    case 'engine':
      return 'The build engine is unavailable';
    case 'timed-out':
      return 'The build timed out';
    case 'memory':
      return 'The build ran out of memory';
    case 'imports-refused':
      return `${num(b.count)} ${b.count === 1 ? 'import' : 'imports'} refused`;
    default:
      return '';
  }
}
