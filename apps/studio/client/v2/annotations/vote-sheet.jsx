// client/v2/annotations/vote-sheet.jsx — S4.14: "Start a vote" (canvas 15, artboard an-vote; Gate 0 A18).
//
//   Start a vote
//   [x] Helma: matná zelená   [x] Helma: lesklá   [ ] …      ← the canvas's artboards (vote-board)
//   Title (optional) · Votes each 3 · Time 2 min
//   <the secrecy line>  — local: "Anyone who can open this project's files can see the votes."
//                         hub:   "Nobody sees the others' votes until the end."
//                         off:   the team-server line, and Start vote is disabled
//   Cancel · Start vote
//
// Opened by ⌘K "Start a vote…" (registry `annotations.start-vote`) or an artboard's right-click row,
// which preselects that artboard. Editors only: the store opens it only for `canEdit`, and the server
// refuses a start from anyone else (POST /_api/votes/start needs `edit`). Tokens only (vote.css).

import { useEffect, useMemo, useRef, useState } from 'react';
import { v2Scope } from './v2-scope.js';
import { DEFAULT_DURATION, DEFAULT_PER_VOTER, DURATIONS, VOTE_WORDS } from './vote-store.js';

const minutes = (s) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);

export default function VoteSheet({ state, onStart, onClose }) {
  const boards = state.artboards;
  const [picked, setPicked] = useState(() =>
    state.sheet?.focus ? [state.sheet.focus] : boards.slice(0, 3).map((a) => a.id)
  );
  const [title, setTitle] = useState('');
  const [perVoter, setPerVoter] = useState(DEFAULT_PER_VOTER);
  const [durationS, setDurationS] = useState(DEFAULT_DURATION);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const off = state.mode === 'off';
  const line = off ? state.line : state.mode === 'local' ? state.line : VOTE_WORDS.hubLine;

  // a11y gate W1/W3: the sheet is aria-modal, so Tab stays inside it, and closing it (Esc, Cancel, Start) gives focus
  // back to whatever opened it. The opener is read once, before the sheet takes focus.
  const openerRef = useRef(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const o = openerRef.current;
      if (o && o !== document.body && o.isConnected && typeof o.focus === 'function') o.focus();
    };
  }, []);
  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const trapTab = (e) => {
    if (e.key !== 'Tab') return;
    const f = [
      ...(ref.current?.querySelectorAll(
        'input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []),
    ];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !ref.current?.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !ref.current?.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  };

  const ids = useMemo(() => new Set(boards.map((a) => a.id)), [boards]);
  const chosen = picked.filter((id) => ids.has(id));
  const toggle = (id) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async (e) => {
    e?.preventDefault();
    if (off || busy) return;
    if (!chosen.length) {
      setError(VOTE_WORDS.pickTargets);
      return;
    }
    setBusy(true);
    const r = await onStart({ artboards: chosen, perVoter, durationS, title: title.trim() });
    setBusy(false);
    if (!r.ok) setError(r.line);
  };

  return (
    <div
      className="an-vsheet-scrim"
      data-testid="vote-sheet"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        ref={ref}
        {...v2Scope('island an-vsheet')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="an-vsheet-h"
        onKeyDown={trapTab}
        onSubmit={submit}
      >
        <h2 id="an-vsheet-h" className="an-vsheet-h">
          {VOTE_WORDS.title}
        </h2>
        <fieldset className="an-vsheet-targets" disabled={off}>
          <legend>Artboards</legend>
          {boards.length === 0 && (
            <p className="an-vsheet-empty">This canvas has no artboards to vote on.</p>
          )}
          {boards.map((a) => (
            <label key={a.id} className="an-vsheet-t" data-testid={`vote-sheet-target-${a.id}`}>
              <input
                type="checkbox"
                checked={picked.includes(a.id)}
                onChange={() => toggle(a.id)}
              />
              <span>{a.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="an-vsheet-row">
          <label className="an-vsheet-f">
            <span>Title</span>
            <input
              className="input"
              value={title}
              maxLength={200}
              placeholder="Optional"
              onChange={(e) => setTitle(e.target.value)}
              disabled={off}
              data-testid="vote-sheet-title"
            />
          </label>
          <label className="an-vsheet-f">
            <span>Votes each</span>
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={perVoter}
              onChange={(e) =>
                setPerVoter(Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))))
              }
              disabled={off}
              data-testid="vote-sheet-per-voter"
            />
          </label>
          <label className="an-vsheet-f">
            <span>Time</span>
            <select
              className="select"
              value={durationS}
              onChange={(e) => setDurationS(Number(e.target.value))}
              disabled={off}
              data-testid="vote-sheet-duration"
            >
              {DURATIONS.map((s) => (
                <option key={s} value={s}>
                  {minutes(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {line && (
          <p className="an-vsheet-line" data-testid="vote-sheet-line">
            {line}
          </p>
        )}
        {error && (
          <p className="an-vsheet-err" role="alert">
            {error}
          </p>
        )}
        <div className="an-vsheet-foot">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            {VOTE_WORDS.cancel}
          </button>
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={off || busy}
            data-testid="vote-sheet-start"
          >
            {VOTE_WORDS.start}
          </button>
        </div>
      </form>
    </div>
  );
}
