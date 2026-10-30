// client/v2/sync-states/sync-states-model.js — S9.24: the words of a day offline, of coming back, and of
// the sticky two Macs changed (10 · co-sync-offline, co-sync-back, co-conflict). Pure: no DOM, no React —
// every word and every precedence is a plain test.
//
//   offline foot   "14 changes since yesterday 18:20 — kept on this Mac"       (setFootSlot('sync'))
//   syncing foot   "Sending 14 changes · 9 sent"                              (same slot, after reconnect)
//   toast          "Back online. Your changes are going up; one sticky needs a look."  (+ Show)
//   card           "You and Jonas both changed this sticky while offline." · Keep yours · Keep Jonas's · Keep both
//
// The foot is S9.24's `sync` source in S1's row-slots store (order sync > arriving > jump > access); it
// says nothing while nothing waits — the panel's own foot is right then.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

const pad = (n) => String(n).padStart(2, '0');
/** "18:20" today, "yesterday 18:20", else "3 Oct, 18:20" (local time, 24-hour — the CONTRACT §4 clock). */
export function whenWords(ms, now = Date.now()) {
  const d = new Date(ms);
  // two-digit hour: "00:19" / "09:15" — the same 24-hour clock as the board ("Tereza changed this · 09:15")
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const n = new Date(now);
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  if (diff === 0) return t;
  if (diff === 1) return `yesterday ${t}`;
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${d.getDate()} ${month}, ${t}`;
}

/**
 * The Canvases panel foot while this Mac holds changes the project has not got.
 * @param {{ kind: string, pending: number, since?: number|null, peak?: number, now?: number }} s
 *   kind: the Share cluster's status kind (save-status.js: offline · syncing · saved · local · not-saved)
 *   since: when the first waiting change was made offline; peak: how many waited when sending began
 * @returns {{ text: string, tone?: 'warn' } | null}
 */
export function syncFoot({ kind, pending, since = null, peak = 0, now = Date.now() } = {}) {
  const waiting = count(pending);
  if (kind === 'offline' && waiting > 0) {
    const what = plural(waiting, 'change', 'changes');
    // 10 co-sync-offline: the panel foot is `.k-cp-foot` (fg-2) — the warn colour belongs to the status
    // word in the cluster ("Offline — kept on this Mac"), so the same sentence is not shouted twice.
    return {
      text: since
        ? `${what} since ${whenWords(since, now)} — kept on this Mac`
        : `${what} — kept on this Mac`,
    };
  }
  if (kind === 'syncing' && waiting > 0) {
    const total = Math.max(count(peak), waiting);
    const sent = total - waiting;
    return { text: `Sending ${plural(total, 'change', 'changes')} · ${sent} sent` };
  }
  return null;
}

/** "Back online. Your changes are going up" — and the sticky that needs a look, only when one waits. */
export function backOnlineToast({ conflicts = 0 } = {}) {
  const n = count(conflicts);
  const head = 'Back online. Your changes are going up';
  if (!n) return { title: `${head}.`, action: null };
  const look = n === 1 ? 'one sticky needs a look' : `${n} stickies need a look`;
  return { title: `${head}; ${look}.`, action: 'Show' };
}

// ── Round 11 (10 co-sync-offline / co-sync-back) ────────────────────────────────────────────────────
// What waits to leave this Mac, per canvas and per comment, read off the ONE outbox view
// (`GET /_api/outbox` → `content.byDoc` / `content.comments`, V2-1.14 §5.10 + fix 5.12c). No second queue.

/** `canvas-slug.ts` `canvasSlugFromRel` for a design-root-relative path. Mirrored, not imported: this
 *  file ships in the browser bundle; `test/p8-r11-10-sync-words.test.ts` pins it to the server. */
export function slugOfRel(rel) {
  let p = String(rel ?? '').replace(/^\/+|\/+$/g, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep as is */
  }
  return p
    .replace(/\//g, '-')
    .replace(/\s+/g, '_')
    .replace(/\.(tsx|html)$/i, '')
    .replace(/^\.+/, '')
    .toLowerCase();
}

/** `sync/doc-name.ts` `sanitizeComponent` — the slug as it travels in a namespaced document name. */
export function wireKeyOfSlug(slug) {
  return String(slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
    .replace(/[-.]+$/g, '');
}

/** The slug part of a document name: `ws/<workspace>/<branch>/<slug>`, or a legacy flat slug. */
const slugOfDoc = (doc) => {
  const parts = String(doc).split('/');
  return parts.length === 4 && parts[0] === 'ws' ? parts[3] : String(doc);
};

/**
 * The Canvases panel's per-row sync words (10 · co-sync-offline "not sent", co-sync-back "sending").
 * A canvas row gets one only while a change of its own waits in the outbox AND the project is in that
 * state — offline says "not sent", syncing says "sending", every other state says nothing.
 * @param {{ kind: string, view: object|null, canvases: Array<{ rel: string }> }} o
 *   canvases: the project index's rows (`GET /_api/index`), `rel` relative to the design root
 * @returns {Map<string, { meta: { word: string, tone: 'quiet', title?: string } }>} keyed by `rel`
 */
export function rowSyncSlots({ kind, view, canvases } = {}) {
  const out = new Map();
  const word = kind === 'offline' ? 'not sent' : kind === 'syncing' ? 'sending' : null;
  const byDoc = view?.content?.byDoc;
  if (!word || !byDoc || typeof byDoc !== 'object') return out;
  const waiting = new Set();
  for (const [doc, v] of Object.entries(byDoc))
    if (count(v?.count) > 0) waiting.add(slugOfDoc(doc));
  if (!waiting.size) return out;
  for (const c of Array.isArray(canvases) ? canvases : []) {
    if (!c || typeof c.rel !== 'string') continue;
    const slug = slugOfRel(c.rel);
    if (!waiting.has(slug) && !waiting.has(wireKeyOfSlug(slug))) continue;
    out.set(c.rel, {
      meta: {
        word,
        tone: 'quiet',
        ...(kind === 'offline' ? { title: 'Kept on this Mac until it is online' } : {}),
      },
    });
  }
  return out;
}

/**
 * Ids of the comments (and replies) the outbox still holds, while the Mac is offline — the ones whose
 * thread card says "Queued — sends when this Mac is online." Online they are about to be accepted, so
 * no word flashes.
 * @returns {Set<string>}
 */
export function queuedCommentIds({ kind, view } = {}) {
  const ids = view?.content?.comments;
  if (kind !== 'offline' || !Array.isArray(ids)) return new Set();
  return new Set(ids.filter((x) => typeof x === 'string'));
}

/** A comment list with `queued: true` on every comment / reply whose id is in `ids`. The list itself and
 *  every untouched comment are returned as they came, so an unchanged thread does not re-render. */
export function markQueued(list, ids) {
  if (!Array.isArray(list) || !ids || !ids.size) return list;
  let changed = false;
  const out = list.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const self = ids.has(c.id);
    const thread = Array.isArray(c.thread) ? c.thread : null;
    const replies = thread?.some((r) => r && ids.has(r.id))
      ? thread.map((r) => (r && ids.has(r.id) ? { ...r, queued: true } : r))
      : null;
    if (!self && !replies) return c;
    changed = true;
    return { ...c, ...(self ? { queued: true } : {}), ...(replies ? { thread: replies } : {}) };
  });
  return changed ? out : list;
}

/** Going from "not reachable" to "reachable" — the one moment the toast is said. */
export function cameBackOnline(prevKind, kind) {
  return prevKind === 'offline' && (kind === 'syncing' || kind === 'saved');
}

const firstName = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)[0] || '';
const authorOf = (el) => {
  const a = el && typeof el === 'object' ? el.author : null;
  return a && typeof a === 'object' && typeof a.name === 'string' ? a.name.slice(0, 80) : '';
};
const textOf = (el) => {
  if (!el || typeof el !== 'object') return '';
  if (typeof el.text === 'string') return el.text;
  if (typeof el.label === 'string') return el.label;
  return '';
};
const kindWord = (type) =>
  ({ sticky: 'sticky', text: 'text', shape: 'shape', arrow: 'arrow', section: 'section' })[type] ||
  'note';

/**
 * One held conflict as the card draws it. `theirs` names the other person when the head's version
 * carries an author (stickies do); otherwise "theirs".
 * @param {object} c  a `GET /_api/sync/conflicts` row
 * @param {{ me?: string }} o
 */
/** When a version was made, if the element says (`at`, ISO or epoch) — else null, and the line drops it. */
const atOf = (el) => {
  const raw = el && typeof el === 'object' ? el.at : null;
  const t = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''));
  return Number.isFinite(t) && t > 0 ? t : null;
};

/** "Yours · yesterday 21:40 · this Mac" — who, when (if known), and whose Mac (10 co-conflict). */
export function versionLine(who, at, where, now = Date.now()) {
  return [who, at ? whenWords(at, now) : '', where].filter(Boolean).join(' · ');
}

export function conflictCard(c, { me = '', now = Date.now() } = {}) {
  const what = kindWord(c?.type);
  const other = firstName(authorOf(c?.theirs));
  const isMe = other && firstName(me) && other.toLowerCase() === firstName(me).toLowerCase();
  const who = other && !isMe ? other : '';
  const deletedMine = !c?.mine;
  const deletedTheirs = !c?.theirs;
  const mineAt = atOf(c?.mine);
  const theirsAt = atOf(c?.theirs);
  return {
    key: `${c?.slug}#${c?.id}`,
    title: who
      ? `You and ${who} both changed this ${what} while offline.`
      : `This ${what} was changed on two Macs while you were offline.`,
    sub: 'Both versions are here. Keep one, or keep both side by side.',
    // CONTRACT §7: an object is *removed*, never "deleted"; a person is never "deleted" either
    mine: {
      who: versionLine('Yours', mineAt, 'this Mac', now),
      name: firstName(me) || 'You',
      at: mineAt,
      text: deletedMine ? 'You removed it.' : textOf(c?.mine),
    },
    theirs: {
      who: who
        ? versionLine(who, theirsAt, 'their Mac', now)
        : versionLine('The other version', theirsAt, '', now),
      name: who,
      at: theirsAt,
      text: deletedTheirs
        ? who
          ? `${who} removed it.`
          : 'It was removed on the other Mac.'
        : textOf(c?.theirs),
    },
    keepMine: 'Keep yours',
    keepTheirs: who ? `Keep ${who}'s` : 'Keep theirs',
    // keeping both of a deleted side is keeping the one that is left
    keepBoth: deletedMine || deletedTheirs ? null : 'Keep both',
    // The line under the two versions — Version history's foot (10 co-conflict `.co-vh-f`): the key
    // hint is drawn beside it, so the words stop where the shortcut starts.
    hint: 'Both stay here whatever you keep.',
    historyKeys: '⌥⌘H',
  };
}

/** The conflicts of the canvas a tab shows (`file` is repo-relative; `activePath` may be either). */
export function conflictsFor(list, activePath, designRel = '.design') {
  if (!activePath) return [];
  const prefix = `${String(designRel).replace(/^\/+|\/+$/g, '')}/`;
  const norm = (p) => {
    const s = String(p ?? '').replace(/^\/+/, '');
    return s.startsWith(prefix) ? s.slice(prefix.length) : s;
  };
  const want = norm(activePath);
  return (Array.isArray(list) ? list : []).filter((c) => norm(c?.file) === want);
}
