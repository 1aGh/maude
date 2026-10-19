// ACP manager: owns one AcpBridge per `/_ws/acp` socket and translates the
// browser's JSON chat protocol to/from the ACP client. Wired into ws.ts (the
// `acp` socket kind) and server.ts (the main-origin, loopback-guarded upgrade).
// NEVER exposed on the canvas origin (DDR-054/DDR-123) — the untrusted iframe
// must not reach the agent bridge.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  AvailableCommand,
  CreateElicitationRequest,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type { ServerWebSocket } from 'bun';
import { isCanvasFile } from '../activity.ts';
import { readOnlyRootsFor } from '../ai/attach-grants.ts';
import {
  ASK_ID_RE,
  type ElementRef,
  isLive,
  type RunRecord,
  type RunScope,
} from '../ai/run-lifecycle.ts';
import type { RunRegistry } from '../ai/runs.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import type { Context } from '../context.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import type { WsData } from '../ws.ts';
import { type AskQueue, noteRateLimit, promptLabel } from './ask-queue.ts';
import { buildStudioBrief } from './bootstrap-brief.ts';
import { AcpBridge, type BridgeUsage } from './bridge.ts';
import { isNativePluginContext, resolveSessionPlugins } from './plugin-bootstrap.ts';
import { probeAcpAvailability } from './probe.ts';
import { registerActivityProbe, registerRunningChatsProbe } from './running.ts';
import { linkChatCanvas, noteChatArtboards, readChatLinesAfter } from './transcript.ts';

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
  /**
   * S5.6 — the run registry's `turns.send` (V2-1.15 §5.4): run the turn of a run that just became
   * `starting`. `text` is a generated continuation turn; else the ask's own prompt, or for a Keep
   * going (`resumeOf`) the carry-on line — on the chat's persisted ACP session (`loadSession`).
   */
  sendTurn(rec: RunRecord, text: string | null): Promise<void>;
  /** S5.6 — the registry's `turns.cancel`: Stop / quit / lease lost cancel the run's live turn. */
  cancelTurn(rec: RunRecord): Promise<void>;
}

export interface AcpOptions {
  /**
   * S5.6 (S5-slices D3, decision v2-S5-acp-role-gate-per-frame) — the LIVE read-only predicate
   * (role + format gate, the one the agent routes use). Read on EVERY state-changing frame, never
   * stamped at upgrade: the role can drop mid-socket. A throw counts as read-only (fail closed).
   */
  readOnly?: () => boolean;
  /** S5.6 — THE run registry (ai/runs.ts). Absent = the pre-S5.6 direct turn (tests, web serve). */
  runs?: RunRegistry;
  /** S5.6 — the outbox door for a prompt that cannot go now (acp/ask-queue.ts). Needs `runs`.
   *  A getter: server.ts builds the outbox (inside createHttp) after the ACP manager. */
  queue?: () => AskQueue | null;
  /** tests only — the bridges' permission deadline */
  permissionTimeoutMs?: number;
  /**
   * S5.10 — the folders granted read-only (`ai/attach-grants.ts`), read per write request by every
   * bridge's write gate. Default: this project's `_state/ai-grants.json`.
   */
  readOnlyRoots?: () => readonly string[];
}

/** The refusal a read-only session's state-changing frame gets (CONTRACT §4 voice). */
export const READ_ONLY_CHAT_WORDS =
  'This project is view only for you, so AI can’t change it. Ask the owner for edit access.';

/** S5.6 — Keep going (a `resumeOf` run without a prompt of its own) on the resumed session. */
export const KEEP_GOING_TEXT = 'Keep going from where you stopped.';

/** Same chat + same text within this window is one ask (the double "Try again", V2-1.14 §5.6). */
export const DOUBLE_SUBMIT_MS = 2000;

const ARTBOARD_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_SCOPE_ARTBOARDS = 64;

/**
 * The structured `prompt {scope}` (S5.6). designRoot-relative canvas, artboard ids or `'*'`. Anything
 * malformed is no scope at all — the pre-S5.6 lazy run (each edit claims what it reaches), never a
 * guess. Element refs need the kernel's entry key, which the client does not have: not carried yet.
 */
