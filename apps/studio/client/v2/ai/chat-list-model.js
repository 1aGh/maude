// client/v2/ai/chat-list-model.js — S5.12 (03 `ai-chat-list`): the chat list as data.
//
// PURE (no DOM, no React, no fetch). The list shows YOUR chats only (S5 D5): Running first, then Earlier
// grouped by canvas with "N more", or — with a query — the search hits with the matched words marked.
// The words are CONTRACT §3–§4: "Move to trash" (never delete), the dialog asks with the verb the button
// carries, and says first what the trash takes with it (V2-1.14 G22: a queued prompt won't send).

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { isVisible } from '../../../actions/resolve.ts';

/** Rows a canvas group shows before "N more" (03 `ai-chat-list`). */
export const VISIBLE_PER_GROUP = 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 24 * 3600 * 1000;

/**
 * P8 C3 (03 ai-chat-list): a chat title is what the person typed. A `[maude-…` / `[selected:` marker that reached it
 * inline (the agent's own auto-title is made from the whole sent text) ends it; nothing left = no title (the caller
 * keeps "New chat"). Mirrors acp/transcript.ts `cutInlineContext`.
 */
export function cleanChatTitle(title) {
  const t = String(title ?? '');
  const i = t.search(/\s*\[(?:maude-[a-z-]+|selected:)/);
  return (i === -1 ? t : t.slice(0, i)).replace(/\s+/g, ' ').trim();
}

/**
 * P8 c6 (03 ai-working "Make it greener"): until the agent names the chat, the title is the first clause of the ask,
 * at most 40 characters. A slash command is not an ask (the chat keeps "New chat").
 */
export function askTitle(text) {
  const t = cleanChatTitle(text);
  if (!t || t.startsWith('/')) return null;
  const first = t.split(/\s*[,;—]\s*|\.\s+|\.$/)[0].trim();
  if (!first) return null;
  return first.length > 40 ? `${first.slice(0, 39).trimEnd()}…` : first;
}

/**
 * P8 c7 (03 ai-working/ai-done "Make it greener"): a title that is only the start of what was typed (the transcript
 * derives it from the first 60 characters of the ask) reads as the ask's first clause, like the board's panel title.
 * "New chat" and a slash command stay as they are.
 */
export function shownChatTitle(title) {
  const t = String(title || '');
  if (!t || t === 'New chat') return t || 'New chat';
  return askTitle(t) ?? t;
}

/** The title a chat's live run gives it (`view.mine` rows carry `chatId` + `label`, the prompt), or null. */
export function runTitleFor(view, chatId) {
  const run = (view?.mine || []).find((r) => r?.chatId === chatId && r.label);
  return run ? askTitle(run.label) : null;
}

const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "now" · "12 min ago" · "3 h ago" · "yesterday" · "Monday" · "2 Oct" — what a row says instead of a stamp. */
export function whenLabel(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const ago = now - ms;
  if (ago < 60_000) return 'now';
  if (ago < 3600_000) return `${Math.floor(ago / 60_000)} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days <= 0) return `${Math.floor(ago / 3600_000)} h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return DAYS[new Date(ms).getDay()];
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A canvas path (`ui/Kampan.tsx`) → the name a person knows it by; none → "No canvas". */
export function canvasName(canvas) {
  if (!canvas) return 'No canvas';
  const base = String(canvas).split('/').pop() || String(canvas);
  return base.replace(/\.(tsx|jsx|html)$/i, '');
}

/** `post-1-1` → "Post 1 1": the last resort when the index has not listed the artboard. */
const humanizeId = (id) => {
  const t = String(id ?? '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Artboard';
};

/** The canvases index (`GET /_api/index` snapshot) as `Map<canvas rel, [{ id, label }]>` — the artboard names. */
export function boardsByRel(snapshot) {
  const out = new Map();
  for (const c of Array.isArray(snapshot?.canvases) ? snapshot.canvases : []) {
    if (!c || typeof c.rel !== 'string') continue;
    out.set(
      c.rel,
      (Array.isArray(c.artboards) ? c.artboards : [])
        .filter((a) => a && typeof a.id === 'string')
        .map((a) => ({ id: a.id, label: a.label || a.id }))
    );
  }
  return out;
}

/**
 * P8 c7 (03 `ai-chat-list`) - canvas path -> the key of its cover picture (`/_api/thumb/<key>`), from the canvases
 * index. A canvas the thumbnail service has not rendered yet has none: its group keeps an empty box.
 */
export function coversByRel(snapshot) {
  const out = new Map();
  for (const c of Array.isArray(snapshot?.canvases) ? snapshot.canvases : []) {
    if (c && typeof c.rel === 'string' && typeof c.cover?.key === 'string' && c.cover.key)
      out.set(c.rel, c.cover.key);
  }
  return out;
}

/**
 * S5.18 G5 — the artboard half of a chat row's second line (03 `ai-chat-list`: "A4 · plakát", "Helma z boku"):
 * the names of the artboards its latest ask named — two, then "+N". Empty when it asked about the whole canvas.
 */
export function artboardWhere(ids, boards) {
  const names = [...new Set(Array.isArray(ids) ? ids : [])].map(
    (id) => boards?.find?.((b) => b.id === id)?.label || humanizeId(id)
  );
  if (names.length > 2) return `${names[0]}, ${names[1]} +${names.length - 2}`;
  return names.join(', ');
}

/** `text` split on `ranges` ([start, end) pairs) → `[{ text, mark }]`. Ranges are clamped, sorted, merged. */
export function markParts(text, ranges) {
  const s = String(text ?? '');
  const rs = (ranges ?? [])
    .map(([a, b]) => [Math.max(0, a), Math.min(s.length, b)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const out = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: s.slice(at, a), mark: false });
    out.push({ text: s.slice(a, b), mark: true });
    at = b;
  }
  if (at < s.length) out.push({ text: s.slice(at), mark: false });
  return out.length ? out : [{ text: s, mark: false }];
}

/** A running chat's place: "Combine-kampan › Post 1:1" when it named artboards, else the canvas alone. */
function runningWhere(c, boards) {
  const at = artboardWhere(c.artboards, boards.get(c.canvas ?? ''));
  return at ? `${canvasName(c.canvas)} › ${at}` : canvasName(c.canvas);
}

/**
 * The browse view. `groups` is `GET /_api/acp/chats?group=canvas` (`[{ canvas, chats }]`); `busy` is
 * `{ chatId: true }` for YOUR chats with a turn in flight; `needs` is the set that waits on you (S5.13
 * fills it); `titles` names a running chat the server has not listed yet (a brand-new one).
 */
export function buildChatList({
  groups = [],
  busy = {},
  needs = new Set(),
  titles = {},
  expanded = new Set(),
  now = Date.now(),
  boards = new Map(),
  covers = new Map(),
} = {}) {
  const known = new Map();
  for (const g of groups)
    for (const c of g.chats ?? []) known.set(c.id, { ...c, canvas: g.canvas });
  const liveIds = [...new Set([...Object.keys(busy).filter((id) => busy[id]), ...needs])];
  const state = (id) => (needs.has(id) ? 'needs' : busy[id] ? 'working' : 'idle');
  const running = liveIds.map((id) => {
    const c = known.get(id);
    return {
      id,
      title: c?.title ?? titles[id] ?? 'New chat',
      where: c ? runningWhere(c, boards) : '',
      when: needs.has(id) ? '' : 'now',
      state: state(id),
    };
  });
  // Needs-you chats first: the list says which one is waiting on a person.
  running.sort((a, b) => (a.state === 'needs' ? 0 : 1) - (b.state === 'needs' ? 0 : 1));
  const live = new Set(liveIds);
  const out = [];
  let total = 0;
  for (const g of groups) {
    const chats = (g.chats ?? []).filter((c) => !live.has(c.id) && !c.trashedAt);
    total += chats.length;
    if (!chats.length) continue;
    const open = expanded.has(g.canvas ?? '');
    const shown = open ? chats : chats.slice(0, VISIBLE_PER_GROUP);
    out.push({
      canvas: g.canvas ?? null,
      name: canvasName(g.canvas),
      cover: covers.get(g.canvas ?? '') ?? null,
      count: chats.length,
      more: chats.length - shown.length,
      rows: shown.map((c) => ({
        id: c.id,
        title: c.title,
        when: whenLabel(c.updated, now),
        state: 'idle',
        where: artboardWhere(c.artboards, boards.get(g.canvas ?? '')),
      })),
    });
  }
  const all = total + running.length;
  return { running, groups: out, total: all, foot: footLine(all) };
}

/** "1 chat" / "41 chats" — the count with its noun (P8 C5: "Searched 1 chat", never "1 chats"). */
export function chatsWord(n) {
  return `${n} ${n === 1 ? 'chat' : 'chats'}`;
}

/** "41 chats · kept with the project" */
export function footLine(n) {
  return `${chatsWord(n)} · kept with the project`;
}

/** The search view: hits grouped by canvas, the title and the snippet carrying their marked words. */
export function buildSearchList(hits = [], _query = '', now = Date.now(), covers = new Map()) {
  const by = new Map();
  for (const h of hits) {
    const key = h.canvas ?? '';
    const list = by.get(key) ?? [];
    list.push({
      id: h.id,
      title: markParts(h.title, h.titleRanges),
      rawTitle: h.title,
      via: h.snippet ? markParts(h.snippet.text, h.snippet.ranges) : null,
      when: whenLabel(h.updated, now),
      state: 'idle',
    });
    by.set(key, list);
  }
  const groups = [...by.entries()].map(([canvas, rows]) => ({
    canvas: canvas || null,
    name: canvasName(canvas),
    cover: covers.get(canvas) ?? null,
    rows,
  }));
  const n = hits.length;
  return {
    groups,
    // no hits: the panel's own empty block says so and the foot keeps counting the chats (S11.3)
    foot: n === 0 ? '' : `${n} ${n === 1 ? 'result' : 'results'}`,
  };
}

/**
 * The row's ⋯ menu — Open · Rename… · Copy transcript · — · Archive · Move to trash. Each item that is a
 * registry action carries its id and is dropped where the registry says it is not visible (rule 12: the
 * server refuses the same writes). `Open` is the row itself.
 */
export function rowMenu(ctx, byId = ACTIONS_BY_ID, o = {}) {
  const item = (id, extra = {}) => {
    const def = byId.get(id);
    if (!def || !isVisible(def, ctx)) return null;
    return { id, label: def.label, ...extra };
  };
  const items = [
    { id: 'open', label: 'Open' },
    item('chat.rename'),
    item('chat.copy-transcript'),
    // S5.15 (V2-1.5 §5.3) — every action your AI made in this chat, as ONE new version; disabled with the
    // update line when the team server is too old (`o.chatUndo` = the server's `chatUndo` probe)
    item(
      'chat.undo',
      o.chatUndo && o.chatUndo.ok === false ? { disabled: true, hint: o.chatUndo.line } : {}
    ),
    'sep',
    item('chat.archive'),
    item('chat.trash', { danger: true }),
  ].filter(Boolean);
  // never a lonely separator
  return items.filter((it, i) => it !== 'sep' || (i > 0 && i < items.length - 1));
}

/** The still-waiting prompts of one chat, from `GET /_api/outbox` (`intents`): lane `ai:<chatId>`. */
export function queuedPromptsOf(view, chatId) {
  const intents = Array.isArray(view?.intents) ? view.intents : [];
  return intents
    .filter(
      (r) =>
        r.kind === 'ai.prompt' &&
        r.lane === `ai:${chatId}` &&
        !['done', 'dropped'].includes(r.state)
    )
    .map((r) => String(r.label ?? ''));
}

/**
 * The trash dialog. The title asks with the verb the button carries (CONTRACT §4); a queued prompt is named
 * first, because moving the chat to the trash withdraws it (V2-1.14 G22). A chat with a turn in flight is
 * not trashed — the server answers 409 `running`, so the dialog says "Stop it first" and offers no verb.
 */
export function trashDialog(title, { queued = [], running = false } = {}) {
  const name = String(title || 'New chat');
  if (running) {
    return {
      title: `"${name}" is working`,
      body: 'Stop it first, then move it to the trash.',
      confirm: null,
      cancel: 'Cancel',
    };
  }
  const n = queued.length;
  const body =
    n === 0
      ? 'Trash keeps it until you clear it out.'
      : n === 1
        ? `Its queued prompt won't send: "${queued[0]}".`
        : `Its ${n} queued prompts won't send.`;
  return {
    title: `Move "${name}" to the trash?`,
    body,
    confirm: 'Move to trash',
    cancel: 'Cancel',
  };
}
