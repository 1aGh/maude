// client/v2/settings/project-sync-settings.jsx — V2-4.7a: Settings › Advanced › This project.
//
// The sync settings and the .design/ ownership switch used to sit at the foot of the Sync panel
// (panels/SyncPanel.jsx, `sync-settings` / `sync-ownership`). Same routes, same bodies, same
// confirm step — only the home moved: the sheet is where a person looks for a switch, the sync
// panel is where they look at what sync is doing (Diagnostics › Sync details, V2-4.7b).
//
// Rendered only for a project linked to a workspace (`/_api/sync/settings` answers `settings:
// null` otherwise); an unlinked project says so in one line instead of showing dead switches.

import { useCallback, useEffect, useState } from 'react';

import { safeDetail } from '../../../sync/presentation.ts';
import { SwitchRow } from './parts.jsx';
import { hostLabel } from './settings-model.js';

export default function ProjectSyncSettings({ cloud }) {
  // ── Sync settings — fetched once; `settings` stays null when no workspace is linked.
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let gone = false;
    fetch('/_api/sync/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!gone && j && typeof j === 'object') setSettings(j.settings ?? null);
      })
      .catch(() => {
        /* no server / old server — the rows simply don't render */
      })
      .finally(() => {
        if (!gone) setLoaded(true);
      });
    return () => {
      gone = true;
    };
  }, []);
  const change = useCallback(async (patch) => {
    setBusy(true);
    setNote('');
    let json = null;
    try {
      const res = await fetch('/_api/sync/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      json = await res.json().catch(() => null);
    } catch {
      /* said below */
    }
    setBusy(false);
    if (!json || json.ok !== true) {
      setNote(safeDetail(json?.detail, 'The setting could not be saved.'));
      return;
    }
    setSettings(json.settings);
    // Saved is a fact; whether it took effect NOW depends on the supervisor — say which.
    setNote(
      json.applied
        ? 'Saved — sync is restarting with the new setting.'
        : 'Saved — applies the next time sync restarts.'
    );
  }, []);

  // ── Ownership — repo-owned vs workspace-owned. A change goes through an explicit two-step confirm.
  const [ownership, setOwnership] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'adopt' | 'detach' | null
  const [ownBusy, setOwnBusy] = useState(false);
  const [ownNote, setOwnNote] = useState('');
  useEffect(() => {
    let gone = false;
    fetch('/_api/sync/ownership')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!gone && j && typeof j.mode === 'string') setOwnership(j);
      })
      .catch(() => {
        /* old server — the row doesn't render */
      });
    return () => {
      gone = true;
    };
  }, []);
  const changeOwnership = useCallback(async (action) => {
    setOwnBusy(true);
    setOwnNote('');
    let json = null;
    try {
      const res = await fetch('/_api/sync/ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      json = await res.json().catch(() => null);
    } catch {
      /* said below */
    }
    setOwnBusy(false);
    setConfirm(null);
    if (!json || json.ok !== true) {
      setOwnNote(safeDetail(json?.detail, 'The ownership change did not complete.'));
      return;
    }
    setOwnNote(
      action === 'adopt'
        ? `Done — .design/ is workspace-owned now. ${json.untracked ?? 0} file(s) untracked (still on disk, staged as deletions — commit when ready).`
        : 'Done — unlinked and repo-owned again. Commit .design/ when you are ready.'
    );
    // Re-read rather than guess — the server is the source for mode.
    try {
      const r = await fetch('/_api/sync/ownership');
      const j = r.ok ? await r.json() : null;
      if (j && typeof j.mode === 'string') setOwnership(j);
    } catch {
      /* keep the stale mode; the note already said what happened */
    }
  }, []);

  return (
    <>
      {loaded && !settings && (
        <p className="v2s-hint" data-testid="settings-project-unlinked">
          Not linked to a workspace, so there is nothing to sync yet. Connect this project under
          Connections and its sync switches appear here.
        </p>
      )}
      {settings && (
        <div data-testid="sync-settings">
          <SwitchRow
            testid="sync-setting-syncFiles"
            label="Sync project files, not only canvases"
            note="The whole design folder mirrors both ways, not just canvases."
            checked={settings.syncFiles}
            disabled={busy}
            onChange={(v) => change({ syncFiles: v })}
          />
          <SwitchRow
            testid="sync-setting-propagateDeletes"
            label="Propagate deletions"
            note="Removing a file here removes it everywhere; replaced copies are kept in Trash."
            checked={settings.propagateDeletes}
            disabled={busy}
            onChange={(v) => change({ propagateDeletes: v })}
          />
          <label className="v2s-row" data-testid="sync-setting-firstAnchor">
            <span className="v2s-row-t">
              <span className="v2s-row-k">When a folder first links</span>
              <span className="v2s-hint">
                When both sides have content the first time a project links.
              </span>
            </span>
            <select
              className="v2s-select"
              value={settings.resolveFirstAnchor}
              disabled={busy}
              onChange={(e) => change({ resolveFirstAnchor: e.target.value })}
            >
              <option value="ask">Keep asking</option>
              <option value="keep-local">Keep this machine's</option>
              <option value="keep-cloud">Keep the workspace's</option>
            </select>
          </label>
          {note && (
            <div className="v2s-note" role="status" aria-live="polite">
              {note}
            </div>
          )}
        </div>
      )}

      {/* Hidden on a cell (a member's browser must not re-own the operator's checkout) and without git. */}
      {ownership && !cloud && ownership.git && (
        <div data-testid="sync-ownership">
          <div className="v2s-row" data-testid="sync-ownership-mode">
            <span className="v2s-row-t">
              <span className="v2s-row-k">Who keeps .design/</span>
              <span className="v2s-hint">
                {ownership.mode === 'hub-owned' &&
                  'Workspace-owned — .design/ is gitignored and mirrored by the workspace.'}
                {ownership.mode === 'repo-owned' &&
                  'Repo-owned — .design/ is committed with this repository.'}
                {ownership.mode === 'hybrid' &&
                  `Two owners — git commits .design/ (${ownership.trackedCount} file${ownership.trackedCount === 1 ? '' : 's'}) AND a workspace mirrors it. A git pull and a sync pass can each undo the other.`}
              </span>
            </span>
            {confirm === null && ownership.linked && ownership.mode !== 'hub-owned' && (
              <button
                type="button"
                className="btn btn--sm"
                data-testid="sync-ownership-adopt"
                disabled={ownBusy}
                onClick={() => setConfirm('adopt')}
              >
                Hand over…
              </button>
            )}
            {confirm === null && ownership.mode === 'hub-owned' && (
              <button
                type="button"
                className="btn btn--sm"
                data-testid="sync-ownership-detach"
                disabled={ownBusy}
                onClick={() => setConfirm('detach')}
              >
                Take back…
              </button>
            )}
          </div>
          {confirm && (
            <div className="v2s-confirm" data-testid="sync-ownership-confirm">
              {confirm === 'adopt' ? (
                <>
                  Stop committing .design/ and let the workspace mirror it. Nothing is deleted —
                  every file stays on disk; git stops tracking them (staged as deletions, commit
                  when ready).
                </>
              ) : (
                <>
                  Disconnect from the workspace ({hostLabel(ownership.hubUrl)}) and take .design/
                  back into git. Every file is already on disk in full; commit the folder when you
                  are ready.
                </>
              )}{' '}
              <button
                type="button"
                className="btn btn--sm btn--primary"
                data-testid="sync-ownership-confirm-yes"
                disabled={ownBusy}
                onClick={() => changeOwnership(confirm)}
              >
                {ownBusy ? 'Working…' : 'Do it'}
              </button>{' '}
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                disabled={ownBusy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
            </div>
          )}
          {ownNote && (
            <div className="v2s-note" role="status" aria-live="polite">
              {ownNote}
            </div>
          )}
        </div>
      )}
    </>
  );
}
