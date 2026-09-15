// Phase 29 (epic E4) Task 3 — the first-run onboarding wizard.
//
// Mounts full-screen on first launch (app.jsx checks `app_is_first_run` via the
// Tauri shell) OVER the empty welcome project the sidecar boots. Four doors,
// GitHub first: (A) Continue with GitHub — sign in (device flow) → open a shared
// project or start a new one; (T) Open a project you were invited to — Maude
// Cloud or a team server's email/password, opened as a managed copy with no
// folder to choose (plan T22); (B) Open a folder on this computer; (C) Connect to
// a team hub with a token (advanced). Every door ends by switching the sidecar to a real project
// (`open_local_project`), which reloads the webview — at which point first-run is
// false and the wizard no longer mounts. Built 1:1 with `.design/ui/Onboarding.tsx`;
// CSS (`ob-*`) lives in client/styles/3-shell-maude.css. Renders nothing outside the
// native app (no Tauri → no first-run concept).

import { useEffect, useRef, useState } from 'react';

import ReadinessList, { useReadiness } from './ReadinessList.jsx';
import IntroVideoDialog from './IntroVideoDialog.jsx';
import TeamProjects from './TeamProjects.jsx';
import {
  cloneRepo,
  createProject,
  fetchIdentity,
  getCrashReporting,
  hubLink,
  initDesign,
  isNativeApp,
  isSignedIn,
  listRepos,
  onDeviceCode,
  openLocalProject,
  openVerification,
  pickDirectory,
  setCrashReporting,
  signIn,
} from '../github.js';

function Icon({ name, size = 16, className }) {
  const p = {
    check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
    'arrow-right': (<><line x1="2.5" y1="8" x2="13" y2="8" /><polyline points="9 4 13 8 9 12" /></>),
    'chevron-right': <polyline points="6 3.5 10.5 8 6 12.5" />,
    'chevron-down': <polyline points="3.5 6 8 10.5 12.5 6" />,
    folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
    'folder-open': (<><path d="M2 4.5h4l1.3 1.5H14" /><path d="M2 6h12.5l-1.4 7H3.4z" /></>),
    lock: (<><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></>),
    globe: (<><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.7 1.5 2.6 3.5 2.6 5.5S9.7 12.5 8 13.5C6.3 12 5.4 10 5.4 8S6.3 3.5 8 2.5z" /></>),
    plus: (<><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></>),
    download: (<><line x1="8" y1="2.5" x2="8" y2="10" /><polyline points="4.5 7 8 10.5 11.5 7" /><polyline points="3 12.8 3 13.6 13 13.6 13 12.8" /></>),
    link: (<><path d="M6.5 9.5 9.5 6.5" /><path d="M7 4.5 8.4 3.1a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2" /><path d="M9 11.5 7.6 12.9a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" /></>),
    key: (<><circle cx="5" cy="5" r="2.6" /><path d="M6.9 6.9 13 13M11 11l1.4-1.4M9.2 9.2l1.6-1.6" /></>),
    server: (<><rect x="2.5" y="3" width="11" height="4" rx="1" /><rect x="2.5" y="9" width="11" height="4" rx="1" /><circle cx="5" cy="5" r="0.5" fill="currentColor" /><circle cx="5" cy="11" r="0.5" fill="currentColor" /></>),
    x: (<><line x1="3.5" y1="3.5" x2="12.5" y2="12.5" /><line x1="12.5" y1="3.5" x2="3.5" y2="12.5" /></>),
    copy: (<><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" /><path d="M3 10.5V3.2A.7.7 0 0 1 3.7 2.5H10" /></>),
    external: (<><path d="M6 3.5H3.2A.7.7 0 0 0 2.5 4.2v8.6a.7.7 0 0 0 .7.7h8.6a.7.7 0 0 0 .7-.7V10" /><line x1="8" y1="8" x2="13" y2="3" /><polyline points="9.5 3 13 3 13 6.5" /></>),
    back: <polyline points="10 3.5 5.5 8 10 12.5" />,
    spinner: <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8" />,
    play: <polygon points="5 3.2 12.8 8 5 12.8" fill="currentColor" stroke="none" />,
  }[name];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p}
    </svg>
  );
}

function GitHubMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// The maude mark — the canonical spark-on-bubble tile (source of truth:
// system/maude/preview/logo.tsx + logo.css `.lg-mark`): a four-point star in
// --accent-fg on the one indigo, bottom-right corner squared (a message bubble),
// with the in-app accent-tint halo. NOT a hand-drawn glyph.
function Mark({ size = 30 }) {
  return (
    <span className="ob-mark" style={{ width: size, height: size }} role="img" aria-label="maude">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" />
      </svg>
    </span>
  );
}

function Rail({ signedInAs }) {
  return (
    <aside className="ob-rail">
      <div className="ob-rail-brand">
        <Mark size={30} />
        <span className="ob-rail-wordmark">maude</span>
      </div>
      <div className="ob-rail-lede">
        <p className="ob-rail-h">Design together.<br />No setup, no terminal.</p>
        <p>Open Maude, and you're in a real project in under two minutes — sharing canvases with your team as you go.</p>
      </div>
      {signedInAs ? (
        <div className="ob-rail-signed">
          <span className="ob-rail-signed-dot" aria-hidden="true" />
          <span>Signed in as <b>@{signedInAs}</b></span>
        </div>
      ) : (
        <ul className="ob-rail-reassure">
          <li><span className="ob-rail-tick" aria-hidden="true"><Icon name="check" size={12} /></span>Sign in once — Maude remembers you</li>
          <li><span className="ob-rail-tick" aria-hidden="true"><Icon name="check" size={12} /></span>Your work saves on its own</li>
          <li><span className="ob-rail-tick" aria-hidden="true"><Icon name="check" size={12} /></span>Invite anyone by their name</li>
        </ul>
      )}
      <div className="ob-rail-foot">You can change any of this later.</div>
    </aside>
  );
}

// Opt-in crash reporting (Phase 32 / Task 4). Default OFF — the box starts
// unchecked and only writes a local crash log when the user explicitly ticks it.
// Nothing leaves the machine (local-file backend; no third party, no network).
function CrashOptIn() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    getCrashReporting()
      .then((v) => {
        if (alive) setOn(!!v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <label className="ob-crash-optin">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          setCrashReporting(next).catch(() => setOn(!next));
        }}
      />
      <span>
        Send crash reports to help improve Maude. Optional — a crash writes a local log
        (stack trace + OS + version, no file contents) you can attach to an issue.
      </span>
    </label>
  );
}

// AI-editing readiness (Phase 33 / DDR-128). NON-BLOCKING: the bundled core
// (canvas browser, version history, sharing) works with zero install, so this is a
// quiet, collapsible strip — never a gate. It surfaces what AI editing additionally
// needs (a paired Claude Code with the maude plugins + the `maude` CLI) so a missing
// piece is visible instead of a silent no-op when the user later types /design:edit.
// Stays silent until the probe answers (endpoint unreachable → render nothing).
function AiReadiness() {
  const { report, loading, refresh } = useReadiness();
  if (!report) return null;
  const ready = report.ready;
  return (
    <details className="ob-readiness">
      <summary className="ob-readiness-sum">
        <span className={`ob-readiness-dot ob-readiness-dot--${ready ? 'ok' : 'warn'}`} aria-hidden="true" />
        <span className="ob-readiness-lede">
          {ready ? 'AI editing is ready' : 'AI editing needs a couple of things'}
        </span>
        <span className="ob-readiness-hint">
          {ready ? 'optional — view details' : 'optional · the rest of Maude works without it'}
        </span>
      </summary>
      <div className="ob-readiness-body">
        <p className="ob-readiness-note">
          Everything else — the canvas browser, version history, sharing — works right now. AI
          editing additionally pairs with a Claude Code you already have installed and runs on your
          own Pro/Max subscription.
        </p>
        <ReadinessList report={report} loading={loading} refresh={refresh} />
      </div>
    </details>
  );
}

