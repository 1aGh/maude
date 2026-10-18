// client/v2/history/history-panel.jsx — S1.14: Version history (11 · pn-history, 05 · es-panels-canvas; ⌥⌘H).
//
//   header · All / Named / Made by AI / People · Now row (+ Name this version…) · Today / Yesterday / 4 Oct …
//   rows with a picture, a face or the spark, the words, a chip · click = look at it (the shell's Viewing hold)
//   the selected row: Compare (S1.15) · Restore this version (edit only; Can view looks, never restores)
//   foot: Advanced (the git body, until S1.15 / S11 re-home it)
//
// The rows are the server's (rule G); this file draws them and sends three things back: look (`onView`),
// restore (one new version + a toast with Undo) and name — both built by history/surface-requests.ts, the one
// source the `maude design history …` verbs share.
// S1.16: with a `scope` (openHistory in object-filter.js) the body is ONE object's versions (object-view.jsx),
// the header says "· this object" and "All versions" lifts the filter.
// Everything here is judged again on the server (§5.12): hiding Restore from a viewer is presentation.

import { useCallback, useRef, useState } from 'react';
import { initialsOf, Kbd, StIcon } from '../../shell/icons.jsx';
import { shellToast } from '../../shell/util.js';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { NameDialog } from './name-dialog.jsx';
import { OBJECT_WORDS as OW } from './object-filter.js';
import { ObjectHistoryView } from './object-view.jsx';
import { nowRow } from './rows.ts';
import {
  dayGroups,
  FILTERS,
  HISTORY_WORDS as W,
  nameVersion,
  restoreVersion,
  useVersions,
  viewingWords,
} from './use-versions.js';
import { HistoryGlyph } from './view-bar.jsx';

function Picture({ row }) {
  const p = row.picture;
  if (p?.status === 'ready' && p.url)
    return (
      <span className="vh-pic" data-state="ready" aria-hidden="true">
        <img src={p.url} alt="" loading="lazy" draggable="false" />
      </span>
    );
  return (
    <span
      className="vh-pic"
      data-state={p?.status === 'pending' ? 'pending' : 'none'}
      aria-hidden="true"
    />
  );
}

function Face({ row }) {
  if (row.who?.kind === 'ai')
    return (
      <span className="vh-ai" aria-label="AI">
        <StIcon name="sparkle" size={10} />
      </span>
    );
  if (row.who?.kind === 'outside') return null;
  return (
    <span className="vh-face" aria-hidden="true">
      {initialsOf(row.who?.name)}
    </span>
  );
}

