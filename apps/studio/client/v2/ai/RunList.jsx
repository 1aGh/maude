// client/v2/ai/RunList.jsx — S5.11 (03 `ai-two-artboards`, `ai-tereza`): the header's "✦ N" and the list it opens.
//
//   ✦ N        how many of YOUR AI runs are live (a waiting ask counts). Absent at zero. Other people's AI never
//              counts here.
//   the list   "Yours" — one row per run: what it was asked, where, its state — then "On this canvas": other
//              people's runs on the open canvas, each marked View only. A row takes you to its artboard.
//
// The numbers and rows come from runs-model.js over the tab's run store (runs-store.js). Presentational beyond
// that: the caller says where "jump" goes and what opening a chat means.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { indexMeta } from '../canvases/tree-model.js';
import { dispatchArtboardJump } from '../left-panel/left-panel-bus.js';
import { Check, Spark } from './icons.jsx';
import { canvasRows, fitRunListWidth, RUN_WORD, yoursCount, yoursRows } from './runs-model.js';
import { fetchChats } from './chat-store-api.js';
import { useAiRuns } from './runs-store.js';
import { StIcon } from '../../shell/icons.jsx';

export const Clock = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.8V8l2.2 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const Duplicate = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect
      x="5.5"
      y="5.5"
      width="7.5"
      height="7.5"
      rx="1.6"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M10.5 3.6V3.4A1.4 1.4 0 0 0 9.1 2H3.4A1.4 1.4 0 0 0 2 3.4v5.7a1.4 1.4 0 0 0 1.4 1.4h.2"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const Question = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M6.4 6.5a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.2M8 11.3v.1"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

/** The kit's round state mark: spark (working) · clock (waiting) · ? (needs you) · ✓ (done). */
export function RunIcon({ state }) {
  return (
    <span className={`ai-run-ic ai-run-ic--${state}`} aria-hidden="true">
      {state === 'working' ? (
        <Spark size={11} />
      ) : state === 'waiting' ? (
        <Clock size={12} />
      ) : state === 'needs' ? (
        <Question size={12} />
      ) : (
        <Check size={12} />
      )}
    </span>
  );
}

/** artboard labels by file, from the project index (`GET /_api/index`) — what a row says instead of an id. */
export function useBoardLabels(designRel, seq) {
  const snapshot = useCanvasIndex({ stamp: seq });
  return useMemo(() => {
    const out = new Map();
    for (const [file, meta] of indexMeta(snapshot, designRel)) out.set(file, meta.boards);
    return out;
  }, [snapshot, designRel]);
}

function RunRow({ row, onPick }) {
  const word = row.viewOnly ? 'View only' : RUN_WORD[row.state];
  return (
    <button
      type="button"
      role="menuitem"
      className="ai-run"
      data-testid={`ai-run-${row.id}`}
      data-state={row.state}
      data-view-only={row.viewOnly ? 'true' : undefined}
      aria-current={row.current ? 'true' : undefined}
      onClick={() => onPick(row)}
    >
      <RunIcon state={row.state} />
      <span className="ai-run-txt">
        <span className="ai-run-title">{row.title}</span>
        {row.where ? <span className="ai-run-where">{row.where}</span> : null}
      </span>
      <span className={`ai-run-word ai-run-word--${row.viewOnly ? 'view' : row.state}`}>
        {word}
      </span>
    </button>
  );
}

