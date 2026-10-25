// client/v2/ds/reach-view.jsx — S10.9: "Used in 5 canvases · Show" (13 · ds-edit-reach, "One colour, everywhere it lands").
//
// The picker has moved a colour and nothing has reached a canvas yet. Show draws WHERE it will go, before anything
// is updated: a frame per artboard that uses it (a live render of the canvas, `?dsPreview=<ds>@pending`), every
// place on it ringed, a line from the swatch to each frame, and the tags — "4 patterns · 21 places", "14 places".
// Once the rings are drawn the review list opens beside them: the SAME list as "Update N canvases" (rows, ticks,
// Cancel, Update), because it is the same decision. Hide / Esc / Close go back to the canvas and change nothing.
//
// Where the rings come from (S10-slices Q11): the usage index names the elements (`data-cd-id`) per artboard; each
// frame is asked where they are drawn (`ds-rects`) and answers in its own pixels (`ds-rects-result`); this file
// scales both the same way. The canvas is untrusted (DDR-054): it is framed like any canvas, answers only its
// parent, and what it says passes the dgn table's parser before it gets here (acceptFromCanvas) and `ringsFor`
// after. Its label is rendered as text only.
//
// The data (usage, the review) is fetched by the host (review-host.jsx); this file draws and talks to its frames.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { canvasUrl } from '../../canvas-url.js';
import { StIcon } from '../../shell/icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { REACH_WORDS } from './reach-data.js';
import { moreWords, ringsFor } from './reach-model.js';
import {
  defaultTicks,
  headWords,
  keepsWords,
  nameOf,
  noteFor,
  primaryWords,
  REVIEW_WORDS,
  rowsOf,
  tickState,
  withTicks,
} from './review-model.js';
import { safeColour, Tick } from './review-sheet.jsx';

/** A frame is this many CSS pixels in its own document, drawn at FRAME_SCALE. */
export const FRAME_W = 960;
export const FRAME_H = 600;
export const FRAME_SCALE = 0.5;
/** The system's own Patterns artboard (a wide strip): its frame, in the same pixels-then-scaled way. */
export const PATTERNS_FRAME = { w: 2400, h: 468, scale: 0.42, artboard: 'ds-patterns' };
/** The asks per frame: the camera needs a moment to settle on the artboard after `reveal-artboard`. */
export const ASK_LADDER_MS = [0, 250, 700, 1500];
/** The review opens once every frame has answered, or after this long (a slow or refused frame never holds it). */
export const REVIEW_AFTER_MS = 2600;

const previewOf = (ds) => `${ds}@pending`;

/** One shell → canvas message to ONE frame, at the canvas origin (never `*`). */
function post(win, message, origin) {
  try {
    win?.postMessage(message, origin);
  } catch {
    /* a frame that went away */
  }
}

/**
 * @param {{
 *   ds: string, cfg: any, name: string,
 *   swatch?: { before: string | null, after: string | null } | null,
 *   reach: { places: number, tag: string, frames: any[], more: any[], capped: boolean },
 *   review?: { changes: any[], canvases: any[] } | null, components?: string[], places?: Record<string, number>,
 *   scope?: string,
 *   onUpdate?: (rows: any[]) => Promise<{ ok: boolean, message?: string }>,
 *   onCancel?: () => Promise<{ ok: boolean, message?: string }>,
 *   onClose: () => void,
 * }} props
 */
