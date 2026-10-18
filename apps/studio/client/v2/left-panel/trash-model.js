// client/v2/left-panel/trash-model.js — S1.8: the shared Trash, as words (pure; no React, no fetch).
//
// Everything the Trash view says comes from here so a test can pin it: the header count ("3 canvases · 1
// artboard"), the Today / Earlier groups, a row's name and sub ("artboard of Combine-kampan · Jonas, 14:05"),
// what each answer of /_api/trash/restore and /_api/trash/clear is called, and the clear-out confirm. Words
// follow CONTRACT §3 (canvas, artboard — "moved to the trash", "Kept until you clear it out"), §4 (what
// happened · what is safe · one verb; counts write the real noun for 1 and for many; times are 24-hour).
//
// Contract: S1-trash.md §1 (item ids), S1-canvas-row-slots.md §4 (the routes), history/trash.ts (the items
// the route answers: `{ id, kind, group, path, actor, at, label?, artboard?, canvasTrashed? }`).

/** What the view says when the server answers 501 `not-yet` and sent no line of its own. */
export const ARTBOARD_NOT_YET_LINE = 'Restoring one artboard comes with Version history';

export const TRASH_FOOT = 'Kept until you clear it out.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const two = (n) => String(n).padStart(2, '0');

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "just now" · "14:05" (today) · "3 Oct" (before today; "3 Oct 2025" when it was another year). */
export function whenLabel(at, now = Date.now()) {
  const d = new Date(at);
  const n = new Date(now);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, n)) {
    return now - at < 60_000 ? 'just now' : `${two(d.getHours())}:${two(d.getMinutes())}`;
  }
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === n.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/**
 * Who did it: "You" when the server says it was this person (`mine`), else the name the server sent
 * (`who`) or a `people` map knows (actor id → name), else — a local project is one person's — a
 * `local:` actor is "You". An actor nobody can name reads "Someone", never an id.
 */
export function whoLabel(item, people) {
  if (item.mine === true) return 'You';
  if (typeof item.who === 'string' && item.who) return item.who;
  const named = people?.[item.actor];
  if (typeof named === 'string' && named) return named;
  if (typeof item.actor === 'string' && item.actor.startsWith('local:')) return 'You';
  return 'Someone';
}

const baseName = (p) => {
  const file = String(p || '')
    .split('/')
    .pop();
  return file.replace(/\.(tsx|jsx|html)$/i, '');
};

/** The folder a canvas lives in, designRoot-relative: "ui/club-web/A.tsx" → "ui/club-web"; the top → "root". */
export function folderOf(path) {
  const parts = String(path || '').split('/');
  parts.pop();
  return parts.join('/') || 'root';
}

/** A row's name: the canvas name, or the artboard's label (its id when it had none). */
export function itemName(item) {
  if (item.kind === 'artboard') return item.label || item.artboard || 'Untitled artboard';
  return baseName(item.path) || 'Untitled canvas';
}

/** A row's second line: "root · You, just now" / "artboard of Combine-kampan · Jonas, 14:05". */
export function itemSub(item, { people, now } = {}) {
  const by = `${whoLabel(item, people)}, ${whenLabel(item.at, now)}`;
  if (item.kind === 'artboard') {
    const from = baseName(item.path) || 'a canvas';
    return `artboard of ${from}${item.canvasTrashed ? ' (in the trash)' : ''} · ${by}`;
  }
  return `${folderOf(item.path)} · ${by}`;
}

/** Today / Earlier, in the order the server sent (newest first). Empty groups are left out. */
export function groupTrash(items, now = Date.now()) {
  const today = [];
  const earlier = [];
  for (const it of items || []) {
    const g = it.group ?? (sameDay(new Date(it.at), new Date(now)) ? 'today' : 'earlier');
    (g === 'today' ? today : earlier).push(it);
  }
  const out = [];
  if (today.length) out.push({ key: 'today', title: 'Today', items: today });
  if (earlier.length) out.push({ key: 'earlier', title: 'Earlier', items: earlier });
  return out;
}

const noun = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function trashCounts(items) {
  let canvases = 0;
  let artboards = 0;
  for (const it of items || []) {
    if (it.kind === 'artboard') artboards += 1;
    else canvases += 1;
  }
  return { canvases, artboards };
}

