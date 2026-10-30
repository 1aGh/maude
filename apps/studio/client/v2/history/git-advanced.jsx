// client/v2/history/git-advanced.jsx — Version history › Advanced: Compare pictures (S1.15), then the git in plain
// words (S11.10; 06 · ad-history).
//
// Closed, the panel above is versions only — no commit ids, no branch. Open, this is where the git lives:
//
//   Branch            the one you are on, and the others            ← `GET/POST /_api/git/branches|checkout`
//   Drafts            "Continue" on the branch you were working on  ← the same checkout
//   Remote            where it goes, Copy
//   Changed in this version   its git id, M / A, +14 −6, the lines
//   Not in a version yet      the files that are, Discard           ← `/_api/git/discard`
//   Save a version with a note… · New branch… · Fetch · Publish N versions · Pull a copy to this Mac… ·
//   Add to main · opens a pull request
//   Every version, with its id  (and, on a project's own revisions, Preview · Restore · Undo)
//
// It retires the Changes / History panel (`panels/GitPanel.jsx`) and the branch half of the project dock
// (`panels/RepoBranchSwitcher.jsx`) — every capability kept, every `git-*` / `switcher-*` /
// `project-history-*` testid re-emitted. `/_api/git/*` is unchanged. Hidden for Can comment / Can view (the
// server refuses the writes whatever is drawn) and, in a cloud tab, reduced to "Cloud versions".
//
// Props follow the contract (S11-slices §2.2): { canvas, version, role, onComparePictures } plus
//   versionRow  the VersionRow of `version` (its `madeAt` and `from` name the git id and the diff)
//   git         what the shell knows (the status poll, the posture, the callbacks) — see use-palette-and-panels.jsx
//   fetchImpl   tests

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from '../empty/use-empty-canvas.js';
import { MENU_ACTION_EVENT } from '../shell/menu-runner.js';
import { useBranchActions } from './branch-actions.js';
import { COMPARE_PICTURES_WORDS as CW } from './compare-words.js';
import { loadBranches, loadSourceAt } from './git-io.js';
import {
  GIT_WORDS as W,
  addToSharedLabel,
  branchModel,
  changedLine,
  commitFor,
  gitSurface,
  outcomeBanner,
  publishLabel,
  relativeTime,
  remoteLabel,
  resumeDraft,
  shortSha,
  tid,
  unsavedUnits,
  versionRows,
} from './git-model.js';
import {
  AddDialog,
  Banner,
  BranchDialog,
  ChangedList,
  CopyButton,
  GitRow,
  GitSub,
  GuardDialog,
  SaveDialog,
  UnsavedList,
  VersionList,
} from './git-parts.jsx';
import { reasonProps } from '../access/disabled-reason.js';

/** DiffView's line when there is no saved copy to compare with (panels/DiffView.jsx). */
const NO_SAVED_COPY = 'No saved version of this canvas to compare yet.';

/** The git id and the lines of the version being looked at. */
function useChangedInVersion({ canvas, versionRow, enabled, fetchImpl }) {
  const [state, setState] = useState({ status: 'idle', line: null });
  const ref = versionRow?.ref ?? null;
  const from = versionRow?.from ?? null;
  useEffect(() => {
    if (!enabled || !canvas || !ref) {
      setState({ status: 'idle', line: null });
      return undefined;
    }
    // A legacy `git:` row has no row before it to read: its words are Compare's
    if (/^git:/.test(ref) && !from) {
      setState({ status: 'none', line: null });
      return undefined;
    }
    let alive = true;
    setState({ status: 'loading', line: null });
    (async () => {
      const after = await loadSourceAt({ path: canvas, at: ref, fetchImpl });
      const before = from ? await loadSourceAt({ path: canvas, at: from, fetchImpl }) : null;
      if (!alive) return;
      if (after == null || (from && before == null)) setState({ status: 'none', line: null });
      else setState({ status: 'ready', line: changedLine({ path: canvas, before, after }) });
    })();
    return () => {
      alive = false;
    };
  }, [enabled, canvas, ref, from, fetchImpl]);
  return state;
}

