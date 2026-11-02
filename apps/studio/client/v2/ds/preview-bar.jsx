// client/v2/ds/preview-bar.jsx — S10.14: the menu and the banner of "Preview in …" (13 · ds-many-switch).
//
// The menu lists the project's systems with the one in use checked and the one being looked at highlighted; ↑↓ step
// (every open canvas re-renders — the shell's frames read the target from preview-mode.js), ↵ opens the switch
// review for the highlighted system, esc stops. The banner under it stays after the menu loses focus:
// "Previewing Studio site in Warm paper.  5 canvases shown in it · esc to stop   Switch…". Nothing is stored.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { useDismissOutside } from '../shell/use-dismiss-outside.js';
import { doorRows } from './preview-doors.js';
import {
  PREVIEW_WORDS,
  hideDsPreviewMenu,
  pickDsPreview,
  stepDsPreview,
  stopDsPreview,
} from './preview-mode.js';

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

/**
 * Esc puts focus back where the menu was opened from: the ⋯ of the system's row in the Canvases panel (the row
 * itself when the panel draws no ⋯). Nothing to do when the panel is not on screen.
 */
export function restoreRowFocus(from, doc = typeof document === 'undefined' ? null : document) {
  if (!doc || !from) return false;
  for (const id of ['canvases-ds-row-menu', 'canvases-ds-row']) {
    const el = [...doc.querySelectorAll(`[data-testid="${id}"]`)].find(
      (n) => n.getAttribute('data-ds') === from
    );
    if (el) {
      el.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}

export function DsPreviewBar({
  session,
  labelOf,
  project = '',
  shown,
  blocked = false,
  onSwitch,
  usedBy = null,
  defaultName = null,
  readOnly = false,
  runAction = null,
  canRunAction = null,
}) {
  const listRef = useRef(null);
  const [anchor, setAnchor] = useState(null);
  // the menu can go away (a click elsewhere) while the preview and its banner stay
  const menuOpen = session.menuOpen !== false;
  useLayoutEffect(() => {
    if (menuOpen) setAnchor(menuAnchor());
  }, [menuOpen]);
  // the menu takes focus when it opens, so ↑↓ ↵ esc work at once
  useEffect(() => {
    if (menuOpen) listRef.current?.focus({ preventScroll: true });
  }, [menuOpen]);
  // a click anywhere else in the shell, or into the canvas iframe (the window loses focus), closes the menu
  useDismissOutside(menuOpen, listRef, () => hideDsPreviewMenu());
  const stopAndReturn = useCallback(() => {
    if (stopDsPreview()) restoreRowFocus(session.from);
  }, [session.from]);
  // esc stops it from anywhere (the menu may have lost focus) — but never while a sheet is open: that esc is the sheet's
  useEffect(() => {
    const onKey = (e) => {
      if (blocked || e.defaultPrevented || e.key !== 'Escape') return;
      stopAndReturn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocked, stopAndReturn]);

  // The doors at the foot run registry actions through the host's runner (the one path ⌘K and the Canvases panel use).
  // Without a runner they are greyed with the reason — never a row that does nothing.
  const doors = doorRows({
    from: session.from,
    readOnly,
    canRun: (id) => typeof runAction === 'function' && (canRunAction ? !!canRunAction(id) : true),
  });
  const runDoor = (door) => {
    if (door.disabled) return;
    runAction(door.action.id, door.action.params);
    // "Open" navigates away, so the preview ends with it; Make and Link open a sheet over the canvas: the menu goes,
    // the banner and the preview stay (esc and Switch… still work)
    if (door.id === 'open') stopDsPreview();
    else hideDsPreviewMenu();
  };

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
      stopAndReturn();
    }
  };

  /** What stands beside a system: the one this canvas uses (or the one being looked at), then the default. */
  const noteOf = (name, i) =>
    [
      name === usedBy
        ? PREVIEW_WORDS.usedByCanvas
        : i === session.index
          ? PREVIEW_WORDS.previewing
          : '',
      name === defaultName ? PREVIEW_WORDS.defaultForNew : '',
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="dsp" data-testid="ds-preview-bar" data-target={session.target}>
      {menuOpen ? (
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
              <em>{noteOf(name, i)}</em>
            </div>
          ))}
          <hr className="dsp-sep" />
          {doors.map((d) => (
            <button
              key={d.id}
              type="button"
              className="dsp-door"
              data-testid="ds-preview-door"
              data-door={d.id}
              data-action={d.action.id}
              aria-disabled={d.disabled ? 'true' : undefined}
              aria-description={d.disabled ? d.why : undefined}
              title={d.disabled ? d.why : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runDoor(d)}
              onKeyDown={(e) => {
                // ↵ on a door runs the door; the list's own ↵ (switch) must not also fire
                if (e.key !== 'Enter') return;
                e.preventDefault();
                e.stopPropagation();
                runDoor(d);
              }}
            >
              <span>{d.label}</span>
              {d.key ? <kbd>{d.key}</kbd> : null}
            </button>
          ))}
          <p className="dsp-hint dsp-hint--quiet">{PREVIEW_WORDS.hint}</p>
        </div>
      ) : null}
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
