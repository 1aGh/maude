// client/v2/annotations/vote-bar.jsx — S4.14: the vote bar + the shell's vote lane (canvas 15, an-vote).
//
//   Vote 3 directions │ 0 left of your 3 │ ⏱ 1:42 │ (faces) 4 of 5 done │ End vote
//
// The bar shows while the active canvas has an OPEN vote. "End vote" is an editor's (the server refuses
// anyone else: POST /_api/votes/end needs `edit`). The faces are WHO has voted — never what.
//
// The lane (`useVoteLane`) is the ONE place the shell and the untrusted canvas talk about votes:
//   vote-state {vote, mine}        s2c, to the active frame: the projection (vote-store voteStateMessage)
//   vote-cast {artboard, remove?}  c2s, `active`: a dot on / off an artboard → POST /_api/votes/ballot
//   vote-board {artboards, open?, focus?}  c2s, `active`: the canvas's artboards (names + world rects,
//                                  text only) for the sheet and the result's place; `open` = "Start a vote…"
// `VoteHost` mounts both, so app.jsx carries one element.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { capsFor } from '../shell/canvas-mode.js';
import VoteSheet from './vote-sheet.jsx';
import { barModel, VOTE_WORDS, voteStateMessage, voteStore } from './vote-store.js';

const frameOrigin = (frame) => {
  try {
    return new URL(frame.src, window.location.href).origin;
  } catch {
    return '';
  }
};

const initials = (name) =>
  String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

export function VoteBar({ state, now, onEnd }) {
  const m = barModel(state.vote, state.mine, now);
  if (!m) return null;
  return (
    <div className="island an-vbar" data-testid="vote-bar" role="status" aria-live="polite">
      <span className="an-vbar-t">
        <b>Vote</b>
        {m.what}
      </span>
      <span className="an-vbar-div" />
      <span data-testid="vote-bar-left">
        <b>{m.left} left</b> of your {m.of}
      </span>
      <span className="an-vbar-div" />
      <span className="an-vbar-time" data-testid="vote-bar-time">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 4.5V8l2.5 1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {m.time}
      </span>
      <span className="an-vbar-div" />
      <span className="an-vbar-who" data-testid="vote-bar-done">
        {m.faces.slice(0, 5).map((f) => (
          <span key={f} className="an-vbar-av" title={f}>
            {initials(f)}
          </span>
        ))}
        {m.done}
      </span>
      {state.canEdit && (
        <button type="button" className="btn btn--sm" onClick={onEnd} data-testid="vote-bar-end">
          {VOTE_WORDS.end}
        </button>
      )}
    </div>
  );
}

/** Keep the active frame told; take its asks. */
export function useVoteLane(iframesRef, activePath, store = voteStore) {
  useEffect(() => {
    store.setFile(activePath ?? null);
  }, [activePath, store]);
  useEffect(() => {
    const active = () => (activePath ? iframesRef.current?.get(activePath) : null);
    // A literal `{ dgn }` per send site so the bridge inventory sees it (voteStateMessage builds it).
    const tell = (win) => {
      const s = store.get();
      try {
        win?.postMessage(voteStateMessage(s.vote, s.mine), '*');
      } catch {
        /* detached */
      }
    };
    let last = '';
    const unsub = store.subscribe((s) => {
      const key = JSON.stringify(voteStateMessage(s.vote, s.mine));
      if (key === last) return;
      last = key;
      tell(active()?.contentWindow);
    });
    const onMessage = (e) => {
      const dgn = e.data?.dgn;
      const frame = active();
      if (!frame || frame.contentWindow !== e.source) return;
      if (dgn === 'loaded' || dgn === 'canvas-rendered') {
        tell(frame.contentWindow);
        return;
      }
      if (dgn !== 'vote-cast' && dgn !== 'vote-board') return;
      const m = acceptFromCanvas(e, {
        canvasOrigin: frameOrigin(frame),
        active: frame.contentWindow,
      });
      if (m?.dgn === 'vote-cast') void store.cast(m.artboard, m.remove ? -1 : 1);
      else if (m?.dgn === 'vote-board') store.noteBoard(m);
    };
    window.addEventListener('message', onMessage);
    tell(active()?.contentWindow);
    return () => {
      unsub();
      window.removeEventListener('message', onMessage);
    };
  }, [iframesRef, activePath, store]);
}

/** The sheet + the bar for the active canvas. app.jsx mounts it once. */
export default function VoteHost({
  iframesRef,
  activePath,
  canEdit,
  role,
  notify,
  store = voteStore,
}) {
  useVoteLane(iframesRef, activePath, store);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const caps = capsFor({ canEdit, role });
  useEffect(() => {
    store.setRole({ canEdit: !!caps.edit, canVote: !!caps.comment });
  }, [caps.edit, caps.comment, store]);
  useEffect(() => {
    store.setNotify(notify ? (title) => notify({ title, kind: 'info' }) : null);
  }, [notify, store]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => store.subscribe(() => setNow(Date.now())), [store]);
  return (
    <>
      <VoteBar state={state} now={now} onEnd={() => void store.end()} />
      {state.sheet && (
        <VoteSheet
          key={`${state.file}:${state.sheet.focus ?? ''}`}
          state={state}
          onStart={async (opts) => {
            const r = await store.start(opts);
            if (!r.ok && notify) notify({ title: r.line, kind: 'error' });
            return r;
          }}
          onClose={() => store.closeSheet()}
        />
      )}
    </>
  );
}
