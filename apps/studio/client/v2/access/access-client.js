// client/v2/access/access-client.js — S9.21: Ask to edit, the owner's answer, and the access states in words
// (10 co-ask-edit · co-access-ends · co-browser-view · co-trashed; V2-1.7 §5.6 / §5.9; rule access-in-words).
//
// PURE apart from the injected `fetch`. Three things live here:
//   · the requests: Ask to edit (`POST /_api/share/requests`, `{ canvas? }` ONLY — no note is ever sent, so no
//     text a requester types reaches an owner), the owner's list, Let … edit / Not now (routes/share.ts; the
//     hub decides every one, this only says what it answered);
//   · what an access answer MEANS for the open window: still in, ended (removed / expired), a link turned off,
//     or simply "not here" — and "not here" is said exactly like a canvas that does not exist (no oracle about
//     a canvas the session cannot see, V2-1.16 U1);
//   · the words: the role words (CONTRACT §6), the canvas-only foot and row lines, the toasts.

/** CONTRACT §6 — what each wire role is called, everywhere it is shown (rule access-in-words). */
export const ACCESS_WORDS = Object.freeze({
  owner: 'Owner',
  member: 'Can edit',
  viewer: 'Can comment',
  observer: 'Can view',
});

/** The word for a role, '' for anything else (an id is never shown). */
export const accessWord = (role) => (typeof role === 'string' && ACCESS_WORDS[role]) || '';

export const WORDS = Object.freeze({
  asked: 'Asked. The owner will see your request.',
  queued: 'Queued — sends when this Mac is online.',
  alreadyCan: 'You can already edit this.',
  unavailable: 'Could not ask right now. Try again in a minute.',
  notLinked: 'Ask a project owner for edit access.',
  answered: 'That request is no longer open.',
  tipTitle: (canvas) => `You can look at ${canvas || 'this canvas'}, not change it.`,
  tipLine: 'Ask to edit, top right, sends a request to its owner.',
  asksToEdit: (name, canvas) => `${name || 'Someone'} asks to edit ${canvas || 'this project'}`,
  canViewNow: 'can view it now',
  letEdit: (name) => `Let ${firstName(name) || 'them'} edit`,
  notNow: 'Not now',
  review: 'Review',
  raised: (canvas) => `You can edit ${canvas || 'this project'} now.`,
  endedTitle: (project) => `You no longer have access to ${project || 'this project'}.`,
  endedLine: 'Your last changes were saved first. If this is a surprise, ask someone on the team.',
  backHome: 'Back to Home',
  linkOffTitle: 'This link was turned off.',
  linkOffLine: (canvas) => `Ask the person who shared ${canvas || 'it'} for a new one.`,
  trashedTitle: (who, canvas) =>
    `${who || 'Someone'} moved ${canvas || 'this canvas'} to the trash`,
  // decision v2-lead-trashed-while-open-stops-writes: writes stop; what was not sent yet is parked with it
  trashedLine: 'You can keep looking. Your unsent changes stay with it.',
  restore: 'Restore',
  sharedWithYou: (role) => `Shared with you · ${accessWord(role)}`,
  onlyOne: (canvas) => `Only ${canvas} was shared with you.`,
  onlyMany: (n) => `Only these ${n} canvases were shared with you.`,
});

export function firstName(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s) return '';
  return s.split(/\s+/)[0];
}

/** "Combine-kampan" from "ui/2026/combine/Combine-kampan.tsx". */
export function canvasName(path) {
  if (typeof path !== 'string' || !path) return '';
  const base = path.split('/').pop() || path;
  return base.replace(/\.(tsx|jsx|html)$/i, '');
}

/** A repo path → its designRoot-relative canvas, or null (no canvas, the system tab, outside the root). */
export function canvasRel(path, designRel = '.design') {
  if (typeof path !== 'string' || !path || path.startsWith('__')) return null;
  const root = String(designRel || '.design').replace(/\/+$/, '');
  const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  if (!/\.(tsx|jsx|html)$/i.test(rel) || rel.split('/').some((s) => s === '' || s === '..'))
    return null;
  return rel;
}

