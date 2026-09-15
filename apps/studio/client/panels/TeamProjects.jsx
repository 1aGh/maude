// Team projects — plan T22 (feature-reliable-project-multiplayer).
//
// The designer's way in: pick a project you were added to and work. No folder
// to choose, no Git, no token to paste. Three sources, one action:
//
//   • Recent team projects — the copies this computer already keeps
//     (`managed_projects_list`); opening one needs no network.
//   • Maude Cloud — sign in with the same device flow CloudBar uses, then the
//     projects your account belongs to. Viewers get the browser, not a dead
//     Open (the workspace would refuse their edits).
//   • Your team's server — its address plus the email and password the team
//     gave you (the self-hosted hub's own sign-in).
//
// Every path ends in `openTeamProject` / `managedProjectOpen`: the studio holds
// the credential and describes the project, the shell creates or reuses the
// project's own copy and switches to it. The webview never picks a path.
//
// Rendered as an onboarding door (`variant="door"`) and as a dialog from the
// project switcher (`variant="dialog"`); same content, different frame.

import { useEffect, useRef, useState } from 'react';

import { isDisplayableUrl, openExternal, shareViewUrl } from './CloudBar.jsx';
import { managedProjectOpen, managedProjectsList, openTeamProject } from '../github.js';

const api = async (path, init) => {
  try {
    const res = await fetch(path, init);
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: { error: 'Maude isn’t reachable right now.' } };
  }
};

function Icon({ name, size = 16, className }) {
  const p = {
    check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
    'arrow-right': (<><line x1="2.5" y1="8" x2="13" y2="8" /><polyline points="9 4 13 8 9 12" /></>),
    folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
    server: (<><rect x="2.5" y="3" width="11" height="4" rx="1" /><rect x="2.5" y="9" width="11" height="4" rx="1" /><circle cx="5" cy="5" r="0.5" fill="currentColor" /><circle cx="5" cy="11" r="0.5" fill="currentColor" /></>),
    globe: (<><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.7 1.5 2.6 3.5 2.6 5.5S9.7 12.5 8 13.5C6.3 12 5.4 10 5.4 8S6.3 3.5 8 2.5z" /></>),
    x: (<><line x1="3.5" y1="3.5" x2="12.5" y2="12.5" /><line x1="12.5" y1="3.5" x2="3.5" y2="12.5" /></>),
    external: (<><path d="M6 3.5H3.2A.7.7 0 0 0 2.5 4.2v8.6a.7.7 0 0 0 .7.7h8.6a.7.7 0 0 0 .7-.7V10" /><line x1="8" y1="8" x2="13" y2="3" /><polyline points="9.5 3 13 3 13 6.5" /></>),
    copy: (<><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" /><path d="M3 10.5V3.2A.7.7 0 0 1 3.7 2.5H10" /></>),
    spinner: <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8" />,
    key: (<><circle cx="5" cy="5" r="2.6" /><path d="M6.9 6.9 13 13M11 11l1.4-1.4M9.2 9.2l1.6-1.6" /></>),
    user: (<><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" /></>),
  }[name];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p}
    </svg>
  );
}

function Spark({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" />
    </svg>
  );
}

/** "https://acme.cloud.maude.sh" → "acme.cloud.maude.sh" — display only. */
export function serverLabel(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || '');
  }
}

function ErrorLine({ text }) {
  if (!text) return null;
  return (
    <div className="callout callout--error ob-callout" role="alert" data-testid="team-error">
      <span className="ob-callout-glyph" style={{ color: 'var(--status-error)' }}><Icon name="x" /></span>
      <span>{text}</span>
    </div>
  );
}

