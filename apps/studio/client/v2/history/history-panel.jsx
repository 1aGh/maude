// client/v2/history/history-panel.jsx — S1.14: Version history (11 · pn-history, 05 · es-panels-canvas; ⌥⌘H).
//
//   header · All / Named / Made by AI / People · Now row (+ Name this version…) · Today / Yesterday / 4 Oct …
//   rows with a picture, a face or the spark, the words, a chip · click = look at it (the shell's Viewing hold)
//   the selected row: Compare · Restore this version (edit only; Can view looks, never restores)
//   comparing (S1.15): the selected row is A, a second click makes a row B (marks on both, Now can be B);
//     the selected row then carries what Restore takes back from others, Stop comparing,
//     Restore only <artboard> and Restore this version
//   foot: Advanced (Compare pictures + the git body, until S11 re-words it)
//
// The rows are the server's (rule G); this file draws them and sends three things back: look (`onView`),
// restore (one new version + a toast with Undo) and name — both built by history/surface-requests.ts, the one
// source the `maude design history …` verbs share.
// S1.16: with a `scope` (openHistory in object-filter.js) the body is ONE object's versions (object-view.jsx),
// the header says "· this object" and "All versions" lifts the filter.
// Everything here is judged again on the server (§5.12): hiding Restore from a viewer is presentation.

import { useCallback, useEffect, useRef, useState } from 'react';
import { initialsOf, Kbd, StIcon } from '../../shell/icons.jsx';
import { shellToast } from '../../shell/util.js';
import { ChatUndoButton } from '../ai/ChatUndo.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import {
  COMPARE_WORDS as CW,
  focusGroup,
  groupByArtboard,
  restoreOnlyTarget,
  whyLine,
} from './blame.js';
import { HistoryAdvanced } from './git-advanced.jsx';
import { GIT_HINT } from './git-model.js';
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
import { Empty } from '../empty/index.js';

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
      <span className="vh-ai" role="img" aria-label="AI">
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

/** Compare's A / B mark on a row. */
function Mark({ mark }) {
  if (!mark) return null;
  return (
    <span
      className={`cmp-mark cmp-mark--${mark.toLowerCase()}`}
      data-testid={`vh-mark-${mark}`}
      role="img"
      aria-label={`Version ${mark}`}
    >
      {mark}
    </span>
  );
}

