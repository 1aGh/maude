// TimelinePanel — DDR-148 bottom timeline for a video-comp, restructured by
// feature-enhanced-video-editing into the iMovie model:
//
//   • ONE px-per-frame scale (timeline-scale.js) drives every block, handle,
//     tick, and drag — zoom from fit-to-width down to single-frame ticks
//     (⌘+/⌘−, pinch, header slider, `0` = fit), horizontal scroll when the
//     content outgrows the viewport (Task 4);
//   • a three-band layout for series comps: overlay lane above, ONE storyline
//     lane of series beats butted side-by-side (transitions as ⧓ seam chips),
//     audio lane below. Non-series comps keep the stacked row-per-sequence
//     fallback (Task 5);
//   • single-select (stableId) with the accent outline; click selects, the
//     bare track scrubs + deselects; Esc/Delete live in the shell keyboard
//     layer (Task 3).
//
// It drives the embedded Player via postMessage (`dgn: 'timeline-seek' |
// -play | -pause`), consumed by video-comp.tsx.

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ImagePlus, MessageSquarePlus, Plus, Scissors, Sparkles, Type } from 'lucide-react';

import ClipInspector from './ClipInspector.jsx';
import { computeSnapTargets, snapFrame } from './timeline-snap.js';
import { activeComp } from './timeline-comp-target.js';
import { getFilmstrip, getPeaks, peaksToPath, stripBucket } from './timeline-media-cache.js';
import {
  clampPxPerFrame,
  fitPxPerFrame,
  MAX_PX_PER_FRAME,
  pxToFrame,
  tickLabel,
  tickStepFrames,
  ZOOM_STEP,
  zoomAroundScroll,
} from './timeline-scale.js';
// DDR-150 dogfood — reuse the SAME context-menu component the canvas uses
// (viewport-aware positioning, keyboard nav, outside-click/Esc dismiss, shared
// .dc-context-menu styling) instead of a bespoke shell menu.
import { ContextMenuView } from '../../context-menu.tsx';

// DDR-150 dogfood #6 — per-row media-kind identity so the timeline reads like
// an editor: what's footage, what's a still, what's audio, what's plain JSX.
function rowKind(seq) {
  if (seq.placeholder) return 'placeholder';
  const t = seq.mediaTag;
  if (t === 'Video' || t === 'OffthreadVideo' || t === 'MaudeVideo') return 'video';
  if (t === 'Img') return 'image';
  if (t === 'Audio') return 'audio';
  return 'jsx';
}
function rowKindGlyph(seq) {
  const k = rowKind(seq);
  if (k === 'placeholder') return '✨';
  if (k === 'video') return '▶';
  if (k === 'image') return '◫';
  if (k === 'audio') return '♪';
  return 'ƒ';
}
function rowKindTitle(seq) {
  const k = rowKind(seq);
  const src = seq.mediaSrc ? ` · ${String(seq.mediaSrc).split('/').pop()}` : '';
  if (k === 'placeholder')
    return `AI placeholder (${seq.placeholder?.kind || 'veo'}) · ${seq.placeholder?.prompt || ''}`;
  if (k === 'video') return `Video clip${src}`;
  if (k === 'image') return `Image${src}`;
  if (k === 'audio') return `Audio${src}`;
  return 'Animated JSX (code-driven)';
}