// ── A · Welcome (door picker) ────────────────────────────────────────────────
function Welcome({ onGithub, onLocal, onHub, onTeam, signing, signedIn, identity }) {
  const [introOpen, setIntroOpen] = useState(false);
  return (
    <main className="ob-main">
      <header className="ob-head">
        <span className="ob-eyebrow">Welcome</span>
        <h1>How would you like to start?</h1>
        <p>{signedIn ? `You're signed in as @${identity?.login || 'GitHub'}. Open a project, or start a new one.` : "Most people sign in with GitHub — it's the simplest way to work with a team."}</p>
        <button
          type="button"
          data-testid="onboarding-watch-intro"
          className="ob-watch-intro"
          onClick={() => setIntroOpen(true)}
        >
          <Icon name="play" size={13} /> Watch the intro
        </button>
      </header>
      <IntroVideoDialog open={introOpen} onClose={() => setIntroOpen(false)} />
      <div className="ob-doors">
        <button type="button" data-testid="ob-door-github" className="ob-door ob-door--primary" aria-label="Continue with GitHub — recommended" onClick={onGithub} disabled={signing}>
          <span className="ob-door-icon ob-door-icon--gh"><GitHubMark size={26} /></span>
          <span className="ob-door-tx">
            <span className="ob-door-title">Continue with GitHub<span className="ob-door-tag">Recommended</span></span>
            <span className="ob-door-sub">Start a shared project, or open one a teammate shared with you.</span>
          </span>
          <span className="ob-door-cta">
            <span className="btn btn--primary ob-door-btn"><GitHubMark size={15} /> {signing ? 'Starting…' : signedIn ? 'Continue' : 'Sign in with GitHub'}</span>
          </span>
        </button>
        {/* Plan T22 — a designer who was added to a project picks it and works:
            no folder, no Git, no token. */}
        <button type="button" data-testid="ob-door-team" className="ob-door" aria-label="Open a project you were invited to" onClick={onTeam}>
          <span className="ob-door-icon"><Icon name="link" size={22} /></span>
          <span className="ob-door-tx">
            <span className="ob-door-title">Open a project you were invited to</span>
            <span className="ob-door-sub">Sign in to Maude Cloud or your team’s server, pick the project, and start designing.</span>
          </span>
          <span className="ob-door-go" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
        </button>
        <button type="button" data-testid="ob-door-local" className="ob-door" aria-label="Open a folder on this computer" onClick={onLocal}>
          <span className="ob-door-icon"><Icon name="folder-open" size={22} /></span>
          <span className="ob-door-tx">
            <span className="ob-door-title">Open a folder on this computer</span>
            <span className="ob-door-sub">Already have a project folder? Open it and keep designing.</span>
          </span>
          <span className="ob-door-go" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
        </button>
        <button type="button" data-testid="ob-door-hub" className="ob-door ob-door--advanced" aria-label="Connect to a team hub — advanced" onClick={onHub}>
          <span className="ob-door-icon ob-door-icon--quiet"><Icon name="server" size={18} /></span>
          <span className="ob-door-tx">
            <span className="ob-door-title">Connect to a team hub <span className="ob-door-adv">Advanced</span></span>
            <span className="ob-door-sub">Your team runs its own Maude hub? Paste the link they gave you.</span>
          </span>
          <span className="ob-door-go" aria-hidden="true"><Icon name="chevron-right" size={15} /></span>
        </button>
      </div>
      <p className="ob-foot-note">Browse, version, and collaborate — all in the app, no terminal.</p>
      <AiReadiness />
      <CrashOptIn />
    </main>
  );
}

function BackBar({ onBack }) {
  return (
    <button type="button" data-testid="ob-back" className="ob-back" onClick={onBack}>
      <Icon name="back" size={14} /> Back
    </button>
  );
}

