// client/v2/history/git-parts.jsx — S11.10: the pieces of Version history › Advanced (06 · ad-history).
//
// Presentational: every one takes what it shows and what it calls. The words are git-model.js's; the requests
// are git-advanced.jsx's. Classes are `vh-git-*` (history.css).

import { useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import {
  GIT_WORDS as W,
  chatGuardCopy,
  discardConfirm,
  saveState,
  slugifyBranch,
  unitCheck,
} from './git-model.js';

export function GitRow({ k, children, mono = false, testid }) {
  return (
    <div className="vh-git-row" data-testid={testid}>
      <span className="vh-git-k">{k}</span>
      <span className={`vh-git-v${mono ? ' is-mono' : ''}`}>{children}</span>
    </div>
  );
}

export function GitSub({ children, aside }) {
  return (
    <p className="vh-git-sub">
      {children}
      {aside ? <span className="vh-git-sub-a">{aside}</span> : null}
    </p>
  );
}

export function Badge({ kind, title }) {
  return (
    <span
      className={`vh-git-badge is-${kind}`}
      title={title ? `${title} — not in a version yet` : undefined}
    >
      {kind}
    </span>
  );
}

/** Copy the remote; the label flips to "Copied" for a moment. */
export function CopyButton({ text, testid }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      data-testid={testid}
      aria-label={`${W.copy} ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          /* clipboard blocked — the address is on screen to select */
        }
      }}
    >
      {done ? W.copied : W.copy}
    </button>
  );
}

/** A check that can show "some" (React has no prop for indeterminate). */
function TriCheck({ state, onChange, ariaLabel }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="vh-git-check"
      checked={state === 'all'}
      onChange={onChange}
      aria-label={ariaLabel}
    />
  );
}

/** A banner under the fold's head: a result, a warning, or an offer (Get latest after a publish conflict). */
export function Banner({ banner, busy, onGetLatest, onDismiss }) {
  if (!banner) return null;
  return (
    <div
      className={`callout callout--${banner.variant} vh-git-banner`}
      role="status"
      aria-live="polite"
    >
      <span className="vh-git-banner-t">
        {banner.title ? <strong>{banner.title}</strong> : null}
        {banner.text}
        {banner.getLatest ? (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="git-get-latest"
            disabled={!!busy}
            onClick={onGetLatest}
          >
            {W.getLatest}
          </button>
        ) : null}
      </span>
      <button type="button" className="vh-git-x" aria-label={W.dismiss} onClick={onDismiss}>
        <StIcon name="x" size={12} />
      </button>
    </div>
  );
}

/** "Not in a version yet": one row per canvas (its sidecars travel with it), Compare, Discard. */
export function UnsavedList({ units, canWrite, busy, onOpen, onCompare, onDiscard }) {
  if (!units.length)
    return (
      <p className="vh-git-none" data-testid="vh-git-notyet">
        {W.notYetNone}
      </p>
    );
  return (
    <ul className="vh-git-ul" data-testid="vh-git-notyet" aria-label={W.notYet}>
      {units.map((u) => (
        <li className="vh-git-unit" key={u.key}>
          <Badge kind={u.badge} title={u.badgeTitle} />
          <button
            type="button"
            className="vh-git-file"
            title={u.path}
            onClick={() => onOpen?.(u.path)}
          >
            <span className="vh-git-fname">{u.name}</span>
            <span className="vh-git-fpath">
              {u.supporting.length ? `${u.path} · +${u.supporting.length} supporting` : u.path}
            </span>
          </button>
          {u.comparable && onCompare ? (
            <button
              type="button"
              className="icon-btn"
              data-testid="git-compare"
              title={W.compareFile}
              aria-label={`${W.compareFile}: ${u.name}`}
              onClick={() => onCompare(u.path)}
            >
              <StIcon name="eye" size={13} />
            </button>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="git-discard"
              disabled={!!busy}
              aria-label={`${W.discard} changes to ${u.name}`}
              onClick={() => {
                if (!window.confirm(discardConfirm(u))) return;
                onDiscard(u);
              }}
            >
              {W.discard}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** "Changed in this version": the file, +14 −6, and the lines. */
export function ChangedList({ state }) {
  if (state.status === 'loading') return <p className="vh-git-none">{W.loading}</p>;
  if (state.status === 'none') return <p className="vh-git-none">{W.changedUnavailable}</p>;
  const c = state.line;
  if (!c) return <p className="vh-git-none">{W.changedNone}</p>;
  return (
    <div data-testid="vh-git-changed">
      <div className="vh-git-chg" data-testid="vh-git-changed-file">
        <Badge kind={c.badge} />
        <span className="vh-git-mono" title={c.path}>
          {c.path}
        </span>
        {c.approx ? <em className="vh-git-mono">{`~${c.add} lines`}</em> : null}
        {!c.approx && c.add ? <em className="vh-git-mono is-add">{`+${c.add}`}</em> : null}
        {!c.approx && c.del ? <em className="vh-git-mono is-del">{`−${c.del}`}</em> : null}
      </div>
      {c.lines.length ? (
        <div className="vh-git-diff vh-git-mono" data-testid="vh-git-diff">
          {c.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a diff line has no identity beyond its place
            <span key={i} className={l.k === '+' ? 'is-add' : 'is-del'}>
              {l.k === '+' ? '+  ' : '−  '}
              {l.t}
            </span>
          ))}
          {c.more ? <span className="vh-git-more">{`… ${c.more} more lines`}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** "Every version, with its id": a git commit reads author · id; a project revision reads Preview / Restore / Undo. */
export function VersionList({
  state,
  rows,
  canWrite,
  activeName,
  onPreview,
  onRestore,
  onUndo,
  onRetry,
  onDone,
}) {
  if (state === 'loading') return <p className="vh-git-none">{W.loading}</p>;
  if (state === 'failed')
    return (
      <div
        className="callout callout--warning vh-git-banner"
        role="status"
        data-testid="git-history-unreachable"
      >
        <span className="vh-git-banner-t">
          <strong>{W.historyUnreachable}</strong>
          {W.historyUnreachableSub}
          <button
            type="button"
            className="btn btn--sm"
            data-testid="git-history-retry"
            onClick={onRetry}
          >
            {W.retry}
          </button>
        </span>
      </div>
    );
  if (!rows.length)
    return <p className="vh-git-none">{state === 'cloud' ? W.noVersionsCloud : W.noVersions}</p>;
  return (
    <ul className="vh-git-ul" data-testid="vh-git-versions" aria-label={W.everyVersion}>
      {rows.map((r) => (
        <VersionItem
          key={r.key}
          row={r}
          canWrite={canWrite}
          activeName={activeName}
          onPreview={onPreview}
          onRestore={onRestore}
          onUndo={onUndo}
          onDone={onDone}
        />
      ))}
    </ul>
  );
}

function VersionItem({ row, canWrite, activeName, onPreview, onRestore, onUndo, onDone }) {
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const a = row.accepted;
  const run = async (kind, fn) => {
    setBusy(kind);
    setNote(null);
    const ok = await fn();
    setBusy(null);
    setNote(
      ok
        ? kind === 'restore'
          ? W.restored
          : W.undone
        : kind === 'restore'
          ? W.restoreFailed
          : W.undoFailed
    );
    if (ok) onDone?.();
  };
  const canPreview = !!onPreview && !!activeName;
  return (
    <li
      className="vh-git-ver"
      data-testid={a ? `project-history-row-${a.revision}` : `vh-git-version-${row.key}`}
    >
      <span className="vh-git-ver-b">
        <span className="vh-git-ver-t">{row.title}</span>
        <span className="vh-git-ver-m vh-git-mono">{row.meta}</span>
        {note ? (
          <span className="vh-git-ver-m" role="status" aria-live="polite">
            {note}
          </span>
        ) : null}
      </span>
      <span className="vh-git-ver-w">{row.when}</span>
      <span className="vh-git-ver-a">
        {canPreview ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            data-testid={a ? `project-history-preview-${a.revision}` : undefined}
            title={`${W.preview} ${activeName} at this version`}
            onClick={() => onPreview(row.sha)}
          >
            {W.preview}
          </button>
        ) : null}
        {a && canPreview && canWrite && onRestore ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            data-testid={`project-history-restore-${a.revision}`}
            disabled={busy !== null}
            title={`Make ${activeName} look like this version again (adds a new version)`}
            onClick={() => run('restore', () => onRestore(a.revision))}
          >
            {busy === 'restore' ? W.restoring : W.restore}
          </button>
        ) : null}
        {a?.mine && !a.undone && canWrite && onUndo ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            data-testid={`project-history-undo-${a.revision}`}
            disabled={busy !== null}
            title="Undo this change of yours (a teammate's later edits are kept)"
            onClick={() => run('undo', () => onUndo(a.actionId))}
          >
            {busy === 'undo' ? W.undoing : W.undo}
          </button>
        ) : null}
      </span>
    </li>
  );
}

// ── dialogs ──────────────────────────────────────────────────────────────────────────────────────────────────

function Dialog({ id, testid, title, onClose, children, initialRef, onSubmit }) {
  const ref = useModalFocus({ onClose, initialRef });
  return (
    <div className="vh-scrim">
      <form
        ref={ref}
        className="island vh-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        data-testid={testid}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <h2 id={`${id}-title`} className="vh-dialog-t">
          {title}
        </h2>
        {children}
      </form>
    </div>
  );
}

/** "Save a version with a note…": the note, the files (a canvas and its sidecars are one row), Save / Save all. */
export function SaveDialog({ units, onSave, onSaveAll, onClose }) {
  const [message, setMessage] = useState('');
  const [unchecked, setUnchecked] = useState(() => new Set());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const noteRef = useRef(null);
  const { paths, canSave, canSaveAll } = saveState({ message, units, unchecked, busy });
  const toggle = (u) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      const on = unitCheck(u, prev) === 'all';
      for (const p of u.paths) {
        if (on) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  const allPaths = units.flatMap((u) => u.paths);
  const run = async (kind, fn) => {
    setBusy(kind);
    setError('');
    const res = await fn(message.trim());
    setBusy(null);
    if (res?.ok) onClose();
    else setError(res?.error || W.errGeneric);
  };
  return (
    <Dialog
      id="vh-git-save"
      testid="vh-git-save-dialog"
      title={W.saveTitle}
      onClose={onClose}
      initialRef={noteRef}
      onSubmit={() => canSave && run('save', (m) => onSave(m, paths))}
    >
      <textarea
        ref={noteRef}
        className="vh-field vh-git-note"
        data-testid="git-commit-message"
        placeholder={W.savePlaceholder}
        aria-label={W.saveField}
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <label className="vh-git-selectall">
        <input
          type="checkbox"
          className="vh-git-check"
          checked={paths.length === allPaths.length && allPaths.length > 0}
          onChange={() => setUnchecked(unchecked.size === 0 ? new Set(allPaths) : new Set())}
          aria-label={W.selectAll}
        />
        {paths.length} of {allPaths.length} selected
      </label>
      <ul className="vh-git-ul">
        {units.map((u) => (
          <li className="vh-git-unit" key={u.key}>
            <TriCheck
              state={unitCheck(u, unchecked)}
              ariaLabel={`Include ${u.name}${u.supporting.length ? ' and its supporting files' : ''} in this version`}
              onChange={() => toggle(u)}
            />
            <Badge kind={u.badge} title={u.badgeTitle} />
            <span className="vh-git-file">
              <span className="vh-git-fname">{u.name}</span>
              <span className="vh-git-fpath">
                {u.supporting.length ? `${u.path} · +${u.supporting.length} supporting` : u.path}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {!canSave && !busy ? <p className="vh-dialog-sub">{W.saveHint}</p> : null}
      {error ? (
        <p className="vh-dialog-err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="vh-dialog-btns">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={!!busy}>
          {W.cancel}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          data-testid="git-save-all"
          title="Save every change"
          disabled={!canSaveAll}
          onClick={() => run('saveAll', (m) => onSaveAll(m))}
        >
          {W.saveAll}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          data-tour="save-local"
          disabled={!canSave}
          aria-disabled={!canSave}
        >
          {W.saveTitle}
        </button>
      </div>
    </Dialog>
  );
}

/** "New branch…". */
export function BranchDialog({ shared, error, busy, onCreate, onClose }) {
  const [name, setName] = useState('');
  const inputRef = useRef(null);
  const slug = slugifyBranch(name);
  return (
    <Dialog
      id="vh-git-branch"
      testid="vh-git-branch-dialog"
      title={W.newBranchTitle}
      onClose={onClose}
      initialRef={inputRef}
      onSubmit={() => slug && !busy && onCreate(name)}
    >
      <label className="vh-git-field">
        <span className="vh-dialog-sub">{W.newBranchField}</span>
        <input
          ref={inputRef}
          className="vh-field"
          type="text"
          data-testid="switcher-new-branch-input"
          value={name}
          placeholder={W.newBranchPlaceholder}
          aria-label="Branch name"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {slug ? (
        <p className="vh-dialog-sub">
          Creates branch <b>{slug}</b>
        </p>
      ) : null}
      {error ? (
        <p className="vh-dialog-err" role="alert">
          {error}
        </p>
      ) : null}
      <p className="vh-dialog-sub">{W.newBranchHint(shared)}</p>
      <div className="vh-dialog-btns">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
          {W.cancel}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="switcher-new-branch-create"
          disabled={busy || !slug}
        >
          {busy ? W.newBranchCreating : W.newBranchCreate}
        </button>
      </div>
    </Dialog>
  );
}

/** "Add to main · opens a pull request": the confirm, then the result (a link, or a heads-up). */
export function AddDialog({
  branch,
  shared,
  folding,
  error,
  prResult,
  prCopied,
  onAdd,
  onReview,
  onClose,
}) {
  const ref = useRef(null);
  return (
    <Dialog
      id="vh-git-add"
      testid="vh-git-add-dialog"
      title={
        prResult
          ? prResult.url
            ? W.prOpened(prResult.number)
            : W.prPublishedTitle
          : W.addTitle(shared)
      }
      onClose={onClose}
      initialRef={ref}
      onSubmit={() => !prResult && !folding && onAdd()}
    >
      {prResult ? (
        prResult.url ? (
          <>
            <p className="vh-dialog-sub">{W.prBody(branch, shared, prResult.repo)}</p>
            <p className="vh-dialog-sub vh-git-mono">{prResult.url}</p>
            <div className="vh-dialog-btns">
              <button type="button" className="btn btn--ghost" ref={ref} onClick={onClose}>
                {W.prClose}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="switcher-pr-link"
                onClick={() => onReview(prResult.url)}
              >
                {prCopied ? W.prCopied : W.prReview}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="vh-dialog-sub">{prResult.message}</p>
            <div className="vh-dialog-btns">
              <button
                type="button"
                className="btn btn--primary"
                ref={ref}
                data-testid="switcher-pr-dismiss"
                onClick={onClose}
              >
                {W.prGotIt}
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <p className="vh-dialog-sub">{W.addBody(branch, shared)}</p>
          <p className="vh-dialog-sub">{W.addMeta}</p>
          {error ? (
            <p className="vh-dialog-err" role="alert">
              {error}
            </p>
          ) : null}
          <div className="vh-dialog-btns">
            <button type="button" className="btn btn--ghost" ref={ref} onClick={onClose}>
              {W.cancel}
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              data-testid="switcher-merge-confirm"
              disabled={!!folding}
            >
              {folding ? W.adding : W.addTitle(shared)}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** A chat is mid-turn and the person asked for something that moves the worktree (D10). */
export function GuardDialog({ guard, branch, onConfirm, onCancel }) {
  const copy = chatGuardCopy({ count: guard.count, branch, verb: guard.verb });
  const ref = useRef(null);
  return (
    <Dialog
      id="vh-git-guard"
      testid="switcher-chat-guard"
      title={copy.title}
      onClose={onCancel}
      initialRef={ref}
    >
      <p className="vh-dialog-sub">{copy.body}</p>
      <p className="vh-dialog-sub">{copy.meta}</p>
      <div className="vh-dialog-btns">
        <button
          type="button"
          className="btn btn--ghost"
          ref={ref}
          data-testid="switcher-chat-guard-cancel"
          onClick={onCancel}
        >
          {copy.cancel}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          data-testid="switcher-chat-guard-confirm"
          onClick={onConfirm}
        >
          {copy.confirm}
        </button>
      </div>
    </Dialog>
  );
}
