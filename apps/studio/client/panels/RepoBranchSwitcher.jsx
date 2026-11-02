// Phase 29 (epic E4) Task 4 — the persistent project switcher.
//
// S11.10 — the BRANCH half moved out (Branch select · New branch… · Fetch · Add to main · Continue ·
// the chat guard): it lives in Version history › Advanced now (`v2/history/git-advanced.jsx`,
// `branch-actions.js`), in plain words, with every `switcher-*` testid re-emitted there.
// P8 C4 (lead call v2-p8-lead-canvases-header-and-switcher) — the dock at the foot of the Canvases panel is
// gone: the project pill IS the switcher. What stays is the way to another project, as the pill menu's
// "Switch project" submenu: the recents, Open a team project… and Open another folder…. The testids moved with it
// (`repo-switcher-trigger` = the pill, `repo-switcher-popup` = the submenu, `switcher-open-team`).
// Project switch → open_local_project (Tauri) reloads the webview.
//
// A browser tab has nothing to switch to (the developer owns the workspace from their terminal, DDR-119), so
// the hook offers nothing there.

import { useEffect, useState } from 'react';

import {
  appRecentProjects,
  isNativeApp,
  managedProjectsList,
  openLocalProject,
  pickDirectory,
} from '../github.js';
import { TeamProjectsDialog } from './TeamProjects.jsx';

/** The e2e's "the shell is up" handle — it sits on the project pill's wrapper now (not a dock at the foot). */
export const SWITCHER_TRIGGER_TESTID = 'repo-switcher-trigger';
export const SWITCHER_POPUP_TESTID = 'repo-switcher-popup';

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

/**
 * The pill menu's "Switch project" submenu as a render node (project-menu-model's node shape), or null in a
 * browser tab / when there is nothing to offer. Pure, so the test walks it without a webview.
 */
export function switcherNode(recents, managed) {
  const rows = (recents || []).map((p, i) => ({
    type: 'item',
    id: `switch:recent:${i}`,
    label: recentProjectLabel(p, managed).name,
    keys: '',
    icon: null,
    disabled: false,
    // the current project (the first recent) wears the tick
    checked: i === 0,
    path: p,
  }));
  return {
    type: 'sub',
    label: 'Switch project',
    advanced: false,
    popupTestid: SWITCHER_POPUP_TESTID,
    children: [
      ...rows,
      ...(rows.length ? [{ type: 'sep' }] : []),
      {
        type: 'item',
        id: 'switch:open-team',
        label: 'Open a team project…',
        keys: '',
        icon: null,
        disabled: false,
        testid: 'switcher-open-team',
      },
      {
        type: 'item',
        id: 'switch:open-folder',
        label: 'Open another folder…',
        keys: '',
        icon: null,
        disabled: false,
        testid: 'switcher-open-folder',
      },
    ],
  };
}

/**
 * State + actions behind the pill's switcher: `{ node, run(id), dialog, status }`. `node` is null outside the
 * desktop app. `status` is the "Opening …" line while a switch is under way, `dialog` the team picker.
 */
export function useProjectSwitcher() {
  const native = isNativeApp();
  const [recents, setRecents] = useState([]);
  const [managed, setManaged] = useState([]);
  const [teamOpen, setTeamOpen] = useState(false);
  const [switching, setSwitching] = useState('');
  const [err, setErr] = useState('');

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

  async function switchRepo(path) {
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

  const run = (id) => {
    setErr('');
    if (id === 'switch:open-team') setTeamOpen(true);
    else if (id === 'switch:open-folder') openAnother();
    else if (id.startsWith('switch:recent:')) {
      const p = recents[Number(id.slice('switch:recent:'.length))];
      if (p) switchRepo(p);
    }
  };

  const status = switching ? (
    <div className="rb-switching" role="status" aria-live="polite">
      <span>
        Opening <b>{switching}</b>…
      </span>
    </div>
  ) : err ? (
    <div className="rb-switcher-err" role="alert">
      {err}
    </div>
  ) : null;

  return {
    node: native ? switcherNode(recents, managed) : null,
    run,
    status,
    dialog: teamOpen ? <TeamProjectsDialog onClose={() => setTeamOpen(false)} /> : null,
  };
}
