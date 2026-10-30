// client/v2/comments/comments-model.js — S9.22: the Comments panel's rules, as pure functions.
//
// CONTRACT §6 (Comments [C7, C8, D8]): a floating panel on the right; filters Open · Mine · Resolved ·
// All, default Open; grouped by canvas; Reopen in a resolved thread; "Delete comment" on your own.
// Everything here takes plain data (the shell's `commentsByFile`) and returns plain data, so the panel
// is a thin view and the same rules answer the agent verb (`maude design comments list --mine …`).
//
// "Mine" = threads YOU STARTED — the same rule as the verb's `--mine` (bin/_comments.mjs), so a person
// and an agent asking for "my comments" get the same list.

import { importedLabel, sanitizeImportedFrom } from '../../../comments/imported-from.ts';
import { whereOf } from '../../../comments/where.ts';

export const FILTERS = Object.freeze(['open', 'mine', 'resolved', 'all']);
export const DEFAULT_FILTER = 'open';

/** Words on the filter strip (CONTRACT §6: Open · Mine · Resolved · All). */
export const FILTER_LABELS = Object.freeze({
  open: 'Open',
  mine: 'Mine',
  resolved: 'Resolved',
  all: 'All',
});

/** The v1 panel's filter ids stay valid input (`all` | `open` | `resolved`); anything else is the default. */
export const asFilter = (v) => (FILTERS.includes(v) ? v : DEFAULT_FILTER);

const isResolved = (c) => c?.status === 'resolved';

/**
 * Did `me` start this thread? The stamped id decides when both sides have one; a desktop record
 * has only a name (comments/ops.ts `isOwnComment` — kept in step with it, minus the actor shape).
 */
export function isMine(c, me) {
  if (!c || !me) return false;
  const meId = typeof me === 'object' ? me.id : undefined;
  const meName = (typeof me === 'object' ? me.name : me) ?? '';
  if (typeof c.authorId === 'string' && c.authorId) return !!meId && c.authorId === meId;
  return (
    typeof c.author === 'string' && c.author !== '' && c.author.trim() === String(meName).trim()
  );
}

/** Does this thread pass `filter`? (`mine` is any status — your resolved ones too.) */
export function passes(c, filter, me) {
  switch (asFilter(filter)) {
    case 'open':
      return !isResolved(c);
    case 'resolved':
      return isResolved(c);
    case 'mine':
      return isMine(c, me);
    default:
      return true;
  }
}

/** { open, mine, resolved, all } over every canvas. */
export function countsOf(commentsByFile, me) {
  const n = { open: 0, mine: 0, resolved: 0, all: 0 };
  for (const list of Object.values(commentsByFile || {})) {
    for (const c of list || []) {
      if (!c) continue;
      n.all++;
      if (isResolved(c)) n.resolved++;
      else n.open++;
      if (isMine(c, me)) n.mine++;
    }
  }
  return n;
}

/**
 * Which empty state the panel is in when no thread is listed (05 · es-panels-canvas, S11.3):
 *   'none'    there are no comments at all — "No comments on Pricing yet."
 *   'done'    Open lists nothing because every comment is resolved — "All done." (the only confetti)
 *   'filter'  another filter is empty while comments exist — a plain line about that filter
 */
export function emptyKind(active, counts) {
  if (!counts.all) return 'none';
  if (active === 'open' && !counts.open) return 'done';
  return 'filter';
}

/** "Jonas" · "Jonas and Tereza" · "Jonas, Tereza and Petra" · "Jonas, Tereza and 2 others". */
export function namesLine(names) {
  const list = (names || []).filter((n) => typeof n === 'string' && n.trim());
  if (list.length <= 1) return list[0] ?? '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} others`;
}