/** The commit log (or the project's accepted history) the posture chose — the shell's `loadLog`. */
function useVersionLog({ git, canvas, enabled }) {
  const [state, setState] = useState({ status: 'loading', entries: [] });
  const [tick, setTick] = useState(0);
  // the shell hands a fresh `loadLog` closure each render; the LATEST one is read when a load starts
  const loadRef = useRef(git?.loadLog);
  loadRef.current = git?.loadLog;
  const has = !!git?.loadLog;
  const source = git?.historySource;
  const refresh = git?.historyRefresh;
  // biome-ignore lint/correctness/useExhaustiveDependencies: source / refresh / tick re-ask on purpose
  useEffect(() => {
    if (!enabled || !has) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      const entries = await loadRef.current(canvas || undefined);
      if (!alive) return;
      setState(entries == null ? { status: 'failed', entries: [] } : { status: 'ready', entries });
    })();
    return () => {
      alive = false;
    };
  }, [enabled, has, canvas, source, refresh, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

function GitBody({ canvas, version, versionRow, role, canView, git, fetchImpl }) {
  const native = !!git.native;
  const status = git.status;
  // S11.15 — offline, Save a version still works; Publish waits for the internet.
  const online = useOnline();
  const surface = gitSurface({
    role,
    native,
    cellManaged: git.cellManaged,
    cloudManaged: git.cloudManaged,
    repo: status?.repo,
    online,
  });
  const full = surface.mode === 'full';
  const cloudHistory = git.historySource === 'cloud';
  const [branches, setBranches] = useState([]);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null); // 'save' | 'branch' | 'add'
  const [resumeDismissed, setResumeDismissed] = useState(false);

  const branch =
    (cloudHistory ? git.cloudHistory?.branch : git.liveBranch || status?.branch) || 'main';
  const model = useMemo(() => branchModel({ branches, branch }), [branches, branch]);
  const actions = useBranchActions({
    branch,
    shared: model.shared,
    setBranches,
    fetchImpl,
    reload: git.reload, // tests; absent = the page reload
  });

  // The branch list is read from disk each time the fold opens (it mounts open) and when HEAD moves
  useEffect(() => {
    if (!full) return undefined;
    let alive = true;
    loadBranches(fetchImpl).then((list) => alive && list && setBranches(list));
    return () => {
      alive = false;
    };
  }, [full, branch, fetchImpl]);

  const log = useVersionLog({ git, canvas, enabled: surface.history });
  const changed = useChangedInVersion({
    canvas,
    versionRow,
    enabled: surface.mode === 'full' || surface.mode === 'read-only',
    fetchImpl,
  });

  const units = useMemo(
    () => unsavedUnits(status?.files ?? [], git.designRel),
    [status, git.designRel]
  );
  const resume = resumeDraft({
    branches,
    onShared: model.onShared,
    dismissed: resumeDismissed,
    busy: actions.switching || actions.folding,
  });
  const unpushed = status?.unpushed || 0;
  const remote = git.remote || status?.remote || '';
  const sha = useMemo(
    () =>
      commitFor(
        versionRow,
        log.entries.filter((e) => !e.accepted)
      ),
    [versionRow, log.entries]
  );

  const run = useCallback(
    async (kind, fn, ok) => {
      setBusy(kind);
      setBanner(null);
      try {
        const res = (await fn()) || {};
        setBanner(outcomeBanner(kind, res, ok));
        if (res.ok) log.reload();
        return res;
      } finally {
        setBusy(null);
      }
    },
    [log]
  );
  const getLatest = () =>
    run('getLatest', git.onGetLatest, { variant: 'success', text: W.upToDate });

  if (surface.mode === 'hidden') return null;

  const headProject = cloudHistory
    ? (git.cloudHistory?.project ?? git.cloudHistory?.hubHost)
    : git.project;
  const activeName = canvas ? (canvas.split('/').pop() || '').replace(/\.(tsx|html)$/i, '') : '';
  const rows = versionRows(log.entries);
  const logState =
    log.status === 'loading' && !rows.length
      ? 'loading'
      : log.status === 'failed'
        ? 'failed'
        : cloudHistory
          ? 'cloud'
          : 'ready';
  const versions = (
    <>
      <GitSub>{surface.mode === 'cloud' ? W.cloudVersions : W.everyVersion}</GitSub>
      <VersionList
        state={logState}
        rows={rows}
        canWrite
        activeName={canvas ? activeName : ''}
        onPreview={git.onPreviewVersion}
        onRestore={git.onRestoreVersion}
        onUndo={git.onUndoAction}
        onRetry={log.reload}
        onDone={log.reload}
      />
    </>
  );

  return (
    <div className="vh-git" data-testid="git-panel" data-mode={surface.mode}>
      <GitRow k="Project" testid="git-panel-repo" mono>
        {headProject ? <b>{headProject}</b> : null}
        {headProject && branch ? <span className="vh-git-sep">/</span> : null}
        {branch}
      </GitRow>
      {surface.note ? (
        <p
          className="vh-git-note-line"
          role="status"
          data-testid={surface.mode === 'cloud-saving' ? 'git-cloud-managed' : 'vh-git-note'}
        >
          {surface.note}
        </p>
      ) : null}
      <Banner
        banner={banner}
        busy={busy}
        onGetLatest={getLatest}
        onDismiss={() => setBanner(null)}
      />

      {surface.mode === 'cloud' || surface.mode === 'cloud-saving' ? versions : null}

      {surface.mode === 'full' || surface.mode === 'read-only' ? (
        <>
          <GitRow k={W.branch}>
            {full ? (
              <select
                className="vh-git-select"
                data-testid="vh-git-branch"
                aria-label={W.branch}
                value={branch}
                disabled={!!actions.switching}
                onChange={(e) => {
                  const o = model.options.find((x) => x.name === e.target.value);
                  actions.switchDraft(e.target.value, o?.where);
                }}
              >
                {model.options.map((o) => (
                  <option key={o.name} value={o.name} data-testid={`branch-row-${tid(o.name)}`}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="vh-git-mono">{branch}</span>
            )}
          </GitRow>
          {resume && full ? (
            <GitRow k={W.drafts} testid="switcher-resume">
              <span className="vh-git-mono vh-git-draft">{resume.name}</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="vh-git-continue"
                onClick={() => actions.switchDraft(resume.name, resume.where)}
              >
                {W.continueDraft}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="switcher-resume-dismiss"
                aria-label={W.dismiss}
                onClick={() => setResumeDismissed(true)}
              >
                {W.dismiss}
              </button>
            </GitRow>
          ) : null}
          {remote ? (
            <GitRow k={W.remote} mono testid="vh-git-remote">
              <span title={remote}>{remoteLabel(remote)}</span>
              <CopyButton text={remoteLabel(remote)} testid="vh-git-remote-copy" />
            </GitRow>
          ) : null}
          {actions.switching || actions.folding ? (
            <p className="vh-git-note-line" role="status" aria-live="polite">
              {actions.folding
                ? W.merging(actions.folding, model.shared)
                : actions.downloading
                  ? W.downloading(actions.switching)
                  : W.switching(actions.switching)}
            </p>
          ) : null}
          {actions.err && !dialog ? (
            <p className="vh-git-err" role="alert">
              {actions.err}
            </p>
          ) : null}

          {versionRow ? (
            <>
              <GitSub aside={sha ? shortSha(sha.sha) : versionRow.ref}>{W.changedIn}</GitSub>
              <ChangedList state={changed} />
            </>
          ) : null}

          <GitSub>{W.notYet}</GitSub>
          <UnsavedList
            units={units}
            canWrite={full}
            busy={busy}
            onOpen={git.onOpenCanvas}
            onCompare={git.onOpenDiff}
            onDiscard={(u) => run('discard', () => git.onDiscard(u.paths))}
          />

          {full && status?.remoteAhead ? (
            <div
              className="callout callout--info vh-git-banner"
              role="status"
              data-testid="switcher-get-latest"
            >
              <span className="vh-git-banner-t">
                <strong>
                  {status.behind} new change{status.behind === 1 ? '' : 's'} from your team.
                </strong>{' '}
                Get the latest before you publish yours.
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="git-get-latest"
                  data-tour="pull"
                  disabled={!!busy}
                  onClick={getLatest}
                >
                  {busy === 'getLatest' ? W.gettingLatest : W.getLatest}
                </button>
              </span>
            </div>
          ) : null}

          {full ? (
            <>
              <div className="vh-git-acts">
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="vh-git-save"
                  disabled={!units.length || !!busy}
                  onClick={() => setDialog('save')}
                >
                  {W.save}
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="switcher-new-branch"
                  onClick={() => {
                    actions.setErr('');
                    setDialog('branch');
                  }}
                >
                  {W.newBranch}
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="switcher-fetch"
                  disabled={actions.refreshing}
                  title={
                    actions.fetchedAt
                      ? `as of ${relativeTime(actions.fetchedAt)}`
                      : 'Check the remote for new branches'
                  }
                  onClick={actions.refreshDrafts}
                >
                  {actions.refreshing ? W.fetching : W.fetch}
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="git-publish"
                  data-tour="publish"
                  disabled={!!busy || surface.publishWaits}
                  title={
                    surface.publishWaits
                      ? W.publishWaits
                      : 'Sends your saved versions to the shared project so the team can get them.'
                  }
                  onClick={() =>
                    run('publish', git.onPublish, { variant: 'success', text: W.published })
                  }
                >
                  {publishLabel(unpushed)}
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="vh-git-pull-copy"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent(MENU_ACTION_EVENT, { detail: { id: 'project.pull-copy' } })
                    )
                  }
                >
                  {W.pullCopy}
                </button>
                {!model.onShared ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    data-testid="switcher-merge"
                    onClick={() => {
                      actions.setErr('');
                      actions.endPrSheet();
                      setDialog('add');
                    }}
                  >
                    {addToSharedLabel({ shared: model.shared, remote })}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {surface.history ? versions : null}
        </>
      ) : null}

      {dialog === 'save' ? (
        <SaveDialog
          units={units}
          onSave={(m, paths) =>
            run('save', () => git.onCommit(m, paths), { variant: 'success', text: W.saved })
          }
          onSaveAll={(m) =>
            run('saveAll', () => git.onCommit(m, undefined), { variant: 'success', text: W.saved })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'branch' ? (
        <BranchDialog
          shared={model.shared}
          error={actions.err}
          busy={actions.busy}
          onCreate={actions.createDraft}
          onClose={() => {
            actions.setErr('');
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'add' ? (
        <AddDialog
          branch={branch}
          shared={model.shared}
          folding={actions.folding}
          error={actions.err}
          prResult={actions.prResult}
          prCopied={actions.prCopied}
          onAdd={actions.foldDraft}
          onReview={actions.reviewPr}
          onClose={() => {
            actions.endPrSheet();
            actions.setErr('');
            setDialog(null);
          }}
        />
      ) : null}
      {actions.chatGuard ? (
        <GuardDialog
          guard={actions.chatGuard}
          branch={branch}
          onCancel={() => actions.setChatGuard(null)}
          onConfirm={() => {
            const { action } = actions.chatGuard;
            actions.setChatGuard(null);
            action();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * @param p.canvas             the open canvas (repo-relative path); null = none
 * @param p.version            the version being looked at (`r<n>`) or null
 * @param p.versionRow         that version's row, or null
 * @param p.role               'view' | 'comment' | 'edit' | 'owner'
 * @param p.onComparePictures  ({ file, beforeSha }) — opens DiffView; absent = no button
 * @param p.git                the shell's git bundle; absent = no git part (tests of the picture compare)
 * @param p.children           anything else the host wants in the fold
 */
export function HistoryAdvanced({
  canvas,
  version,
  versionRow = null,
  role = 'edit',
  onComparePictures,
  canView,
  git = null,
  fetchImpl,
  children,
}) {
  // p8-sweep-leftovers — with no version picked, Compare reads the last saved (git HEAD) copy. A project that
  // is not in git has none: the button rests with DiffView's own line instead of opening a 404.
  const noSaved = !version && git?.status?.repo === false;
  const off = !canvas || !canView || noSaved;
  return (
    <div className="vh-adv" data-testid="vh-advanced">
      {onComparePictures ? (
        <div className="vh-adv-row">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="vh-compare-pictures"
            disabled={off}
            {...reasonProps(off, !canvas || !canView ? 'noCanvas' : NO_SAVED_COPY)}
            onClick={() => onComparePictures({ file: canvas, beforeSha: version || 'HEAD' })}
          >
            {CW.button}
          </button>
          <span className="vh-adv-note">{version ? CW.noteVersion : CW.noteSaved}</span>
        </div>
      ) : null}
      {git ? (
        <GitBody
          canvas={canvas}
          version={version}
          versionRow={versionRow}
          role={role}
          canView={canView}
          git={git}
          fetchImpl={fetchImpl}
        />
      ) : null}
      {children}
    </div>
  );
}
