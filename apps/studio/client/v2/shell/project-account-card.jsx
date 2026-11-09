// client/v2/shell/project-account-card.jsx — 2.1.1 T2/T4: the account chip, its menu, Switch account and
// its confirm sheet (canvas 17 Accounts and Connections · ac-states, ac-menu-broken, ac-menus, ac-switch).
//
// PRESENTATIONAL. Every word comes from project-account-model.js; the host (share-cluster-host.jsx) runs
// what a row asks for: a registry action (`onAction(id, params)`), the broken sign-in's one button
// (`onFix(fix)`), a switch (`onUse(row)`, after this sheet). A row exists only where its path does.

import { useEffect, useRef } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { onCanvasPointer } from './canvas-pointer.js';

/** The team-server glyph (the kit's server; the shell icon set has none). */
function ServerGlyph({ size = 13 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1.2" />
      <path d="M5 4.75h.01M5 11.25h.01" />
    </svg>
  );
}

/** The broken-link glyph — only for a sign-in the person can fix (canvas 17 `BrokenLink`). */
export function BrokenLinkGlyph({ size = 10 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.6 9.4 5.1 10.9a2.1 2.1 0 0 1-3-3l1.5-1.5" />
      <path d="M9.4 6.6 10.9 5.1a2.1 2.1 0 0 1 3 3l-1.5 1.5" />
      <path d="M5.2 1.8v1.6M1.8 5.2h1.6M10.8 14.2v-1.6M14.2 10.8h-1.6" />
    </svg>
  );
}

const Glyph = ({ name, size = 14 }) =>
  name === 'server' ? <ServerGlyph size={size} /> : <StIcon name={name} size={size} />;

/** An account's face: circle + letter (Maude Cloud), server tile (your server), laptop (this Mac only). */
export function AccountFace({ kind, initial = '', tone = 'grey', badge = null, size = 'md' }) {
  const ic = size === 'sm' ? 10 : 13;
  return (
    <span className={`sh-af sh-af--${size}`} data-kind={kind} data-badge={badge || undefined}>
      {kind === 'cloud' ? (
        <span
          className={`sh-acct-face sh-af-circle sh-af-circle--${size}`}
          data-tone={tone}
          aria-hidden="true"
        >
          {initial}
        </span>
      ) : (
        <span className="sh-af-tile" data-kind={kind} aria-hidden="true">
          <Glyph name={kind === 'server' ? 'server' : 'laptop'} size={ic} />
        </span>
      )}
      {badge === 'ring' ? (
        <svg className="sh-af-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="30 100"
          />
        </svg>
      ) : null}
      {badge === 'broken' || badge === 'warn' ? (
        <span
          className={`sh-af-badge sh-af-badge--${badge}`}
          data-testid="share-cluster-account-badge"
          data-badge={badge}
        >
          {badge === 'broken' ? <BrokenLinkGlyph size={8} /> : <StIcon name="problem" size={8} />}
        </span>
      ) : null}
    </span>
  );
}

/** The account chip, first in the Share cluster: face · where · chevron. Opens the account menu. */
export function AccountChip({ face, accountId = null, onOpen, opened = false }) {
  if (!face) return null;
  return (
    <div className="sh-acct">
      <button
        type="button"
        className={`sh-acct-chip${opened ? ' is-on' : ''}`}
        data-testid="share-cluster-account"
        data-account={accountId || undefined}
        data-kind={face.kind}
        data-conn={face.state}
        data-account-opener="true"
        aria-haspopup="menu"
        aria-expanded={opened ? 'true' : 'false'}
        aria-label={`Account: ${face.title}`}
        title={face.title}
        onClick={() => onOpen?.()}
      >
        <AccountFace kind={face.kind} initial={face.initial} tone={face.tone} badge={face.badge} />
        <span className="sh-acct-name">{face.label}</span>
        <StIcon name="chevron-down" size={12} />
      </button>
    </div>
  );
}