export function parseRunScope(raw: unknown, designRel = ''): RunScope | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { canvas?: unknown; artboards?: unknown; elements?: unknown };
  if (typeof o.canvas !== 'string' || !o.canvas || o.canvas.length > 512) return null;
  if (o.canvas.includes('\0') || o.canvas.includes('\\') || o.canvas.startsWith('/')) return null;
  // S5.17 G1 — ONE path form: design-relative. The shell sends the frame's repo-relative data-path
  // (`.design/ui/Site.tsx`); the hook, the lease key (`path:<designRel>/<rel>`) and a terminal run
  // speak `ui/Site.tsx`. Strip the design root once; every check below runs on the stripped form.
  const root = designRel.replace(/^\/+|\/+$/g, '');
  const canvas =
    root && o.canvas.startsWith(`${root}/`) ? o.canvas.slice(root.length + 1) : o.canvas;
  const parts = canvas.split('/');
  // inside the design root only: no traversal, no hidden segment (`.git/…`, a second `.design/`)
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return null;
  if (!isCanvasFile(canvas)) return null;
  if (o.artboards === '*') return o.elements === undefined ? { canvas, artboards: '*' } : null;
  if (!Array.isArray(o.artboards) || o.artboards.length === 0) return null;
  if (o.artboards.length > MAX_SCOPE_ARTBOARDS) return null;
  if (!o.artboards.every((a) => typeof a === 'string' && ARTBOARD_ID_RE.test(a))) return null;
  const artboards = [...new Set(o.artboards as string[])];
  if (o.elements === undefined) return { canvas, artboards };
  // S2.19 — a ⌘/ ask on a selection names its elements; they sit on artboards the ask leases
  const elements = parseScopeElements(o.elements, canvas, artboards);
  return elements ? { canvas, artboards, elements } : null;
}

/**
 * S5.17 G3 — the Version-history label of a chat turn: what the person typed, never the frozen
 * `[maude-context …]` / `[maude-scope …]` / `[selected: …]` lines the shell appends (promptLabel).
 */
export function turnLabelOf(prompt: string): string {
  const words = promptLabel(prompt);
  return words ? `Claude: ${words}` : 'Claude edit';
}

/** S2.19 — the most elements one ask names (the registry's per-run cap). */
export const MAX_SCOPE_ELEMENTS = 200;

