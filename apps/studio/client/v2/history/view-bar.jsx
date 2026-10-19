// client/v2/history/view-bar.jsx — S1.14: the Viewing bar (11 · pn-history, `pn-viewbar`).
//
//   Viewing “Schváleno trenéry” · 5 Oct, 18:40 · Jonas        esc back to now
//
// Shown while the shell's mode store holds `viewing{at}` (canvas-mode.js, note 6): the canvas shows that
// version read-only, and esc — or this button — returns to now. The same esc also arrives from inside the
// canvas frame (`mode-request back`, handled by the mode lane); this listener is for the keys the shell
// itself hears. It stands down for an open dialog (its own esc) and for typing.

import { useEffect, useRef } from 'react';
import { Kbd } from '../../shell/icons.jsx';
import { useViewBarPlacement } from './clear-band.js';
import { HISTORY_WORDS } from './use-versions.js';

/** The history glyph (a clock running back), in the shell's 16×16 thin-stroke family. */
export function HistoryGlyph({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
      <polyline points="2.2 2 2.4 4.4 4.8 4.4" />
      <polyline points="8 5 8 8 10 9.4" />
    </svg>
  );
}

const typing = (el) =>
  !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));

export function ViewBar({ viewing, onLeave }) {
  const barRef = useRef(null);
  // S1.23: centred in the band BETWEEN the top islands (project pill, Share cluster), never under one
  useViewBarPlacement(barRef, !!viewing);
  useEffect(() => {
    if (!viewing) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (typing(document.activeElement)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      onLeave?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing, onLeave]);
  if (!viewing) return null;
  return (
    <section
      ref={barRef}
      className="island vh-viewbar"
      aria-label="Viewing a past version"
      data-testid="vh-viewbar"
    >
      <HistoryGlyph />
      <span className="vh-viewbar-t" data-testid="vh-viewbar-text">
        {HISTORY_WORDS.viewing} <strong>“{viewing.title}”</strong>
        {viewing.when ? ` · ${viewing.when}` : ''}
        {viewing.who ? ` · ${viewing.who}` : ''}
      </span>
      <button
        type="button"
        className="vh-viewbar-esc"
        data-testid="vh-viewbar-back"
        onClick={() => onLeave?.()}
      >
        <Kbd>esc</Kbd> {HISTORY_WORDS.backToNow}
      </button>
    </section>
  );
}
