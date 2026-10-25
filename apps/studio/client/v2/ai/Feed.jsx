// v2/ai/Feed.jsx — the AI chat's feed: message renderers, media thumbnails + lightbox, the working /
// continuation / error rows (moved from ChatPanel.jsx, S5.8; behaviour unchanged except where marked S5.8).

import { ActionBarPrimitive, MessagePrimitive, useMessage, useThread } from '@assistant-ui/react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { activityLabel, designImageRefs, extractAttachmentRefs } from '../../panels/acp-runtime.js';
import { Markdown } from '../../panels/chat-markdown.jsx';
import ToolGroup, { groupToolCalls } from '../../panels/ToolGroup.jsx';
import {
  DEFAULT_TRANSCRIPT_VIEW,
  filterTranscriptParts,
  showsToolSteps,
  transcriptForcesExpand,
} from '../../panels/transcript-view.js';
import { stripOffer } from './ai-offer.js';
import { alreadySaysUnchanged, CANVAS_UNCHANGED, canvasUnchanged } from './answer-note.js';
import { OfferSlot } from './OfferCard.jsx';
import { SentStrip } from './SentStrip.jsx';
import { sentFromTranscript, useRecordedSent } from './sent-attachments.js';
import { TurnResult, useTurnRun } from './TurnResult.jsx';
import { changedSomething } from './run-model.js';
import { dayDividerFor } from './run-model.js';
import { StIcon } from '../../shell/icons.jsx';
import { Copy, Retry, Spark } from './icons.jsx';
import { OPEN_ASSETS_EVENT } from './AttachMenu.jsx';
import { failureModel } from './needs-you.js';