async function send(fetchImpl, method, url, body) {
  try {
    const r = await fetchImpl(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text().catch(() => '');
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: r.status, body: parsed };
  } catch {
    return { status: 0, body: null };
  }
}

/** The hub's own words when it gave some (a one-line string), else ours. */
const said = (body, fallback) =>
  typeof body?.error === 'string' && body.error && body.error.length <= 200 ? body.error : fallback;

/**
 * Ask to edit the canvas (`canvas` designRoot-relative) or the project (`canvas` null). The request body is
 * `{ canvas? }` and nothing else — whatever the caller passes besides it is not read.
 * @returns {{ ok: boolean, state: 'asked'|'queued'|'pending'|'already'|'limited'|'not-linked'|'refused'|'unavailable', words: string }}
 */
export async function askToEditRequest({ canvas = null } = {}, fetchImpl = fetch) {
  const body = typeof canvas === 'string' && canvas ? { canvas } : {};
  const r = await send(fetchImpl, 'POST', '/_api/share/requests', body);
  const reason = r.body?.reason;
  if (r.status === 201) return { ok: true, state: 'asked', words: WORDS.asked };
  if (r.status === 202 && r.body?.queued)
    return { ok: true, state: 'queued', words: said({ error: r.body.words }, WORDS.queued) };
  if (reason === 'pending') return { ok: true, state: 'pending', words: said(r.body, WORDS.asked) };
  if (reason === 'already-can-edit') return { ok: true, state: 'already', words: WORDS.alreadyCan };
  if (r.status === 429)
    return { ok: false, state: 'limited', words: said(r.body, WORDS.unavailable) };
  if (reason === 'not-linked') return { ok: false, state: 'not-linked', words: WORDS.notLinked };
  // V2-8.4 — a door the project server does not have (a cell refuses `/_api/share/*` default-closed: 404/405 with a
  // bare `{ error: 'not found' }`) is a route answering, not the hub speaking. Say it as "not linked", never "not found".
  if (r.status === 404 || r.status === 405)
    return { ok: false, state: 'not-linked', words: WORDS.notLinked };
  if (r.status === 0 || r.status >= 500)
    return { ok: false, state: 'unavailable', words: WORDS.unavailable };
  return { ok: false, state: 'refused', words: said(r.body, WORDS.notLinked) };
}

/** The open requests (the owner's). `[]` for anybody else, or when the hub cannot be asked. */
export async function fetchAccessRequests(fetchImpl = fetch) {
  const r = await send(fetchImpl, 'GET', '/_api/share/requests');
  return r.status === 200 && Array.isArray(r.body?.requests) ? r.body.requests : [];
}

/** Let … edit (`approve`) or Not now (`decline`). */
export async function answerAccessRequest(id, verb, fetchImpl = fetch) {
  if (verb !== 'approve' && verb !== 'decline') throw new Error(`answerAccessRequest: ${verb}`);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    return { ok: false, words: WORDS.answered };
  const r = await send(
    fetchImpl,
    'POST',
    `/_api/share/requests/${encodeURIComponent(id)}/${verb}`,
    {}
  );
  if (r.status >= 200 && r.status < 300) return { ok: true, words: '' };
  return { ok: false, words: said(r.body, WORDS.answered) };
}

// ---------------------------------------------------------------------------------------- access states

/**
 * What a refused answer means for the open window (HTTP status + the JSON body of any studio / hub refusal).
 *   `ended`    — this person's access to the project is over (removed, expired): the access card.
 *   `link-off` — the link they came in on was turned off: the link card.
 *   `missing`  — not here. A canvas outside a canvas-only session's grants answers `not-in-scope`, exactly as a
 *                canvas that does not exist; both are `missing` here, so nothing tells one from the other.
 *   null       — not an access answer at all (keep going).
 */
export function accessOutcome(status, body) {
  const reason = typeof body?.reason === 'string' ? body.reason : null;
  if (reason === 'link-off') return { kind: 'link-off' };
  if (
    reason === 'access-withdrawn' ||
    reason === 'removed' ||
    reason === 'access-removed' ||
    reason === 'expired' ||
    reason === 'no-access'
  )
    return { kind: 'ended', reason: reason === 'expired' ? 'expired' : 'removed' };
  if (status === 404 || reason === 'not-in-scope' || reason === 'gone') return { kind: 'missing' };
  return null;
}

