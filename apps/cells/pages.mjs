// The pages a PERSON sees when a project is not simply there — starting up,
// failed to start, or not a project at all (feature-cloud-cost-and-cold-start-ux
// Phase B).
//
// Before these existed, a browser opening a sleeping project got raw developer
// text ("This project could not be started…", a JSON `{error: …}`) or simply
// spun for up to half an hour while the container came up. These answer a
// NAVIGATION only; every API caller keeps the exact body it had.
//
// SCRIPT-FREE, like the provisioning waiting room this mirrors
// (`apps/cloud/checkout-pages.mjs`): the page that appears when something is
// already slow or wrong must not need a bundle to render. Progress is a meta
// refresh of the same URL — when the cell is ready, the refresh simply lands
// on the project.
//
// The brand comes from `apps/cloud/brand.mjs` — imported, not copied, so the
// drift test there (tokens vs `.design/system/maude`) covers these pages too.
//
// THE CANVAS ORIGIN IS UNTRUSTED (DDR-054). Its variant names no project,
// links nowhere, and ships under a CSP that allows nothing but inline style.

import { lockup, PAGE_CSS } from '../cloud/brand.mjs';

/** How often the starting page re-asks, in seconds. */
export const REFRESH_SECONDS = 3;

/**
 * The query parameter the starting page carries between refreshes:
 * `<attempt>.<started ms>`. Cosmetic only — it picks the status line and the
 * elapsed clock, nothing else reads it, and the DO strips it before a request
 * reaches the project.
 */
export const WAIT_PARAM = '__maude_wait';

/** After this long the page says so, honestly and kindly. */
const LONG_WAIT_MS = 3 * 60 * 1000;

const STATUS_LINES = [
  'Stretching…',
  'Finding its slippers…',
  'Brewing the coffee…',
  'Unpacking your canvases…',
  'Warming up the pixels…',
  'Dusting off the artboards…',
  'Lining up the layers…',
  'Almost there — just tying its shoelaces…',
];

const CSS = `${PAGE_CSS}
  main { max-width: 34rem; }
  .status { font-family: var(--font-mono); font-size: var(--type-sm); color: var(--fg-1); margin: 0; }
  .elapsed { font-family: var(--font-mono); font-size: var(--type-xs); color: var(--fg-3); margin: var(--space-2) 0 0; }
  .reassure { margin-top: var(--space-5); }
  .zzz { display: inline-block; margin-left: 0.4em; color: var(--accent); }
  @media (prefers-reduced-motion: no-preference) {
    .zzz { animation: zzz 2.4s ease-in-out infinite; }
    @keyframes zzz { 0%, 100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
  }
`;

/** The CSP every one of these pages is served under. */
export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors *";

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** The mark without the link home — the canvas origin links nowhere. */
function inertLockup() {
  return lockup({ words: 'Maude' })
    .replace(/^<a class="lockup" href="[^"]*">/, '<span class="lockup">')
    .replace(/<\/a>\s*$/, '</span>');
}

