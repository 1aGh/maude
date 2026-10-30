// client/v2/ai/AiChatIsland.jsx — S5.8: the AI chat panel's frame (03 AI Chat). The island is `hidden`, never
// unmounted, so a chat's stream survives Hide (DDR-123). This frame owns what is the panel's alone:
//
//   • ⌘/ opens the panel and puts focus in the field (and, with the panel already open, the
//     `maude:focus-ai` event does the same);
//   • esc in the field gives focus back to whatever had it before the panel took it;
//   • the landmark: "AI chat panel" (CONTRACT §3 — not "Assistant");
//   • S6.3: `maude:ai-send` — a sentence from outside (Home's first draft) goes into a new chat and is sent
//     through the composer, so the connect gate and offline queueing apply as for any message (ai-send.js).
//
// The header, the chat list and the chats are the children (ChatPanel is the host that owns the chat state).

import { useCallback, useEffect, useRef } from 'react';
import { restoreFocus } from '../shell/modal-focus.js';
import { shellToast } from '../../shell/util.js';
import {
  AI_SEND_EVENT,
  AI_SEND_FAILED,
  AI_SEND_PENDING_KEY,
  parseAiSend,
  queueAiSend,
  takePendingAiSend,
} from './ai-send.js';
import { BigPanelProvider, useBigPanel } from './BigChat.jsx';
import { FOCUS_AI_EVENT, focusComposer, isComposerEscape } from './panel-focus.js';
import { useAiRingsLane } from './ring-relay.js';
import { useAiSeenLane } from './seen-relay.js';
import { useAiRowSlotsLane } from './row-slots-lane.js';

export function AiChatIsland({ hidden = false, resizing = false, width, children }) {
  const ref = useRef(null);
  // Where focus was when the panel took it — esc returns there (or to the canvas when it is gone).
  const returnTo = useRef(null);
  const wasHidden = useRef(hidden);
  // S5.9 — a long chat gets the full height; `pinned` is the shell's docked layout.
  const big = useBigPanel(ref, hidden);
  useAiRingsLane(); // S5.11: keeps the open canvas told which artboards an AI is on
  useAiSeenLane(); // S4.15: the canvas outlines what the AI's offer points at
  useAiRowSlotsLane(); // S5.18: the Canvases panel's rows say "Needs you" / "AI is working"

  const remember = useCallback((el) => {
    const root = ref.current;
    if (el && root && !root.contains(el) && el !== document.body) returnTo.current = el;
  }, []);

  // Opening (hidden → shown): note the opener, then focus the field once the chat has painted.
  useEffect(() => {
    const opened = wasHidden.current && !hidden;
    wasHidden.current = hidden;
    if (!opened) return undefined;
    remember(document.activeElement);
    const id = requestAnimationFrame(() => focusComposer(ref.current));
    return () => cancelAnimationFrame(id);
  }, [hidden, remember]);

  // ⌘/ with the panel already showing.
  useEffect(() => {
    const on = () => {
      if (hidden) return;
      remember(document.activeElement);
      focusComposer(ref.current);
    };
    window.addEventListener(FOCUS_AI_EVENT, on);
    return () => window.removeEventListener(FOCUS_AI_EVENT, on);
  }, [hidden, remember]);

  // S6.3 — a first draft: the sentence goes into a fresh chat and is sent. When it cannot be (no chat, no
  // canvas in front) the canvas is still there and the sentence waits in the field, so the person presses send.
  useEffect(() => {
    const run = (d) => {
      if (!d) return;
      queueAiSend(ref.current, d).then((r) => {
        if (!r.ok) shellToast(AI_SEND_FAILED);
      });
    };
    run(takePendingAiSend());
    const on = (e) => {
      window[AI_SEND_PENDING_KEY] = undefined;
      run(parseAiSend(e?.detail));
    };
    window.addEventListener(AI_SEND_EVENT, on);
    return () => window.removeEventListener(AI_SEND_EVENT, on);
  }, []);

  return (
    <aside
      ref={ref}
      className={`sh-rpanel ai-island${resizing ? ' is-resizing' : ''}${big.pinned ? ' ai-island--pinned' : ''}`}
      data-full={big.full ? 'true' : undefined}
      style={{
        ...(width ? { width, flexBasis: width } : {}),
        ...(hidden ? { display: 'none' } : {}),
      }}
      aria-label="AI chat panel"
      aria-hidden={hidden || undefined}
      data-testid="ai-chat-island"
      onFocusCapture={(e) => remember(e.relatedTarget)}
      onKeyDown={(e) => {
        if (!isComposerEscape(e)) return;
        e.preventDefault();
        e.stopPropagation();
        restoreFocus(returnTo.current, undefined, document);
      }}
    >
      <BigPanelProvider value={big.report}>{children}</BigPanelProvider>
    </aside>
  );
}
