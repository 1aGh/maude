// client/v2/shell/callouts.jsx — V2-4.8b: the callout stack (presentational).
//
// What the old top banners said, one plate each, ONE action at most (CONTRACT §4). The items come from
// callouts-model.js `calloutStack()`; `onAction(item)` runs the action, `onDismiss(item)` closes one.
// `children` is the slot for a persistent notice that is not dismissible and not derived from a payload
// (the format-gate strip, V2-1.12).

import { useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';

async function copyList(lines) {
  try {
    await globalThis.navigator?.clipboard?.writeText(lines.join('\n'));
  } catch {
    /* a blocked clipboard is not an error */
  }
}

/**
 * S11.15 — the details one fold down (06 · ad-edge-sync). Words stay on the plate; the hub, the reply,
 * the next try and the waiting files are for whoever asks. Open or closed is for this callout only.
 */
function CalloutFold({ kind, fold }) {
  const [open, setOpen] = useState(false);
  const { rows = [], waiting = null, hint = '' } = fold;
  return (
    <div className="st-callout-fold">
      <AdvancedFold
        panel="callout.sync"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testid={`callout-${kind}-fold`}
        buttonTestid={`callout-${kind}-fold-toggle`}
      >
        {rows.map((r) => (
          <div className="st-callout-row" key={r.id} data-testid={`callout-${kind}-row-${r.id}`}>
            <span>{r.k}</span>
            <span className="st-callout-mono">{r.v}</span>
          </div>
        ))}
        {waiting ? (
          <>
            <div className="st-callout-row st-callout-row--sub">
              <span>Waiting · {waiting.count}</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid={`callout-${kind}-copy`}
                onClick={() => copyList(waiting.files)}
              >
                Copy
              </button>
            </div>
            <div className="st-callout-files st-callout-mono">
              {waiting.files.map((f, i) => (
                <span key={f} data-testid={`callout-${kind}-file-${i}`}>
                  {f}
                </span>
              ))}
              {waiting.more > 0 ? <span>and {waiting.more} more</span> : null}
            </div>
          </>
        ) : null}
        {hint ? <p className="st-callout-hint">{hint}</p> : null}
      </AdvancedFold>
    </div>
  );
}

export function Callout({ item, onAction, onDismiss, busy = false }) {
  const { kind, tone, icon, title, detail, action, fold } = item;
  // The role sentence's own action ("Got it") IS its dismissal — no second control beside it.
  const closable = !!onDismiss && action?.id !== 'got-it';
  return (
    <div
      className={`st-callout st-callout--${tone}${fold ? ' st-callout--fold' : ''}`}
      role="status"
      aria-live="polite"
      data-testid={`callout-${kind}`}
      data-tone={tone}
    >
      <span className="st-callout-ic" aria-hidden="true">
        <StIcon name={icon} size={16} />
      </span>
      <span className="st-callout-t">
        {title}
        {detail ? <span>{detail}</span> : null}
      </span>
      {action ? (
        <button
          type="button"
          className="btn btn--sm btn--primary"
          data-testid={`callout-${kind}-action`}
          disabled={busy}
          onClick={() => onAction?.(item)}
        >
          {busy ? (action.busyLabel ?? 'Restarting…') : action.label}
        </button>
      ) : null}
      {closable ? (
        <button
          type="button"
          className="st-callout-x"
          aria-label="Dismiss"
          title="Dismiss"
          data-testid={`callout-${kind}-dismiss`}
          onClick={() => onDismiss(item)}
        >
          ×
        </button>
      ) : null}
      {fold ? <CalloutFold kind={kind} fold={fold} /> : null}
    </div>
  );
}

export function CalloutStack({ items = [], onAction, onDismiss, busyKey = null, children = null }) {
  return (
    <div className="st-callouts" data-testid="callouts">
      {children}
      {items.map((item) => (
        <Callout
          key={item.key}
          item={item}
          onAction={onAction}
          onDismiss={onDismiss}
          busy={busyKey === item.key}
        />
      ))}
    </div>
  );
}
