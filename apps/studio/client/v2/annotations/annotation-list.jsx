// client/v2/annotations/annotation-list.jsx — S4.17: Layers in Preview = the annotation list
// (canvas 15 · an-layers). While the canvas is in Preview the Layers tab lists the annotation layer —
// "Annotations 24", person chips, rows grouped by section, and a foot naming what the filter hides —
// instead of the design tree. The filter HIDES; it never removes (the board is only read here).
//
// Three layers, so S4.9 only has to supply the source:
//   annotation-list-model.js   pure: the counts, the grouping, the foot (test/annotation-list-model.test.js)
//   AnnotationList             presentation only — props in, callbacks out
//   AnnotationListHost         this canvas's board, the filter, the twisties; talks to the canvas through
//                              `post` (dgn `annotation-select {ids}` / `annotation-filter {authors}`)
//   AnnotationLayersGate       the one mount: renders the list in Preview, its children otherwise
//
// The board is per canvas, so the list never aggregates across canvases — a session granted only some
// canvases sees only those canvases' annotations (the GET is the same one the canvas makes).

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Kbd, StIcon } from '../../shell/icons.jsx';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import {
  annotationFilterMessage,
  annotationSelectMessage,
  buildList,
  LOCKED_DRAG_TIP,
  LOCKED_TOOLBAR,
  lockedToolbarFor,
  toggleFilter,
} from './annotation-list-model.js';

/** The shell hears these from S4.9 (`annotations-changed {file}`, the canvas's selection) and relays them. */
export const ANNOTATIONS_CHANGED_EVENT = 'maude:annotations-changed';
export const ANNOTATION_SELECTION_EVENT = 'maude:annotation-selection';

