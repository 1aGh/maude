// Phase 31 (DDR-123) — the native ACP chat sidepanel.
//
// Built over @assistant-ui/react's HEADLESS primitives (ThreadPrimitive /
// MessagePrimitive / ComposerPrimitive + useLocalRuntime) with our own
// Maude-styled components on top — NOT the lib's shadcn/Tailwind theme. The
// streaming/runtime plumbing comes from assistant-ui; the look is Maude CSS
// (the `chat-*` classes ported from `.design/ui/ChatPanel.css`). The runtime
// adapter (acp-runtime.js) bridges to the dev-server `/_ws/acp` bridge, which
// drives the user's own `claude` on their subscription (never API billing).
//
// Native-app only — app.jsx mounts this gated on isNativeApp().

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime } from '@assistant-ui/react';

import {
  flattenSelectOptions,
  parseConfigOptions,
  resolvePersistedPick,
} from './acp-capabilities.js';
import { parseUsage } from './acp-usage.js';
import {
  attachmentName,
  createAcpConnection,
  lastUserText,
  makeAcpAdapter,
} from './acp-runtime.js';
import { ChatHeader } from './chat-header.jsx';
import { StIcon } from '../shell/icons.jsx';
import { menuCtx } from '../v2/shell/project-menu-model.js';
import { ChatAdvanced, SuggestOnlyBanner } from '../v2/ai/Advanced.jsx';
import { AiChatIsland } from '../v2/ai/AiChatIsland.jsx';
import { JumpToLatest, PinButtonHost } from '../v2/ai/BigChat.jsx';
import { ChatList } from '../v2/ai/ChatList.jsx';
import { DropOverlay } from '../v2/ai/DropOverlay.jsx';
import { Composer } from '../v2/ai/Composer.jsx';
import { sendToAskAI } from '../v2/search/search-env.js';
import {
  AssistantMessage,
  ChatLightbox,
  ChatMediaContext,
  ContinuationBubble,
  UserMessage,
} from '../v2/ai/Feed.jsx';
import { RunSurface } from '../v2/ai/RunSurface.jsx';
import { RunsCount } from '../v2/ai/RunList.jsx';
import NeedsYouSlot from '../v2/ai/NeedsYouSlot.jsx';
import { QuotaLine } from '../v2/ai/NotReady.jsx';
import { doneNotice, OPEN_AI_EVENT, openAiChat } from '../v2/ai/needs-you-toast.js';
import { StoppedDivider } from '../v2/ai/StoppedDivider.jsx';
import { ChatEmpty, SuggestStrip } from '../v2/ai/Suggest.jsx';
import { readSuggestPref, writeSuggestPref } from '../v2/ai/suggest-why.js';
import { useAiScope } from '../v2/ai/use-ai-scope.js';
import { WaitingCards } from '../v2/ai/WaitingCard.jsx';
import { useAttachments } from '../v2/ai/use-attachments.js';
import { notify } from '../../notifications.tsx';
import { DEFAULT_TRANSCRIPT_VIEW, TRANSCRIPT_VIEWS } from './transcript-view.js';

// DDR-185 — shared "did a genuinely new item arrive" check for the
// permission/elicitation effects below: both need the identical shape (diff
// the incoming list's ids against the previous snapshot, fire onNew only for
// a real arrival, never for a resolution/removal), just against a different
// ref and a different onNew callback.
function fireOnNewArrival(prevIdsRef, list, onNew) {
  const hasNew = list.some((item) => !prevIdsRef.current.has(item.id));
  prevIdsRef.current = new Set(list.map((item) => item.id));
  if (hasNew) onNew?.();
}

function safeStorageGet(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / unavailable — non-fatal */
  }
}

// Model/effort/mode picks (feature-acp-panel-dynamic-claude-code-capabilities)
// — persisted generically by config id in ONE blob, since the set of options
// is agent-defined and NOT a fixed list (a hardcoded per-field key would miss
// a future option like "agent" persona). One-time migration reads the OLD
// fixed keys this panel used before the dynamic capability channel shipped.
const PICKS_KEY = 'maude-acp-picks';
function loadPersistedPicks() {
  const raw = safeStorageGet(PICKS_KEY, null);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* corrupt blob — fall through to a clean slate */
    }
  }
  const picks = {};
  const legacyModel = safeStorageGet('maude-acp-model', '');
  const legacyEffort = safeStorageGet('maude-acp-effort', '');
  if (legacyModel) picks.model = legacyModel;
  if (legacyEffort && legacyEffort !== 'balanced') picks.effort = legacyEffort;
  return picks;
}
function savePersistedPicks(picks) {
  safeStorageSet(PICKS_KEY, JSON.stringify(picks));
}

// The suggest-only banner (DDR-184 #3, 03 `ai-adv-edges`) lives with the Advanced fold now:
// v2/ai/Advanced.jsx `SuggestOnlyBanner` — same testids, plain words, one verb ("Allow changes").

