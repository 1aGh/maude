// client/v2/ds/library-card.jsx — S10.18c: a linked team library, drawn (13 · ds-many-library, ds-many-linked).
//
//   DsLibraryCard     "Team library · <hub>", "Used by 3 projects", "3 updates waiting" + Update… / Unlink — in the
//                     inspector's empty place on the linked system's Design system canvas
//   DsLibraryDialog   "Update from <system>? 3 changes" — what the library changed; the next step is this project's
//                     own review (the existing DsReviewSheet), where each canvas has a tick
//   DsLibraryBanner   "Linked from <home>." · "View only here — every update arrives as a review." · Open in <home>
//   DsLibraryLink     "Link a team library" — the library link (and its access key when it came with one)
//
// These only draw. The host (library-host.jsx) reads the state, asks the hub through the server, and does the
// writes. Every name, label, host and summary here came from a peer or a hub: shown as text, never as markup, and
// never an e-mail address (library-model.js).

import { useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { changeLines, LIBRARY_WORDS } from './library-model.js';
import { useDsLibraryStore } from './library-store.js';

/** @param {{ value: any, actions: any }} props */
export function DsLibraryCard({ value, actions }) {
  const m = value?.model;
  if (!m) return null;
  const busy = !!value.busy;
  const a = actions ?? {};
  return (
    <section
      className="dsl"
      data-testid="ds-library-card"
      data-system={m.ds}
      data-waiting={m.waiting ? 'true' : 'false'}
      aria-label={m.kind}
    >
      <p className="dsl-kind" data-testid="ds-library-kind">
        <StIcon name="cloud" size={12} />
        <span>{m.kind}</span>
      </p>
      <p className="dsl-name" data-testid="ds-library-name">
        {m.label}
      </p>
      {m.usedBy ? (
        <p className="dsl-line" data-testid="ds-library-used">
          {m.usedBy}
        </p>
      ) : null}
      <p
        className={`dsl-line dsl-wait${m.waiting && !m.noGrant ? ' is-waiting' : ''}`}
        data-testid="ds-library-waiting"
      >
        {m.waiting && !m.noGrant ? <span className="ds-upd-dot" aria-hidden="true" /> : null}
        {m.line}
      </p>
      {m.noGrantLine ? (
        <p className="dsl-quiet" data-testid="ds-library-nogrant">
          {m.noGrantLine}
        </p>
      ) : null}
      {m.relinkLine ? (
        <p className="dsl-quiet" data-testid="ds-library-relink-line">
          {m.relinkLine}
        </p>
      ) : null}
      {m.error || value.note ? (
        <p className="dsl-note" role="status" data-testid="ds-library-note">
          {value.note || m.error}
        </p>
      ) : null}
      <span className="dsl-acts">
        {m.canUpdate ? (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={busy}
            data-testid="ds-library-update"
            onClick={() => a.update?.()}
          >
            {LIBRARY_WORDS.update}…
          </button>
        ) : null}
        {m.relink ? (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={busy}
            data-testid="ds-library-relink"
            onClick={() => a.relink?.()}
          >
            {LIBRARY_WORDS.linkAgain}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={busy}
          data-testid="ds-library-unlink"
          onClick={() => a.unlink?.()}
        >
          {LIBRARY_WORDS.unlink}…
        </button>
      </span>
    </section>
  );
}

/** For the inspector's empty place: the card of the open linked system, or null. */
export function useDsLibraryCard() {
  const { value, actions } = useDsLibraryStore();
  return value?.model ? <DsLibraryCard value={value} actions={actions} /> : null;
}

/** The card as a component (its own hook, so a caller may sit after an early return). */
export function DsLibrarySlot() {
  return useDsLibraryCard();
}

/** @param {{ title: string, lines: ReturnType<typeof changeLines>, fine: string, onUpdate: () => Promise<any> | any, onClose: () => void, error?: string }} props */
export function DsLibraryDialog({ title, lines, fine, onUpdate, onClose, error = '' }) {
  const [busy, setBusy] = useState(false);
  const primaryRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: primaryRef });
  const shown = lines.slice(0, 8);
  return (
    <div className="dsr-scrim" data-testid="ds-library-scrim">
      <div
        ref={ref}
        className="island dsr-dialog dsl-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-library-title"
        tabIndex={-1}
        data-testid="ds-library-dialog"
      >
        <h2 id="ds-library-title" className="dsr-title" data-testid="ds-library-title">
          {title}
        </h2>
        <div className="dsr-body">
          <div className="dsl-changes" data-testid="ds-library-changes">
            {shown.map((c) => (
              <span key={c.key} className="dsl-change" data-testid="ds-library-change">
                <b>{c.name}</b> <span>{c.text}</span>
              </span>
            ))}
            {lines.length > shown.length ? (
              <span className="dsl-change dsl-more" data-testid="ds-library-more">
                and {lines.length - shown.length} more
              </span>
            ) : null}
          </div>
          <p className="dsr-fine" data-testid="ds-library-fine">
            {fine}
          </p>
          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-library-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button type="button" className="btn" data-testid="ds-library-cancel" onClick={onClose}>
            {LIBRARY_WORDS.cancel}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="btn btn--primary"
            disabled={busy}
            data-testid="ds-library-go"
            onClick={async () => {
              setBusy(true);
              try {
                await onUpdate();
              } finally {
                setBusy(false);
              }
            }}
          >
            {LIBRARY_WORDS.update}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Unlink <system>?" — the copy becomes an ordinary local system of this project. */
export function DsLibraryUnlink({ label, onUnlink, onClose, error = '' }) {
  const [busy, setBusy] = useState(false);
  const primaryRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: primaryRef });
  return (
    <div className="dsr-scrim" data-testid="ds-library-unlink-scrim">
      <div
        ref={ref}
        className="island dsr-dialog dsl-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-library-unlink-title"
        tabIndex={-1}
        data-testid="ds-library-unlink-ask"
      >
        <h2 id="ds-library-unlink-title" className="dsr-title">
          Unlink {label}?
        </h2>
        <div className="dsr-body">
          <p className="dsr-fine">{LIBRARY_WORDS.unlinkFine}</p>
          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-library-unlink-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            type="button"
            className="btn"
            data-testid="ds-library-unlink-cancel"
            onClick={onClose}
          >
            {LIBRARY_WORDS.cancel}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="btn btn--primary"
            disabled={busy}
            data-testid="ds-library-unlink-go"
            onClick={async () => {
              setBusy(true);
              try {
                await onUnlink();
              } finally {
                setBusy(false);
              }
            }}
          >
            {LIBRARY_WORDS.unlink}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The banner on a linked system's canvas. `canOpen`: the home's address is one this app may open. */
export function DsLibraryBanner({ banner, canOpen, onOpen }) {
  if (!banner) return null;
  return (
    <div
      className="dsl-banner island"
      role="status"
      data-testid="ds-library-banner"
      data-ds={banner.ds}
    >
      <StIcon name="cloud" size={14} />
      <span className="dsl-banner-t">
        <b data-testid="ds-library-banner-title">{banner.title}</b>
        <em data-testid="ds-library-banner-sub">{banner.sub}</em>
      </span>
      {canOpen ? (
        <button
          type="button"
          className="btn btn--sm"
          data-testid="ds-library-open"
          onClick={onOpen}
        >
          {banner.action}
        </button>
      ) : null}
    </div>
  );
}

/** @param {{ onLink: (url: string, grant: string) => Promise<{ ok: boolean, message?: string }>, onClose: () => void }} props */
export function DsLibraryLink({ onLink, onClose }) {
  const [url, setUrl] = useState('');
  const [grant, setGrant] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urlRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: urlRef });
  const go = async () => {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError('');
    let r;
    try {
      r = await onLink(url.trim(), grant.trim());
    } catch {
      r = { ok: false, message: LIBRARY_WORDS.failed };
    }
    setBusy(false);
    if (r?.ok === false) setError(r.message || LIBRARY_WORDS.failed);
  };
  return (
    <div className="dsr-scrim" data-testid="ds-library-link-scrim">
      <div
        ref={ref}
        className="island dsr-dialog dsl-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-library-link-title"
        tabIndex={-1}
        data-testid="ds-library-link"
      >
        <h2 id="ds-library-link-title" className="dsr-title">
          {LIBRARY_WORDS.linkTitle}
        </h2>
        <div className="dsr-body">
          <p className="dsl-quiet">{LIBRARY_WORDS.linkLead}</p>
          <label className="dsl-field">
            <span>{LIBRARY_WORDS.linkUrl}</span>
            <input
              ref={urlRef}
              className="dsl-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              data-testid="ds-library-link-url"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') go();
              }}
            />
          </label>
          <label className="dsl-field">
            <span>
              {LIBRARY_WORDS.linkGrant} <em>{LIBRARY_WORDS.linkGrantHint}</em>
            </span>
            <input
              className="dsl-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={grant}
              data-testid="ds-library-link-grant"
              onChange={(e) => setGrant(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') go();
              }}
            />
          </label>
          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-library-link-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            type="button"
            className="btn"
            data-testid="ds-library-link-cancel"
            onClick={onClose}
          >
            {LIBRARY_WORDS.cancel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !url.trim()}
            data-testid="ds-library-link-go"
            onClick={go}
          >
            {LIBRARY_WORDS.link}
          </button>
        </div>
      </div>
    </div>
  );
}
