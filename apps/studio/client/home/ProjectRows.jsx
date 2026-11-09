// client/home/ProjectRows.jsx — 2.1.2 Home declutter (canvas 17, artboards 15/16/19): the Projects list as
// one flat list of slim rows. A row is a name, where the project lives (one word or an icon), a state only
// when it isn't fine, and a quiet last-opened time; the folder, the copy on this Mac, the worktrees and the
// account moved into the row's "…" menu. A folder that moved is one quiet row with two ways out: Find the
// folder… or Remove from list. Remove from list takes the project off Home only — nothing on disk changes —
// and waits for the person's yes in a small confirm. The rows come from `home-model.js` `projects`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { reasonProps } from '../v2/access/disabled-reason.js';
import { useDismissOutside } from '../v2/shell/use-dismiss-outside.js';
import { thumbObjectUrl } from './home-api.js';
import { AcctFace, KeptGlyph, StateWord } from './HomeConnection.jsx';
import { HIcon, HSpark } from './home-icons.jsx';
import { relativeTime } from './home-model.js';
import { tildePath } from './home-where-model.js';

/** A Home picture: fetched with the Home header (home-api `thumbObjectUrl`), shown as a blob URL. */
export function Thumb({ src, className }) {
  const [url, setUrl] = useState(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setBroken(false);
    if (src)
      thumbObjectUrl(src).then((u) => {
        if (alive) setUrl(u);
      });
    return () => {
      alive = false;
    };
  }, [src]);
  if (!url || broken) return <span className={`home-thumb home-thumb--empty ${className}`} />;
  return (
    <span className={`home-thumb ${className}`}>
      <img src={url} alt="" decoding="async" onError={() => setBroken(true)} />
    </span>
  );
}

function MoreGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  );
}

/** Where a row lives, in one word: the account face (two Maude Cloud accounts only) or an icon + the word. */
function Lives({ lives, testid }) {
  if (!lives) return <span className="home-prow-lives" />;
  return (
    <span className="home-prow-lives" data-kind={lives.kind} data-testid={testid}>
      {lives.face ? (
        <AcctFace face={{ kind: 'cloud', ...lives.face }} size="sm" />
      ) : lives.kind === 'kept' ? (
        <KeptGlyph size={12} />
      ) : (
        <HIcon name={lives.kind === 'server' ? 'server' : lives.kind} size={12} />
      )}
      <span className="home-prow-lives-w">{lives.word}</span>
    </span>
  );
}