export default function TeamProjects({ variant = 'door' }) {
  const [recents, setRecents] = useState(null);
  const [cloud, setCloud] = useState({ state: 'loading', email: null, url: 'https://cloud.maude.sh' });
  const [projects, setProjects] = useState(null);
  const [device, setDevice] = useState(null);
  const [copied, setCopied] = useState(false);
  const [hub, setHub] = useState({ url: '', email: '', password: '' });
  const [busy, setBusy] = useState(''); // the key of whatever is opening
  const [opening, setOpening] = useState(''); // display name once the switch started
  const [err, setErr] = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    managedProjectsList()
      .then((r) => alive && setRecents(Array.isArray(r) ? r : []))
      .catch(() => alive && setRecents([]));
    api('/_api/cloud/status').then((r) => {
      if (!alive) return;
      const url = r.json?.url || 'https://cloud.maude.sh';
      if (r.ok && r.json?.connected) {
        setCloud({ state: 'in', email: r.json.email ?? null, url });
        loadProjects();
      } else setCloud({ state: 'out', email: null, url });
    });
    return () => {
      alive = false;
      clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProjects() {
    setProjects(null);
    const r = await api('/_api/cloud/projects');
    if (r.status === 401) {
      setCloud((c) => ({ ...c, state: 'out', email: null }));
      setProjects([]);
      return;
    }
    setProjects(r.ok && r.json?.ok ? r.json.projects || [] : []);
    if (!r.ok) setErr(r.json?.error || 'Your Maude Cloud projects could not be listed.');
  }

  async function startCloudSignIn() {
    setErr('');
    const r = await api('/_api/cloud/signin/start', { method: 'POST' });
    if (!r.ok || !r.json?.ok) {
      setErr(r.json?.error || 'Maude Cloud could not be reached.');
      return;
    }
    setDevice(r.json);
    openExternal(r.json.verificationUrl);
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const p = await api('/_api/cloud/signin/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode: r.json.deviceCode }),
      });
      if (p.json?.pending) return;
      clearInterval(pollRef.current);
      setDevice(null);
      if (p.ok && p.json?.ok) {
        setCloud((c) => ({ ...c, state: 'in', email: p.json.email ?? null }));
        loadProjects();
      } else setErr(p.json?.error || 'The sign-in did not finish. Try again.');
    }, (r.json.interval ?? 5) * 1000);
  }

  function cancelCloudSignIn() {
    clearInterval(pollRef.current);
    setDevice(null);
  }

  async function run(key, name, fn) {
    if (busy) return;
    setErr('');
    setBusy(key);
    const r = await fn();
    if (r.ok) {
      // The shell is switching; the window reloads onto the project. Keep the
      // row busy so a second click can't start another open meanwhile.
      setOpening(name);
      return;
    }
    setBusy('');
    setErr(r.error || 'The project could not be opened.');
  }

  const openRecent = (p) =>
    run(`recent:${p.key}`, p.name, async () => {
      try {
        await managedProjectOpen({ serverUrl: p.server_url, projectId: p.project_id, name: p.name, canvasGroups: [] });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    });

  const openCloud = (p) =>
    run(`cloud:${p.id}`, p.name || p.id, () => openTeamProject({ kind: 'cloud', projectId: p.id }));

  const openHub = () =>
    run('hub', serverLabel(hub.url), () =>
      openTeamProject({ kind: 'hub', url: hub.url.trim(), email: hub.email.trim(), password: hub.password })
    );

  const canHub = hub.url.trim() && hub.email.trim() && hub.password;

  return (
    <div className={`tp tp--${variant}`} data-testid="team-projects">
      {opening && (
        <div className="callout callout--info ob-callout" role="status" aria-live="polite" data-testid="team-opening">
          <span className="ob-callout-glyph"><Icon name="spinner" size={15} className="ob-spin" /></span>
          <span>Opening <b>{opening}</b>… your canvases arrive as they download.</span>
        </div>
      )}

      {recents && recents.length > 0 && (
        <section className="tp-section" aria-label="Recent team projects">
          <div className="ob-section-label">On this computer</div>
          <div className="ob-repolist">
            {recents.map((p) => {
              const k = `recent:${p.key}`;
              return (
                <button type="button" key={p.key} className="ob-repo" disabled={!!busy} onClick={() => openRecent(p)} data-testid={`team-recent-${p.key}`}>
                  <span className="ob-repo-icon"><Icon name="folder" size={15} /></span>
                  <span className="ob-repo-tx">
                    <span className="ob-repo-name">{p.name}</span>
                    <span className="ob-repo-meta">{serverLabel(p.server_url)}</span>
                  </span>
                  <span className="ob-repo-go">{busy === k ? <Icon name="spinner" size={16} className="ob-spin" /> : <><Icon name="arrow-right" size={15} /> Open</>}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="tp-section" aria-label="Maude Cloud">
        <div className="ob-section-label">Maude Cloud</div>
        {cloud.state === 'loading' && <div className="ob-foot-note">Checking your sign-in…</div>}
        {cloud.state === 'out' && !device && (
          <button type="button" className="ob-repo" onClick={startCloudSignIn} data-testid="team-cloud-signin">
            <span className="ob-repo-icon"><Spark size={15} /></span>
            <span className="ob-repo-tx">
              <span className="ob-repo-name">Sign in to Maude Cloud</span>
              <span className="ob-repo-meta">See the projects you were invited to</span>
            </span>
            <span className="ob-repo-go"><Icon name="arrow-right" size={15} /> Sign in</span>
          </button>
        )}
        {device && (
          <div className="tp-device" data-testid="team-cloud-device">
            <span className="ob-field-label">Confirm this code on your Maude Cloud dashboard</span>
            <div className="gi-code">
              <span className="gi-code-val" data-testid="team-cloud-code">{device.userCode}</span>
              <button
                type="button"
                className="btn btn--ghost gi-code-copy"
                onClick={() => navigator.clipboard?.writeText(device.userCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}
                aria-label="Copy the code"
              >
                <Icon name="copy" size={15} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {device.verificationUrl && isDisplayableUrl(device.verificationUrl, cloud.url) && (
              <span className="ob-foot-note">
                If your browser didn’t open, go to <span className="gi-dc-url">{device.verificationUrl}</span>
              </span>
            )}
            <div className="ob-form-actions">
              <span className="gi-dc-status" aria-live="polite"><span className="gi-pulse" aria-hidden="true" /> Waiting for you to confirm…</span>
              <button type="button" className="btn btn--ghost" onClick={cancelCloudSignIn}>Cancel</button>
            </div>
          </div>
        )}
        {cloud.state === 'in' && (
          <>
            {projects === null && <div className="ob-foot-note">Loading your projects…</div>}
            {Array.isArray(projects) && projects.length === 0 && (
              <div className="ob-foot-note" data-testid="team-cloud-empty">
                You aren’t in any project yet. Ask whoever runs your team’s project to invite {cloud.email || 'you'}.
              </div>
            )}
            {Array.isArray(projects) && projects.length > 0 && (
              <div className="ob-repolist">
                {projects.map((p) => {
                  const k = `cloud:${p.id}`;
                  if (p.role === 'viewer') {
                    return (
                      <button type="button" key={p.id} className="ob-repo" onClick={() => openExternal(shareViewUrl(p.url, p.id))} data-testid={`team-cloud-project-${p.id}`} title="Viewing works in the browser. Editing in the app needs the member role — ask whoever runs the project.">
                        <span className="ob-repo-icon"><Icon name="globe" size={15} /></span>
                        <span className="ob-repo-tx">
                          <span className="ob-repo-name">{p.name || p.id}</span>
                          <span className="ob-repo-meta">viewer · opens in your browser</span>
                        </span>
                        <span className="ob-repo-go"><Icon name="external" size={15} /> View</span>
                      </button>
                    );
                  }
                  return (
                    <button type="button" key={p.id} className="ob-repo" disabled={!!busy} onClick={() => openCloud(p)} data-testid={`team-cloud-project-${p.id}`}>
                      <span className="ob-repo-icon"><Spark size={15} /></span>
                      <span className="ob-repo-tx">
                        <span className="ob-repo-name">{p.name || p.id}</span>
                        <span className="ob-repo-meta">{p.role}{p.stateLabel ? ` · ${p.stateLabel}` : ''}</span>
                      </span>
                      <span className="ob-repo-go">{busy === k ? <Icon name="spinner" size={16} className="ob-spin" /> : <><Icon name="arrow-right" size={15} /> Open</>}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="tp-section" aria-label="Your team's server">
        <div className="ob-section-label">Your team’s own server</div>
        <form
          className="ob-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canHub && !busy) openHub();
          }}
        >
          <label className="ob-field">
            <span className="ob-field-label">Server address</span>
            <span className="ob-field-wrap"><Icon name="server" size={14} className="ob-field-pre" />
              <input className="input ob-input" type="url" inputMode="url" autoComplete="url" value={hub.url} placeholder="https://design.yourteam.com" aria-label="Server address" data-testid="team-hub-url" onChange={(e) => setHub((h) => ({ ...h, url: e.target.value }))} />
            </span>
          </label>
          <label className="ob-field">
            <span className="ob-field-label">Email</span>
            <span className="ob-field-wrap"><Icon name="user" size={14} className="ob-field-pre" />
              <input className="input ob-input" type="email" autoComplete="username" value={hub.email} placeholder="you@yourteam.com" aria-label="Email" data-testid="team-hub-email" onChange={(e) => setHub((h) => ({ ...h, email: e.target.value }))} />
            </span>
          </label>
          <label className="ob-field">
            <span className="ob-field-label">Password</span>
            <span className="ob-field-wrap"><Icon name="key" size={14} className="ob-field-pre" />
              <input className="input ob-input" type="password" autoComplete="current-password" value={hub.password} aria-label="Password" data-testid="team-hub-password" onChange={(e) => setHub((h) => ({ ...h, password: e.target.value }))} />
            </span>
          </label>
          <div className="ob-form-actions">
            <button type="submit" className="btn btn--primary" disabled={!canHub || !!busy} data-testid="team-hub-open">
              {busy === 'hub' ? <><Icon name="spinner" size={15} className="ob-spin" /> Signing in…</> : <><Icon name="arrow-right" size={15} /> Sign in and open</>}
            </button>
          </div>
        </form>
      </section>

      <ErrorLine text={err} />
      <p className="ob-foot-note">Maude keeps the project’s copy on this computer and saves every change to your team as you work.</p>
    </div>
  );
}

/** The same picker as a dialog — from the project switcher. */
export function TeamProjectsDialog({ onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('button, input')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="gi-modal" role="dialog" aria-modal="true" aria-labelledby="tp-dialog-title">
      <div className="gi-scrim" aria-hidden="true" onClick={onClose} />
      <div className="gi-dialog tp-dialog" ref={ref} data-testid="team-projects-dialog">
        <div className="tp-dialog-head">
          <div>
            <h2 id="tp-dialog-title">Open a team project</h2>
            <p>Projects you were added to open in their own copy on this computer.</p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close" data-testid="team-projects-close">
            <Icon name="x" size={14} />
          </button>
        </div>
        <TeamProjects variant="dialog" />
      </div>
    </div>
  );
}
