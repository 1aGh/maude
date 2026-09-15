// ACP manager: owns one AcpBridge per `/_ws/acp` socket and translates the
// browser's JSON chat protocol to/from the ACP client. Wired into ws.ts (the
// `acp` socket kind) and server.ts (the main-origin, loopback-guarded upgrade).
// NEVER exposed on the canvas origin (DDR-054/DDR-123) — the untrusted iframe
// must not reach the agent bridge.

import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  AvailableCommand,
  CreateElicitationRequest,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type { ServerWebSocket } from 'bun';

import { isCanvasFile } from '../activity.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import type { Context } from '../context.ts';
import type { WsData } from '../ws.ts';
import { buildStudioBrief } from './bootstrap-brief.ts';
import { AcpBridge, type BridgeUsage } from './bridge.ts';
import { isNativePluginContext, resolveSessionPlugins } from './plugin-bootstrap.ts';
import { probeAcpAvailability } from './probe.ts';
import { registerActivityProbe, registerRunningChatsProbe } from './running.ts';
import { readChatLinesAfter } from './transcript.ts';

/**
 * Browser → server frames: `{ t: 'attach', chat, seq }` (Addendum Task 8 — bind
 * this socket to the chat's possibly-already-running bridge and replay the
 * transcript lines after `seq`, which is what the client hydrated over HTTP),
 * `{ t: 'prompt', text, chat?, model?, effort?, mode? }`,
 * `{ t: 'cancel', chat? }`, `{ t: 'warm', chat?, model?, effort?, mode? }` (spawn +
 * create the session so the agent publishes its slash-command catalogue — no
 * prompt sent), `{ t: 'set-mode', chat?, modeId }`, `{ t: 'set-config', chat?,
 * configId, value }` (live change on an already-established session —
 * feature-acp-panel-dynamic-claude-code-capabilities), `{ t: 'permission-response',
 * id, decision }` (Milestone B), `{ t: 'elicitation-response', id, action,
 * content? }` (feature-acp-ask-user-question — `action` is `accept`/`decline`/
 * `cancel`; `content` only meaningful alongside `accept`).
 * Server → browser frames: `ready` (availability on open), `connected` (session
 * live), `update` (each streamed session/update), `commands` (the agent's
 * `available_commands_update` catalogue — cached + replayed on open), `caps`
 * (the session's mode roster + config-option set — dynamic, never hardcoded),
 * `session-info` (agent-generated chat title), `permission-request` (Milestone B
 * approve/deny gate), `elicitation-request` (feature-acp-ask-user-question —
 * `AskUserQuestion` + any MCP-server-originated form), `elicitation-resolved`
 * (a pending elicitation settled via ANY path, including one the client never
 * initiated — timeout/cancel/stop — so the client can drop a now-dead pending
 * card instead of leaving it stuck), `usage` (context-window + cost +
 * rate-limit, Milestone D — cached + replayed on open), `attached` (the answer
 * to `attach`: `{ chat, running }` — `running` tells a reloaded client it
 * re-joined a LIVE turn, so it restores the busy state instead of looking idle
 * while the agent keeps working), `turn-end`, `permission`, `error`.
 * Every `update` frame carries a `seq` — its transcript line — so a client can
 * join the live stream to the history it hydrated without duplicating or
 * dropping output (see `transcript.ts`'s "re-attach seam").
 */
export interface Acp {
  onOpen(ws: ServerWebSocket<WsData>): void;
  onMessage(ws: ServerWebSocket<WsData>, raw: string | Uint8Array): void;
  onClose(ws: ServerWebSocket<WsData>): void;
  /** Live bridge count — for diagnostics / teardown assertions. Counts
   *  DETACHED bridges too, since those are exactly what needs watching now
   *  (Addendum Task 8). */
  size(): number;
  /**
   * Chat ids with a turn in flight right now (Addendum Task 9).
   *
   * Drives the branch-switch warning. A `git checkout` moves the worktree under
   * a running agent — it read `foo.tsx` on `draft-a` and writes it back after
   * the checkout to `main`, a silent cross-branch clobber — and this plan's own
   * premise leans on `_history/` rollback, whose snapshot stack is per-canvas-
   * slug with NO branch awareness. So the "it's reversible" argument degrades
   * exactly here. Task 8 means a reload no longer KILLS the chat, which makes
   * the warning MORE necessary, not less: the turn now survives into a worktree
   * that is no longer the one it was reasoning about.
   */
  runningChats(): string[];
  /** Tear every bridge down, attached or not. The process is going away
   *  (dev-server shutdown / app quit), which is the ONE case the detached
   *  lifetime deliberately does not survive — see DDR-166's SIGTERM-first
   *  path. Extending a session across a *switch* is the whole point; extending
   *  it across a quit is not. */
  stopAll(): void;
}