/**
 * The popover the menu sits in, under the Share cluster's start. Esc, a press outside and a press in the
 * canvas close it; a press on an opener (`data-account-opener`) is the opener's own toggle.
 */
export function ProjectAccountPopover({ open, onClose, children }) {
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (wrap.current?.contains(t)) return;
      if (t?.closest?.('[data-account-opener]')) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    const off = onCanvasPointer(() => onClose());
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      off();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sh-acct-card sh-pa-pop sh-am-pop" role="dialog" aria-label="Account" ref={wrap}>
      {children}
    </div>
  );
}

function Line({ icon, testid, children }) {
  return (
    <span className="sh-am-line" data-testid={testid}>
      <span className="sh-am-ic">{icon}</span>
      <span className="sh-am-txt">{children}</span>
    </span>
  );
}

function Row({ icon, label, testid, onClick, sub = false, keys = null, current = false }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="sh-acct-act sh-am-row"
      data-testid={testid}
      data-on={current ? 'true' : undefined}
      onClick={onClick}
    >
      <span className="sh-am-ic">{icon}</span>
      <span className="sh-am-lab">{label}</span>
      {keys ? <span className="sh-am-keys">{keys}</span> : null}
      {sub ? <StIcon name="submenu" size={12} /> : null}
    </button>
  );
}

