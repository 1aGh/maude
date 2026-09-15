import { useEffect, useState } from 'react';
import { openLocalProject, resolveProjectForLink, openCloudUrl } from '../github.js';
import { encodeOpenPath } from '../share-link.js';
import { copyShareLink, useLinkDialogFocus } from '../share-dialog.jsx';

/** The project zone is configured locally; file links never supply an origin. */
export function fileProjectWebUrl(project, rel, cloudUrl) {
  try {
    const base = new URL(cloudUrl);
    if (base.protocol !== 'https:' || base.port || base.username || base.password || /^[\d.]+$/.test(base.hostname) || !base.hostname.includes('.')) return null;
    return `https://${project}.${base.hostname}/?open=${encodeOpenPath(rel)}`;
  } catch { return null; }
}

export default function FileDeepLinkDialog({ pending, local, cloudUrl, onClose }) {
  const ref = useLinkDialogFocus(onClose);
  const [resolution, setResolution] = useState({ loading: true, path: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    resolveProjectForLink(pending.project).then((path) => {
      if (!cancelled) setResolution({ loading: false, path });
    }).catch(() => { if (!cancelled) { setResolution({ loading: false, path: null }); setError('Could not look up local projects.'); } });
    return () => { cancelled = true; };
  }, [pending.project]);
  const web = fileProjectWebUrl(pending.project, pending.rel, cloudUrl);
  const open = async () => {
    setBusy(true); setError('');
    try { await openLocalProject(resolution.path, pending.rel); onClose(); }
    catch (err) { setError(String(err)); setBusy(false); }
  };
  return (
    <div className="gi-modal" role="dialog" aria-modal="true" aria-label={`Open file in ${pending.project}`}>
      <div className="gi-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={ref} className="gi-dialog gi-dialog--code" data-testid="file-deeplink-dialog">
        <div className="gi-dc-head"><h2>Open {pending.rel} in {pending.project}?</h2></div>
        <p className="gi-dl-what">You are working in {local.project || 'the open project'}.</p>
        {resolution.loading ? <p>Looking for this project…</p> : resolution.path ? <p>{resolution.path}</p> : <p>{pending.project} isn’t on this Mac.</p>}
        {error && <p role="alert">{error}</p>}
        {!resolution.loading && !resolution.path && web && (
          <div className="gi-dl-note">
            <a href={web} onClick={(e) => { e.preventDefault(); openCloudUrl(web).catch(() => setError('Could not open this address automatically. Copy the web link into your browser.')); }}>Open in browser</a>
            <button type="button" className="btn btn--ghost" onClick={() => copyShareLink(web)}>Copy web link</button>
          </div>
        )}
        <div className="gi-dc-foot">
          <button type="button" className="btn btn--ghost" data-testid="file-deeplink-dismiss" onClick={onClose}>Not now</button>
          {resolution.path && <button type="button" className="btn" disabled={busy} data-testid="file-deeplink-open" onClick={open}>{busy ? 'Opening…' : 'Open project'}</button>}
        </div>
      </div>
    </div>
  );
}