function page(title, body, { canvas = false, refreshUrl = null } = {}) {
  const refresh = refreshUrl
    ? `<meta http-equiv="refresh" content="${REFRESH_SECONDS};url=${esc(refreshUrl)}">`
    : '';
  const mark = canvas
    ? inertLockup()
    : lockup({ words: 'Maude Cloud', href: 'https://cloud.maude.sh/' });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}<title>${esc(title)} — Maude</title><style>${CSS}</style></head><body><main>${mark}${body}</main></body></html>`;
}

/**
 * Read the cosmetic wait parameter. Garbage in → a fresh start, never an error.
 * @returns {{ attempt: number, startedAt: number | null }}
 */
export function readWait(url, now = Date.now()) {
  const raw = url.searchParams.get(WAIT_PARAM) ?? '';
  const m = /^(\d{1,4})\.(\d{10,14})$/.exec(raw);
  if (!m) return { attempt: 0, startedAt: null };
  const startedAt = Number(m[2]);
  // A start time in the future, or older than a day, is somebody's typing.
  if (startedAt > now || now - startedAt > 24 * 3600 * 1000) return { attempt: 0, startedAt: null };
  return { attempt: Math.min(Number(m[1]), 9999), startedAt };
}

/** The same URL, one refresh further along. */
export function nextWaitUrl(url, { attempt, startedAt }, now = Date.now()) {
  const next = new URL(url);
  next.searchParams.set(WAIT_PARAM, `${attempt + 1}.${startedAt ?? now}`);
  return `${next.pathname}${next.search}${next.hash}`;
}

/** The URL with the wait parameter gone — what the project actually receives. */
export function stripWait(url) {
  const clean = new URL(url);
  clean.searchParams.delete(WAIT_PARAM);
  return clean;
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "Waking up…". The three promises this page keeps, whatever the words:
 * WHY it is slow (nobody opened it in a while, so it napped), that it is a
 * ONE-OFF (once up, everything is fast), and that the WORK IS SAFE.
 */
export function startingPage({ url, projectName = null, canvas = false, now = Date.now() }) {
  const wait = readWait(url, now);
  const elapsed = wait.startedAt ? now - wait.startedAt : 0;
  const name = canvas || !projectName ? null : projectName;
  const heading = canvas ? 'Waking up this canvas…' : `Waking up ${name ?? 'your project'}…`;
  const status = STATUS_LINES[wait.attempt % STATUS_LINES.length];
  const long =
    elapsed > LONG_WAIT_MS
      ? `<p class="quiet">Big project — it's carrying a lot of photos up the stairs. Still going, promise.</p>`
      : '';
  return page(
    heading,
    `<h1>${esc(heading)}<span class="zzz" aria-hidden="true">z<sup>z</sup></span></h1>
     <p>Nobody's opened this ${canvas ? 'project' : 'one'} in a while, so its server took a nap to save energy. We're brewing it a coffee.</p>
     <div class="card" role="status" aria-live="polite">
       <p class="status">${esc(status)}</p>
       ${elapsed > 0 ? `<p class="elapsed">waiting ${clock(elapsed)}</p>` : ''}
     </div>
     ${long}
     <p class="quiet reassure">This first start takes a minute or two. Once it's up, everything flies like a rocket 🚀 — this only happens after a long break.</p>
     <p class="quiet">Your work is safe. This page refreshes by itself — no need to click anything.</p>`,
    { canvas, refreshUrl: nextWaitUrl(url, wait, now) }
  );
}

/** Something went wrong starting it. A human sentence, a way back, nobody's stack. */
export function couldNotStartPage({ url, reason = null, canvas = false }) {
  const retry = `${stripWait(url).pathname}${stripWait(url).search}`;
  return page(
    'That didn’t go to plan',
    `<h1>Well, that didn’t go to plan.</h1>
     <div class="card"><p style="margin:0">${esc(
       reason ?? 'The project’s server didn’t manage to start this time.'
     )} Your work is safe — nothing was lost.</p></div>
     ${
       canvas
         ? '<p class="quiet reassure">Reload the page to try again.</p>'
         : `<p class="reassure"><a class="btn" href="${esc(retry)}">Try again</a></p>
            <p class="quiet">If it keeps happening, tell us at <a href="mailto:cloud@maude.sh">cloud@maude.sh</a>.</p>`
}`,
    { canvas }
  );
}

/** Nothing lives at this address. */
export function notFoundPage({ canvas = false } = {}) {
  return page(
    'Nothing here',
    `<h1>There’s no Maude project at this address.</h1>
     <p class="quiet">Check the link — or ${
       canvas
         ? 'open the project you meant from Maude.'
         : '<a href="https://cloud.maude.sh/">go to your projects</a>.'
}</p>`,
    { canvas }
  );
}

/** Serve one of the above. */
export function htmlResponse(html, status, { retryAfter = null } = {}) {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': PAGE_CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
  if (retryAfter != null) headers['retry-after'] = String(retryAfter);
  return new Response(html, { status, headers });
}
