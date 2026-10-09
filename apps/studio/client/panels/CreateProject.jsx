// Phase 28 (epic E3) Task 6 — start / pull / share a project.
//
// Opened from the IdentityBar account menu. Three views, all in the shell maude DS
// dialog treatment (solid var(--bg-1) surface + .st-dialog scrim — NOT the canvas
// `.panel`; inputs use the DS .input/.textarea recipe defined in 3-shell-maude.css):
//   • new   — name + Private(default)/Public + description → POST create-repo.
//   • get   — "Pull a local copy": pick one of your GitHub projects, choose WHERE on
//             disk to save it, clone it, and open it. Distinct from File ▸ Open
//             Project (a folder you already have). A pulled repo with no Maude
//             design system yet shows a clear "set it up" message (never a crash).
//   • share — invite a teammate by GitHub username → POST invite.

import { useEffect, useState } from 'react';

import {
  cloneRepo,
  createLocalProject,
  createProject,
  initDesign,
  invite,
  listRepos,
  openLocalProject,
  pickDirectory,
} from '../github.js';

function Icon({ name, size = 16 }) {
  const p = {
    lock: (
      <>
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
        <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
      </>
    ),
    globe: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M2.5 8h11M8 2.5c1.7 1.5 2.6 3.5 2.6 5.5S9.7 12.5 8 13.5C6.3 12 5.4 10 5.4 8S6.3 3.5 8 2.5z" />
      </>
    ),
    x: (
      <>
        <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
        <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
      </>
    ),
    check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
    plus: (
      <>
        <line x1="8" y1="3" x2="8" y2="13" />
        <line x1="3" y1="8" x2="13" y2="8" />
      </>
    ),
    invite: (
      <>
        <circle cx="6" cy="5.5" r="2.5" />
        <path d="M2 13.5a4 4 0 0 1 8 0" />
        <line x1="13" y1="5" x2="13" y2="9" />
        <line x1="11" y1="7" x2="15" y2="7" />
      </>
    ),
    download: (
      <>
        <line x1="8" y1="2.5" x2="8" y2="10" />
        <polyline points="4.5 7 8 10.5 11.5 7" />
        <polyline points="3 12.8 3 13.6 13 13.6 13 12.8" />
      </>
    ),
    spinner: <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8" />,
    laptop: (
      <>
        <rect x="3" y="3.5" width="10" height="7" rx="1" />
        <path d="M1.5 13h13l-1.2-1.8H2.7z" />
      </>
    ),
  }[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={name === 'spinner' ? 'cp-spin' : undefined}
    >
      {p}
    </svg>
  );
}

const TITLES = {
  new: ['Create a new project', 'On GitHub, or just locally on your computer.'],
  get: ['Pull a local copy', 'Pick a project, choose where to save it, and open it here.'],
  share: ['Share this project', 'Invite a teammate by their GitHub username.'],
};

export default function CreateProject({ view, identity, signedIn, onClose }) {
  const [title, sub] = TITLES[view] || TITLES.new;
  return (
    <div
      className="cp-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="cp-scrim" aria-hidden="true" onClick={onClose} />
      <div className="cp-dialog">
        <div className="cp-dialog-hd">
          <span className="cp-dialog-titles">
            <h2>{title}</h2>
            <p>{sub}</p>
          </span>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        {view === 'new' && <NewView identity={identity} signedIn={signedIn} onClose={onClose} />}
        {view === 'get' && <GetView />}
        {view === 'share' && <ShareView onClose={onClose} />}
      </div>
    </div>
  );
}