/**
 * S9.21d (decision v2-lead-browser-link-off-via-refusal) — what one refused answer means for a BROWSER window.
 * Only the cell door's 401 can end the window: it carries `link-off` / `access-withdrawn` / `expired` for a
 * cookie whose own session an access notice ended. A 401 with no reason (sign in again), every 403 (a role
 * answer) and `missing` change nothing — no false card, and nothing about a canvas the session cannot see.
 */
export function doorRefusal(status, body) {
  if (status !== 401) return null;
  const o = accessOutcome(status, body);
  return o && (o.kind === 'link-off' || o.kind === 'ended') ? o : null;
}

/**
 * S9.21d — a quiet browser tab asks the door itself: on focus, on becoming visible and on this slow tick while
 * showing, one GET of the studio's `/_health` (studio-owned, so it passes the cell door; nothing in it is read).
 * Stops once the window shows a card.
 */
export const REFUSAL_PROBE = Object.freeze({ path: '/_health', ms: 30_000 });

const WATCHED = Symbol.for('maude.access.refusal-watch');

const sameOrigin = (input, origin) => {
  const url =
    typeof input === 'string'
      ? input
      : typeof input?.url === 'string'
        ? input.url
        : String(input ?? '');
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return !!origin && (url === origin || url.startsWith(`${origin}/`));
};

/**
 * Watch the window's own same-origin answers for `doorRefusal` (S9.21d): `win.fetch` is wrapped once and every
 * response still reaches its caller untouched (a clone is read, JSON 401s only). Returns the uninstall, which
 * restores `win.fetch` only while it is still this wrapper. A second watch on the same window is a no-op.
 */
export function watchRefusals(win, onOutcome) {
  const base = win?.fetch;
  if (typeof base !== 'function' || base[WATCHED]) return () => {};
  const wrapped = async (...args) => {
    const r = await base.apply(win, args);
    try {
      if (
        r?.status === 401 &&
        sameOrigin(args[0], win.location?.origin) &&
        (r.headers?.get?.('content-type') ?? '').includes('json')
      ) {
        r.clone()
          .json()
          .then((body) => {
            const o = doorRefusal(401, body);
            if (o) onOutcome(o);
          })
          .catch(() => {});
      }
    } catch {
      /* watching never fails the caller's request */
    }
    return r;
  };
  wrapped[WATCHED] = true;
  win.fetch = wrapped;
  return () => {
    if (win.fetch === wrapped) win.fetch = base;
  };
}

/**
 * A hub `maude.access` notice (V2-1.7 §5.6) → what the window does. It carries no grant data: `raised` re-reads
 * `/api/access/me`; `narrowed` re-reads too (a canvas may be gone now); `ended` is the card, link-off its card.
 */
export function accessNotice(msg) {
  if (msg?.type !== 'maude.access') return null;
  if (msg.change === 'raised') return { kind: 'raised' };
  if (msg.change === 'narrowed') return { kind: 'narrowed' };
  if (msg.change === 'ended')
    return msg.reason === 'link-off'
      ? { kind: 'link-off' }
      : { kind: 'ended', reason: msg.reason === 'expired' ? 'expired' : 'removed' };
  return null;
}

/** A hub `maude.access-request` notice → the owner's toast, or null. Only the name and the canvas are read. */
export function requestNotice(msg) {
  if (msg?.type !== 'maude.access-request' || typeof msg.id !== 'string') return null;
  const name = typeof msg.from?.name === 'string' ? msg.from.name.slice(0, 80) : '';
  const canvas = typeof msg.canvas === 'string' ? msg.canvas : null;
  return {
    id: msg.id,
    text: WORDS.asksToEdit(name, canvas ? canvasName(canvas) : ''),
    action: WORDS.review,
  };
}

