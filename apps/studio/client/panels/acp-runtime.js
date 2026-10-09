// Phase 31 (DDR-123) — client glue between assistant-ui's local runtime and the
// dev-server ACP bridge (`/_ws/acp`). One persistent socket per ChatPanel mount;
// the bridge lazy-spawns the user's `claude` on the first prompt (or the first
// `warm()` — sent when the user starts typing a slash command), so just opening
// the panel costs nothing. A custom `ChatModelAdapter` translates the bridge's
// JSON frames into the streamed assistant message parts assistant-ui renders.

const WS_PATH = '/_ws/acp';

/**
 * Pure reducer for the live "what's running now" map (exported for tests).
 * Returns true when the map changed. `turn-end` deliberately does NOT clear it:
 * the ACP adapter settles the prompt at the main agent's `result` while
 * background subagents keep running (claude-agent-acp #773 — see RCA
 * issue-acp-subagent-activity-invisible), so clearing on turn-end made that
 * still-running work vanish. Background tool_calls now drain on their own
 * completed/failed updates; only a hard `error` (teardown) wipes the map.
 */
export function reduceActivity(map, frame) {
  if (frame.t === 'update') {
    const u = frame.update;
    if (u.sessionUpdate === 'tool_call') {
      // `_meta.claudeCode.toolName` is the concrete Claude Code tool name — the
      // ONLY reliable subagent signal, since the adapter maps Task/Agent →
      // kind:"think" + title=description (which collide with a plain think tool).
      map.set(u.toolCallId, {
        title: u.title || u.kind || 'tool',
        kind: u.kind,
        toolName: u._meta?.claudeCode?.toolName,
      });
      return true;
    }
    if (
      u.sessionUpdate === 'tool_call_update' &&
      (u.status === 'completed' || u.status === 'failed')
    ) {
      return map.delete(u.toolCallId);
    }
    return false;
  }
  if (frame.t === 'error') {
    if (map.size) {
      map.clear();
      return true;
    }
  }
  return false;
}

/** A Task/Agent tool_call is how the ACP adapter surfaces a subagent. */
export function isSubagentTool(t) {
  return t.toolName === 'Task' || t.toolName === 'Agent';
}

/** Label for the "still working" indicator — names subagents explicitly. */
export function activityLabel(tools) {
  const subs = tools.filter(isSubagentTool);
  if (subs.length) return `${subs.length} subagent${subs.length > 1 ? 's' : ''} running`;
  if (tools.length === 1) return tools[0].title;
  if (tools.length > 1) return `${tools.length} tasks running`;
  return 'Working…';
}

/**
 * Fold one `session/update` into the assistant-message `parts` array (mutated in
 * place) + `toolIndex` map. Shared by the LIVE turn (makeAcpAdapter's run loop)
 * AND the BACKGROUND sink (the frames the ACP adapter keeps streaming AFTER its
 * premature settle — claude-agent-acp #773; see RCA issue-acp-subagent-activity-
 * invisible). `plan`/`usage_update`/`available_commands_update` are not rendered.
 * Exported for tests.
 */
export function applyUpdate(parts, toolIndex, u) {
  switch (u.sessionUpdate) {
    case 'agent_message_chunk': {
      if (u.content?.type !== 'text') break;
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') {
        parts[parts.length - 1] = { ...last, text: last.text + u.content.text };
      } else {
        parts.push({ type: 'text', text: u.content.text });
      }
      break;
    }
    case 'agent_thought_chunk': {
      // Extended-thinking — a collapsed "Thinking" disclosure (reasoning part).
      if (u.content?.type !== 'text') break;
      const last = parts[parts.length - 1];
      if (last && last.type === 'reasoning') {
        parts[parts.length - 1] = { ...last, text: last.text + u.content.text };
      } else {
        parts.push({ type: 'reasoning', text: u.content.text });
      }
      break;
    }
    case 'tool_call': {
      toolIndex.set(u.toolCallId, parts.length);
      parts.push({
        type: 'tool-call',
        toolCallId: u.toolCallId,
        toolName: u.title || u.kind || 'tool',
        args: u.rawInput ?? {},
        argsText: safeJson(u.rawInput),
        result: undefined,
      });
      break;
    }
    case 'tool_call_update': {
      const idx = toolIndex.get(u.toolCallId);
      if (idx == null) break;
      parts[idx] = {
        ...parts[idx],
        result: u.rawOutput ?? parts[idx].result,
        isError: u.status === 'failed',
      };
      break;
    }
    default:
      break; // plan / thought / commands / usage — not rendered
  }
}

