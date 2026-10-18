// client/v2/shell/mode-switch.jsx — V2-4.3b: the mode switch in the Share cluster (CONTRACT §7, A7).
//
//   [ Edit | Viewing ] · Preview · Present ⌄
//
// Lifted from the kit (.design/ui/v2/_kit.tsx `ModeSwitch`, `_kit.css` `.k-modes`) and 04 Modes: the
// mode glyphs are the kit's own (pencil-ruler, an eye in a frame, an easel, reading glasses); the
// words live in aria-label / title. Editors get Edit · Preview · Present; Can view / Can comment get
// Viewing in the first slot — editing controls are hidden, never greyed.
//
// Present⌄ is the kit's one 40px slot with two hit targets: the segment presents from the selected
// artboard, the chevron opens Present's small menu (04 md-present-menu). S3.1 lists the rows that
// exist: Artboards, one by one (from the selection ⌥⌘↵, from the start ⇧⌥⌘↵) and the canvas, pan
// freely. S3.5 adds Order and notes… under a rule, for editors only (`present.order-notes`, minRole
// edit). Presenter view and the presentation link stay hidden until their slice (S3.6b, S3.7a) —
// hidden, never greyed.
//
// The segments keep the palette's testids (`palette-mode-*`, V2-1.2 §5.5 rule 5 — the multiplayer e2e
// reads `palette-mode-edit`), plus `palette-mode-viewing`.

import { useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { MODE_WORD, modeSegments } from './canvas-mode.js';

const GLYPH = {
  edit: (
    <>
      <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
      <path d="m8 6 2-2" />
      <path d="m18 16 2-2" />
      <path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17" />
      <path d="M21.17 6.81a2.82 2.82 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
      <path d="m15 5 4 4" />
    </>
  ),
  preview: (
    <>
      <rect x="2.5" y="3.75" width="19" height="16.5" rx="4.5" />
      <path d="M6 12s2.2-3.75 6-3.75S18 12 18 12s-2.2 3.75-6 3.75S6 12 6 12z" />
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  present: (
    <>
      <path d="M2 3.5h20" />
      <path d="M20.5 3.5v10a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-10" />
      <path d="m7.5 21 4.5-5 4.5 5" />
    </>
  ),
  viewing: (
    <>
      <circle cx="6" cy="15.5" r="3.75" />
      <circle cx="18" cy="15.5" r="3.75" />
      <path d="M14.25 15.5a2.25 2.25 0 0 0-4.5 0" />
      <path d="M2.4 14 5 7.5c.6-1.3 1.4-2 2.75-2" />
      <path d="M21.6 14 19 7.5c-.6-1.3-1.4-2-2.75-2" />
    </>
  ),
};

function ModeGlyph({ m }) {
  return (
    <svg
      className="st-mode-g"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPH[m]}
    </svg>
  );
}

/** ⌥⌘↵ → Alt+Meta+Enter (aria-keyshortcuts). */
const ariaKeys = (k) =>
  [k.includes('⇧') && 'Shift', k.includes('⌥') && 'Alt', k.includes('⌘') && 'Meta', 'Enter']
    .filter(Boolean)
    .join('+');

const LABEL = {
  edit: 'Edit — click selects and edits',
  viewing: 'Viewing — click shows specs',
  preview: 'Preview — the design is live',
  present: 'Present',
};

/** Present ⌄'s rows (04 md-present-menu; words CONTRACT §2–§3). */
const PRESENT_ROWS = [
  { group: 'Artboards, one by one' },
  { kind: 'selection', testid: 'mode-present-from-selection', label: 'Present', keys: '⌥⌘↵' },
  {
    kind: 'start',
    testid: 'mode-present-from-start',
    label: 'Present from the start',
    keys: '⇧⌥⌘↵',
  },
  { group: 'The canvas, pan freely' },
  {
    kind: 'canvas',
    testid: 'mode-present-canvas',
    label: 'Present the canvas',
    note: 'no chrome, no pins',
  },
  // 04 md-present-menu: a rule, then (presenter view, S3.6b) and Order and notes…; editors only.
  { sep: 'tools', edit: true },
  {
    kind: 'order-notes',
    testid: 'mode-present-order-notes',
    label: 'Order and notes…',
    edit: true,
  },
];

/** S3.6b — below the canvas rows, only where another display exists (04 md-present-menu). */
const PRESENTER_ROW = {
  kind: 'presenter',
  testid: 'mode-present-presenter-view',
  label: 'Presenter view on another display',
};

/**
 * The Present ⌄ rows for this session: editor-only rows only for editors (S3.5), and the presenter row
 * (S3.6b) only where another display exists — in the tools group, before Order and notes…; for a
 * non-editor (no tools group) under its own rule.
 */
function presentRows(caps, presenterView) {
  const rows = PRESENT_ROWS.filter((row) => !row.edit || caps?.edit);
  if (!presenterView) return rows;
  const at = rows.findIndex((r) => r.kind === 'order-notes');
  if (at >= 0) rows.splice(at, 0, PRESENTER_ROW);
  else rows.push({ sep: 'presenter' }, PRESENTER_ROW);
  return rows;
}

/**
 * @param mode the mode the canvas is in: edit | viewing | preview | present
 * @param caps ModeCaps — `caps.edit` decides Edit vs Viewing
 * @param onSelect (mode) => void — a click on Present is `onSelect('present')`: from the selection
 * @param onPresent (kind) => void — Present ⌄ › 'selection' | 'start' | 'canvas' | 'order-notes'
 * @param onPresentCanvas () => void — the older single-row prop, used when `onPresent` is absent
 * @param presentFromLabel the selected artboard's label: the first row reads Present from “…”
 * @param canPresent false with no canvas open (Present has nothing to show)
 * @param presenterView S3.6b — `{ name, on }` when the desktop app has another display (the row is a check
 *        with that display's name); null = no row at all (hidden, never greyed)
 * @param onPresenterView () => void — the row toggles presenter view
 */
export function ModeSwitch({
  mode,
  caps,
  onSelect,
  onPresent,
  onPresentCanvas,
  presentFromLabel = null,
  canPresent = true,
  presenterView = null,
  onPresenterView,
}) {
  const run = (kind) => {
    if (onPresent) onPresent(kind);
    else if (kind === 'canvas') onPresentCanvas?.();
  };
  const [menu, setMenu] = useState(false);
  const rootRef = useRef(null);
  const firstRowRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    firstRowRef.current?.focus();
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setMenu(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenu(false);
        rootRef.current?.querySelector('[data-testid="mode-present-menu"]')?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons, not a form
    <div
      ref={rootRef}
      className="st-modes"
      role="group"
      aria-label="Mode"
      data-testid="share-cluster-mode"
    >
      {modeSegments(caps).map((id) =>
        id === 'present' ? (
          <span key={id} className={`st-mode-b st-mode-b--menu${menu ? ' is-open' : ''}`}>
            <button
              type="button"
              className="st-mode-hit"
              data-testid="palette-mode-present"
              aria-label={LABEL.present}
              aria-pressed={mode === 'present'}
              title={MODE_WORD.present}
              disabled={!canPresent}
              onClick={() => onSelect?.('present')}
            >
              <ModeGlyph m="present" />
            </button>
            <button
              type="button"
              className="st-mode-ch"
              data-testid="mode-present-menu"
              aria-label="Present options"
              aria-haspopup="menu"
              aria-expanded={menu}
              disabled={!canPresent}
              onClick={() => setMenu((v) => !v)}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <polyline
                  points="3.5 6 8 10.5 12.5 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </span>
        ) : (
          <button
            key={id}
            type="button"
            className="st-mode-b"
            data-testid={`palette-mode-${id}`}
            aria-label={LABEL[id]}
            aria-pressed={mode === id}
            title={MODE_WORD[id]}
            onClick={() => onSelect?.(id)}
          >
            <ModeGlyph m={id} />
          </button>
        )
      )}
      {menu ? (
        <div
          className="st-pm st-mode-menu"
          role="menu"
          aria-label="Present"
          data-testid="mode-present-list"
        >
          {presentRows(caps, presenterView).map((row, i) =>
            row.sep ? (
              <hr key={`sep-${row.sep}`} className="st-pm-sep" />
            ) : row.kind === 'presenter' ? (
              <div key={row.kind} role="none" className="st-pm-li">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={!!presenterView?.on}
                  className="st-pm-row"
                  data-testid={row.testid}
                  onClick={() => {
                    setMenu(false);
                    onPresenterView?.();
                  }}
                >
                  <span className="st-pm-ic" aria-hidden="true">
                    {presenterView?.on ? <StIcon name="check" size={13} /> : null}
                  </span>
                  <span className="st-pm-lab">{row.label}</span>
                  <span className="st-mode-menu-note">{presenterView?.name ?? ''}</span>
                </button>
              </div>
            ) : row.group ? (
              <div key={row.group} className="st-mode-menu-hd" role="presentation">
                {row.group}
              </div>
            ) : (
              <div key={row.kind} role="none" className="st-pm-li">
                <button
                  ref={i === 1 ? firstRowRef : undefined}
                  type="button"
                  role="menuitem"
                  className="st-pm-row"
                  data-testid={row.testid}
                  aria-keyshortcuts={row.keys ? ariaKeys(row.keys) : undefined}
                  onClick={() => {
                    setMenu(false);
                    run(row.kind);
                  }}
                >
                  <span className="st-pm-ic" aria-hidden="true" />
                  <span className="st-pm-lab">
                    {row.kind === 'selection' && presentFromLabel
                      ? `Present from “${presentFromLabel}”`
                      : row.label}
                  </span>
                  <span className="st-mode-menu-note">{row.keys ?? row.note}</span>
                </button>
              </div>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
