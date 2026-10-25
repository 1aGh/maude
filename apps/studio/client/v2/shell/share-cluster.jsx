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
// The mode switch (Edit · Preview · Present, mode-switch.jsx) arrives as `modeSlot` (V2-4.3b); `mode`
// marks the cluster so Preview can make it compact (the faces and the status word step aside).

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { modeCell } from '../../../bridge/mode-shows.ts';
import { StIcon } from '../../shell/icons.jsx';
import { PresenceFaces } from '../presence/faces.jsx';
import { keyHint } from './project-menu-model.js';

/** The words under Share while this Mac is offline — the same sentence the sheet gives a queued invite. */
export const OFFLINE_INVITE_TIP = 'Invites send when this Mac is online.';

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
 * @param faces [{ initials, name, you?, agent?, clientID?, artboard?, idleSince?, surface?, inComments? }]
 * @param presence S9.23 — { run(id, params), labelOf, roleOf?, canSummon, canvasLabel }; absent = the
 *   pre-S9.23 strip (a peer's face is the Follow control)
 * @param status saveStatus() — ignored when `access` is set (same slot)
 * @param access accessStatus() — { word, action } for a person without edit rights, else null
 * @param commentsCount open comments
 * @param commentsOpen the Comments panel is showing
 * @param commentsShown 10 S1 - the Comments icon is drawn only where the canvas has comments (default: drawn)
 * @param exports exportsRing() — { show, ring, busy }
 * @param exportsOpen the Exports list is showing
 * @param panelsHidden ⌘\ is on
 * @param canShare false disables Share (nothing to share yet)
 * @param ctx KeyCtx for the registry's key hints
 * @param run (id) => void — the shell's runner
 * @param onStatusAction (id) => void — Retry / Show in Finder
 * @param onAskToEdit () => void
 * @param docked the cluster heads the pinned right column (no island chrome, no edge)
 * @param modeSlot the mode switch (V2-4.3b, mode-switch.jsx)
 * @param mode the canvas mode — the cluster's form is the what-shows table's `share-cluster` row
 *   (bridge/mode-shows.ts): Preview is `compact`, Viewing `full-access`; `data-cluster` carries it
 * @param present the Present spec while presenting (Artboards · Canvas are two columns of the table)
 * @param accountSlot the account chip + card (S1.22a, account-card.jsx) — first, desktop only
 */
export function ShareCluster({
  faces,
  onFollow,
  presence = null,
  status,
  access = null,
  commentsCount = 0,
  commentsCountKind = 'open',
  commentsOpen = false,
  commentsShown = true,
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
  mode = null,
  present = null,
  accountSlot = null,
}) {
  const cluster = mode ? modeCell('share-cluster', mode, present) : 'full';
  const offline = !access && status?.kind === 'offline';
  const shareButton = (
    <button
      type="button"
      className="btn btn--primary btn--sm st-share-btn"
      data-testid="share-cluster-share"
      aria-disabled={canShare ? undefined : 'true'}
      aria-describedby={offline ? 'share-offline-tip' : undefined}
      title={canShare ? undefined : 'Open a canvas to share it'}
      onClick={() => {
        if (canShare) run('share.open');
      }}
    >
      <StIcon name="share-up" size={14} />
      Share
    </button>
  );
  const panelsLabel = panelsHidden ? 'Show panels' : 'Hide panels';
  const exportsLabel = ex.ring !== undefined ? `Exports — ${ex.ring} % done` : 'Exports';
  // S9.22b — the shell passes the unread @mention threads (canvas 10's "unread count on Comments")
  const commentsLabel =
    commentsCount > 0
      ? `Comments — ${commentsCount} ${commentsCountKind === 'unread' ? 'unread' : 'open'}`
      : 'Comments';
  return (
    <div
      className="st-share island"
      data-testid="share-cluster"
      data-tour="status"
      data-occludes={docked ? undefined : 'top'}
      data-docked={docked ? 'true' : undefined}
      data-mode={mode ?? undefined}
      data-cluster={cluster}
      // P8 C8 (01 cf-open-big): with the panels hidden the cluster is zen - the panels button alone, the way back
      data-zen={panelsHidden ? 'true' : undefined}
    >
      {accountSlot}
      <PresenceFaces faces={faces} onFollow={onFollow} presence={presence} />
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
            // The old status-bar chip's detail (its tooltip and its short label — "3 to review",
            // "1 refused", "12/40") rides on the word: hover for the sentence; `data-sync-label` is
            // the short form for scenarios and scripts (V2-4.8b).
            data-sync-label={status.syncLabel || undefined}
            role="status"
            aria-live="polite"
            title={status.detail || status.title || undefined}
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
      {commentsShown ? (
        <button
          type="button"
          className={`st-share-ic${commentsOpen ? ' is-on' : ''}`}
          data-testid="share-cluster-comments"
          aria-label={commentsLabel}
          aria-pressed={commentsOpen}
          title={withKey('Comments', ACTIONS_BY_ID.get('view.comments'), ctx)}
          onClick={() => run('view.comments')}
        >
          <StIcon name="comment-bubble" size={16} />
          {commentsCount > 0 ? (
            <span className="st-share-count" data-testid="share-cluster-comments-count">
              {commentsCount > 99 ? '99+' : commentsCount}
            </span>
          ) : null}
        </button>
      ) : null}
      {modeSlot}
      {ex.show ? (
        <button
          type="button"
          className={`st-share-ic st-ex${exportsOpen ? ' is-on' : ''}`}
          data-testid="share-cluster-exports"
          data-tour="exports"
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
        // The label flips ("Hide panels" / "Show panels") and names what a press does, so there is no
        // `aria-pressed`: a pressed "Show panels" read as the opposite of the state (a11y W5).
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
      ) : offline ? (
        // 10 co-sync-offline: an invite made offline waits in line; the tooltip says so before the
        // press (the sheet repeats it once an invite is queued). Wrapped only while offline, so the
        // cluster's child order is the same in every other state.
        <span className="st-tipwrap">
          {shareButton}
          <span
            id="share-offline-tip"
            role="tooltip"
            className="st-tip"
            data-testid="share-offline-tip"
          >
            {OFFLINE_INVITE_TIP}
          </span>
        </span>
      ) : (
        shareButton
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
