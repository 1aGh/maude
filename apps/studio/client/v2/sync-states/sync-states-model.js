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
/** "18:20" today, "yesterday 18:20", else "3 Oct 18:20" (local time, 24-hour — the CONTRACT's clock). */
export function whenWords(ms, now = Date.now()) {
  const d = new Date(ms);
  const t = `${d.getHours()}:${pad(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const n = new Date(now);
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  if (diff === 0) return t;
  if (diff === 1) return `yesterday ${t}`;
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${d.getDate()} ${month} ${t}`;
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
    return {
      text: since
        ? `${what} since ${whenWords(since, now)} — kept on this Mac`
        : `${what} — kept on this Mac`,
      tone: 'warn',
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
export function conflictCard(c, { me = '' } = {}) {
  const what = kindWord(c?.type);
  const other = firstName(authorOf(c?.theirs));
  const isMe = other && firstName(me) && other.toLowerCase() === firstName(me).toLowerCase();
  const who = other && !isMe ? other : '';
  const deletedMine = !c?.mine;
  const deletedTheirs = !c?.theirs;
  return {
    key: `${c?.slug}#${c?.id}`,
    title: who
      ? `You and ${who} both changed this ${what} while offline.`
      : `This ${what} was changed on two Macs while you were offline.`,
    sub: 'Both versions are here. Keep one, or keep both side by side.',
    mine: { who: 'Yours · this Mac', text: deletedMine ? 'You deleted it.' : textOf(c?.mine) },
    theirs: {
      who: who ? `${who}'s` : 'The other version',
      text: deletedTheirs ? `${who || 'It'} was deleted.` : textOf(c?.theirs),
    },
    keepMine: 'Keep yours',
    keepTheirs: who ? `Keep ${who}'s` : 'Keep theirs',
    // keeping both of a deleted side is keeping the one that is left
    keepBoth: deletedMine || deletedTheirs ? null : 'Keep both',
    hint: 'Whichever you keep, Version history shows the other, with Restore.',
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