export function DsReachView({
  ds,
  cfg,
  name,
  swatch = null,
  reach,
  review = null,
  places = {},
  scope = '',
  coverOf,
  onUpdate,
  onCancel,
  onClose,
}) {
  const ref = useModalFocus({ onClose });
  const stage = useRef(null);
  const dot = useRef(null);
  const anchors = useRef(new Map());
  const wins = useRef(new Map()); // frame key → contentWindow
  const seqs = useRef(new Map()); // frame key → the last ask's seq
  const timers = useRef([]);
  const [answers, setAnswers] = useState({}); // frame key → { rings, label, view }
  const [lines, setLines] = useState([]);
  const [timedOut, setTimedOut] = useState(false);

  const origin = cfg?.canvasOrigin || (typeof window !== 'undefined' ? window.location.origin : '');
  // 13 · ds-edit-reach: the system's own Patterns (on the Design system canvas) come first, then the canvases
  const boardRel = useMemo(() => {
    const entry = cfg?.designSystems?.find((d) => d.name === ds);
    return typeof entry?.path === 'string' && cfg?.dsConverted?.[ds] === true
      ? `${entry.path.replace(/\/+$/, '')}/design-system.tsx`
      : null;
  }, [cfg, ds]);
  const frames = useMemo(
    () =>
      boardRel
        ? [
            {
              key: `${boardRel}#${PATTERNS_FRAME.artboard}`,
              rel: boardRel,
              canvas: 'Design system',
              artboard: PATTERNS_FRAME.artboard,
              label: REACH_WORDS.patterns,
              places: reach.places,
              ids: [],
              board: true,
            },
            ...reach.frames,
          ]
        : reach.frames,
    [boardRel, reach.frames, reach.places]
  );
  const byKey = useMemo(() => new Map(frames.map((f) => [f.key, f])), [frames]);

  const ask = useCallback(
    (key) => {
      const f = byKey.get(key);
      const win = wins.current.get(key);
      if (!f || !win) return;
      const seq = (seqs.current.get(key) ?? 0) + 1;
      seqs.current.set(key, seq);
      post(win, { dgn: 'ds-rects', seq, artboard: f.artboard, ids: f.ids }, origin);
    },
    [byKey, origin]
  );

  // A frame loaded: bring its artboard into view, then ask where the elements are (the camera settles in a moment).
  const seed = useCallback(
    (key) => {
      const f = byKey.get(key);
      const win = wins.current.get(key);
      if (!f || !win) return;
      post(win, { dgn: 'view-chrome', minimap: false, zoom: false, present: false }, origin);
      // a frame of the whole canvas (a place outside every artboard) keeps the camera the canvas opened with
      if (f.artboard)
        post(
          win,
          { dgn: 'reveal-artboard', artboardId: f.artboard, glide: false, flash: false },
          origin
        );
      for (const ms of ASK_LADDER_MS) timers.current.push(setTimeout(() => ask(key), ms));
    },
    [ask, byKey, origin]
  );

  useEffect(() => {
    function onMessage(e) {
      const t = e.data && typeof e.data === 'object' ? e.data.dgn : null;
      if (t !== 'ds-rects-result' && t !== 'loaded') return;
      const m = acceptFromCanvas(e, {
        canvasOrigin: origin,
        active: null,
        frames: () => [...wins.current.values()],
      });
      if (!m) return;
      let key = null;
      for (const [k, w] of wins.current) if (w === e.source) key = k;
      if (!key) return; // not one of ours
      if (m.dgn === 'loaded') return seed(key);
      if (m.dgn !== 'ds-rects-result') return;
      if (m.seq !== seqs.current.get(key)) return; // a stale answer
      const f = byKey.get(key);
      if (!f) return;
      setAnswers((a) => ({
        ...a,
        [key]: {
          rings: ringsFor(m, f.ids, m.view),
          label: typeof m.label === 'string' ? m.label : null,
          view: m.view,
        },
      }));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [byKey, origin, seed]);

  useEffect(() => {
    const live = timers.current;
    const t = setTimeout(() => setTimedOut(true), REVIEW_AFTER_MS);
    return () => {
      clearTimeout(t);
      for (const x of live) clearTimeout(x);
    };
  }, []);

  // the lines: from the swatch's dot to the tag of each frame, in the stage's own coordinates
  const measure = useCallback(() => {
    const st = stage.current?.getBoundingClientRect();
    const from = dot.current?.getBoundingClientRect();
    if (!st || !from) return;
    const sx = from.left + from.width / 2 - st.left;
    const sy = from.top + from.height / 2 - st.top;
    const next = [];
    for (const [key, el] of anchors.current) {
      const r = el.getBoundingClientRect();
      const ax = r.left - st.left;
      const ay = r.top + r.height / 2 - st.top;
      const mid = Math.max(40, (ax - sx) / 2);
      next.push({
        key,
        sx,
        sy,
        ax,
        ay,
        d: `M${sx} ${sy} C ${sx + mid} ${sy}, ${ax - mid} ${ay}, ${ax} ${ay}`,
      });
    }
    setLines(next);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the frame count and the answers move the anchors
  useLayoutEffect(measure, [measure, frames.length, answers]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // the system's own Patterns strip has nothing to ring (no element ids), so the list does not wait for it
  const answered = frames.every((f) => f.board || answers[f.key]);
  const reviewOpen = !!review && (answered || timedOut);

  return (
    <div
      className="dsx"
      data-testid="ds-reach"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ds-reach-title"
      tabIndex={-1}
    >
      <header className="dsx-hd">
        <h2 id="ds-reach-title" className="dsx-t" data-testid="ds-reach-title">
          {REACH_WORDS.title}
        </h2>
        <p className="dsx-s" data-testid="ds-reach-sub">
          {swatch?.beforeName && swatch?.afterName
            ? `${name} went from ${swatch.beforeName} to ${swatch.afterName} ${REACH_WORDS.where}. `
            : `${name} lands in these places ${REACH_WORDS.where}. `}
          {`“${usedPhrase(reach)} › Show” draws where it goes — the system's own Patterns and every canvas — before anything is updated.`}
        </p>
        <button type="button" className="btn dsx-x" data-testid="ds-reach-close" onClick={onClose}>
          {REACH_WORDS.close}
        </button>
      </header>
      <div className="dsx-stage k-canvas--dots" ref={stage}>
        <svg className="dsx-lines" aria-hidden="true" data-testid="ds-reach-lines">
          {lines.map((l) => (
            <g key={l.key} data-key={l.key}>
              <path d={l.d} data-testid="ds-reach-line" />
              <circle cx={l.sx} cy={l.sy} r="5" />
              <circle cx={l.ax} cy={l.ay} r="4" />
            </g>
          ))}
        </svg>

        <div className="island island--pad dsx-token" data-testid="ds-reach-token">
          <p className="dsx-k" data-testid="ds-reach-key">
            {swatch?.kind ? `${swatch.kind} › ${name}` : name}
          </p>
          {swatch?.after && swatch?.afterDark ? (
            <span className="dsx-halves" data-testid="ds-reach-halves" aria-hidden="true">
              <span
                className="dsx-half"
                data-which="light"
                style={{ background: safeColour(swatch.after) ?? undefined }}
              >
                <em>Light</em>
              </span>
              <span
                className="dsx-half"
                data-which="dark"
                style={{ background: safeColour(swatch.afterDark) ?? undefined }}
              >
                <em>Dark</em>
              </span>
            </span>
          ) : null}
          <p className="dsx-ch">
            {swatch?.before ? (
              <span
                className="dsr-chip"
                style={{ background: safeColour(swatch.before) ?? undefined }}
              />
            ) : null}
            {swatch?.beforeName && swatch?.afterName ? <span>{swatch.beforeName}</span> : null}
            {swatch?.before && swatch?.after ? <StIcon name="chevron-right" size={12} /> : null}
            {swatch?.after ? (
              <span
                className="dsr-chip dsx-dot"
                ref={dot}
                style={{ background: safeColour(swatch.after) ?? undefined }}
              />
            ) : (
              <span className="dsx-dot dsx-dot--bare" ref={dot} />
            )}
            {swatch?.beforeName && swatch?.afterName ? <b>{swatch.afterName}</b> : null}
          </p>
          {swatch?.contrast ? (
            <p
              className="insp-quiet dsx-contrast"
              data-testid="ds-reach-contrast"
              data-tone={swatch.contrastOk ? 'ok' : 'warn'}
            >
              <StIcon name={swatch.contrastOk ? 'check' : 'problem'} size={12} />
              <span>{swatch.contrast}</span>
            </p>
          ) : null}
          <p className="dsx-used" data-testid="ds-reach-used">
            <StIcon name="layers" size={12} />
            <span>{usedLine(reach)}</span>
            <button
              type="button"
              className="dsx-link"
              data-testid="ds-reach-hide"
              onClick={onClose}
            >
              {REACH_WORDS.hide}
            </button>
          </p>
          {boardRel ? null : (
            <p className="dsx-tag dsx-tag--all" data-testid="ds-reach-tag">
              {reach.tag}
            </p>
          )}
        </div>

        <div className="dsx-frames" data-testid="ds-reach-frames">
          {frames.map((f) => {
            const a = answers[f.key];
            const dims = f.board ? PATTERNS_FRAME : { w: FRAME_W, h: FRAME_H, scale: FRAME_SCALE };
            return (
              <figure
                className="dsx-frame"
                key={f.key}
                data-testid="ds-reach-frame"
                data-key={f.key}
                data-artboard={f.artboard ?? undefined}
                data-board={f.board ? 'true' : undefined}
              >
                <figcaption className="dsx-cap">
                  <b>{a?.label || f.label}</b>
                  <span
                    className="dsx-tag"
                    data-testid="ds-reach-places"
                    ref={(el) => {
                      if (el) anchors.current.set(f.key, el);
                      else anchors.current.delete(f.key);
                    }}
                  >
                    {f.board ? reach.tag : `${f.places} ${f.places === 1 ? 'place' : 'places'}`}
                  </span>
                </figcaption>
                <div
                  className="dsx-shot"
                  style={{ width: dims.w * dims.scale, height: dims.h * dims.scale }}
                >
                  <iframe
                    title={f.label}
                    className="dsx-iframe"
                    scrolling="no"
                    tabIndex={-1}
                    data-testid="ds-reach-iframe"
                    src={canvasUrl(f.rel, cfg, { embed: true, dsPreview: previewOf(ds) })}
                    style={{ width: dims.w, height: dims.h, transform: `scale(${dims.scale})` }}
                    {...(cfg?.canvasOrigin ? { sandbox: 'allow-scripts allow-same-origin' } : {})}
                    ref={(el) => {
                      if (el?.contentWindow) wins.current.set(f.key, el.contentWindow);
                      else wins.current.delete(f.key);
                    }}
                    onLoad={() => seed(f.key)}
                  />
                  <span
                    className="dsx-rings"
                    aria-hidden="true"
                    data-testid="ds-reach-rings"
                    data-count={a?.rings.length ?? 0}
                  >
                    {(a?.rings ?? []).map((r, i) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: the same element may be ringed twice
                        key={`${r.id}:${i}`}
                        className="dsx-ring"
                        data-testid="ds-reach-ring"
                        style={{
                          left: r.x * dims.scale,
                          top: r.y * dims.scale,
                          width: r.w * dims.scale,
                          height: r.h * dims.scale,
                        }}
                      />
                    ))}
                  </span>
                </div>
              </figure>
            );
          })}
        </div>
        {reach.more.length > 0 ? (
          <p className="dsx-more" data-testid="ds-reach-more">
            <StIcon name="layers" size={14} />
            {moreWords(reach.more)}
          </p>
        ) : null}
        {reach.capped ? (
          <p className="dsx-more" data-testid="ds-reach-capped">
            The first 500 places are ringed.
          </p>
        ) : null}

        {reviewOpen ? (
          <ReachReview
            review={review}
            components={[]}
            places={places}
            scope={scope}
            coverOf={coverOf}
            onUpdate={onUpdate}
            onCancel={onCancel}
          />
        ) : null}
      </div>
      <p className="dsx-note" data-testid="ds-reach-note">
        <b>{REACH_WORDS.noteTitle}</b> {REACH_WORDS.lines} {REACH_WORDS.reviewNote}
      </p>
    </div>
  );
}

const usedPhrase = (reach) => {
  const n = reach.canvases;
  return `Used in ${n} ${n === 1 ? 'canvas' : 'canvases'}`;
};
const usedLine = (reach) => `${usedPhrase(reach)} · showing`;

/** The review list beside the rings: the rows, the ticks, Cancel and Update — the sheet's own model. */
function ReachReview({ review, places, scope, coverOf, onUpdate, onCancel }) {
  const base = useMemo(() => rowsOf(review.canvases, places), [review.canvases, places]);
  const [ticks, setTicks] = useState(() => defaultTicks(base));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo(() => withTicks(base, ticks), [base, ticks]);
  const n = rows.filter((r) => r.ticked).length;
  const keeps = keepsWords(review.changes);
  const state = tickState(rows);
  const toggle = (path) => setTicks((t) => ({ ...t, [path]: !t[path] }));
  const toggleAll = () =>
    setTicks((t) => {
      const next = { ...t };
      for (const r of rows) if (!r.locked) next[r.path] = state !== 'all';
      return next;
    });
  const run = async (fn) => {
    if (busy || !fn) return;
    setBusy(true);
    setError('');
    let res;
    try {
      res = await fn();
    } catch {
      res = { ok: false, message: REVIEW_WORDS.failed };
    }
    setBusy(false);
    if (res?.ok === false) setError(res.message || REVIEW_WORDS.failed);
  };
  const title =
    review.changes.length === 1
      ? `Update canvases with the new ${nameOf(review.changes[0])}?`
      : 'Update canvases?';
  return (
    <div className="island island--pad dsx-rev" data-testid="ds-reach-review">
      <p className="dsx-rev-t" data-testid="ds-reach-review-title">
        {title}
      </p>
      <p className="dsr-head">
        <Tick
          state={state}
          disabled={rows.every((r) => r.locked)}
          label="Update every canvas"
          testid="ds-reach-head-tick"
          onToggle={toggleAll}
        />
        <b data-testid="ds-reach-head">{headWords(rows, scope)}</b>
      </p>
      <div className="dsr-list" data-testid="ds-reach-list">
        {rows.map((r) => (
          <span
            key={r.path}
            className="dsr-row"
            data-off={r.ticked ? undefined : 'true'}
            data-locked={r.locked ? 'true' : undefined}
            data-testid="ds-reach-row"
            data-path={r.path}
          >
            <Tick
              state={r.ticked}
              disabled={r.locked}
              label={`Update ${r.name}`}
              testid="ds-reach-tick"
              path={r.path}
              onToggle={() => toggle(r.path)}
            />
            <span className="dsr-thumb" aria-hidden="true">
              {coverOf?.(r.path) ? <img src={coverOf(r.path)} alt="" /> : null}
            </span>
            <span className="dsr-name">
              <b>{r.name}</b>
              <em>{noteFor(r, { keeps })}</em>
            </span>
          </span>
        ))}
      </div>
      {error ? (
        <p className="dsr-err" role="alert" data-testid="ds-reach-error">
          {error}
        </p>
      ) : null}
      <div className="k-dialog-a">
        <button
          type="button"
          className="btn"
          disabled={busy}
          data-testid="ds-reach-cancel"
          onClick={() => run(onCancel)}
        >
          {REVIEW_WORDS.cancel}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          data-testid="ds-reach-update"
          onClick={() => run(() => onUpdate(rows))}
        >
          {primaryWords(n)}
        </button>
      </div>
    </div>
  );
}
