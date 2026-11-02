// client/v2/ds/outside-banner.jsx — S10.11: "2 tokens changed outside the app" (13 · ds-truth-outside, V2-1.6 §5.11 a).
//
// A file of the design system changed behind the app's back — Claude Code edited it, a `git pull` landed, a peer's
// copy arrived. It never changes a canvas silently: the Design system canvas shows the new values on their swatches,
// marked "Changed outside", and this card says which file, who, and what moved, with two buttons:
//
//   Keep   the new values become part of the system (a revision; canvases follow after the usual review)
//   Undo   the file gets its old values back (the app writes the old bytes)
//
// The card draws what it is given. The host (truth-host.jsx) fetches the state, runs the two writes and says the
// outcome. A name that arrived with the change (a git author, a peer) is text: shown, never obeyed.

import { StIcon } from '../../shell/icons.jsx';
import {
  fileLines,
  otherWords,
  outsideRows,
  outsideTitle,
  safeColour,
  TRUTH_WORDS,
} from './truth-model.js';

function Before({ row, which }) {
  const v = which === 'before' ? row.before : row.after;
  const px = which === 'before' ? row.bpx : row.apx;
  if (row.kind === 'colour')
    return (
      <i
        className="dst-chip"
        style={{ background: safeColour(v) ?? 'transparent' }}
        data-testid={`ds-outside-chip-${which}`}
        aria-hidden="true"
      />
    );
  if (row.kind === 'length')
    return (
      <i
        className="dst-r"
        style={{ borderRadius: Math.min(px, 22) / 2 }}
        data-testid={`ds-outside-chip-${which}`}
        aria-hidden="true"
      />
    );
  return <span data-testid={`ds-outside-value-${which}`}>{v ?? '—'}</span>;
}

/**
 * @param {{ truth: any, contrast?: Record<string,string>, themes?: any, busy?: boolean, note?: string | null,
 *           onKeep: () => void, onUndo: () => void, now?: number }} props
 */
export function OutsideBanner({
  truth,
  contrast = {},
  themes,
  busy = false,
  note = null,
  onKeep,
  onUndo,
  now,
}) {
  const outside = truth?.outside;
  if (!outside) return null;
  const conflictCss = new Set(truth.conflicts.map((c) => c?.css));
  const { shown, more, all } = outsideRows(outside, conflictCss, themes);
  const other = otherWords(outside.otherChanges);
  if (!all.length && !other) return null;
  const { lines, more: moreFiles } = fileLines(outside.files, now);
  const held = truth.conflicts.length > 0;
  const heldNames = truth.conflicts
    .map((c) => (typeof c?.label === 'string' && c.label ? c.label : c?.css))
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  return (
    <section
      className="dst"
      data-testid="ds-outside"
      aria-label={outsideTitle(all.length, other ? 1 : 0)}
    >
      <p className="dst-title" data-testid="ds-outside-title">
        {outsideTitle(all.length, other ? 1 : 0)}
      </p>
      {lines.map((l) => (
        <p className="dst-src" key={l.file} data-testid="ds-outside-source">
          <StIcon name="file" size={14} />
          <span>
            <b>{l.file}</b> was {l.how}
            {l.ago ? `, ${l.ago}` : ''}
          </span>
        </p>
      ))}
      {moreFiles > 0 ? (
        <p className="dst-fine">{`and ${moreFiles} more ${moreFiles === 1 ? 'file' : 'files'}`}</p>
      ) : null}
      {shown.map((r) => {
        const extra = contrast[r.css];
        return (
          <div className="dst-c" key={r.css} data-testid="ds-outside-change" data-css={r.css}>
            <b title={r.css}>{r.label}</b>
            <span className="dst-ba">
              <Before row={r} which="before" />
              <StIcon name="chevron-right" size={12} />
              <Before row={r} which="after" />
            </span>
            <em>{[r.detail, extra].filter(Boolean).join(' · ')}</em>
          </div>
        );
      })}
      {more > 0 ? (
        <p className="dst-fine" data-testid="ds-outside-more">{`and ${more} more`}</p>
      ) : null}
      {other ? (
        <p className="dst-fine" data-testid="ds-outside-other">
          {other}
        </p>
      ) : null}
      <p className="dst-fine" data-testid="ds-outside-fine">
        {truth.linked
          ? TRUTH_WORDS.viewOnly
          : held
            ? TRUTH_WORDS.keepHeld(heldNames)
            : TRUTH_WORDS.keepFine}
      </p>
      {note ? (
        <p className="dst-err" role="status" data-testid="ds-outside-note">
          {note}
        </p>
      ) : null}
      <span className="dst-acts">
        <button
          type="button"
          className="btn btn--sm"
          data-testid="ds-outside-undo"
          disabled={busy}
          onClick={onUndo}
        >
          {TRUTH_WORDS.undo}
        </button>
        {truth.linked ? null : (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            data-testid="ds-outside-keep"
            disabled={busy || held}
            onClick={onKeep}
          >
            {TRUTH_WORDS.keep}
          </button>
        )}
      </span>
    </section>
  );
}
