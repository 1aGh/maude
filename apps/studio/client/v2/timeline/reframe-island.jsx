// client/v2/timeline/reframe-island.jsx — S7.13 (07 · ve-reframe): "Each format frames each clip its own way."
//
// A floating island over the canvas for the SELECTED clip: its whole source picture, and the window one format cuts
// out of it. Drag the window and, where the playhead is, a focus keyframe is written in SOURCE time (`video.reframe`,
// one undo step per drag) — for This format, or for All formats. Reset puts the centre back. B3: there is no "Follow a
// subject" here (V2-1.10 §5.8) — you frame it by hand, and the foot says so in the contract's words.
//
// It opens from the clip inspector's "Re-frame…", the clip's right-click menu and ⌘K (`video.reframe`); Done, Esc, or
// selecting something else closes it. Nothing is stored: the keyframes live on the clip's `<Reframe>` in the canvas.
//
//   ReframeIsland  the drawing (props in, callbacks out — a test drives it)
//   ReframeHost    the wiring (selected clip, comp-media formats, the source's size, the one write pipe)

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { portalToBody } from '../portal-scope.jsx';
import { shellToast } from '../../shell/util.js';
import { useCompMedia } from '../transcript/comp-media-store.js';
import { probeSize } from './fit-model.js';
import {
  defaultFormat,
  dragFocus,
  dropParams,
  focusShown,
  formatOptions,
  isFramed,
  keyframeWords,
  keysFor,
  playheadSourceSec,
  resetParams,
  windowFractions,
  windowTag,
} from './reframe-model.js';

// ── the island's open state: a per-viewer UI fact, never stored ─────────────────────────────────────────────
let openFor = null; // { stableId } | null
let version = 0;
const subs = new Set();
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

export const reframeUi = {
  get: () => openFor,
  /** Open the island for the selected clip (the host resolves which one). */
  open() {
    if (openFor) return;
    openFor = { stableId: null };
    notify();
  },
  close() {
    if (!openFor) return;
    openFor = null;
    notify();
  },
  /** The host pins the clip it opened on, so a different selection closes the island. */
  pin(stableId) {
    if (!openFor || openFor.stableId === stableId) return;
    openFor = { stableId };
    notify();
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  version: () => version,
  /** Tests only. */
  reset() {
    openFor = null;
    notify();
  },
};

export function useReframeUi() {
  useSyncExternalStore(reframeUi.subscribe, reframeUi.version, reframeUi.version);
  return reframeUi.get();
}

const SCOPES = [
  { value: 'format', label: 'This format' },
  { value: 'all', label: 'All formats' },
];
const MAX_W = 560;
const MAX_H = 340;
const NUDGE = 0.01;

function Glyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
      <rect x="5.5" y="5.5" width="5" height="5" rx="0.8" />
    </svg>
  );
}

/** The box the picture is drawn in: its own aspect, as large as the island allows. */
export function pictureBox(src) {
  if (!src?.w || !src?.h) return { w: MAX_W, h: Math.round((MAX_W * 9) / 16) };
  const k = Math.min(MAX_W / src.w, MAX_H / src.h);
  return { w: Math.round(src.w * k), h: Math.round(src.h * k) };
}

/**
 * @param {{
 *   name: string,                                    // the clip, as the timeline calls it
 *   url: string|null,                                // its picture, resolved for this origin
 *   at: number,                                      // the source second shown
 *   src: { w: number, h: number }|null,              // the picture's own size (null until read)
 *   options: Array<{ aspect: string, label: string, w: number, h: number }>,
 *   format: string|null, onFormat: (aspect: string) => void,
 *   scope: 'format'|'all', onScope: (scope: string) => void,
 *   out: { w: number, h: number }|null,              // the shown format, px
 *   focus: [number, number],                         // the window's centre now
 *   zoom: number,
 *   keyCount: number, framed: boolean,
 *   canEdit: boolean,
 *   onDrop: (focus: [number, number]) => void,       // the window was let go here
 *   onReset: () => void, onDone: () => void,
 * }} props
 */
