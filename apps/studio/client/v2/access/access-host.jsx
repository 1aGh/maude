// client/v2/access/access-host.jsx — S9.21b: the access states, mounted once in the shell.
//
// What it listens to (and nothing else):
//   · `maude:access-frame` — app.jsx relays the inspector socket's `access` / `access-request` frames
//     (ws.ts sends them to desktop shells only). `raised` says "You can edit … now." (app.jsx re-reads
//     /_config, the toolbar returns with the new role); `ended` dims the window behind the access card;
//     `link-off` is the link card; a request is the owner's toast with Review (opens Share, where the
//     request block waits).
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
  setTrashedOpen,
  shellAccessFrame,
  VIEW_ONLY_EVENT,
  WORDS,
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
  if (n.kind === 'narrowed') return { state, toast: null, reread: true };
  if (n.kind === 'ended') return { state: { ...state, ended: n.reason }, toast: null };
  if (n.kind === 'link-off') return { state: { ...state, linkOff: true }, toast: null };
  if (n.kind === 'request')
    return { state, toast: { title: n.text, kind: 'info', action: n.action, review: true } };
  return { state, toast: null };
}

/**
 * The presentational layer (tests render it): the access card, the link card, the tip, the banner.
 */
export function AccessLayer({
  ended,
  linkOff,
  tip,
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
      {tip && !trashedItem ? <ViewOnlyTip canvas={canvas} className="v2ac-tip--shell" /> : null}
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
  toast,
  run,
  onOpenTab,
}) {
  const [state, setState] = useState({ ended: null, linkOff: false });
  const [tip, setTip] = useState(false);
  const live = useRef({ activePath, designRel, toast, run, state });
  live.current = { ...live.current, activePath, designRel, toast, run };

  useEffect(() => {
    const on = (e) => {
      const { activePath: a, designRel: d, toast: say, run: go, state: prev } = live.current;
      const step = accessHostStep(prev, e?.detail, { activePath: a, designRel: d });
      if (step.state !== prev) {
        live.current.state = step.state;
        setState(step.state);
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

  useEffect(() => {
    let t;
    const on = () => {
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

  const { items, reload } = useTrash({ enabled: !state.ended });
  const rel = canvasRel(activePath, designRel);
  const trashedItem = trashedWhileOpen(items, rel);
  useEffect(() => {
    setTrashedOpen(trashedItem ? rel : null);
  }, [trashedItem, rel]);
  useEffect(() => () => setTrashedOpen(null), []);
  const open = (tabs || []).map((t) => canvasRel(t?.path, designRel)).filter(Boolean);
  useTrashGhosts(items, open, onOpenTab);

  const onRestored = useCallback(() => void reload(), [reload]);
  const onError = useCallback((m) => toast?.({ title: m, kind: 'error' }), [toast]);

  return (
    <AccessLayer
      ended={state.ended}
      linkOff={state.linkOff}
      tip={tip}
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