/**
 * `/api/access/me` → the Canvases panel's access words (S1-canvas-row-slots §3): a "Shared with you · Can …"
 * line on each canvas granted alone, and for a canvas-only session (no project role) the foot.
 * @returns {{ rows: Map<string, {sub: {text: string, icon: string}}>, foot: {text: string, tone: string} | null, canvasOnly: boolean }}
 */
export function accessSlots(me) {
  const rows = new Map();
  const grants = Array.isArray(me?.grants) ? me.grants : [];
  for (const g of grants) {
    // the claim's own shape is `{ c, r }` (access/scope.ts Grant)
    const c = g?.c ?? g?.canvas;
    const r = g?.r ?? g?.role;
    if (typeof c !== 'string' || !c || !accessWord(r)) continue;
    rows.set(c, {
      sub: { text: WORDS.sharedWithYou(r), icon: r === 'viewer' ? 'comment' : 'eye' },
    });
  }
  const canvasOnly = !me?.role && rows.size > 0;
  let foot = null;
  if (canvasOnly) {
    const [only] = rows.keys();
    foot = {
      text: rows.size === 1 ? WORDS.onlyOne(canvasName(only)) : WORDS.onlyMany(rows.size),
      tone: 'quiet',
    };
  }
  return { rows, foot, canvasOnly };
}

// ---------------------------------------------------------------------------------------- the shell's lanes

/** app.jsx → the access host: the inspector socket's `access` / `access-request` frames, as they came. */
export const ACCESS_FRAME_EVENT = 'maude:access-frame';
/** use-canvas-bridge → the access host: the active (read-only) canvas saw a drag go nowhere. */
export const VIEW_ONLY_EVENT = 'maude:view-only-gesture';

/**
 * A shell socket frame (ws.ts `access:notice`: `{ type: 'access', change, reason? }` /
 * `{ type: 'access-request', id, from, canvas?, at }`) → what the window does, or null. Rebuilt through the
 * same readers as the hub's own notices, so nothing but the known keys is ever read.
 */
export function shellAccessFrame(frame) {
  if (frame?.type === 'access')
    return accessNotice({ type: 'maude.access', change: frame.change, reason: frame.reason });
  if (frame?.type === 'access-request') {
    const r = requestNotice({
      type: 'maude.access-request',
      id: frame.id,
      from: frame.from,
      canvas: frame.canvas,
    });
    return r ? { kind: 'request', ...r } : null;
  }
  return null;
}

// The open tab's canvas is in the trash (S9.21b): the access host publishes it, the Share cluster's mode lane
// reads it (Viewing, no toolbar). One designRoot-relative path or null.
let trashedOpen = null;
const trashedOpenListeners = new Set();
export function setTrashedOpen(rel) {
  const next = typeof rel === 'string' && rel ? rel : null;
  if (next === trashedOpen) return;
  trashedOpen = next;
  for (const fn of trashedOpenListeners) fn();
}
export const getTrashedOpen = () => trashedOpen;
export function subscribeTrashedOpen(fn) {
  trashedOpenListeners.add(fn);
  return () => trashedOpenListeners.delete(fn);
}

// ---------------------------------------------------------------------------------------- the runner rows

/**
 * The shell handlers for the registry ids (menu-runner spreads them). `d.activePath` is the open tab's repo
 * path and `d.designRel` the design root, so the ask names the canvas the way the hub keys a grant
 * (designRoot-relative); no open canvas = the whole project. `d.toast(text, ok)` says the answer (ok = good news).
 * `share.request-approve` / `-decline` take `{ id }`.
 */
export function createAccessHandlers(d, fetchImpl = (...a) => fetch(...a)) {
  return {
    'share.ask-to-edit': async () => {
      const canvas = canvasRel(d.activePath, d.designRel);
      const r = await askToEditRequest({ canvas }, fetchImpl);
      d.toast?.(r.words, r.ok);
      return r;
    },
    'share.request-approve': async (params) => {
      const r = await answerAccessRequest(params?.id, 'approve', fetchImpl);
      if (!r.ok) d.toast?.(r.words);
      return r;
    },
    'share.request-decline': async (params) => {
      const r = await answerAccessRequest(params?.id, 'decline', fetchImpl);
      if (!r.ok) d.toast?.(r.words);
      return r;
    },
  };
}
