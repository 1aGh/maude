// feature-before-first-external-users Task 2 — the first-upgrade consent
// dialog. `sharedDoc` / `syncFiles` / `propagateDeletes` all default ON, so a
// person who links (or upgrades into) a hub gets file mirroring and delete
// propagation without ever having said yes to either — the round-4 ADVOCATE
// finding. This asks ONCE per (hub, machine), the first time a sync payload
// for that hub arrives, and records the answer.
//
// Deliberately NOT inside the Sync panel: a consent that only appears if you
// happen to open a panel is not consent. It mounts with the global banners in
// app.jsx and renders over everything (st-dialog anatomy).
//
// The answer is machine-local (localStorage, like the notice acks) — consent
// is per human per machine, not a project setting to sync around. "Keep
// syncing" records acceptance and changes nothing; "Limit sync" turns
// `syncFiles` + `propagateDeletes` off through the same `/_api/sync/settings`
// route the panel's toggles use, so the limited state is inspectable and
// reversible in Settings, not a hidden third mode.

import { useCallback, useEffect, useState } from 'react';

const CONSENT_KEY = 'maude-sync-consent';

function readConsent(url) {
  try {
    const all = JSON.parse(localStorage.getItem(CONSENT_KEY) || '{}');
    const c = all[url];
    return c && typeof c === 'object' ? c : null;
  } catch {
    return null;
  }
}

function writeConsent(url, choice) {
  try {
    const all = JSON.parse(localStorage.getItem(CONSENT_KEY) || '{}');
    all[url] = { choice, at: Date.now() };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(all));
  } catch {
    /* private mode — the dialog will simply ask again next boot */
  }
}

/** Loopback hubs (local dev, a cell's own hub) are consent-by-configuration —
 *  nothing leaves the machine, and nagging every dev boot trains people to
 *  click through the one dialog that matters. Mirrors isLoopbackHubUrl. */
function isLoopback(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '::1' || /^127\./.test(h) || h === '[::1]';
  } catch {
    return false;
  }
}

export default function SyncConsentDialog({ status, cloud }) {
  const url = typeof status?.url === 'string' ? status.url : null;
  // `answered` only forces the re-render after a click — the record itself
  // lives in localStorage so a reload cannot re-ask.
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // Never on a cell (a member browsing someone's hosted project is not the
  // machine whose files sync), never for loopback, never before sync speaks.
  const due = !cloud && url && !isLoopback(url) && !answered && !readConsent(url);

  // The dialog steals the screen, so say so to assistive tech the same way
  // the other modals do — but only while actually shown.
  useEffect(() => {
    if (!due) return undefined;
    const onKey = (e) => {
      // No Escape-to-dismiss: an unanswered consent must not be dismissable
      // into the accepted-by-silence state. Tab stays inside via the two
      // buttons being the only tabbables in the sheet.
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [due]);

  const accept = useCallback(() => {
    if (url) writeConsent(url, 'accepted');
    setAnswered(true);
  }, [url]);

  const limit = useCallback(async () => {
    setBusy(true);
    setNote('');
    let ok = false;
    try {
      const res = await fetch('/_api/sync/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncFiles: false, propagateDeletes: false }),
      });
      const json = await res.json().catch(() => null);
      ok = json?.ok === true;
      if (!ok) setNote(json?.detail || 'The limited mode could not be saved — try again.');
    } catch {
      setNote('Maude could not reach the sync service — try again.');
    }
    setBusy(false);
    if (ok) {
      if (url) writeConsent(url, 'limited');
      setAnswered(true);
    }
  }, [url]);

  if (!due) return null;

  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep the raw string */
  }

  return (
    <div className="st-scrim" data-testid="sync-consent">
      <div
        className="st-dialog st-consent"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-consent-title"
      >
        <div className="st-dialog-hd">
          <span className="st-dialog-title" id="sync-consent-title">
            This project syncs with {host}
          </span>
        </div>
        <div className="st-dialog-bd">
          <p>Since your last update, syncing covers more than canvases. With this workspace:</p>
          <ul className="st-consent-list">
            <li>
              <strong>The whole design folder mirrors both ways</strong> — stylesheets, docs and
              code modules, not only canvases.
            </li>
            <li>
              <strong>Deleting a file here deletes it there</strong> (and the other way round).
              Replaced copies are kept in the Sync panel's Trash, and bulk removals pause for
              confirmation.
            </li>
            {status?.sharedDoc && (
              <li>
                <strong>Your live editing buffer is the shared object</strong> — edits stream to the
                workspace as you type, not as saved copies.
              </li>
            )}
          </ul>
          <p className="st-consent-fine">
            You can change either choice any time in the Sync panel's Settings. Only sync with
            workspaces you operate or trust.
          </p>
          {note && (
            <p className="st-consent-note" role="status" aria-live="polite">
              {note}
            </p>
          )}
        </div>
        <div className="st-dialog-ft">
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="sync-consent-limit"
            disabled={busy}
            onClick={limit}
          >
            {busy ? 'Saving…' : 'Sync canvases only'}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="sync-consent-accept"
            disabled={busy}
            onClick={accept}
          >
            Keep syncing everything
          </button>
        </div>
      </div>
    </div>
  );
}