// ── B · GitHub door (pick or create) ─────────────────────────────────────────
function GitHubDoor({ identity, onBack }) {
  const [repos, setRepos] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await listRepos();
      if (r.ok && r.json?.ok) setRepos(r.json.repos || []);
      else { setErr(r.json?.error || "Couldn't load your projects."); setRepos([]); }
    })();
  }, []);

  async function open(repo) {
    setErr(''); setBusy(repo.full_name);
    try {
      const parentDir = await pickDirectory();
      if (!parentDir) { setBusy(''); return; }
      const r = await cloneRepo({ cloneUrl: repo.clone_url, parentDir, name: repo.name });
      if (!(r.ok && r.json?.ok)) { setErr(r.json?.error || "Couldn't open that project."); setBusy(''); return; }
      if (r.json.hasDesign === false) {
        const init = await initDesign(r.json.path);
        if (!(init.ok && init.json?.ok)) { setErr(init.json?.error || "Couldn't set it up."); setBusy(''); return; }
      }
      await openLocalProject(r.json.path); // switches the sidecar → webview reloads
    } catch (e) {
      setErr(String(e?.message || e || 'Something went wrong opening the project.'));
      setBusy('');
    }
  }

  if (creating) return <CreateInline identity={identity} onBack={() => setCreating(false)} />;

  return (
    <main className="ob-main">
      <BackBar onBack={onBack} />
      <header className="ob-head">
        <span className="ob-eyebrow">You're signed in</span>
        <h1>Open a project, or start a new one</h1>
        <p>Pick up a shared project below, or create a fresh one — it's private until you invite someone.</p>
      </header>
      <button type="button" data-testid="ob-github-create" className="ob-create" aria-label="Start a new project" onClick={() => setCreating(true)}>
        <span className="ob-create-icon"><Icon name="plus" size={20} /></span>
        <span className="ob-create-tx">
          <span className="ob-create-title">Start a new project</span>
          <span className="ob-create-sub">A blank, private project — you choose where it lives.</span>
        </span>
        <span className="btn btn--primary ob-create-btn"><Icon name="arrow-right" size={15} /> Create</span>
      </button>
      <div className="ob-section-label">Your projects</div>
      {err && <div className="callout callout--error ob-callout"><span className="ob-callout-glyph" style={{ color: 'var(--status-error)' }}><Icon name="x" /></span><span>{err}</span></div>}
      {repos === null && <div className="ob-foot-note">Loading your projects…</div>}
      {repos && repos.length === 0 && !err && <div className="ob-foot-note">No projects yet — create one to get started.</div>}
      {repos && repos.length > 0 && (
        <div className="ob-repolist" role="group" aria-label="Projects you can open">
          {repos.map((r) => {
            const isBusy = busy === r.full_name;
            return (
              <button type="button" className="ob-repo" key={r.full_name} disabled={!!busy} onClick={() => open(r)}>
                <span className="ob-repo-icon"><Icon name={r.private ? 'lock' : 'globe'} size={15} /></span>
                <span className="ob-repo-tx">
                  <span className="ob-repo-name">{r.name}</span>
                  <span className="ob-repo-meta">{isBusy ? 'Opening…' : `${r.owner} · updated ${new Date(r.updated_at).toLocaleDateString()}`}</span>
                </span>
                <span className="ob-repo-go">{isBusy ? <Icon name="spinner" size={16} className="ob-spin" /> : <><Icon name="download" size={16} /> Open</>}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="ob-foot-note">Opening a project saves a copy on this computer and keeps it in sync.</p>
    </main>
  );
}

function CreateInline({ identity, onBack }) {
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const owner = identity?.login || 'you';

  async function submit() {
    setErr(''); setBusy(true);
    try {
      setStep('Choose where to save it…');
      const parentDir = await pickDirectory();
      if (!parentDir) { setBusy(false); setStep(''); return; }
      setStep('Creating your project on GitHub…');
      const r = await createProject({ name, private: isPrivate, parentDir });
      if (!(r.ok && r.json?.ok)) { setErr(r.json?.error || "Couldn't create the project."); setBusy(false); setStep(''); return; }
      setStep('Opening it in Maude…');
      await openLocalProject(r.json.path);
    } catch (e) {
      setErr(String(e?.message || e || 'Something went wrong creating the project.'));
      setBusy(false); setStep('');
    }
  }

  return (
    <main className="ob-main">
      <BackBar onBack={onBack} />
      <header className="ob-head">
        <span className="ob-eyebrow">New project</span>
        <h1>Start a new project</h1>
        <p>A private project, set up for you. You can invite people whenever you're ready.</p>
      </header>
      <div className="ob-form">
        <label className="ob-field">
          <span className="ob-field-label">Project name</span>
          <input className="input ob-input" type="text" value={name} placeholder="Acme Rebrand" aria-label="Project name" onChange={(e) => setName(e.target.value)} />
          {slug && <span className="ob-foot-note">Creates <b>github.com/{owner}/{slug}</b></span>}
        </label>
        <div className="ob-field">
          <span className="ob-field-label">Who can see it</span>
          <div className="seg" role="group" aria-label="Project visibility">
            <button type="button" aria-pressed={isPrivate} onClick={() => setIsPrivate(true)}><Icon name="lock" size={14} /> Private</button>
            <button type="button" aria-pressed={!isPrivate} onClick={() => setIsPrivate(false)}><Icon name="globe" size={14} /> Public</button>
          </div>
        </div>
        {err && <div className="callout callout--error ob-callout"><span className="ob-callout-glyph" style={{ color: 'var(--status-error)' }}><Icon name="x" /></span><span>{err}</span></div>}
        <div className="ob-form-actions">
          <button type="button" className="btn btn--primary" onClick={submit} disabled={busy || !slug}>
            <Icon name="plus" size={15} /> {busy ? step || 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </main>
  );
}

// ── C · Local folder door ────────────────────────────────────────────────────
function LocalDoor({ onBack }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [needsSetup, setNeedsSetup] = useState(null);

  async function choose() {
    setErr(''); setBusy(true);
    try {
      const dir = await pickDirectory();
      if (!dir) { setBusy(false); return; }
      try {
        await openLocalProject(dir); // switches if it has a .design/
      } catch (e) {
        // open_local_project rejects a non-Maude folder — offer to set it up.
        setNeedsSetup(dir);
        setBusy(false);
      }
    } catch (e) {
      setErr(String(e?.message || e || "Couldn't open that folder."));
      setBusy(false);
    }
  }

  async function setupHere() {
    setErr(''); setBusy(true);
    try {
      const r = await initDesign(needsSetup);
      if (!(r.ok && r.json?.ok)) { setErr(r.json?.error || "Couldn't set it up."); setBusy(false); return; }
      await openLocalProject(needsSetup);
    } catch (e) {
      setErr(String(e?.message || e || "Couldn't set it up."));
      setBusy(false);
    }
  }

  return (
    <main className="ob-main">
      <BackBar onBack={onBack} />
      <header className="ob-head">
        <span className="ob-eyebrow">From this computer</span>
        <h1>Open a project folder</h1>
        <p>Choose a folder on your computer. We'll check it's a Maude project before opening.</p>
      </header>
      {needsSetup ? (
        <>
          <div className="callout callout--info ob-callout">
            <span className="ob-callout-glyph" style={{ color: 'var(--status-info)' }}><Icon name="folder-open" size={15} /></span>
            <span>That folder isn't a Maude project yet. Set up Maude in it to start designing (you can build a design system after).</span>
          </div>
          {err && <div className="callout callout--error ob-callout"><span className="ob-callout-glyph" style={{ color: 'var(--status-error)' }}><Icon name="x" /></span><span>{err}</span></div>}
          <div className="ob-form-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setNeedsSetup(null)} disabled={busy}>Pick a different folder</button>
            <button type="button" data-testid="ob-local-setup" className="btn btn--primary" onClick={setupHere} disabled={busy}><Icon name="folder" size={15} /> {busy ? 'Setting up…' : 'Set up Maude here'}</button>
          </div>
        </>
      ) : (
        <>
          <button type="button" data-testid="ob-local-choose" className="ob-drop" onClick={choose} disabled={busy} aria-label="Choose a project folder">
            <span className="ob-drop-glyph"><Icon name="folder-open" size={34} /></span>
            <span className="ob-drop-title">{busy ? 'Opening…' : 'Choose a project folder'}</span>
            <span className="ob-drop-or">click to browse</span>
          </button>
          {err && <div className="callout callout--error ob-callout"><span className="ob-callout-glyph" style={{ color: 'var(--status-error)' }}><Icon name="x" /></span><span>{err}</span></div>}
          <p className="ob-foot-note">To open a project a teammate shared, use <b>Continue with GitHub</b> instead.</p>
        </>
      )}
    </main>
  );
}

// ── D · Hub door (advanced) ──────────────────────────────────────────────────
function HubDoor({ onBack }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [linked, setLinked] = useState(null);

  async function connect() {
    setErr(''); setBusy(true);
    try {
      const r = await hubLink({ url: url.trim(), token: token.trim() });
      setBusy(false);
      if (r.ok && r.json?.ok) setLinked(r.json);
      else setErr(r.json?.error || "Couldn't connect to the hub.");
    } catch (e) {
      setBusy(false);
      setErr(String(e?.message || e || "Couldn't connect to the hub."));
    }
  }

  return (
    <main className="ob-main">
      <BackBar onBack={onBack} />
      <header className="ob-head">
        <span className="ob-eyebrow">Advanced</span>
        <h1>Connect to a team hub</h1>
        <p>For teams running their own Maude hub. Paste the address and the access token your team gave you.</p>
      </header>
      <div className="ob-form">
        <label className="ob-field">
          <span className="ob-field-label">Hub address</span>
          <span className="ob-field-wrap"><Icon name="server" size={14} className="ob-field-pre" />
            <input className="input ob-input" type="text" value={url} placeholder="https://hub.yourteam.dev" aria-label="Hub address" onChange={(e) => setUrl(e.target.value)} />
          </span>
        </label>
        <label className="ob-field">
          <span className="ob-field-label">Access token</span>
          <span className="ob-field-wrap"><Icon name="key" size={14} className="ob-field-pre" />
            <input className="input ob-input" type="text" value={token} placeholder="paste the access token your team gave you" aria-label="Access token" onChange={(e) => setToken(e.target.value)} />
          </span>
        </label>
        {err && <div className="callout callout--error ob-callout"><span className="ob-callout-glyph" style={{ color: 'var(--status-error)' }}><Icon name="x" /></span><span>{err}</span></div>}
        {linked ? (
          <div className="callout callout--success ob-callout">
            <span className="ob-callout-glyph" style={{ color: 'var(--status-success)' }}><Icon name="check" size={15} /></span>
            <span><b style={{ color: 'var(--fg-0)' }}>Connected to {linked.url.replace(/^https?:\/\//, '')}.</b> {linked.healthy ? 'Your hub is reachable.' : 'Saved — we couldn’t reach it just now, but it’ll sync when it’s up.'} Now open your team’s project with <b>Continue with GitHub</b> or <b>Open a folder</b> — it’ll sync to this hub automatically.</span>
          </div>
        ) : (
          <div className="ob-form-actions">
            <button type="button" className="btn btn--primary" onClick={connect} disabled={busy || !url.trim() || !token.trim()}>
              <Icon name="link" size={15} /> {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        )}
      </div>
      <p className="ob-foot-note">Were you given an email and password for your team’s server? Use <b>Open a project you were invited to</b> instead — no token needed.</p>
    </main>
  );
}

// ── E · Team project door (plan T22) ─────────────────────────────────────────
function TeamDoor({ onBack }) {
  return (
    <main className="ob-main">
      <BackBar onBack={onBack} />
      <header className="ob-head">
        <span className="ob-eyebrow">Your team</span>
        <h1>Open your team’s project</h1>
        <p>Pick a project you were added to. Maude keeps its copy on this computer — nothing to set up.</p>
      </header>
      <TeamProjects variant="door" />
    </main>
  );
}

// ── device-code modal (reused from IdentityBar) ──────────────────────────────
function DeviceCodeModal({ device, onClose }) {
  const [copied, setCopied] = useState(false);
  function copyCode() {
    if (!device?.user_code) return;
    navigator.clipboard?.writeText(device.user_code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  }
  return (
    <div className="gi-modal" role="dialog" aria-modal="true" aria-label="Sign in with GitHub" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="gi-scrim" aria-hidden="true" onClick={onClose} />
      <div className="gi-dialog gi-dialog--code" data-testid="ob-device-modal">
        <div className="gi-dc-head">
          <span className="gi-dc-marks"><GitHubMark size={26} /></span>
          <h2>Sign in with GitHub</h2>
          <p>Maude opened GitHub in your browser. Enter the code there to connect — you'll grant Maude access to create and manage your project repos.</p>
        </div>
        <ol className="gi-dc-steps">
          <li>
            <span className="gi-dc-step-n">1</span>
            <span className="gi-dc-step-tx">
              Go to <span className="gi-dc-url">{(device.verification_uri || 'github.com/login/device').replace(/^https?:\/\//, '')}</span>
              <button type="button" className="btn btn--ghost btn--sm gi-dc-open" onClick={() => openVerification().catch(() => {})}><Icon name="external" size={14} /> Open it again</button>
            </span>
          </li>
          <li><span className="gi-dc-step-n">2</span><span className="gi-dc-step-tx">Enter this code to connect Maude</span></li>
        </ol>
        <div className="gi-code">
          <span className="gi-code-val" data-testid="ob-device-code">{device.user_code}</span>
          <button type="button" className="btn btn--ghost gi-code-copy" onClick={copyCode} aria-label="Copy the code"><Icon name="copy" size={15} /> {copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div className="gi-dc-status" aria-live="polite"><span className="gi-pulse" aria-hidden="true" /><span>Waiting for you to authorize in your browser…</span></div>
        <div className="gi-dc-foot"><button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button><span className="gi-dc-foot-note">Nothing is stored until you authorize.</span></div>
      </div>
    </div>
  );
}

export default function OnboardingWizard() {
  const native = isNativeApp();
  const [door, setDoor] = useState('welcome'); // welcome | github | local | hub | team
  const [identity, setIdentity] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [signing, setSigning] = useState(false);
  const [device, setDevice] = useState(null);
  const [err, setErr] = useState('');
  const unlistenRef = useRef(null);
  const cancelledRef = useRef(false);

  // If already signed in (re-onboarding), skip the sign-in step on the GitHub door.
  useEffect(() => {
    let alive = true;
    if (!native) return undefined;
    (async () => {
      try {
        if (await isSignedIn()) {
          const r = await fetchIdentity();
          if (alive && r.ok && r.json?.ok) { setIdentity({ login: r.json.login, name: r.json.name }); setSignedIn(true); }
        }
      } catch { /* not signed in */ }
    })();
    return () => { alive = false; unlistenRef.current?.then?.((fn) => fn?.()); };
  }, [native]);

  async function handleGithub() {
    if (signedIn) { setDoor('github'); return; }
    cancelledRef.current = false;
    setErr(''); setSigning(true); setDevice(null);
    try {
      unlistenRef.current = onDeviceCode((p) => setDevice(p));
      const login = await signIn();
      if (cancelledRef.current) return; // user hit Cancel — don't auto-advance on a late resolve
      const r = await fetchIdentity();
      setIdentity(r.ok && r.json?.ok ? { login: r.json.login, name: r.json.name } : { login });
      setSignedIn(true);
      setDoor('github');
    } catch (e) {
      if (!cancelledRef.current) setErr(String(e?.message || e || "Sign-in didn't finish. Please try again."));
    } finally {
      setSigning(false);
      setDevice(null);
      unlistenRef.current?.then?.((fn) => fn?.());
      unlistenRef.current = null;
    }
  }

  if (!native) return null;

  return (
    <div className="ob-overlay" data-testid="onboarding-wizard" role="dialog" aria-modal="true" aria-label="Welcome to Maude">
      <div className="ob-shell">
        <Rail signedInAs={signedIn ? identity?.login : null} />
        {door === 'welcome' && <Welcome signing={signing} signedIn={signedIn} identity={identity} onGithub={handleGithub} onLocal={() => setDoor('local')} onHub={() => setDoor('hub')} onTeam={() => setDoor('team')} />}
        {door === 'github' && <GitHubDoor identity={identity} onBack={() => setDoor('welcome')} />}
        {door === 'local' && <LocalDoor onBack={() => setDoor('welcome')} />}
        {door === 'hub' && <HubDoor onBack={() => setDoor('welcome')} />}
        {door === 'team' && <TeamDoor onBack={() => setDoor('welcome')} />}
      </div>
      {err && door === 'welcome' && (
        <div className="ob-toast callout callout--error" role="alert"><span className="ob-callout-glyph" style={{ color: 'var(--status-error)' }}><Icon name="x" /></span><span>{err}</span></div>
      )}
      {device && <DeviceCodeModal device={device} onClose={() => { cancelledRef.current = true; setSigning(false); setDevice(null); }} />}
    </div>
  );
}