// gate-b-polish2 (CONTRACT §7, 02 ob-ai-connect, 03): the v1 not-ready panel (DDR-166 T0f's readiness list,
// the not-ready heading) is gone from the AI panel. Ask AI looks the same as always; the first send is
// kept and the ConnectSheet asks once (v2/ai/NeedsYouSlot.jsx); the readiness list, whole, is Menu ›
// Diagnostics › AI setup (diag-ai) and Settings › Connections.

// Repo-level chat id — generated for each new chat.
function newChatId() {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Disk transcript (clean ChatMessage[]) → assistant-ui initial messages.
function toThreadMessages(msgs) {
  return (msgs || []).map((m) => {
    if (m.role === 'user') {
      return {
        role: 'user',
        content: [{ type: 'text', text: (m.parts || []).map((p) => p.text || '').join('') }],
        // S5.19 — the day dividers read when the ask was sent
        ...(Number.isFinite(m.at) ? { createdAt: new Date(m.at) } : {}),
      };
    }
    return {
      role: 'assistant',
      content: (m.parts || []).map((p, i) =>
        p.type === 'text'
          ? { type: 'text', text: p.text || '' }
          : {
              type: 'tool-call',
              toolCallId: `h-${i}`,
              toolName: p.toolName || 'tool',
              args: {},
              argsText: '{}',
              result: p.done ? {} : undefined,
            }
      ),
    };
  });
}

// One thread = one chat, with its OWN connection (own WS / bridge / claude) so
// chats run in parallel. ChatPanel keeps every open thread MOUNTED and just
// toggles `hidden`, so switching never interrupts a running chat — it keeps
// streaming in the background.
function ChatThread({
  conn,
  chatId,
  initialMessages,
  hidden,
  picksRef,
  setPick,
  activeCanvas,
  selected,
  designRel,
  openComments,
  selectedClips,
  justShared,
  viewArtboardId,
  panelHidden,
  transcriptView,
  onSetTranscriptView,
  onPermissionRequest,
  onElicitationRequest,
  chatTitle,
  uiCtx,
  onCopyTranscript,
  suggestOn,
  onSetSuggestOn,
  unavailable = false,
  viewer = false,
  onConnected,
}) {
  // Live session capabilities (feature-acp-panel-dynamic-claude-code-
  // capabilities) — `caps` is THIS chat's own connection's mode roster +
  // config-option set, sourced entirely from the ACP session. Never a
  // hardcoded list; re-renders on every `caps` frame (a model switch can
  // change which OTHER options — effort, fast — are even offered).
  const [caps, setCaps] = useState({ modes: null, configOptions: [] });
  useEffect(() => conn.onCaps(setCaps), [conn]);
  const parsedOptions = useMemo(() => parseConfigOptions(caps.configOptions), [caps.configOptions]);

  // Warm up as soon as this chat becomes the VISIBLE one — the capability bar
  // has nothing to show until a live session exists, and deferring the spawn
  // to "the user typed a slash command" (the original Composer-only trigger,
  // still below) left the model/effort/mode row completely EMPTY until then —
  // read as "I lost the picker" in dogfooding, a real regression. Fires once
  // per chat; a chat that's opened but never viewed still doesn't spawn
  // `claude`, so a background/hidden chat keeps some of DDR-123's "opening
  // the panel costs nothing" intent — only the chat actually on screen warms.
  const warmedOnVisibleRef = useRef(false);
  useEffect(() => {
    // S5.13: nothing to warm while Claude Code is not ready; the effect runs again when it is.
    if (hidden || unavailable || warmedOnVisibleRef.current) return;
    warmedOnVisibleRef.current = true;
    const p = picksRef.current;
    conn.warm(chatId, p.model, p.effort, p.mode);
  }, [hidden, unavailable, conn, chatId, picksRef]);

  // One-time reconciliation: if the user's persisted pick (from a DIFFERENT
  // chat, or an earlier session) isn't what THIS freshly-established session
  // actually landed on but IS now offered, nudge it live once. The bridge
  // already tries this itself on establish (Task A3) — this is a client-side
  // safety net for the rare race where the persisted value changed after the
  // `warm`/`prompt` frame was already in flight. Bounded to once per mount so
  // it can never loop.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    const hasModes = (caps.modes?.availableModes?.length ?? 0) > 0;
    const hasOptions = caps.configOptions.length > 0;
    if (!hasModes && !hasOptions) return; // nothing to reconcile against yet
    reconciledRef.current = true;
    const picks = picksRef.current;
    if (parsedOptions.model && picks.model) {
      const values = flattenSelectOptions(parsedOptions.model.options).map((o) => o.value);
      const resolved = resolvePersistedPick(values, picks.model, parsedOptions.model.currentValue);
      if (resolved !== parsedOptions.model.currentValue) conn.setConfig(chatId, 'model', resolved);
    }
    if (parsedOptions.effort && picks.effort) {
      const values = flattenSelectOptions(parsedOptions.effort.options).map((o) => o.value);
      const resolved = resolvePersistedPick(
        values,
        picks.effort,
        parsedOptions.effort.currentValue
      );
      if (resolved !== parsedOptions.effort.currentValue)
        conn.setConfig(chatId, 'effort', resolved);
    }
    if (hasModes && picks.mode) {
      const ids = caps.modes.availableModes.map((m) => m.id);
      const resolved = resolvePersistedPick(ids, picks.mode, caps.modes.currentModeId);
      if (resolved !== caps.modes.currentModeId) conn.setMode(chatId, resolved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps, parsedOptions]);

  const onSetMode = useCallback(
    (modeId) => {
      conn.setMode(chatId, modeId);
      setPick('mode', modeId);
    },
    [conn, chatId, setPick]
  );
  const onSetConfig = useCallback(
    (configId, value) => {
      conn.setConfig(chatId, configId, value);
      setPick(configId, value);
    },
    [conn, chatId, setPick]
  );
  // Paste attachments: `map` = chip token ([image-1]…) → real path/URL (null while
  // an image upload is in flight); `pending` = the in-flight upload promises. The
  // adapter awaits `pending` then expands `map` before sending; the composer writes
  // both on paste.
  const attachmentsRef = useRef({ map: new Map(), pending: new Set() });
  // S5.10 — drop · paste · paperclip chips and the folder consent; the adapter reads them off the ref.
  const attach = useAttachments({ chatId, attachmentsRef });
  // Canvas/selection context attachment (feature-acp-context-hardening) + the scope chip (S5.8). One
  // buildChatContext result drives BOTH the composer chip and the frozen block the adapter prepends at
  // send (`contextRef` is what it reads — freeze = read-once). The chip follows the selection until the
  // person narrows it; removing it (DDR-140) sends the ask without the canvas.
  const aiScope = useAiScope({ activeCanvas, selected, panelHidden, viewArtboardId });
  const { contextRef } = aiScope;
  const adapter = useMemo(
    () =>
      makeAcpAdapter(
        conn,
        () => chatId,
        () => picksRef.current.model || null,
        () => picksRef.current.effort || null,
        () => attachmentsRef.current,
        () => contextRef.current,
        () => picksRef.current.mode || null
      ),
    [conn, chatId, picksRef, contextRef]
  );
  const runtime = useLocalRuntime(adapter, { initialMessages });
  // Image thumbnails + lightbox — one overlay per thread; bubbles reach it (and
  // the chip → attachment-name resolution) through ChatMediaContext. Also
  // carries `transcriptView` (Task C4) — AssistantMessage is rendered via
  // ThreadPrimitive.Messages' component registry, which doesn't pass custom
  // props through, so this context is the only way it reaches the filter.
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const media = useMemo(
    () => ({
      chipName: (token) => attachmentName(attachmentsRef.current.map.get(token) || ''),
      openLightbox: setLightboxSrc,
      designRel,
      transcriptView,
    }),
    [designRel, transcriptView]
  );
  const [activeTools, setActiveTools] = useState([]);
  useEffect(() => conn.onActivity(setActiveTools), [conn]);
  // Post-turn-end continuation (the tail the client used to drop — RCA F2).
  const [bgParts, setBgParts] = useState([]);
  useEffect(() => conn.onBackground(setBgParts), [conn]);
  // DDR-185 — surface a "Maude needs your input" attention ping to the parent
  // (app.jsx) whenever a GENUINELY NEW permission/elicitation request arrives,
  // not on every list churn (a request resolving/timing out also updates the
  // list — that must NOT re-fire the notification). Read via a ref, not the
  // effect's own dependency array, so a parent re-render that produces a new
  // callback identity doesn't force conn.onPermission/onElicitation to
  // re-subscribe.
  const attentionCbRef = useRef({ onPermissionRequest, onElicitationRequest });
  useEffect(() => {
    attentionCbRef.current = { onPermissionRequest, onElicitationRequest };
  }, [onPermissionRequest, onElicitationRequest]);

  // Pending permission requests (Milestone B) — one card at a time, oldest first.
  const [pendingPermissions, setPendingPermissions] = useState([]);
  const prevPermissionIdsRef = useRef(new Set());
  useEffect(
    () =>
      conn.onPermission((list) => {
        fireOnNewArrival(prevPermissionIdsRef, list, attentionCbRef.current.onPermissionRequest);
        setPendingPermissions(list);
      }),
    [conn]
  );
  const activePermission = pendingPermissions[0] || null;
  const respondPermission = useCallback(
    (decision) => activePermission && conn.respondPermission(activePermission.id, decision),
    [conn, activePermission]
  );
  // Pending elicitation requests (feature-acp-ask-user-question) — same
  // one-at-a-time, oldest-first treatment as pendingPermissions above.
  const [pendingElicitations, setPendingElicitations] = useState([]);
  const prevElicitationIdsRef = useRef(new Set());
  useEffect(
    () =>
      conn.onElicitation((list) => {
        fireOnNewArrival(prevElicitationIdsRef, list, attentionCbRef.current.onElicitationRequest);
        setPendingElicitations(list);
      }),
    [conn]
  );
  const activeElicitation = pendingElicitations[0] || null;
  const respondElicitation = useCallback(
    (response) => activeElicitation && conn.respondElicitation(activeElicitation.id, response),
    [conn, activeElicitation]
  );
  // Connection-problem error card (Task C3) — see conn.onError's doc comment.
  const [turnError, setTurnError] = useState(null);
  useEffect(() => conn.onError(setTurnError), [conn]);
  const retryLastTurn = useCallback(() => {
    const text = lastUserText(runtime.thread.getState().messages);
    if (text) runtime.thread.append(text);
  }, [runtime]);
  // S5.13 (03 `ai-panel-closed`): hiding the panel never stops AI, and a toast says when the chat is done.
  const panelHiddenRef = useRef(panelHidden);
  panelHiddenRef.current = panelHidden;
  useEffect(() => {
    let was = false;
    return conn.onBusy((busy) => {
      const finished = was && !busy;
      was = busy;
      if (!finished || !panelHiddenRef.current) return;
      const msgs = runtime.thread.getState().messages;
      const last = [...msgs].reverse().find((m) => m.role === 'assistant');
      const text = (last?.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join(' ');
      const notice = doneNotice({
        id: `ai-done-${chatId}`,
        text,
        onShow: () => openAiChat(chatId),
      });
      if (notice) notify(notice);
    });
  }, [conn, runtime, chatId]);

  // Usage (Milestone D) — context-window gauge + session cost + an event-
  // driven single-window rate-limit banner. Per-chat: each ChatThread has its
  // own connection, so this is naturally scoped to the right session.
  const [rawUsage, setRawUsage] = useState(null);
  useEffect(() => conn.onUsage(setRawUsage), [conn]);
  const usage = useMemo(() => parseUsage({ usage: rawUsage }), [rawUsage]);
  const [bannerDismissedFor, setBannerDismissedFor] = useState(null);
  const showRateLimitBanner =
    usage.rateLimit &&
    (usage.rateLimit.status === 'allowed_warning' || usage.rateLimit.status === 'rejected') &&
    bannerDismissedFor !== `${usage.rateLimit.type}:${usage.rateLimit.resetsAt}`;
  const dismissRateLimitBanner = useCallback(() => {
    if (usage.rateLimit)
      setBannerDismissedFor(`${usage.rateLimit.type}:${usage.rateLimit.resetsAt}`);
  }, [usage.rateLimit]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatMediaContext.Provider value={media}>
        <div className="chat-panel" style={hidden ? { display: 'none' } : undefined}>
          <DropOverlay attach={attach} />
          {/* DDR-184 #3 — said up front when the current mode can't edit (plan / dontAsk),
            so a user typing "change X" isn't silently ignored. Above the feed. */}
          <SuggestOnlyBanner modes={caps.modes} onSetMode={onSetMode} />
          <ThreadPrimitive.Root className="chat-thread">
            {/* gate-b-a11y: the feed scrolls, so it is a tab stop with a name (axe scrollable-region-focusable) */}
            <ThreadPrimitive.Viewport
              className="chat-feed"
              autoScroll
              tabIndex={0}
              aria-label="Conversation"
            >
              <ThreadPrimitive.Empty>
                <ChatEmpty />
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
              {/* Background work that outlived the turn — streamed here so it's not
                dropped (RCA F2). */}
              <ContinuationBubble parts={bgParts} viewMode={transcriptView} />
              {/* S5.9 — the run's tail: the working line with Stop, then the result card (replaces the v1
                  ActivityBar), and the long chat's Jump to latest */}
              <RunSurface
                conn={conn}
                chatId={chatId}
                tools={activeTools}
                artboards={aiScope.artboards}
                designRel={designRel}
              />
              {/* S5.14: "Stopped when the app quit · …" + Keep going (03 ai-quit). */}
              <StoppedDivider chatId={chatId} hidden={hidden} />
              <JumpToLatest hidden={hidden} />
            </ThreadPrimitive.Viewport>
            <WaitingCards chatId={chatId} designRel={designRel} />
            {/* S5.13 — the open question, a failure, or the kept prompt's line (client/v2/ai/NeedsYouSlot.jsx):
                a permission waits here, inline, never modal. */}
            <NeedsYouSlot
              conn={conn}
              chatId={chatId}
              away={hidden || panelHidden}
              pendingPermissions={pendingPermissions}
              pendingElicitations={pendingElicitations}
              onRespondPermission={respondPermission}
              onRespondElicitation={respondElicitation}
              turnError={turnError}
              onRetry={retryLastTurn}
              onConnected={onConnected}
            />
            <QuotaLine rateLimit={usage.rateLimit} />
            <Composer
              activeCanvas={activeCanvas}
              scope={aiScope.scope}
              artboards={aiScope.artboards}
              activeArtboardId={aiScope.activeArtboardId}
              stale={aiScope.stale}
              onChooseScope={aiScope.choose}
              onCtxDismiss={aiScope.remove}
              above={
                <ThreadPrimitive.If running={false}>
                  <SuggestStrip
                    openComments={openComments}
                    selectedClips={selectedClips}
                    justShared={justShared}
                    enabled={suggestOn}
                    lastFailed={!!turnError}
                  />
                </ThreadPrimitive.If>
              }
              picksRef={picksRef}
              conn={conn}
              chatId={chatId}
              attachmentsRef={attachmentsRef}
              attach={attach}
              usage={usage}
              showRateLimitBanner={
                showRateLimitBanner && usage.rateLimit?.status !== 'allowed_warning'
              }
              onDismissRateLimitBanner={dismissRateLimitBanner}
              // S10.16c — the gates a DS host's "send" meets: this chat in front · connected · not a viewer
              active={!hidden}
              unavailable={unavailable}
              viewer={viewer}
            />
            {/* S5.12 — everything that used to sit in the field's toolbar, under one quiet row. */}
            <ChatAdvanced
              chatId={chatId}
              chatTitle={chatTitle}
              active={!hidden && !panelHidden}
              caps={{ modes: caps.modes, parsedOptions }}
              onSetMode={onSetMode}
              onSetConfig={onSetConfig}
              transcriptView={transcriptView}
              onSetTranscriptView={onSetTranscriptView}
              suggestOn={suggestOn}
              onSetSuggestOn={onSetSuggestOn}
              usage={usage}
              ctx={uiCtx}
              onCopyTranscript={onCopyTranscript}
            />
          </ThreadPrimitive.Root>
          {lightboxSrc ? (
            <ChatLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
          ) : null}
        </div>
      </ChatMediaContext.Provider>
    </AssistantRuntimeProvider>
  );
}

// ── panel root ──
export default function ChatPanel({
  activeCanvas,
  selected,
  designRel,
  openComments = 0,
  selectedClips = 0,
  justShared = null,
  viewArtboardId = null,
  width,
  resizing,
  onClose,
  hidden = false,
  onBusyChange,
  onFinished,
  onPermissionRequest,
  onElicitationRequest,
  readOnly = false,
  projectName = '',
}) {
  // Model/effort/mode picks — persisted across sessions per config id (never a
  // fixed model/effort pair; see loadPersistedPicks). Read live by each open
  // chat's adapter (for a FRESH session's one-time apply) and by the picker's
  // one-time reconciliation effect.
  const [picks, setPicks] = useState(loadPersistedPicks);
  const picksRef = useRef(picks);
  useEffect(() => {
    picksRef.current = picks;
    savePersistedPicks(picks);
  }, [picks]);
  const setPick = useCallback((id, value) => {
    setPicks((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }));
  }, []);

  // Transcript view mode (Task C4) — panel-wide (applies to every open chat),
  // persisted, changed via the per-chat overflow menu (Task C5).
  const [transcriptView, setTranscriptView] = useState(() => {
    const saved = safeStorageGet('maude-acp-transcript-view', DEFAULT_TRANSCRIPT_VIEW);
    return TRANSCRIPT_VIEWS.includes(saved) ? saved : DEFAULT_TRANSCRIPT_VIEW;
  });
  useEffect(() => {
    safeStorageSet('maude-acp-transcript-view', transcriptView);
  }, [transcriptView]);

  // Availability is global (is claude installed) — a single probe, no connection.
  const [status, setStatus] = useState({ available: null, reason: undefined });
  const probeStatus = useCallback(
    () =>
      fetch('/_api/acp/status')
        .then((r) => r.json())
        .then((d) => setStatus({ available: d.available, reason: d.reason }))
        .catch(() => setStatus({ available: false, reason: 'Could not reach the Claude bridge.' })),
    []
  );
  useEffect(() => {
    probeStatus();
  }, [probeStatus]);

  // After the ConnectSheet connects, look again so the panel unlocks in place (no reopen). The readiness
  // breakdown (DDR-128) is Menu › Diagnostics › AI setup now.
  const recheck = probeStatus;

  // Recents (for the header's title) + the open chat list's re-read trigger.
  const [chats, setChats] = useState([]);
  const [listKey, setListKey] = useState(0);
  // Suggestions on/off lives in Advanced; it is a per-Mac preference shared by every chat.
  const [suggestOn, setSuggestOn] = useState(readSuggestPref);
  const onSetSuggestOn = useCallback((on) => {
    writeSuggestPref(on);
    setSuggestOn(on);
  }, []);
  // What the chat list's ⋯ menu may offer (the registry's own predicates — the server refuses the same writes).
  const uiCtx = useMemo(() => menuCtx({ native: true, readOnly }), [readOnly]);
  // Chat ids the server confirms have a user-set title (ChatSummary.renamed)
  // — session_info_update must never clobber those (Task C5 gotcha: "an
  // explicit rename must not be silently clobbered by an auto-generated
  // summary landing afterward"). Seeded/kept in sync from every refreshChats().
  const renamedChatIdsRef = useRef(new Set());
  const refreshChats = useCallback(() => {
    fetch('/_api/acp/chats')
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d)) return;
        setChats(d);
        renamedChatIdsRef.current = new Set(d.filter((c) => c.renamed).map((c) => c.id));
        setListKey((k) => k + 1); // the open chat list reads again (S5.12)
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  // PARALLEL chats — one connection (own WS / bridge / claude) per open chat.
  // Every open chat stays mounted; switching just changes which is visible, so
  // a running chat keeps going in the background.
  const connsRef = useRef(new Map()); // chatId → connection
  const busyRef = useRef(new Map()); // chatId → busy (aggregated for the menubar)
  const hydratedRef = useRef(new Map()); // chatId → initial messages
  // chatId → the transcript LINE the hydration above covered (the
  // `X-Maude-Chat-Seq` response header). Handed to the connection's `attach`
  // so the server replays only what the client missed — Addendum Task 8's
  // re-attach seam. Absent/0 for a chat that was never hydrated (a new chat).
  const hydratedSeqRef = useRef(new Map());
  const [openChatIds, setOpenChatIds] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [busyChats, setBusyChats] = useState({}); // reactive: chatId → busy (for the dot)
  // Agent-generated chat titles (`session_info_update`) — wins over the
  // client's "New chat" heuristic once the agent names the first turn.
  const [sessionTitles, setSessionTitles] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);
  const cbRef = useRef({ onBusyChange, onFinished });
  useEffect(() => {
    cbRef.current = { onBusyChange, onFinished };
  }, [onBusyChange, onFinished]);

  const ensureConn = useCallback(
    (chatId) => {
      const existing = connsRef.current.get(chatId);
      if (existing) return existing;
      const conn = createAcpConnection();
      // Addendum Task 8 — bind BEFORE anything can open the socket. The `attach`
      // frame goes out from `onopen` and is what subscribes this socket to the
      // chat's server-side bridge (which now outlives its socket, so it may
      // already be mid-turn from before a reload). `hydratedSeqRef` holds the
      // transcript line the history fetch covered, so the server replays exactly
      // the gap — no duplicated tail, no hole.
      conn.bindChat(chatId, hydratedSeqRef.current.get(chatId) || 0);
      connsRef.current.set(chatId, conn);
      // Agent-generated title (session_info_update — fires at turn-end, so a
      // fresh chat shows the client's "New chat" heuristic until the first
      // turn completes; expected). Read live by chatOptions below.
      conn.onSessionInfo((info) => {
        if (info.title && !renamedChatIdsRef.current.has(chatId)) {
          setSessionTitles((prev) => ({ ...prev, [chatId]: info.title }));
        }
      });
      // Background work (subagents) can outlive the main turn — the ACP adapter
      // settles the prompt at the main agent's `result` while they drain
      // (claude-agent-acp #773). Track live tool activity so the menubar
      // badge/dot + the "finished" ping reflect TRUE quiescence, not the
      // premature turn-end. (RCA issue-acp-subagent-activity-invisible.)
      let bgActive = false; // a tool (e.g. a subagent) is still running
      let busyNow = false; // the prompt turn itself is in flight
      let deferredFinish = false; // turn ended while background work continued
      const syncAggregate = () => {
        const wasAny = [...busyRef.current.values()].some(Boolean);
        busyRef.current.set(chatId, busyNow || bgActive);
        const nowAny = [...busyRef.current.values()].some(Boolean);
        if (wasAny !== nowAny) cbRef.current.onBusyChange?.(nowAny);
      };
      conn.onActivity((activeTools) => {
        bgActive = activeTools.length > 0;
        syncAggregate();
        if (deferredFinish && !bgActive && !busyNow) {
          deferredFinish = false;
          setBusyChats((prev) => ({ ...prev, [chatId]: false }));
          cbRef.current.onFinished?.();
          refreshChats();
        }
      });
      conn.onBusy((busy) => {
        busyNow = busy;
        syncAggregate();
        if (busy) {
          deferredFinish = false; // a new turn supersedes any pending drain ping
          setBusyChats((prev) => ({ ...prev, [chatId]: true })); // reactive dot
          return;
        }
        // Turn ended. If background work is still draining, keep the dot lit and
        // hold the "finished" ping until the activity list empties (onActivity).
        if (bgActive) {
          deferredFinish = true;
          refreshChats();
        } else {
          setBusyChats((prev) => ({ ...prev, [chatId]: false }));
          cbRef.current.onFinished?.();
          refreshChats();
        }
      });
      return conn;
    },
    [refreshChats]
  );

  const openChat = useCallback(
    (chatId, initialMessages) => {
      hydratedRef.current.set(chatId, initialMessages || []);
      ensureConn(chatId);
      setOpenChatIds((ids) => (ids.includes(chatId) ? ids : [...ids, chatId]));
      setActiveChatId(chatId);
    },
    [ensureConn]
  );

  const newChat = useCallback(() => openChat(newChatId(), []), [openChat]);

  const switchTo = useCallback(
    (id) => {
      if (!id || id === activeChatId) return;
      if (connsRef.current.has(id)) {
        setActiveChatId(id); // already open in the background → just show it
        return;
      }
      fetch(`/_api/acp/chat?id=${encodeURIComponent(id)}`)
        .then(async (r) => {
          // Capture the seam marker alongside the body — see hydratedSeqRef.
          const seq = Number(r.headers.get('X-Maude-Chat-Seq') || 0);
          hydratedSeqRef.current.set(id, Number.isFinite(seq) ? seq : 0);
          return r.json();
        })
        .then((msgs) => openChat(id, toThreadMessages(msgs)))
        .catch(() => {});
    },
    [activeChatId, openChat]
  );
  // S5.13 — a "Needs you" / "Done" toast's Open / Show lands on the chat it was about (the shell opens the
  // panel itself on the same event).
  useEffect(() => {
    const on = (e) => switchTo(e?.detail?.chat);
    window.addEventListener(OPEN_AI_EVENT, on);
    return () => window.removeEventListener(OPEN_AI_EVENT, on);
  }, [switchTo]);

  // A chat moved to the trash (the list did that, server-side) — kill its claude (close the conn), forget
  // it here, and fall back to another open chat (or a fresh one) if it was active.
  const closeChat = useCallback(
    (id) => {
      const conn = connsRef.current.get(id);
      if (conn) conn.close();
      connsRef.current.delete(id);
      busyRef.current.delete(id);
      hydratedRef.current.delete(id);
      hydratedSeqRef.current.delete(id);
      setBusyChats((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSessionTitles((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      refreshChats();
      setOpenChatIds((ids) => {
        const remaining = ids.filter((x) => x !== id);
        if (id === activeChatId) {
          if (remaining.length) setActiveChatId(remaining[remaining.length - 1]);
          else {
            const fresh = newChatId();
            hydratedRef.current.set(fresh, []);
            ensureConn(fresh);
            setActiveChatId(fresh);
            return [fresh];
          }
        }
        return remaining;
      });
    },
    [activeChatId, ensureConn, refreshChats]
  );

  // Rename / Archive / Copy transcript (Task C5 — per-chat overflow menu).
  // Rename/Archive PATCH the `_chat/<id>.meta.json` sidecar (acp/transcript.ts)
  // — chosen over injecting a synthetic `/rename` prompt (Task B/C research):
  // deterministic, doesn't pollute the transcript with a synthetic turn, and
  // needs no unverified assumption about how the CLI's own /rename behaves
  // over ACP. `renamedChatIdsRef` (set above) keeps a later live auto-title
  // from clobbering it.
  const patchChatMeta = useCallback((id, patch) => {
    return fetch(`/_api/acp/chat?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }, []);

  // The list hands back the new name; an explicit rename must not be clobbered by a later auto-title.
  const renameChat = useCallback(
    (id, value) => {
      renamedChatIdsRef.current.add(id);
      setSessionTitles((prev) => ({ ...prev, [id]: value })); // optimistic — see gotcha above
      patchChatMeta(id, { title: value }).then(refreshChats);
    },
    [patchChatMeta, refreshChats]
  );

  const archiveChat = useCallback(
    (id) => {
      patchChatMeta(id, { archived: true }).then(() => {
        refreshChats();
        // An archived chat can still be OPEN (mounted, running) — archiving
        // only hides it from recents, per the task spec; it does not close
        // the connection or force-switch away.
      });
    },
    [patchChatMeta, refreshChats]
  );

  const copyTranscript = useCallback((id) => {
    return fetch(`/_api/acp/chat?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((msgs) => {
        const text = (Array.isArray(msgs) ? msgs : [])
          .map((m) => {
            const body = (m.parts || [])
              .map((p) =>
                p.type === 'text'
                  ? p.text || ''
                  : p.type === 'tool'
                    ? `[${p.toolName || 'tool'}]`
                    : ''
              )
              .join('');
            return `${m.role === 'user' ? 'User' : 'Claude'}: ${body}`;
          })
          .join('\n\n');
        return navigator.clipboard?.writeText(text);
      })
      .catch(() => {});
  }, []);

  // Open a fresh chat on mount; close every connection on unmount.
  useEffect(() => {
    newChat();
    const conns = connsRef.current;
    return () => {
      for (const c of conns.values()) c.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switcher options — open chats first (parallel), then the rest of the recents.
  // Title precedence: the agent's own session_info_update title (live, this
  // process lifetime) > the persisted transcript's title > "New chat".
  const chatOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const id of openChatIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const title = sessionTitles[id] || chats.find((c) => c.id === id)?.title || 'New chat';
      list.push({ id, title, open: true });
    }
    for (const c of chats) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      list.push(sessionTitles[c.id] ? { ...c, title: sessionTitles[c.id] } : c);
    }
    return list;
  }, [chats, openChatIds, sessionTitles]);

  const connected = status.available !== false;

  return (
    <AiChatIsland hidden={hidden} resizing={resizing} width={width}>
      {/* V2-4.4b — the 03 header (kit `AIPanel chat=…`): spark · the chat's title ⌄ (opens the chat list) ·
          "✦ N" YOUR running chats · New chat · Hide. Hide folds the island to its spark corner icon. */}
      <ChatHeader
        connected={connected}
        onToggleList={() => setMenuOpen((v) => !v)}
        onNew={() => {
          newChat();
          setMenuOpen(false);
        }}
        onHide={onClose}
        pin={<PinButtonHost />}
      >
        <div className="chat-switch">
          <button
            type="button"
            className="chat-switch-trigger"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
          >
            <span className="chat-switch-title">
              {chatOptions.find((c) => c.id === activeChatId)?.title || 'New chat'}
            </span>
            <span className="chat-switch-chev" aria-hidden="true">
              <StIcon name="chevron-down" size={12} />
            </span>
          </button>
        </div>
        {/* S5.11 — "✦ N": YOUR live runs (the run registry), never anyone else's; its list jumps to the artboard. */}
        {connected ? (
          <RunsCount
            activeCanvas={activeCanvas}
            designRel={designRel}
            currentChatId={activeChatId}
            onOpenChat={switchTo}
          />
        ) : null}
      </ChatHeader>
      {/* S5.12 — the chat list (03 `ai-chat-list`): the title ⌄ opens it in place of the thread. The threads
          stay MOUNTED underneath (hidden, never unmounted) so a running chat keeps streaming. */}
      {menuOpen && connected ? (
        <div className="st-rp-body st-rp-body--list">
          <ChatList
            projectName={projectName}
            busy={busyChats}
            titles={sessionTitles}
            activeChatId={activeChatId}
            ctx={uiCtx}
            refreshKey={listKey}
            onOpen={(id) => {
              switchTo(id);
              setMenuOpen(false);
            }}
            onBack={() => setMenuOpen(false)}
            // S11.3 (05 · es-edge-panels): "Start a chat about it" — a new chat with the search words in its composer
            onStartChat={(text) => {
              newChat();
              setMenuOpen(false);
              sendToAskAI(text);
            }}
            onRename={renameChat}
            onCopyTranscript={copyTranscript}
            onArchive={archiveChat}
            onTrashed={closeChat}
          />
        </div>
      ) : null}
      <div
        className="st-rp-body st-rp-body--chat"
        style={menuOpen && connected ? { display: 'none' } : undefined}
      >
        {/* S5.13 (rule `ai-not-connected-yet`) + CONTRACT §7: Ask AI looks the same when Claude is not
            connected. The field stays, a prompt sent now is KEPT (the server queues it) and the ConnectSheet
            asks once (NeedsYouSlot). */}
        {openChatIds.map((id) => {
          const conn = connsRef.current.get(id);
          if (!conn) return null;
          return (
            <ChatThread
              key={id}
              conn={conn}
              chatId={id}
              initialMessages={hydratedRef.current.get(id) || []}
              hidden={id !== activeChatId}
              picksRef={picksRef}
              setPick={setPick}
              activeCanvas={activeCanvas}
              selected={selected}
              designRel={designRel}
              openComments={openComments}
              selectedClips={selectedClips}
              justShared={justShared}
              viewArtboardId={viewArtboardId}
              panelHidden={hidden}
              transcriptView={transcriptView}
              onSetTranscriptView={setTranscriptView}
              onPermissionRequest={onPermissionRequest}
              onElicitationRequest={onElicitationRequest}
              chatTitle={chatOptions.find((c) => c.id === id)?.title || 'New chat'}
              uiCtx={uiCtx}
              onCopyTranscript={copyTranscript}
              suggestOn={suggestOn}
              onSetSuggestOn={onSetSuggestOn}
              unavailable={status.available === false}
              viewer={readOnly}
              onConnected={recheck}
            />
          );
        })}
      </div>
    </AiChatIsland>
  );
}