function TIcon({ name, size = 15 }) {
  const paths = {
    play: <path d="M4 3l9 5-9 5z" fill="currentColor" stroke="none" />,
    pause: (
      <>
        <rect x="4" y="3.5" width="3" height="9" fill="currentColor" stroke="none" />
        <rect x="9" y="3.5" width="3" height="9" fill="currentColor" stroke="none" />
      </>
    ),
    loop: (
      <>
        <polyline points="4 4 4 7 7 7" />
        <path d="M4 7a4.5 4.5 0 1 1 1.3 4.6" />
      </>
    ),
    start: (
      <>
        <line x1="4.5" y1="3.5" x2="4.5" y2="12.5" />
        <path d="M12 3.5l-6 4.5 6 4.5z" fill="currentColor" stroke="none" />
      </>
    ),
    sound: (
      <>
        <path d="M3 6h2.2L8 3.3v9.4L5.2 10H3z" fill="currentColor" stroke="none" />
        <path d="M10.5 5.5a3.2 3.2 0 0 1 0 5" />
        <path d="M12.3 3.7a5.6 5.6 0 0 1 0 8.6" />
      </>
    ),
    muted: (
      <>
        <path d="M3 6h2.2L8 3.3v9.4L5.2 10H3z" fill="currentColor" stroke="none" />
        <line x1="10.7" y1="6" x2="13.7" y2="10" />
        <line x1="13.7" y1="6" x2="10.7" y2="10" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

// lucide wrapper — hairline stroke to match the shell's icon weight (the same
// convention as inspector-controls' `Ic`).
const LIc = ({ as: C, size = 14 }) => (
  <C size={size} strokeWidth={1.75} style={{ display: 'block', flex: 'none' }} />
);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function fmtTime(frame, fps) {
  const s = frame / (fps || 30);
  const whole = Math.floor(s);
  const cs = Math.round((s - whole) * 100);
  return `${whole}.${String(cs).padStart(2, '0')}s`;
}

/**
 * Drag state its own release handler reads synchronously. The releases used
 * to commit from INSIDE a state updater (`setX((d) => { commit(d); … })`), and
 * React is free to run an updater more than once — StrictMode does it on
 * purpose, and a render replayed against a concurrent update may too — so one
 * drag could write its clip twice. Updaters passed to `set` run once, here,
 * against the live value; the release commits outside any updater.
 */
function useLiveState(initial) {
  const [state, setState] = useState(initial);
  const live = useRef(initial);
  const set = useCallback((next) => {
    live.current = typeof next === 'function' ? next(live.current) : next;
    setState(live.current);
  }, []);
  return [state, set, live];
}

// The frame axis starts AFTER the fixed label gutter.
const LABEL_GUTTER = 96;
// Padding the .tl-scroll container puts around the tracks (see 3-shell-maude.css).
const SCROLL_PAD_X = 24;

export default function TimelinePanel({
  comps = [],
  // issue #75 — the comp the shell's transport targets. The panel reads its
  // meta (fps / duration) off the SAME comp, so the readout can never describe
  // a different artboard than the one Play actually moves.
  compId = null,
  sequences = [],
  audio = [],
  transitions = [],
  total = 0,
  frame = 0,
  playing = false,
  loop = false,
  onSeek,
  onPlay,
  onPause,
  onToggleLoop,
  muted = false,
  onToggleMute,
  volume = 1,
  onVolume,
  height,
  resizing,
  onResize,
  onRetime,
  onRemove,
  onReplace,
  onReplaceAudio,
  onReplaceLayer,
  onReorder,
  // Task 6 — magnetic drag commit: (movedClipRef, targetClipRef, 'before'|'after').
  onReorderMove,
  onToggleHide,
  onDropMedia,
  onClose,
  // Task 3 — single-select model. `selectedClipId` is the selected clip's
  // stableId (survives refetch/reorder, unlike an index); click selects,
  // empty-track click deselects, Esc/Delete are handled by the shell.
  selectedClipId = null,
  onSelect,
  // Task 7 — resolves a comp-relative media src (`assets/x.mp4`) to a URL the
  // shell origin can fetch (`/<designRel>/assets/x.mp4`).
  resolveMediaUrl,
  // Phase 2 — transitions from the enumerator (stableId + contentHash), by
  // seam order, for the ⧓ chip → Transition tab flow.
  transitionClips = [],
  // Phase 2 — parametric verb commit: (clipRef, verb, params).
  onClipVerb,
  // Phase 3 — toolbar entries: scissors + overlay authoring.
  onSplitAtPlayhead,
  onAddTitle,
  onAddImage,
  // Phase 4 — AI placeholder authoring + resolution (DDR-164 spine).
  onAddAiClip,
  onGeneratePlaceholder,
  // Task 23 — timeline comments (frame-anchored 💬 pins + agent context).
  comments = [],
  // WKWebView-safe text ask: (title, initial?) => Promise<string|null>.
  promptText,
  onAddComment,
  onResolveComment,
  onDeleteComment,
}) {
  // DDR-150 dogfood — layer expansion (stacked-rows fallback mode only; the
  // storyline layout moves layer detail into the clip inspector).
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dropActive, setDropActive] = useState(false);
  const comp = activeComp(comps, compId);
  // issue #75 — which artboard the rows + transport belong to. `null` means the
  // shell genuinely could NOT tell (a comp mounted outside any artboard, a
  // resolver fall-through). That case must render as an explicit unknown, not
  // as no chip at all: "no chip" already means "single comp, nothing to
  // disambiguate", and reusing it for "I don't know" would make the ambiguous
  // case look like the safe one (security-review 2026-08-12).
  const scopedArtboard = comp?.artboardLabel || comp?.artboardId || null;
  const totalFrames = Math.max(1, total || comp?.durationInFrames || 1);
  const fps = comp?.fps ?? 30;
  const clamped = clamp(Math.round(frame), 0, totalFrames - 1);
  const trackRef = useRef(null);
  const scrollRef = useRef(null);
  const draggingRef = useRef(false);
  const rootRef = useRef(null);
  // Focus the dock the moment it opens — the transport shortcuts live on the
  // SHELL window and need shell focus (see the pre-restructure history).
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // -------------------------------------------------------------------------
  // Task 4 — zoom state. `zoomPxf == null` means fit-to-width (the default);
  // any explicit value is clamped to [fit, MAX_PX_PER_FRAME].
  const [zoomPxf, setZoomPxf] = useState(null);
  const [viewW, setViewW] = useState(0);
  // The scroll container mounts LATER than the panel (only once a comp is
  // announced) — capture it via a callback ref so the ResizeObserver attaches
  // whenever it (re)appears, not just on the panel's first render.
  const [scrollEl, setScrollEl] = useState(null);
  const setScrollRef = useCallback((el) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  useLayoutEffect(() => {
    if (!scrollEl) return undefined;
    const measure = () => setViewW(scrollEl.clientWidth);
    measure();
    // WKWebView occasionally reports 0 on the mount frame (before layout
    // settles) and the ResizeObserver never re-fires — the "zoom stopped
    // working" symptom (fit-scale computed against a 40px axis). Re-measure on
    // rAF until a real width lands.
    let raf = 0;
    const retry = () => {
      if (scrollEl.clientWidth > 0) measure();
      else raf = requestAnimationFrame(retry);
    };
    if (scrollEl.clientWidth <= 0) raf = requestAnimationFrame(retry);
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollEl]);
  const axisViewport = Math.max(40, viewW - LABEL_GUTTER - SCROLL_PAD_X);
  const fitPxf = fitPxPerFrame(axisViewport, totalFrames);
  const pxf = zoomPxf == null ? fitPxf : clampPxPerFrame(zoomPxf, axisViewport, totalFrames);
  const axisPx = Math.ceil(totalFrames * pxf);
  const x = (f) => f * pxf; // axis-relative px for a frame

  // Scroll compensation applied after a zoom (keeps the anchor stationary).
  const pendingScrollRef = useRef(null);
  useLayoutEffect(() => {
    if (pendingScrollRef.current == null) return;
    const el = scrollRef.current;
    if (el) el.scrollLeft = pendingScrollRef.current;
    pendingScrollRef.current = null;
  });

  /** Zoom to `nextPxf` keeping `anchorFrame` (default: playhead, or selection)
   *  at the same viewport x. */
  const zoomTo = useCallback(
    (nextRaw, anchorFrame) => {
      const el = scrollRef.current;
      const next = clampPxPerFrame(nextRaw, axisViewport, totalFrames);
      const anchor =
        anchorFrame != null
          ? anchorFrame
          : (sequences.find((s) => s.stableId && s.stableId === selectedClipId)?.from ?? clamped);
      if (el) pendingScrollRef.current = zoomAroundScroll(pxf, next, anchor, el.scrollLeft);
      setZoomPxf(next <= fitPxf ? null : next);
    },
    [axisViewport, totalFrames, pxf, fitPxf, clamped, sequences, selectedClipId]
  );

  // ⌘+/⌘− zoom · 0 = fit. Window-level (the dock is a sibling of the canvas),
  // gated on not-typing; ⌘± deliberately overrides browser zoom while the
  // timeline is open (the documented keyboard map).
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomTo(pxf * ZOOM_STEP);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        zoomTo(pxf / ZOOM_STEP);
      } else if (e.key === '0' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setZoomPxf(null);
      } else if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // The C comment tool (mirrors the artboard's comment shortcut).
        setCommentMode((m) => !m);
      } else if (e.key === 'Escape') {
        setCommentMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pxf, zoomTo]);

  // Pinch-zoom (trackpad pinch arrives as wheel + ctrlKey) around the cursor.
  // Non-passive listener — preventDefault must actually stop the page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel = native scroll
      e.preventDefault();
      const rect = trackRef.current?.getBoundingClientRect();
      const anchor =
        rect != null
          ? clamp(Math.round(pxToFrame(e.clientX - rect.left - LABEL_GUTTER, pxf)), 0, totalFrames - 1)
          : clamped;
      zoomTo(pxf * Math.exp(-e.deltaY * 0.01), anchor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pxf, clamped, totalFrames, zoomTo, scrollEl]);

  // Header slider — log scale from fit (0) to MAX_PX_PER_FRAME (100).
  const zoomSliderValue = (() => {
    const ratio = Math.log(pxf / fitPxf) / Math.log(MAX_PX_PER_FRAME / Math.max(1e-6, fitPxf));
    return clamp(Math.round((Number.isFinite(ratio) ? ratio : 0) * 100), 0, 100);
  })();
  const zoomFromSlider = (v) => {
    const ratio = clamp(v, 0, 100) / 100;
    return fitPxf * Math.pow(MAX_PX_PER_FRAME / Math.max(1e-6, fitPxf), ratio);
  };

  // -------------------------------------------------------------------------
  // Drag machines (retime / move) — px-per-frame based.
  const [retimeDrag, setRetimeDrag, retimeLive] = useLiveState(null);
  const [moveDrag, setMoveDrag, moveLive] = useLiveState(null);
  // Task 6 — magnetic storyline reorder drag: { index, slot, targetSlot, dx, pxf }.
  const [reorderDrag, setReorderDrag, reorderLive] = useLiveState(null);
  // Debate verdict (feedback): a momentary accent rule at the frame a drag just
  // snapped to — magnetism is otherwise invisible. { frame } | null.
  const [snapFlash, setSnapFlash] = useState(null);
  const snapFlashTimer = useRef(null);
  const flashSnap = useCallback((frame) => {
    setSnapFlash({ frame });
    clearTimeout(snapFlashTimer.current);
    snapFlashTimer.current = setTimeout(() => setSnapFlash(null), 350);
  }, []);
  // Task 6 — file-drop insertion caret: { lane, slot?, frame?, x } (axis px).
  const [dropCaret, setDropCaret] = useState(null);
  // Dogfood (2026-07-30) — the C comment tool: while armed, a click anywhere on
  // the timeline pins a comment to the exact frame (+ clip + lane when the
  // click lands on a block) instead of scrubbing/selecting.
  const [commentMode, setCommentMode] = useState(false);
  // Dogfood (2026-07-30) — vertical layer reorder: dragging an overlay row's
  // lane chip up/down re-stacks the standalone clips (z-order = doc order).
  const [layerDrag, setLayerDrag, layerLive] = useLiveState(null);
  // Right-click clip context menu: { index, x, y }.
  const [ctxMenu, setCtxMenu] = useState(null);
  // Task 23 — the open comment-thread popover: { id, x, y } | null.
  const [commentPopover, setCommentPopover] = useState(null);
  // Task 9 — the clip inspector popover: { mode: 'clip'|'transition', index?,
  // seam?, x, y }. One instance; opened by double-click / context "Adjust…" /
  // a seam chip click.
  const [inspector, setInspector] = useState(null);
  // Task 11 — left-edge in-point trim drag: { index, ref, startX, pxf, delta }.
  const [trimInDrag, setTrimInDrag, trimInLive] = useLiveState(null);
  // True after a body-drag actually moved — suppresses the click-to-select.
  const movedRef = useRef(false);
  // Drag the top edge to resize the panel — pointer-capture + window listeners
  // attached SYNCHRONOUSLY in pointerdown (the "attach a frame late" lesson).
  const beginResize = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const startY = e.clientY;
      const startH = height || 216;
      const onMove = (ev) => {
        onResize?.(clamp(startH + (startY - ev.clientY), 140, 640));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [height, onResize]
  );

  const seekAt = useCallback(
    (clientX) => {
      const el = trackRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const f = pxToFrame(clientX - r.left - LABEL_GUTTER, pxf);
      onSeek?.(clamp(Math.round(f), 0, totalFrames - 1));
    },
    [onSeek, totalFrames, pxf]
  );

  useEffect(() => {
    if (!draggingRef.current) return undefined;
    const move = (e) => seekAt(e.clientX);
    const up = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  // Comment tool — pin a comment at the clicked frame. `seq`/`laneName` are
  // set when the click landed on a clip block (anchor survives reorder via
  // clipStableId + frameOffset); a bare-track click anchors the frame alone.
  // The composer is a small popover ANCHORED at the click (the artboard
  // comment grammar), not a center-screen modal (dogfood 2026-07-30).
  const [commentDraft, setCommentDraft] = useState(null); // { x, y, anchor, at }
  const placeCommentAt = useCallback(
    (e, seq, laneName) => {
      const el = trackRef.current;
      if (!el || !onAddComment) return;
      const r = el.getBoundingClientRect();
      const f = clamp(
        Math.round(pxToFrame(e.clientX - r.left - LABEL_GUTTER, pxf)),
        0,
        totalFrames - 1
      );
      const anchor =
        seq && seq.stableId
          ? {
              clipStableId: seq.stableId,
              frameOffset: Math.max(0, f - (seq.from || 0)),
              frame: f,
              lane: laneName || undefined,
            }
          : { frame: f, lane: laneName || undefined };
      setCommentDraft({
        x: clamp(e.clientX - 130, 8, window.innerWidth - 280),
        y: Math.max(48, e.clientY - 140),
        anchor,
        at: f,
      });
      setCommentMode(false);
    },
    [pxf, totalFrames, onAddComment]
  );

  const onTrackDown = (e) => {
    // A click on a sequence block SELECTS it (handled there); a press on the
    // bare track deselects, scrubs, and starts a scrub drag.
    if (retimeDrag) return; // a resize is in flight — don't scrub
    if (commentMode) {
      e.preventDefault();
      placeCommentAt(e, null, null);
      return;
    }
    e.preventDefault(); // don't start a text selection while scrubbing
    onSelect?.(null);
    draggingRef.current = true;
    seekAt(e.clientX);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  // Alt = no snap; threshold is ~8 px at the CURRENT zoom.
  const snapThreshold = (altKey) => (altKey ? 0 : 8 / pxf);

  // Drag-to-retime — the right edge rewrites durationInFrames on release.
  useEffect(() => {
    if (!retimeDrag) return undefined;
    const move = (e) => {
      const deltaFrames = (e.clientX - retimeDrag.startX) / retimeDrag.pxf;
      const rawEnd = retimeDrag.startFrom + Math.round(retimeDrag.startDur + deltaFrames);
      let end = snapFrame(rawEnd, retimeDrag.targets, e.altKey ? 0 : 8 / retimeDrag.pxf);
      if (end !== rawEnd) flashSnap(end);
      let curDur = Math.max(1, end - retimeDrag.startFrom);
      // Task 8 — clamp to the source's real duration (footage sidecar) so a
      // trim can't ask the clip for frames the file doesn't have.
      let atClamp = curDur <= 1;
      if (retimeDrag.maxDur > 0 && curDur >= retimeDrag.maxDur) {
        curDur = retimeDrag.maxDur;
        atClamp = true;
      }
      setRetimeDrag((d) => (d ? { ...d, curDur, atClamp } : d));
    };
    const up = () => {
      const d = retimeLive.current;
      setRetimeDrag(null);
      if (d && d.curDur !== d.startDur) onRetime?.(d.ref ?? d.index, { durationInFrames: d.curDur });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [retimeDrag, onRetime, flashSnap]);

  // Body-drag to move a standalone clip's `from`. Commits on release.
  useEffect(() => {
    if (!moveDrag) return undefined;
    const move = (e) => {
      const deltaFrames = (e.clientX - moveDrag.startX) / moveDrag.pxf;
      const rawFrom = Math.max(0, Math.round(moveDrag.startFrom + deltaFrames));
      const curFrom = Math.max(0, snapFrame(rawFrom, moveDrag.targets, e.altKey ? 0 : 8 / moveDrag.pxf));
      if (curFrom !== rawFrom) flashSnap(curFrom);
      if (Math.abs(curFrom - moveDrag.startFrom) >= 1) movedRef.current = true;
      // Vertical layer-move affordance: highlight the storyline while the clip
      // hovers over it (the drop would move it between layers).
      const story = document.querySelector('.tl-storyline-track')?.getBoundingClientRect();
      const overStory = !!(story && e.clientY >= story.top && e.clientY <= story.bottom);
      setMoveDrag((d) => (d ? { ...d, curFrom, overStory } : d));
    };
    const up = (e) => {
      const d = moveLive.current;
      setMoveDrag(null);
      if (!d) return;
      // Dropping the clip ON the storyline lane moves it between layers
      // (the layers model); otherwise commit the horizontal from-move.
      const story = document.querySelector('.tl-storyline-track')?.getBoundingClientRect();
      if (
        story &&
        onClipVerb &&
        e.clientY >= story.top &&
        e.clientY <= story.bottom &&
        movedRef.current
      ) {
        onClipVerb(d.ref ?? { index: d.index }, 'to-storyline', {});
      } else if (d.curFrom !== d.startFrom) {
        onRetime?.(d.ref ?? d.index, { from: d.curFrom });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [moveDrag, onRetime, onClipVerb, flashSnap]);

  // Task 11 — left-edge in-point trim: preview live, commit `trim-in` on
  // release (the server writes trimBefore + duration + from + ripple).
  useEffect(() => {
    if (!trimInDrag) return undefined;
    const move = (e) => {
      const raw = Math.round((e.clientX - trimInDrag.startX) / trimInDrag.pxf);
      // positive = trim INTO the clip; clamp so ≥1 frame stays.
      const delta = Math.min(trimInDrag.maxDelta, raw);
      setTrimInDrag((d) => (d ? { ...d, delta } : d));
    };
    const up = () => {
      const d = trimInLive.current;
      setTrimInDrag(null);
      if (d && d.delta) onClipVerb?.(d.ref, 'trim-in', { deltaFrames: d.delta });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [trimInDrag, onClipVerb]);

  const startTrimIn = (e, index) => {
    e.stopPropagation();
    e.preventDefault();
    const seq = sequences[index];
    if (!seq) return;
    setTrimInDrag({
      index,
      ref: refFor(seq, index),
      startX: e.clientX,
      pxf,
      delta: 0,
      maxDelta: Math.max(0, (seq.duration ?? 1) - 1),
    });
  };

  // Snap targets for a drag on clip `index`: ticks + OTHER clips' edges + playhead.
  const snapTargetsFor = (index) =>
    computeSnapTargets({ fps, totalFrames, clips: sequences, movingIndex: index, playhead: clamped });

  // Task 3 — every op addresses a clip as { stableId, index }: stableId when the
  // enumerator supplied one (multi-comp-safe, survives reorder), the row index
  // as the legacy fallback (DDR-150: never address by row index when avoidable).
  const refFor = (seq, index) => ({ stableId: seq?.stableId ?? null, index });

  // Task 6 — magnetic reorder: body-dragging a series beat shuffles the
  // storyline live (a `from` write would be a lie — Remotion computes series
  // offsets), and commits as a real series MOVE on release.
  const startReorder = (e, index) => {
    e.stopPropagation();
    if (!onReorderMove) return;
    const story = sequences
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.series);
    const slot = story.findIndex(({ i }) => i === index);
    if (slot < 0) return;
    movedRef.current = false;
    setReorderDrag({ index, slot, targetSlot: slot, dx: 0, startX: e.clientX, pxf });
  };

  useEffect(() => {
    if (!reorderDrag) return undefined;
    const story = sequences.map((s, i) => ({ s, i })).filter(({ s }) => s.series);
    const move = (e) => {
      const dx = e.clientX - reorderDrag.startX;
      if (Math.abs(dx) > 3) movedRef.current = true;
      const me = story[reorderDrag.slot];
      if (!me) return;
      const draggedCenter = me.s.from + me.s.duration / 2 + dx / reorderDrag.pxf;
      // Slot = how many OTHER beats' centers sit left of the dragged center.
      let target = 0;
      story.forEach(({ s }, k) => {
        if (k === reorderDrag.slot) return;
        if (s.from + s.duration / 2 < draggedCenter) target += 1;
      });
      setReorderDrag((d) => (d ? { ...d, dx, targetSlot: target } : d));
    };
    const up = (e) => {
      const d = reorderLive.current;
      setReorderDrag(null);
      if (!d) return;
      if (movedRef.current && onClipVerb) {
        const track = document.querySelector('.tl-storyline-track')?.getBoundingClientRect();
        if (track && e.clientY < track.top - 6) {
          const beat = sequences[d.index];
          if (beat) {
            onClipVerb(refFor(beat, d.index), 'to-overlay', {});
            return;
          }
        }
      }
      if (d.targetSlot !== d.slot) {
        const moved = story[d.slot];
        // targetSlot counts positions among the OTHER beats — map to a ref
        // beat + before/after in the original order.
        const others = story.filter((_, k) => k !== d.slot);
        if (moved && others.length) {
          if (d.targetSlot <= 0) {
            onReorderMove?.(refFor(moved.s, moved.i), refFor(others[0].s, others[0].i), 'before');
          } else {
            const ref = others[Math.min(d.targetSlot, others.length) - 1];
            onReorderMove?.(refFor(moved.s, moved.i), refFor(ref.s, ref.i), 'after');
          }
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [reorderDrag, sequences, onReorderMove, onClipVerb]);

  // Vertical layer reorder — drag an overlay row's V-chip across the rows;
  // the drop commits ONE `layer-order` verb (doc-order index = z-order).
  const startLayerDrag = (e, index, docIdx) => {
    if (!onClipVerb) return;
    e.stopPropagation();
    e.preventDefault();
    setLayerDrag({ index, docIdx, curTarget: docIdx });
  };
  useEffect(() => {
    if (!layerDrag) return undefined;
    const move = (e) => {
      let target = layerDrag.docIdx;
      for (const row of document.querySelectorAll('[data-layer-doc]')) {
        const r = row.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) target = Number(row.dataset.layerDoc);
      }
      setLayerDrag((d) => (d ? { ...d, curTarget: target } : d));
    };
    const up = () => {
      const d = layerLive.current;
      setLayerDrag(null);
      if (d && d.curTarget !== d.docIdx) {
        const seq = sequences[d.index];
        if (seq) onClipVerb?.(refFor(seq, d.index), 'layer-order', { toIndex: d.curTarget });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [layerDrag, sequences, onClipVerb]);

  const startMove = (e, index, startFrom) => {
    if (sequences[index]?.loose) return; // loose media row — read-only
    // A TransitionSeries/Series clip computes its own position — Remotion
    // IGNORES a `from` prop on it; its body-drag is the magnetic REORDER.
    if (sequences[index]?.series) {
      startReorder(e, index);
      return;
    }
    if (!onRetime) return;
    e.stopPropagation();
    movedRef.current = false;
    setMoveDrag({
      index,
      ref: refFor(sequences[index], index),
      startX: e.clientX,
      startFrom,
      pxf,
      curFrom: startFrom,
      targets: snapTargetsFor(index),
    });
  };

  const startResize = (e, index, dur) => {
    e.stopPropagation();
    e.preventDefault();
    const seq = sequences[index];
    const startFrom = seq?.from ?? 0;
    setRetimeDrag({
      index,
      ref: refFor(seq, index),
      startX: e.clientX,
      startDur: dur,
      startFrom,
      pxf,
      curDur: dur,
      atClamp: false,
      // Task 8 — source-bounds clamp (0 = unknown, no clamp).
      maxDur: (seq?.mediaSrc && visuals[`d|${seq.mediaSrc}`]) || 0,
      targets: snapTargetsFor(index),
    });
  };

  /** Task 8 — live trim/move delta: `+12f / +0.40s`. */
  const fmtDelta = (frames) => {
    const sign = frames >= 0 ? '+' : '−';
    const af = Math.abs(Math.round(frames));
    return `${sign}${af}f / ${sign}${(af / (fps || 30)).toFixed(2)}s`;
  };

  // Ruler ticks at the adaptive density (1 s → 10 f → 1 f as you zoom in).
  const step = tickStepFrames(pxf, fps);
  const ticks = [];
  for (let f = 0; f <= totalFrames - 1; f += step) ticks.push(f);

  // -------------------------------------------------------------------------
  // Task 5 — the three-band projection. Series beats form THE storyline lane;
  // standalone sequences are the overlay band; loose <Audio> beds the audio
  // band. A comp with no series clips keeps the stacked row-per-sequence
  // fallback (its truthful projection).
  const storyline = [];
  const overlay = [];
  const audioClips = []; // Task 18 — standalone audio clips live in the audio band
  sequences.forEach((seq, i) => {
    if (seq.series) storyline.push({ seq, i });
    else if (rowKind(seq) === 'audio') audioClips.push({ seq, i });
    else overlay.push({ seq, i });
  });
  // Band (iMovie) layout is for MEDIA cuts. A purely digital comp — every
  // sequence a hand-authored JSX scene (Maude Video Intro, Photo Editor
  // Trailer) — keeps the stacked row-per-sequence projection, which is the
  // truthful, layer-expandable view the user asked back (dogfood 2026-07-30).
  const bandMode =
    storyline.length > 0 && sequences.some((s) => rowKind(s) !== 'jsx');

  // -------------------------------------------------------------------------
  // Task 7 — real media visuals. Async extraction (never blocks the scrub);
  // today's plain blocks are the instant fallback. Keyed by src + zoom bucket.
  const [visuals, setVisuals] = useState({});
  const resolveUrl = useCallback(
    (src) => {
      if (!src) return null;
      // Security (adversarial review 2026-07-30): mediaSrc comes verbatim from
      // (untrusted, DDR-054) canvas source. Filmstrip/waveform extraction runs
      // on the privileged no-CSP SHELL origin (fetch + <video src>), so a
      // protocol-relative `//host/…` — which passes `startsWith('/')` — would
      // egress to an attacker host zero-click on Timeline open. Reject `//`
      // (and any scheme); only a single-slash-rooted, same-origin path is a
      // real contained asset. Everything else routes through resolveMediaUrl,
      // which prefixes the designRoot (same-origin by construction).
      if (src.startsWith('//')) return null;
      if (/^(https?:|data:|blob:)/i.test(src)) return null;
      if (src.startsWith('/')) return src;
      return resolveMediaUrl ? resolveMediaUrl(src) : null;
    },
    [resolveMediaUrl]
  );
  useEffect(() => {
    let alive = true;
    for (const seq of sequences) {
      if (rowKind(seq) !== 'video' || !seq.mediaSrc) continue;
      const url = resolveUrl(seq.mediaSrc);
      if (!url) continue;
      const bucket = stripBucket(Math.max(2, seq.duration * pxf));
      const key = `s|${seq.mediaSrc}|${bucket}`;
      if (visuals[key] !== undefined) continue;
      setVisuals((v) => (v[key] !== undefined ? v : { ...v, [key]: null }));
      getFilmstrip(url, bucket).then((strip) => {
        if (alive && strip) setVisuals((v) => ({ ...v, [key]: strip }));
      });
    }
    for (const a of audio) {
      if (!a.src) continue;
      const url = resolveUrl(a.src);
      if (!url) continue;
      const key = `p|${a.src}`;
      if (visuals[key] !== undefined) continue;
      setVisuals((v) => (v[key] !== undefined ? v : { ...v, [key]: null }));
      getPeaks(url).then((peaks) => {
        if (alive && peaks) setVisuals((v) => ({ ...v, [key]: peaks }));
      });
    }
    // Task 8 — source duration (frames) from the footage sidecar, for trim
    // clamping. Cached under `d|<src>`; absent sidecar caches `0` (no clamp).
    for (const seq of sequences) {
      if (rowKind(seq) !== 'video' || !seq.mediaSrc) continue;
      const key = `d|${seq.mediaSrc}`;
      if (visuals[key] !== undefined) continue;
      setVisuals((v) => (v[key] !== undefined ? v : { ...v, [key]: null }));
      fetch(`/_api/footage?asset=${encodeURIComponent(seq.mediaSrc)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive) return;
          const sec = Number(j?.durationSec);
          const frames = Number.isFinite(sec) && sec > 0 ? Math.round(sec * (fps || 30)) : 0;
          setVisuals((v) => ({ ...v, [key]: frames }));
        })
        .catch(() => {
          if (alive) setVisuals((v) => ({ ...v, [key]: 0 }));
        });
    }
    return () => {
      alive = false;
    };
  }, [sequences, audio, pxf, resolveUrl, visuals, fps]);

  // Task 6 — live reorder preview: while a beat drags, the OTHER beats take
  // their preview `from`s (cursor walk over the preview order, seams
  // approximated by the first transition's duration); the dragged beat follows
  // the pointer. Truth re-renders from disk after the commit.
  const previewFroms = (() => {
    if (!reorderDrag) return null;
    const story = sequences.map((s, i) => ({ s, i })).filter(({ s }) => s.series);
    const dragged = story[reorderDrag.slot];
    if (!dragged) return null;
    const seamDur = (transitions && transitions[0]?.dur) || 0;
    const others = story.filter((_, k) => k !== reorderDrag.slot);
    const order = [...others];
    order.splice(Math.max(0, Math.min(reorderDrag.targetSlot, others.length)), 0, dragged);
    const map = new Map();
    let cursor = story[0]?.s.from ?? 0;
    for (const { s, i } of order) {
      map.set(i, cursor);
      cursor += s.duration - seamDur;
    }
    return map;
  })();

  // DDR-150 P4 / Task 6 — file drops. Lanes set an insertion caret and hand a
  // POSITION to onDropMedia(files, pos); the panel-level drop stays as the
  // append fallback.
  const hasFiles = (dt) => Array.from(dt?.types ?? []).includes('Files');
  const onDrop = (e) => {
    if (!onDropMedia || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    setDropCaret(null);
    const files = Array.from(e.dataTransfer.files || []);
    // A drop OUTSIDE any lane = a NEW overlay layer at the playhead (the
    // layers model); dropping ON the storyline lane still makes a beat.
    if (files.length) onDropMedia(files, comp ? { lane: 'overlay', frame: clamped } : null);
  };

  /** Storyline seam boundaries in axis px (slot 0 … N). */
  const storyBoundaries = () => {
    const story = sequences.filter((s) => s.series);
    const pts = story.map((s) => x(s.from));
    if (story.length) {
      const last = story[story.length - 1];
      pts.push(x(last.from + last.duration));
    }
    return pts;
  };

  const onStoryDragOver = (e) => {
    if (!onDropMedia || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const pts = storyBoundaries();
    let slot = 0;
    let best = Infinity;
    pts.forEach((p, k) => {
      const d = Math.abs(p - px);
      if (d < best) {
        best = d;
        slot = k;
      }
    });
    setDropCaret({ lane: 'storyline', slot, x: pts[slot] ?? px });
  };

  const onLaneDragOver = (lane, row) => (e) => {
    if (!onDropMedia || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const f = clamp(Math.round(pxToFrame(px, pxf)), 0, totalFrames - 1);
    setDropCaret({ lane, row, frame: f, x: px });
  };

  const laneCaret = (lane, row) =>
    dropCaret && dropCaret.lane === lane && dropCaret.row === row ? (
      <span
        className="tl-drop-caret"
        data-testid="timeline-drop-caret"
        style={{ left: dropCaret.x - 1 }}
      />
    ) : null;

  const onLaneDrop = (pos) => (e) => {
    if (!onDropMedia || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    const caret = dropCaret;
    setDropCaret(null);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    if (pos.lane === 'storyline') {
      onDropMedia(files, { lane: 'storyline', index: caret?.slot ?? undefined });
    } else {
      onDropMedia(files, { lane: pos.lane, frame: caret?.frame ?? 0 });
    }
  };

  /** One clip block + its hover affordances (trim handle, replace, remove),
   *  absolutely positioned on the frame axis of its lane. */
  const renderBlock = (seq, i, { lane, laneName }) => {
    const dur = retimeDrag && retimeDrag.index === i ? retimeDrag.curDur : seq.duration;
    const isResizing = !!(retimeDrag && retimeDrag.index === i);
    let blockFrom = moveDrag && moveDrag.index === i ? moveDrag.curFrom : seq.from;
    const moving = !!(moveDrag && moveDrag.index === i);
    // Task 6 — magnetic reorder preview: the dragged beat follows the pointer,
    // its siblings take their preview slots.
    let dragOffset = 0;
    let dragging = false;
    if (lane === 'storyline' && reorderDrag) {
      if (reorderDrag.index === i) {
        dragging = true;
        dragOffset = reorderDrag.dx;
      } else if (previewFroms?.has(i)) {
        blockFrom = previewFroms.get(i);
      }
    }
    const layers = Array.isArray(seq.layers) ? seq.layers : [];
    const decomposable = layers.length >= 2;
    const selected = selectedClipId != null && seq.stableId === selectedClipId;
    // Debate verdict (orientation): never surface a content-hash filename or a
    // bare tag name as the clip's identity — "Clip N" beats "bca08b1e.mov";
    // the real src stays in the tooltip.
    const rawName =
      ['Video', 'OffthreadVideo', 'Audio', 'Img', 'MaudeVideo', 'MaudeAudio', 'MaudeImg'].includes(seq.label) && seq.mediaSrc
        ? String(seq.mediaSrc).split('/').pop()
        : seq.label;
    const isHashName = /^[a-f0-9]{6,16}\.\w+$/i.test(rawName || '');
    const displayLabel = isHashName ? `Clip ${i + 1}` : rawName;
    // Task 11 — in-point trim preview: left edge follows, width shrinks.
    const trimming = !!(trimInDrag && trimInDrag.index === i);
    const trimDelta = trimming ? trimInDrag.delta : 0;
    const left = x(blockFrom) + dragOffset + (trimming ? x(trimDelta) : 0);
    const width = Math.max(2, x(dur - trimDelta));
    const mp = seq.mediaProps || null;
    return (
      <Fragment key={`b${i}`}>
        <button
          type="button"
          className={`tl-seq-block${isResizing ? ' is-resizing' : ''}${moving ? ' is-moving' : ''}${dragging ? ' is-dragging' : ''}${seq.hidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}${lane === 'storyline' ? ' tl-beat' : ''}`}
          data-testid={`timeline-seq-${i}`}
          data-clip-id={seq.stableId || undefined}
          data-kind={rowKind(seq)}
          data-hidden={seq.hidden ? '1' : undefined}
          title={
            seq.series
              ? `${seq.label} · ${blockFrom}–${blockFrom + dur}f (${dur}f) · series beat — trim the right edge to retime`
              : `${seq.label} · ${blockFrom}–${blockFrom + dur}f (${dur}f) · drag to move (Alt = no snap)`
          }
          aria-label={
            seq.series
              ? `${seq.label}, series beat, frames ${blockFrom} to ${blockFrom + dur}. Click to select.`
              : `${seq.label}, from frame ${blockFrom} to ${blockFrom + dur}, ${dur} frames. Click to select; drag to move.`
          }
          style={{
            left,
            width,
            cursor: onRetime && !seq.series ? 'grab' : undefined,
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect?.(seq.stableId ?? null); // right-click selects too (iMovie)
            setCtxMenu({ index: i, x: e.clientX, y: e.clientY });
          }}
          onPointerDown={(e) => {
            if (commentMode) {
              e.stopPropagation();
              e.preventDefault();
              placeCommentAt(e, seq, laneName || lane);
              return;
            }
            startMove(e, i, seq.from);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (seq.loose) return; // read-only row — no clip inspector
            // Task 9 — double-click opens the clip inspector on the selection.
            onSelect?.(seq.stableId ?? null);
            setInspector({ mode: 'clip', index: i, x: e.clientX - 120, y: Math.max(60, e.clientY - 320) });
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (movedRef.current) {
              movedRef.current = false;
              return; // a drag-move just happened — don't also select
            }
            // Task 3 — click SELECTS (iMovie's select → act grammar); seeking
            // stays on the ruler/track scrub.
            onSelect?.(seq.stableId ?? null);
          }}
        >
          {mp?.playbackRate && mp.playbackRate !== 1 ? (
            <span className="tl-chip tl-chip-speed" data-testid={`timeline-speed-chip-${i}`}>
              {mp.playbackRate}×
            </span>
          ) : null}
          {mp?.muted ? (
            <span className="tl-chip tl-chip-mute" title="Muted" data-testid={`timeline-mute-chip-${i}`}>
              🔇
            </span>
          ) : null}
          {(() => {
            // Task 7 — filmstrip behind the label (async; block is the fallback).
            // Dogfood 2026-07-30 — an Img overlay shows the IMAGE ITSELF (no
            // extraction needed; the strip was video-only and image overlays
            // read as anonymous slabs).
            if (rowKind(seq) === 'image' && seq.mediaSrc) {
              const url = resolveUrl(seq.mediaSrc);
              if (!url) return null;
              return (
                <span className="tl-strip tl-strip--img" aria-hidden="true">
                  <img src={url} alt="" draggable={false} />
                </span>
              );
            }
            if (rowKind(seq) !== 'video' || !seq.mediaSrc) return null;
            const bucket = stripBucket(Math.max(2, seq.duration * pxf));
            const strip = visuals[`s|${seq.mediaSrc}|${bucket}`];
            if (!strip) return null;
            return (
              <span className="tl-strip" aria-hidden="true">
                {strip.map((u, k) => (
                  <img key={k} src={u} alt="" draggable={false} />
                ))}
              </span>
            );
          })()}
          <span className="tl-kind" data-kind={rowKind(seq)} title={rowKindTitle(seq)}>
            {rowKindGlyph(seq)}
          </span>
          <span className="tl-seq-name">
            {displayLabel}
            {isResizing ? ` · ${dur}f` : ''}
            {moving ? ` · @${blockFrom}f` : ''}
          </span>
          {seq.keyframes.map((kf, k) => {
            const l = ((kf.from - seq.from) / Math.max(1, seq.duration)) * 100;
            const w = ((kf.to - kf.from) / Math.max(1, seq.duration)) * 100;
            return (
              <span
                key={k}
                className="tl-kf"
                data-testid={`timeline-kf-${i}-${k}`}
                style={{ left: `${clamp(l, 0, 100)}%`, width: `${Math.max(1.5, w)}%` }}
                title={`seek to keyframe ${kf.from}f (animates ${kf.from}–${kf.to}f)`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek?.(kf.from);
                }}
              />
            );
          })}
          {(comments || [])
            .filter((c) => c.timeline?.clipStableId && c.timeline.clipStableId === seq.stableId)
            .map((c) => (
              // In-place 💬 badge at the comment's exact frame ON the clip —
              // the top strip stays as the overview; this is the "where".
              <span
                key={`cm${c.id}`}
                role="button"
                tabIndex={-1}
                className={`tl-clip-pin${c.status === 'resolved' ? ' is-resolved' : ''}`}
                data-testid={`timeline-clip-pin-${c.id}`}
                title={`${c.author || 'comment'}: ${c.text}`}
                style={{ left: x(clamp(c.timeline.frameOffset || 0, 0, Math.max(0, dur - 1))) }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setCommentPopover({ id: c.id, x: ev.clientX - 130, y: Math.max(60, ev.clientY - 180) });
                }}
              >
                💬
              </span>
            ))}
          {lane === 'storyline' && decomposable ? (
            <span
              role="button"
              tabIndex={-1}
              className="tl-beat-expand"
              data-testid={`timeline-beat-expand-${i}`}
              title={collapsed.has(i) ? 'Show this beat’s layers' : 'Collapse layers'}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => {
                ev.stopPropagation();
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                });
              }}
            >
              {collapsed.has(i) ? '▸' : '▾'}
            </span>
          ) : null}
        </button>
        {onRetime && !seq.loose ? (
          <span
            className="tl-seq-resize"
            data-testid={`timeline-resize-${i}`}
            title="Drag to retime this sequence"
            style={{ left: left + width - 5 }}
            onPointerDown={(e) => startResize(e, i, seq.duration)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
        {onClipVerb && !seq.loose && seq.mediaSrc && (rowKind(seq) === 'video' || rowKind(seq) === 'audio') ? (
          <span
            className="tl-seq-trim-in"
            data-testid={`timeline-trim-in-${i}`}
            title="Drag to trim the in-point (left edge)"
            style={{ left: left - 1 }}
            onPointerDown={(e) => startTrimIn(e, i)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
        {trimming ? (
          <span
            className={`tl-trim-tip${trimDelta >= trimInDrag.maxDelta && trimDelta > 0 ? ' is-clamped' : ''}`}
            data-testid="timeline-trim-in-tip"
            style={{ left }}
          >
            {fmtDelta(trimDelta)}
          </span>
        ) : null}
        {isResizing ? (
          <span
            className={`tl-trim-tip${retimeDrag.atClamp ? ' is-clamped' : ''}`}
            data-testid="timeline-trim-tip"
            style={{ left: left + width + 8 }}
          >
            {fmtDelta(dur - retimeDrag.startDur)}
          </span>
        ) : null}
        {moving ? (
          <span className="tl-trim-tip" data-testid="timeline-move-tip" style={{ left }}>
            {fmtDelta(blockFrom - moveDrag.startFrom)}
          </span>
        ) : null}
        {onReplace && seq.replaceable && !decomposable ? (
          <button
            type="button"
            className="tl-seq-replace"
            data-testid={`timeline-replace-${i}`}
            title={`Replace this ${rowKind(seq)}`}
            aria-label={`Replace media in ${seq.label}`}
            style={{ left: left + width - 34 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onReplace(refFor(seq, i));
            }}
          >
            ⇄
          </button>
        ) : null}
      </Fragment>
    );
  };

  /** Task 17 — hover "+" on hard-cut boundaries (no transition yet). */
  const renderAddSeams = () => {
    if (!onClipVerb) return null;
    const withTrans = new Set((transitions || []).map((t) => t.afterIndex));
    return storyline.slice(0, -1).map(({ seq, i }, k) => {
      if (withTrans.has(i)) return null;
      const next = storyline[k + 1];
      if (!next) return null;
      return (
        <button
          key={`addseam${k}`}
          type="button"
          className="tl-seam tl-seam-add"
          data-testid={`timeline-seam-add-${k}`}
          title="Add transition (fade · 15f — click the chip after to change)"
          style={{ left: x(next.seq.from) - 9 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClipVerb(refFor(seq, i), 'insert-transition', {
              presentation: 'fade',
              durationInFrames: 15,
            });
          }}
        >
          <LIc as={Plus} size={13} />
        </button>
      );
    });
  };

  /** ⧓ seam chips between storyline beats — click opens the Transition tab. */
  const renderSeams = () =>
    (transitions || []).map((t, k) => {
      const next = sequences[t.afterIndex + 1];
      if (!next) return null;
      const center = x(next.from + (t.dur || 0) / 2);
      return (
        <button
          key={`seam${k}`}
          type="button"
          className="tl-seam"
          data-testid={`timeline-seam-${k}`}
          title={`Transition · ${t.dur || 0}f — click to edit`}
          style={{ left: center - 9 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setInspector({
              mode: 'transition',
              seam: k,
              x: e.clientX - 120,
              y: Math.max(60, e.clientY - 260),
            });
          }}
        >
          ⧓
        </button>
      );
    });

  const renderAudioRow = (a, i) => (
    <div className="tl-row" key={`a${i}`} data-testid={`timeline-audio-${i}`}>
      <span className="tl-row-label" title={a.label}>
        <span className="tl-kind" data-kind="audio" title={`Audio · ${a.label}`} aria-label={`Audio · ${a.label}`}>
          ♪
        </span>
        <span className="tl-row-label-text">{a.label}</span>
      </span>
      <div
        className="tl-row-track"
        style={{ width: axisPx, flex: 'none' }}
        onDragOver={onLaneDragOver('audio', `a${i}`)}
        onDrop={onLaneDrop({ lane: 'audio' })}
      >
        {laneCaret('audio', `a${i}`)}
        <div
          className="tl-audio-block"
          title={`${a.label} · ${a.from}–${a.from + a.duration}f`}
          style={{ left: x(a.from), width: Math.max(2, x(a.duration)) }}
        >
          <svg className="tl-wave" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden>
            {a.src && visuals[`p|${a.src}`] ? (
              // Task 7 — real peaks (WebAudio decode), filled mirrored wave.
              <path className="tl-wave-real" d={peaksToPath(visuals[`p|${a.src}`])} />
            ) : (
              <path d="M0 6 Q2 1 4 6 T8 6 T12 6 T16 6 T20 6 T24 6 T28 6 T32 6 T36 6 T40 6 T44 6 T48 6 T52 6 T56 6 T60 6 T64 6 T68 6 T72 6 T76 6 T80 6 T84 6 T88 6 T92 6 T96 6 T100 6" />
            )}
          </svg>
          <span className="tl-seq-name">{a.label}</span>
        </div>
        {onReplaceAudio ? (
          <button
            type="button"
            className="tl-seq-replace"
            data-testid={`timeline-audio-replace-${i}`}
            title="Replace this audio"
            aria-label={`Replace audio ${a.label}`}
            style={{ left: x(a.from) + Math.max(2, x(a.duration)) - 20 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onReplaceAudio(i);
            }}
          >
            ⇄
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <aside
      ref={rootRef}
      tabIndex={-1}
      className={`tl-panel${resizing ? ' is-resizing' : ''}${dropActive ? ' is-drop' : ''}${commentMode ? ' is-commenting' : ''}`}
      style={{ ...(height ? { height } : {}), outline: 'none' }}
      onPointerEnter={() => {
        // Keyboard shortcuts (C · Space · ⌘B · ⌘±) live on the SHELL window;
        // when the canvas iframe holds focus they never arrive. Hovering the
        // dock is the intent signal — grab shell focus so "press C, click a
        // clip" works without an extra priming click (dogfood 2026-07-30).
        if (!document.activeElement || document.activeElement === document.body) {
          rootRef.current?.focus();
        } else {
          const tag = document.activeElement.tagName;
          if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') rootRef.current?.focus();
        }
      }}
      onDragOver={(e) => {
        if (!onDropMedia || !hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget == null) {
          setDropActive(false);
          setDropCaret(null);
        }
      }}
      onDrop={onDrop}
      aria-label="Timeline"
      data-testid="timeline-panel"
    >
      <div
        className="tl-resize-handle"
        data-testid="timeline-resize-handle"
        title="Drag to resize"
        onPointerDown={beginResize}
      />
      <div className="tl-head">
        {comp ? (
          <>
            <button
              type="button"
              className="tl-btn tl-btn-primary"
              aria-label={playing ? 'Pause' : 'Play'}
              aria-pressed={playing}
              data-testid="timeline-playpause"
              onClick={() => (playing ? onPause?.() : onPlay?.())}
            >
              <TIcon name={playing ? 'pause' : 'play'} />
            </button>
            <button type="button" className="tl-btn" aria-label="Jump to start" onClick={() => onSeek?.(0)}>
              <TIcon name="start" />
            </button>
            <button
              type="button"
              className={`tl-btn${loop ? ' is-on' : ''}`}
              aria-label="Loop"
              aria-pressed={loop}
              data-testid="timeline-loop"
              onClick={() => onToggleLoop?.()}
            >
              <TIcon name="loop" />
            </button>
            {comp ? (
              <button
                type="button"
                className={`tl-btn${muted ? '' : ' is-on'}`}
                aria-label={muted ? 'Unmute' : 'Mute'}
                aria-pressed={!muted}
                data-testid="timeline-mute"
                title={muted ? 'Unmute audio' : 'Mute audio'}
                onClick={() => onToggleMute?.()}
              >
                <TIcon name={muted ? 'muted' : 'sound'} />
              </button>
            ) : null}
            {comp ? (
              <input
                type="range"
                className="tl-volume"
                min="0"
                max="100"
                value={Math.round((muted ? 0 : volume) * 100)}
                data-testid="timeline-volume"
                aria-label="Volume"
                title="Volume"
                onChange={(e) => onVolume?.(Number(e.target.value) / 100)}
              />
            ) : null}
            {/* issue #75 — on a multi-comp canvas the rows + transport belong to
                ONE artboard, and nothing said which. Show it (label, id as the
                fallback) so the panel and the canvas agree out loud. */}
            {comps.length > 1 ? (
              <span
                className={`tl-artboard${scopedArtboard ? '' : ' is-unknown'}`}
                data-testid="timeline-artboard"
                title={
                  scopedArtboard
                    ? `Timeline is scoped to artboard "${scopedArtboard}" — pan to another artboard to switch`
                    : "This canvas has several video comps and the Timeline couldn't tell which artboard this one sits in — the transport may be moving a comp you're not looking at"
                }
              >
                {scopedArtboard ?? 'artboard ?'}
              </span>
            ) : null}
            <span className="tl-readout" data-testid="timeline-readout">
              <b>{clamped}</b>
              <span className="tl-sep">/</span>
              {totalFrames - 1}
              <span className="tl-time">{fmtTime(clamped, fps)}</span>
            </span>
            <span className="tl-spacer" />
            {onSplitAtPlayhead ? (
              <button
                type="button"
                className="tl-btn"
                aria-label="Split at playhead"
                title="Split at playhead (⌘B)"
                data-testid="timeline-split"
                onClick={() => onSplitAtPlayhead()}
              >
                <LIc as={Scissors} />
              </button>
            ) : null}
            {onAddTitle ? (
              <button
                type="button"
                className="tl-btn"
                aria-label="Add title overlay"
                title="Add a title overlay at the playhead"
                data-testid="timeline-add-title"
                onClick={() => onAddTitle(clamped)}
              >
                <LIc as={Type} />
              </button>
            ) : null}
            {onAddImage ? (
              <button
                type="button"
                className="tl-btn"
                aria-label="Add image overlay"
                title="Add an image overlay at the playhead"
                data-testid="timeline-add-image"
                onClick={() => onAddImage(clamped)}
              >
                <LIc as={ImagePlus} />
              </button>
            ) : null}
            {onAddAiClip ? (
              <button
                type="button"
                className="tl-btn"
                aria-label="Add AI placeholder clip"
                title="Add an AI placeholder clip at the end of the storyline"
                data-testid="timeline-placeholder-add"
                onClick={() => onAddAiClip()}
              >
                <LIc as={Sparkles} />
              </button>
            ) : null}
            {onAddComment ? (
              <button
                type="button"
                className={`tl-btn${commentMode ? ' is-on' : ''}`}
                aria-label="Comment tool"
                aria-pressed={commentMode}
                title="Comment tool — click anywhere on the timeline to pin a comment (C)"
                data-testid="timeline-comment-tool"
                onClick={() => setCommentMode((m) => !m)}
              >
                <LIc as={MessageSquarePlus} />
              </button>
            ) : null}
          </>
        ) : (
          <span className="tl-title">Timeline</span>
        )}
        <span className="tl-spacer" />
        {comp && totalFrames > 900 ? (
          // Task 1 — long-comp badge. 900 frames is the safe export tier
          // (frame-step fallback ~2.5 s/frame); the export dialog shows the
          // full notice, this is the always-visible hint.
          <span
            className="tl-long-badge"
            data-testid="timeline-long-badge"
            title={`Long comp: ${totalFrames} frames (≈${Math.round(totalFrames / (fps || 30))}s). Exports over 900 frames can take several minutes on the fallback path — see the export dialog.`}
          >
            ⚠ {Math.round(totalFrames / (fps || 30))}s
          </span>
        ) : null}
        {comp ? <span className="tl-meta">{fps} fps · {totalFrames}f</span> : null}
        {comp ? (
          <input
            type="range"
            className="tl-zoom"
            min="0"
            max="100"
            value={zoomSliderValue}
            data-testid="timeline-zoom"
            aria-label="Timeline zoom"
            title="Zoom (⌘+/⌘−, 0 = fit)"
            onChange={(e) => zoomTo(zoomFromSlider(Number(e.target.value)))}
          />
        ) : null}
        <button type="button" className="tl-x" aria-label="Close timeline" onClick={onClose}>
          ×
        </button>
      </div>

      {!comp ? (
        <div className="tl-empty" data-testid="timeline-empty">
          No video-comp on this canvas. <b>Drop video clips right here</b> to start a
          new cut, use <b>⌘K → New video…</b> for an empty one, or make an artboard a
          <code>&lt;VideoComp&gt;</code> yourself.
        </div>
      ) : (
        <div className="tl-scroll" ref={setScrollRef}>
          <div
            className="tl-tracks"
            ref={trackRef}
            data-testid="timeline-track"
            style={{ width: LABEL_GUTTER + axisPx }}
            onPointerDown={onTrackDown}
            onDragOver={onLaneDragOver('overlay', 'tracks')}
            onDrop={onLaneDrop({ lane: 'overlay' })}
          >
            {comments.length ? (
              // Task 23 — 💬 marker strip. Preferred anchor: clipStableId +
              // frameOffset (survives reorder/ripple); a comment whose clip is
              // gone degrades to its absolute frame with a "detached" badge.
              <div className="tl-comments-strip" data-testid="timeline-comments-strip">
                {comments.map((c) => {
                  const tl = c.timeline || {};
                  let frame = null;
                  let detached = false;
                  if (tl.clipStableId) {
                    const row = sequences.find((r2) => r2.stableId === tl.clipStableId);
                    if (row) frame = row.from + Math.min(tl.frameOffset || 0, Math.max(0, row.duration - 1));
                    else if (tl.frame != null) {
                      frame = tl.frame;
                      detached = true;
                    }
                  } else if (tl.frame != null) {
                    frame = tl.frame;
                  }
                  if (frame == null) return null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`tl-comment-pin${c.status === 'resolved' ? ' is-resolved' : ''}${detached ? ' is-detached' : ''}`}
                      data-testid={`timeline-comment-${c.id}`}
                      title={`${c.author || 'comment'}${detached ? ' (detached — clip removed)' : ''}: ${c.text}`}
                      style={{ left: LABEL_GUTTER + x(clamp(frame, 0, totalFrames - 1)) - 8 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeek?.(clamp(frame, 0, totalFrames - 1));
                        setCommentPopover({ id: c.id, x: e.clientX - 130, y: Math.max(60, e.clientY - 180) });
                      }}
                    >
                      💬
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="tl-ruler" style={{ width: axisPx }}>
              {ticks.map((f) => {
                const major = f % (fps || 30) === 0;
                const showLabel = major || step <= 5;
                return (
                  <span key={f} className={`tl-tick${major ? ' is-major' : ''}`} style={{ left: x(f) }}>
                    {showLabel ? <span className="tl-tick-label">{tickLabel(f, fps)}</span> : null}
                  </span>
                );
              })}
            </div>

            {laneCaret('overlay', 'tracks')}
            {sequences.length === 0 ? (
              <div className="tl-row">
                <span className="tl-row-label">comp</span>
                <div className="tl-row-track" style={{ width: axisPx, flex: 'none' }}>
                  <div className="tl-seq-block" style={{ left: 0, width: axisPx }}>
                    <span className="tl-seq-name">whole composition</span>
                  </div>
                </div>
              </div>
            ) : bandMode ? (
              <>
                {/* Overlay band — standalone Sequences above the storyline.
                    Rendered TOP = topmost paint (last in the document), so the
                    stack reads like FCP; drag the V-chip to reorder layers. */}
                {(() => {
                  // z-ladder = the overlay clips the SERVER can reorder
                  // (standalone <Sequence>s; `loose` bare media has no clip
                  // identity and stays out of the index space).
                  const zLadder = overlay.filter(({ seq }) => !seq.loose);
                  return [...overlay].reverse().map(({ seq, i }) => {
                    const docIdx = seq.loose ? null : zLadder.findIndex((o) => o.i === i);
                    const vNum = docIdx == null ? null : docIdx + 2; // V1 = the storyline
                    const rowCls =
                      `tl-row tl-row--overlay` +
                      (layerDrag && layerDrag.index === i ? ' is-layer-dragging' : '') +
                      (layerDrag && docIdx != null && layerDrag.index !== i && layerDrag.curTarget === docIdx
                        ? ' is-layer-target'
                        : '');
                    return (
                      <div
                        className={rowCls}
                        key={`o${i}`}
                        data-testid={`timeline-row-${i}`}
                        {...(docIdx != null ? { 'data-layer-doc': docIdx } : {})}
                      >
                        <span className="tl-row-label" title={seq.mediaSrc || seq.label}>
                          {docIdx != null ? (
                            <span
                              className="tl-lane-id tl-lane-id--grab"
                              data-testid={`timeline-lane-chip-${i}`}
                              title="Drag up/down to reorder layers"
                              onPointerDown={(e) => startLayerDrag(e, i, docIdx)}
                            >
                              V{vNum}
                            </span>
                          ) : (
                            <span className="tl-lane-id" title="Loose media — no layer order">◌</span>
                          )}
                          <span className="tl-kind" data-kind={rowKind(seq)}>{rowKindGlyph(seq)}</span>
                        </span>
                        <div
                          className="tl-row-track"
                          style={{ width: axisPx, flex: 'none' }}
                          onDragOver={onLaneDragOver('overlay', `o${i}`)}
                          onDrop={onLaneDrop({ lane: 'overlay' })}
                        >
                          {renderBlock(seq, i, { lane: 'overlay', laneName: vNum != null ? `V${vNum}` : 'loose' })}
                          {laneCaret('overlay', `o${i}`)}
                        </div>
                      </div>
                    );
                  });
                })()}
                {/* THE storyline — series beats butted side-by-side. */}
                <div className="tl-row tl-row--storyline" data-testid="timeline-storyline">
                  <span className="tl-row-label">
                    <span className="tl-lane-id tl-lane-id--story">V1</span>
                    <span className="tl-band-tag tl-band-tag--story">storyline</span>
                  </span>
                  <div
                    className={`tl-row-track tl-storyline-track${reorderDrag ? ' is-reordering' : ''}${moveDrag?.overStory ? ' is-drop-target' : ''}`}
                    style={{ width: axisPx, flex: 'none' }}
                    onDragOver={onStoryDragOver}
                    onDrop={onLaneDrop({ lane: 'storyline' })}
                  >
                    {storyline.map(({ seq, i }) => renderBlock(seq, i, { lane: 'storyline', laneName: 'V1' }))}
                    {reorderDrag ? null : renderSeams()}
                    {reorderDrag ? null : renderAddSeams()}
                    {dropCaret?.lane === 'storyline' ? (
                      <span
                        className="tl-drop-caret"
                        data-testid="timeline-drop-caret"
                        style={{ left: dropCaret.x - 1 }}
                      />
                    ) : null}
                  </div>
                </div>
                {/* Dogfood 2026-07-30 (image #22) — a decomposable beat (an
                    old hand-authored scene component) expands into its layer
                    sub-rows right under the storyline, exactly like the
                    stacked fallback used to show; default-expanded. */}
                {storyline
                  .filter(
                    ({ seq, i }) =>
                      Array.isArray(seq.layers) && seq.layers.length >= 2 && !collapsed.has(i)
                  )
                  .map(({ seq, i }) =>
                    seq.layers.map((ly, li) => {
                      const lyKind =
                        ly.kind === 'video' || ly.kind === 'image' || ly.kind === 'audio'
                          ? ly.kind
                          : 'jsx';
                      const lyGlyph =
                        ly.kind === 'video' ? '▶' : ly.kind === 'image' ? '◫' : ly.kind === 'audio' ? '♪' : 'ƒ';
                      return (
                        <div
                          className="tl-row tl-row--layer"
                          key={`bl${i}-${li}`}
                          data-testid={`timeline-layer-${i}-${li}`}
                        >
                          <span className="tl-row-label" title={`${seq.label} · ${ly.label}`}>
                            <span className="tl-layer-indent" aria-hidden="true" />
                            <span className="tl-kind" data-kind={lyKind}>{lyGlyph}</span>
                            <span className="tl-row-label-text">{ly.label}</span>
                          </span>
                          <div className="tl-row-track" style={{ width: axisPx, flex: 'none' }}>
                            <div
                              className="tl-seq-block tl-layer-block"
                              data-kind={lyKind}
                              data-testid={`timeline-layer-block-${i}-${li}`}
                              title={`${seq.label} · ${ly.label} (${ly.kind} layer)`}
                              style={{ left: x(seq.from), width: Math.max(2, x(seq.duration)) }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCtxMenu({ index: i, layerIndex: li, x: e.clientX, y: e.clientY });
                              }}
                            >
                              <span className="tl-seq-name">{ly.label}</span>
                            </div>
                            {onReplaceLayer && (ly.mediaCdId || ly.mediaArrayRef) ? (
                              <button
                                type="button"
                                className="tl-seq-replace"
                                data-testid={`timeline-layer-replace-${i}-${li}`}
                                title={`Replace this ${ly.kind}`}
                                aria-label={`Replace ${ly.label}`}
                                style={{ left: x(seq.from) + Math.max(2, x(seq.duration)) - 20 }}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReplaceLayer(refFor(seq, i), li);
                                }}
                              >
                                ⇄
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                {/* Audio band — standalone audio clips (movable/trimmable) +
                    loose <Audio> beds. */}
                {audioClips.map(({ seq, i }, k) => (
                  <div className="tl-row tl-row--overlay tl-row--audio" key={`ac${i}`} data-testid={`timeline-row-${i}`}>
                    <span className="tl-row-label" title={seq.mediaSrc || seq.label}>
                      <span className="tl-lane-id tl-lane-id--audio">A{k + 1}</span>
                      <span className="tl-kind" data-kind="audio">♪</span>
                    </span>
                    <div
                      className="tl-row-track"
                      style={{ width: axisPx, flex: 'none' }}
                      onDragOver={onLaneDragOver('audio', `ac${i}`)}
                      onDrop={onLaneDrop({ lane: 'audio' })}
                    >
                      {renderBlock(seq, i, { lane: 'audio', laneName: `A${k + 1}` })}
                      {laneCaret('audio', `ac${i}`)}
                    </div>
                  </div>
                ))}
                {audio.map((a, i) => renderAudioRow(a, i))}
                {/* Debate verdict: the dead space below the lanes gets a JOB —
                    it IS the new-layer drop target, and says so. */}
                <div
                  className={`tl-newlayer-zone${dropCaret?.row === 'newlayer' ? ' is-active' : ''}`}
                  data-testid="timeline-newlayer-zone"
                  onDragOver={onLaneDragOver('overlay', 'newlayer')}
                  onDrop={onLaneDrop({ lane: 'overlay' })}
                >
                  <span style={{ marginLeft: LABEL_GUTTER }}>Drop clips here — new layer</span>
                </div>
              </>
            ) : (
              <>
                {sequences.map((seq, i) => {
                  const layers = Array.isArray(seq.layers) ? seq.layers : [];
                  const decomposable = layers.length >= 2;
                  const isExpanded = decomposable && !collapsed.has(i);
                  const dur = retimeDrag && retimeDrag.index === i ? retimeDrag.curDur : seq.duration;
                  return (
                    <Fragment key={i}>
                      <div className="tl-row" data-testid={`timeline-row-${i}`}>
                        <span className="tl-row-label" title={seq.label}>
                          {decomposable ? (
                            <button
                              type="button"
                              className="tl-expand"
                              data-testid={`timeline-expand-${i}`}
                              title={isExpanded ? 'Collapse layers' : 'Show layers'}
                              aria-label={isExpanded ? `Collapse ${seq.label} layers` : `Show ${seq.label} layers`}
                              aria-expanded={isExpanded}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setCollapsed((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(i)) next.delete(i);
                                  else next.add(i);
                                  return next;
                                });
                              }}
                            >
                              {isExpanded ? '▾' : '▸'}
                            </button>
                          ) : (
                            <span className="tl-expand tl-expand--spacer" aria-hidden="true" />
                          )}
                          <span
                            className="tl-kind"
                            data-kind={rowKind(seq)}
                            title={rowKindTitle(seq)}
                            aria-label={rowKindTitle(seq)}
                          >
                            {rowKindGlyph(seq)}
                          </span>
                          <span className="tl-row-label-text">{seq.label}</span>
                        </span>
                        <div className="tl-row-track" style={{ width: axisPx, flex: 'none' }}>
                          {renderBlock(seq, i, { lane: 'row' })}
                        </div>
                      </div>
                      {isExpanded
                        ? layers.map((ly, li) => {
                            const lyKind =
                              ly.kind === 'video'
                                ? 'video'
                                : ly.kind === 'image'
                                  ? 'image'
                                  : ly.kind === 'audio'
                                    ? 'audio'
                                    : 'jsx';
                            const lyGlyph =
                              ly.kind === 'video'
                                ? '▶'
                                : ly.kind === 'image'
                                  ? '◫'
                                  : ly.kind === 'audio'
                                    ? '♪'
                                    : 'ƒ';
                            const lyReplaceable = !!(ly.mediaCdId || ly.mediaArrayRef);
                            return (
                              <div
                                className="tl-row tl-row--layer"
                                key={`l${li}`}
                                data-testid={`timeline-layer-${i}-${li}`}
                              >
                                <span className="tl-row-label" title={ly.label}>
                                  <span className="tl-layer-indent" aria-hidden="true" />
                                  <span className="tl-kind" data-kind={lyKind}>
                                    {lyGlyph}
                                  </span>
                                  <span className="tl-row-label-text">{ly.label}</span>
                                </span>
                                <div className="tl-row-track" style={{ width: axisPx, flex: 'none' }}>
                                  <div
                                    className="tl-seq-block tl-layer-block"
                                    data-kind={lyKind}
                                    data-testid={`timeline-layer-block-${i}-${li}`}
                                    title={`${ly.label} (${ly.kind} layer)`}
                                    style={{ left: x(seq.from), width: Math.max(2, x(dur)) }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setCtxMenu({ index: i, layerIndex: li, x: e.clientX, y: e.clientY });
                                    }}
                                  >
                                    <span className="tl-seq-name">{ly.label}</span>
                                  </div>
                                  {onReplaceLayer && lyReplaceable ? (
                                    <button
                                      type="button"
                                      className="tl-seq-replace"
                                      data-testid={`timeline-layer-replace-${i}-${li}`}
                                      title={`Replace this ${ly.kind}`}
                                      aria-label={`Replace ${ly.label}`}
                                      style={{ left: x(seq.from) + Math.max(2, x(dur)) - 20 }}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onReplaceLayer(refFor(seq, i), li);
                                      }}
                                    >
                                      ⇄
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })
                        : null}
                    </Fragment>
                  );
                })}
                {audio.map((a, i) => renderAudioRow(a, i))}
              </>
            )}

            {snapFlash ? (
              <span className="tl-snapline" style={{ left: LABEL_GUTTER + x(snapFlash.frame) }} />
            ) : null}
            <span
              className="tl-playhead"
              data-testid="timeline-playhead"
              style={{ left: LABEL_GUTTER + x(clamped) }}
            >
              <span className="tl-playhead-time">{fmtTime(clamped, fps)}</span>
            </span>
          </div>
        </div>
      )}
      {commentDraft
        ? createPortal(
            <div className="tlci tlci--comment" style={{ left: commentDraft.x, top: commentDraft.y }}>
              <div className="tlci-head" style={{ cursor: 'default' }}>
                <span className="tlci-title">
                  Comment @ {fmtTime(commentDraft.at, fps)}
                  {commentDraft.anchor.lane ? ` · ${commentDraft.anchor.lane}` : ''}
                </span>
                <button type="button" className="tlci-x" aria-label="Close" onClick={() => setCommentDraft(null)}>
                  ×
                </button>
              </div>
              <div className="tlci-body">
                <textarea
                  className="tlci-textarea"
                  rows={3}
                  autoFocus
                  placeholder="Comment… (Enter to add)"
                  data-testid="timeline-comment-composer"
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      const text = e.currentTarget.value.trim();
                      if (text) onAddComment?.(commentDraft.anchor, text);
                      setCommentDraft(null);
                    } else if (e.key === 'Escape') {
                      setCommentDraft(null);
                    }
                  }}
                />
                <div className="tlci-row">
                  <button
                    type="button"
                    className="tlci-btn"
                    data-testid="timeline-comment-submit"
                    onClick={(e) => {
                      const ta = e.currentTarget.closest('.tlci')?.querySelector('textarea');
                      const text = ta?.value?.trim();
                      if (text) onAddComment?.(commentDraft.anchor, text);
                      setCommentDraft(null);
                    }}
                  >
                    Add comment
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {commentPopover
        ? createPortal((() => {
            const c = comments.find((k) => k.id === commentPopover.id);
            if (!c) return null;
            return (
              <div
                className="tlci"
                style={{ left: commentPopover.x, top: commentPopover.y }}
                role="dialog"
                aria-label="Timeline comment"
                data-testid="timeline-comment-popover"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="tlci-head">
                  <span className="tlci-title">💬 {c.author || 'comment'}</span>
                  <button type="button" className="tlci-x" aria-label="Close" onClick={() => setCommentPopover(null)}>
                    ×
                  </button>
                </div>
                <div className="tlci-body">
                  <p className="tlci-comment-text">{c.text}</p>
                  {(c.thread || []).map((r2, k2) => (
                    <p key={k2} className="tlci-note">
                      ↳ {r2.author ? `${r2.author}: ` : ''}{r2.body}
                    </p>
                  ))}
                  <div className="tlci-presets">
                    {c.status !== 'resolved' && onResolveComment ? (
                      <button
                        type="button"
                        className="tlci-chip"
                        onClick={() => {
                          onResolveComment(c.id);
                          setCommentPopover(null);
                        }}
                      >
                        Resolve
                      </button>
                    ) : null}
                    {onDeleteComment ? (
                      <button
                        type="button"
                        className="tlci-chip"
                        onClick={() => {
                          onDeleteComment(c.id);
                          setCommentPopover(null);
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })(), document.body)
        : null}
      {inspector
        ? createPortal((() => {
            if (inspector.mode === 'transition') {
              const tClip = transitionClips[inspector.seam];
              const tParse = (transitions || [])[inspector.seam];
              if (!tClip) return null;
              return (
                <ClipInspector
                  mode="transition"
                  clipLabel="Transition"
                  transition={{ dur: tParse?.dur ?? 15 }}
                  x={inspector.x}
                  y={inspector.y}
                  onVerb={(verb, params) =>
                    onClipVerb?.({ stableId: tClip.stableId, transition: true }, verb, params)
                  }
                  onClose={() => setInspector(null)}
                />
              );
            }
            const seq = sequences[inspector.index];
            if (!seq) return null;
            return (
              <ClipInspector
                mode="clip"
                clipLabel={seq.label}
                kind={rowKind(seq)}
                textValue={seq.placeholder ? seq.placeholder.prompt || '' : rowKind(seq) === 'jsx' && !seq.series ? '' : null}
                mediaProps={seq.mediaProps || null}
                x={inspector.x}
                y={inspector.y}
                onVerb={(verb, params) => onClipVerb?.(refFor(seq, inspector.index), verb, params)}
                onClose={() => setInspector(null)}
              />
            );
          })(), document.body)
        : null}
      {ctxMenu && sequences[ctxMenu.index]
        ? createPortal((() => {
            const seq = sequences[ctxMenu.index];
            const i = ctxMenu.index;
            const li = ctxMenu.layerIndex;
            let sections;
            if (seq.loose) {
              // A bare media sibling outside every <Sequence> — visible for
              // orientation, but it has no clip identity for server ops.
              sections = [[{ id: 'noop', label: 'Loose media (no clip wrapper) — edit via /design:edit', disabled: true, onSelect: () => {} }]];
            } else if (li != null) {
              // A LAYER (sub-clip) menu — a stacked layer shares the clip's
              // timing, so only media-replace applies here.
              const ly = (Array.isArray(seq.layers) ? seq.layers : [])[li];
              const items = [];
              if (onReplaceLayer && ly && (ly.mediaCdId || ly.mediaArrayRef)) {
                items.push({ id: 'replace-layer', label: `Replace ${ly.kind}…`, onSelect: () => onReplaceLayer(refFor(seq, i), li) });
              }
              if (items.length === 0) {
                items.push({ id: 'noop', label: 'No replaceable media in this layer', disabled: true, onSelect: () => {} });
              }
              sections = [items];
            } else {
              const primary = [];
              if (onAddComment) {
                primary.push({
                  id: 'comment',
                  label: 'Comment on clip…',
                  onSelect: () => {
                    // Same anchored composer as the C tool — no modal.
                    setCommentDraft({
                      x: clamp(ctxMenu.x - 130, 8, window.innerWidth - 280),
                      y: Math.max(48, ctxMenu.y - 140),
                      anchor: {
                        clipStableId: seq.stableId || undefined,
                        frameOffset: Math.max(0, clamped - (seq.from || 0)),
                        frame: clamped,
                      },
                      at: clamped,
                    });
                  },
                });
              }
              if (seq.placeholder && onGeneratePlaceholder) {
                primary.push({
                  id: 'generate',
                  label: `Generate ✨ (${seq.placeholder.kind || 'veo'})`,
                  onSelect: () => onGeneratePlaceholder(refFor(seq, i)),
                });
              }
              if (onClipVerb && seq.mediaSrc) {
                if (seq.series) {
                  primary.push({
                    id: 'to-overlay',
                    label: 'Move to overlay layer',
                    onSelect: () => onClipVerb(refFor(seq, i), 'to-overlay', {}),
                  });
                } else {
                  primary.push({
                    id: 'to-storyline',
                    label: 'Move to storyline',
                    onSelect: () => onClipVerb(refFor(seq, i), 'to-storyline', {}),
                  });
                }
              }
              if (onClipVerb) {
                primary.push({
                  id: 'adjust',
                  label: 'Adjust… (Speed · Audio · Crop · Grade)',
                  onSelect: () => {
                    onSelect?.(seq.stableId ?? null);
                    setInspector({ mode: 'clip', index: i, x: ctxMenu.x - 120, y: Math.max(60, ctxMenu.y - 320) });
                  },
                });
                if (seq.mediaProps) {
                  primary.push({
                    id: 'mute',
                    label: seq.mediaProps.muted ? 'Unmute clip' : 'Mute clip',
                    onSelect: () => onClipVerb(refFor(seq, i), 'audio', { muted: !seq.mediaProps.muted }),
                  });
                  if (rowKind(seq) === 'video' && seq.mediaSrc) {
                    primary.push({
                      id: 'detach-audio',
                      label: 'Detach audio',
                      onSelect: () => onClipVerb(refFor(seq, i), 'detach-audio', {}),
                    });
                  }
                }
              }
              if (onReplace && seq.replaceable && !(Array.isArray(seq.layers) && seq.layers.length >= 2)) {
                primary.push({ id: 'replace', label: `Replace ${rowKind(seq)}…`, onSelect: () => onReplace(refFor(seq, i)) });
              }
              {
                // Vertical z-order (overlay clips only) — mirrors the V-chip drag.
                const zLadder = overlay.filter((o) => !o.seq.loose);
                const docIdx = zLadder.findIndex((o) => o.i === i);
                if (onClipVerb && docIdx >= 0) {
                  primary.push({
                    id: 'layer-up',
                    label: 'Move layer up',
                    disabled: docIdx >= zLadder.length - 1,
                    onSelect: () => onClipVerb(refFor(seq, i), 'layer-order', { toIndex: docIdx + 1 }),
                  });
                  primary.push({
                    id: 'layer-down',
                    label: 'Move layer down',
                    disabled: docIdx <= 0,
                    onSelect: () => onClipVerb(refFor(seq, i), 'layer-order', { toIndex: docIdx - 1 }),
                  });
                }
              }
              if (onReorder) {
                primary.push({
                  id: 'earlier',
                  label: seq.series ? 'Move earlier' : 'Bring forward',
                  disabled: seq.series ? i <= 0 : i >= sequences.length - 1,
                  onSelect: () => onReorder(refFor(seq, i), seq.series ? 'backward' : 'forward'),
                });
                primary.push({
                  id: 'later',
                  label: seq.series ? 'Move later' : 'Send backward',
                  disabled: seq.series ? i >= sequences.length - 1 : i <= 0,
                  onSelect: () => onReorder(refFor(seq, i), seq.series ? 'forward' : 'backward'),
                });
              }
              sections = [primary];
              const tail = [];
              if (onToggleHide) {
                tail.push({
                  id: 'hide',
                  label: seq.hidden ? 'Show clip' : 'Hide clip',
                  onSelect: () => onToggleHide(refFor(seq, i)),
                });
              }
              if (onRemove) {
                tail.push({ id: 'remove', label: 'Remove clip', destructive: true, onSelect: () => onRemove(refFor(seq, i)) });
              }
              if (tail.length) sections.push(tail);
            }
            return (
              <ContextMenuView
                target={{ kind: 'element', el: null, cdId: null, artboardId: null, clientX: ctxMenu.x, clientY: ctxMenu.y }}
                sections={sections}
                onClose={() => setCtxMenu(null)}
              />
            );
          })(), document.body)
        : null}
    </aside>
  );
}
