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
import { StIcon } from '../../shell/icons.jsx';
import { Spark } from '../ai/icons.jsx';
import { Person } from '../share/person.jsx';
import { basename, displayName } from '../../shell/util.js';
import { rovingTabKey } from '../shell/modal-focus.js';
import { Confetti, copy, Empty } from '../empty/index.js';
import { fetchMentionPeople } from './comment-client.js';
import {
  FILTERS,
  FILTER_LABELS,
  asFilter,
  countsOf,
  emptyKind,
  groupThreads,
  namesLine,
  onLabel,
  repliesWord,
} from './comments-model.js';

/** Test-id slug of a canvas path (`.design/ui/a b.tsx` → `a-b`). */
export const groupSlug = (file) =>
  displayName(basename(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'canvas';

/** A filter that is empty while other comments exist (05 has no drawing for these two; plain words). */
const FILTER_EMPTY = Object.freeze({
  mine: 'You have not started a comment.',
  resolved: 'No resolved comments.',
});

/**
 * The other people on the project, by name — only asked for a viewer who can comment and only while the
 * panel is empty, so the empty line can say who sees a comment right away. Never an address (mentionRows).
 * `null` until the answer is in; an unanswered or failed read is `[]` (the plain line is used instead).
 */
function useOthers(wanted, me) {
  const [names, setNames] = useState([]);
  useEffect(() => {
    if (!wanted || typeof fetch === 'undefined') return undefined;
    let alive = true;
    void fetchMentionPeople('', me).then((rows) => {
      if (alive) setNames(rows ? rows.map((r) => r.name) : []);
    });
    return () => {
      alive = false;
    };
  }, [wanted, me]);
  return names;
}

/** No thread is listed (05 · es-panels-canvas, es-viewer). `kind` is `emptyKind`. */
function EmptyComments({ kind, active, canvas, names, onShare }) {
  if (kind === 'done') {
    return (
      <div className="cmp-party">
        <Confetti id="cmp-confetti-done" shift={[60, 100]} />
        <Empty
          spot="done"
          spotW={168}
          land
          copyId="es-panels-canvas.comments-done"
          vars={{ canvas }}
          testid="comments-empty"
        />
      </div>
    );
  }
  if (kind === 'none') {
    const viewer = names.length > 0;
    const id = viewer ? 'es-viewer.viewer-comments-none' : 'es-panels-canvas.comments-none';
    const vars = { canvas, names: namesLine(names) };
    return (
      <Empty
        spot="comment"
        spotW={168}
        copyId={id}
        vars={vars}
        testid="comments-empty"
        actions={
          !viewer && onShare ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="comments-share"
              onClick={onShare}
            >
              <StIcon name="share" size={14} />
              {copy(id, vars).action}
            </button>
          ) : null
        }
      />
    );
  }
  return (
    <Empty
      glyph="comment"
      testid="comments-empty"
      title={FILTER_EMPTY[active] ?? FILTER_EMPTY.resolved}
      next={active === 'resolved' ? undefined : 'Press [[C]], then click where it belongs.'}
    />
  );
}

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
  onShare,
  viewer = false,
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
  const kind = emptyKind(active, counts);
  const others = useOthers(viewer && groups.length === 0 && kind === 'none', me);

  return (
    <aside
      className={`sh-rpanel cmp${resizing ? ' is-resizing' : ''}`}
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
      {/* WAI-ARIA tabs: ←/→ move AND select, Home / End, one tab stop (the kit's roving pattern) */}
      <div
        className="cmp-seg"
        role="tablist"
        aria-label="Show"
        onKeyDown={(e) => rovingTabKey(e, FILTERS, active, (id) => setFilter?.(id))}
      >
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`cmp-seg-b${active === id ? ' is-active' : ''}`}
            data-testid={`comment-filter-${id}`}
            aria-selected={active === id}
            tabIndex={active === id ? 0 : -1}
            onClick={() => setFilter?.(id)}
          >
            {FILTER_LABELS[id]} <span className="cmp-n">{counts[id]}</span>
          </button>
        ))}
      </div>
      <div className="cmp-body">
        {groups.length === 0 ? (
          <EmptyComments
            kind={kind}
            active={active}
            canvas={activePath ? canvasLabel(activePath) : 'this canvas'}
            names={others}
            onShare={onShare}
          />
        ) : (
          groups.map((g) => (
            <section
              key={g.file}
              className="cmp-group"
              data-testid={`comment-group-${groupSlug(g.file)}`}
            >
              {g.file === activePath ? (
                // the canvas that is open has nothing to open: a title, not a button that does nothing
                <div className="cmp-group-hd" title={g.file}>
                  <span>{canvasLabel(g.file)}</span>
                  <span className="cmp-n">{g.threads.length}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="cmp-group-hd"
                  onClick={() => onJump?.(g.file, null)}
                  title={g.file}
                >
                  <span>{canvasLabel(g.file)}</span>
                  <span className="cmp-n">{g.threads.length}</span>
                </button>
              )}
              {g.threads.map((t) => {
                const on = onLabel(t, { artboardLabel, canvasLabel: canvasLabel(g.file) });
                const ai = t.authorKind === 'ai';
                return (
                  // gate-b-a11y (axe nested-interactive): the row is NOT itself a button — a `role=button` row
                  // that holds the Resolve / menu buttons has focusable descendants. The row is a plain
                  // container (a click anywhere on it still opens the thread, for the pointer); the keyboard's
                  // way in is the real <button> that holds the avatar and the words.
                  // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pointer convenience; the .cmp-open button is the keyboard path
                  <div
                    key={t.id}
                    data-testid={`comment-item-${t.id}`}
                    className={`cmp-row${t.resolved ? ' is-resolved' : ''}${t.id === focusedId ? ' is-active' : ''}`}
                    aria-current={t.id === focusedId ? 'true' : undefined}
                    onClick={() => onJump?.(g.file, t.id)}
                  >
                    <button
                      type="button"
                      className="cmp-open"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJump?.(g.file, t.id);
                      }}
                    >
                      {ai ? (
                        <span className="cmp-av is-ai" aria-hidden="true">
                          <Spark size={12} />
                        </span>
                      ) : t.importedLabel ? (
                        <span className="cmp-av is-imported" aria-hidden="true" />
                      ) : (
                        // 10 co-comment-thread: a tone-filled face with one letter, the colour a person
                        // wears everywhere (Share sheet, presence, conflict card)
                        <Person name={t.author} you={!!me && t.author === me} size="md" />
                      )}
                      <span className="cmp-txt">
                        {on ? (
                          <span className="cmp-on" data-testid={`comment-where-${t.id}`}>
                            {on}
                          </span>
                        ) : null}
                        <span className="cmp-body-t">{t.text}</span>
                        <span className="cmp-meta">
                          {[t.importedLabel, t.time, t.replies ? repliesWord(t.replies) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
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