// RC5 (rca/issue-canvas-hmr-optimistic-update-consistency) — the ACP chat agent
// edits canvases through its own tools, so unlike `/design:edit` (which curls
// /_api/ai/start|heartbeat|end around the edit) nothing announced it: no yellow
// banner, no DDR-078 agent presence, no colored rim. This tracker watches the
// streamed `tool_call` / `tool_call_update` notifications for edit-kind tools
// touching canvas files under <designRoot> and drives the same `ai-activity`
// registry the slash command uses. Keys are designRel-prefixed
// (`.design/ui/foo.tsx`) to match `window.__canvas_meta_file__` on the client.
const AGENT_AUTHOR = 'Claude (Maude chat)';
/** ACP ToolKinds that mutate files — read/search/think tools must not banner. */
const EDIT_KINDS = new Set(['edit', 'delete', 'move']);
/** Local re-beat throttle — well under ai-activity's 30 s grace, but sparse
 *  enough that a chatty turn doesn't broadcast a WS frame per stream chunk. */
const BEAT_MS = 4000;

interface AgentActivityTracker {
  onUpdate(update: SessionUpdate): void;
  /**
   * Turn finished (normal, cancel, error) or socket closed — clear banners.
   * T16: `done` publishes what the turn wrote as ONE project action; anything
   * else (cancel, error, token limit, reap) keeps it unpublished for the
   * person's decision. Default `failed` — only a clean end publishes.
   */
  endTurn(outcome?: 'done' | 'failed'): void;
  /** The prompt this turn answers — the action's history label. */
  beginTurn?(prompt: string): void;
}

/** Exported for tests (acp-ai-activity.test.ts); not part of the Acp surface. */
export function createAgentActivityTracker(
  ctx: Context,
  ai: AiActivity,
  chatId = 'default'
): AgentActivityTracker {
  const kindByToolCall = new Map<string, string>(); // toolCallId → kind
  const lastBeat = new Map<string, number>(); // ai-activity key → last beat ms
  const actionKey = `acp:${chatId}`;
  let turnLabel = 'Claude edit';
  let actionOpen = false;

  function keyFor(p: unknown): string | null {
    if (typeof p !== 'string' || !p) return null;
    const abs = isAbsolute(p) ? p : resolve(ctx.paths.repoRoot, p);
    const rel = relative(ctx.paths.designRoot, abs);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    const posix = rel.split(sep).join('/');
    if (!isCanvasFile(posix)) return null;
    return `${ctx.paths.designRel}/${posix}`;
  }

  function onUpdate(update: SessionUpdate): void {
    const u = update as {
      sessionUpdate?: string;
      toolCallId?: string;
      kind?: string;
      locations?: Array<{ path?: string } | null> | null;
      rawInput?: unknown;
    };
    if (u.sessionUpdate !== 'tool_call' && u.sessionUpdate !== 'tool_call_update') return;
    if (typeof u.kind === 'string' && u.toolCallId) kindByToolCall.set(u.toolCallId, u.kind);
    const kind =
      (typeof u.kind === 'string' ? u.kind : u.toolCallId && kindByToolCall.get(u.toolCallId)) ||
      '';
    if (!EDIT_KINDS.has(kind)) return;
    const candidates: unknown[] = [];
    if (Array.isArray(u.locations)) for (const l of u.locations) candidates.push(l?.path);
    const raw = u.rawInput as
      | { file_path?: unknown; abs_path?: unknown; path?: unknown }
      | null
      | undefined;
    if (raw && typeof raw === 'object') candidates.push(raw.file_path, raw.abs_path, raw.path);
    const now = Date.now();
    for (const p of candidates) {
      const key = keyFor(p);
      if (!key) continue;
      if (!actionOpen) {
        // T16 — the turn's first canvas edit opens its project action.
        actionOpen = true;
        ctx.syncControl?.current?.()?.beginAiAction?.(actionKey, turnLabel);
      }
      const last = lastBeat.get(key);
      if (last == null) {
        ai.start(key, AGENT_AUTHOR);
        lastBeat.set(key, now);
      } else if (now - last > BEAT_MS) {
        ai.heartbeat(key);
        lastBeat.set(key, now);
      }
    }
  }

  function endTurn(outcome: 'done' | 'failed' = 'failed'): void {
    for (const key of lastBeat.keys()) ai.end(key);
    lastBeat.clear();
    kindByToolCall.clear();
    if (actionOpen) {
      actionOpen = false;
      void ctx.syncControl
        ?.current?.()
        ?.endAiAction?.(actionKey, outcome)
        ?.catch(() => {});
    }
  }

  function beginTurn(prompt: string): void {
    const words = prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
    turnLabel = words ? `Claude: ${words}` : 'Claude edit';
  }

  return { onUpdate, endTurn, beginTurn };
}