function Row({
  row,
  selected,
  mark,
  comparing,
  canEdit,
  restoring,
  onView,
  onRestore,
  onCompare,
  compareActs,
  onChanged,
  fetchImpl,
  toast,
}) {
  return (
    <li className="vh-item">
      <button
        type="button"
        className={`vh-row${row.named ? ' is-named' : ''}${selected ? ' is-sel' : ''}${mark === 'B' ? ' is-b' : ''}`}
        aria-current={selected ? 'true' : undefined}
        data-testid={`vh-row-${row.ref}`}
        data-ref={row.ref}
        onClick={() => onView(row)}
      >
        <Mark mark={mark} />
        <Picture row={row} />
        <span className="vh-t">
          <strong>{row.title}</strong>
          <span>
            <Face row={row} />
            <span className="vh-sub" title={row.sub}>
              {row.sub}
            </span>
          </span>
        </span>
        {row.chips?.map((c) => (
          <span key={c} className={`chip${c === 'Made by AI' ? ' chip--spark' : ''}`}>
            {c}
          </span>
        ))}
      </button>
      {selected && comparing ? (
        compareActs
      ) : selected ? (
        <span className="vh-acts" data-testid="vh-acts">
          {onCompare ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="vh-compare"
              onClick={() => onCompare(row)}
            >
              <StIcon name="eye" size={14} />
              {W.compare}
            </button>
          ) : null}
          {/* S5.15 — your AI's row: every change of its chat, as ONE new version (03 ai-history) */}
          <ChatUndoButton
            row={row}
            canEdit={canEdit}
            fetchImpl={fetchImpl}
            toast={toast}
            onDone={() => onChanged?.()}
          />
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
 * @param p.scope           S1.16 — `{ path, key, tail }` when the panel is filtered to one object, else null
 * @param p.onClearScope    "All versions"
 * @param p.onCompare       (row) start comparing: the row is A, Now is B; absent = no Compare button
 * @param p.compare         the Compare in progress (`compare-store.js`) or null
 * @param p.onPickB         (words | null) — a second row (or null = Now) becomes B
 * @param p.onStopCompare   Stop comparing (back to Viewing the version)
 * @param p.onRows          (rows) the rows on screen, so Compare can name who made a change
 * @param p.onComparePictures  ({ file, beforeSha }) opens today's picture DiffView (Advanced)
 * @param p.role            'view' | 'comment' | 'edit' | 'owner' — the git part of Advanced is for editors only
 * @param p.git             the shell's git bundle for Advanced (S11.10, git-advanced.jsx); absent = no git part
 * @param p.advanced        anything else for the Advanced fold's body
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
  compare = null,
  onPickB,
  onStopCompare,
  onRows,
  onComparePictures,
  role = canEdit ? 'edit' : 'view',
  git = null,
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

  const comparing = !!compare && compare.path === path;
  const answer = comparing ? compare.answer : null;
  const cmpGroups =
    answer?.status === 'ready' ? groupByArtboard(answer.changes, answer.labels) : [];
  const target = comparing ? restoreOnlyTarget(focusGroup(cmpGroups, compare.focus)) : null;
  // A may sit on a page not loaded yet (a Compare opened from a link): the ref is all a restore needs
  const aRow = comparing
    ? (v.rows.find((r) => r.ref === compare.a.at) ?? {
        ref: compare.a.at,
        named: null,
        madeAt: null,
      })
    : null;
  // the rows on screen are what names a line's maker (blame.js)
  useEffect(() => {
    if (comparing) onRows?.(v.rows);
  }, [comparing, v.rows, onRows]);

  const doRestoreOnly = useCallback(async () => {
    if (restoring || !target || !comparing) return;
    setRestoring(true);
    const res = await restoreVersion({
      path,
      row: aRow,
      artboard: target.id,
      toast,
      fetchImpl,
      onChanged: () => onChanged?.(),
    });
    setRestoring(false);
    if (res.ok) {
      onStopCompare?.();
      onLeaveViewing?.();
    }
  }, [
    restoring,
    target,
    comparing,
    path,
    aRow,
    compare,
    toast,
    fetchImpl,
    onChanged,
    onStopCompare,
    onLeaveViewing,
  ]);

  const compareActs = comparing ? (
    <span className="vh-acts vh-acts--cmp" data-testid="vh-acts">
      <span className="vh-why" data-testid="vh-why">
        {whyLine(cmpGroups, answer?.blame, v.rows)}
      </span>
      <span className="vh-btns">
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          data-testid="vh-stop-compare"
          onClick={() => onStopCompare?.()}
        >
          {CW.stop}
        </button>
        {canEdit && target ? (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="vh-restore-only"
            disabled={restoring}
            onClick={doRestoreOnly}
          >
            {CW.restoreOnly(target.label)}
          </button>
        ) : null}
        {/* 03 ai-history: the held row is still your AI's row while it is compared — Undo this chat stays beside Restore */}
        <ChatUndoButton
          row={aRow}
          canEdit={canEdit}
          fetchImpl={fetchImpl}
          toast={toast}
          onDone={() => onChanged?.()}
        />
        {canEdit ? (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            data-testid="vh-restore"
            disabled={restoring}
            onClick={() => doRestore(aRow)}
          >
            {restoring ? W.restoring : W.restore}
          </button>
        ) : null}
      </span>
    </span>
  ) : null;

  const markOf = (row) =>
    !comparing ? null : row.ref === compare.a.at ? 'A' : row.ref === compare.b?.at ? 'B' : null;

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
        // biome-ignore lint/a11y/useSemanticElements: a filter segmented control, not a form fieldset
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the keydown only moves focus between the rows (real buttons) that bubble up to it */}
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
          <div
            className={`vh-now${sel && !(comparing && compare.b?.at === 'now') ? '' : ' is-sel'}`}
            data-testid="vh-now"
          >
            <span className="vh-dot" aria-hidden="true" />
            {comparing && compare.b?.at === 'now' ? <Mark mark="B" /> : null}
            {sel ? (
              <button
                type="button"
                className="vh-now-t vh-row"
                data-testid="vh-now-back"
                onClick={() => (comparing ? onPickB?.(null) : onLeaveViewing?.())}
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
          // S11.3: the kit's block. Before the first change it is 05's line (no button: nothing to do); a
          // filter that matches nothing keeps its own two lines, through the same block.
          <Empty
            glyph="history"
            testid="vh-empty"
            className="es-e--inpanel"
            {...(filter === 'all'
              ? { copyId: 'es-panels-canvas.vh-before-first' }
              : { title: W.emptyFilter[filter], next: W.emptyFilterNote[filter] })}
          />
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
                      mark={markOf(row)}
                      comparing={comparing}
                      compareActs={compareActs}
                      canEdit={canEdit}
                      restoring={restoring}
                      onCompare={onCompare}
                      onView={(r) =>
                        comparing && r.ref !== compare.a.at
                          ? onPickB?.(viewingWords(r))
                          : onView?.({ path, ...viewingWords(r) })
                      }
                      onRestore={doRestore}
                      onChanged={onChanged}
                      fetchImpl={fetchImpl}
                      toast={toast}
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
      {advanced || git || onComparePictures ? (
        <AdvancedFold panel="history" hint={GIT_HINT}>
          <HistoryAdvanced
            canvas={path}
            version={sel}
            versionRow={sel ? (v.rows.find((r) => r.ref === sel) ?? null) : null}
            role={role}
            git={git}
            fetchImpl={fetchImpl}
            onComparePictures={onComparePictures}
            canView={!!path}
          >
            {advanced}
          </HistoryAdvanced>
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
