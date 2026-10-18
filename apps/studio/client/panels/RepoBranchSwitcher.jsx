// Phase 29 (epic E4) Task 4 — the persistent project switcher.
//
// S11.10 — the BRANCH half moved out (Branch select · New branch… · Fetch · Add to main · Continue ·
// the chat guard): it lives in Version history › Advanced now (`v2/history/git-advanced.jsx`,
// `branch-actions.js`), in plain words, with every `switcher-*` testid re-emitted there.
// What stays is the way to another project — a compact ONE-LINE dock at the BOTTOM of the sidebar (mounted
// directly above the IdentityBar avatar, so the two form one bottom dock — the gi-rail/gi-menu anatomy):
// "📁 <project> ⌃" opens ONE popup UPWARD with recents, Open a team project… and Open another folder….
// Project switch → open_local_project (Tauri) reloads the webview. CSS in 3-shell-maude.css.
//
// A browser tab has nothing to switch to (the developer owns the workspace from their terminal, DDR-119), so
// it renders nothing.

import { useEffect, useRef, useState } from 'react';

import {
  appRecentProjects,
  isNativeApp,
  managedProjectsList,
  openLocalProject,
  pickDirectory,
} from '../github.js';
import { TeamProjectsDialog } from './TeamProjects.jsx';

function Icon({ name, size = 16, className }) {
  const p = {
    check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
    'chevron-up': <polyline points="3.5 10 8 5.5 12.5 10" />,
    folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
    'folder-open': (
      <>
        <path d="M2 4.5h4l1.3 1.5H14" />
        <path d="M2 6h12.5l-1.4 7H3.4z" />
      </>
    ),
    share: (
      <>
        <circle cx="4" cy="8" r="1.6" />
        <circle cx="12" cy="4" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <line x1="5.4" y1="7.2" x2="10.6" y2="4.6" />
        <line x1="5.4" y1="8.8" x2="10.6" y2="11.4" />
      </>
    ),
    spinner: <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8" />,
  }[name];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {p}
    </svg>
  );
}

/**
 * The name to show for a recent project path: a managed team copy lives under a
 * key like `acme.cloud.maude.sh--alligators`, so it shows the project's name.
 */
export function recentProjectLabel(path, managed) {
  const m = (managed || []).find((x) => x.path === path);
  return m
    ? { name: m.name, sub: m.server_url.replace(/^https?:\/\//, '') }
    : { name: basename(path), sub: path };
}

function basename(p) {
  return (
    String(p)
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() || String(p)
  );
}

export default function RepoBranchSwitcher({ project }) {
  const native = isNativeApp();
  const [recents, setRecents] = useState([]);
  const [managed, setManaged] = useState([]);
  const [teamOpen, setTeamOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState('');
  const [err, setErr] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    let alive = true;
    if (native)
      appRecentProjects()
        .then((r) => alive && setRecents(r || []))
        .catch(() => {});
    if (native)
      managedProjectsList()
        .then((r) => alive && setManaged(Array.isArray(r) ? r : []))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [native]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function switchRepo(path) {
    setOpen(false);
    if (!native) return;
    setSwitching(recentProjectLabel(path, managed).name);
    try {
      await openLocalProject(path);
    } catch (e) {
      setErr(String(e?.message || e || 'Could not open that project.'));
      setSwitching('');
    }
  }

  async function openAnother() {
    setOpen(false);
    if (!native) return;
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      setSwitching(basename(dir));
      await openLocalProject(dir);
    } catch (e) {
      setErr(String(e?.message || e || 'Could not open that folder.'));
      setSwitching('');
    }
  }

  if (!native) return null;
  const name = project || recentProjectLabel(recents[0] || 'Project', managed).name;

  return (
    <div className="rb-dock-wrap">
      <div className="rb-dock" ref={rootRef}>
        {open && (
          <div
            className="rb-pop rb-pop--up"
            id="rb-switch-pop"
            role="menu"
            aria-label="Switch project"
            data-testid="repo-switcher-popup"
          >
            <div className="rb-pop-hd">Project</div>
            {recents.length > 0 ? (
              recents.map((p, i) => {
                const label = recentProjectLabel(p, managed);
                return (
                  <button
                    type="button"
                    key={p}
                    className={'rb-pop-item' + (i === 0 ? ' is-current' : '')}
                    role="menuitem"
                    onClick={() => switchRepo(p)}
                  >
                    <span className="rb-pop-icon">
                      <Icon
                        name={managed.some((m) => m.path === p) ? 'share' : 'folder'}
                        size={14}
                      />
                    </span>
                    <span className="rb-pop-tx">
                      <span className="rb-pop-name">{label.name}</span>
                      <span className="rb-pop-sub">{label.sub}</span>
                    </span>
                    {i === 0 ? <Icon name="check" size={14} className="rb-pop-check" /> : null}
                  </button>
                );
              })
            ) : (
              <div className="rb-pop-sub" style={{ padding: 'var(--space-2) var(--space-3)' }}>
                No other recent projects.
              </div>
            )}
            <button
              type="button"
              className="rb-pop-item rb-pop-item--action"
              role="menuitem"
              data-testid="switcher-open-team"
              onClick={() => {
                setOpen(false);
                setTeamOpen(true);
              }}
            >
              <span className="rb-pop-icon">
                <Icon name="share" size={14} />
              </span>
              <span className="rb-pop-tx">
                <span className="rb-pop-name">Open a team project…</span>
              </span>
            </button>
            <button
              type="button"
              className="rb-pop-item rb-pop-item--action"
              role="menuitem"
              onClick={openAnother}
            >
              <span className="rb-pop-icon">
                <Icon name="folder-open" size={14} />
              </span>
              <span className="rb-pop-tx">
                <span className="rb-pop-name">Open another folder…</span>
              </span>
            </button>
          </div>
        )}
        {switching ? (
          <div className="rb-switching" role="status" aria-live="polite">
            <Icon name="spinner" size={14} className="rb-spin" />
            <span>
              Opening <b>{switching}</b>…
            </span>
          </div>
        ) : (
          <button
            type="button"
            data-testid="repo-switcher-trigger"
            className={'rb-trigger' + (open ? ' is-open' : '')}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls="rb-switch-pop"
            onClick={() => setOpen((v) => !v)}
            title={name}
          >
            <span className="rb-trigger-icon">
              <Icon name="folder" size={14} />
            </span>
            <span className="rb-trigger-proj">{name}</span>
            <Icon name="chevron-up" size={13} className="rb-trigger-caret" />
          </button>
        )}
        {err && !open && !switching && (
          <div className="rb-switcher-err" role="alert">
            {err}
          </div>
        )}
      </div>
      {teamOpen ? <TeamProjectsDialog onClose={() => setTeamOpen(false)} /> : null}
    </div>
  );
}
