// client/v2/ai/BigChat.jsx — S5.9 (03 AI Chat `ai-long`, `ai-long-pinned`): a long chat gets room.
//
//   • full height   the panel grows to the window's full height — on its own once the chat is long, and
//                   by double-clicking its edge (again to give the height back). Dragging the edge
//                   still resizes the width: that is the shell's grip, unchanged.
//   • Jump to latest · N new   while you read earlier turns the chat keeps growing; the pill counts what
//                   arrived and brings you back.
//   • Pin to the side   the pin in the header docks the panel as a full-height column and the canvas
//                   makes room. It is the V2-4.1 pin model (View › Advanced › Pin panels to the side), so
//                   it pins the panels together — the shell has no per-panel pin.
//
// The pure parts (when to jump, when full) are jump-model.js; this file wires them to the DOM.

import { useThread } from '@assistant-ui/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { panelLayout, usePanelLayout } from '../shell/use-panel-layout.js';
import {
  createJumpTracker,
  distanceFromBottom,
  isFullHeight,
  jumpLabel,
  toggleOverride,
} from './jump-model.js';

export const EDGE_TIP = 'Drag to resize · double-click for full height';

// ── the header's pin ──────────────────────────────────────────────────────────────────────────────────

/** Presentational: the pin button of the AI chat header. */
export function PinButton({ pinned, onToggle }) {
  const label = pinned ? 'Unpin' : 'Pin to the side';
  const tip = pinned ? 'Unpin — float over the canvas' : 'Pin to the side';
  return (
    <button
      type="button"
      className={`st-iconbtn ai-pinbtn${pinned ? ' is-pressed' : ''}`}
      data-testid="ai-chat-pin"
      aria-label={label}
      aria-pressed={pinned}
      title={tip}
      onClick={onToggle}
    >
      <StIcon name="panel-right" size={14} />
    </button>
  );
}

/** The header's pin, wired to the shell's one panel-layout store. */
export function PinButtonHost() {
  const { pinned } = usePanelLayout();
  return <PinButton pinned={pinned} onToggle={() => panelLayout.togglePinned()} />;
}

// ── the panel's height ────────────────────────────────────────────────────────────────────────────────

/** The chat reports how many messages it holds; the island decides whether that is "long". */
const ReportLength = createContext(() => {});
export const BigPanelProvider = ReportLength.Provider;

/**
 * The island's side of it. Returns `{ full, pinned, report }`:
 *   full    the panel takes the window's full height (floating layout only);
 *   pinned  the shell has the panels docked;
 *   report  `(total) => void` for the visible chat to call (BigPanelProvider hands it down).
 * Double-clicking the shell's resize grip beside the panel flips `full`; while floating, that replaces
 * the grip's width reset (Home on the grip still resets the width).
 */
export function useBigPanel(ref, hidden) {
  const { pinned } = usePanelLayout();
  const [total, setTotal] = useState(0);
  const [override, setOverride] = useState(null);
  const full = !pinned && isFullHeight({ override, total });
  const fullRef = useRef(full);
  fullRef.current = full;

  useEffect(() => {
    if (hidden || pinned) return undefined;
    const island = ref.current;
    const slot = island?.closest('.st-dockslot');
    if (!slot) return undefined;
    const side = slot.classList.contains('st-dockslot--right') ? 'r' : 'l';
    const grip = document.querySelector(`.st-grip--${side}`);
    const prevTitle = grip?.getAttribute('title') ?? null;
    grip?.setAttribute('title', EDGE_TIP);
    const onDouble = (e) => {
      const hit = e.target?.closest?.(`.st-grip--${side}`);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      setOverride(toggleOverride(fullRef.current));
    };
    // Capture on the window: the grip's own React handler (width reset) never sees this one.
    window.addEventListener('dblclick', onDouble, true);
    return () => {
      window.removeEventListener('dblclick', onDouble, true);
      if (prevTitle === null) grip?.removeAttribute('title');
      else grip?.setAttribute('title', prevTitle);
    };
  }, [hidden, pinned, ref]);

  const report = useCallback((n) => setTotal(n), []);
  return { full, pinned, report };
}

/** The visible chat tells the island how long it is. */
export function useReportLength(total, hidden) {
  const report = useContext(ReportLength);
  useEffect(() => {
    if (!hidden) report(total);
  }, [total, hidden, report]);
}

// ── Jump to latest · N new ────────────────────────────────────────────────────────────────────────────

/** Presentational pill. */
export function JumpPill({ newCount, onJump }) {
  const { text, count } = jumpLabel(newCount);
  return (
    <button type="button" className="ai-jump" data-testid="ai-jump" onClick={onJump}>
      <StIcon name="chevron-down" size={12} />
      {text}
      {count ? (
        <span className="ai-jump-n" data-testid="ai-jump-count">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The pill, at the end of the feed. It sticks to the bottom edge of the visible feed (a zero-height
 * sticky row), reads the scroll position of the `.chat-feed` it sits in and the message count, so it
 * needs no ref into assistant-ui's viewport. Also reports the thread's length to the island (full
 * height for a long chat).
 */
export function JumpToLatest({ hidden = false }) {
  const total = useThread((t) => t.messages.length);
  const host = useRef(null);
  const tracker = useRef(createJumpTracker());
  const [pill, setPill] = useState({ visible: false, newCount: 0 });
  useReportLength(total, hidden);

  const measure = useCallback(() => {
    const feed = host.current?.closest('.chat-feed');
    if (!feed) return;
    const next = tracker.current.update({
      distance: distanceFromBottom(feed),
      total,
    });
    setPill((p) => (p.visible === next.visible && p.newCount === next.newCount ? p : next));
  }, [total]);

  // Scrolling, and the feed growing under a reader who is scrolled up.
  useEffect(() => {
    const feed = host.current?.closest('.chat-feed');
    if (!feed || hidden) return undefined;
    feed.addEventListener('scroll', measure, { passive: true });
    // Content growing under a reader who scrolled up fires no scroll event: watch the feed's DOM.
    let frame = 0;
    const mo =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
          })
        : null;
    mo?.observe(feed, { childList: true, subtree: true, characterData: true });
    return () => {
      feed.removeEventListener('scroll', measure);
      mo?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [hidden, measure]);
  useEffect(() => measure(), [measure]);

  const jump = useCallback(() => {
    const feed = host.current?.closest('.chat-feed');
    feed?.scrollTo?.({ top: feed.scrollHeight, behavior: 'auto' });
    measure();
  }, [measure]);

  return (
    <span ref={host} className="ai-jump-host">
      {pill.visible ? <JumpPill newCount={pill.newCount} onJump={jump} /> : null}
    </span>
  );
}