function Row({ row, selected, canEdit, restoring, onView, onRestore, onCompare }) {
  return (
    <li className="vh-item">
      <button
        type="button"
        className={`vh-row${row.named ? ' is-named' : ''}${selected ? ' is-sel' : ''}`}
        aria-current={selected ? 'true' : undefined}
        data-testid={`vh-row-${row.ref}`}
        data-ref={row.ref}
        onClick={() => onView(row)}
      >
        <Picture row={row} />
        <span className="vh-t">
          <strong>{row.title}</strong>
          <span>
            <Face row={row} />
            {row.sub}
          </span>
        </span>
        {row.chips?.map((c) => (
          <span key={c} className={`chip${c === 'Made by AI' ? ' chip--spark' : ''}`}>
            {c}
          </span>
        ))}
      </button>
      {selected ? (
        <span className="vh-acts" data-testid="vh-acts">
          {onCompare ? (
            <button
              type="button"
              className="btn btn--sm"
              data-testid="vh-compare"
              onClick={() => onCompare(row)}
            >
              {W.compare}
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              data-testid="vh-restore"
              disabled={restoring}
              onClick={() => onRestore(row)}
            >
              {restoring ? W.restoring : W.restore}
            </button>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

/**
 * @param p.path            the open canvas (repo-relative); null = none open
 * @param p.canvasLabel     its name, for the Now row
 * @param p.canEdit         the session may name and restore on this canvas
 * @param p.viewing         the shell hold `{ path, at, … }` or null
 * @param p.onView          (words: { at, title, when, who }) → the shell looks at that version
 * @param p.onLeaveViewing  back to now
 * @param p.onChanged       a version landed (name / restore / undo): the shell refreshes what shows it
 * @param p.refreshKey      anything that says a version may have landed
 * @param p.onCompare       (row) — S1.15's Compare; absent = no button
 * @param p.scope           S1.16 — `{ path, key, tail }` when the panel is filtered to one object, else null
 * @param p.onClearScope    "All versions"
 * @param p.advanced        the Advanced fold's body (the git body until S11 re-words it)
 */
export function VersionHistoryPanel({
  path,
  canvasLabel = '',
  canEdit = false,
  viewing = null,
  onView,
  onLeaveViewing,
  onChanged,
  refreshKey = 0,
  onClose,
  onCompare,
  scope = null,
  onClearScope,
  advanced = null,
  toast = shellToast,
  fetchImpl,
  nowMs,
  resizing = false,
}) {
  const scoped = scope && scope.path === path ? scope : null;
  const [learned, setLearned] = useState(null);
  const tail =
    (scoped && learned?.key === scoped.key ? learned.tail : null) ?? scoped?.tail ?? 'this object';
  const [filter, setFilter] = useState('all');
  const [naming, setNaming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const v = useVersions({ path, filter, refreshKey, fetchImpl, enabled: !scoped });
  const listRef = useRef(null);
  const sel = viewing && viewing.path === path ? viewing.at : null;

  const now = v.now
    ? nowRow({
        canvas: v.now.canvas,
        canvasLabel,
        status: v.now.status || 'Saved',
        newestRev: v.now.ref ? Number(String(v.now.ref).replace(/^r/, '')) : null,
        canEdit: canEdit && v.now.canName !== false,
      })
    : null;

  const doRestore = useCallback(
    async (row) => {
      if (restoring) return;
      setRestoring(true);
      const res = await restoreVersion({
        path,
        row,
        toast,
        fetchImpl,
        onChanged: () => onChanged?.(),
      });
      setRestoring(false);
      if (res.ok) onLeaveViewing?.();
    },
    [path, restoring, toast, fetchImpl, onChanged, onLeaveViewing]
  );

  const onListKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...(listRef.current?.querySelectorAll('.vh-row') ?? [])];
    const at = rows.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const groups = dayGroups(v.rows, nowMs ?? Date.now());
  const empty = v.status === 'ready' && v.rows.length === 0;

  return (
    <aside
      className={`st-rpanel vh-panel${resizing ? ' is-resizing' : ''}`}
      aria-label={W.title}
      data-testid="vh-panel"
    >
      <div className="vh-hd">
        <HistoryGlyph />
        <strong>{W.title}</strong>
        {scoped ? (
          <span className="vh-tail" data-testid="vh-scope">
            {`· ${tail}`}
          </span>
        ) : null}
        <Kbd>⌥⌘H</Kbd>
        <button
          type="button"
          className="icon-btn k-icon-sm"
          aria-label={W.close}
          data-testid="vh-close"
          onClick={onClose}
        >
          <StIcon name="x" size={12} />
        </button>
      </div>
      {scoped ? (
        <div className="vh-seg">
          <button
            type="button"
            className="vh-seg-b"
            data-testid="vh-scope-clear"
            onClick={() => onClearScope?.()}
          >
            {OW.all}
          </button>
        </div>
      ) : (
        <div className="vh-seg" role="group" aria-label={W.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="vh-seg-b"
              aria-pressed={filter === f.id}
              data-testid={`vh-filter-${f.id}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="vh-body" ref={listRef} onKeyDown={onListKey}>
        {scoped ? (
          <ObjectHistoryView
            path={path}
            objectKey={scoped.key}
            canEdit={canEdit}
            viewing={viewing}
            onView={onView}
            onChanged={() => onChanged?.()}
            onTail={(t) =>
              setLearned((cur) =>
                cur?.key === scoped.key && cur.tail === t ? cur : { key: scoped.key, tail: t }
              )
            }
            refreshKey={refreshKey}
            toast={toast}
            fetchImpl={fetchImpl}
            nowMs={nowMs}
          />
        ) : null}
        {!scoped && now ? (
          <div className={`vh-now${sel ? '' : ' is-sel'}`} data-testid="vh-now">
            <span className="vh-dot" aria-hidden="true" />
            {sel ? (
              <button
                type="button"
                className="vh-now-t vh-row"
                data-testid="vh-now-back"
                onClick={() => onLeaveViewing?.()}
              >
                <strong>{W.now}</strong>
                <span>{`${canvasLabel} · ${now.status}`}</span>
              </button>
            ) : (
              <span className="vh-now-t">
                <strong>{W.now}</strong>
                <span data-testid="vh-now-status">{`${canvasLabel} · ${now.status}`}</span>
              </span>
            )}
            {canEdit ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="vh-name"
                disabled={!now.nameButton.enabled}
                onClick={() => setNaming(true)}
              >
                {now.nameButton.label}
              </button>
            ) : null}
          </div>
        ) : null}
        {!scoped && v.offline ? (
          <p className="vh-offline" role="status" data-testid="vh-offline">
            {v.offline}
          </p>
        ) : null}
        {scoped ? null : !path ? (
          <p className="vh-note" data-testid="vh-nocanvas">
            Open a canvas to see its versions.
          </p>
        ) : v.status === 'error' ? (
          <div className="vh-empty" role="alert" data-testid="vh-failed">
            <strong>{W.failed}</strong>
            <span>{W.failedNote}</span>
            <button type="button" className="btn btn--sm" data-testid="vh-retry" onClick={v.retry}>
              {W.retry}
            </button>
          </div>
        ) : v.status === 'loading' ? (
          <p className="vh-note" role="status" data-testid="vh-loading" aria-busy="true">
            <span className="vh-skel" />
            <span className="vh-skel" />
            <span className="vh-skel" />
          </p>
        ) : empty ? (
          <div className="vh-empty" data-testid="vh-empty">
            <HistoryGlyph size={20} />
            <strong>{filter === 'all' ? W.empty : W.emptyFilter[filter]}</strong>
            <span>{filter === 'all' ? W.emptyNote : W.emptyFilterNote[filter]}</span>
          </div>
        ) : (
          <div className="vh-list" data-testid="vh-list">
            {groups.map((g) => (
              <section key={g.group} className="vh-g" aria-label={g.group}>
                <p className="vh-gt">{g.group}</p>
                <ul className="vh-ul">
                  {g.rows.map((row) => (
                    <Row
                      key={row.id}
                      row={row}
                      selected={sel === row.ref}
                      canEdit={canEdit}
                      restoring={restoring}
                      onCompare={onCompare}
                      onView={(r) => onView?.({ path, ...viewingWords(r) })}
                      onRestore={doRestore}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {v.hasMore ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm vh-more"
                data-testid="vh-more"
                disabled={v.loadingMore}
                onClick={v.loadMore}
              >
                {W.older}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {advanced ? (
        <AdvancedFold panel="history" hint="branch, version ids">
          {advanced}
        </AdvancedFold>
      ) : null}
      {naming ? (
        <NameDialog
          canvasLabel={canvasLabel}
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            const res = await nameVersion({
              path,
              at: v.now?.ref ?? 'now',
              name,
              fetchImpl,
              onChanged: () => onChanged?.(),
            });
            if (res.ok) setNaming(false);
            return res;
          }}
        />
      ) : null}
    </aside>
  );
}