/** A row's state, only when it isn't fine (artboard 19). */
function Flag({ row, id }) {
  const f = row.flag;
  return (
    <span
      className="home-prow-flag"
      data-testid={`home-project-conn-${id}`}
      data-kind={row.connection?.kind ?? undefined}
      data-state={row.conn?.state ?? undefined}
    >
      {f?.kind === 'ai' ? (
        <span
          className="chip chip--spark home-prow-ai"
          data-testid={`home-project-ai-${id}`}
          data-ai="running"
        >
          <HSpark size={9} />
          AI working
        </span>
      ) : f?.kind === 'needs' ? (
        <span
          className="chip chip--accent home-prow-ai"
          data-testid={`home-project-ai-${id}`}
          data-ai="awaiting"
        >
          Needs you
        </span>
      ) : f?.kind === 'signin' ? (
        <StateWord tone="bad" testid={`home-project-state-${id}`}>
          {f.word}
        </StateWord>
      ) : f?.kind === 'away' ? (
        <span className="home-prow-quiet">
          <HIcon name="cloud" size={12} />
          {f.word}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The menu rows of a project's "…" (artboard 19): Open, then the project's group — its account, Show in
 * Finder (its folder), the copy on this Mac and its worktrees — then Remove from list. Pure, so a test reads it.
 * Each item: `{ id, label, note?, act?, testid, info? }`; `info` rows say something and do nothing.
 */
export function projectMenuItems(row) {
  const items = [{ id: 'open', label: 'Open', testid: 'home-project-menu-open', act: 'open' }];
  const group = [];
  const c = row.connection;
  if (c?.kind === 'cloud' || c?.kind === 'team')
    group.push({
      id: 'account',
      label: c.kind === 'cloud' ? 'Maude Cloud' : c.host || 'Your server',
      note: c.account || null,
      testid: 'home-project-menu-account',
      info: true,
    });
  const kept = row.lives?.kind === 'kept';
  if (kept)
    group.push({
      id: 'kept',
      label: 'Kept by Maude',
      note: 'this Mac’s copy',
      testid: 'home-project-menu-kept',
      info: true,
    });
  else if (row.root)
    group.push({
      id: 'reveal',
      label: 'Show in Finder',
      note: tildePath(row.root),
      testid: 'home-project-menu-reveal',
      act: 'reveal',
    });
  for (const cp of row.copies ?? [])
    group.push({
      id: `copy-${cp.pid}`,
      label: cp.kind === 'folder' ? 'Also in a folder' : 'Kept by Maude',
      note: cp.kind === 'folder' ? tildePath(cp.root) : 'this Mac’s copy',
      testid: `home-project-copy-${cp.pid}`,
      aria: cp.kind === 'folder' ? `Open ${cp.label}` : `Open the ${cp.label} of ${row.name}`,
      act: 'open-copy',
      pid: cp.pid,
    });
  for (const w of row.worktrees ?? [])
    group.push({
      id: `wt-${w.pid}`,
      label: w.branch,
      note: 'worktree',
      testid: `home-worktree-${w.pid}`,
      aria: `Open the ${w.branch} worktree of ${row.name}`,
      act: 'open-worktree',
      pid: w.pid,
    });
  if (group.length) items.push({ sep: true, id: 'sep-1', head: row.name }, ...group);
  items.push(
    { sep: true, id: 'sep-2' },
    { id: 'forget', label: 'Remove from list', testid: 'home-project-menu-forget', act: 'forget' }
  );
  return items;
}

function RowMenu({ row, canOpen, onAct, onClose, anchorRef }) {
  const ref = useRef(null);
  const items = projectMenuItems(row);
  const close = useCallback(
    (back = true) => {
      onClose();
      if (back) anchorRef.current?.focus();
    },
    [onClose, anchorRef]
  );
  useEffect(() => {
    ref.current?.querySelector('button[role="menuitem"]:not([disabled])')?.focus();
  }, []);
  useDismissOutside(true, ref, () => close(false));
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const btns = Array.from(
      ref.current?.querySelectorAll('button[role="menuitem"]:not([disabled])') ?? []
    );
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    const n =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? btns.length - 1
          : e.key === 'ArrowDown'
            ? (i + 1) % btns.length
            : (i - 1 + btns.length) % btns.length;
    btns[n]?.focus();
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`More for ${row.name}`}
      className="sh-pm home-prow-menu"
      data-testid="home-project-menu"
      onKeyDown={onKey}
    >
      {items.map((it) => {
        if (it.sep)
          return (
            <div key={it.id} role="none">
              <hr className="sh-pm-sep" />
              {it.head ? <p className="home-prow-menu-h">{it.head}</p> : null}
            </div>
          );
        if (it.info)
          return (
            <div key={it.id} role="none" className="home-prow-menu-info" data-testid={it.testid}>
              <span className="sh-pm-lab">{it.label}</span>
              {it.note ? <span className="home-prow-menu-note">{it.note}</span> : null}
            </div>
          );
        const off = !canOpen && it.act !== 'forget';
        return (
          <div key={it.id} role="none" className="sh-pm-li">
            <button
              type="button"
              role="menuitem"
              className="sh-pm-row"
              data-testid={it.testid}
              aria-label={it.aria}
              disabled={off}
              {...reasonProps(off, 'homeBrowser')}
              onClick={() => {
                close(it.act === 'forget');
                onAct(it);
              }}
            >
              <span className="sh-pm-lab">{it.label}</span>
              {it.note ? (
                <span className="home-prow-menu-note" title={it.note}>
                  {it.note}
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function LocalRow({ row, canOpen, onOpen, onAct }) {
  const [open, setOpen] = useState(false);
  const more = useRef(null);
  const when = relativeTime(row.lastOpenedAt ?? undefined);
  return (
    <li className="home-prow-li" data-menu={open ? 'open' : undefined}>
      <div className="row-item home-prow home-prow--slim">
        <button
          type="button"
          className="home-prow-main"
          data-testid={`home-project-row-${row.pid}`}
          data-place={row.place}
          onClick={() => onOpen(row.pid)}
          disabled={!canOpen}
          {...reasonProps(!canOpen, 'homeBrowser')}
        >
          <Thumb src={row.cover} className="home-prow-thumb" />
          <span className="home-prow-name">
            <strong>{row.name}</strong>
          </span>
          <Lives lives={row.lives} testid={`home-project-where-${row.pid}`} />
          <Flag row={row} id={row.pid} />
          <span className="home-prow-when" data-testid={`home-project-when-${row.pid}`}>
            {when}
          </span>
        </button>
        <button
          type="button"
          ref={more}
          className="icon-btn home-prow-more"
          data-testid={`home-project-more-${row.pid}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`More for ${row.name}`}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <MoreGlyph />
        </button>
      </div>
      {open ? (
        <RowMenu
          row={row}
          canOpen={canOpen}
          anchorRef={more}
          onClose={() => setOpen(false)}
          onAct={(it) => onAct(row, it)}
        />
      ) : null}
    </li>
  );
}

function CloudRow({ row, canOpen, onOpenCloud }) {
  return (
    <li className="home-prow-li">
      <div className="row-item home-prow home-prow--slim home-prow--cloud">
        <button
          type="button"
          className="home-prow-main"
          data-testid={`home-cloud-open-${row.projectId}`}
          onClick={() => onOpenCloud(row)}
          disabled={!canOpen}
          {...reasonProps(!canOpen, 'homeBrowser')}
          aria-label={`Open ${row.name}`}
        >
          <span className="home-thumb home-thumb--empty home-prow-thumb" />
          <span className="home-prow-name" data-testid={`home-cloud-row-${row.projectId}`}>
            <strong>{row.name}</strong>
          </span>
          <Lives lives={row.lives} testid={`home-project-where-${row.projectId}`} />
          <Flag row={row} id={row.projectId} />
          <span className="home-prow-when" />
        </button>
        <span className="home-prow-more-gap" />
      </div>
    </li>
  );
}

function OrphanRow({ row, canOpen, onRelink, onForget }) {
  return (
    <li className="home-prow-li">
      <div
        className="row-item home-prow home-prow--slim home-prow--gone"
        data-testid={`home-project-row-${row.pid}`}
      >
        <span className="home-prow-gone" aria-hidden="true">
          <HIcon name="folder" size={14} />
        </span>
        <span className="home-prow-name home-prow-name--two">
          <strong>{row.name}</strong>
          <span>The folder isn’t where it was.</span>
        </span>
        <span className="home-prow-acts">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`home-relink-${row.pid}`}
            onClick={() => onRelink(row.pid)}
            disabled={!canOpen}
            {...reasonProps(!canOpen, 'homeBrowser')}
          >
            Find the folder…
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`home-project-forget-${row.pid}`}
            onClick={() => onForget(row)}
            disabled={!canOpen}
            {...reasonProps(!canOpen, 'homeBrowser')}
          >
            Remove from list
          </button>
        </span>
      </div>
    </li>
  );
}

/** "Remove <name> from this list?" — the person's yes before anything changes. */
export function ForgetConfirm({ row, busy, onConfirm, onCancel }) {
  const cancel = useRef(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      className="home-link-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-forget-t"
      data-testid="home-forget-dialog"
    >
      <div className="home-link-scrim" aria-hidden="true" onClick={onCancel} />
      <div className="island home-link-dialog">
        <h2 id="home-forget-t">Remove {row.name} from this list?</h2>
        <p>The folder and its files stay where they are.</p>
        <div className="home-link-foot">
          <button
            type="button"
            ref={cancel}
            className="btn"
            data-testid="home-forget-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="home-forget-confirm"
            disabled={busy}
            onClick={onConfirm}
          >
            Remove from list
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The list. `onForget(pids)` resolves `{ ok }` once Rust took them off; `onReveal(pid)` shows the folder.
 * @param {{ rows: object[], canOpen: boolean, onOpen: (pid: string) => void,
 *   onOpenWorktree: (pid: string) => void, onRelink: (pid: string) => void,
 *   onOpenCloud: (row: object) => void, onReveal: (pid: string) => void,
 *   onForget: (pids: string[]) => Promise<unknown> }} props
 */
export function ProjectList({
  rows,
  canOpen,
  onOpen,
  onOpenWorktree,
  onRelink,
  onOpenCloud,
  onReveal,
  onForget,
}) {
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const act = useCallback(
    (row, it) => {
      if (it.act === 'open') onOpen(row.pid);
      else if (it.act === 'reveal') onReveal(row.pid);
      else if (it.act === 'open-copy') onOpen(it.pid);
      else if (it.act === 'open-worktree') onOpenWorktree(it.pid);
      else if (it.act === 'forget') setAsking(row);
    },
    [onOpen, onReveal, onOpenWorktree]
  );
  const confirm = useCallback(async () => {
    if (!asking) return;
    setBusy(true);
    try {
      await onForget(asking.pids?.length ? asking.pids : [asking.pid]);
    } finally {
      setBusy(false);
      setAsking(null);
    }
  }, [asking, onForget]);
  return (
    <>
      <ul className="home-prows home-prows--slim" data-testid="home-project-list">
        {rows.map((r) =>
          r.kind === 'cloud' ? (
            <CloudRow
              key={`c:${r.profile}:${r.projectId}`}
              row={r}
              canOpen={canOpen}
              onOpenCloud={onOpenCloud}
            />
          ) : r.status === 'gone' ? (
            <OrphanRow
              key={r.pid}
              row={r}
              canOpen={canOpen}
              onRelink={onRelink}
              onForget={setAsking}
            />
          ) : (
            <LocalRow key={r.pid} row={r} canOpen={canOpen} onOpen={onOpen} onAct={act} />
          )
        )}
      </ul>
      {asking ? (
        <ForgetConfirm
          row={asking}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}