/** The list itself. Pure over `view`; the labels come from the index. */
export function RunList({
  view,
  activeCanvas,
  designRel,
  currentChatId,
  labels,
  onPick,
  onKeyDown,
  id,
  width,
  listRef,
  allChats,
  place,
}) {
  const yours = yoursRows(view, { designRel, labels, currentChatId });
  const others = canvasRows(view, { activeCanvas, labels });
  return (
    <div
      ref={listRef}
      className="ai-runs"
      style={width || place ? { ...(width ? { width } : null), ...place } : undefined}
      role="menu"
      id={id}
      aria-label="Running chats"
      data-testid="ai-runs-list"
      onKeyDown={onKeyDown}
    >
      {others.length ? <span className="ai-runs-group">Yours</span> : null}
      {yours.map((r) => (
        <RunRow key={r.id} row={r} onPick={onPick} />
      ))}
      {others.length ? (
        <>
          <span className="ai-runs-sep" aria-hidden="true" />
          <span className="ai-runs-group">On this canvas</span>
          {others.map((r) => (
            <RunRow key={r.id} row={r} onPick={onPick} />
          ))}
        </>
      ) : null}
      {/* 03 `ai-two-artboards`: the list ends with every chat of the project (opens the chat list) */}
      {allChats ? (
        <>
          <span className="ai-runs-sep" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            className="ai-run ai-run-all"
            data-testid="ai-runs-all"
            onClick={allChats.onOpen}
          >
            <StIcon name="comment" size={14} />
            <span className="ai-run-txt">
              <span className="ai-run-title">All chats</span>
            </span>
            {allChats.count != null ? <span className="ai-run-word">{allChats.count}</span> : null}
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * "✦ N" plus its list. Renders nothing at zero (03: the chip appears with the first run).
 * `onOpenChat(chatId)` switches the panel to that chat; the jump to the artboard is the shell's bus.
 */
export function RunsCount({
  activeCanvas,
  designRel,
  currentChatId,
  onOpenChat,
  onOpenList,
  store,
}) {
  const { view } = useAiRuns(store);
  const n = yoursCount(view);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listId = useId();

  const close = useCallback((refocus) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  }, []);

  // The list closes by itself when the last run ends — nothing left to list.
  useEffect(() => {
    if (n === 0) setOpen(false);
  }, [n]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) rootRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  const onMenuKey = (e) => {
    const rows = [...(rootRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement);
    const to = (i) => {
      e.preventDefault();
      rows[(i + rows.length) % rows.length]?.focus();
    };
    if (e.key === 'ArrowDown') to(at + 1);
    else if (e.key === 'ArrowUp') to(at - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(rows.length - 1);
  };

  if (n === 0) return null;
  const runLabel = `${n} ${n === 1 ? 'chat' : 'chats'} running`;

  return (
    <div className="ai-runs-wrap" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="chat-hd-count ai-runs-count"
        data-testid="ai-chat-count"
        data-open={open ? 'true' : undefined}
        title={runLabel}
        aria-label={runLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Spark size={10} />
        <b>{n}</b>
      </button>
      {open ? (
        <RunListOpen
          id={listId}
          view={view}
          activeCanvas={activeCanvas}
          designRel={designRel}
          currentChatId={currentChatId}
          onKeyDown={onMenuKey}
          onOpenList={
            onOpenList
              ? () => {
                  close(false);
                  onOpenList();
                }
              : undefined
          }
          onPick={(row) => {
            if (row.file && row.artboard) dispatchArtboardJump(row.file, row.artboard);
            if (row.chatId && onOpenChat) onOpenChat(row.chatId);
            close(false);
          }}
        />
      ) : null}
    </div>
  );
}

// The labels come from the project index, which is read only while the list is open.
function RunListOpen({ view, designRel, onOpenList, ...rest }) {
  const labels = useBoardLabels(designRel, view.seq);
  // S5.18 G1: in a narrow dock column the list narrows to what fits (it hangs from the button's right edge).
  const listRef = useRef(null);
  const [width, setWidth] = useState(null);
  const [place, setPlace] = useState(null);
  // "All chats  N": the project's chat count, read once while the list is open
  const [total, setTotal] = useState(null);
  useEffect(() => {
    if (!onOpenList) return undefined;
    let live = true;
    fetchChats({ group: 'canvas' }).then((r) => {
      if (!live) return;
      const groups = Array.isArray(r?.groups) ? r.groups : [];
      setTotal(groups.reduce((n, g) => n + (g.chats ?? []).filter((c) => !c.trashedAt).length, 0));
    });
    return () => {
      live = false;
    };
  }, [onOpenList]);
  useLayoutEffect(() => {
    const fit = () => {
      const el = listRef.current;
      const anchor = el?.parentElement; // the ✦ N wrapper the list hangs from
      if (!el || !anchor) return;
      const column = el.closest('.ai-island, .sh-rpanel');
      // 03 `ai-two-artboards`: the list opens UP over the canvas when there is room, so it never covers the chat
      // (fixed, from the button's rectangle: the dock slot clips everything that hangs outside it)
      const a = anchor.getBoundingClientRect();
      const up = a.top >= el.offsetHeight + 16;
      el.toggleAttribute('data-up', up);
      setPlace({
        position: 'fixed',
        right: Math.max(8, Math.round(window.innerWidth - a.right)),
        ...(up
          ? { bottom: Math.round(window.innerHeight - a.top + 8), top: 'auto' }
          : { top: Math.round(a.bottom + 8) }),
      });
      setWidth(
        fitRunListWidth({
          anchorRight: anchor.getBoundingClientRect().right,
          boundsLeft: column ? column.getBoundingClientRect().left : 0,
        })
      );
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <RunList
      view={view}
      designRel={designRel}
      labels={labels}
      width={width}
      place={place}
      listRef={listRef}
      allChats={onOpenList ? { count: total, onOpen: onOpenList } : undefined}
      {...rest}
    />
  );
}
