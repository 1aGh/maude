// client/v2/settings/settings-card.jsx — 2.1.1 T6: one Settings card (canvas 17 `SCard`), the same in
// General, Connections and Advanced. Lifted from the Connections row (connection-row.jsx), made expandable:
//
//   ┌──────────────────────────────────────────────────────────────────────────┐
//   │ (ic)  Title  extra                                     [Sign in again]  › │
//   │       one line that says what it is                                       │
//   │       ● the status line — what is set                                     │
//   ├── open: the rows, then its own › Advanced fold ───────────────────────────┤
//   └──────────────────────────────────────────────────────────────────────────┘
//
// The header is one button (Enter / Space toggle it, `aria-expanded`, the kit focus ring); the action sits
// beside it, outside the button, so a one-click fix stays visible on a CLOSED card. The body stays mounted
// while closed (`hidden`) — a model download's poll and a half-typed field survive a fold — and ⌘K can
// still find a row inside it: the sheet opens the card that holds the hit (settings-cards.js).

import { useEffect, useRef } from 'react';

import { StIcon } from '../../shell/icons.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';

/** The status dot + words (canvas 17 `StatusWord`): a word with a dot, never hue alone. */
export function StatusLine({ sw, children, testid }) {
  return (
    <span className="v2s-card-s" data-sw={sw || undefined} data-testid={testid}>
      {sw ? <i className="v2s-dot" aria-hidden="true" /> : null}
      <span className="v2s-card-s-t">{children}</span>
    </span>
  );
}

/** One "k · value" row inside an open card (canvas 17 `Row`): label left, value, then its button. */
export function CardRow({ k, children, action, testid }) {
  return (
    <div className="v2s-card-row" data-testid={testid}>
      <span className="v2s-card-row-k">{k}</span>
      <span className="v2s-card-row-v">{children}</span>
      {action ? <span className="v2s-card-row-a">{action}</span> : null}
    </div>
  );
}

export function SettingsCard({
  id,
  icon,
  /** A node in place of the icon glyph (This project's coloured square). */
  iconNode,
  title,
  /** Words after the title, quieter ("This project  Brand site"). */
  titleExtra,
  desc,
  summary,
  /** The status dot: ok · busy · off · error · warn; absent = a plain line. */
  sw,
  /** A broken sign-in: the status line reads in the error ink. */
  bad = false,
  action,
  open,
  onToggle,
  testid,
  /** The card's inner fold: `{ panel, label?, hint?, testid?, body }`. */
  fold,
  /** Scroll the card into view once (⌘K opened it). */
  reveal = false,
  /** The landmark's name when the title is not plain words. */
  label,
  /** The status line's hook (Connections keeps S11.14's `settings-conn-<row>-status`). */
  summaryTestid,
  children,
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (reveal && open) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [reveal, open]);
  const bodyId = `v2s-card-${id}-b`;
  const headId = `v2s-card-${id}-h`;
  return (
    <section
      ref={ref}
      className={bad ? 'v2s-card v2s-card--bad' : 'v2s-card'}
      data-open={open ? 'true' : undefined}
      data-card={id}
      aria-label={`${label ?? (typeof title === 'string' ? title : id)} settings`}
      data-testid={testid ?? `settings-card-${id}`}
    >
      <div className="v2s-card-r">
        <button
          type="button"
          id={headId}
          className="v2s-card-h"
          aria-expanded={!!open}
          aria-controls={bodyId}
          onClick={() => onToggle?.(id)}
          data-testid={`settings-card-${id}-toggle`}
        >
          <span className={iconNode ? 'v2s-card-ic v2s-card-ic--bare' : 'v2s-card-ic'} aria-hidden="true">
            {iconNode ?? <StIcon name={icon} size={16} />}
          </span>
          <span className="v2s-card-t">
            <strong className="v2s-card-tt">
              {title}
              {titleExtra ? <span className="v2s-card-q">{titleExtra}</span> : null}
            </strong>
            {desc ? <span className="v2s-card-d">{desc}</span> : null}
            {summary !== undefined && summary !== null ? (
              <StatusLine sw={sw} testid={summaryTestid ?? `settings-card-${id}-summary`}>
                {summary}
              </StatusLine>
            ) : null}
          </span>
        </button>
        {action ? <span className="v2s-card-a">{action}</span> : null}
        {/* the chevron is the header's too (a pointer target, not a second stop for the keyboard) */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the header button beside it is the keyboard's control */}
        <span className="v2s-card-ch" aria-hidden="true" onClick={() => onToggle?.(id)}>
          <StIcon name="submenu" size={14} />
        </span>
      </div>
      <div
        id={bodyId}
        className="v2s-card-b"
        hidden={!open}
        data-testid={`settings-card-${id}-body`}
      >
        {children}
        {fold ? (
          <div className="v2s-card-fold">
            <AdvancedFold
              panel={fold.panel}
              label={fold.label ?? 'Advanced'}
              hint={fold.hint}
              testid={fold.testid}
            >
              {fold.body}
            </AdvancedFold>
          </div>
        ) : null}
      </div>
    </section>
  );
}