function NewView({ identity, signedIn, onClose }) {
  const [name, setName] = useState('');
  // 'github' = new repo on GitHub (needs sign-in); 'local' = just a local git repo,
  // no remote. Default to local when signed out (GitHub isn't available then).
  const [where, setWhere] = useState(signedIn ? 'github' : 'local');
  const [isPrivate, setIsPrivate] = useState(true);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');

  const local = where === 'local';
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const owner = identity?.login || 'you';

  // New project = a ready-to-design local project, then open it. GitHub mode also
  // creates the remote repo + sets origin; local mode is git init only (publish later).
  // You pick where to save it, then design and Publish when ready.
  async function submit() {
    setErr('');
    setBusy(true);
    try {
      setStep('Choose where to save it…');
      const parentDir = await pickDirectory();
      if (!parentDir) {
        setBusy(false);
        setStep('');
        return;
      } // cancelled
      let r;
      if (local) {
        setStep('Setting up your local project…');
        r = await createLocalProject({ name, parentDir });
      } else {
        setStep('Creating your project on GitHub…');
        r = await createProject({ name, private: isPrivate, description: desc, parentDir });
      }
      if (!(r.ok && r.json?.ok)) {
        setErr(r.json?.error || 'Couldn’t create the project. Try again.');
        setBusy(false);
        setStep('');
        return;
      }
      setStep('Opening it in Maude…');
      await openLocalProject(r.json.path); // switches the app to the new project
    } catch (e) {
      setErr(String(e?.message || e || 'Something went wrong creating the project.'));
      setBusy(false);
      setStep('');
    }
  }

  return (
    <>
      <div className="cp-body">
        <div className="cp-field">
          <span className="cp-field-label">Where</span>
          <div className="seg cp-seg" role="group" aria-label="Where to create the project">
            <button
              type="button"
              aria-pressed={!local}
              disabled={!signedIn}
              title={signedIn ? undefined : 'Sign in with GitHub first'}
              onClick={() => setWhere('github')}
            >
              <Icon name="globe" size={14} /> GitHub
            </button>
            <button type="button" aria-pressed={local} onClick={() => setWhere('local')}>
              <Icon name="laptop" size={14} /> This computer only
            </button>
          </div>
          <span className="cp-field-help">
            {local
              ? 'A local git repo on your computer — no GitHub, no remote. You can publish it later.'
              : signedIn
                ? 'A repo on your GitHub account, cloned to your computer.'
                : 'Sign in with GitHub (bottom-left) to publish. For now you can create a local project.'}
          </span>
        </div>
        <label className="cp-field">
          <span className="cp-field-label">Project name</span>
          <input
            className="input cp-input"
            type="text"
            value={name}
            placeholder="Acme Rebrand"
            aria-label="Project name"
            onChange={(e) => setName(e.target.value)}
          />
          {slug && (
            <span className="cp-field-help">
              {local ? (
                <>
                  Creates a project folder <b>{slug}</b>
                </>
              ) : (
                <>
                  Creates{' '}
                  <b>
                    github.com/{owner}/{slug}
                  </b>
                </>
              )}
            </span>
          )}
        </label>
        {!local && (
          <>
            <div className="cp-field">
              <span className="cp-field-label">Who can see it</span>
              <div className="seg cp-seg" role="group" aria-label="Project visibility">
                <button type="button" aria-pressed={isPrivate} onClick={() => setIsPrivate(true)}>
                  <Icon name="lock" size={14} /> Private
                </button>
                <button type="button" aria-pressed={!isPrivate} onClick={() => setIsPrivate(false)}>
                  <Icon name="globe" size={14} /> Public
                </button>
              </div>
              <span className="cp-field-help">
                {isPrivate
                  ? 'Only you and people you invite. The safe default.'
                  : 'Anyone on the internet can see this project.'}
              </span>
            </div>
            <label className="cp-field">
              <span className="cp-field-label">
                Description <span className="cp-optional">optional</span>
              </span>
              <textarea
                className="textarea cp-textarea"
                rows={2}
                value={desc}
                placeholder="What is this project for?"
                aria-label="Project description"
                onChange={(e) => setDesc(e.target.value)}
              />
            </label>
          </>
        )}
        {err && (
          <div className="callout callout--error">
            <span className="cp-cl-glyph" style={{ color: 'var(--status-error)' }}>
              <Icon name="x" />
            </span>
            <span>{err}</span>
          </div>
        )}
      </div>
      <div className="cp-ft">
        <span className="cp-spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={submit}
          disabled={busy || !slug}
        >
          <Icon name="plus" size={15} />{' '}
          {busy ? step || 'Creating…' : local ? 'Create local project' : 'Create project'}
        </button>
      </div>
    </>
  );
}

