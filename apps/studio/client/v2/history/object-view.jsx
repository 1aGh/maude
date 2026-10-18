// client/v2/history/object-view.jsx — S1.16: Version history filtered to one object (V2-1.9 §5.9, 10 · co-vh).
//
//   header "Version history · this object" (· this sticky) · "All versions" clears the filter
//   rows "<who> · <time>" + the object's text then · Restore per row (editors) · "Found by matching" rows say
//   "Restore the artboard instead." · a version kept aside is a "Not kept" row (S9.24 Keep both)
//
// Reads `GET /_api/project/object-history` (history/object-history.ts); the Restore is the same
// restore request with `element` (built by history/surface-requests.ts via use-versions.js) that `maude design history restore --element` makes. Everything
// is judged again on the server — hiding Restore from a viewer is presentation.

import { useCallback, useEffect, useRef, useState } from 'react';
import { initialsOf, StIcon } from '../../shell/icons.jsx';
import { OBJECT_WORDS as W, objectUrl } from './object-filter.js';
import { dayGroups, restoreVersion, viewingWords } from './use-versions.js';

/** The object's rows, newest first. `status`: loading · ready · error. */
export function useObjectHistory({ path, objectKey, refreshKey = 0, fetchImpl }) {
  const [state, setState] = useState({
    status: 'loading',
    rows: [],
    header: null,
    stoppedAt: null,
  });
  const [nonce, setNonce] = useState(0);
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;
  const lastKey = useRef(`${path}|${objectKey}`);
  useEffect(() => {
    const k = `${path}|${objectKey}`;
    if (lastKey.current === k) return;
    lastKey.current = k;
    setState({ status: 'loading', rows: [], header: null, stoppedAt: null });
  }, [path, objectKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey / nonce are the "read again" signals
  useEffect(() => {
    if (!path || !objectKey) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchRef.current(objectUrl(path, objectKey), { cache: 'no-store' });
        const d = await r.json().catch(() => null);
        if (cancelled) return;
        if (d?.ok)
          setState({
            status: 'ready',
            rows: d.rows ?? [],
            header: d.header ?? null,
            stoppedAt: d.stoppedAt ?? null,
          });
        else if (r.status === 404 || d?.reason === 'not-found')
          setState({ status: 'ready', rows: [], header: null, stoppedAt: null });
        else
          setState((s) =>
            s.rows.length ? s : { status: 'error', rows: [], header: null, stoppedAt: null }
          );
      } catch {
        if (!cancelled)
          setState((s) =>
            s.rows.length ? s : { status: 'error', rows: [], header: null, stoppedAt: null }
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, objectKey, refreshKey, nonce]);
  const retry = useCallback(() => {
    setState((s) => (s.status === 'error' ? { ...s, status: 'loading' } : s));
    setNonce((n) => n + 1);
  }, []);
  return { ...state, retry };
}

function Face({ who }) {
  if (who?.kind === 'ai')
    return (
      <span className="vh-ai" aria-label="AI">
        <StIcon name="sparkle" size={10} />
      </span>
    );
  return (
    <span className="vh-face" aria-hidden="true">
      {initialsOf(who?.name)}
    </span>
  );
}

function ObjectRow({ row, selected, canEdit, restoring, onView, onRestore }) {
  const rid = `${row.ref}${row.aside ? '-aside' : ''}`;
  return (
    <li className="vh-item vh-obj" data-aside={row.aside ? 'true' : undefined}>
      <button
        type="button"
        className={`vh-row vh-obj-row${selected ? ' is-sel' : ''}`}
        aria-current={selected ? 'true' : undefined}
        data-testid={`vh-obj-row-${rid}`}
        data-ref={row.ref}
        onClick={() => onView(row)}
      >
        <span className="vh-t">
          <span>
            <Face who={row.who} />
            <strong>{row.sub}</strong>
          </span>
          {row.value ? <em className="vh-obj-value">{row.value}</em> : <span>{row.title}</span>}
          {row.value && !row.aside ? <span className="vh-obj-words">{row.title}</span> : null}
          {row.aside ? <span className="vh-obj-words">{row.title}</span> : null}
        </span>
        {row.chips?.map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </button>
      {canEdit && row.restore === 'ok' ? (
        <span className="vh-acts">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`vh-obj-restore-${rid}`}
            disabled={restoring}
            onClick={() => onRestore(row)}
          >
            {restoring ? W.restoring : W.restore}
          </button>
        </span>
      ) : null}
      {canEdit && row.restore === 'artboard' ? (
        <p className="vh-note vh-obj-hint" data-testid={`vh-obj-hint-${rid}`}>
          {W.matchedNote}
        </p>
      ) : null}
    </li>
  );
}

/**
 * @param p.path        the open canvas (repo-relative)
 * @param p.objectKey   `<artboard>/<id>` or an annotation id
 * @param p.canEdit     the session may restore on this canvas (the server decides again)
 * @param p.viewing     the shell hold, to mark the row being looked at
 * @param p.onView      (words) the shell looks at that version
 * @param p.onChanged   a version landed (a restore / its Undo)
 * @param p.onTail      (tail) the header learns "this sticky" once the server says what the object is
 */
export function ObjectHistoryView({
  path,
  objectKey,
  canEdit = false,
  viewing = null,
  onView,
  onChanged,
  onTail,
  refreshKey = 0,
  toast,
  fetchImpl,
  nowMs,
}) {
  const v = useObjectHistory({ path, objectKey, refreshKey, fetchImpl });
  const [restoring, setRestoring] = useState(false);
  // the caller's callback is a fresh function every render: read it through a ref so it never re-arms this
  const tailRef = useRef(onTail);
  tailRef.current = onTail;
  useEffect(() => {
    if (v.header) tailRef.current?.(v.header);
  }, [v.header]);
  const doRestore = useCallback(
    async (row) => {
      if (restoring) return;
      setRestoring(true);
      await restoreVersion({
        path,
        row,
        element: objectKey,
        toast,
        fetchImpl,
        onChanged: () => onChanged?.(),
      });
      setRestoring(false);
    },
    [path, objectKey, restoring, toast, fetchImpl, onChanged]
  );
  const sel = viewing && viewing.path === path ? viewing.at : null;
  if (v.status === 'loading')
    return (
      <p className="vh-note" role="status" data-testid="vh-obj-loading" aria-busy="true">
        <span className="vh-skel" />
        <span className="vh-skel" />
      </p>
    );
  if (v.status === 'error')
    return (
      <div className="vh-empty" role="alert" data-testid="vh-obj-failed">
        <strong>{W.failed}</strong>
        <span>{W.failedNote}</span>
        <button type="button" className="btn btn--sm" data-testid="vh-obj-retry" onClick={v.retry}>
          {W.retry}
        </button>
      </div>
    );
  if (!v.rows.length)
    return (
      <div className="vh-empty" data-testid="vh-obj-empty">
        <strong>{W.empty}</strong>
        <span>{W.emptyNote}</span>
      </div>
    );
  const groups = dayGroups(v.rows, nowMs ?? Date.now());
  return (
    <div className="vh-list" data-testid="vh-obj-list">
      {groups.map((g) => (
        <section key={g.group} className="vh-g" aria-label={g.group}>
          <p className="vh-gt">{g.group}</p>
          <ul className="vh-ul">
            {g.rows.map((row) => (
              <ObjectRow
                key={row.id}
                row={row}
                selected={sel === row.ref && !row.aside}
                canEdit={canEdit}
                restoring={restoring}
                onView={(r) => onView?.({ path, ...viewingWords(r) })}
                onRestore={doRestore}
              />
            ))}
          </ul>
        </section>
      ))}
      {v.stoppedAt && (v.stoppedAt.reason === 'ambiguous' || v.stoppedAt.reason === 'no-match') ? (
        <p className="vh-note" data-testid="vh-obj-stopped">
          {W.stopped[v.stoppedAt.reason]}
        </p>
      ) : null}
    </div>
  );
}