/** Connection wrapper around the loopback `/_ws/acp` socket. */
export function createAcpConnection() {
  let ws = null;
  let openPromise = null;
  // ── The re-attach seam (Addendum Task 8) ──────────────────────────────────
  // The chat this connection speaks for, and how far its history has been
  // hydrated. Both are set by `bindChat()` BEFORE the socket opens, because the
  // `attach` frame that carries them is sent from `onopen`.
  //
  // `hydratedSeq` is a transcript LINE NUMBER, not a message count — the server
  // stamps every `update` with the line it occupies, so the two are directly
  // comparable. Frames at or below it are things the panel already rendered
  // from the HTTP hydration, and dropping them is what stops a reload from
  // showing the last few seconds twice.
  let attachedChatId = null;
  let hydratedSeq = 0;
  /** True when the server said we re-joined a turn that is STILL running. */
  const attachedListeners = new Set();
  let turnHandler = null; // the in-flight run()'s frame sink
  const statusListeners = new Set();
  const status = { available: null, reason: undefined, ready: false };

  // Live "what's running now" — in-flight tool calls (a tool_call with no
  // completed/failed tool_call_update yet). Surfaced as the activity bar so
  // background work is visible at a glance, not only buried in the text.
  const activityListeners = new Set();
  const activeTools = new Map(); // toolCallId → { title, kind }

  // Turn-busy signal — true while a prompt turn is in flight. Drives the
  // menubar Assistant badge + the "finished" notification.
  const busyListeners = new Set();
  let busy = false;

  // Slash-command catalogue (`available_commands_update`, cached server-side and
  // pushed as a `commands` frame) — drives the composer autocomplete + inline
  // command pill. Arrives on open (replay) and/or after warm()/first turn.
  const commandListeners = new Set();
  let commands = [];

  // Session capabilities (feature-acp-panel-dynamic-claude-code-capabilities)
  // — the live, dynamic replacement for the old hardcoded MODELS/EFFORTS
  // arrays. `caps` = `{modes, configOptions}`, sourced entirely from the ACP
  // session (never a static list); `sessionInfo` = the agent-generated title.
  const capsListeners = new Set();
  let caps = { modes: null, configOptions: [] };
  const sessionInfoListeners = new Set();
  let sessionInfo = { title: null, updatedAt: null };

  // Usage (Milestone D) — the raw `usage` frame's payload, replayed on
  // subscribe like caps/commands/sessionInfo above. Parsed into render-ready
  // shape by acp-usage.js's parseUsage, not here (keep this file transport-only).
  const usageListeners = new Set();
  let usage = null;

  // Pending permission requests (Milestone B — retires DDR-125 F2's blanket
  // auto-approve). Surfaced OUTSIDE the assistant-ui message stream (like
  // commands/caps above) via a panel-level subscription, since a request can
  // arrive mid-turn and the run() loop only understands text/tool-call/
  // reasoning parts — not "pause here for a human decision."
  const permissionListeners = new Set();
  let pendingPermissions = [];
  function emitPermissions() {
    const snap = pendingPermissions.slice();
    for (const fn of permissionListeners) fn(snap);
  }

  // Pending elicitation requests (feature-acp-ask-user-question — AskUserQuestion
  // + generic MCP form input). Same "outside the assistant-ui message stream"
  // treatment as pendingPermissions above, for the same reason: a request can
  // arrive mid-turn and the run() loop only understands text/tool-call/reasoning
  // parts, not "pause here for a human form."
  const elicitationListeners = new Set();
  let pendingElicitations = [];
  function emitElicitations() {
    const snap = pendingElicitations.slice();
    for (const fn of elicitationListeners) fn(snap);
  }

  function emitStatus() {
    for (const fn of statusListeners) fn({ ...status });
  }

  function setBusy(next) {
    if (busy === next) return;
    busy = next;
    for (const fn of busyListeners) fn(busy);
  }

  function emitActivity() {
    const snapshot = [...activeTools.values()];
    for (const fn of activityListeners) fn(snapshot);
  }

  function trackActivity(frame) {
    if (reduceActivity(activeTools, frame)) emitActivity();
  }

  // Post-turn-end continuation — the ACP adapter settles the prompt at the main
  // agent's `result` (claude-agent-acp #773) but KEEPS streaming background work
  // (subagent results, the consolidation) afterward. Those frames arrive with no
  // active turn (`turnHandler === null`), so they can't join the assistant-ui
  // message that already completed; accumulate them here as a live "continuation"
  // the panel renders below the thread — otherwise the whole answer is invisible
  // until reload. See RCA issue-acp-subagent-activity-invisible (facet F2).
  const backgroundListeners = new Set();
  let bgParts = [];
  const bgToolIndex = new Map();
  function emitBackground() {
    const snap = bgParts.slice();
    for (const fn of backgroundListeners) fn(snap);
  }
  function resetBackground() {
    if (!bgParts.length && !bgToolIndex.size) return;
    bgParts = [];
    bgToolIndex.clear();
    emitBackground();
  }

  // Connection-problem error card (Task C3) — the bridge `error` frame (a
  // socket/adapter failure mid-turn) is ALSO thrown from prompt()'s generator
  // (so assistant-ui's own turn-failed bookkeeping still runs), but a thrown
  // generator error renders as a bare, unstyled assistant-ui fallback. Expose
  // it as its own channel too so the panel can render a proper retry card
  // instead — same "chrome, not turn content" treatment as commands/caps.
  const errorListeners = new Set();
  let lastError = null; // { message } | null
  function emitError() {
    for (const fn of errorListeners) fn(lastError);
  }
  function setError(message) {
    lastError = message ? { message } : null;
    emitError();
  }

  function onFrame(frame) {
    // ── The re-attach seam (Addendum Task 8) ────────────────────────────────
    // Drop anything the panel already rendered from its HTTP hydration. The
    // server replays the tail on `attach` and the live stream continues past
    // it, so without this filter a reload mid-turn would show the overlap
    // twice. Frames with no `seq` (every non-`update` frame) are unaffected.
    if (typeof frame.seq === 'number') {
      if (frame.seq <= hydratedSeq) return;
      // Advance the marker as we consume, so a SECOND reconnect on the same
      // page (a dropped socket, not a page reload) re-attaches from where the
      // live stream actually got to rather than from the original hydration.
      hydratedSeq = frame.seq;
    }
    if (frame.t === 'attached') {
      for (const fn of attachedListeners) fn({ chat: frame.chat, running: !!frame.running });
      // Re-joined a turn that is STILL running: restore the busy state, or the
      // panel would look idle while the agent keeps working (and the composer
      // would happily start a second, concurrent turn).
      if (frame.running) setBusy(true);
      return;
    }
    if (frame.t === 'ready') {
      status.ready = true;
      status.available = frame.available;
      status.reason = frame.reason;
      emitStatus();
      return;
    }
    // The command catalogue arrives outside any turn (on open / warm-up) — surface
    // it independently of the prompt-turn handler.
    if (frame.t === 'commands') {
      commands = Array.isArray(frame.commands) ? frame.commands : [];
      for (const fn of commandListeners) fn(commands);
      return;
    }
    // Same treatment for the capability channel — chrome, not turn content,
    // arrives on establish + on every live mode/config-option change.
    if (frame.t === 'caps') {
      caps = { modes: frame.modes ?? null, configOptions: frame.configOptions ?? [] };
      for (const fn of capsListeners) fn(caps);
      return;
    }
    if (frame.t === 'session-info') {
      sessionInfo = { title: frame.title ?? null, updatedAt: frame.updatedAt ?? null };
      for (const fn of sessionInfoListeners) fn(sessionInfo);
      return;
    }
    if (frame.t === 'usage') {
      usage = frame.usage ?? null;
      for (const fn of usageListeners) fn(usage);
      return;
    }
    if (frame.t === 'permission-request') {
      pendingPermissions = [
        ...pendingPermissions,
        {
          id: frame.id,
          toolCall: frame.toolCall,
          options: frame.options ?? [],
          // feature-acp-write-path-scope — present only when the server's
          // write-path gate declined a write tool. `{ outOfProjectWrite,
          // resolvedPaths, scopeRoot, reason }`; absent for every ordinary
          // permission request, so PermissionPrompt's "outside the project"
          // copy can't fire on one.
          scope: frame.scope ?? null,
        },
      ];
      emitPermissions();
      return;
    }
    if (frame.t === 'elicitation-request') {
      pendingElicitations = [
        ...pendingElicitations,
        {
          id: frame.id,
          message: frame.message,
          mode: frame.mode,
          requestedSchema: frame.requestedSchema,
          // Present only when this elicitation is scoped to a specific tool
          // call (e.g. the built-in AskUserQuestion) — absent for a raw
          // session-scoped MCP-server elicitation. ElicitationPrompt.jsx uses
          // this to avoid a blanket "from Claude" attribution it can't back up.
          toolCallId: frame.toolCallId,
        },
      ];
      emitElicitations();
      return;
    }
    // The bridge settled a pending elicitation itself (timeout/cancel/stop) —
    // drop it from the pending list even though the client never responded,
    // so the card doesn't sit open with a Submit button that's already dead.
    // A client-driven response already removed its own entry optimistically
    // (respondElicitation below), so this is a no-op for that path — it only
    // does real work for a settlement the client didn't initiate.
    if (frame.t === 'elicitation-resolved') {
      if (pendingElicitations.some((p) => p.id === frame.id)) {
        pendingElicitations = pendingElicitations.filter((p) => p.id !== frame.id);
        emitElicitations();
      }
      return;
    }
    // Everything else belongs to the active prompt turn.
    trackActivity(frame);
    if (turnHandler) turnHandler(frame);
    else if (frame.t === 'update') {
      // No active turn, but the adapter is still streaming (the post-settle
      // tail the client used to drop). Fold it into the background continuation.
      applyUpdate(bgParts, bgToolIndex, frame.update);
      emitBackground();
    }
  }

  function ensureOpen() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return openPromise;
    }
    openPromise = new Promise((resolve, reject) => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${scheme}://${location.host}${WS_PATH}`);
      ws = sock;
      sock.onopen = () => {
        // Addendum Task 8 — bind to this chat's (possibly still running) bridge
        // and close the re-attach seam in the same frame. `hydratedSeq` is the
        // transcript line the panel hydrated over HTTP; the server replays
        // exactly what came after it. A reload mid-turn therefore rejoins the
        // live stream with no hole and no doubled text.
        //
        // Sent unconditionally, including for a brand-new chat (seq 0, nothing
        // to replay) — the attach is what registers the socket as a sink, so
        // skipping it for new chats would leave them detached until the first
        // prompt.
        if (attachedChatId) {
          try {
            sock.send(JSON.stringify({ t: 'attach', chat: attachedChatId, seq: hydratedSeq }));
          } catch {
            /* the frame handlers below surface a dead socket */
          }
        }
        resolve();
      };
      sock.onerror = () => reject(new Error('Could not reach the Claude bridge.'));
      sock.onclose = () => {
        ws = null;
        status.ready = false;
        emitStatus();
      };
      sock.onmessage = (e) => {
        try {
          onFrame(JSON.parse(e.data));
        } catch {
          /* ignore malformed frame */
        }
      };
    });
    return openPromise;
  }

  return {
    onStatus(fn) {
      statusListeners.add(fn);
      fn({ ...status });
      return () => statusListeners.delete(fn);
    },

    onActivity(fn) {
      activityListeners.add(fn);
      fn([...activeTools.values()]);
      return () => activityListeners.delete(fn);
    },

    /** Subscribe to the post-turn-end continuation parts; replays the current tail. */
    onBackground(fn) {
      backgroundListeners.add(fn);
      fn(bgParts.slice());
      return () => backgroundListeners.delete(fn);
    },

    /** Subscribe to the connection-problem error card's source (Task C3); replays the current one, if any. */
    onError(fn) {
      errorListeners.add(fn);
      fn(lastError);
      return () => errorListeners.delete(fn);
    },

    /** Subscribe to the slash-command catalogue; replays the current list. */
    onCommands(fn) {
      commandListeners.add(fn);
      fn(commands);
      return () => commandListeners.delete(fn);
    },

    /** Subscribe to the live capability set (`{modes, configOptions}`); replays the current snapshot. */
    onCaps(fn) {
      capsListeners.add(fn);
      fn(caps);
      return () => capsListeners.delete(fn);
    },

    /** Subscribe to the agent-generated chat title; replays the current snapshot. */
    onSessionInfo(fn) {
      sessionInfoListeners.add(fn);
      fn(sessionInfo);
      return () => sessionInfoListeners.delete(fn);
    },

    /** Subscribe to the raw usage frame (Milestone D); replays the current snapshot (may be null). */
    onUsage(fn) {
      usageListeners.add(fn);
      fn(usage);
      return () => usageListeners.delete(fn);
    },

    /** Subscribe to the list of currently-pending permission requests; replays the current snapshot. */
    onPermission(fn) {
      permissionListeners.add(fn);
      fn(pendingPermissions);
      return () => permissionListeners.delete(fn);
    },

    /** Subscribe to the list of currently-pending elicitation requests; replays the current snapshot. */
    onElicitation(fn) {
      elicitationListeners.add(fn);
      fn(pendingElicitations);
      return () => elicitationListeners.delete(fn);
    },

    /**
     * Answer a pending permission request — `decision` is one of the
     * request's own `options[].optionId`, or `'cancelled'` to reject. Removes
     * it from the pending list optimistically (the server has no separate
     * "resolved" frame; the turn just continues). A response for an id that's
     * no longer pending (already timed out, or a duplicate click) is a no-op.
     */
    /**
     * Bind this connection to a chat and tell it how far the panel already
     * hydrated that chat's transcript over HTTP (`seq` — a transcript LINE
     * number, from the `X-Maude-Chat-Seq` response header).
     *
     * Must be called BEFORE the socket opens: the `attach` frame is sent from
     * `onopen`, and it is what registers this socket as a sink for the chat's
     * (possibly still running) server-side bridge. Calling it later still
     * works for a subsequent reconnect, it just misses the current one.
     */
    bindChat(chatId, seq = 0) {
      attachedChatId = chatId || null;
      hydratedSeq = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 0;
    },

    /** Subscribe to `{ chat, running }` — fires once per successful attach.
     *  `running: true` means this socket re-joined a LIVE turn. */
    onAttached(fn) {
      attachedListeners.add(fn);
      return () => attachedListeners.delete(fn);
    },

    async respondPermission(id, decision) {
      if (!pendingPermissions.some((p) => p.id === id)) return;
      pendingPermissions = pendingPermissions.filter((p) => p.id !== id);
      emitPermissions();
      try {
        await ensureOpen();
        // `chat` is echoed back from the request frame — a bridge is keyed by
        // chat now, not by socket, so the response has to name which one.
        ws?.send(JSON.stringify({ t: 'permission-response', id, chat: attachedChatId, decision }));
      } catch {
        /* socket unavailable — the bridge's own timeout will deny this request */
      }
    },

    /**
     * Answer a pending elicitation request — `response` is `{ action, content? }`,
     * `action` one of `'accept'`/`'decline'`/`'cancel'`. Mirrors `respondPermission`
     * exactly, including the optimistic removal + no-op-on-stale-id behavior.
     */
    async respondElicitation(id, response) {
      if (!pendingElicitations.some((p) => p.id === id)) return;
      pendingElicitations = pendingElicitations.filter((p) => p.id !== id);
      emitElicitations();
      try {
        await ensureOpen();
        ws?.send(
          JSON.stringify({ t: 'elicitation-response', id, chat: attachedChatId, ...response })
        );
      } catch {
        /* socket unavailable — the bridge's own timeout will decline this request */
      }
    },

    /**
     * Live-set the session mode (Manual/Plan/…) for `chatId` on an
     * ALREADY-established session — no respawn. Fire-and-forget like `warm`;
     * the server validates against its own last-advertised roster and
     * silently ignores an unadvertised id, so a stale/racy pick never corrupts
     * state — the next `caps` frame is the source of truth either way.
     */
    async setMode(chatId, modeId) {
      try {
        await ensureOpen();
        ws?.send(JSON.stringify({ t: 'set-mode', chat: chatId || undefined, modeId }));
      } catch {
        /* socket unavailable — non-fatal */
      }
    },

    /** Live-set one config option (model/effort/fast/…) for `chatId`. See `setMode`. */
    async setConfig(chatId, configId, value) {
      try {
        await ensureOpen();
        ws?.send(JSON.stringify({ t: 'set-config', chat: chatId || undefined, configId, value }));
      } catch {
        /* socket unavailable — non-fatal */
      }
    },

    /**
     * Warm the adapter WITHOUT prompting so the agent publishes its command
     * catalogue. Fired when the user starts typing a slash command. Best-effort;
     * a dead socket just leaves autocomplete on the static list. `model`/
     * `effort`/`mode` are the user's PERSISTED picks — applied once, live, by
     * the bridge right after the session establishes (never onto an existing one).
     */
    async warm(chatId, model, effort, mode) {
      try {
        await ensureOpen();
        ws?.send(
          JSON.stringify({
            t: 'warm',
            chat: chatId || undefined,
            model: model || undefined,
            effort: effort || undefined,
            mode: mode || undefined,
          })
        );
      } catch {
        /* socket unavailable — non-fatal */
      }
    },

    /**
     * Drive one prompt turn. Async-generates the bridge's `update` frames until
     * `turn-end`; throws on `error`; sends `cancel` when `abortSignal` aborts.
     * `model`/`effort`/`mode` — see `warm`.
     */
    async *prompt(text, chatId, abortSignal, model, effort, mode) {
      try {
        await ensureOpen();
      } catch (err) {
        setError(err?.message || 'Could not reach the Claude bridge.');
        throw err;
      }
      const queue = [];
      let wake = null;
      let ended = false;
      let failure = null;
      turnHandler = (frame) => {
        if (frame.t === 'turn-end') ended = true;
        else if (frame.t === 'error') {
          failure = frame.message || 'The Claude bridge errored.';
          setError(failure); // Task C3 — the styled retry card's source
        } else queue.push(frame); // update / connected / permission
        if (wake) {
          const w = wake;
          wake = null;
          w();
        }
      };
      const cancel = () => {
        try {
          ws?.send(JSON.stringify({ t: 'cancel', chat: attachedChatId || undefined }));
        } catch {
          /* socket already gone */
        }
      };
      abortSignal?.addEventListener('abort', cancel, { once: true });
      setBusy(true);
      // Fresh user turn supersedes the previous turn's leftovers: the background
      // continuation tail AND any orphaned activity whose background work never
      // resolved (defensive; the common path drains via completed updates).
      // setBusy(true) fires FIRST so the finished-ping deferral (ChatPanel) sees
      // busy before these empty emits.
      resetBackground();
      setError(null); // a fresh turn clears any stale card from a prior failure
      if (activeTools.size) {
        activeTools.clear();
        emitActivity();
      }
      try {
        ws.send(
          JSON.stringify({
            t: 'prompt',
            text,
            chat: chatId || undefined,
            model: model || undefined,
            effort: effort || undefined,
            mode: mode || undefined,
          })
        );
        for (;;) {
          while (queue.length) yield queue.shift();
          if (failure) throw new Error(failure);
          if (ended) return;
          await new Promise((r) => {
            wake = r;
          });
        }
      } finally {
        turnHandler = null;
        setBusy(false);
        abortSignal?.removeEventListener('abort', cancel);
      }
    },

    onBusy(fn) {
      busyListeners.add(fn);
      fn(busy);
      return () => busyListeners.delete(fn);
    },

    get busy() {
      return busy;
    },

    close() {
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      ws = null;
    },
  };
}

