// client/v2/shell/share-cluster.jsx — V2-4.3a: the Share cluster (CONTRACT §1 / §6), top-right.
//
//   faces · status word · comments · [mode switch — V2-4.3b] · Exports · Hide panels · Share / Ask to edit
//
// PRESENTATIONAL. Every word comes from save-status.js (the one machine), every label and key hint from
// the registry; the cluster runs actions through `run(id)` — the shell's one runner (menu-runner.js) — so
// Hide panels, Comments, Exports and Share are the SAME handlers the menu and ⌘K use, never a second one.
//
// Island: a floating `.island` with `data-occludes="top"` (V2-1.2 §5.6, like the project pill on the left),
// so Fit leaves room for it. Docked (pinned layout with a right panel showing) it heads the right column
// and declares no edge — it covers no canvas there.
//
// The mode switch (Edit · Preview · Present) is V2-4.3b: `modeSlot` marks where it goes, and renders
// nothing until then.

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { StIcon } from '../../shell/icons.jsx';
import { keyHint } from './project-menu-model.js';

function Faces({ faces }) {
  if (!faces?.length) return null;
  return (
    <ul className="st-faces" aria-label="People here" data-testid="share-cluster-faces">
      {faces.map((f) => (
        <li
          key={`${f.you ? 'you' : f.agent ? 'agent' : 'peer'}:${f.name}`}
          className={`st-face${f.agent ? ' is-agent' : ''}`}
          title={f.name}
          aria-label={f.name}
        >
          {f.initials}
        </li>
      ))}
    </ul>
  );
}

function Ring({ value }) {
  return (
    <svg className="st-ex-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15" />
      <circle
        cx="18"
        cy="18"
        r="15"
        className="st-ex-ring-v"
        strokeDasharray={`${(value * 0.942).toFixed(1)} 100`}
      />
    </svg>
  );
}

const withKey = (label, def, ctx) => {
  const k = def ? keyHint(def, ctx) : '';
  return k ? `${label}  ${k}` : label;
};

/**
 * @param faces [{ initials, name, you?, agent? }]
 * @param status saveStatus() — ignored when `access` is set (same slot)
 * @param access accessStatus() — { word, action } for a person without edit rights, else null
 * @param commentsCount open comments
 * @param commentsOpen the Comments panel is showing
 * @param exports exportsRing() — { show, ring, busy }
 * @param exportsOpen the Exports list is showing
 * @param panelsHidden ⌘\ is on
 * @param canShare false disables Share (nothing to share yet)
 * @param ctx KeyCtx for the registry's key hints
 * @param run (id) => void — the shell's runner
 * @param onStatusAction (id) => void — Retry / Show in Finder
 * @param onAskToEdit () => void
 * @param docked the cluster heads the pinned right column (no island chrome, no edge)
 * @param modeSlot reserved for the mode switch (V2-4.3b)
 */
export function ShareCluster({
  faces,
  status,
  access = null,
  commentsCount = 0,
  commentsOpen = false,
  exports: ex = { show: false, ring: undefined, busy: 0 },
  exportsOpen = false,
  panelsHidden = false,
  canShare = true,
  ctx,
  run,
  onStatusAction,
  onAskToEdit,
  docked = false,
  modeSlot = null,
}) {
  const panelsLabel = panelsHidden ? 'Show panels' : 'Hide panels';
  const exportsLabel = ex.ring !== undefined ? `Exports — ${ex.ring} % done` : 'Exports';
  const commentsLabel = commentsCount > 0 ? `Comments — ${commentsCount} open` : 'Comments';
  return (
    <div
      className="st-share island"
      data-testid="share-cluster"
      data-occludes={docked ? undefined : 'top'}
      data-docked={docked ? 'true' : undefined}
    >
      <Faces faces={faces} />
      {access ? (
        <span
          className="st-saved"
          data-testid="share-cluster-status"
          data-status="access"
          role="status"
        >
          {access.word}
        </span>
      ) : status ? (
        <>
          <span
            className={`st-saved${status.tone ? ` st-saved--${status.tone}` : ''}`}
            data-testid="share-cluster-status"
            data-status={status.kind}
            role="status"
            aria-live="polite"
            title={status.detail}
          >
            <StIcon name={status.icon} size={16} />
            <span className="st-saved-w">{status.word}</span>
          </span>
          {status.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="st-share-act"
              data-testid={`share-cluster-${a.id}`}
              onClick={() => onStatusAction?.(a.id)}
            >
              {a.label}
            </button>
          ))}
        </>
      ) : null}
      <button
        type="button"
        className={`st-share-ic${commentsOpen ? ' is-on' : ''}`}
        data-testid="share-cluster-comments"
        aria-label={commentsLabel}
        aria-pressed={commentsOpen}
        title={withKey('Comments', ACTIONS_BY_ID.get('view.comments'), ctx)}
        onClick={() => run('view.comments')}
      >
        <StIcon name="comment" size={16} />
        {commentsCount > 0 ? (
          <span className="st-share-count" data-testid="share-cluster-comments-count">
            {commentsCount > 99 ? '99+' : commentsCount}
          </span>
        ) : null}
      </button>
      {modeSlot}
      {ex.show ? (
        <button
          type="button"
          className={`st-share-ic st-ex${exportsOpen ? ' is-on' : ''}`}
          data-testid="share-cluster-exports"
          data-busy={ex.busy > 0 ? 'true' : 'false'}
          aria-label={exportsLabel}
          aria-pressed={exportsOpen}
          title={exportsLabel}
          onClick={() => run('view.exports')}
        >
          <StIcon name="export" size={16} />
          {ex.ring !== undefined ? <Ring value={ex.ring} /> : null}
        </button>
      ) : null}
      <button
        type="button"
        className={`st-share-ic${panelsHidden ? ' is-on' : ''}`}
        data-testid="share-cluster-panels"
        aria-label={panelsLabel}
        aria-pressed={panelsHidden}
        title={withKey(panelsLabel, ACTIONS_BY_ID.get('view.panels'), ctx)}
        onClick={() => run('view.panels')}
      >
        <StIcon name="panel-right" size={16} />
      </button>
      {access ? (
        <button
          type="button"
          className="btn btn--primary btn--sm st-share-btn"
          data-testid="share-cluster-ask"
          onClick={() => onAskToEdit?.()}
        >
          {access.action}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--sm st-share-btn"
          data-testid="share-cluster-share"
          aria-disabled={canShare ? undefined : 'true'}
          title={canShare ? undefined : 'Open a canvas to share it'}
          onClick={() => {
            if (canShare) run('share.open');
          }}
        >
          <StIcon name="share-up" size={14} />
          Share
        </button>
      )}
      {status?.detail && !access ? (
        // The full-disk sentence (C37): a note under the cluster, in the popover plane's place.
        <div className="st-share-note" data-testid="share-cluster-detail">
          {status.detail}
        </div>
      ) : null}
    </div>
  );
}
