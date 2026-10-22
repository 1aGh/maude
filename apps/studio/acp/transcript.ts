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
  /** S5.7 — the canvas this chat belongs to (design-root-relative, from the
   *  sidecar's `canvas` key, V2-1.12 §5.3). Absent = "no canvas". */
  canvas?: string;
  /** S5.7 — set while the chat is in the trash (ms since epoch). */
  trashedAt?: number;
  /** S5.7 — only search lists archived chats; the plain list never does. */
  archived?: boolean;
  /** S5.18 (G5) — the artboards its latest scoped ask named (ids on `canvas`); the list's "where" line.
   *  Absent = the whole canvas, or no scoped ask yet. */
  artboards?: string[];
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
  /** S5.7 — set while the chat is in the trash (ms since epoch). */
  trashedAt?: number;
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
  /** S5.19 — when the ask was sent (ms, the transcript line's `ts`): the feed's day dividers. User turns only. */
  at?: number;
}

function chatDir(designRoot: string): string {
  return join(designRoot, '_chat');
}

function metaPath(designRoot: string, chatId: string): string {
  return join(chatDir(designRoot), `${chatId}.meta.json`);
}

/** A canvas link is a plain relative path under the design root — never absolute, never `..`.
 *  It is shown and grouped by, so a hand-edited sidecar must not smuggle a path out. */
function plainCanvasKey(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v || v.length > 512) return undefined;
  if (v.startsWith('/') || v.includes('\\') || v.includes('\0')) return undefined;
  if (v.split('/').some((seg) => seg === '..' || seg === '')) return undefined;
  return v;
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
    if (typeof r.trashedAt === 'number' && Number.isFinite(r.trashedAt))
      meta.trashedAt = r.trashedAt;
    return meta;
  } catch {
    return {};
  }
}

/**
 * S5.17 G5 — a chat belongs to the canvas it first asked about (design-relative, the run scope's
 * form): the chat list groups it there. The first scoped ask links it; a later ask on another canvas
 * keeps the first link. No-op when the chat is already linked or the path is not a plain relative one.
 */
export function linkChatCanvas(designRoot: string, chatId: string, canvas: string): void {
  if (!plainCanvasKey(canvas) || plainCanvasKey(readRawChatMeta(designRoot, chatId).canvas)) return;
  writeChatMeta(designRoot, chatId, { canvas });
}

/** Artboard ids as stored/shown: plain ids only, deduped, a handful (the list shows two names and "+N"). */
function plainArtboardIds(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const id of v) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id) || out.includes(id))
      continue;
    out.push(id);
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
}

/**
 * S5.18 (G5) — what a chat last asked about, for the chat list's "where" line: the artboards of its latest scoped
 * ask on its linked canvas. A whole-canvas ask (or a different canvas) clears it — the row then says nothing
 * rather than something stale. Per Mac (`_chat/`, DDR-115); never blocks the prompt.
 */
export function noteChatArtboards(
  designRoot: string,
  chatId: string,
  canvas: string,
  artboards: string[] | '*'
): void {
  const linked = plainCanvasKey(readRawChatMeta(designRoot, chatId).canvas);
  const ids = artboards === '*' ? undefined : plainArtboardIds(artboards);
  const had = plainArtboardIds(readRawChatMeta(designRoot, chatId).artboards);
  const next = linked === canvas ? ids : undefined;
  if (JSON.stringify(next ?? null) === JSON.stringify(had ?? null)) return;
  writeChatMeta(designRoot, chatId, { artboards: next ?? null });
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
  patch: {
    title?: string | null;
    archived?: boolean;
    /** S5.7 — Move to trash stamps it, Restore clears it (`null`). */
    trashedAt?: number | null;
    /** S5.7 — the canvas link (`null` clears it). Only a plain relative path is stored. */
    canvas?: string | null;
    /** S5.18 (G5) — the artboards of its latest scoped ask (`null` clears). */
    artboards?: string[] | null;
  }
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
  if ('trashedAt' in patch) {
    if (typeof patch.trashedAt === 'number' && Number.isFinite(patch.trashedAt))
      next.trashedAt = patch.trashedAt;
    else delete next.trashedAt;
  }
  if ('canvas' in patch) {
    const c = plainCanvasKey(patch.canvas);
    if (c) next.canvas = c;
    else delete next.canvas;
  }
  if ('artboards' in patch) {
    const a = plainArtboardIds(patch.artboards);
    if (a) next.artboards = a;
    else delete next.artboards;
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
  const text = stripAttachmentBlock(stripContextBlock((firstUser?.text as string) ?? ''));
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 60) : 'New chat';
}

