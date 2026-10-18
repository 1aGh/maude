// dialogs/shortcuts-overlay.jsx — the "?" sheet (Maude v2, V2-4.6; 06 ad-search).
//
// Built from the action registry's keymap when it opens (v2/search/help-model.js): every visible key,
// grouped Edit tools · Preview tools · File · Tabs and windows · Finding a canvas · Canvas · Panels and AI · Objects · Timeline · Present, a
// "Find a shortcut" box that uses the ⌘K matcher's fold, and one Advanced fold — View › Advanced and
// Diagnostics keys with their path, then "Keys and tools that moved" (old → new). A key is read from
// the registry here, never typed, so a re-binding shows up on the next "?".

import { useEffect, useMemo, useRef, useState } from 'react';
import { isNativeApp } from '../github.js';
import { Kbd, StIcon } from '../shell/icons.jsx';
import { AdvancedFold } from '../v2/fold/advanced-fold.jsx';
import { useFold } from '../v2/fold/use-fold.js';
import { buildHelpSheet, filterHelpSheet } from '../v2/search/help-model.js';
import { useModalFocus } from '../v2/shell/modal-focus.js';
import { menuCtx } from '../v2/shell/project-menu-model.js';

/** The "?" sheet's Advanced fold in prefs.json `fold` (open at first look: it lists the keys that moved). */
export const HELP_FOLD = 'help';

/** The sheet's classes (search.css): the fold's markup, the sheet's look. */
const SO_CLASSES = Object.freeze({
  root: 'so-adv',
  btn: 'so-adv-btn',
  ch: 'so-adv-ch',
  hint: 'so-adv-count',
  body: 'so-adv-body',
});

/** One key as caps: "⇧⌘E" is the registry's string; show it as one Kbd, or the menu path in a browser. */
export function ShortcutCombo({ keys, alt = [], path }) {
  if (path) return <span className="so-path">{path}</span>;
  return (
    <span className="so-combos">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      {alt.map((a) => (
        // "or" stays with the key it introduces, so a wrapped row never ends on a dangling "or".
        <span key={a} className="so-alt">
          <span className="so-or">or</span>
          <Kbd>{a}</Kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutsOverlay({ open, onClose, readOnly = false }) {
  const [find, setFind] = useState('');
  const [fold, setFold] = useFold(HELP_FOLD);
  const findRef = useRef(null);
  useEffect(() => {
    if (open) setFind('');
  }, [open]);
  // V2-4 gate (a11y B2/W3): esc closes, Tab stays inside, focus goes back to the opener.
  const sheetRef = useModalFocus({ open, onClose, initialRef: findRef });
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
        ref={sheetRef}
        tabIndex={-1}
      >
        <div className="so-overlay-hd">
          <span className="so-title">Keyboard shortcuts</span>
          <label className="so-find">
            <StIcon name="search" size={14} />
            <input
              ref={findRef}
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
          <AdvancedFold
            panel={HELP_FOLD}
            classes={SO_CLASSES}
            testid="shortcuts-advanced"
            buttonTestid="shortcuts-advanced-toggle"
            open={foldOpen}
            onToggle={() => setFold(!fold)}
            hint={
              <>
                {shown.advanced.length} {shown.advanced.length === 1 ? 'key' : 'keys'} ·{' '}
                {shown.moved.length} moved
              </>
            }
          >
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
          </AdvancedFold>
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
