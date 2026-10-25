// client/v2/ds/preview-bar.jsx — S10.14: the menu and the banner of "Preview in …" (13 · ds-many-switch).
//
// The menu lists the project's systems with the one in use checked and the one being looked at highlighted; ↑↓ step
// (every open canvas re-renders — the shell's frames read the target from preview-mode.js), ↵ opens the switch
// review for the highlighted system, esc stops. The banner under it stays after the menu loses focus:
// "Previewing Studio site in Warm paper.  5 canvases shown in it · esc to stop   Switch…". Nothing is stored.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { PREVIEW_WORDS, pickDsPreview, stepDsPreview, stopDsPreview } from './preview-mode.js';

/**
 * @param {{ session: { from: string, names: string[], index: number, target: string },
 *           labelOf: (name: string) => string, project?: string, shown: number, blocked?: boolean,
 *           onSwitch: (target: string) => void }} props
 */
/**
 * Where the menu hangs (13 · ds-many-switch): beside the Design systems row it was opened from — the pinned strip
 * of the Canvases panel — not under the banner. Null when that strip is not on screen (the menu then keeps the
 * banner's column).
 */
export function menuAnchor(doc = typeof document === 'undefined' ? null : document) {
  const strip = doc?.querySelector('[data-testid="canvases-pinned"]');
  const r = strip?.getBoundingClientRect?.();
  if (!r || r.width === 0 || r.height === 0) return null;
  return { left: Math.round(r.right + 8), top: Math.round(r.top) };
}

export function DsPreviewBar({ session, labelOf, project = '', shown, blocked = false, onSwitch }) {
  const listRef = useRef(null);
  const [anchor, setAnchor] = useState(null);
  useLayoutEffect(() => {
    setAnchor(menuAnchor());
  }, []);
  // the menu takes focus when the preview starts, so ↑↓ ↵ esc work at once
  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
  }, []);
  // esc stops it from anywhere (the menu may have lost focus) — but never while a sheet is open: that esc is the sheet's
  useEffect(() => {
    const onKey = (e) => {
      if (blocked || e.defaultPrevented || e.key !== 'Escape') return;
      stopDsPreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocked]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      stepDsPreview(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSwitch(session.target);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopDsPreview();
    }
  };

  return (
    <div className="dsp" data-testid="ds-preview-bar" data-target={session.target}>
      <div
        ref={listRef}
        className="dsp-menu island"
        role="listbox"
        tabIndex={0}
        aria-label={PREVIEW_WORDS.menuHead}
        aria-activedescendant={`ds-preview-opt-${session.index}`}
        data-testid="ds-preview-menu"
        data-anchored={anchor ? 'row' : undefined}
        style={anchor ? { left: anchor.left, top: anchor.top } : undefined}
        onKeyDown={onKeyDown}
      >
        <p className="dsp-head">{PREVIEW_WORDS.menuHead}</p>
        {session.names.map((name, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox owns the keys (aria-activedescendant)
          <div
            key={name}
            id={`ds-preview-opt-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === session.index}
            className="dsp-opt"
            data-highlight={i === session.index ? 'true' : undefined}
            data-testid="ds-preview-option"
            data-ds={name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pickDsPreview(name)}
          >
            <StIcon name="system" size={14} />
            <span className="dsp-opt-n">{labelOf(name)}</span>
            <em>{name === session.from ? 'in use' : i === session.index ? 'previewing' : ''}</em>
          </div>
        ))}
        <hr className="dsp-sep" />
        {PREVIEW_WORDS.doors.map((d) => (
          <div key={d.id} className="dsp-door" data-testid="ds-preview-door" data-door={d.id}>
            <span>{d.label}</span>
            {d.key ? <kbd>{d.key}</kbd> : null}
          </div>
        ))}
        <p className="dsp-hint dsp-hint--quiet">{PREVIEW_WORDS.hint}</p>
      </div>
      <div className="dsp-banner island" role="status" data-testid="ds-preview-banner">
        <StIcon name="eye" size={14} />
        <span className="dsp-banner-t">
          {/* 13 · ds-many-switch: it is the PROJECT that is looked at in another system, not the system it follows */}
          <b>{PREVIEW_WORDS.banner(project || labelOf(session.from), labelOf(session.target))}</b>
          <em>{PREVIEW_WORDS.shown(shown)}</em>
        </span>
        <button
          type="button"
          className="btn btn--primary"
          data-testid="ds-preview-switch"
          onClick={() => onSwitch(session.target)}
        >
          {PREVIEW_WORDS.action}
        </button>
      </div>
    </div>
  );
}
