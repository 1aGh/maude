// client/v2/comments/comments-panel.jsx — S9.22: the Comments panel (10 · co-comment-thread).
//
// Replaces client/shell/comments-panel.jsx (which now re-exports this, so every import and every old
// test id keeps answering). CONTRACT §6: filters Open · Mine · Resolved · All (default Open), grouped by
// canvas, Reopen in a resolved thread, "Delete comment" on your own. The rules are comments-model.js;
// this is the view.
//
// Test ids kept: comment-filter-all|open|resolved, comment-item-<id>. New: comments-panel,
// comment-filter-mine, comment-group-<slug>, comment-resolve-<id>, comment-reopen-<id>,
// comment-delete-<id>, comment-where-<id>, comment-from-<id> (S4-S9 §3.4).

import { useEffect, useState } from 'react';
import { Kbd, StIcon, initialsOf } from '../../shell/icons.jsx';
import { basename, displayName } from '../../shell/util.js';
import {
  FILTERS,
  FILTER_LABELS,
  asFilter,
  countsOf,
  groupThreads,
  onLabel,
  repliesWord,
} from './comments-model.js';

/** Test-id slug of a canvas path (`.design/ui/a b.tsx` → `a-b`). */
export const groupSlug = (file) =>
  displayName(basename(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'canvas';

const EMPTY = Object.freeze({
  open: 'No open comments.',
  mine: 'You have not started a comment.',
  resolved: 'No resolved comments.',
  all: 'No comments yet.',
});

let meOnce = null;
/** The viewer's display name — the same identity a new comment is signed with. Asked once per page. */
function useMe(given) {
  const [name, setName] = useState(given ?? null);
  useEffect(() => {
    if (given != null || typeof fetch === 'undefined') return undefined;
    meOnce ??= fetch('/_api/git-user')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (typeof j?.name === 'string' && j.name.trim() ? j.name.trim() : null))
      .catch(() => null);
    let alive = true;
    void meOnce.then((n) => alive && setName(n));
    return () => {
      alive = false;
    };
  }, [given]);
  return given ?? name;
}

function RowActions({ t, onResolve, onReopen, onDelete }) {
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn(t.id);
  };
  const canDelete = !!onDelete && t.mine;
  if (!(onResolve && onReopen) && !canDelete) return null;
  return (
    <span className="cmp-acts">
      {onResolve && onReopen ? (
        t.resolved ? (
          <button
            type="button"
            className="cmp-act"
            aria-label="Reopen"
            title="Reopen"
            data-testid={`comment-reopen-${t.id}`}
            onClick={stop(onReopen)}
          >
            <StIcon name="reopen" size={14} />
            <span>Reopen</span>
          </button>
        ) : (
          <button
            type="button"
            className="cmp-act"
            aria-label="Resolve"
            title="Resolve"
            data-testid={`comment-resolve-${t.id}`}
            onClick={stop(onResolve)}
          >
            <StIcon name="resolve" size={14} />
          </button>
        )
      ) : null}
      {canDelete ? (
        <button
          type="button"
          className="cmp-act"
          aria-label="Delete comment"
          title="Delete comment"
          data-testid={`comment-delete-${t.id}`}
          onClick={stop(onDelete)}
        >
          <StIcon name="x" size={14} />
        </button>
      ) : null}
    </span>
  );
}

export function CommentsPanel({
  commentsByFile,
  filter,
  setFilter,
  activePath,
  focusedId,
  onJump,
  onResolve,
  onReopen,
  onDelete,
  onClose,
  me: meProp,
  artboardLabel,
  now,
  width,
  resizing,
}) {
  const me = useMe(meProp);
  const active = asFilter(filter);
  const counts = countsOf(commentsByFile, me);
  const groups = groupThreads(commentsByFile, active, { me, activePath, now });
  const canvasLabel = (file) => displayName(basename(file));

  return (
    <aside
      className={`st-rpanel cmp${resizing ? ' is-resizing' : ''}`}
      style={width ? { width, flexBasis: width } : undefined}
      aria-label="Comments"
      data-testid="comments-panel"
    >
      <div className="cmp-hd">
        <span className="cmp-title">Comments</span>
        {onClose ? (
          <button
            type="button"
            className="cmp-x"
            aria-label="Hide Comments"
            title="Hide Comments"
            data-testid="comments-panel-close"
            onClick={onClose}
          >
            <StIcon name="x" size={14} />
          </button>
        ) : null}
      </div>
      <div className="cmp-seg" role="tablist" aria-label="Show">
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`cmp-seg-b${active === id ? ' is-active' : ''}`}
            data-testid={`comment-filter-${id}`}
            aria-selected={active === id}
            onClick={() => setFilter?.(id)}
          >
            {FILTER_LABELS[id]} <span className="cmp-n">{counts[id]}</span>
          </button>
        ))}
      </div>
      <div className="cmp-body">
        {groups.length === 0 ? (
          <div className="cmp-empty" data-testid="comments-empty">
            <p>{EMPTY[active]}</p>
            {active !== 'resolved' ? (
              <p>
                Press <Kbd>C</Kbd>, then click where it belongs.
              </p>
            ) : null}
          </div>
        ) : (
          groups.map((g) => (
            <section
              key={g.file}
              className="cmp-group"
              data-testid={`comment-group-${groupSlug(g.file)}`}
            >
              <button
                type="button"
                className="cmp-group-hd"
                onClick={() => onJump?.(g.file, null)}
                title={g.file}
              >
                <span>{canvasLabel(g.file)}</span>
                <span className="cmp-n">{g.threads.length}</span>
              </button>
              {g.threads.map((t) => {
                const on = onLabel(t, { artboardLabel, canvasLabel: canvasLabel(g.file) });
                const ai = t.authorKind === 'ai';
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a row that holds buttons cannot itself be a <button>
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    data-testid={`comment-item-${t.id}`}
                    className={`cmp-row${t.resolved ? ' is-resolved' : ''}${t.id === focusedId ? ' is-active' : ''}`}
                    aria-current={t.id === focusedId ? 'true' : undefined}
                    onClick={() => onJump?.(g.file, t.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onJump?.(g.file, t.id);
                      }
                    }}
                  >
                    <span className={`cmp-av${ai ? ' is-ai' : ''}`} aria-hidden="true">
                      {ai ? 'AI' : initialsOf(t.author)}
                    </span>
                    <span className="cmp-txt">
                      {on ? (
                        <span className="cmp-on" data-testid={`comment-where-${t.id}`}>
                          {on}
                        </span>
                      ) : null}
                      <span className="cmp-body-t">{t.text}</span>
                      <span className="cmp-meta">
                        {[t.time, t.replies ? repliesWord(t.replies) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <RowActions
                      t={t}
                      onResolve={onResolve}
                      onReopen={onReopen}
                      onDelete={onDelete}
                    />
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
