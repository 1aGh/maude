// Repo-level chat transcripts (`<designRoot>/_chat/<chatId>.jsonl`). The bridge
// appends raw per-update lines; these readers turn them into the chat list (for
// the switcher) and clean per-turn messages (for hydrating the thread on open).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  countTranscriptLinesAt,
  readHeadLines,
  readTailLines,
  readTailWithSeq,
  TAIL_HYDRATE_BYTES,
} from './transcript-io.ts';

export interface ChatSummary {
  id: string;
  title: string;
  updated: number; // mtime ms
  /** True when `title` came from a user rename (meta.json), not the
   *  auto-derived first line. The client uses this to stop a later live
   *  `session_info_update` (agent auto-title) from clobbering an explicit
   *  rename — see ChatPanel.jsx's `renamedChatIdsRef`. */
  renamed?: boolean;
}

/**
 * User-set overrides (Task C5 — per-chat overflow menu), `<designRoot>/_chat/
 * <chatId>.meta.json`. `title` wins over BOTH the auto-derived first-line
 * title and any live `session_info_update` the agent later emits — an
 * explicit rename must not be silently clobbered by an auto-generated
 * summary landing afterward. `archived` hides the chat from the switcher's
 * recents list (`listChats`) without deleting its transcript.
 */
export interface ChatMeta {
  title?: string;
  archived?: boolean;
}

export interface ChatMessagePart {
  type: 'text' | 'tool';
  text?: string;
  toolName?: string;
  done?: boolean;
}
export interface ChatMessage {
  role: 'user' | 'assistant';
  parts: ChatMessagePart[];
}

function chatDir(designRoot: string): string {
  return join(designRoot, '_chat');
}

function metaPath(designRoot: string, chatId: string): string {
  return join(chatDir(designRoot), `${chatId}.meta.json`);
}

/** Read a chat's meta sidecar. Missing/corrupt/malformed → `{}` (no override),
 *  never throws — a bad sidecar must degrade to "no rename/archive", not break
 *  the switcher. */
