// client/v2/left-panel/canvases-pinned.jsx — V2-4.4a: the two rows the Canvases tab pins — the Design
// system on top of the list, Trash as its last row (kit `CanvasesPanel system` + 11 · pn-trashrow).
//
// Both are plain buttons that call what the tree already had: the design-system view (`onOpenSystem`)
// and the Trash list (TrashView below the list's owner).

import { StIcon } from '../../shell/icons.jsx';
import { trashRowCount } from './left-panel-model.js';
import { SystemRenameField } from '../ds/system-rename.jsx';

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
 *  design-system view (CONTRACT §2: "S design-system view → the pinned Design system row").
 *
 *  S10.13 (13 · ds-where-*, ds-multi-panel): a row is two lines — the name and "N canvases · default" —
 *  with an amber dot for a system that needs bringing up and a ⋯ menu of its own. Several systems in use
 *  sit under "Design systems · 2 in use". A project with none shows "Make a design system".
 *    header  { title, note } | null      onMenu(event, row)      the row's ⋯ (omit = no menu)
 *    empty   { label } | null            onMake()                the empty row's door
 *                                        onBringUp(ds)           S10.15b: a click on the amber dot (omit = the dot is only a mark)
 *    renaming  dsName | null             onRename(row, name)     P8 round 7: that row's name is a field (Rename…, 13 · ds-multi-menu)
 *                                        onRenameDone()          the field closed (↵ or esc) */
export function DsPinnedRows({
  rows,
  activeDsName,
  onOpen,
  header = null,
  empty = null,
  onMenu,
  onMake,
  onBringUp,
  renaming = null,
  onRename,
  onRenameDone,
}) {
  if (!rows?.length && !empty) return null;
  return (
    <div className="lp-pinned" data-testid="canvases-pinned">
      {header ? (
        <p className="lp-ds-head" data-testid="canvases-ds-head">
          {header.title}
          <em>{header.note}</em>
        </p>
      ) : null}
      {(rows || []).map((r) => {
        const on = activeDsName != null && activeDsName === r.dsName;
        if (renaming === r.dsName)
          return (
            <div key={r.dsName} className="lp-ds-wrap">
              <div
                className={`lp-row lp-ds lp-ds--rename${on ? ' is-sel' : ''}`}
                data-testid="canvases-ds-row-renaming"
                data-ds={r.dsName}
              >
                <span className="lp-ds-ic">
                  <StIcon name="system" size={14} />
                </span>
                <SystemRenameField
                  ds={r.dsName}
                  current={r.systemLabel || r.label || r.dsName}
                  others={(rows || [])
                    .filter((o) => o.dsName !== r.dsName)
                    .flatMap((o) => [o.systemLabel || o.label, o.dsName])
                    .filter(Boolean)}
                  onCommit={(name) => onRename?.(r, name)}
                  onDone={() => onRenameDone?.()}
                />
              </div>
            </div>
          );
        return (
          <div key={r.dsName} className="lp-ds-wrap">
            <button
              type="button"
              className={`lp-row lp-ds${on ? ' is-sel' : ''}${r.sub ? ' lp-ds--two' : ''}`}
              data-testid="canvases-ds-row"
              data-ds={r.dsName}
              data-default={r.isDefault ? 'true' : undefined}
              aria-current={on ? 'true' : undefined}
              title={r.sub ? `${r.label} — ${r.sub}` : 'Open the design system'}
              onClick={(e) =>
                // S10.15b: the amber dot is the door to "Bring it up to the schema?"; the rest of the row opens the system
                onBringUp && r.amber && e.target?.closest?.('[data-testid="canvases-ds-row-warn"]')
                  ? onBringUp(r.dsName)
                  : onOpen(r.dsName)
              }
            >
              <span className="lp-ds-ic">
                <StIcon name="system" size={14} />
              </span>
              {r.sub ? (
                <span className="lp-ds-two">
                  <span className="lp-name">{r.label}</span>
                  <span className="lp-ds-sub" data-testid="canvases-ds-row-sub">
                    {r.subLines
                      ? r.subLines.map((line) => (
                          <span key={line} className="lp-ds-line">
                            {line}
                          </span>
                        ))
                      : r.sub}
                  </span>
                </span>
              ) : (
                <span className="lp-name">{r.label}</span>
              )}
              {r.amber ? (
                <span
                  className="lp-ds-warn"
                  data-testid="canvases-ds-row-warn"
                  role="img"
                  aria-label={r.amber.title}
                  title={onBringUp ? `${r.amber.title} — click to bring it up` : r.amber.title}
                  data-act={onBringUp ? 'bring-up' : undefined}
                />
              ) : null}
            </button>
            {onMenu ? (
              <button
                type="button"
                className="lp-ds-more"
                data-testid="canvases-ds-row-menu"
                data-ds={r.dsName}
                aria-label={`${r.label} menu`}
                aria-haspopup="menu"
                onClick={(e) => onMenu(e, r)}
              >
                <span aria-hidden="true">⋯</span>
              </button>
            ) : null}
          </div>
        );
      })}
      {empty ? (
        <button
          type="button"
          className="lp-row lp-ds lp-ds-make"
          data-testid="canvases-ds-make"
          onClick={() => onMake?.()}
        >
          <span className="lp-ds-ic">
            <StIcon name="plus" size={14} />
          </span>
          <span className="lp-name">{empty.label}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * P8 C4 (lead call v2-p8-lead-canvases-header-and-switcher): the board's "+ New canvas" row, the last row of
 * the list (kit `.k-cp-new`: a 28 px plus well, then the words). It replaced the header's "+" / folder pair and
 * carries their hooks: the row's button is the old header "+" control (the composer's opener; its accessible name is the visible
 * words, "New canvas" — WCAG 2.5.3, decision v2-p8-c5-new-row-name-is-its-words) and
 * the quiet folder button at its end is `tree-new-folder` (shown on hover / focus, always present for keys).
 */
export function NewCanvasRow({ onNew, onNewFolder, boardOpen = false, folderOpen = false }) {
  return (
    <div className="lp-newrow" data-testid="canvases-new-row">
      <button
        type="button"
        className="lp-row lp-newrow-main"
        aria-label="New canvas"
        aria-expanded={boardOpen}
        onClick={onNew}
      >
        <span className="lp-new-ic" aria-hidden="true">
          <StIcon name="plus" size={14} />
        </span>
        <span className="lp-name">New canvas</span>
      </button>
      {onNewFolder ? (
        <button
          type="button"
          className="sh-iconbtn lp-newrow-folder"
          data-tip="New folder"
          aria-label="New folder"
          data-testid="tree-new-folder"
          aria-expanded={folderOpen}
          onClick={onNewFolder}
        >
          <StIcon name="folder-plus" size={14} />
        </button>
      ) : null}
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
