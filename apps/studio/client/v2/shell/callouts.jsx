// client/v2/shell/callouts.jsx — V2-4.8b: the callout stack (presentational).
//
// What the old top banners said, one plate each, ONE action at most (CONTRACT §4). The items come from
// callouts-model.js `calloutStack()`; `onAction(item)` runs the action, `onDismiss(item)` closes one.
// `children` is the slot for a persistent notice that is not dismissible and not derived from a payload
// (the format-gate strip, V2-1.12).

import { useEffect, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';

/** Is a modal dialog open anywhere in the document? (`aria-modal="true"` is what every sheet and dialog sets.) */
export function anyModalOpen(doc = globalThis.document) {
  return Boolean(doc?.querySelector?.('[aria-modal="true"]'));
}

/**
 * S11.18 (a11y): while a sheet or dialog is open the callouts behind it are `inert` — their buttons are not
 * tab stops, not clickable and not read out under the sheet (the Diagnostics sheet sits above the stack).
 */
function useModalOpen() {
  const [open, setOpen] = useState(() => anyModalOpen());
  useEffect(() => {
    const doc = globalThis.document;
    if (!doc?.body || typeof MutationObserver === 'undefined') return undefined;
    const look = () => setOpen(anyModalOpen(doc));
    look();
    const mo = new MutationObserver(look);
    mo.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal'],
    });
    return () => mo.disconnect();
  }, []);
  return open;
}

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
    <div className="sh-callout-fold">
      <AdvancedFold
        panel="callout.sync"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testid={`callout-${kind}-fold`}
        buttonTestid={`callout-${kind}-fold-toggle`}
      >
        {rows.map((r) => (
          <div className="sh-callout-row" key={r.id} data-testid={`callout-${kind}-row-${r.id}`}>
            <span>{r.k}</span>
            <span className="sh-callout-mono">{r.v}</span>
          </div>
        ))}
        {waiting ? (
          <>
            <div className="sh-callout-row sh-callout-row--sub">
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
            <div className="sh-callout-files sh-callout-mono">
              {waiting.files.map((f, i) => (
                <span key={f} data-testid={`callout-${kind}-file-${i}`}>
                  {f}
                </span>
              ))}
              {waiting.more > 0 ? <span>and {waiting.more} more</span> : null}
            </div>
          </>
        ) : null}
        {hint ? <p className="sh-callout-hint">{hint}</p> : null}
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
      className={`sh-callout sh-callout--${tone}${fold ? ' sh-callout--fold' : ''}`}
      role="status"
      aria-live="polite"
      data-testid={`callout-${kind}`}
      data-tone={tone}
    >
      <span className="sh-callout-ic" aria-hidden="true">
        <StIcon name={icon} size={16} />
      </span>
      <span className="sh-callout-t">
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
          className="sh-callout-x"
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
  const modalOpen = useModalOpen();
  return (
    <div className="sh-callouts" data-testid="callouts" inert={modalOpen}>
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