export function readChatMeta(designRoot: string, chatId: string): ChatMeta {
  try {
    const raw = JSON.parse(readFileSync(metaPath(designRoot, chatId), 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const r = raw as Record<string, unknown>;
    const meta: ChatMeta = {};
    if (typeof r.title === 'string' && r.title.trim()) meta.title = r.title.trim().slice(0, 200);
    if (typeof r.archived === 'boolean') meta.archived = r.archived;
    return meta;
  } catch {
    return {};
  }
}

/** The sidecar exactly as stored (any keys), or `{}` when missing/corrupt. */
function readRawChatMeta(designRoot: string, chatId: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(metaPath(designRoot, chatId), 'utf8')) as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the chat's meta sidecar (creates `_chat/` if needed).
 *  `title: null` / `archived: false` clear that field rather than deleting
 *  the file — callers pass only the field(s) they're changing.
 *
 *  LOSSLESS (V2-1.12 P2): the patch lands on the RAW stored object, so keys
 *  this build does not know — v2's `canvas` link, anything later — survive a
 *  rename or an archive. The returned value is still the `{title, archived}`
 *  view `readChatMeta` gives. */
export function writeChatMeta(
  designRoot: string,
  chatId: string,
  patch: { title?: string | null; archived?: boolean }
): ChatMeta {
  const dir = chatDir(designRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next: Record<string, unknown> = { ...readRawChatMeta(designRoot, chatId) };
  if ('title' in patch) {
    const t = patch.title?.trim();
    if (t) next.title = t.slice(0, 200);
    else delete next.title;
  }
  if ('archived' in patch) {
    if (patch.archived) next.archived = true;
    else delete next.archived;
  }
  writeFileSync(metaPath(designRoot, chatId), JSON.stringify(next));
  return readChatMeta(designRoot, chatId);
}

/** Parse raw jsonl lines, dropping unparseable ones. Callers hand this a
 *  BOUNDED slice of a transcript (a head or tail window) — never a whole file.
 *  Reading a transcript whole is the #119 defect; see `transcript-io.ts`. */
function parseLines(raw: string[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const l of raw) {
    try {
      out.push(JSON.parse(l) as Record<string, unknown>);
    } catch {
      /* malformed line — skipped */
    }
  }
  return out;
}

// ── The re-attach seam (feature-acp-write-path-scope Addendum, Task 8) ───────
//
// A bridge now outlives its WebSocket, so a page reload (or a branch switch)
// re-attaches to a chat that may have kept streaming while nobody was listening.
// That gives the client TWO sources for the same bytes — the transcript it
// hydrates over HTTP, and the live stream — and the seam between them needs a
// marker, not a guess, or the user sees the last few seconds twice (or loses
// them, if we guess the other way).
//
// The marker is the transcript's RAW line count. It works because the bridge
// appends exactly one line per emitted update, so "line N" and "the Nth thing
// the client should have seen" are the same number by construction.
//
// CRITICAL: these two helpers count/index RAW non-empty lines, deliberately NOT
// PARSED lines — parsing silently drops unparseable lines, and a single corrupt
// line would then shift every subsequent seq by one and permanently desync the
// seam, replaying content the client already has, forever. A malformed line is
// skipped from the RESULT here but still consumes its index.
//
// The counting itself now lives in ONE place — `transcript-io.ts`'s
// `countTranscriptLinesAt`, which `bridge.ts` calls too. It used to be two
// hand-copied bodies held in agreement by a comment saying they must agree
// (#119); a shared function makes the invariant structural instead of
// aspirational.

/** The chat's current sequence marker: how many transcript lines exist. `0` for
 *  a chat with no transcript yet. Handed to the client as the `X-Maude-Chat-Seq`
 *  header on the history fetch, and echoed back on `attach`. */
export function chatTranscriptSeq(designRoot: string, chatId: string): number {
  // Counted in bounded chunks, never by materializing the file as a string —
  // and by the SAME function the bridge's counter calls, so the two cannot
  // drift apart and desync the seam (#119).
  return countTranscriptLinesAt(join(chatDir(designRoot), `${chatId}.jsonl`));
}

/** Transcript lines strictly after `afterSeq`, each paired with its own 1-based
 *  seq — what a re-attaching client missed while it had no socket. Bounded by
 *  `limit` so a client that attaches with `seq: 0` against a long transcript
 *  can't make the server serialize the whole history into WS frames (it already
 *  hydrated that over HTTP; the replay exists for the gap, not for the archive). */
export function readChatLinesAfter(
  designRoot: string,
  chatId: string,
  afterSeq: number,
  limit = 500
): Array<{ seq: number; entry: Record<string, unknown> }> {
  const file = join(chatDir(designRoot), `${chatId}.jsonl`);
  if (!existsSync(file)) return [];
  // The replay window is the TAIL by construction (`limit` most-recent lines),
  // so a tail read suffices — but `seq` is a 1-based index into the WHOLE
  // file, so the skipped prefix still has to be counted (cheaply) to keep the
  // numbering absolute. Counting and reading are separate passes precisely
  // because only one of them needs the bytes.
  //
  // Two bounds now apply, and they do not conflict in practice: `limit`
  // (default 500) caps the RESULT to the newest lines, and the tail window
  // caps the BYTES scanned. A client whose `afterSeq` predates the window
  // would, in principle, miss the lines between — but those are more than
  // `TAIL_HYDRATE_BYTES` back in the file, so `limit` has already truncated
  // them away first. The replay is for the gap since the last hydration, not
  // for the archive (see this function's contract above).
  // ONE descriptor, ONE size snapshot — `readTailWithSeq` resolves the window
  // and its absolute offset together. Doing this as two passes (count, then
  // read) let the bridge's concurrent appends drift `offset` and shift every
  // emitted seq: security review F4, and the very desync this seam exists to
  // prevent.
  const { lines: raw, offset, total } = readTailWithSeq(file);
  if (total === 0) return [];
  const out: Array<{ seq: number; entry: Record<string, unknown> }> = [];
  // Walk from the END so `limit` keeps the MOST RECENT lines — truncating the
  // tail would drop precisely the streaming updates the re-attach is for.
  // `i` indexes the tail window; `offset + i` is the absolute line index, which
  // is what `afterSeq` is expressed in and what `seq` must report.
  const lowest = Math.max(0, afterSeq - offset);
  for (let i = raw.length - 1; i >= lowest && out.length < limit; i--) {
    try {
      out.push({ seq: offset + i + 1, entry: JSON.parse(raw[i]) as Record<string, unknown> });
    } catch {
      /* malformed line — skipped from the result, but its index is still spent */
    }
  }
  return out.reverse();
}

/** First user line, truncated — the chat's display title. Context-attachment
 *  lines are stripped first, so a chat never titles itself `[maude-context …`
 *  (the 2026-07-03 dogfood finding). */
function deriveTitle(lines: Array<Record<string, unknown>>): string {
  const firstUser = lines.find((l) => l.role === 'user' && typeof l.text === 'string');
  const text = stripContextBlock((firstUser?.text as string) ?? '');
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 60) : 'New chat';
}

/** List chats newest-first. Archived chats (Task C5) are excluded — the
 *  transcript stays on disk, it just doesn't show up in the switcher. A
 *  user-set title (readChatMeta) wins over the auto-derived first-line one. */
export function listChats(designRoot: string): ChatSummary[] {
  const dir = chatDir(designRoot);
  if (!existsSync(dir)) return [];
  const out: ChatSummary[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const id = name.replace(/\.jsonl$/, '');
    const meta = readChatMeta(designRoot, id);
    if (meta.archived) continue;
    const file = join(dir, name);
    let updated = 0;
    let size = 0;
    try {
      const st = statSync(file);
      updated = st.mtimeMs;
      size = st.size;
    } catch {
      /* skip unreadable */
    }
    if (size === 0) continue;
    // #119: this used to `readLines(file)` — the WHOLE transcript — for every
    // chat in the directory, to pull ~60 characters out of the first user
    // line, on a path the client fires at every turn end. The first user line
    // sits at the top of the file by construction (only a `role:'bootstrap'`
    // brief can precede it), so a bounded HEAD read answers the same question
    // for a fixed cost no matter how large the transcript has grown.
    //
    // A user-renamed chat needs no scan at all — the title is already in the
    // sidecar, so skip the read entirely.
    if (meta.title) {
      out.push({ id, title: meta.title, updated, renamed: true });
      continue;
    }
    const head = readHeadLines(file);
    const lines = parseLines(head.lines);
    // A file with bytes but no parseable line is still a real chat; only a
    // genuinely empty one is skipped (matching the old `lines.length === 0`
    // guard, which could only be reached for an empty/blank file).
    if (lines.length === 0 && head.complete) continue;
    out.push({ id, title: deriveTitle(lines), updated, renamed: false });
  }
  return out.sort((a, b) => b.updated - a.updated);
}

/** Delete a chat's transcript + its meta/session sidecars. Returns true if
 *  the transcript file was removed (the sidecars are best-effort cleanup). */
export function deleteChat(designRoot: string, chatId: string): boolean {
  const dir = chatDir(designRoot);
  for (const suffix of ['.meta.json', '.session.json']) {
    try {
      rmSync(join(dir, `${chatId}${suffix}`));
    } catch {
      /* absent or unreadable — non-fatal, best-effort cleanup */
    }
  }
  const file = join(dir, `${chatId}.jsonl`);
  if (!existsSync(file)) return false;
  try {
    rmSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * UI-projection strip of the frozen chat-context a send attaches
 * (feature-acp-context-hardening). PROJECTION ONLY — the on-disk jsonl keeps
 * the raw prompt (it's the audit record of what steered the auto-approving
 * agent); the rendered bubble/title shows just what the user typed. Handles
 * both formats: the current TRAILING `[maude-context …]` (+ `[selected: …]`)
 * bracket lines, and the legacy leading `<maude-context>` fence (2026-07-02,
 * one release window). `role:'bootstrap'` brief entries are skipped by this
 * reader by construction (only user/stop/agent roles are consumed below).
 */
function stripContextBlock(text: string): string {
  let out = text;
  if (out.startsWith('<maude-context')) {
    const end = out.indexOf('</maude-context>');
    if (end !== -1) out = out.slice(end + '</maude-context>'.length).replace(/^\s+/, '');
  }
  const i = out.indexOf('\n[maude-context ');
  if (i !== -1) {
    const tail = out.slice(i + 1);
    // Only strip when the remainder is EXACTLY the context block (all lines are
    // bracket lines) — a user merely quoting `[maude-context …]` mid-text stays.
    if (/^\[maude-context [^\n]*\](\n\[selected:[^\n]*\])*\s*$/.test(tail)) {
      out = out.slice(0, i).replace(/\s+$/, '');
    }
  }
  return out;
}

/**
 * Convert the raw transcript into clean per-turn messages: user lines become
 * user messages; the agent updates between them aggregate into one assistant
 * message (text + tool parts; `available_commands_update` / `usage_update` /
 * thoughts dropped — chrome noise, not the conversation).
 */
export function readChatMessages(designRoot: string, chatId: string): ChatMessage[] {
  const file = join(chatDir(designRoot), `${chatId}.jsonl`);
  if (!existsSync(file)) return [];
  // #119: bounded TAIL read. Below `TAIL_HYDRATE_BYTES` — every transcript
  // written since inline blobs stopped being persisted — this reads the whole
  // file and behaves exactly as before. Above it (a historical transcript
  // bloated by base64 tool results), the newest bytes are hydrated and the
  // older ones are left on disk rather than pulled through the server and into
  // the browser. The client's seq-based replay still covers everything
  // appended AFTER hydration, so the live seam is unaffected either way.
  const { lines: raw, truncated } = readTailLines(file, TAIL_HYDRATE_BYTES);
  const lines = parseLines(raw);
  const messages: ChatMessage[] = [];
  if (truncated) {
    messages.push({
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: '_Older messages in this chat are not shown — the transcript exceeds the hydration limit. The full record remains on disk._',
        },
      ],
    });
  }
  let assistant: ChatMessage | null = null;
  const toolIndex = new Map<string, number>();

  const flush = () => {
    if (assistant?.parts.length) messages.push(assistant);
    assistant = null;
    toolIndex.clear();
  };

  for (const line of lines) {
    if (line.role === 'user' && typeof line.text === 'string') {
      flush();
      messages.push({
        role: 'user',
        parts: [{ type: 'text', text: stripContextBlock(line.text) }],
      });
      continue;
    }
    if (line.role === 'stop') {
      flush();
      continue;
    }
    if (line.role !== 'agent') continue;
    const update = line.update as Record<string, unknown> | undefined;
    if (!update) continue;
    if (!assistant) assistant = { role: 'assistant', parts: [] };
    const kind = update.sessionUpdate;
    if (kind === 'agent_message_chunk') {
      const content = update.content as { type?: string; text?: string } | undefined;
      if (content?.type !== 'text' || typeof content.text !== 'string') continue;
      const last = assistant.parts[assistant.parts.length - 1];
      if (last && last.type === 'text') last.text = (last.text ?? '') + content.text;
      else assistant.parts.push({ type: 'text', text: content.text });
    } else if (kind === 'tool_call') {
      const id = String(update.toolCallId ?? '');
      toolIndex.set(id, assistant.parts.length);
      assistant.parts.push({
        type: 'tool',
        toolName: String(update.title ?? update.kind ?? 'tool'),
        done: false,
      });
    } else if (kind === 'tool_call_update') {
      const id = String(update.toolCallId ?? '');
      const idx = toolIndex.get(id);
      const status = update.status;
      if (idx != null && (status === 'completed' || status === 'failed')) {
        const part = assistant.parts[idx];
        if (part) part.done = true;
      }
    }
  }
  flush();
  return messages;
}
