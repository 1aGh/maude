// client/v2/comments/mention-model.js — S9.22: "who mentioned me, and have I looked" (pure).
//
// S9-slices Q7/Q8: the hub parses mentions and nudges (toast, native notice, e-mail — S9.18); the
// UNREAD marker is per person on this Mac in the ui-prefs lane, no new runtime path. This derives the
// unread set from the comments themselves (they are the persisted truth, they arrive by sync like any
// other comment) and remembers only what was READ, in the existing `seen` map of ui-prefs:
//
//   seen["cm-mention:<thread>:<message>"] = true      the mention in that message was looked at
//
// so a relaunch keeps the count, a mention that arrives while the app is closed counts when it opens,
// and nothing here needs a second channel to be right. Opening a thread marks its mentions read.

import { handleOfName, normalizeHandle } from '../../../comments/mentions.ts';

const KEY_MAX = 128; // ui-prefs MAP_KEY length cap

/** The `seen` key for the mention in `messageId` of `threadId` (`root` = the first message). */
export function mentionKey(threadId, messageId) {
  const t = String(threadId).slice(0, 56);
  const m = String(messageId).slice(0, 56);
  return `cm-mention:${t}:${m}`.slice(0, KEY_MAX);
}

/** Does `text` @-mention the person whose display name is `meName`? (First-name handle, literal.) */
export function mentionsPerson(text, meName) {
  const mine = normalizeHandle(handleOfName(meName ?? ''));
  if (!mine || typeof text !== 'string') return false;
  for (const m of text.matchAll(/@[\w][\w.-]*/g)) {
    if (normalizeHandle(m[0]) === mine) return true;
  }
  return false;
}

const byMe = (part, meName) =>
  typeof part?.author === 'string' && part.author.trim() === String(meName ?? '').trim();

/**
 * Every mention of `meName` that has not been read: one entry per message that mentions them,
 * written by somebody else (an AI message never mentions — mentions.ts), unread by `seen`.
 * `{ key, file, threadId, messageId, from, at }`, newest last.
 */
export function unreadMentions(commentsByFile, meName, seen = {}) {
  const out = [];
  if (!meName) return out;
  for (const [file, list] of Object.entries(commentsByFile || {})) {
    for (const c of list || []) {
      if (!c || typeof c.id !== 'string') continue;
      const messages = [];
      // A converted sticky's words mention nobody (S4-S9 §3.1), and neither do words imported from
      // another tool (S8.17b): a Figma comment saying "@you" is a quotation, not a message.
      if (!c.from && !c.importedFrom)
        messages.push({
          id: 'root',
          author: c.author,
          authorKind: c.authorKind,
          text: c.text,
          at: c.created,
        });
      for (const r of Array.isArray(c.thread) ? c.thread : []) {
        if (r?.importedFrom) continue;
        messages.push({
          id: r?.id ?? 'reply',
          author: r?.author,
          authorKind: r?.authorKind,
          text: r?.body,
          at: r?.created,
        });
      }
      for (const m of messages) {
        if (m.authorKind === 'ai' || byMe(m, meName)) continue;
        if (!mentionsPerson(m.text, meName)) continue;
        const key = mentionKey(c.id, m.id);
        if (seen?.[key] === true) continue;
        out.push({
          key,
          file,
          threadId: c.id,
          messageId: m.id,
          from: typeof m.author === 'string' && m.author.trim() ? m.author.trim() : 'Someone',
          at: m.at ?? '',
        });
      }
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The number on the Share cluster's Comments icon: threads with something unread, not messages. */
export const unreadThreadCount = (unread) => new Set((unread || []).map((u) => u.threadId)).size;

/** The `seen` patch that marks every mention in `threadId` read (empty when none is unread). */
export function markThreadRead(unread, threadId) {
  const patch = {};
  for (const u of unread || []) if (u.threadId === threadId) patch[u.key] = true;
  return patch;
}

/** The mentions that appeared since `knownKeys` (a Set) — the ones that earn a toast. */
export const newMentions = (unread, knownKeys) =>
  (unread || []).filter((u) => !knownKeys.has(u.key));

const first = (name) => String(name).trim().split(/\s+/)[0] || String(name);

/**
 * CONTRACT §4: ONE action, plain words. `where` = "A4 · plakát" (the artboard or canvas the thread is on).
 * `item` is an `unreadMentions` entry. Shaped as a callout (`callouts-model.js`): key changes with the event.
 */
export function mentionCallout(item, where) {
  const onWhere = where ? ` on ${where}` : '';
  return {
    key: item.key,
    kind: 'mention',
    tone: 'info',
    icon: 'comment-bubble',
    title: `${first(item.from)} mentioned you${onWhere}`,
    action: { id: 'open-thread', label: 'Open' },
  };
}
