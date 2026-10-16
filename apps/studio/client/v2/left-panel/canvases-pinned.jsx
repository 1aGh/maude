// client/v2/left-panel/canvases-pinned.jsx — V2-4.4a: the two rows the Canvases tab pins — the Design
// system on top of the list, Trash as its last row (kit `CanvasesPanel system` + 11 · pn-trashrow).
//
// Both are plain buttons that call what the tree already had: the design-system view (`onOpenSystem`)
// and the Trash list (TrashView below the list's owner).

import { StIcon } from '../../shell/icons.jsx';
import { trashRowCount } from './left-panel-model.js';

/** A trash can on the shell's 16-box icon grid (the icon set has none). */
export function TrashIcon({ size = 14 }) {
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
    >
      <path d="M2.5 4.5h11" />
      <path d="M6 4.5V3h4v1.5" />
      <path d="M4 4.5l.6 8.2a1 1 0 001 .8h4.8a1 1 0 001-.8l.6-8.2" />
      <path d="M6.7 7v4M9.3 7v4" />
    </svg>
  );
}

/** The project's design system(s), pinned above every canvas. One row per system; clicking opens the
 *  design-system view (CONTRACT §2: "S design-system view → the pinned Design system row"). */
export function DsPinnedRows({ rows, activeDsName, onOpen }) {
  if (!rows?.length) return null;
  return (
    <div className="lp-pinned" data-testid="canvases-pinned">
      {rows.map((r) => {
        const on = activeDsName != null && activeDsName === r.dsName;
        return (
          <button
            key={r.dsName}
            type="button"
            className={`lp-row lp-ds${on ? ' is-sel' : ''}`}
            data-testid="canvases-ds-row"
            data-ds={r.dsName}
            aria-current={on ? 'true' : undefined}
            title="Open the design system"
            onClick={() => onOpen(r.dsName)}
          >
            <span className="lp-ds-ic">
              <StIcon name="sliders" size={14} />
            </span>
            <span className="lp-name">{r.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The panel's last row: Trash and what is in it. Opens the Trash list. */
export function TrashRow({ trash, onOpen, on = false }) {
  const count = trashRowCount(trash);
  return (
    <button
      type="button"
      className={`lp-row lp-trashrow${on ? ' is-sel' : ''}`}
      data-testid="canvases-trash-row"
      aria-current={on ? 'true' : undefined}
      onClick={onOpen}
    >
      <span className="lp-trash-ic">
        <TrashIcon />
      </span>
      <span className="lp-name">Trash</span>
      {count ? <span className="lp-count">{count}</span> : null}
    </button>
  );
}
