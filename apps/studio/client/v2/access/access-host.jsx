// client/v2/access/access-host.jsx — S9.21b: the access states, mounted once in the shell.
//
// What it listens to (and nothing else):
//   · `maude:access-frame` — app.jsx relays the inspector socket's `access` / `access-request` frames
//     (ws.ts sends them to desktop shells only). `raised` says "You can edit … now." (app.jsx re-reads
//     /_config, the toolbar returns with the new role); `ended` dims the window behind the access card;
//     `link-off` is the link card; a request is the owner's toast with Review (opens Share, where the
//     request block waits).
//   · S9.21d, a plain browser only (no `window.__TAURI__`): the window's own same-origin answers
//     (`watchRefusals`) — the cell door's 401 `link-off` / `access-withdrawn` for a session a notice ended is
//     the link card / the access card. Nothing else in an answer is read.
//   · `maude:view-only-gesture` — the active read-only canvas saw a drag go nowhere: the dark tip, a few
//     seconds. Its words are the shell's own (the canvas sends no text, DDR-054).
//   · the shared Trash (`useTrash`): the open tab's canvas in the trash → the banner + Restore, the dim ghost
//     rows, and `setTrashedOpen` (the Share cluster's mode lane goes to Viewing; the server refuses the
//     writes anyway, routes/trash.ts).
// The server decides every role; this only says what it answered (hidden ≠ refused).

import { useCallback, useEffect, useRef, useState } from 'react';

import { useTrash } from '../left-panel/use-trash.js';
import { AccessEndedCard } from './access-card.jsx';
import {
  ACCESS_FRAME_EVENT,
  canvasName,
  canvasRel,
  REFUSAL_PROBE,
  roleRank,
  setTrashedOpen,
  shellAccessFrame,
  VIEW_ONLY_EVENT,
  WORDS,
  watchRefusals,
} from './access-client.js';
import { ViewOnlyTip } from './ask-to-edit.jsx';
import { LinkOffCard } from './link-off-card.jsx';
import { TrashedBanner, trashedWhileOpen, useTrashGhosts } from './trashed-banner.jsx';

const TIP_MS = 4000;

/**
 * The window's access state from one frame: what to show (`ended` / `linkOff` stay until the window goes),
 * plus the toast to say, if any. Pure.
 */
export function accessHostStep(state, frame, { activePath, designRel } = {}) {
  const n = shellAccessFrame(frame);
  if (!n) return { state, toast: null };
  if (n.kind === 'raised') {
    const canvas = canvasName(canvasRel(activePath, designRel) ?? '');
    return { state, toast: { title: WORDS.raised(canvas), kind: 'success' }, reread: true };
  }
  if (n.kind === 'narrowed')
    return {
      state,
      // S1.20 — said only when the hub named the role now (an older hub names nothing: no toast)
      toast: n.role ? { title: WORDS.narrowedTo(n.by, n.role), kind: 'info' } : null,
      reread: true,
    };
  if (n.kind === 'ended') return { state: { ...state, ended: n.reason }, toast: null };
  if (n.kind === 'link-off') return { state: { ...state, linkOff: true }, toast: null };
  if (n.kind === 'request')
    return { state, toast: { title: n.text, kind: 'info', action: n.action, review: true } };
  return { state, toast: null };
}

/**
 * p8-e2e-fix-r6 (decision v2-p8-raise-notice-from-shell-access-widen) — did the role on the OPEN canvas widen
 * from Can view / Can comment to Can edit or up? `prev` / `next` are `{ rel, role }` (designRoot-relative canvas,
 * wire role). A Can view desktop holds no hub socket, so the hub's raised notice never reaches it; the shell
 * says the raise when its own /_config re-read (access-changed) shows it. Never on first load (no `prev`), an
 * unknown role, a narrowing, or a different canvas. Pure.
 */
export function roleWidened(prev, next) {
  if (!prev || !next || !next.rel || prev.rel !== next.rel) return false;
  const was = roleRank(prev.role);
  const now = roleRank(next.role);
  const edit = roleRank('member');
  return was !== undefined && now !== undefined && was < edit && now >= edit;
}

/**
 * S9.21d — a refused answer's outcome (`doorRefusal`) → the window's state. The browser shell's only source of
 * "access ended" / "link turned off": notices reach desktop shells only. Pure.
 */
export function accessHostRefusal(state, outcome) {
  if (outcome?.kind === 'link-off') return { ...state, linkOff: true };
  if (outcome?.kind === 'ended') return { ...state, ended: outcome.reason };
  return state;
}

/**
 * Round 7 (10 co-ask-edit) — where the tip sits when the canvas told us where the drag happened: beside the
 * pointer, 80 px right and 18 px down like the board's callout, kept inside the window. Pure.
 */
export function tipStyle(at, win = { w: window.innerWidth, h: window.innerHeight }) {
  const W = 280;
  const H = 64;
  const left = Math.max(8, Math.min(Math.round(at.x) + 80, win.w - W - 8));
  const top = Math.max(8, Math.min(Math.round(at.y) + 18, win.h - H - 8));
  return { left, top, right: 'auto' };
}

/**
 * The presentational layer (tests render it): the access card, the link card, the tip, the banner.
 */
