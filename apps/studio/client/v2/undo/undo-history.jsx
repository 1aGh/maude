// client/v2/undo/undo-history.jsx — S2.20: Menu › Edit › Undo history… (14 `ed-edge-undo`).
//
// A popover over the ⌘Z projection (use-undo-projection.jsx): your changes and your AI's on this
// canvas, newest first; the top row wears ⌘Z (what the next ⌘Z takes back). Pointing at a row lights
// what it would undo in the canvas ("Would undo · 14 changes", editing/undo-preview.tsx); clicking a
// row undoes everything down to it as ONE step (one `POST undo { actionIds }`, one version). The foot
// says other people's changes are theirs to undo, and offers Version history ⌥⌘H for older work.
//
// The popover never decides what an entry is — the projection does — and never writes anything but
// through the store, so Undo history and ⌘Z are one history.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { actorName } from '../ai/runs-model.js';
import { initialsOf, Kbd, StIcon } from '../../shell/icons.jsx';
import { useShellStore } from '../../stores/shell-store.jsx';
import { useUndoModeLane } from './use-undo-mode-lane.js';
import { undoProjection, useUndoProjection } from './use-undo-projection.jsx';
import { reasonProps } from '../access/disabled-reason.js';

/** One open flag for the shell (the menu row opens it; Esc / outside / a click closes it). */
function createOpenFlag() {
  let open = false;
  const subs = new Set();
  const set = (v) => {
    if (open === v) return;
    open = v;
    for (const fn of subs) fn();
  };
  return {
    get: () => open,
    open: () => set(true),
    close: () => set(false),
    toggle: () => set(!open),
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
export const undoHistoryOpen = createOpenFlag();

/** Row words (CONTRACT §3–§4; the canvas's rows). */
export function rowText(row) {
  if (row.who !== 'ai') return row.label;
  const n = Number.isFinite(row.changes) ? row.changes : null;
  return n == null
    ? `${row.label} — one step`
    : `${row.label} — ${n} ${n === 1 ? 'change' : 'changes'}, one step`;
}

/** The canvas tag while a row is pointed at. */
export function previewTag(row) {
  const n = Number.isFinite(row?.changes) ? row.changes : null;
  return n == null ? 'Would undo' : `Would undo · ${n} ${n === 1 ? 'change' : 'changes'}`;
}

export function agoText(madeAt, now) {
  const s = Math.max(0, Math.round((now - madeAt) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "Tereza's changes are theirs to undo." (no line when nobody else has changed this canvas). */
export function footText(others) {
  // a hub member's actor is her e-mail: name her by its local part (runs-model `actorName`), never print it
  const names = [
    ...new Set(
      (others ?? [])
        .filter((n) => typeof n === 'string' && n)
        .map((n) => (n.includes('@') ? actorName(n) : n))
    ),
  ];
  if (!names.length) return null;
  const who =
    names.length === 1
      ? `${names[0]}'s`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}'s`;
  return `${who} changes are theirs to undo.`;
}

/**
 * The popover itself (no store access — the host hands everything in).
 * @param {{ rows: any[], now: number, others?: string[], you?: string, versionKeys?: string,
 *   onUndoTo: (k: number) => void, onPreview: (row: any|null) => void,
 *   onVersionHistory: () => void, onClose: () => void }} p
 */
export function UndoHistory(p) {
  const ref = useRef(null);
  const [cur, setCur] = useState(0);
  useEffect(() => {
    ref.current?.querySelector('[data-row="0"]')?.focus?.();
  }, []);
  const foot = footText(p.others);
  const point = (row) => p.onPreview(row && !row.covered && row.state === 'done' ? row : null);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      p.onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const n = p.rows.length;
    if (!n) return;
    const next = (cur + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    setCur(next);
    ref.current?.querySelector(`[data-row="${next}"]`)?.focus?.();
  };
  return (
    <div
      ref={ref}
      className="sh-pm sh-uh"
      role="menu"
      aria-label="Undo history"
      data-testid="undo-history"
      onKeyDown={onKey}
      onMouseLeave={() => p.onPreview(null)}
    >
      <p className="sh-uh-t">
        Undo history<span>newest first</span>
      </p>
      {/* 14 `ed-edge-undo`: the popover says where it was opened from (S2.24) */}
      <p className="sh-uh-from">Opened from Menu › Edit › Undo history</p>
      {p.rows.length === 0 ? (
        <p className="sh-uh-empty" data-testid="undo-history-empty">
          Nothing to undo on this canvas yet.
        </p>
      ) : null}
      {p.rows.map((row, i) => {
        const off = row.state !== 'done' || !!row.covered;
        return (
          <button
            key={row.actionId ?? row.pendingTx ?? i}
            type="button"
            role="menuitem"
            className="sh-pm-row sh-uh-r"
            data-testid={`undo-history-row-${i}`}
            data-row={i}
            data-who={row.who}
            data-state={row.covered ? 'undone' : row.state}
            data-top={row.top ? 'true' : undefined}
            aria-disabled={off ? 'true' : undefined}
            {...reasonProps(off, row.state === 'stale' && !row.covered ? 'stale' : 'undone')}
            tabIndex={i === cur ? 0 : -1}
            onFocus={() => {
              setCur(i);
              point(row);
            }}
            onMouseEnter={() => point(row)}
            onClick={() => {
              if (off) return;
              p.onPreview(null);
              p.onUndoTo(i);
            }}
          >
            <span className="sh-uh-ic" data-who={row.who} aria-hidden="true">
              {row.who === 'ai' ? <StIcon name="sparkle" size={11} /> : initialsOf(p.you || 'You')}
            </span>
            <span className="sh-uh-txt">
              <span>{rowText(row)}</span>
              <em>
                {row.who === 'ai' ? 'AI' : 'You'} · {agoText(row.madeAt, p.now)}
              </em>
            </span>
            {row.top ? <Kbd>⌘Z</Kbd> : null}
          </button>
        );
      })}
      <hr className="sh-pm-sep" />
      {foot ? (
        <p className="sh-uh-foot" data-testid="undo-history-foot">
          {foot}
        </p>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="sh-pm-row"
        data-testid="undo-history-version"
        tabIndex={-1}
        onClick={() => {
          p.onClose();
          p.onVersionHistory();
        }}
      >
        <span className="sh-pm-ic" aria-hidden="true">
          <StIcon name="reload" size={14} />
        </span>
        <span className="sh-pm-lab">Version history</span>
        <Kbd>{p.versionKeys ?? '⌥⌘H'}</Kbd>
      </button>
    </div>
  );
}

/**
 * The shell mount: open flag + the active canvas's rows + the canvas highlight.
 * @param {{ activePath: string|null, postToActiveCanvas: (m: object) => void,
 *   openPaths?: string[], others?: string[], you?: string, onVersionHistory: () => void,
 *   store?: any, now?: () => number }} p
 */
export function UndoHistoryHost(p) {
  const store = useUndoProjection(p.store ?? undoProjection);
  const open = useSyncExternalStore(undoHistoryOpen.subscribe, undoHistoryOpen.get, () => false);
  const lit = useRef(false);
  const preview = (row) => {
    if (!row && !lit.current) return;
    lit.current = !!row;
    // S2.20 — the canvas lights what the row would undo (editing/undo-preview.tsx).
    p.postToActiveCanvas({
      dgn: 'undo-preview',
      artboards: row ? (row.artboards ?? []) : [],
      tag: row ? previewTag(row) : null,
    });
  };
  const { activePath } = p;
  // The session scope starts when a canvas opens (every open tab), not at the first ⌘Z.
  const paths = (p.openPaths ?? []).join('\n');
  useEffect(() => {
    for (const path of paths ? paths.split('\n') : []) void store.open(path);
    if (activePath) void store.open(activePath);
  }, [paths, activePath, store]);
  useEffect(() => {
    if (open && activePath) {
      void store.refresh(activePath);
      void store.loadOthers(activePath);
    }
  }, [open, activePath, store]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!e.target?.closest?.('[data-testid="undo-history"]')) undoHistoryOpen.close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the highlight when the popover closes or the canvas changes
  useEffect(() => {
    if (!open) preview(null);
  }, [open, activePath]);
  if (!open || !activePath) return null;
  return (
    <div className="sh-uh-root">
      <UndoHistory
        rows={store.rows(activePath)}
        now={(p.now ?? Date.now)()}
        others={p.others ?? store.others(activePath)}
        you={p.you}
        onPreview={preview}
        onUndoTo={(k) => {
          undoHistoryOpen.close();
          void store.undoToHere(activePath, k);
        }}
        onVersionHistory={p.onVersionHistory}
        onClose={() => undoHistoryOpen.close()}
      />
    </div>
  );
}

/** The app mount: reads the shell store (one line in app.jsx). */
export function ShellUndoHistory() {
  const {
    shellCore: { activePath, cfg, gitUser, iframesRef, postToActiveCanvas, tabs, toggleRightPanel },
  } = useShellStore();
  // S2.20b — each canvas hears whether its ⌘Z is the op log's, and hands its keys back here.
  useUndoModeLane({ iframesRef, activePath, cfg });
  const openPaths = useMemo(
    () => (tabs ?? []).map((t) => t?.path).filter((x) => typeof x === 'string' && x !== SYSTEM_TAB),
    [tabs]
  );
  return (
    <UndoHistoryHost
      activePath={activePath && activePath !== SYSTEM_TAB ? activePath : null}
      openPaths={openPaths}
      you={typeof gitUser === 'string' ? gitUser : undefined}
      postToActiveCanvas={postToActiveCanvas}
      onVersionHistory={() => toggleRightPanel('changes')}
    />
  );
}