/** Everything the list needs from a chat's sidecar, read from the RAW object (keys this
 *  build does not know are ignored, never dropped on disk — `writeChatMeta` keeps them). */
function readListMeta(
  designRoot: string,
  chatId: string
): {
  title?: string;
  archived: boolean;
  canvas?: string;
  trashedAt?: number;
  artboards?: string[];
} {
  const raw = readRawChatMeta(designRoot, chatId);
  const out: {
    title?: string;
    archived: boolean;
    canvas?: string;
    trashedAt?: number;
    artboards?: string[];
  } = {
    archived: raw.archived === true,
  };
  const boards = plainArtboardIds(raw.artboards);
  if (boards) out.artboards = boards;
  if (typeof raw.title === 'string' && raw.title.trim()) out.title = raw.title.trim().slice(0, 200);
  const canvas = plainCanvasKey(raw.canvas);
  if (canvas) out.canvas = canvas;
  if (typeof raw.trashedAt === 'number' && Number.isFinite(raw.trashedAt))
    out.trashedAt = raw.trashedAt;
  return out;
}

/** One pass over `_chat/`: every chat with bytes, with its sidecar facts. The filters
 *  (`archived`, `trashed`) are the callers' — the plain list, the trash and search each
 *  want a different cut of the same scan. */
function scanChats(designRoot: string): ChatSummary[] {
  const dir = chatDir(designRoot);
  if (!existsSync(dir)) return [];
  const out: ChatSummary[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const id = name.replace(/\.jsonl$/, '');
    const meta = readListMeta(designRoot, id);
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
    const extra: Pick<ChatSummary, 'canvas' | 'trashedAt' | 'archived' | 'artboards'> = {};
    if (meta.canvas) extra.canvas = meta.canvas;
    if (meta.artboards) extra.artboards = meta.artboards;
    if (meta.trashedAt !== undefined) extra.trashedAt = meta.trashedAt;
    if (meta.archived) extra.archived = true;
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
      out.push({ id, title: meta.title, updated, renamed: true, ...extra });
      continue;
    }
    const head = readHeadLines(file);
    const lines = parseLines(head.lines);
    // A file with bytes but no parseable line is still a real chat; only a
    // genuinely empty one is skipped (matching the old `lines.length === 0`
    // guard, which could only be reached for an empty/blank file).
    if (lines.length === 0 && head.complete) continue;
    out.push({ id, title: deriveTitle(lines), updated, renamed: false, ...extra });
  }
  return out;
}

/** List chats newest-first. Archived chats (Task C5) and chats in the trash (S5.7) are
 *  excluded — the transcript stays on disk, it just doesn't show up in the switcher. A
 *  user-set title (readChatMeta) wins over the auto-derived first-line one.
 *
 *  `{ trashed: true }` is the trash's own list (S1's Trash panel provider): only trashed
 *  chats, the most recently trashed first, whether or not they were archived before. */
export function listChats(designRoot: string, opts: { trashed?: boolean } = {}): ChatSummary[] {
  const all = scanChats(designRoot);
  if (opts.trashed) {
    return all
      .filter((c) => c.trashedAt !== undefined)
      .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
  }
  return all
    .filter((c) => c.trashedAt === undefined && !c.archived)
    .sort((a, b) => b.updated - a.updated);
}

/** Every chat search may look in: the plain list's chats plus the archived ones (an
 *  archived chat is hidden from the list, not lost). The trash is never searched. */
export function listSearchableChats(designRoot: string): ChatSummary[] {
  return scanChats(designRoot).filter((c) => c.trashedAt === undefined);
}

export interface ChatGroup {
  /** design-root-relative canvas path, or `null` for chats with no canvas link */
  canvas: string | null;
  chats: ChatSummary[];
}

