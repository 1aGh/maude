import { useEffect, useRef, useState } from 'react';
import { notify } from '../notifications.tsx';

/** Modal keyboard handling shared by the share and file-link decisions. */
export function useLinkDialogFocus(onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const el = ref.current;
    const controls = () => [...el.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)')];
    controls()[0]?.focus();
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = controls();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); previous?.focus?.(); };
  }, []);
  return ref;
}

export async function copyShareLink(value) {
  try {
    await navigator.clipboard.writeText(value);
    notify({ title: 'Link copied', kind: 'success' });
    return true;
  } catch {
    notify({ title: 'Could not copy link', description: 'Select the address and copy it manually.', kind: 'error' });
    return false;
  }
}

export function ShareDialog({ target, links, shell, onClose, Icon }) {
  const ref = useLinkDialogFocus(onClose);
  const [copied, setCopied] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (kind, value) => {
    if (await copyShareLink(value)) {
      setCopied(kind);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    }
  };
  return (
    <div className="st-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="st-dialog st-share-dialog" role="dialog" aria-modal="true" aria-label={`Share ${target.label}`} data-testid="share-dialog">
        <div className="st-dialog-hd">
          <span className="st-dialog-title">Share {target.label}</span>
          <button type="button" className="st-iconbtn" aria-label="Close share dialog" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>
        <div className="st-dialog-bd">
          <p className="st-share-path">{target.rel}</p>
          {!links.web && <p className="st-dialog-note">Connect this project to Maude Cloud to get a web link.</p>}
          {[
            ['web', 'Web link', links.web],
            ['app', 'Open in Maude app', links.app],
            ['local', 'Local link (this Mac only)', links.local],
          ].filter(([, , value]) => value).map(([kind, label, value]) => (
            <div key={kind} className="st-share-link">
              <label className="st-dialog-lbl" htmlFor={`share-${kind}-url`}>{label}</label>
              <div className="st-dialog-row">
                <input id={`share-${kind}-url`} data-testid={`share-${kind}-url`} readOnly value={value} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn--ghost" aria-label={`Copy ${label}`} data-testid={`share-copy-${kind}`} onClick={() => copy(kind, value)}>
                  <Icon name={copied === kind ? 'check' : 'link'} size={14} />{copied === kind ? 'Copied' : 'Copy'}
                </button>
              </div>
              {kind === 'app' && links.appIsLocalOnly && <p className="st-share-hint">Opens the folder on this Mac only.</p>}
              {kind === 'app' && shell !== 'native' && <a href={value} data-testid="share-open-app">Open in app</a>}
            </div>
          ))}
          {links.web && <p className="st-share-hint">People need access to this project to open the link.</p>}
        </div>
      </div>
    </div>
  );
}
