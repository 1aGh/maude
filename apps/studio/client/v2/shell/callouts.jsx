// client/v2/shell/callouts.jsx — V2-4.8b: the callout stack (presentational).
//
// What the old top banners said, one plate each, ONE action at most (CONTRACT §4). The items come from
// callouts-model.js `calloutStack()`; `onAction(item)` runs the action, `onDismiss(item)` closes one.
// `children` is the slot for a persistent notice that is not dismissible and not derived from a payload
// (the format-gate strip, V2-1.12).

import { StIcon } from '../../shell/icons.jsx';

export function Callout({ item, onAction, onDismiss, busy = false }) {
  const { kind, tone, icon, title, detail, action } = item;
  // The role sentence's own action ("Got it") IS its dismissal — no second control beside it.
  const closable = !!onDismiss && action?.id !== 'got-it';
  return (
    <div
      className={`st-callout st-callout--${tone}`}
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
          {busy ? 'Restarting…' : action.label}
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
