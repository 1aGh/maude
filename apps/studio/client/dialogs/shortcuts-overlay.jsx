// dialogs/shortcuts-overlay.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { Kbd } from '../shell/icons.jsx';
import { Fragment, useEffect } from 'react';
import { V1_SHEET } from '../../actions/legacy.ts';

// ───────── Keyboard-shortcuts overlay (DS components-shortcuts-overlay) ─────
//
// The ? cheat-sheet: dim scrim, shared panel material, four dense mono-headed
// columns, Esc chip in the footer. REAL bindings only — the rows render from
// the action registry's v1 layout (V2-2.4: actions/legacy.ts `V1_SHEET`), and
// actions-legacy.test.ts proves every key a row shows is a binding of the
// action it names. Scope chips mark the rows that need canvas focus.

export const SHORTCUT_GROUPS = V1_SHEET.map((g) => ({
  id: g.id,
  label: g.label,
  items: g.items.map(({ label, kbd, alt }) => (alt ? { label, kbd, alt } : { label, kbd })),
}));

export function ShortcutCombo({ kbd, alt }) {
  const combo = (s, key) => (
    <span className="so-combo" key={key}>
      {s.split(' ').map((k, i) => (
        <Kbd key={`${k}-${i}`}>{k}</Kbd>
      ))}
    </span>
  );
  return (
    <span className="so-combos">
      {combo(kbd, 'main')}
      {alt
        ? alt.split(' / ').map((a) => (
            <Fragment key={a}>
              <span className="so-or">/</span>
              {combo(a, a)}
            </Fragment>
          ))
        : null}
    </span>
  );
}

export function ShortcutsOverlay({ open, onClose }) {
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
  if (!open) return null;
  const bindings = SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0);
  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="so-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="so-overlay-hd">
          <span className="so-title">Keyboard shortcuts</span>
          <span className="so-trigger">
            press <Kbd>?</Kbd> to open
          </span>
        </div>
        <div className="so-columns">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.id} className={'so-section so-section--' + g.id}>
              <h3 className="so-section-hd">{g.label}</h3>
              <dl className="so-list">
                {g.items.map((it) => (
                  <div key={it.label} className="so-pair">
                    <dt>{it.label}</dt>
                    <dd>
                      <ShortcutCombo kbd={it.kbd} alt={it.alt} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="so-overlay-ft">
          <span>
            close with <Kbd>Esc</Kbd>
          </span>
          <span className="so-count">
            {bindings} bindings · {SHORTCUT_GROUPS.length} groups
          </span>
        </div>
      </div>
    </div>
  );
}