/** Group a (newest-first) chat list by canvas: groups ordered by their newest chat, the
 *  "no canvas" group last. Inside a group the incoming order is kept. */
export function groupChatsByCanvas(chats: readonly ChatSummary[]): ChatGroup[] {
  const by = new Map<string | null, ChatSummary[]>();
  for (const c of chats) {
    const key = c.canvas ?? null;
    const g = by.get(key);
    if (g) g.push(c);
    else by.set(key, [c]);
  }
  const newest = (g: ChatSummary[]) => Math.max(...g.map((c) => c.updated));
  return [...by.entries()]
    .map(([canvas, list]) => ({ canvas, chats: list }))
    .sort((a, b) => {
      if (a.canvas === null) return 1;
      if (b.canvas === null) return -1;
      return newest(b.chats) - newest(a.chats);
    });
}

/** Where a chat stands, for the outbox's pre-send check (G22 / G26): its transcript is
 *  there and live, there but in the trash, or gone. */
export function chatState(designRoot: string, chatId: string): 'live' | 'trashed' | 'missing' {
  if (!existsSync(join(chatDir(designRoot), `${chatId}.jsonl`))) return 'missing';
  return readListMeta(designRoot, chatId).trashedAt !== undefined ? 'trashed' : 'live';
}

/** Move a chat to the trash: `trashedAt` in its sidecar, every other key kept. `null` when
 *  the chat has no transcript. Already in the trash keeps its first `trashedAt`. */
export function trashChat(designRoot: string, chatId: string, now = Date.now()): ChatMeta | null {
  const state = chatState(designRoot, chatId);
  if (state === 'missing') return null;
  if (state === 'trashed') return readChatMeta(designRoot, chatId);
  return writeChatMeta(designRoot, chatId, { trashedAt: now });
}

/** Put a trashed chat back. `false` when it was not in the trash. */
export function restoreChat(designRoot: string, chatId: string): boolean {
  if (chatState(designRoot, chatId) !== 'trashed') return false;
  writeChatMeta(designRoot, chatId, { trashedAt: null });
  return true;
}

/** Clear out the trash: delete the files of trashed chats only (a live chat is never touched,
 *  even when its id is asked for by name). `ids` limits it to those chats. Returns the ids
 *  that were deleted. */
export function clearTrashedChats(designRoot: string, ids?: readonly string[]): string[] {
  const want = ids ? new Set(ids) : null;
  const out: string[] = [];
  for (const c of listChats(designRoot, { trashed: true })) {
    if (want && !want.has(c.id)) continue;
    if (deleteChat(designRoot, c.id)) out.push(c.id);
  }
  return out;
}

/** The ACP session id `claude --resume` takes (the `.session.json` sidecar). `null` when
 *  there is none — or when it could not be a session id: this string is handed to a shell
 *  command by "Open in terminal", so only the id alphabet passes. */
export function readChatSessionId(designRoot: string, chatId: string): string | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(chatDir(designRoot), `${chatId}.session.json`), 'utf8')
    ) as { sessionId?: unknown };
    const id = raw?.sessionId;
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
  } catch {
    return null;
  }
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
/**
 * The attachments block the composer appends (`[maude-attachments note=…]` + one `- <kind> “<name>”: <path>` line
 * per chip, client/v2/ai/attach.js) is context for the agent, not what the person typed: a chat with an
 * attachment titled itself "Make it greener hang [maude-…" (P8-B2). Cut from the header to the end of its bullets.
 */
export function stripAttachmentBlock(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inBlock = false;
  for (const l of lines) {
    if (/^\s*\[maude-attachments[\s\]]/.test(l)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^\s*-\s/.test(l)) continue;
    inBlock = false;
    out.push(l);
  }
  return out.join('\n').replace(/\s+$/, '');
}

export function stripContextBlock(text: string): string {
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
    // S5.17 G3: the scope line (`[maude-scope whole-canvas]`, `… artboards="…"`, `… elements="…"`)
    // rides between the head line and the selection lines since S5.6 — part of the same block.
    if (/^\[maude-context [^\n]*\](\n\[(?:maude-scope|selected:)[^\n]*\])*\s*$/.test(tail)) {
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
        ...(typeof line.ts === 'number' && Number.isFinite(line.ts) ? { at: line.ts } : {}),
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