/** The last user message's plain text — shared by the adapter's run() AND the
 *  connection-problem card's "Try again" (Task C3), which re-sends it verbatim. */
export function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    return (m.content || [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('')
      .trim();
  }
  return '';
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

// ── chat-attachment refs (image thumbnails + lightbox) ──
// A pasted image lives in the feed under two spellings: the LIVE bubble holds
// the collapsed chip token ([image-1] — resolved via the per-chat attachments
// map), while a RELOADED bubble (transcript) holds the already-expanded
// absolute path under `_chat/attachments/`. Both funnel into the same
// `<sha8>.<ext>` name the GET /_api/acp/attachment route serves. Pure — tested
// in test/chat-attachments.test.ts.
const ATTACHMENT_NAME = '[0-9a-f]{8}\\.(?:png|jpe?g|gif|webp)';

/**
 * The content-addressed basename when the string is a `_chat/attachments/` path
 * (absolute or relative), else null. Non-attachment paths never match.
 */
export function attachmentName(absPathOrText) {
  const m = new RegExp(`(?:^|/)_chat/attachments/(${ATTACHMENT_NAME})$`).exec(
    String(absPathOrText || '').trim()
  );
  return m ? m[1] : null;
}

/**
 * Split bubble text into ordered segments the renderer walks:
 *   { type:'text', text }                — plain run, rendered verbatim
 *   { type:'chip', token, kind }         — [image|file|link-N] (live bubble)
 *   { type:'attachment', name, raw }     — expanded _chat/attachments path (reload)
 */
export function extractAttachmentRefs(text) {
  const s = String(text || '');
  const re = new RegExp(
    `\\[(image|file|link)-\\d+\\]|\\S*/_chat/attachments/(${ATTACHMENT_NAME})`,
    'g'
  );
  const segs = [];
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) segs.push({ type: 'text', text: s.slice(last, m.index) });
    if (m[1]) segs.push({ type: 'chip', token: m[0], kind: m[1] });
    else segs.push({ type: 'attachment', name: m[2], raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) segs.push({ type: 'text', text: s.slice(last) });
  return segs;
}

/**
 * Image paths under the project's design root that an ASSISTANT message text
 * references (e.g. `/design:screenshot` replying "Saved to: .design/_history/…/
 * 001.png") → servable same-origin URLs for the thumbnail strip (DDR-145).
 * Render-only: the main origin already serves designRoot statics with
 * containment; nothing outside `<designRel>/` ever matches, SVG stays excluded
 * (scriptable), and the per-message cap bounds a hostile/hallucinated wall of
 * paths. Returns unique URLs in first-mention order.
 *
 * Containment is enforced client-side, NOT delegated to the server (DDR-145
 * security follow-up): the assistant text is partly untrusted (tool output /
 * indirect injection), so a token carrying a `..` dot-segment or ANY
 * percent-encoding is rejected outright — otherwise `.design/../../etc/x.png`
 * would collapse to `/etc/x.png` in the browser (and `..%2f` would decode
 * server-side), silently widening the fetch surface from designRel to the whole
 * repoRoot. The server's `safePathUnderRoot` stays the backstop; this makes the
 * client guarantee match the docstring instead of leaning on it.
 */
export function designImageRefs(text, designRel = '.design', cap = 6) {
  const rel = String(designRel || '.design').replace(/^\/+|\/+$/g, '');
  if (!rel) return [];
  const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A path token: optional abs/relative prefix, then `<rel>/…/<img>`. Boundaries
  // tolerate the markdown the paths arrive wrapped in (backticks, quotes,
  // parens) and shed trailing punctuation via the lookahead.
  // Bounded quantifiers ({0,256}/{1,256}) keep the per-start scan constant-time —
  // a long failing candidate (attacker-influenceable assistant text) can't drive
  // superlinear backtracking. No real designRoot path segment run approaches 256.
  const re = new RegExp(
    `(?:^|[\\s\`'"(\\[])((?:[^\\s\`'"()\\[\\]]{0,256}/)?${esc}/[^\\s\`'"()\\[\\]]{1,256}?\\.(?:png|jpe?g|gif|webp))(?=[\\s\`'")\\]]|[.,:;!?]|$)`,
    'gi'
  );
  const urls = [];
  let m;
  while ((m = re.exec(String(text || ''))) && urls.length < cap) {
    const raw = m[1];
    const at = raw.lastIndexOf(`${rel}/`);
    if (at !== 0 && raw[at - 1] !== '/') continue; // `not-.design/x.png` must not match
    const relPath = raw.slice(at);
    const url = `/${relPath}`;
    // Traversal guard — ALLOWLIST the canonical form, don't blocklist escape
    // spellings (DDR-145 security follow-up). Two lanes the browser/server
    // normalize differently:
    //  1. Reject ANY percent-encoding outright — a plain designRoot path in
    //     assistant prose never carries `%`, but `..%2f` survives the WHATWG
    //     `URL` parse (pathname keeps `%2F` literal) and then the SERVER's
    //     `safePathUnderRoot` decodes it out of designRel.
    //  2. Parse exactly as the browser will (WHATWG collapses `..` dot-segments
    //     AND rewrites `\`→`/` for http(s)) and require the result byte-identical
    //     AND still under `/rel/` — closes `..`, `..\`, and mixed spellings.
    if (relPath.includes('%')) continue;
    let canon;
    try {
      canon = new URL(url, 'http://x').pathname;
    } catch {
      continue;
    }
    if (canon !== url || !canon.startsWith(`/${rel}/`)) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

// Expand collapsed paste chips ([image-1]/[file-1]/[link-1]) back to the real
// path/URL the user pasted, so Claude receives the actual value while the chat
// bubble keeps the compact badge. Unknown tokens (e.g. a stale one the user typed
// by hand) are left untouched.
function expandPasteChips(text, map) {
  if (!map || !map.size) return text;
  return text.replace(/\[(?:image|file|link)-\d+\]/g, (tok) => map.get(tok) ?? tok);
}

/**
 * assistant-ui `ChatModelAdapter` over the ACP bridge. Streams text + tool-call
 * parts, preserving the order in which the agent emits them. `available_commands_update`
 * and `usage_update` are intentionally dropped (chrome noise, not chat content).
 */
export function makeAcpAdapter(
  conn,
  getChatId,
  getModel,
  getEffort,
  getAttachments,
  getContext,
  getMode
) {
  return {
    async *run({ messages, abortSignal }) {
      // Let any in-flight clipboard-image upload finish so its chip expands to a
      // real path instead of the literal [image-N] (race when the user pastes an
      // image and hits Enter immediately).
      const att = getAttachments?.();
      if (att?.pending?.size) await Promise.allSettled([...att.pending]);
      const typed = expandPasteChips(lastUserText(messages), att?.map);
      if (!typed) return;
      // Freeze the canvas/selection context AT SEND (feature-acp-context-
      // hardening): the turn keeps the context it had when the user hit Enter,
      // immune to the user switching canvases while it runs. The same object
      // drives the visible composer chip (DDR-140 reveal — what you see is
      // what rides); the bracket lines carry locators only, never DOM html.
      // APPENDED after the typed text (paste-chip semantics) so the user's own
      // words stay first — chat titles and history read naturally.
      const frozen = getContext?.();
      const text = frozen?.block ? `${typed}\n\n${frozen.block}` : typed;

      const parts = [];
      const toolIndex = new Map();

      for await (const frame of conn.prompt(
        text,
        getChatId(),
        abortSignal,
        getModel?.(),
        getEffort?.(),
        getMode?.()
      )) {
        if (frame.t !== 'update') continue;
        applyUpdate(parts, toolIndex, frame.update);
        yield { content: parts.slice() };
      }
    },
  };
}