export function AccessLayer({
  ended,
  linkOff,
  tip,
  tipAt,
  appOnly,
  project,
  canvas,
  trashedItem,
  canRestore,
  onHome,
  onRestored,
  onError,
}) {
  if (ended) return <AccessEndedCard project={project} onHome={onHome} />;
  if (linkOff) return <LinkOffCard canvas={canvas} />;
  return (
    <>
      {trashedItem ? (
        <TrashedBanner
          item={trashedItem}
          canRestore={canRestore}
          onRestored={onRestored}
          onError={onError}
        />
      ) : null}
      {tip && !trashedItem ? (
        <ViewOnlyTip
          canvas={canvas}
          appOnly={appOnly}
          className={tipAt ? 'v2ac-tip--shell v2ac-tip--at' : 'v2ac-tip--shell'}
          style={tipAt ? tipStyle(tipAt) : undefined}
        />
      ) : null}
    </>
  );
}

/**
 * The shell's host. `toast(notice)` is notifications.tsx `notify`; `run(id)` the menu runner; `onOpenTab(rel)`
 * focuses a tab by its designRoot-relative path.
 */
export function AccessHost({
  activePath,
  designRel,
  tabs,
  project,
  canEdit,
  role,
  appOnly,
  toast,
  run,
  onOpenTab,
}) {
  const [state, setState] = useState({ ended: null, linkOff: false });
  const [tip, setTip] = useState(false);
  const [tipAt, setTipAt] = useState(null);
  const live = useRef({ activePath, designRel, toast, run, state });
  live.current = { ...live.current, activePath, designRel, toast, run };
  // The canvas whose raise was already said: the hub's raised frame and the shell's own widening (below) say it
  // once between them; a narrowing on that canvas clears it.
  const raiseSaid = useRef(null);

  useEffect(() => {
    const on = (e) => {
      const { activePath: a, designRel: d, toast: say, run: go, state: prev } = live.current;
      const step = accessHostStep(prev, e?.detail, { activePath: a, designRel: d });
      if (step.state !== prev) {
        live.current.state = step.state;
        setState(step.state);
      }
      if (step.toast && step.reread) {
        const at = canvasRel(a, d) ?? '';
        if (raiseSaid.current === at) return;
        raiseSaid.current = at;
      }
      if (step.toast) {
        const { review, action, ...notice } = step.toast;
        say?.(
          review && action
            ? { ...notice, action: { label: action, onClick: () => go?.('share.open') } }
            : notice
        );
      }
    };
    window.addEventListener(ACCESS_FRAME_EVENT, on);
    return () => window.removeEventListener(ACCESS_FRAME_EVENT, on);
  }, []);

  // S9.21d — a plain browser hears no access frames; the cell's door tells it on the next refused answer.
  // A desktop shell keeps the S9.21b notice path only.
  useEffect(() => {
    if (window.__TAURI__) return undefined;
    const stop = watchRefusals(window, (outcome) => {
      const prev = live.current.state;
      const next = accessHostRefusal(prev, outcome);
      if (next !== prev) {
        live.current.state = next;
        setState(next);
      }
    });
    // The kick closes this tab's sockets but makes no request; a quiet tab asks the door itself.
    const probe = () => {
      const s = live.current.state;
      if (s.ended || s.linkOff || document.visibilityState === 'hidden') return;
      Promise.resolve()
        .then(() => window.fetch(REFUSAL_PROBE.path, { cache: 'no-store' }))
        .catch(() => {});
    };
    const t = setInterval(probe, REFUSAL_PROBE.ms);
    window.addEventListener('focus', probe);
    document.addEventListener('visibilitychange', probe);
    return () => {
      stop();
      clearInterval(t);
      window.removeEventListener('focus', probe);
      document.removeEventListener('visibilitychange', probe);
    };
  }, []);

  useEffect(() => {
    let t;
    const on = (e) => {
      const d = e?.detail;
      setTipAt(d && Number.isFinite(d.x) && Number.isFinite(d.y) ? { x: d.x, y: d.y } : null);
      setTip(true);
      clearTimeout(t);
      t = setTimeout(() => setTip(false), TIP_MS);
    };
    window.addEventListener(VIEW_ONLY_EVENT, on);
    return () => {
      clearTimeout(t);
      window.removeEventListener(VIEW_ONLY_EVENT, on);
    };
  }, []);

  const rel = canvasRel(activePath, designRel);
  const seen = useRef(null);
  useEffect(() => {
    const next = { rel: rel ?? null, role };
    const prev = seen.current;
    seen.current = next;
    const at = rel ?? '';
    if (roleWidened(prev, next)) {
      if (raiseSaid.current === at) return;
      raiseSaid.current = at;
      live.current.toast?.({ title: WORDS.raised(canvasName(at)), kind: 'success' });
    } else if (raiseSaid.current === at && (roleRank(role) ?? 0) < roleRank('member')) {
      raiseSaid.current = null;
    }
  }, [rel, role]);

  const { items, reload } = useTrash({ enabled: !state.ended });
  const trashedItem = trashedWhileOpen(items, rel);
  useEffect(() => {
    setTrashedOpen(trashedItem ? rel : null);
  }, [trashedItem, rel]);
  useEffect(() => () => setTrashedOpen(null), []);
  const open = (tabs || []).map((t) => canvasRel(t?.path, designRel)).filter(Boolean);
  useTrashGhosts(items, open, onOpenTab, rel);

  const onRestored = useCallback(() => void reload(), [reload]);
  const onError = useCallback((m) => toast?.({ title: m, kind: 'error' }), [toast]);

  return (
    <AccessLayer
      ended={state.ended}
      linkOff={state.linkOff}
      tip={tip}
      tipAt={tipAt}
      appOnly={appOnly}
      project={project}
      canvas={rel}
      trashedItem={trashedItem}
      canRestore={!!canEdit}
      onHome={() => run?.('nav.home')}
      onRestored={onRestored}
      onError={onError}
    />
  );
}