/** The thin adapter: where the board comes from. S4.9 replaces `subscribe` with its own channel. */
export const boardSource = {
  /** @returns {Promise<object[]>} the canvas's board elements; throws when the board is unreadable. */
  async load(file, fetchImpl = globalThis.fetch) {
    const r = await fetchImpl(`/_api/annotations?file=${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error('unreadable');
    const doc = JSON.parse(await r.text());
    return Array.isArray(doc?.elements) ? doc.elements : [];
  },
  /** @returns {() => void} unsubscribe. `cb(ids?)` — a change to this file's board. */
  subscribe(file, cb, target = globalThis.window) {
    const onChanged = (e) => {
      if (!e.detail?.file || e.detail.file === file) cb();
    };
    target?.addEventListener?.(ANNOTATIONS_CHANGED_EVENT, onChanged);
    target?.addEventListener?.('focus', cb);
    return () => {
      target?.removeEventListener?.(ANNOTATIONS_CHANGED_EVENT, onChanged);
      target?.removeEventListener?.('focus', cb);
    };
  },
};

// A few small glyphs the shell icon set does not have (14 px, currentColor, the same 1.5 stroke).
const GLYPHS = {
  section: <path d="M2.5 4.5h4l1 1.5h6v6.5h-11z" />,
  arrow: <path d="M3 12.5 12 3.5M7 3.5h5v5" />,
  marker: <path d="M3 12c2-6 4-6 5-3s3 1 5-5" />,
  text: <path d="M3.5 4h9M8 4v8.5" />,
  shape: <rect x="3" y="3.5" width="10" height="9" rx="1.5" />,
  stamp: <path d="M8 2.5l1.6 3.4 3.7.5-2.7 2.6.7 3.7L8 10.9l-3.3 1.8.7-3.7L2.7 6.4l3.7-.5z" />,
};

const KIND_GLYPH = {
  arrow: 'arrow',
  pen: 'marker',
  text: 'text',
  shape: 'shape',
  stamp: 'stamp',
};

function Glyph({ name }) {
  return (
    <svg
      className="al-glyph"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name] ?? GLYPHS.shape}
    </svg>
  );
}

function Row({ row, selected, onPick }) {
  const glyph = KIND_GLYPH[row.kind];
  return (
    <button
      type="button"
      className="al-row al-row--in"
      data-testid="annotation-list-row"
      data-id={row.id}
      data-kind={row.kind}
      aria-current={selected ? 'true' : undefined}
      data-resolved={row.resolved ? 'true' : undefined}
      onClick={(e) => onPick(row.id, e.metaKey || e.ctrlKey || e.shiftKey)}
    >
      {row.kind === 'sticky' ? (
        <i className="al-sw" style={row.color ? { background: row.color } : undefined} />
      ) : glyph ? (
        <Glyph name={glyph} />
      ) : (
        <StIcon
          name={row.kind === 'image' ? 'image' : row.kind === 'link' ? 'link' : 'layers'}
          size={14}
        />
      )}
      <span className="al-name">{row.label}</span>
      {row.resolved ? (
        // a11y A3 — "resolved" is a tick + a strike + a word for a screen reader, never only a paler colour
        <span className="al-state al-state--done" data-testid="annotation-list-resolved">
          <StIcon name="check" size={12} />
          <span className="sr-only">Resolved</span>
        </span>
      ) : null}
      {row.locked ? (
        <span className="al-state" data-testid="annotation-list-lock" title={LOCKED_DRAG_TIP}>
          <StIcon name="lock" size={12} />
          <span className="sr-only">Locked</span>
        </span>
      ) : null}
    </button>
  );
}

/** "Locked · Unlock ⇧⌘L" — the pill beside a locked selection. Exported for the canvas layer to reuse. */
export function LockedToolbar({ onUnlock }) {
  return (
    <span
      className="al-locked"
      role="group"
      aria-label={LOCKED_TOOLBAR.label}
      data-testid="annotation-locked-toolbar"
    >
      <span className="al-locked-t">
        <StIcon name="lock" size={12} />
        {LOCKED_TOOLBAR.label}
      </span>
      <span className="al-locked-div" aria-hidden="true" />
      <button type="button" className="al-btn" onClick={onUnlock}>
        {LOCKED_TOOLBAR.action}
        <Kbd>{LOCKED_TOOLBAR.kbd}</Kbd>
      </button>
    </span>
  );
}

/** The drag tooltip on a locked annotation. Exported for the canvas layer to reuse. */
export function LockedDragTip() {
  return (
    <span className="al-tip" role="tooltip" data-testid="annotation-locked-tip">
      {LOCKED_DRAG_TIP}
    </span>
  );
}

/** Presentation only. `list` is `buildList(...)`'s answer. */
export function AnnotationList({
  list,
  selectedIds = [],
  state = 'ready',
  onToggleChip,
  onPick,
  onToggleSection,
  onUnlock,
  onRetry,
  lockedPill = null,
}) {
  const sel = new Set(selectedIds);
  return (
    <div className="al" data-testid="annotation-list">
      <p className="al-title">
        {list.title}
        <span className="al-count" data-testid="annotation-list-count">
          {list.total}
        </span>
      </p>
      <div className="al-chips" role="group" aria-label="Show annotations by person">
        {list.chips.map((c) => (
          <button
            type="button"
            key={c.key}
            className="al-chip"
            data-testid="annotation-list-chip"
            data-person={c.key}
            data-on={c.on ? 'true' : undefined}
            aria-pressed={c.on}
            onClick={() => onToggleChip(c.key)}
          >
            {c.key === 'ai' ? <StIcon name="sparkle" size={10} /> : null}
            {c.label}
          </button>
        ))}
      </div>
      <div className="al-list">
        {state === 'error' ? (
          <div className="al-empty" role="alert">
            <p className="al-empty-t">Couldn’t read the annotations.</p>
            <button type="button" className="al-btn" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : state === 'loading' ? (
          <p className="al-empty-b" role="status">
            Loading…
          </p>
        ) : list.total === 0 ? (
          <div className="al-empty" data-testid="annotation-list-empty">
            <p className="al-empty-t">No annotations yet.</p>
            <p className="al-empty-b">
              Stickies, arrows and markers you add in Preview are listed here.
            </p>
          </div>
        ) : list.shown === 0 ? (
          <div className="al-empty" data-testid="annotation-list-nohits">
            <p className="al-empty-t">Nothing from them here.</p>
            <p className="al-empty-b">Pick Everyone to see all {list.total}.</p>
          </div>
        ) : (
          <>
            {list.groups.map((g) => (
              <section key={g.id} aria-label={g.label}>
                <div className="al-row al-sec" data-testid="annotation-list-section" data-id={g.id}>
                  <button
                    type="button"
                    className="al-tw"
                    aria-expanded={g.open}
                    aria-label={`${g.open ? 'Fold' : 'Unfold'} ${g.label}`}
                    data-open={g.open ? 'true' : undefined}
                    onClick={() => onToggleSection(g.id)}
                  >
                    <StIcon name="chevron-right" size={12} />
                  </button>
                  <button
                    type="button"
                    className="al-sec-pick"
                    aria-current={sel.has(g.id) ? 'true' : undefined}
                    onClick={(e) => onPick(g.id, e.metaKey || e.ctrlKey || e.shiftKey)}
                  >
                    <Glyph name="section" />
                    <span className="al-name">{g.label}</span>
                  </button>
                  <span className="al-meta" data-testid="annotation-list-section-count">
                    {g.count}
                  </span>
                </div>
                {g.rows.map((r) => (
                  <Row key={r.id} row={r} selected={sel.has(r.id)} onPick={onPick} />
                ))}
              </section>
            ))}
            {list.loose.map((r) => (
              <Row key={r.id} row={r} selected={sel.has(r.id)} onPick={onPick} />
            ))}
          </>
        )}
      </div>
      {lockedPill ? <LockedToolbar onUnlock={onUnlock} /> : null}
      {list.foot ? (
        <p className="al-foot" data-testid="annotation-list-foot">
          {list.foot}
        </p>
      ) : null}
    </div>
  );
}

/**
 * This canvas's annotation list. `post(msg)` sends a dgn message to the active canvas iframe;
 * `me` is `{ name?, id? }` of the signed-in person (so "You" resolves); `artboardLabel(id)` names an
 * artboard for "Marker on Post 1:1".
 */
export function AnnotationListHost({
  file,
  post,
  me,
  artboardLabel,
  source = boardSource,
  target = globalThis.window,
}) {
  const [elements, setElements] = useState(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState([]);
  const [closed, setClosed] = useState(() => new Set());
  const [selectedIds, setSelectedIds] = useState([]);
  const [tick, setTick] = useState(0);

  // This canvas's board. A change of canvas starts clean: the filter and the twisties are per canvas.
  useEffect(() => {
    setElements(null);
    setFailed(false);
    setFilter([]);
    setClosed(new Set());
    setSelectedIds([]);
  }, [file]);

  useEffect(() => {
    if (!file) return undefined;
    let live = true;
    source
      .load(file)
      .then((els) => {
        if (!live) return;
        setElements(els);
        setFailed(false);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [file, source, tick]);

  useEffect(
    () => (file ? source.subscribe(file, () => setTick((n) => n + 1)) : undefined),
    [file, source]
  );

  // The canvas's own selection, relayed by the shell.
  useEffect(() => {
    const onSel = (e) => setSelectedIds(Array.isArray(e.detail?.ids) ? e.detail.ids : []);
    target?.addEventListener?.(ANNOTATION_SELECTION_EVENT, onSel);
    return () => target?.removeEventListener?.(ANNOTATION_SELECTION_EVENT, onSel);
  }, [target]);

  const list = useMemo(
    () => buildList(elements ?? [], { filter, me, artboardLabel, closed }),
    [elements, filter, me, artboardLabel, closed]
  );

  const onToggleChip = useCallback(
    (key) => {
      const next = toggleFilter(filter, key);
      setFilter(next);
      post?.(annotationFilterMessage(next));
    },
    [filter, post]
  );
  const onPick = useCallback(
    (id, additive) => {
      const next = additive
        ? selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id]
        : [id];
      setSelectedIds(next);
      post?.(annotationSelectMessage(next));
    },
    [selectedIds, post]
  );
  const onToggleSection = useCallback(
    (id) =>
      setClosed((s) => {
        const n = new Set(s);
        if (!n.delete(id)) n.add(id);
        return n;
      }),
    []
  );
  // Unlock rides the registry action (`annotation.lock` toggles the selection) — the same ⇧⌘L.
  const onUnlock = useCallback(
    () => post?.({ dgn: 'run-action', v: 1, id: 'annotation.lock' }),
    [post]
  );

  return (
    <AnnotationList
      list={list}
      selectedIds={selectedIds}
      state={failed && elements == null ? 'error' : elements == null ? 'loading' : 'ready'}
      onToggleChip={onToggleChip}
      onPick={onPick}
      onToggleSection={onToggleSection}
      onUnlock={onUnlock}
      onRetry={() => setTick((n) => n + 1)}
      lockedPill={lockedToolbarFor(elements ?? [], selectedIds)}
    />
  );
}

const modeNow = () => shellMode.get().mode;

/**
 * The one mount in the left panel: in Preview the standalone Layers panel shows the annotation list;
 * in every other mode (and for every other panel) it shows its children, the design tree, untouched.
 */
export function AnnotationLayersGate({ panel, file, post, me, artboardLabel, children }) {
  const mode = useSyncExternalStore(shellMode.subscribe, modeNow, modeNow);
  if (panel !== 'layers' || mode !== 'preview' || !file) return children;
  // Same frame and test id as the Layers panel it replaces, so the dock slot and the parity spec see one panel.
  return (
    <aside className="st-rpanel al-panel" aria-label="Annotations" data-testid="layers-panel">
      <AnnotationListHost
        key={file}
        file={file}
        post={post}
        me={me}
        artboardLabel={artboardLabel}
      />
    </aside>
  );
}

/** The mount call shape: annotationLayersFor(panelId, { file, post, me?, artboardLabel? }, designTreePanel). */
export function annotationLayersFor(panel, props, children) {
  return (
    <AnnotationLayersGate panel={panel} {...props}>
      {children}
    </AnnotationLayersGate>
  );
}
