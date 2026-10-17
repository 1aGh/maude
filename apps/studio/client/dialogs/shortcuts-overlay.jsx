// dialogs/shortcuts-overlay.jsx — the "?" sheet (Maude v2, V2-4.6; 06 ad-search).
//
// Built from the action registry's keymap when it opens (v2/search/help-model.js): every visible key,
// grouped Edit tools · Preview tools · File · Canvas · Panels and AI · Objects · Timeline · Present, a
// "Find a shortcut" box that uses the ⌘K matcher's fold, and one Advanced fold — View › Advanced and
// Diagnostics keys with their path, then "Keys and tools that moved" (old → new). A key is read from
// the registry here, never typed, so a re-binding shows up on the next "?".

import { Fragment, useEffect, useMemo, useState } from 'react';
import { isNativeApp } from '../github.js';
import { Kbd, StIcon } from '../shell/icons.jsx';
import { buildHelpSheet, filterHelpSheet } from '../v2/search/help-model.js';
import { menuCtx } from '../v2/shell/project-menu-model.js';

const FOLD_KEY = 'mdcc-help-advanced-open';

function readFold() {
  try {
    return localStorage.getItem(FOLD_KEY) !== '0';
  } catch {
    return true;
  }
}

/** One key as caps: "⇧⌘E" is the registry's string; show it as one Kbd, or the menu path in a browser. */
export function ShortcutCombo({ keys, alt = [], path }) {
  if (path) return <span className="so-path">{path}</span>;
  return (
    <span className="so-combos">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      {alt.map((a) => (
        <Fragment key={a}>
          <span className="so-or">or</span>
          <Kbd>{a}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutsOverlay({ open, onClose, readOnly = false }) {
  const [find, setFind] = useState('');
  const [fold, setFold] = useState(readFold);
  useEffect(() => {
    if (open) setFind('');
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  // Built each time it opens: the registry may have been re-bound since the last "?".
  const sheet = useMemo(
    () =>
      open ? buildHelpSheet(menuCtx({ native: isNativeApp(), readOnly, canvasOpen: true })) : null,
    [open, readOnly]
  );
  if (!open || !sheet) return null;
  const shown = filterHelpSheet(sheet, find);
  const searching = find.trim().length > 0;
  const foldOpen = fold || searching;
  const toggleFold = () => {
    const next = !fold;
    setFold(next);
    try {
      localStorage.setItem(FOLD_KEY, next ? '1' : '0');
    } catch {
      /* private window: the fold simply does not remember */
    }
  };
  const nothing =
    searching && shown.groups.length + shown.advanced.length + shown.moved.length === 0;
  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="so-overlay so-overlay--v2"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-sheet"
      >
        <div className="so-overlay-hd">
          <span className="so-title">Keyboard shortcuts</span>
          <label className="so-find">
            <StIcon name="search" size={14} />
            <input
              // biome-ignore lint/a11y/noAutofocus: "?" opens on an explicit key press.
              autoFocus
              data-testid="shortcuts-find"
              aria-label="Find a shortcut"
              placeholder="Find a shortcut"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
          </label>
          <button type="button" className="so-close" aria-label="Close" onClick={onClose}>
            <StIcon name="x" size={12} />
          </button>
        </div>
        {nothing ? (
          <p className="so-none" data-testid="shortcuts-none">
            Nothing called “{find.trim()}”. Try another word.
          </p>
        ) : null}
        <div className="so-columns so-columns--3">
          {shown.groups.map((g) => (
            <section
              key={g.id}
              className={`so-section so-section--${g.id}`}
              data-testid={`shortcuts-group-${g.id}`}
            >
              <h3 className="so-section-hd">{g.label}</h3>
              {g.note ? <p className="so-note">{g.note}</p> : null}
              <dl className="so-list">
                {g.rows.map((r) => (
                  <div key={r.id} className="so-pair" data-testid={`shortcuts-row-${r.id}`}>
                    <dt>{r.label}</dt>
                    <dd>
                      <ShortcutCombo keys={r.keys} alt={r.alt} path={r.path} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        {shown.advanced.length > 0 || shown.moved.length > 0 ? (
          <div className="so-adv" data-testid="shortcuts-advanced">
            <button
              type="button"
              className="so-adv-btn"
              aria-expanded={foldOpen}
              onClick={toggleFold}
              data-testid="shortcuts-advanced-toggle"
            >
              <StIcon name={foldOpen ? 'chevron-down' : 'chevron-right'} size={12} />
              Advanced
              <span className="so-adv-count">
                {shown.advanced.length} {shown.advanced.length === 1 ? 'key' : 'keys'} ·{' '}
                {shown.moved.length} moved
              </span>
            </button>
            {foldOpen ? (
              <div className="so-adv-body">
                {shown.advanced.map((r) => (
                  <div
                    key={r.id}
                    className="so-pair so-pair--adv"
                    data-testid={`shortcuts-row-${r.id}`}
                  >
                    <span className="so-adv-label">{r.label}</span>
                    <span className="so-adv-path">{r.path}</span>
                    <ShortcutCombo keys={r.keys} alt={r.alt} />
                  </div>
                ))}
                {shown.moved.length > 0 ? (
                  <>
                    <h4 className="so-sub" data-testid="shortcuts-moved-hd">
                      Keys and tools that moved
                    </h4>
                    <ul className="so-moved" data-testid="shortcuts-moved">
                      {shown.moved.map((m) => (
                        <li key={m.was} className="so-mv">
                          <span className="so-mv-was">{m.was}</span>
                          <StIcon name="chevron-right" size={11} />
                          <span className="so-mv-now">{m.now}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="so-overlay-ft">
          <span>
            close with <Kbd>esc</Kbd>
          </span>
          <span className="so-count">{shown.count} keys</span>
        </div>
      </div>
    </div>
  );
}
