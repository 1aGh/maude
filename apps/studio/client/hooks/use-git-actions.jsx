// hooks/use-git-actions.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useMemo, useState } from 'react';

export function useGitActions({
  gitStatus, setGitStatus, setRemoteSync, diffTarget, setDiffTarget, savingIsManaged,
  savingIsManagedRef
}) {
  // ----- Phase 27 (E2) — git actions -----
  // All write actions POST same-origin (the dev-server's sameOriginWrite + the
  // dual-allowlist gate them main-origin only). After a mutation we refresh
  // status optimistically; the `git-status` WS broadcast also lands shortly.
  const refreshGitStatus = useCallback(async () => {
    if (savingIsManagedRef.current) return; // cloud-managed — nobody polls a repo they don't commit to
    try {
      const r = await fetch('/_api/git/status');
      if (r.ok) setGitStatus(await r.json());
    } catch {}
  }, []);

  // Phase 28 (E3) — probe the tracking remote so the Changes panel can surface
  // the "Get latest" nudge (GitPanel reads `status.remoteAhead` / `status.behind`).
  // `?remote=1` is what makes the server do the `git fetch` + ahead/behind count;
  // without it the status is local-only and the nudge never fires. Network call —
  // call sparingly (mount / interval / post-action), never on the WS hot path.
  const refreshRemoteSync = useCallback(async () => {
    // The ahead/behind probe is a real network `git fetch` against the LOCAL
    // repo's remote — the one remote a cloud-managed project has nothing to do
    // with. Gated here as well as at the interval, so a post-action call site
    // cannot reintroduce it.
    if (savingIsManagedRef.current) return;
    try {
      const r = await fetch('/_api/git/status?remote=1');
      if (!r.ok) return;
      const data = await r.json();
      if (data && data.repo !== false)
        setRemoteSync({ remoteAhead: !!data.remoteAhead, behind: data.behind || 0 });
    } catch {}
  }, []);

  const gitPostJson = useCallback(async (path, body) => {
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, ...data };
    } catch (e) {
      return { ok: false, error: 'Network error — is the project still open?' };
    }
  }, []);

  const gitCommit = useCallback(
    async (message, files) => {
      const res = await gitPostJson('/_api/git/commit', { message, files });
      if (res.ok) await refreshGitStatus();
      return res;
    },
    [gitPostJson, refreshGitStatus]
  );

  const gitDiscard = useCallback(
    async (files) => {
      const res = await gitPostJson('/_api/git/discard', { files });
      if (res.ok) await refreshGitStatus();
      return res;
    },
    [gitPostJson, refreshGitStatus]
  );

  const gitPublish = useCallback(async () => {
    const res = await gitPostJson('/_api/git/push', {});
    // Refresh so the "N versions ready to publish" count clears to 0 after a
    // successful push (the server advanced the local remote-tracking ref), and
    // re-probe the remote so a stale "Get latest" nudge clears.
    if (res.ok) {
      await refreshGitStatus();
      refreshRemoteSync();
    }
    return res;
  }, [gitPostJson, refreshGitStatus, refreshRemoteSync]);

  const gitGetLatest = useCallback(async () => {
    const res = await gitPostJson('/_api/git/pull', {});
    // On success the remote is merged in — clear the nudge by re-probing.
    if (res.ok) {
      await refreshGitStatus();
      refreshRemoteSync();
    }
    // A true content conflict → open the visual resolver on the first file.
    if (res.conflict && Array.isArray(res.files) && res.files.length) {
      setDiffTarget({ file: res.files[0], conflict: true });
    }
    return res;
  }, [gitPostJson, refreshGitStatus, refreshRemoteSync]);

  // Phase 28 (E3) — finish a Get-latest conflict from the DiffView resolver.
  // `choice` is 'mine' | 'theirs' | 'both'; the server completes the two-parent
  // merge commit (and, for 'both', writes our version as a "(mine)" copy).
  const gitResolveConflict = useCallback(
    async (choice) => {
      const res = await gitPostJson('/_api/git/resolve', { choice });
      if (res.ok) {
        await refreshGitStatus();
        refreshRemoteSync();
      }
      return res;
    },
    [gitPostJson, refreshGitStatus, refreshRemoteSync]
  );

  // `path` (optional) scopes History to one canvas — the per-file version list
  // behind the History click-to-preview + DiffView "Saved version" picker
  // (phase-27.1). Omit for the repo-wide log.
  const gitLoadLog = useCallback(async (path) => {
    try {
      const qs = '/_api/git/log?limit=40' + (path ? `&path=${encodeURIComponent(path)}` : '');
      const r = await fetch(qs);
      if (!r.ok) return [];
      const data = await r.json();
      return data.entries || [];
    } catch {
      return [];
    }
  }, []);

  // THE HISTORY THAT IS ACTUALLY BEING WRITTEN (feature-cloud-managed-git-
  // posture). Same signature and same row shape as `gitLoadLog` — the two are
  // interchangeable at the call site precisely because the format, the argv and
  // the parser behind them are ONE module (`git/log-format.ts`), imported by
  // both the local service and the cell.
  //
  // Failure is REPORTED, never mistaken for emptiness: `null` means "we could
  // not reach the cloud" (the panel shows a Retry callout), `[]` means "the
  // cloud has no versions yet" (the panel shows the empty state). Collapsing
  // the two is what produced the original bug in the first place.
  const [cloudHistory, setCloudHistory] = useState(null); // { branch, project, hubHost } | null
  const gitLoadCloudLog = useCallback(async (path) => {
    try {
      const qs =
        '/_api/cloud/history?limit=40' + (path ? `&path=${encodeURIComponent(path)}` : '');
      const r = await fetch(qs);
      if (!r.ok) return null;
      const data = await r.json();
      if (!data?.ok) return null;
      setCloudHistory({
        branch: data.branch ?? null,
        project: data.project ?? null,
        hubHost: data.hubHost ?? null,
      });
      return data.entries || [];
    } catch {
      return null;
    }
  }, []);

  // ACCEPTED REVISIONS — the project's own history (DDR-241, T27). When the
  // project saves through accepted revisions the History tab lists logical
  // actions (who did what, when), not Git commits; a row previews as `r<rev>`
  // through the same version preview. `'legacy'` means "use Git history".
  const [projectHistoryOn, setProjectHistoryOn] = useState(false);
  const [projectHistoryRefresh, setProjectHistoryRefresh] = useState(0);
  const loadAcceptedLog = useCallback(async (path) => {
    try {
      const qs =
        '/_api/project/history?limit=40' + (path ? `&path=${encodeURIComponent(path)}` : '');
      const r = await fetch(qs);
      if (!r.ok) return 'legacy';
      const data = await r.json();
      if (!data?.ok) return data?.reason === 'legacy' ? 'legacy' : null;
      return (data.history || []).map((a) => {
        const where = path ? '' : (a.canvases || []).map((c) => c.split('/').pop()).join(', ');
        return {
          sha: `r${a.revision}`,
          message: [a.label || a.kind, where].filter(Boolean).join(' · '),
          author: a.actor,
          date: new Date(a.committedAt).toISOString(),
          accepted: {
            revision: a.revision,
            actionId: a.actionId,
            mine: !!a.mine,
            undo: a.kind === 'undo' || a.kind === 'redo',
          },
        };
      });
    } catch {
      return null;
    }
  }, []);

  // An accepted preview must stay on project history even if loading fails:
  // switching to Git would turn Restore into an unrelated discard operation.
  const acceptedDiff = /^r\d+$/.test(diffTarget?.beforeSha || '');
  const loadDiffLog = useCallback(async (path) => {
    if (!acceptedDiff) return gitLoadLog(path);
    const entries = await loadAcceptedLog(path);
    return Array.isArray(entries) ? entries : [];
  }, [acceptedDiff, gitLoadLog, loadAcceptedLog]);
  const restoreProjectVersion = useCallback(async (path, revision) => {
    if (!path || !Number.isSafeInteger(revision) || revision < 0) {
      return { ok: false, error: 'Choose a saved project version to restore.' };
    }
    const r = await fetch('/_api/project/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, revision }),
    }).catch(() => null);
    const result = r ? await r.json().catch(() => null) : null;
    if (r?.ok && result?.ok) {
      setProjectHistoryRefresh((version) => version + 1);
      return result;
    }
    return { ok: false, error: result?.error };
  }, []);

  // Repo-relative path → M/A/D/U badge for the tree (paths match: both the tree
  // and gitStatus use `.design/ui/Foo.tsx`). Keyed off gitStatus so it updates
  // live with the WS broadcast.
  const dirtyByPath = useMemo(() => {
    const KIND = { modified: 'M', added: 'A', deleted: 'D', untracked: 'U' };
    const m = new Map();
    // A tree badge is the SAME claim as the withdrawn count, drawn one row at a
    // time: "this file is unsaved". In cloud-managed posture it is not — the
    // cell committed it seconds ago. Empty, so the tree simply says nothing.
    if (savingIsManaged) return m;
    for (const f of gitStatus?.files || []) m.set(f.path, KIND[f.status]);
    return m;
  }, [gitStatus, savingIsManaged]);
  return {
    acceptedDiff, cloudHistory, dirtyByPath, gitCommit, gitDiscard, gitGetLatest, gitLoadCloudLog,
    gitLoadLog, gitPublish, gitResolveConflict, loadAcceptedLog, loadDiffLog, projectHistoryOn,
    projectHistoryRefresh, refreshRemoteSync, restoreProjectVersion, setProjectHistoryOn
  };
}