/** The project block — name · where it lives · account · status; red with the fix when broken. */
function ProjectBlock({ menu, face, onFix }) {
  const { where, account, status, fix } = menu;
  return (
    <div
      className={`sh-am-pb${menu.bad ? ' sh-am-pb--bad' : ''}`}
      data-testid="account-menu-project"
      data-bad={menu.bad ? 'true' : undefined}
    >
      <strong className="sh-am-name">{menu.name}</strong>
      <Line
        icon={
          <Glyph
            name={where.kind === 'server' ? 'server' : where.kind === 'kept' ? 'sparkle' : 'folder'}
            size={13}
          />
        }
        testid="account-menu-where"
      >
        {where.text}
        {where.mono ? <span className="sh-am-mono"> {where.mono}</span> : null}
        {where.extra ? <span className="sh-am-q"> · {where.extra}</span> : null}
      </Line>
      <Line
        icon={
          <AccountFace kind={account.kind} initial={face?.initial} tone={face?.tone} size="sm" />
        }
        testid="account-menu-account"
      >
        {account.text}
        {account.sub ? <span className="sh-am-q"> · {account.sub}</span> : null}
      </Line>
      <Line
        icon={<span className="sh-am-dot" data-tone={status.tone} />}
        testid="account-menu-status"
      >
        <span className="sh-am-status" data-tone={status.tone}>
          {status.text}
        </span>
      </Line>
      {fix ? (
        <div className="sh-am-fix">
          <span className="sh-am-fixt">{fix.text}</span>
          <span className="sh-am-fixr">
            <span className="sh-am-addr" data-testid="account-menu-fix-address">
              <ServerGlyph size={12} />
              {fix.address}
            </span>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              data-testid="account-menu-fix"
              onClick={() => onFix?.(fix)}
            >
              {fix.label}
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Switch account — the accounts already on this Mac; the current one ticked; adding one is the foot. */
function SwitchList({ list, onPick, onAction, onBack }) {
  return (
    <div className="sh-am-sub" role="menu" data-testid="account-switch">
      <button type="button" className="sh-acct-act sh-am-back" onClick={onBack}>
        <StIcon name="chevron-down" size={12} />
        <span className="sh-am-gt">Use for this project</span>
      </button>
      {list.rows.map((r) => (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={r.current ? 'true' : 'false'}
          key={r.id}
          className="sh-acct-act sh-am-row sh-am-row--two"
          data-testid={`account-switch-row-${r.id}`}
          data-on={r.current ? 'true' : undefined}
          onClick={() => (r.current ? onBack() : onPick(r))}
        >
          <span className="sh-am-ic">{r.current ? <StIcon name="check" size={14} /> : null}</span>
          <AccountFace kind={r.kind} initial={r.initial} tone={r.tone} />
          <span className="sh-am-two">
            <strong>{r.title}</strong>
            <span>{r.sub}</span>
          </span>
        </button>
      ))}
      <hr className="sh-acct-sep" />
      {list.foot.map((f) => (
        <Row
          key={f.label}
          icon={<Glyph name={f.icon} size={14} />}
          label={f.label}
          testid={
            f.id === 'account.add-cloud'
              ? 'account-switch-add-cloud'
              : 'account-switch-custom-server'
          }
          onClick={() => onAction(f.id, f.params)}
        />
      ))}
    </div>
  );
}

/** The confirm sheet before a switch: which account, nothing moves, the way back. */
export function SwitchSheet({ sheet, busy = false, onCancel, onConfirm }) {
  if (!sheet) return null;
  return (
    <div
      className="sh-am-sheet"
      role="alertdialog"
      aria-label={sheet.title}
      data-testid="account-switch-sheet"
    >
      <strong className="sh-am-sheet-h">{sheet.title}</strong>
      {sheet.lines.map((l) => (
        <span key={l.icon} className="sh-am-conf">
          <StIcon name={l.icon} size={14} />
          <span>
            {l.text}
            {l.mono ? <span className="sh-am-mono">{l.mono}</span> : null}
            {l.strong ? <strong>{l.strong}</strong> : null}
            {l.after ?? null}
          </span>
        </span>
      ))}
      <span className="sh-acct-btns">
        <button
          type="button"
          className="btn btn--sm"
          data-testid="account-switch-sheet-cancel"
          onClick={onCancel}
        >
          {sheet.cancel}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          data-testid="account-switch-sheet-confirm"
          disabled={busy}
          onClick={onConfirm}
        >
          {sheet.primary}
        </button>
      </span>
    </div>
  );
}

/**
 * The avatar menu.
 * @param menu     accountMenu()
 * @param face     accountFace()
 * @param list     switchList()
 * @param view     'menu' | 'switch'
 * @param onView   (view) => void
 * @param onAction (id, params?) => void — a registry action, or 'show-in-finder' / 'retry'
 * @param onFix    (fix) => void — the broken sign-in's button
 * @param onPick   (row) => void — a Switch account row (the host asks with the sheet)
 */
export function ProjectAccountMenu({
  menu,
  face,
  list,
  view = 'menu',
  onView,
  onAction,
  onFix,
  onPick,
}) {
  if (!menu) return null;
  if (view === 'switch' && list && menu.switch === 'list')
    return (
      <SwitchList list={list} onPick={onPick} onAction={onAction} onBack={() => onView?.('menu')} />
    );
  return (
    <div className="sh-am" role="menu" data-testid="account-menu" data-state={face?.state}>
      <ProjectBlock menu={menu} face={face} onFix={onFix} />
      {menu.actions.length ? <hr className="sh-acct-sep" /> : null}
      {menu.actions.map((a) => (
        <Row
          key={a.id}
          icon={<Glyph name={a.icon} />}
          label={a.label}
          testid={`account-menu-action-${a.id}`}
          onClick={() => onAction(a.id)}
        />
      ))}
      {menu.switch ? (
        <>
          <hr className="sh-acct-sep" />
          <span className="sh-am-gt">Account</span>
          <Row
            icon={
              <AccountFace
                kind={face?.kind ?? 'local'}
                initial={face?.initial}
                tone={face?.tone}
                size="sm"
              />
            }
            label={menu.switch === 'list' ? 'Switch account' : 'Switch account…'}
            testid="account-menu-switch"
            sub={menu.switch === 'list'}
            onClick={() =>
              menu.switch === 'list' ? onView?.('switch') : onAction('account.switch')
            }
          />
        </>
      ) : null}
      <hr className="sh-acct-sep" />
      <Row
        icon={<StIcon name="sliders" size={14} />}
        label="Project settings…"
        keys="⌘,"
        testid="account-menu-settings"
        onClick={() => onAction('settings.open')}
      />
    </div>
  );
}
