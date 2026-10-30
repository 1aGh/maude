// client/v2/signin/WhatsNewLine.jsx — the one quiet line on Home after an update, and the list it opens
// (02 Onboarding ob-edge-whats-new, S6.8). Never a modal on its own: the dialog opens only from
// "See what's new". Menu › Help › What's new stays the other way in (project tabs).

import { useEffect } from 'react';

export function WhatsNewLine({ entry, onOpen, onDismiss }) {
  return (
    <p className="si-new" data-testid="home-whatsnew-line">
      <i className="si-new-dot" aria-hidden="true" />
      <span className="si-new-t">What's new — {entry.title}</span>
      <button type="button" className="si-link" data-testid="home-whatsnew-open" onClick={onOpen}>
        See what's new
      </button>
      <button
        type="button"
        className="si-new-x"
        data-testid="home-whatsnew-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </p>
  );
}

export function WhatsNewDialog({ entries, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="home-link-modal" role="dialog" aria-modal="true" aria-label="What's new">
      <div className="home-link-scrim" aria-hidden="true" onClick={onClose} />
      <div className="island home-link-dialog si-new-dialog" data-testid="home-whatsnew-dialog">
        <h2>What's new</h2>
        <ul className="si-new-list">
          {entries.map((e) => (
            <li key={e.id}>
              <strong>{e.title}</strong>
              {e.summary ? <span>{e.summary}</span> : null}
            </li>
          ))}
        </ul>
        <div className="home-link-foot">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="home-whatsnew-close"
            // biome-ignore lint/a11y/noAutofocus: the dialog opens for this one button
            autoFocus
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