// "Pull a local copy" — pick a repo, choose a disk folder, clone, open.
function GetView() {
  const [repos, setRepos] = useState(null);
  const [err, setErr] = useState('');
  const [pulling, setPulling] = useState(null); // full_name being pulled
  const [step, setStep] = useState(''); // human progress line
  const [needsSetup, setNeedsSetup] = useState(null); // { name, path } when the pulled repo has no .design
  const [settingUp, setSettingUp] = useState(false);

  // The pulled repo has no Maude design system yet — scaffold a bootable one into
  // the clone, then open it (the user can create a real DS with /design:setup-ds).
  async function setupHere() {
    if (!needsSetup) return;
    setErr('');
    setSettingUp(true);
    try {
      const r = await initDesign(needsSetup.path);
      if (!(r.ok && r.json?.ok)) {
        setErr(r.json?.error || 'Couldn’t set it up. Try again.');
        setSettingUp(false);
        return;
      }
      await openLocalProject(needsSetup.path); // switches the app to the new project
    } catch (e) {
      setErr(String(e?.message || e || 'Couldn’t set it up.'));
      setSettingUp(false);
    }
  }

  useEffect(() => {
    (async () => {
      const r = await listRepos();
      if (r.ok && r.json?.ok) setRepos(r.json.repos || []);
      else {
        setErr(r.json?.error || 'Couldn’t load your projects.');
        setRepos([]);
      }
    })();
  }, []);

  async function pull(repo) {
    setErr('');
    setNeedsSetup(null);
    setPulling(repo.full_name);
    try {
      setStep('Choose a folder to save it in…');
      const parentDir = await pickDirectory();
      if (!parentDir) {
        setPulling(null);
        setStep('');
        return;
      } // cancelled
      setStep('Downloading your project…');
      const r = await cloneRepo({ cloneUrl: repo.clone_url, parentDir, name: repo.name });
      if (!(r.ok && r.json?.ok)) {
        setErr(r.json?.error || 'Couldn’t download the project. Try again.');
        setPulling(null);
        setStep('');
        return;
      }
      if (r.json.hasDesign === false) {
        // Empty / non-Maude repo — DON'T switch (the dev-server can't serve a project
        // with no .design). Tell the user how to set it up instead of crashing.
        setNeedsSetup({ name: repo.name, path: r.json.path });
        setPulling(null);
        setStep('');
        return;
      }
      setStep('Opening it in Maude…');
      await openLocalProject(r.json.path); // switches the app to the clone
    } catch (e) {
      setErr(String(e?.message || e || 'Something went wrong pulling the project.'));
      setPulling(null);
      setStep('');
    }
  }

  if (needsSetup) {
    return (
      <>
        <div className="cp-body">
          <div className="callout callout--info">
            <span className="cp-cl-glyph" style={{ color: 'var(--status-info)' }}>
              <Icon name="download" />
            </span>
            <span>
              <b style={{ color: 'var(--fg-0)' }}>
                Got “{needsSetup.name}” — it’s not a Maude project yet.
              </b>{' '}
              Saved to <b>{needsSetup.path}</b>. Set up Maude in it to start designing (you can
              build a design system after).
            </span>
          </div>
          {err && (
            <div className="callout callout--error">
              <span className="cp-cl-glyph" style={{ color: 'var(--status-error)' }}>
                <Icon name="x" />
              </span>
              <span>{err}</span>
            </div>
          )}
        </div>
        <div className="cp-ft">
          <span className="cp-spacer" />
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setNeedsSetup(null)}
            disabled={settingUp}
          >
            Not now
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={setupHere}
            disabled={settingUp}
          >
            <Icon name="download" size={15} /> {settingUp ? 'Setting up…' : 'Set up Maude here'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="cp-body cp-body--list">
      {err && (
        <div className="callout callout--error">
          <span className="cp-cl-glyph" style={{ color: 'var(--status-error)' }}>
            <Icon name="x" />
          </span>
          <span>{err}</span>
        </div>
      )}
      {repos === null && <div className="cp-field-help">Loading your projects…</div>}
      {repos && repos.length === 0 && !err && (
        <div className="cp-field-help">No projects yet — create one to get started.</div>
      )}
      {repos && repos.length > 0 && (
        <div className="cp-repolist" role="group" aria-label="Your projects">
          {repos.map((r) => {
            const isPulling = pulling === r.full_name;
            return (
              <button
                key={r.full_name}
                type="button"
                className={'cp-repo' + (isPulling ? ' is-busy' : '')}
                disabled={!!pulling}
                onClick={() => pull(r)}
              >
                <Icon name={r.private ? 'lock' : 'globe'} size={14} />
                <span className="cp-repo-tx">
                  <span className="cp-repo-name">{r.name}</span>
                  <span className="cp-repo-meta">
                    {isPulling
                      ? step || 'Working…'
                      : `${r.owner} · updated ${new Date(r.updated_at).toLocaleDateString()}`}
                  </span>
                </span>
                <span className="cp-repo-go">
                  {isPulling ? (
                    <Icon name="spinner" size={15} />
                  ) : (
                    <Icon name="download" size={15} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="cp-field-help">
        Pulls a fresh copy from GitHub to a folder you choose, then opens it. To open a folder you
        already have, use <b>File ▸ Open Project</b>.
      </div>
    </div>
  );
}

function ShareView({ onClose }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [invited, setInvited] = useState(null);

  async function submit() {
    setErr('');
    setBusy(true);
    const r = await invite(username);
    setBusy(false);
    if (r.ok && r.json?.ok) setInvited(r.json.username);
    else setErr(r.json?.error || 'Couldn’t send the invite. Try again.');
  }

  return (
    <>
      <div className="cp-body">
        <div className="cp-invite">
          <span className="cp-invite-at" aria-hidden="true">
            @
          </span>
          <input
            className="input cp-invite-input"
            type="text"
            value={username}
            placeholder="github-username"
            aria-label="GitHub username to invite"
            onChange={(e) => setUsername(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary cp-invite-btn"
            onClick={submit}
            disabled={busy || !username.trim()}
          >
            <Icon name="invite" size={15} /> {busy ? 'Inviting…' : 'Invite'}
          </button>
        </div>
        {invited && (
          <div className="callout callout--success">
            <span className="cp-cl-glyph" style={{ color: 'var(--status-success)' }}>
              <Icon name="check" />
            </span>
            <span>
              <b style={{ color: 'var(--fg-0)' }}>Invited @{invited}.</b> They’ll get a GitHub email
              and can open this project once they accept.
            </span>
          </div>
        )}
        {err && (
          <div className="callout callout--error">
            <span className="cp-cl-glyph" style={{ color: 'var(--status-error)' }}>
              <Icon name="x" />
            </span>
            <span>{err}</span>
          </div>
        )}
      </div>
      <div className="cp-ft">
        <span className="cp-spacer" />
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