// ── Detached bridge lifetime (feature-acp-write-path-scope Addendum, Task 8) ──
//
// A bridge used to be keyed by `ws.data.id` and stopped the instant its socket
// closed. That made a PAGE RELOAD a turn-killer: `RepoBranchSwitcher.jsx` calls
// `window.location.reload()` unconditionally on a branch switch, so switching
// drafts mid-turn silently killed the running agent — no warning, and the work
// in flight simply gone (the conversation survived, because the transcript and
// the ACP sessionId are both persisted, which is what made it LOOK like it had
// merely lost its place).
//
// Bridges are now keyed by CHAT and outlive their socket. The client already
// opens one WebSocket per open chat, so this is a lifetime change, not a
// multiplexing one — each bridge still has exactly one chat and one in-flight
// turn, and `AcpBridge.scopeRoot` stays one-to-one with a project.
//
// A detached bridge is a live agent with NOBODY watching — a state this system
// has never had before, so the reapers below are load-bearing rather than
// polish (DDR-125 already books "N processes" as the cost of parallel chats,
// and detaching removes the natural reaper that socket-close used to be).
/** How long a bridge survives with no socket attached before it is torn down. */
export const DETACHED_TTL_MS = 5 * 60_000;
/** Hard ceiling on a detached bridge's total lifetime. A detached bridge whose
 *  turn is still running gets its TTL extended (killing a running turn because
 *  the user reloaded is the bug we are fixing) — but not forever: a wedged turn
 *  must not become an immortal subprocess. */
export const MAX_DETACHED_LIFETIME_MS = 30 * 60_000;
/** How many DETACHED bridges may exist at once. Past this, the
 *  least-recently-active detached bridge is reaped immediately. */
export const MAX_DETACHED_BRIDGES = 3;

/**
 * Hard ceiling on TOTAL bridges (attached + detached).
 *
 * SECURITY (security-auditor A3) — the first cut capped only the detached ones,
 * reasoning that "attached bridges are bounded by how many chats the user has
 * open, i.e. by an explicit human action". That was TRUE while bridges were
 * keyed by `ws.data.id` (one socket, one bridge, and opening a socket is a human
 * act) and stopped being true the moment they were keyed by CHAT: one socket can
 * now mint an unbounded number of bridges just by sending `prompt`/`warm` frames
 * with distinct `chat` values, each spawning its own adapter + `claude` process
 * stack. The premise died with the re-keying and the comment outlived it.
 *
 * Generous — well past any real "how many chats do I have open" — because
 * tripping it means something is wrong, not that someone is working hard.
 */
export const MAX_BRIDGES = 12;

interface BridgeEntry {
  chatId: string;
  bridge: AcpBridge;
  tracker: AgentActivityTracker | null;
  /** Sockets currently receiving this chat's frames. Empty ⇒ detached. */
  sinks: Set<ServerWebSocket<WsData>>;
  /** True between prompt-start and turn-end. A detached bridge with a live turn
   *  is the case this whole change exists to keep alive. */
  turnActive: boolean;
  /** When the last socket detached (0 while attached) — drives the TTL. */
  detachedSince: number;
  /** Last prompt/attach, for least-recently-active eviction. */
  lastActive: number;
  reapTimer: ReturnType<typeof setTimeout> | null;
}