/** The newest moment a thread was touched: its last reply, else its creation. */
export function lastActivity(c) {
  let best = Date.parse(c?.created ?? '') || 0;
  for (const r of Array.isArray(c?.thread) ? c.thread : []) {
    const t = Date.parse(r?.created ?? '') || 0;
    if (t > best) best = t;
  }
  return best;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

/**
 * CONTRACT §4 times: relative first ("2 min ago", "2 h ago", "yesterday"), then absolute as
 * "6 Oct, 14:05" (24-hour). `now` is a Date or ms.
 */
export function commentTime(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const nowMs = now instanceof Date ? now.getTime() : now;
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(t);
  const n = new Date(nowMs);
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  )
    return 'yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export const repliesWord = (n) => `${n} ${n === 1 ? 'reply' : 'replies'}`;

/** "Reels · nábor · at 0:12" / "A4 · plakát" / "Homepage" — the row's `on` line. */
export function onLabel(c, { artboardLabel, canvasLabel } = {}) {
  const w = whereOf(c);
  const parts = [];
  if (w.artboard)
    parts.push(artboardLabel ? artboardLabel(c.file, w.artboard) || w.artboard : w.artboard);
  else if (canvasLabel) parts.push(canvasLabel);
  if (w.kind === 'video' && w.chip) parts.push(w.chip);
  return parts.join(' · ');
}

/** Pin numbers follow the v1 rule (position among the canvas's selector-having comments). */
function numberOf(all, c) {
  const numbered = all.filter((x) => x.selector);
  return numbered.findIndex((x) => x.id === c.id) + 1;
}

/**
 * The panel's groups: [{ file, threads }] for `filter`, newest thread first, the open canvas's group
 * first and then the most recently touched. A group with no thread is not listed.
 */
export function groupThreads(commentsByFile, filter, { me, activePath, now } = {}) {
  const groups = [];
  for (const [file, all] of Object.entries(commentsByFile || {})) {
    const list = (all || []).filter(Boolean);
    const threads = list
      .filter((c) => passes(c, filter, me))
      .map((c) => ({
        ...c,
        n: numberOf(list, c),
        resolved: isResolved(c),
        mine: isMine(c, me),
        // S8.17b - a thread written in Figma: "Jonas · from Figma", else null (the row shows no avatar then)
        importedLabel: importedLabel(sanitizeImportedFrom(c.importedFrom)) || null,
        replies: Array.isArray(c.thread) ? c.thread.length : 0,
        time: commentTime(
          lastActivity(c) ? new Date(lastActivity(c)).toISOString() : c.created,
          now
        ),
      }))
      .sort((a, b) => lastActivity(b) - lastActivity(a));
    if (threads.length) groups.push({ file, threads, latest: lastActivity(threads[0]) });
  }
  groups.sort((a, b) => {
    if (activePath) {
      if (a.file === activePath && b.file !== activePath) return -1;
      if (b.file === activePath && a.file !== activePath) return 1;
    }
    return b.latest - a.latest || a.file.localeCompare(b.file);
  });
  return groups;
}

/**
 * S7's patch note (S7-slices §2): the video timeline's comment flags. `artboard` is
 * `{ id, fps }`; a flag is `{ threadId, frame, t, author, resolved }`, earliest first. Threads
 * without a moment on this artboard are not flags.
 */
export function commentMarks(list, artboard) {
  const fps = artboard && Number.isFinite(artboard.fps) && artboard.fps > 0 ? artboard.fps : 30;
  const out = [];
  for (const c of list || []) {
    if (!c || !artboard || c.artboard !== artboard.id) continue;
    if (typeof c.t !== 'number' || !Number.isFinite(c.t)) continue;
    out.push({
      threadId: c.id,
      frame: Math.round(c.t * fps),
      t: c.t,
      author: typeof c.author === 'string' ? c.author : '',
      resolved: isResolved(c),
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Pending @mention notices for the unread count on the Share cluster's Comments icon. */
export function unreadMentionCount(unread) {
  return unread instanceof Set ? unread.size : Array.isArray(unread) ? new Set(unread).size : 0;
}