function parseScopeElements(
  raw: unknown,
  canvas: string,
  artboards: string[]
): ElementRef[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SCOPE_ELEMENTS) return null;
  const out: ElementRef[] = [];
  const seen = new Set<string>();
  for (const e of raw as Array<{ artboard?: unknown; element?: unknown; occurrence?: unknown }>) {
    if (!e || typeof e !== 'object') return null;
    if (typeof e.artboard !== 'string' || !artboards.includes(e.artboard)) return null;
    if (typeof e.element !== 'string' || !ARTBOARD_ID_RE.test(e.element)) return null;
    const occ = e.occurrence;
    if (
      occ !== undefined &&
      !(typeof occ === 'number' && Number.isInteger(occ) && occ >= 0 && occ < 10000)
    )
      return null;
    const key = `${e.artboard}\u0000${e.element}\u0000${occ ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      canvas,
      artboard: e.artboard,
      element: e.element,
      ...(occ !== undefined ? { occurrence: occ } : {}),
    });
  }
  return out;
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
  /**
   * The prompt this turn answers — the action's history label. `runId` = the registry run the
   * turn belongs to (S5.6): its stage is begun under that id and the REGISTRY ends it
   * (routes/project-undo.ts `runStageHooks`) — this tracker then never ends it itself, so one
   * turn is never two stages and Stop publishes partial instead of holding (S5.5b).
   */
  beginTurn?(prompt: string, runId?: string | null): void;
}

/** The registry's run ids (ai/run-lifecycle.ts RUN_ID_RE) — the stage's own id pattern. */
const STAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
  /** S5.5b — the registry run of the current turn (null: a pre-S5.6 direct turn). */
  let turnRun: string | null = null;

  /** S5.5b — a completed edit tool names the content it wrote: the stage claims it by hash. */
  function claimWrite(key: string): void {
    const posix = key.slice(ctx.paths.designRel.length + 1);
    let hash: string | null = null;
    if (/\.tsx$/i.test(posix)) {
      try {
        hash = hashBytes(readFileSync(join(ctx.paths.designRoot, posix), 'utf8'));
      } catch {
        hash = null; // deleted or unreadable: the canvas is still this run's
      }
    }
    ctx.syncControl?.current?.()?.claimAiWrite?.(turnRun ?? actionKey, key, hash);
  }

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
      status?: string;
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
        ctx.syncControl?.current?.()?.beginAiAction?.(actionKey, turnLabel, {
          ...(turnRun ? { runId: turnRun } : {}),
          ...(STAGE_ID.test(chatId) ? { chatId } : {}),
        });
      }
      if (u.sessionUpdate === 'tool_call_update' && u.status === 'completed') claimWrite(key);
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
      // A registry run's stage is the registry's to end (publish / partial / hold).
      if (!turnRun) {
        void ctx.syncControl
          ?.current?.()
          ?.endAiAction?.(actionKey, outcome)
          ?.catch(() => {});
      }
    }
    turnRun = null;
  }

  function beginTurn(prompt: string, runId: string | null = null): void {
    turnLabel = turnLabelOf(prompt);
    turnRun = runId && STAGE_ID.test(runId) ? runId : null;
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
  /** S5.6 — the registry run whose turn this bridge is running (null between turns). */
  runId: string | null;
  /** S5.6 — the last `{t:'run'}` frame sent per run, so only a change is sent again. */
  sentRuns: Map<string, string>;
}

export function createAcp(ctx: Context, aiActivity?: AiActivity, options: AcpOptions = {}): Acp {
  const runs = options.runs ?? null;
  /** D3 — read per frame; a throw is read-only (fail closed). */
  function readOnlyNow(): boolean {
    if (!options.readOnly) return false;
    try {
      return options.readOnly() === true;
    } catch {
      return true;
    }
  }
  /** chatId → the last old-client (no askId) prompt, for the 2 s double-submit fold. */
  const lastAsk = new Map<string, { text: string; at: number; askId: string }>();
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
      runId: null,
      sentRuns: new Map(),
    };
    entry.bridge = new AcpBridge({
      // V2-1.15 §5.4 — the adapter carries MAUDE_CHAT_ID=<this chat> (the hook's run binding).
      chatId,
      // S5.10 — a folder AI may read is never a write path (acp/write-scope `read-only-grant`).
      readOnlyRoots: options.readOnlyRoots ?? (() => readOnlyRootsFor(ctx.paths.designRoot)),
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
      // S5.6 (D7) — Needs you waits while a socket is attached; a detached bridge still denies
      // once nobody has watched it for the full timeout (a never-attached one counts from birth).
      detachedFor: () =>
        entry.sinks.size > 0 ? 0 : Date.now() - (entry.detachedSince || entry.lastActive),
      ...(options.permissionTimeoutMs ? { permissionTimeoutMs: options.permissionTimeoutMs } : {}),
      onUpdate: (update, seq) => {
        tracker?.onUpdate(update);
        noteAnswered(entry);
        // `seq` is the update's transcript line — the re-attach seam. The
        // client drops anything it already hydrated and keeps the rest, so a
        // reload mid-stream neither duplicates nor drops output.
        broadcast(entry, { t: 'update', update, seq });
      },
      onPermission: (req) => broadcast(entry, { t: 'permission', toolCall: req.toolCall }),
      onPermissionRequest: (id, req, scope) => {
        noteNeedsYou(entry, req.toolCall?.title);
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
        });
      },
      onElicitationRequest: (id, req: CreateElicitationRequest) => {
        noteNeedsYou(entry, req.message);
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
        });
      },
      // A pending elicitation settled via ANY path, including one the
      // client never initiated (a bridge-side timeout, cancel(), stop()) —
      // tells the client to drop it from its own pending list even though
      // it didn't send the `elicitation-response` itself. See the doc
      // comment on `onElicitationSettled` in bridge.ts.
      onElicitationSettled: (id) => {
        broadcast(entry, { t: 'elicitation-resolved', id });
        noteAnswered(entry);
      },
      onCommands: (commands) => {
        latestCommands = commands;
        broadcast(entry, { t: 'commands', commands });
      },
      onCaps: (modes, configOptions) => broadcast(entry, { t: 'caps', modes, configOptions }),
      onSessionInfo: (info) => broadcast(entry, { t: 'session-info', ...info }),
      onUsage: (usage) => {
        latestUsage = usage;
        noteRateLimit(usage.rateLimit); // S5.6 — the outbox's `ai-allowance` gate fact
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

  /** Point the bridge at this chat's transcript + persisted ACP session (the `loadSession` seam). */
  function bindChatFiles(entry: BridgeEntry): void {
    entry.bridge.setTranscriptPath(transcriptPathFor(entry.chatId));
    entry.bridge.setSessionStorePath(sessionStorePathFor(entry.chatId));
  }

  /**
   * One agent turn on a chat's bridge — the pre-S5.6 body of `handlePrompt`. `run` brackets it on
   * the registry: `accepted` right before the prompt goes out, `turn-end` / `fail` after.
   */
  async function runTurn(entry: BridgeEntry, text: string, runId: string | null): Promise<void> {
    const { bridge } = entry;
    // Marks this bridge as worth keeping alive through a detach. Set BEFORE the
    // first await, so a socket that closes during the spawn still counts as a
    // live turn rather than an abandoned bridge.
    entry.turnActive = true;
    entry.runId = runId;
    entry.tracker?.beginTurn?.(text, runId);
    let turnOutcome: 'done' | 'failed' = 'failed';
    let stopReason: string | null = null;
    try {
      await bridge.ensureStarted();
      if (runId && runs) {
        await runs.started(runId);
        // stopped (or its lease lost) while the adapter spawned: the prompt never goes out
        if (runs.get(runId)?.state !== 'running') {
          broadcast(entry, { t: 'turn-end', stopReason: 'cancelled' });
          return;
        }
      }
      ({ stopReason } = await bridge.prompt(text, entry.chatId));
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
      entry.runId = null;
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
      // V2-1.15 §5.5 — AFTER the bridge is free, so the chat's next ask (the chat-level line,
      // a continuation) finds it idle. A run already ended by Stop / quit refuses the event.
      const cur = runId ? runs?.get(runId) : null;
      if (runId && runs && cur && isLive(cur)) {
        void runs.turnEnded(runId, turnOutcome).catch(() => null);
      }
    }
  }

  /** The run frames of a chat: its live runs, plus every run already shown, when it changed. */
  function pushRunFrames(entry: BridgeEntry): void {
    if (!runs || entry.sinks.size === 0) return;
    for (const run of runs.view().mine) {
      if (run.chatId !== entry.chatId) continue;
      const prior = entry.sentRuns.get(run.runId);
      if (prior === undefined && run.state === 'ended') continue;
      const json = JSON.stringify(run);
      if (json === prior) continue;
      entry.sentRuns.set(run.runId, json);
      broadcast(entry, { t: 'run', run });
    }
  }

  /** A permission / elicitation is open: the chat's run needs you (§5.5 running → needs-you). */
  function noteNeedsYou(entry: BridgeEntry, question: unknown): void {
    const id = entry.runId;
    if (!runs || !id || runs.get(id)?.state !== 'running') return;
    const q = typeof question === 'string' && question.trim() ? question : 'Claude is asking';
    void runs.needsYou(id, q).catch(() => null);
  }

  /** Every open question is settled: the run is running again (§5.5 needs-you → running). */
  function noteAnswered(entry: BridgeEntry): void {
    const id = entry.runId;
    if (!runs || !id || runs.get(id)?.state !== 'needs-you') return;
    if (entry.bridge.awaitingInputCount > 0) return;
    void runs.answered(id).catch(() => null);
  }

  /** The askId of a prompt frame: the client's, else the 2 s double-submit fold for old clients. */
  function askIdFor(chatId: string, text: string, raw: unknown): string | undefined {
    if (typeof raw === 'string' && ASK_ID_RE.test(raw)) return raw;
    const prior = lastAsk.get(chatId);
    const now = Date.now();
    if (prior && prior.text === text && now - prior.at < DOUBLE_SUBMIT_MS) return prior.askId;
    const askId = `a_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    lastAsk.set(chatId, { text, at: now, askId });
    return askId;
  }

  async function handlePrompt(
    ws: ServerWebSocket<WsData>,
    text: string,
    chatId: string,
    model: string | null,
    effort: string | null,
    modeId: string | null,
    ask: { askId?: unknown; scope?: unknown } = {}
  ): Promise<void> {
    const safeChat = sanitizeChatId(chatId);
    // S5.17 G1 — a scope that was sent but names nothing inside the design root (`..`, absolute, a
    // hidden segment, a malformed list) refuses the prompt. It never degrades to the unscoped lazy
    // run: that run may change every canvas, so a bad scope would WIDEN what the turn can write.
    if (ask.scope != null && !parseRunScope(ask.scope, ctx.paths.designRel)) {
      send(ws, {
        t: 'error',
        code: 'bad-scope',
        chat: safeChat,
        message: 'That selection is not on a canvas in this project. Choose it again and resend.',
      });
      return;
    }
    const entry = attach(ws, safeChat);
    if (!entry) {
      send(ws, { t: 'error', message: 'Too many chats are open. Close one and try again.' });
      return;
    }
    bindChatFiles(entry);
    entry.bridge.setConfig(model, effort, modeId);
    // S5.17 G5 — the chat list groups a chat under the canvas it asked about (design-relative)
    const asked = ask.scope != null ? parseRunScope(ask.scope, ctx.paths.designRel) : null;
    if (asked) {
      try {
        linkChatCanvas(ctx.paths.designRoot, safeChat, asked.canvas);
        // S5.18 G5 — the list's "where" line: the artboards this ask named
        noteChatArtboards(ctx.paths.designRoot, safeChat, asked.canvas, asked.artboards);
      } catch {
        /* a read-only _chat/ keeps the chat under "No canvas" — never blocks the prompt */
      }
    }
    if (!runs) {
      await runTurn(entry, text, null);
      return;
    }
    // V2-1.15 §5.4 — the ask goes to the registry BEFORE any turn: it leases the scope's
    // artboards (or lines up behind their holder, or behind this chat's own live run — chat-level
    // FIFO), and the registry sends the turn (`sendTurn`) only once the run is `starting`. The
    // `[maude-scope …]` text line stays in `text` for the agent (old clients send only that).
    const scope = asked;
    // V2-1.14 — a closed gate (offline, AI not connected, allowance used up, setting up), or an
    // earlier prompt of this chat still queued (O2), keeps the prompt in the outbox; the drain
    // releases it into `registry.ask` by itself. Nothing is lost and nothing jumps the line.
    // S5.18 (G10): the signed-in check settles first — a Mac that is not signed in keeps the prompt.
    const settling = options.queue?.()?.ready();
    if (settling) await settling; // only while the sign-in answer is stale: a fresh one stays synchronous
    const queued = options.queue?.()?.maybeQueue({ chatId: safeChat, text, scope }) ?? null;
    if (queued && 'refused' in queued) {
      send(ws, { t: 'error', code: 'not-queued', chat: safeChat, message: queued.refused });
      return;
    }
    if (queued) {
      broadcast(entry, { t: 'queued', chat: safeChat, ...queued });
      return;
    }
    try {
      await runs.ask({
        askId: askIdFor(safeChat, text, ask.askId),
        chatId: safeChat,
        sessionId: entry.bridge.sessionId ?? null,
        origin: 'maude-chat',
        label: promptLabel(text),
        prompt: text,
        scope,
      });
    } catch (err) {
      send(ws, { t: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    pushRunFrames(entry);
  }

  /** The registry's `turns.send` — see `Acp.sendTurn`. */
  async function sendTurn(rec: RunRecord, generated: string | null): Promise<void> {
    if (!runs || !rec.chatId) return;
    const text =
      generated ?? rec.prompt ?? (rec.resumeOf || rec.continuationOf ? KEEP_GOING_TEXT : null);
    const fail = () => {
      if (isLive(runs.get(rec.runId) ?? rec)) void runs.turnEnded(rec.runId, 'failed');
    };
    const entry = getOrCreateEntry(sanitizeChatId(rec.chatId));
    if (!entry || !text) return fail();
    // D3 — a turn the registry generates by itself (a continuation, a run that waited in line,
    // Keep going) is a write as much as a typed prompt: the live predicate gates it too.
    if (readOnlyNow()) {
      broadcast(entry, {
        t: 'error',
        code: 'read-only',
        chat: entry.chatId,
        message: READ_ONLY_CHAT_WORDS,
      });
      return fail();
    }
    if (entry.turnActive) return fail(); // never two turns on one bridge (the FIFO forbids it)
    if (entry.sinks.size === 0 && !entry.detachedSince) entry.detachedSince = Date.now();
    bindChatFiles(entry);
    await runTurn(entry, text, rec.runId);
  }

  /** The registry's `turns.cancel` — see `Acp.cancelTurn`. */
  async function cancelTurn(rec: RunRecord): Promise<void> {
    const entry = rec.chatId ? bridges.get(sanitizeChatId(rec.chatId)) : undefined;
    if (!entry || entry.runId !== rec.runId) return;
    entry.tracker?.endTurn();
    await entry.bridge.cancel();
  }

  // V2-1.15 §5.4 — `{t:'run', run}` on every change of a chat's runs.
  if (runs) {
    ctx.bus?.on?.('ai:runs', () => {
      for (const entry of bridges.values()) pushRunFrames(entry);
    });
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
        askId?: unknown;
        scope?: unknown;
      };

      const chatId = typeof frame.chat === 'string' && frame.chat ? frame.chat : 'default';

      // S5.6 (D3, decision v2-S5-acp-role-gate-per-frame) — the read-only gate, PER FRAME against
      // the live predicate: a role that drops mid-socket refuses the very next frame. Refused:
      // everything that makes the agent act or loosens its gate. Open: attach / warm (no turn),
      // cancel, and the deny direction of a response — stopping the agent is never a write.
      if (refusedWhenReadOnly(frame) && readOnlyNow()) {
        send(ws, {
          t: 'error',
          code: 'read-only',
          chat: sanitizeChatId(chatId),
          message: READ_ONLY_CHAT_WORDS,
        });
        return;
      }
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
        entry.sentRuns.clear(); // a re-attached client gets the chat's live runs again
        pushRunFrames(entry);
      } else if (frame.t === 'prompt' && typeof frame.text === 'string') {
        void handlePrompt(ws, frame.text, chatId, model, effort, modeId, {
          askId: frame.askId,
          scope: frame.scope,
        });
      } else if (frame.t === 'warm') {
        void handleWarm(ws, chatId, model, effort, modeId);
      } else if (frame.t === 'cancel') {
        // RC5 — a cancelled turn may never resolve prompt(); clear banners now.
        const entry = entryForSocket(ws, typeof frame.chat === 'string' ? frame.chat : undefined);
        entry?.tracker?.endTurn();
        // S5.6 — a registry run's turn is stopped through the registry (V2-1.5 `stopped`: partial
        // publish, the lease released, the chat's line moves); its `turns.cancel` cancels the bridge.
        if (runs && entry?.runId) void runs.stop(entry.runId, 'you').catch(() => null);
        else void entry?.bridge.cancel();
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
        const entry = entryForSocket(ws, typeof frame.chat === 'string' ? frame.chat : undefined);
        entry?.bridge.resolvePermission(frame.id, decision);
        if (entry) noteAnswered(entry);
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

    sendTurn,
    cancelTurn,
  };
}

/**
 * D3 — the frames a read-only session may not send. A response frame is refused only in the
 * allow direction: a `'cancelled'` permission decision and an elicitation decline / cancel stay
 * open, so a person whose role dropped mid-turn can still say no.
 */
function refusedWhenReadOnly(frame: { t?: unknown; decision?: unknown; action?: unknown }) {
  switch (frame.t) {
    case 'prompt':
    case 'set-mode':
    case 'set-config':
      return true;
    case 'permission-response':
      return frame.decision !== 'cancelled';
    case 'elicitation-response':
      return frame.action === 'accept';
    default:
      return false;
  }
}