export function createAcp(ctx: Context, aiActivity?: AiActivity): Acp {
  /** chatId → entry. Keyed by CHAT, not by socket — see the block comment above. */
  const bridges = new Map<string, BridgeEntry>();
  /** ws.data.id → the chat ids that socket is attached to (one, in practice —
   *  the client opens a socket per chat — but modelled as a set so a future
   *  multiplexing client can't silently corrupt the detach bookkeeping). */
  const wsChats = new Map<string, Set<string>>();
  // Latest slash-command catalogue seen from ANY bridge this process lifetime.
  // Replayed to a freshly-opened socket so the composer autocomplete is instant
  // on the second panel-open without re-warming. Not persisted (static list in
  // the client covers a cold process); avoids DDR-115 runtime-state churn.
  let latestCommands: AvailableCommand[] = [];
  // Milestone D — same replay-on-open treatment for the last-seen usage
  // snapshot, so a freshly-opened socket shows SOMETHING immediately instead
  // of waiting for the chat's first turn to complete.
  let latestUsage: BridgeUsage | null = null;

  function send(ws: ServerWebSocket<WsData>, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* dead socket — close handler cleans up */
    }
  }

  /**
   * Fan a frame out to every socket attached to this chat.
   *
   * An entry with NO sinks is the detached case, and dropping the frame there
   * is correct, not a gap: every agent update is already on disk in the
   * transcript, and a re-attaching client replays exactly what it missed via
   * the `attach` frame's seq. The transcript is the durable record; this is
   * just the live tail.
   */
  function broadcast(entry: BridgeEntry, payload: unknown): void {
    for (const ws of entry.sinks) send(ws, payload);
  }

  /** Tear a bridge down for good. Idempotent. */
  function reap(entry: BridgeEntry): void {
    if (entry.reapTimer) clearTimeout(entry.reapTimer);
    entry.reapTimer = null;
    bridges.delete(entry.chatId);
    // The agent really is gone now, so any "Claude is editing …" banner it
    // raised must clear — unlike on a mere detach, where the banner is still
    // TRUE (a detached-but-running turn is still editing files).
    entry.tracker?.endTurn();
    void entry.bridge.stop();
  }

  /**
   * Arm (or re-arm) the detached reaper. A detached bridge whose turn is still
   * running gets extensions up to MAX_DETACHED_LIFETIME_MS — reloading a page
   * must not kill a running turn — but a genuinely abandoned one is torn down
   * on the first TTL. Re-attaching cancels the timer (see `attach`).
   */
  function armReap(entry: BridgeEntry): void {
    if (entry.reapTimer) clearTimeout(entry.reapTimer);
    entry.reapTimer = setTimeout(() => {
      entry.reapTimer = null;
      if (entry.sinks.size > 0) return; // re-attached in the meantime
      const detachedFor = Date.now() - entry.detachedSince;
      if (entry.turnActive && detachedFor < MAX_DETACHED_LIFETIME_MS) {
        armReap(entry);
        return;
      }
      reap(entry);
    }, DETACHED_TTL_MS);
  }

  /** Keep the number of DETACHED bridges under the ceiling by reaping the
   *  least-recently-active one. Idle bridges are sacrificed before busy ones —
   *  a detached bridge with a live turn is the thing we are trying to protect,
   *  so it is only evicted when nothing idle is left to take instead. */
  function enforceDetachedCeiling(max: number = MAX_DETACHED_BRIDGES): void {
    for (;;) {
      const detached = [...bridges.values()].filter((e) => e.sinks.size === 0);
      if (detached.length <= max) return;
      detached.sort(
        (a, b) => Number(a.turnActive) - Number(b.turnActive) || a.lastActive - b.lastActive
      );
      reap(detached[0]);
    }
  }

  /** Get-or-create the per-CHAT bridge, wiring its update/permission/command sinks. */
  function getOrCreateEntry(chatId: string): BridgeEntry | null {
    const existing = bridges.get(chatId);
    if (existing) return existing;
    // A3 — before minting a new bridge (and with it a `claude` process stack),
    // make room by reaping detached ones; refuse outright if everything live is
    // attached. Refusing is the safe direction: the user re-sends, versus the
    // process table filling up.
    if (bridges.size >= MAX_BRIDGES) {
      enforceDetachedCeiling(0);
      if (bridges.size >= MAX_BRIDGES) {
        console.error(`[acp] refusing to create bridge for "${chatId}" — ${MAX_BRIDGES} live`);
        return null;
      }
    }
    const tracker = aiActivity ? createAgentActivityTracker(ctx, aiActivity, chatId) : null;
    // Declared before the bridge so the callbacks below can close over it —
    // they fan out to `entry.sinks`, which changes as sockets come and go,
    // rather than capturing one socket the way the per-socket design did.
    const entry: BridgeEntry = {
      chatId,
      // Filled in on the very next statement. The two-step exists because the
      // bridge's callbacks close over `entry` (to reach `entry.sinks`, which
      // changes as sockets attach and detach) — a chicken-and-egg the old
      // per-socket design didn't have, since it captured one fixed `ws`.
      // Safe: `new AcpBridge()` spawns nothing and fires no callback, so no
      // reader can observe the placeholder.
      bridge: null as unknown as AcpBridge,
      tracker,
      sinks: new Set(),
      turnActive: false,
      detachedSince: 0,
      lastActive: Date.now(),
      reapTimer: null,
    };
    entry.bridge = new AcpBridge({
      repoRoot: ctx.paths.repoRoot,
      // Static, config-derived environment brief for every new session
      // (feature-acp-context-hardening; see bootstrap-brief.ts guardrails).
      studioBrief: buildStudioBrief({
        designRel: ctx.paths.designRel,
        projectLabel: ctx.projectLabel,
        // DDR-143 — on the native/desktop path the `/design:*` commands are
        // present in the session (auto-loaded or installed), so the brief states
        // that plainly instead of hedging. (`/flow:*` is intentionally excluded
        // from the chat for now — 2026-07-03.)
        commandsAvailable: isNativePluginContext(),
      }),
      // DDR-143 — session-scoped `design` auto-load for the zero-install desktop
      // path (`/flow` auto-load disabled for now — 2026-07-03). Empty on the
      // power-user (already-installed) + web-serve no-op paths. Computed once
      // here; carried on the readonly bridge options so it survives an adapter
      // re-spawn (model/effort change).
      plugins: resolveSessionPlugins(),
      onUpdate: (update, seq) => {
        tracker?.onUpdate(update);
        // `seq` is the update's transcript line — the re-attach seam. The
        // client drops anything it already hydrated and keeps the rest, so a
        // reload mid-stream neither duplicates nor drops output.
        broadcast(entry, { t: 'update', update, seq });
      },
      onPermission: (req) => broadcast(entry, { t: 'permission', toolCall: req.toolCall }),
      onPermissionRequest: (id, req, scope) =>
        // NOTE (Addendum hazard): if this chat is DETACHED, `broadcast` is a
        // no-op — nobody sees the request, and the bridge's own 120 s timeout
        // denies it (`PERMISSION_TIMEOUT_MS` → `'cancelled'`). That is the
        // intended outcome and it is load-bearing: "no UI attached" must
        // never read as consent. Making detachment auto-approve would reopen,
        // from a new direction, exactly what the write gate closes.
        broadcast(entry, {
          t: 'permission-request',
          id,
          // Echoed so the client can address its response back to the right
          // chat now that a response frame has to name one.
          chat: chatId,
          toolCall: req.toolCall,
          // Already filtered bridge-side for an out-of-project write (no
          // `allow_always` — feature-acp-write-path-scope Decision D); the
          // bridge validates a response against this SAME set, so the client
          // is being shown the real option set, not a cosmetic subset.
          options: req.options,
          // Present ONLY when the write-path gate judged a write tool and
          // declined it — carries the RESOLVED absolute path(s) so the card
          // can name what will actually be written rather than echoing the
          // model's own (possibly `../`-laden) string.
          scope,
        }),
      onElicitationRequest: (id, req: CreateElicitationRequest) =>
        // Same detached-bridge note as onPermissionRequest above: nobody
        // watching ⇒ the bridge's own timeout declines it.
        broadcast(entry, {
          t: 'elicitation-request',
          id,
          chat: chatId,
          message: req.message,
          mode: req.mode,
          // `req.mode === 'form'` is guaranteed by the bridge (it declines
          // any other mode before ever calling onElicitationRequest — see
          // the SECURITY comment in bridge.ts) — this ternary exists for
          // TYPE narrowing (requestedSchema only exists on the form variant
          // of the CreateElicitationRequest union), not as a runtime guard.
          requestedSchema: req.mode === 'form' ? req.requestedSchema : undefined,
          // Forwarded so the client can attribute the request to the actual
          // tool call it's scoped to (when present) instead of a blanket
          // "from Claude" label — ethical-hacker finding: `toolCallId` is
          // present on `ElicitationSessionScope` and was being silently
          // dropped, even though ElicitationPrompt.jsx had nothing else to
          // disambiguate a built-in AskUserQuestion form from an arbitrary
          // connected MCP server's form.
          toolCallId: 'toolCallId' in req ? req.toolCallId : undefined,
        }),
      // A pending elicitation settled via ANY path, including one the
      // client never initiated (a bridge-side timeout, cancel(), stop()) —
      // tells the client to drop it from its own pending list even though
      // it didn't send the `elicitation-response` itself. See the doc
      // comment on `onElicitationSettled` in bridge.ts.
      onElicitationSettled: (id) => broadcast(entry, { t: 'elicitation-resolved', id }),
      onCommands: (commands) => {
        latestCommands = commands;
        broadcast(entry, { t: 'commands', commands });
      },
      onCaps: (modes, configOptions) => broadcast(entry, { t: 'caps', modes, configOptions }),
      onSessionInfo: (info) => broadcast(entry, { t: 'session-info', ...info }),
      onUsage: (usage) => {
        latestUsage = usage;
        broadcast(entry, { t: 'usage', usage });
      },
    });
    bridges.set(chatId, entry);
    return entry;
  }

  /**
   * Bind `ws` to a chat's (possibly already-running) bridge.
   *
   * Called for every chat-addressed frame, not just the explicit `attach` — a
   * client that sends `prompt` straight after connecting must not be treated as
   * detached. Re-attaching cancels the reaper, which is what makes a page
   * reload a no-op for a running turn instead of a kill.
   */
  function attach(ws: ServerWebSocket<WsData>, chatId: string): BridgeEntry | null {
    const entry = getOrCreateEntry(chatId);
    if (!entry) return null;
    entry.sinks.add(ws);
    entry.detachedSince = 0;
    entry.lastActive = Date.now();
    if (entry.reapTimer) {
      clearTimeout(entry.reapTimer);
      entry.reapTimer = null;
    }
    let chats = wsChats.get(ws.data.id);
    if (!chats) {
      chats = new Set();
      wsChats.set(ws.data.id, chats);
    }
    chats.add(chatId);
    return entry;
  }

  /**
   * The entry a control frame (`cancel`, a permission/elicitation response,
   * `set-mode`, `set-config`) is allowed to act on.
   *
   * SECURITY — the socket may only address a chat it is ATTACHED to. This is not
   * incidental: before bridges were re-keyed by chat, every lookup was
   * `bridges.get(ws.data.id)`, so a socket was *structurally* incapable of
   * naming another socket's bridge. Re-keying moved the key into the FRAME, and
   * a first cut resolved `chat` against the whole `bridges` map — which silently
   * widened the surface so any socket could cancel another chat's turn, flip its
   * mode/model, or answer its pending permission. The nonce ids make the last one
   * impractical to hit blind, but "you'd have to guess a UUID" is a weaker
   * guarantee than "the frame cannot name that bridge at all", and DDR-125 F1's
   * posture is explicitly the latter: a loopback frame must not be able to pin a
   * value it was never offered. Restoring the attachment requirement gets the
   * pre-re-keying property back without giving up chat addressing.
   *
   * `prompt`/`warm` deliberately do NOT go through here — opening a chat IS an
   * attach, and that is the feature.
   *
   * Falls back to the single attached chat when the frame names none (the
   * real-world case: the client opens one socket per chat, and older clients
   * send `cancel`/responses without a `chat`). Ambiguity ⇒ null, never a guess.
   */
  function entryForSocket(ws: ServerWebSocket<WsData>, chat?: string): BridgeEntry | null {
    const chats = wsChats.get(ws.data.id);
    if (!chats || chats.size === 0) return null;
    if (chat) {
      const id = sanitizeChatId(chat);
      if (!chats.has(id)) return null; // not this socket's chat — refuse
      return bridges.get(id) ?? null;
    }
    if (chats.size !== 1) return null;
    const [only] = chats;
    return bridges.get(only) ?? null;
  }

  // Chats are repo-level (NOT per-canvas) — `_chat/<chatId>.jsonl`. The id is
  // client-generated; sanitize it to a safe filename.
  function sanitizeChatId(id: string): string {
    const safe = id.replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
    return safe || 'default';
  }
  function chatFilePathFor(chatId: string, suffix: string): string {
    return join(ctx.paths.designRoot, '_chat', `${sanitizeChatId(chatId)}${suffix}`);
  }
  function transcriptPathFor(chatId: string): string {
    return chatFilePathFor(chatId, '.jsonl');
  }
  // Sidecar persisting this chat's ACP sessionId across restarts (bridge.ts
  // sessionFor's resume path) — the cross-restart memory gap tracked in DDR-125.
  function sessionStorePathFor(chatId: string): string {
    return chatFilePathFor(chatId, '.session.json');
  }

  async function handlePrompt(
    ws: ServerWebSocket<WsData>,
    text: string,
    chatId: string,
    model: string | null,
    effort: string | null,
    modeId: string | null
  ): Promise<void> {
    const entry = attach(ws, sanitizeChatId(chatId));
    if (!entry) {
      send(ws, { t: 'error', message: 'Too many chats are open. Close one and try again.' });
      return;
    }
    const { bridge } = entry;
    bridge.setTranscriptPath(transcriptPathFor(chatId));
    bridge.setSessionStorePath(sessionStorePathFor(chatId));
    bridge.setConfig(model, effort, modeId);
    // Marks this bridge as worth keeping alive through a detach. Set BEFORE the
    // first await, so a socket that closes during the spawn still counts as a
    // live turn rather than an abandoned bridge.
    entry.turnActive = true;
    entry.tracker?.beginTurn?.(text);
    let turnOutcome: 'done' | 'failed' = 'failed';
    try {
      await bridge.ensureStarted();
      const { stopReason } = await bridge.prompt(text, sanitizeChatId(chatId));
      // Only a turn that ended on its own publishes; a cancel, a refusal or a
      // token limit leaves its edits for the person (T16).
      if (stopReason === 'end_turn') turnOutcome = 'done';
      broadcast(entry, { t: 'connected', sessionId: bridge.sessionId });
      broadcast(entry, { t: 'turn-end', stopReason });
    } catch (err) {
      broadcast(entry, {
        t: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      entry.turnActive = false;
      entry.lastActive = Date.now();
      // RC5 — the turn is over (success, error, or cancel-induced stop): clear
      // every "Claude is editing …" banner this turn raised. The 30 s heartbeat
      // grace still covers a crashed dev-server round-trip.
      entry.tracker?.endTurn(turnOutcome);
      // The turn was the only reason a detached bridge was being kept alive; now
      // that it's done, let the ordinary TTL run out rather than holding the
      // subprocess indefinitely for a client that never came back.
      if (entry.sinks.size === 0) {
        if (!entry.detachedSince) entry.detachedSince = Date.now();
        armReap(entry);
      }
    }
  }

  /**
   * Warm-up: spawn + create the session (no prompt) so the agent publishes its
   * command catalogue. Best-effort — a failure just means the composer falls back
   * to the static command list until the first real turn.
   */
  async function handleWarm(
    ws: ServerWebSocket<WsData>,
    chatId: string,
    model: string | null,
    effort: string | null,
    modeId: string | null
  ): Promise<void> {
    const entry = attach(ws, sanitizeChatId(chatId));
    if (!entry) return; // at the ceiling — warm-up is best-effort, stay silent
    const { bridge } = entry;
    bridge.setSessionStorePath(sessionStorePathFor(chatId));
    bridge.setConfig(model, effort, modeId);
    try {
      await bridge.warmUp(sanitizeChatId(chatId));
    } catch {
      /* best-effort — no error frame; autocomplete degrades gracefully */
    }
  }

  /** True when `value` is currently offered for the select-type option `configId`
   *  on `bridge`'s last-advertised set — the dynamic replacement for the old
   *  hardcoded VALID_MODELS/VALID_EFFORT allowlists (DDR-125 F1: a loopback
   *  frame still can't pin an arbitrary value onto a live session). */
  function optionOffers(bridge: AcpBridge, configId: string, value: string): boolean {
    const opt = bridge.configOptions.find((o) => o.id === configId);
    if (opt?.type !== 'select') return false;
    const list = Array.isArray(opt.options) ? opt.options : [];
    for (const o of list) {
      if (o && typeof o === 'object' && 'options' in o && Array.isArray(o.options)) {
        if (o.options.some((leaf) => leaf.value === value)) return true;
      } else if (o && typeof o === 'object' && 'value' in o && o.value === value) {
        return true;
      }
    }
    return false;
  }

  /** Live mode change on an already-established session (Task A2/A4). */
  async function handleSetMode(
    ws: ServerWebSocket<WsData>,
    chatId: string | undefined,
    modeId: string
  ): Promise<void> {
    // SECURITY (ethical-hacker A2) — via `entryForSocket`, NOT a raw
    // `bridges.get`. This was the one control frame that escaped the
    // attachment-scoping sweep, and it is the highest-value one to miss:
    // `bypassPermissions` is an advertised mode, and per the plan's F5 it
    // short-circuits adapter-side so `requestPermission` — and therefore the
    // entire write gate — never runs. A raw lookup let any main-origin socket
    // send `{t:'set-mode', chat:'<other-chat>', modeId:'bypassPermissions'}` and
    // switch the gate off for a chat it was never attached to, including a
    // DETACHED one with a live turn and no client watching.
    const entry = entryForSocket(ws, chatId);
    const bridge = entry?.bridge;
    if (!entry || !bridge) return;
    if (!bridge.modes?.availableModes.some((m) => m.id === modeId)) return; // not advertised — reject silently
    try {
      await bridge.setMode(entry.chatId, modeId);
    } catch {
      /* best-effort — the picker just keeps showing the last-confirmed caps frame */
    }
  }

  /** Live config-option change (model/effort/fast/…) on an already-established session. */
  async function handleSetConfig(
    ws: ServerWebSocket<WsData>,
    chatId: string,
    configId: string,
    value: string
  ): Promise<void> {
    // Attachment-scoped via entryForSocket, same as handleSetMode above.
    const bridge = entryForSocket(ws, chatId)?.bridge;
    if (!bridge) return;
    if (!optionOffers(bridge, configId, value)) return; // not advertised — reject silently
    try {
      await bridge.setConfigOption(sanitizeChatId(chatId), configId, value);
    } catch {
      /* best-effort — see handleSetMode */
    }
  }

  // Task 9 — let the HTTP layer ask whether a turn is in flight (the branch-
  // switch warning). Registered as a PULL so the answer is always current; see
  // `running.ts` for why this isn't a `createHttp` parameter or client state.
  registerRunningChatsProbe(() =>
    [...bridges.values()].filter((e) => e.turnActive).map((e) => e.chatId)
  );

  // feature-acp-turn-notifications Task 2 — the richer per-chat snapshot the
  // native shell's poller (notify.rs) reads. `awaiting-input` wins over
  // `running`: a turn blocked on a permission/elicitation prompt is the more
  // actionable of the two, and the one racing `PERMISSION_TIMEOUT_MS`.
  registerActivityProbe(() =>
    [...bridges.values()].map((e) => ({
      chatId: e.chatId,
      state: e.bridge.awaitingInputCount > 0 ? 'awaiting-input' : e.turnActive ? 'running' : 'idle',
    }))
  );

  return {
    onOpen(ws) {
      const probe = probeAcpAvailability();
      send(ws, { t: 'ready', available: probe.available, reason: probe.reason });
      // Replay the last-known command catalogue so autocomplete is instant on a
      // re-open (no re-warm needed within a dev-server lifetime).
      if (latestCommands.length) send(ws, { t: 'commands', commands: latestCommands });
      // Same treatment for usage (Milestone D) — a stale cross-chat snapshot
      // briefly, corrected by the new chat's own first usage_update.
      if (latestUsage) send(ws, { t: 'usage', usage: latestUsage });
    },

    onMessage(ws, raw) {
      let msg: unknown;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const frame = msg as {
        t?: unknown;
        text?: unknown;
        chat?: unknown;
        model?: unknown;
        effort?: unknown;
        mode?: unknown;
        modeId?: unknown;
        configId?: unknown;
        value?: unknown;
        id?: unknown;
        decision?: unknown;
        action?: unknown;
        content?: unknown;
        seq?: unknown;
      };

      const chatId = typeof frame.chat === 'string' && frame.chat ? frame.chat : 'default';
      // Model/effort/mode are opaque, dynamic option ids/values now (no
      // hardcoded allowlist) — a persisted pick that isn't actually offered by
      // the resolved session is silently skipped by the bridge's own
      // `optionOffers` check (`applyDesiredConfigOnce`), never forwarded blind
      // to the adapter. Live mid-session changes (`set-mode`/`set-config`
      // below) DO get validated against the bridge's last-advertised set —
      // that is the DDR-125 F1 boundary that matters (pinning a value onto an
      // ALREADY-running session).
      const model = typeof frame.model === 'string' && frame.model ? frame.model : null;
      const effort = typeof frame.effort === 'string' && frame.effort ? frame.effort : null;
      const modeId = typeof frame.mode === 'string' && frame.mode ? frame.mode : null;

      if (frame.t === 'attach') {
        // Addendum Task 8 — bind this socket to the chat's (possibly still
        // running) bridge and close the re-attach seam.
        //
        // `frame.seq` is the transcript line the client hydrated up to over
        // HTTP. Everything after it is what the client missed while it had no
        // socket — a page reload's own load→connect gap, or a whole detached
        // stretch. Replaying exactly that range is why a reload neither
        // duplicates the last few seconds nor leaves a hole in them.
        const safeChat = sanitizeChatId(chatId);
        const entry = attach(ws, safeChat);
        if (!entry) {
          send(ws, { t: 'error', message: 'Too many chats are open. Close one and try again.' });
          return;
        }
        const from = typeof frame.seq === 'number' && frame.seq >= 0 ? Math.floor(frame.seq) : 0;
        for (const line of readChatLinesAfter(ctx.paths.designRoot, safeChat, from)) {
          if (line.entry.role === 'agent' && line.entry.update) {
            send(ws, { t: 'update', update: line.entry.update, seq: line.seq });
          }
        }
        // Tells the client whether it re-joined a LIVE turn (so it can restore
        // the busy state) rather than a finished one. Without this a reload
        // mid-turn would look idle while the agent kept working.
        send(ws, { t: 'attached', chat: safeChat, running: entry.turnActive });
      } else if (frame.t === 'prompt' && typeof frame.text === 'string') {
        void handlePrompt(ws, frame.text, chatId, model, effort, modeId);
      } else if (frame.t === 'warm') {
        void handleWarm(ws, chatId, model, effort, modeId);
      } else if (frame.t === 'cancel') {
        // RC5 — a cancelled turn may never resolve prompt(); clear banners now.
        const entry = entryForSocket(ws, typeof frame.chat === 'string' ? frame.chat : undefined);
        entry?.tracker?.endTurn();
        void entry?.bridge.cancel();
      } else if (frame.t === 'set-mode' && typeof frame.modeId === 'string' && frame.modeId) {
        // Pass the RAW frame.chat (undefined when absent), not the
        // `'default'`-defaulted `chatId` — otherwise `entryForSocket` takes its
        // named branch and requires `chats.has('default')`, never reaching the
        // "fall back to the single attached chat" path its siblings use. Fails
        // closed either way, but it silently broke mode-switching for a client
        // that omits `chat`. Parity with cancel/permission-response.
        void handleSetMode(
          ws,
          typeof frame.chat === 'string' ? frame.chat : undefined,
          frame.modeId
        );
      } else if (
        frame.t === 'set-config' &&
        typeof frame.configId === 'string' &&
        frame.configId &&
        typeof frame.value === 'string'
      ) {
        void handleSetConfig(ws, chatId, frame.configId, frame.value);
      } else if (frame.t === 'permission-response' && typeof frame.id === 'string' && frame.id) {
        // Milestone B — the human's approve/deny decision for a pending
        // `permission-request`. `decision` is either an offered `optionId` or
        // the literal 'cancelled'; anything else collapses to 'cancelled'
        // (deny) rather than forwarding an unvalidated string as an optionId
        // — resolvePermission itself is a no-op on an unknown/already-settled
        // id, so a malformed decision here just denies, never allows blind.
        const decision =
          typeof frame.decision === 'string' && frame.decision ? frame.decision : 'cancelled';
        entryForSocket(
          ws,
          typeof frame.chat === 'string' ? frame.chat : undefined
        )?.bridge.resolvePermission(frame.id, decision);
      } else if (frame.t === 'elicitation-response' && typeof frame.id === 'string' && frame.id) {
        // feature-acp-ask-user-question — the human's answer/skip/cancel for a
        // pending `elicitation-request`. `action`/`content` are forwarded
        // shallowly; `AcpBridge.resolveElicitation` is the actual fail-closed
        // gate (anything other than a well-formed accept collapses to decline).
        const action = typeof frame.action === 'string' ? frame.action : 'decline';
        const content =
          frame.content && typeof frame.content === 'object' ? frame.content : undefined;
        entryForSocket(
          ws,
          typeof frame.chat === 'string' ? frame.chat : undefined
        )?.bridge.resolveElicitation(frame.id, { action, content });
      }
    },

    /**
     * DETACH — no longer a teardown (Addendum Task 8).
     *
     * This used to call `bridge.stop()` immediately, which is what made a page
     * reload kill a running turn. Now the socket is simply unsubscribed; the
     * bridge keeps running and the reaper decides its fate. Deliberately NOT
     * calling `tracker.endTurn()` either: a detached-but-running turn is still
     * genuinely editing files, so clearing its "Claude is editing …" banner
     * would be a lie. `reap()` clears it when the agent actually stops, and
     * ai-activity's own 30 s heartbeat grace covers a hard crash.
     */
    onClose(ws) {
      const chats = wsChats.get(ws.data.id);
      wsChats.delete(ws.data.id);
      if (!chats) return;
      for (const chatId of chats) {
        const entry = bridges.get(chatId);
        if (!entry) continue;
        entry.sinks.delete(ws);
        if (entry.sinks.size > 0) continue; // still open in another window
        entry.detachedSince = Date.now();
        armReap(entry);
      }
      enforceDetachedCeiling();
    },

    size() {
      return bridges.size;
    },

    runningChats() {
      return [...bridges.values()].filter((e) => e.turnActive).map((e) => e.chatId);
    },

    stopAll() {
      for (const entry of [...bridges.values()]) reap(entry);
    },
  };
}