// ── message-part renderers ──
// Assistant text: markdown, plus a thumbnail strip for any designRoot image
// path the agent mentioned (e.g. "/design:screenshot → Saved to: .design/…png"
// — DDR-145). The path stays visible in the text; the strip adds the preview.
function ChatText({ text }) {
  const media = useContext(ChatMediaContext);
  const refs = designImageRefs(text, media?.designRel);
  return (
    <div className="chat-bubble">
      <Markdown text={text} />
      {refs.length ? (
        <div className="chat-thumbrow">
          {refs.map((src) => {
            const file = src.split('/').pop();
            return <ChatThumb key={src} src={src} label={`Open ${file}`} caption={file} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

function ChatReasoning({ text }) {
  return (
    <details className="chat-think">
      <summary className="chat-think-sum">
        <span className="chat-think-spark">
          <Spark size={11} />
        </span>
        Thinking
      </summary>
      <div className="chat-think-body">
        <Markdown text={text} />
      </div>
    </details>
  );
}

// Bounded JSON preview for the verbose transcript view (Task C4) — a raw tool
// arg/result can be arbitrarily large (a big file's content, a long stdout);
// cap it so one tool call can't blow up the feed's layout or paint cost.
function jsonPreview(value, cap = 800) {
  let s;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
  // An empty object/array/string preview ("{}", "[]", '""') is noise, not
  // information — a tool that legitimately took no args or returned nothing
  // shouldn't render a boxed detail block just to say so.
  if (!s || s === '{}' || s === '[]' || s === '""' || s === 'null') return null;
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

// `flat` (Task C1 revision, after dogfooding showed grouped tool calls
// rendering as nested bordered cards inside a bordered card — "divné") skips
// the standalone `.chat-tool` card chrome for a lighter row, used only when
// ChatToolCard renders inside ToolGroup's already-bordered accordion body.
function ChatToolCard({ toolName, args, result, isError, verbose, flat = false }) {
  const running = result === undefined;
  const path =
    args && typeof args === 'object' ? args.path || args.file || args.filePath : undefined;
  const argsPreview =
    verbose && args && typeof args === 'object' && Object.keys(args).length
      ? jsonPreview(args)
      : null;
  const resultPreview = verbose && !running && result != null ? jsonPreview(result) : null;
  const statusLabel = running ? 'running…' : isError ? 'failed' : 'done';

  if (flat) {
    return (
      <div className="chat-tool-row" data-testid="chat-tool-row">
        <div className="chat-tool-row-main">
          <span
            className={`chat-tool-dot ${running ? 'chat-tool-dot--run' : 'chat-tool-dot--done'}`}
          />
          <b>{toolName}</b>
          {path ? <span className="chat-tool-path">{String(path).split('/').pop()}</span> : null}
          <span className={`chat-tool-row-status${isError ? ' del' : ''}`}>{statusLabel}</span>
        </div>
        {argsPreview ? <pre className="chat-tool-detail">{argsPreview}</pre> : null}
        {resultPreview ? <pre className="chat-tool-detail">{resultPreview}</pre> : null}
      </div>
    );
  }

  return (
    <div className="chat-tool">
      <div className="chat-tool-hd">
        <b>{toolName}</b>
        {path ? <span className="chat-tool-path">{String(path).split('/').pop()}</span> : null}
        <span
          className={`chat-tool-dot ${running ? 'chat-tool-dot--run' : 'chat-tool-dot--done'}`}
        />
      </div>
      {!running ? (
        <div className="chat-tool-body">
          <div className={`chat-tool-line${isError ? ' del' : ''}`}>
            {isError ? 'failed' : 'done'}
          </div>
          {argsPreview ? <pre className="chat-tool-detail">{argsPreview}</pre> : null}
          {resultPreview ? <pre className="chat-tool-detail">{resultPreview}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── chat media (image thumbnails + lightbox) ──
// Per-thread context so deeply-nested bubbles reach the single lightbox + the
// paste-attachments map without prop-drilling through assistant-ui's renderers.
// `chipName(token)` resolves a live chip ([image-1]) to its content-addressed
// name via the per-chat map; `openLightbox(src)` opens the one overlay.
export const ChatMediaContext = createContext(null);

function attachmentSrc(name) {
  return `/_api/acp/attachment?name=${encodeURIComponent(name)}`;
}

// Thumbnail — a real focusable button (Enter/Space open) wrapping the served
// image; clicking opens the shared lightbox. `src` is always one of our own
// same-origin serve lanes (attachment route or designRoot static).
//
// `caption` marks a REFERENCED path (an image an assistant message merely named,
// DDR-145) as distinct from first-class user/agent media — it prints the
// filename under the thumb so an injected assistant can't fully borrow the
// feed's authority by rendering an arbitrary designRoot image as if it produced
// it (attacker F2). Pasted-image thumbs pass no caption.
function ChatThumb({ src, label = 'Open image', caption }) {
  const media = useContext(ChatMediaContext);
  const btn = (
    <button
      type="button"
      className="chat-thumb-btn"
      aria-label={label}
      onClick={() => media?.openLightbox(src)}
    >
      <img className="chat-thumb" src={src} alt="" loading="lazy" />
    </button>
  );
  if (!caption) return btn;
  return (
    <figure className="chat-thumb-fig">
      {btn}
      <figcaption className="chat-thumb-cap" title={caption}>
        {caption}
      </figcaption>
    </figure>
  );
}

// One live-bubble chip: an image chip whose upload has resolved renders as a
// thumbnail; file/link chips (and a still-pending image upload) keep the text
// badge. The map entry can fill AFTER the bubble first renders (paste + Enter
// immediately), so poll briefly until it resolves — the adapter awaits the
// upload before sending, so this settles within the same turn.
function ChipOrThumb({ token, kind }) {
  const media = useContext(ChatMediaContext);
  const [name, setName] = useState(() => (kind === 'image' ? media?.chipName(token) : null));
  useEffect(() => {
    if (kind !== 'image' || name || !media) return undefined;
    let tries = 0;
    const id = setInterval(() => {
      const n = media.chipName(token);
      if (n) {
        setName(n);
        clearInterval(id);
      } else if (++tries > 20) {
        clearInterval(id);
      }
    }, 250);
    return () => clearInterval(id);
  }, [kind, name, media, token]);
  if (!name) return <span className="chat-paste-chip">{token}</span>;
  return <ChatThumb src={attachmentSrc(name)} label="Open pasted image" />;
}

// Single fixed overlay for the enlarged image — ESC / backdrop / × close,
// role="dialog", focus moves to the close button on open and returns to the
// invoking thumbnail on close (mirrors tour/overlay.jsx). The capture-phase
// key listener runs only while open, so it never collides with the composer's
// onKeyDownCapture.
export function ChatLightbox({ src, onClose }) {
  const closeRef = useRef(null);
  const prevFocus = useRef(null);
  useEffect(() => {
    prevFocus.current = document.activeElement;
    closeRef.current?.focus();
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      try {
        prevFocus.current?.focus?.();
      } catch {
        /* trigger unmounted — non-fatal */
      }
    };
  }, [onClose]);
  return (
    <div
      className="chat-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Pasted image"
      onClick={onClose}
    >
      <img src={src} alt="pasted image, enlarged" onClick={(e) => e.stopPropagation()} />
      <button
        type="button"
        ref={closeRef}
        className="chat-lightbox-close"
        aria-label="Close image"
        title="Close image"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

// User bubble keeps the collapsed chips in the transcript (Claude Code shows the
// placeholder in history too — the real path went to the agent, not the log),
// EXCEPT images, which render as clickable thumbnails in a strip UNDER the text
// (inline they'd break the message's reading flow). Two spellings resolve to the
// same thumbnail: a live chip ([image-1] → per-chat map) and the reloaded
// transcript's expanded `_chat/attachments/` path (never printed raw).
function UserBubble({ text }) {
  const segs = extractAttachmentRefs(text);
  const inline = [];
  const images = [];
  segs.forEach((seg, i) => {
    if (seg.type === 'text') inline.push(<span key={`t-${i}`}>{seg.text}</span>);
    else if (seg.type === 'chip' && seg.kind !== 'image')
      inline.push(
        <span className="chat-paste-chip" key={`c-${i}`}>
          {seg.token}
        </span>
      );
    else if (seg.type === 'chip')
      images.push(<ChipOrThumb key={`c-${i}`} token={seg.token} kind={seg.kind} />);
    else
      images.push(
        <ChatThumb key={`a-${i}`} src={attachmentSrc(seg.name)} label="Open pasted image" />
      );
  });
  return (
    <div className="chat-bubble">
      {inline}
      {images.length ? <div className="chat-thumbrow">{images}</div> : null}
    </div>
  );
}

/** S5.19 G4 (03 `ai-long`): "Yesterday, 18:20" above the first ask of a new day. Silent when no time is known. */
function DayDivider() {
  const id = useMessage((m) => m.id);
  // a string selector: re-rendered only when the asks or their times change
  const key = useThread((t) =>
    JSON.stringify(
      t.messages
        .filter((m) => m.role === 'user')
        .map((m) => [m.id, m.createdAt instanceof Date ? m.createdAt.getTime() : null])
    )
  );
  const text = useMemo(() => dayDividerFor(JSON.parse(key), id), [key, id]);
  return text ? (
    <p className="ai-day-rule" data-testid="ai-day-divider">
      {text}
    </p>
  ) : null;
}

export function UserMessage() {
  return (
    <>
      <DayDivider />
      <UserMessageBody />
    </>
  );
}

function UserMessageBody() {
  const id = useMessage((m) => m.id);
  const saved = useMessage((m) => m.metadata?.custom?.attachments);
  const recorded = useRecordedSent(id);
  const media = useContext(ChatMediaContext);
  const sent = useMemo(
    () => sentFromTranscript(recorded ?? saved, media?.designRel),
    [recorded, saved, media?.designRel]
  );
  return (
    <div className="chat-msg chat-msg--user">
      <SentStrip chips={sent} onOpen={media?.openLightbox} />
      <MessagePrimitive.Parts components={{ Text: UserBubble }} />
      <div className="chat-msg-actions" data-testid="chat-msg-actions">
        <ActionBarPrimitive.Copy
          className="chat-msg-action"
          aria-label="Copy message"
          title="Copy message"
        >
          <Copy size={12} />
        </ActionBarPrimitive.Copy>
      </div>
    </div>
  );
}

// Reads the message's raw parts directly (rather than MessagePrimitive.Parts'
// per-part renderer) so consecutive tool-call parts can fold into one
// ToolGroup (Task C1) — grouping needs to see NEIGHBORING parts, which a
// per-part component registry can't.
export function AssistantMessage() {
  const rawParts = useMessage((m) => m.content) || [];
  const status = useMessage((m) => m.status?.type);
  const { transcriptView } = useContext(ChatMediaContext) || {};
  const view = transcriptView || DEFAULT_TRANSCRIPT_VIEW;
  const parts = useMemo(() => filterTranscriptParts(rawParts, view), [rawParts, view]);
  const grouped = useMemo(
    () =>
      groupToolCalls(showsToolSteps(view) ? parts : parts.filter((p) => p?.type !== 'tool-call')),
    [parts, view]
  );
  const forceExpand = transcriptForcesExpand(view);
  // P8 c10 (03 `ai-long`): an earlier turn that changed the canvas keeps its result card
  const media = useContext(ChatMediaContext);
  const turnRun = useTurnRun(media?.chatRuns);
  const turnChanged = !!turnRun && changedSomething(turnRun);
  // A turn that has only called tools so far says nothing yet: no empty bubble, no empty gap.
  const bare = grouped.length === 0;
  return (
    <div
      className={`chat-msg chat-msg--assistant${bare ? ' chat-msg--bare' : ''}${status === 'running' ? ' chat-msg--live' : ''}`}
    >
      {grouped.map((g, i) =>
        g.type === 'tool-group' ? (
          <ToolGroup
            key={`g-${i}`}
            parts={g.parts}
            ToolCard={ChatToolCard}
            forceOpen={forceExpand}
            verbose={forceExpand}
          />
        ) : g.part?.type === 'text' ? (
          <ChatText key={`t-${i}`} text={stripOffer(g.part.text)} />
        ) : g.part?.type === 'reasoning' ? (
          <ChatReasoning key={`r-${i}`} text={g.part.text} />
        ) : g.part?.type === 'tool-call' ? (
          <ChatToolCard
            key={g.part.toolCallId || `tc-${i}`}
            toolName={g.part.toolName}
            args={g.part.args}
            result={g.part.result}
            isError={g.part.isError}
            verbose={forceExpand}
          />
        ) : null
      )}
      {/* S4.15 (15 `an-ai-read`): the AI's offer to change what the stickies ask for — one button. */}
      <OfferSlot parts={rawParts} status={status} />
      {/* S5.8 (03 `ai-question`): an answer that touched nothing says so. Off for a running turn and for any
          tool that can write — see answer-note.js. */}
      {canvasUnchanged(rawParts, status === 'complete') &&
      !alreadySaysUnchanged(rawParts) &&
      !turnChanged ? (
        <p className="ai-unchanged" data-testid="ai-canvas-unchanged">
          {CANVAS_UNCHANGED}
        </p>
      ) : null}
      {turnChanged ? (
        <TurnResult run={turnRun} parts={rawParts} designRel={media?.designRel} />
      ) : null}
      <div className="chat-msg-actions" data-testid="chat-msg-actions">
        <ActionBarPrimitive.Copy
          className="chat-msg-action"
          aria-label="Copy message"
          title="Copy message"
        >
          <Copy size={12} />
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload
          className="chat-msg-action"
          aria-label="Retry"
          title="Retry — re-send the last message"
        >
          <Retry size={12} />
        </ActionBarPrimitive.Reload>
      </div>
    </div>
  );
}

// ── sub-sections ──
// "Working" is TRUE while the prompt turn is in-flight OR any tool is still
// running — so background subagents that outlive the main turn (the ACP adapter
// settles at the main agent's `result` while they drain, claude-agent-acp #773)
// keep the panel from looking idle. See RCA issue-acp-subagent-activity-invisible.
export function StatusRow() {
  // gate-a-polish (03 draws no such row): the v1 "Ready · Claude Code" line named Claude in the panel and kept a green dot
  // on a failed run. The working state is the run surface's WorkingLine + the composer's Stop (RunSurface.jsx,
  // Composer.jsx) and the canvas ring; nothing else shows "ready", so nothing is lost. Kept as an export so an
  // importer does not break; it draws nothing.
  return null;
}

// Live m:ss since work started — a ticking counter reads as "actively working"
// during a long, output-quiet subagent stretch (the exact case that used to look
// hung). Resets whenever work stops.
function useElapsed(active) {
  const [, tick] = useState(0);
  const startRef = useRef(null);
  useEffect(() => {
    if (!active) {
      startRef.current = null;
      return undefined;
    }
    startRef.current = Date.now();
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active || startRef.current == null) return null;
  const secs = Math.floor((Date.now() - startRef.current) / 1000);
  if (secs < 1) return null;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// Live "still working" indicator — sits at the BOTTOM of the feed (under the
// latest Claude message). Driven by turn-in-flight OR any running tool, so a
// background subagent stays visible ("N subagents running · 0:42") instead of
// the feed going quiet and looking dead.
export function ActivityBar({ tools }) {
  const running = useThread((t) => t.isRunning);
  const working = running || tools.length > 0;
  const elapsed = useElapsed(working);
  if (!working) return null;
  return (
    <div className="chat-activity" role="status" aria-live="polite">
      <span className="chat-activity-spin" aria-hidden="true" />
      <span className="chat-activity-text">{activityLabel(tools)}</span>
      {elapsed ? <span className="chat-activity-elapsed">{elapsed}</span> : null}
    </div>
  );
}

// Post-turn-end continuation. The ACP adapter settles the prompt at the main
// agent's first `result` (claude-agent-acp #773) but keeps streaming background
// work — subagent results, the consolidated report — AFTER the assistant-ui run
// ended. Those frames can't join the completed message, so acp-runtime collects
// them and we render them here as a live "continuation" bubble instead of
// dropping them (the answer used to only appear on reload). See RCA
// issue-acp-subagent-activity-invisible (facet F2). Cleared when the next turn
// starts; the durable copy lives in the transcript.
export function ContinuationBubble({ parts: rawParts, viewMode }) {
  const view = viewMode || DEFAULT_TRANSCRIPT_VIEW;
  const parts = useMemo(() => filterTranscriptParts(rawParts, view), [rawParts, view]);
  if (!parts.length) return null;
  const grouped = groupToolCalls(parts);
  const forceExpand = transcriptForcesExpand(view);
  return (
    <div className="chat-msg chat-msg--assistant chat-msg--continued">
      {grouped.map((g, i) =>
        g.type === 'tool-group' ? (
          <ToolGroup
            key={`g-${i}`}
            parts={g.parts}
            ToolCard={ChatToolCard}
            forceOpen={forceExpand}
            verbose={forceExpand}
          />
        ) : g.part?.type === 'text' ? (
          <ChatText key={`t-${i}`} text={g.part.text} />
        ) : g.part?.type === 'reasoning' ? (
          <ChatReasoning key={`r-${i}`} text={g.part.text} />
        ) : g.part?.type === 'tool-call' ? (
          <ChatToolCard
            key={g.part.toolCallId || `tc-${i}`}
            toolName={g.part.toolName}
            args={g.part.args}
            result={g.part.result}
            isError={g.part.isError}
            verbose={forceExpand}
          />
        ) : null
      )}
    </div>
  );
}

// Epoch `resetsAt` from SDKRateLimitInfo isn't documented as seconds vs ms —
// disambiguate by magnitude (a seconds-epoch never reaches 10^11 until the
// year 2286) rather than guessing wrong silently.

// The failure card (03 `ai-choice-fail`, right; S5.17b G7) — a transient bridge/socket failure, recoverable
// with a retry, distinct from the hard NotConnected state (claude not installed/signed in). It says what
// happened, what is safe and the ONE verb that fixes it (CONTRACT §4); the raw message sits under › Advanced.
// `changed` is whether the chat's run touched anything (run-model `changedSomething`): "Nothing changed" is
// said only when it is false. Rendered below the feed — chrome, not a per-message assistant-ui error.
export function ErrorCard({ error, onRetry, changed = null }) {
  const [open, setOpen] = useState(false);
  const failure = failureModel(error, { changed });
  if (!failure) return null;
  return (
    <div className="ai-nc ai-nc-prob" role="alert" data-testid="chat-error-card">
      <p className="ai-nc-t">
        <span className="ai-nc-ic ai-nc-ic--prob" aria-hidden="true">
          <StIcon name="problem" size={14} />
        </span>
        <span className="ai-nc-tt" data-testid="chat-error-title">
          {failure.title}
        </span>
      </p>
      {failure.detail ? (
        <p className="ai-nc-d" data-testid="chat-error-detail">
          {failure.detail}
        </p>
      ) : null}
      {failure.raw ? (
        <>
          <button
            type="button"
            className="ai-nc-adv"
            aria-expanded={open}
            data-testid="chat-error-advanced"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="ai-nc-adv-ch" aria-hidden="true">
              <StIcon name="chevron-right" size={12} />
            </span>
            Advanced
          </button>
          {open ? (
            <p className="ai-nc-d ai-nc-raw" data-testid="chat-error-raw">
              {failure.raw}
            </p>
          ) : null}
        </>
      ) : null}
      <span className="ai-nc-a">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          data-testid="chat-error-retry"
          // "Pick another clip" opens Assets (the file is gone, retrying it would only fail again)
          onClick={
            failure.pick ? () => window.dispatchEvent(new CustomEvent(OPEN_ASSETS_EVENT)) : onRetry
          }
        >
          {failure.verb}
        </button>
      </span>
    </div>
  );
}