export function ReframeIsland({
  name,
  url,
  at,
  src,
  options,
  format,
  onFormat,
  scope,
  onScope,
  out,
  focus,
  zoom,
  keyCount,
  framed,
  canEdit,
  onDrop,
  onReset,
  onDone,
}) {
  const box = pictureBox(src);
  const videoRef = useRef(null);
  const live = useRef(focus);
  live.current = focus;
  // the hand's state lives in a ref too: a pointermove can arrive before the render the pointerdown asked for
  const dragRef = useRef(null); // { x0, y0, focus0, focus }
  const [drag, setDragState] = useState(null);
  const setDrag = (d) => {
    dragRef.current = d;
    setDragState(d);
  };
  const shown = drag ? drag.focus : focus;
  const win = src && out ? windowFractions(shown, src, out, zoom) : null;
  const option = options.find((o) => o.aspect === format) ?? null;

  // the shown frame follows the playhead (source time); a still of the footage, never playing
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(at)) return undefined;
    const seek = () => {
      try {
        el.currentTime = at;
      } catch {
        /* metadata not in yet: the #t= fragment already asked for this frame */
      }
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
    return () => el.removeEventListener('loadedmetadata', seek);
  }, [at, url]);

  // Esc closes (and only closes)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDone();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDone]);

  const down = (e) => {
    if (!canEdit || !src || !out || e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x0: e.clientX, y0: e.clientY, focus0: focus, focus });
  };
  const move = (e) => {
    const d = dragRef.current;
    if (!d || !src || !out) return;
    const f = dragFocus(d.focus0, e.clientX - d.x0, e.clientY - d.y0, box, src, out, zoom);
    setDrag({ ...d, focus: f });
  };
  const up = (e) => {
    const d = dragRef.current;
    if (!d) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const moved = d.focus[0] !== d.focus0[0] || d.focus[1] !== d.focus0[1];
    setDrag(null);
    if (moved) onDrop(d.focus);
  };
  // the keyboard moves the window too: arrows nudge 1 %, ⇧ 5 %; the write waits for a pause
  const nudge = useRef(null);
  useEffect(() => () => clearTimeout(nudge.current?.timer), []);
  const key = (e) => {
    const step = (e.shiftKey ? 5 : 1) * NUDGE;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!d || !canEdit || !src || !out) return;
    e.preventDefault();
    const from = nudge.current?.focus ?? live.current;
    const next = dragFocus(from, d[0] * box.w, d[1] * box.h, box, src, out, zoom);
    clearTimeout(nudge.current?.timer);
    setDrag({ x0: 0, y0: 0, focus0: from, focus: next });
    nudge.current = {
      focus: next,
      timer: setTimeout(() => {
        nudge.current = null;
        setDrag(null);
        onDrop(next);
      }, 350),
    };
  };

  return (
    <div
      className="island island--pad ve-reframe"
      data-testid="reframe-island"
      role="dialog"
      aria-label={`Frame ${name}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="ve-panel-h">
        <Glyph />
        <span data-testid="reframe-title">Frame “{name}” for</span>
        <div className="st-cp-seg" role="radiogroup" aria-label="Format">
          {options.map((o) => (
            <button
              key={o.aspect}
              type="button"
              role="radio"
              aria-checked={o.aspect === format}
              className={`st-cp-segbtn${o.aspect === format ? ' is-active' : ''}`}
              data-testid={`reframe-format-${o.aspect.replace(':', 'x')}`}
              onClick={() => onFormat(o.aspect)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="ve-src ve-src--big"
        data-testid="reframe-source"
        style={{ width: box.w, height: box.h }}
      >
        {url ? (
          <video
            ref={videoRef}
            className="ve-src-media"
            src={`${url}#t=${at}`}
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
          />
        ) : null}
        {win ? (
          // biome-ignore lint/a11y/useSemanticElements: a draggable window over a picture is no native control
          <div
            className={`ve-crop${drag ? ' is-dragging' : ''}${canEdit ? '' : ' is-locked'}`}
            data-testid="reframe-window"
            data-focus={`${shown[0]},${shown[1]}`}
            role="slider"
            tabIndex={0}
            aria-label={`${windowTag(option)} window — arrow keys move it`}
            aria-valuetext={`centre ${Math.round(shown[0] * 100)} % across, ${Math.round(shown[1] * 100)} % down`}
            aria-valuenow={Math.round(shown[0] * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              left: `${win.left * 100}%`,
              top: `${win.top * 100}%`,
              width: `${win.width * 100}%`,
              height: `${win.height * 100}%`,
            }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={key}
          >
            <span className="ve-crop-tag" data-testid="reframe-window-tag">
              {windowTag(option)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="ve-reframe-foot">
        <div className="st-cp-seg" role="radiogroup" aria-label="Who this framing is for">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={scope === s.value}
              className={`st-cp-segbtn${scope === s.value ? ' is-active' : ''}`}
              data-testid={`reframe-scope-${s.value}`}
              onClick={() => onScope(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ve-reframe-count" data-testid="reframe-count">
          {keyframeWords(keyCount)}
        </span>
        <span className="ve-tl-sp" />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid="reframe-reset"
          disabled={!canEdit || !framed}
          onClick={onReset}
        >
          Reset
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          data-testid="reframe-done"
          onClick={onDone}
        >
          Done
        </button>
      </div>
      <p className="ve-reframe-note" data-testid="reframe-note">
        {canEdit
          ? 'Drag the window to frame it. Each format keeps its own.'
          : 'Ask the owner to change this.'}
      </p>
    </div>
  );
}

/**
 * The wiring. Rendered by the Timeline (which owns the selected clip, the playhead and the one clip pipe) and drawn
 * only while `reframeUi` is open on a clip that has a picture.
 * @param {{
 *   seq: any|null, index: number, comp: { width: number, height: number }|null, fps: number, frame: number,
 *   name: string, canvas: string|null, artboardId: string|null, canEdit: boolean, url: string|null,
 *   run: (params: object) => Promise<any>,
 * }} p
 */
export function ReframeHost({
  seq,
  comp,
  fps,
  frame,
  name,
  canvas,
  artboardId,
  canEdit,
  url,
  run,
}) {
  const ui = useReframeUi();
  const { media } = useCompMedia(canvas, artboardId);
  const options = useMemo(() => formatOptions(media?.formats?.formats), [media]);
  const [format, setFormat] = useState(null);
  const [scope, setScope] = useState('format');
  const [src, setSrc] = useState(null);
  const [held, setHeld] = useState(null);
  const stableId = seq?.stableId ?? null;
  const visual = ['Video', 'OffthreadVideo', 'MaudeVideo', 'Img'].includes(seq?.mediaTag ?? '');
  const valid = !!stableId && visual && !!url;

  // opening on something that cannot be framed says so, once; a different clip closes it
  useEffect(() => {
    if (!ui) return;
    if (!valid) {
      shellToast('Select a clip with a picture to re-frame it.');
      reframeUi.close();
      return;
    }
    if (ui.stableId === null) reframeUi.pin(stableId);
    else if (ui.stableId !== stableId) reframeUi.close();
  }, [ui, valid, stableId]);

  useEffect(() => {
    if (!ui || !url) return undefined;
    let dead = false;
    probeSize(url).then((s) => {
      if (!dead) setSrc(s);
    });
    return () => {
      dead = true;
    };
  }, [ui, url]);

  // the format seg opens on this video's own format; it follows the selection when that changes
  useEffect(() => {
    if (!ui) return;
    setFormat((cur) =>
      cur && options.some((o) => o.aspect === cur) ? cur : defaultFormat(options, artboardId)
    );
  }, [ui, options, artboardId]);
  useEffect(() => {
    if (!ui) setHeld(null);
  }, [ui]);

  const option = options.find((o) => o.aspect === format) ?? null;
  const out = option
    ? { w: option.w, h: option.h }
    : comp
      ? { w: comp.width, h: comp.height }
      : null;
  const aspect = option?.aspect ?? format;
  const t = useMemo(() => playheadSourceSec(frame, seq, fps), [frame, seq, fps]);
  const reframe = seq?.reframe ?? null;
  const sig = JSON.stringify(reframe);

  const computed = out ? focusShown(reframe, scope, aspect, t, out) : [0.5, 0.5];
  const focus =
    held && held.sig === sig && held.t === t && held.scope === scope && held.aspect === aspect
      ? held.focus
      : computed;

  const onDrop = useCallback(
    (f) => {
      if (!out) return;
      setHeld({ sig, t, scope, aspect, focus: f });
      Promise.resolve(run(dropParams(reframe, scope, aspect, t, f))).then((j) => {
        if (j && j.ok === false) setHeld(null);
      });
    },
    [out, sig, t, scope, aspect, reframe, run]
  );
  const onReset = useCallback(() => {
    setHeld(null);
    void run(resetParams(scope, aspect));
  }, [run, scope, aspect]);
  const onDone = useCallback(() => reframeUi.close(), []);

  if (!ui || !valid) return null;
  // on the body: the timeline island moves with a transform, which would hold a fixed child inside it
  return portalToBody(
    <ReframeIsland
      name={name}
      url={url}
      at={t}
      src={src}
      options={options}
      format={format}
      onFormat={setFormat}
      scope={scope}
      onScope={setScope}
      out={out}
      focus={focus}
      zoom={reframe?.zoom ?? 1}
      keyCount={keysFor(reframe, scope, aspect).length}
      framed={isFramed(reframe, scope, aspect)}
      canEdit={canEdit}
      onDrop={onDrop}
      onReset={onReset}
      onDone={onDone}
    />);
}