/** "3 canvases · 1 artboard" — only the parts there are; '' while empty. */
export function trashHeadCount(items) {
  const { canvases, artboards } = trashCounts(items);
  return [
    canvases ? noun(canvases, 'canvas', 'canvases') : '',
    artboards ? noun(artboards, 'artboard', 'artboards') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "3 canvases and 1 artboard" — the sentence form. */
export function trashSentenceCount(items) {
  return trashHeadCount(items).replace(' · ', ' and ');
}

/**
 * The clear-out confirm. The title asks with the primary button's own verb (CONTRACT §4). `project` is the
 * team's name when the trash is shared with others ("for everyone on Alligators brand"); a local project
 * has no one else to name.
 */
export function clearOutDialog(items, project) {
  const total = (items || []).length;
  const what = trashSentenceCount(items);
  const verb = total === 1 ? 'goes' : 'go';
  const everyone = project ? ` — for everyone on ${project}` : '';
  return {
    title: 'Clear out the trash?',
    primary: 'Clear out',
    body: `${what} ${verb} for good${everyone}. Restore can’t bring ${total === 1 ? 'it' : 'them'} back after this.`,
  };
}

const quoted = (s) => `“${s}”`;

/**
 * What a restore answer is called. `res` is `{ status, body }` from POST /_api/trash/restore. Returns
 * `{ ok, tone, line }`; a refusal is a quiet line, never an alarm (CONTRACT §4: what happened · what is
 * safe · one verb). `not-yet` (an artboard, until Version history) is the one expected refusal.
 */
export function restoreOutcome(item, res) {
  const { status, body } = res;
  const b = body || {};
  if (status >= 200 && status < 300 && b.ok !== false) {
    if (b.queued)
      return {
        ok: true,
        tone: 'quiet',
        line: 'Restore queued — it goes through when this Mac is back online.',
      };
    const name = item.kind === 'canvas' && b.path ? baseName(b.path) : itemName(item);
    return {
      ok: true,
      tone: 'quiet',
      line: b.renamed ? `Restored as ${quoted(name)}.` : `Restored ${quoted(name)}.`,
    };
  }
  const reason = b.reason;
  if (status === 501 || reason === 'not-yet')
    return { ok: false, tone: 'quiet', notYet: true, line: `${b.line || ARTBOARD_NOT_YET_LINE}.` };
  if (reason === 'cleared')
    return { ok: false, tone: 'quiet', line: 'That one was cleared out, so it can’t come back.' };
  if (reason === 'canvas-trashed')
    return {
      ok: false,
      tone: 'quiet',
      line: 'Its canvas is in the trash too. Restore the canvas first.',
    };
  if (reason === 'not-in-trash')
    return { ok: false, tone: 'quiet', line: 'That one is not in the trash any more.' };
  if (reason === 'taken')
    return {
      ok: false,
      tone: 'quiet',
      line: 'Every name for it is taken. Rename one and try again.',
    };
  if (reason === 'needs-hub-update')
    return {
      ok: false,
      tone: 'quiet',
      line: `${b.line || 'The Trash needs the team server to be updated'}.`,
    };
  if (reason === 'forbidden' || reason === 'not-in-scope' || status === 403)
    return {
      ok: false,
      tone: 'warn',
      line: 'You can’t restore this one. Ask an editor or an owner.',
    };
  if (
    status === 503 ||
    reason === 'unreachable' ||
    reason === 'store-locked' ||
    reason === 'retryable'
  )
    return {
      ok: false,
      tone: 'warn',
      line: 'The team server did not answer. Nothing was changed. Try again.',
    };
  return { ok: false, tone: 'warn', line: 'That did not complete. Nothing was changed.' };
}

/** What a clear-out answer is called. `res` is `{ status, body }` from POST /_api/trash/clear. */
export function clearOutcome(res) {
  const { status, body } = res;
  const b = body || {};
  if (status >= 200 && status < 300 && b.ok !== false) {
    if (b.queued)
      return {
        ok: true,
        tone: 'quiet',
        line: 'Clear out queued — it goes through when this Mac is back online.',
      };
    const n = Array.isArray(b.cleared) ? b.cleared.length : 0;
    const left = Array.isArray(b.skipped) ? b.skipped.length : 0;
    return {
      ok: true,
      tone: 'quiet',
      line: `Cleared out ${n}.${left ? ` ${left} left as ${left === 1 ? 'it was' : 'they were'}.` : ''}`,
    };
  }
  if (b.reason === 'forbidden' || b.reason === 'not-in-scope' || status === 403)
    return {
      ok: false,
      tone: 'warn',
      line: 'Only an owner clears out the trash. Nothing was changed.',
    };
  if (b.reason === 'needs-hub-update')
    return {
      ok: false,
      tone: 'quiet',
      line: `${b.line || 'The Trash needs the team server to be updated'}.`,
    };
  if (
    status === 503 ||
    b.reason === 'unreachable' ||
    b.reason === 'store-locked' ||
    b.reason === 'retryable'
  )
    return {
      ok: false,
      tone: 'warn',
      line: 'The team server did not answer. Nothing was changed. Try again.',
    };
  return { ok: false, tone: 'warn', line: 'That did not complete. Nothing was changed.' };
}
