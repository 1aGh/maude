// client/v2/history/branch-actions.js — S11.10: Branch select · New branch… · Fetch · Add to main · Continue.
//
// The branch half of the v1 project dock (`panels/RepoBranchSwitcher.jsx`), moved here with its guard.
// THREE actions move the worktree and reload the page — switching, creating (it checks the new branch out) and
// the local add — and all three go through `guardedByChat` first (D10, feature-acp-write-path-scope Task 9):
// the bridge outlives a reload now, so a chat that is mid-turn would keep editing files on a branch that has
// moved under it. The probe asks the SERVER, not local chat state — a bridge can be running detached with no
// client that knows about it, which is exactly the case the warning is for.
//
// The model is injected (`fetchImpl`, `reload`, `openUrl`) so the whole thing runs without a window.

import { useCallback, useState } from 'react';
import { isNativeApp, openGitHubUrl } from '../../github.js';
import { getJson, loadBranches, postJson } from './git-io.js';
import { GIT_WORDS as W, slugifyBranch } from './git-model.js';

const defaultReload = () => window.location.reload();

/** Open the pull request in the OS browser; an older desktop build falls back to copying the link. */
async function defaultOpenUrl(url) {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return { copied: false };
  }
  try {
    await openGitHubUrl(url);
    return { copied: false };
  } catch {
    try {
      await navigator.clipboard.writeText(url);
      return { copied: true };
    } catch {
      return { copied: false };
    }
  }
}

/**
 * @param p.branch    the branch HEAD is on
 * @param p.shared    the shared line's name (main / master)
 * @param p.setBranches   (branches) → void — the list the Branch select shows
 */
export function useBranchActions({
  branch,
  shared = 'main',
  setBranches,
  fetchImpl,
  reload = defaultReload,
  openUrl = defaultOpenUrl,
}) {
  const [switching, setSwitching] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [folding, setFolding] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [chatGuard, setChatGuard] = useState(null); // { count, verb, action }
  const [prResult, setPrResult] = useState(null); // { url, number, repo } | { message }
  const [prCopied, setPrCopied] = useState(false);

  const reloadBranches = useCallback(async () => {
    const list = await loadBranches(fetchImpl);
    // A flaky network never blanks the list: a failed read keeps the one already shown.
    if (list) setBranches?.(list);
  }, [fetchImpl, setBranches]);

  async function chatsRunning() {
    try {
      const j = await getJson('/_api/acp/running', fetchImpl);
      return Number(j?.running) || 0;
    } catch {
      // Never block a switch because the probe failed — a switch the person asked for must not be hostage to
      // an unrelated fetch error.
      return 0;
    }
  }

  /** Run `action` after an explicit confirm when a turn is in flight. The warning has to come BEFORE the
   *  checkout — warning after the worktree already moved would be theatre. */
  async function guardedByChat(action, verb) {
    const n = await chatsRunning();
    if (n === 0) {
      action();
      return;
    }
    setChatGuard({ count: n, verb, action });
  }

  // Call site 1 of 3 — switching.
  async function doSwitchDraft(name, where) {
    setSwitching(name);
    setDownloading(where === 'remote'); // a remote-only branch is downloaded on switch
    setErr('');
    const r = await postJson('/_api/git/checkout', { name }, { fetchImpl });
    if (r.ok && r.json?.ok) reload();
    else {
      setErr(r.json?.error || W.errSwitch);
      setSwitching('');
      setDownloading(false);
    }
  }

  async function switchDraft(name, where) {
    if (!name || name === branch) return;
    await guardedByChat(() => doSwitchDraft(name, where), `switch to “${name}”`);
  }

  // Call site 2 of 3 — creating a branch checks it out, so it moves the worktree exactly like a switch.
  async function doCreateDraft(name) {
    setBusy(true);
    setErr('');
    const r = await postJson('/_api/git/branch', { name }, { fetchImpl });
    if (r.ok && r.json?.ok) reload();
    else {
      setErr(r.json?.error || W.errCreate);
      setBusy(false);
    }
  }

  async function createDraft(raw) {
    const name = slugifyBranch(raw);
    if (!name) return;
    await guardedByChat(() => doCreateDraft(name), `create “${name}”`);
  }

  // Fetch: ask the remote for new branches, then re-read the list. An explicit gesture, never automatic; the
  // token is server-held. A failure is a notice — it never clears the list, which stays rendered from disk.
  async function refreshDrafts() {
    if (refreshing) return;
    setRefreshing(true);
    setErr('');
    const r = await postJson('/_api/git/fetch', {}, { timeoutMs: 45000, fetchImpl });
    if (r.ok && r.json?.ok) {
      if (r.json.fetchedAt) setFetchedAt(r.json.fetchedAt);
      await reloadBranches();
    } else if (r.timedOut || r.json?.timedOut) {
      setErr(W.errFetchTimeout);
    } else {
      setErr(
        r.status === 401 || r.json?.authRequired ? W.errFetchAuth : r.json?.error || W.errFetch
      );
    }
    setRefreshing(false);
  }

  // Call site 3 of 3 — adding the branch to the shared line. On a GitHub remote this opens a pull request (the
  // merge happens there, after review) and the sheet stays to show the link; a local project adds it directly
  // and reloads. Guarded as a whole: a merge landing under a running agent is the same hazard either way.
  async function doFoldDraft() {
    setFolding(branch);
    setErr('');
    const r = await postJson('/_api/git/fold', { name: branch }, { timeoutMs: 45000, fetchImpl });
    const j = r.json;
    if (r.ok && j?.ok && j.prUrl) {
      setPrResult({ url: j.prUrl, number: j.prNumber, repo: j.repo });
      setFolding('');
      reloadBranches(); // the branch still exists (the PR references it)
      return;
    }
    if (r.ok && j?.ok && j.prUnavailable) {
      setPrResult({ message: j.error || W.prUnavailable });
      setFolding('');
      reloadBranches();
      return;
    }
    if (r.ok && j?.ok) {
      reload(); // added directly (no remote)
      return;
    }
    setErr(
      r.status === 401
        ? `Sign in with GitHub to add “${branch}” to ${shared}.`
        : j?.error || W.errAdd
    );
    setFolding('');
  }

  async function foldDraft() {
    await guardedByChat(doFoldDraft, `add “${branch}” to ${shared}`);
  }

  async function reviewPr(url) {
    const r = await openUrl(url);
    if (r?.copied) setPrCopied(true);
  }

  function endPrSheet() {
    setPrResult(null);
    setPrCopied(false);
  }

  return {
    switching,
    downloading,
    folding,
    busy,
    err,
    setErr,
    refreshing,
    fetchedAt,
    chatGuard,
    setChatGuard,
    prResult,
    prCopied,
    reloadBranches,
    switchDraft,
    createDraft,
    refreshDrafts,
    foldDraft,
    reviewPr,
    endPrSheet,
  };
}
