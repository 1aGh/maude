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

import { isSilentVideo, timelineKindOf } from '../inspector/kinds/clip-model.js';
import { foldStore } from '../fold/use-fold.js';
import {
  AdvancedFoot,
  advancedStore,
  trackKey,
  useAdvanced,
  useAdvancedOpen,
} from './advanced/foot.jsx';
import { clock, frameTick, timecode } from './advanced/model.js';
import {
  bindCapTarget,
  capView,
  loadMaxFrames,
  maxFramesOf,
  saveMaxFrames,
  CAP_CEILING,
  useCapVersion,
} from './advanced/video-cap.js';
import { FitFillAsk, useFitFill } from './fit-fill.jsx';
import { joinTitle, stillSecond, tileOfPresentation } from './joins/join-model.js';
import { TransitionPicker } from './joins/transition-picker.jsx';
import { MusicLaneOverlay, musicSelection, useMusicLane } from './lanes/music-lane.jsx';
import { MusicHint, MusicTool } from './music-hint.jsx';
import { TGlyph } from './glyphs.jsx';
import { CaptionLane, CaptionsTool } from './lanes/caption-lane.jsx';
import { RulerMarks } from './marks.jsx';
import { PeerHeads } from './peers.jsx';
import { timelineSelection } from './selection.js';
import { useTimelineIsland } from './island-context.js';
import { AiCutStatus, AiEdge, useAiCut } from './ai-edge.jsx';
import { usePlayback } from './playhead.js';
import { mss, readoutLabel, rulerLabel, rulerStepFrames } from './ruler.js';
import { deriveTracks } from './tracks.js';
import { isBand } from './transport.js';
import { KeptStatus, SharedStatus, SizeButton } from './island-controls.jsx';
import { OtherTakesHost } from './other-takes.jsx';
import { ReframeHost } from './reframe-island.jsx';
import { bindClips } from './clip-search.js';
import { FOLD_WORDS, FOLDABLE, trackFold, useFoldVersion } from './fold.js';
import { bindMarkerSource, loadMarkers, markersOf, useMarkersVersion } from './marker-store.js';
import {
  clipNameWithState,
  FOOTAGE_WORDS,
  footageForSrc,
  preparingChip,
  preparingCount,
  useFootageAnswers,
} from './footage-state.js';
import { clipTip, nameVisible } from './zoom.js';
import { ClipMenu } from './edit/clip-menu.jsx';
import { ArtboardDropCatcher, DropLanding, fileCount } from './edit/drop.jsx';
import { landingOf, MoveLanding } from './edit/move.jsx';
import { TrimTip } from './edit/trim.jsx';
import { computeSnapTargets, snapFrame } from '../../panels/timeline-snap.js';
import { activeComp } from '../../panels/timeline-comp-target.js';
import {
  getFilmstrip,
  getPeaks,
  peaksToPath,
  probeMediaDuration,
  stripBucket,
} from '../../panels/timeline-media-cache.js';
import {
  clampPxPerFrame,
  fitPxPerFrame,
  MAX_PX_PER_FRAME,
  pxToFrame,
  ZOOM_STEP,
  zoomAroundScroll,
} from '../../panels/timeline-scale.js';
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
/** The name a clip goes by in words ("Oslava", never a content-hash file name): "Clip N" when it has none. */
function displayNameOf(seq, i) {
  // P8 C3 (07 · ve-text) — a title goes by its words (timeline-parse.js `text`), never by "AbsoluteFill"
  if (seq.text) return seq.text;
  const raw =
    ['Video', 'OffthreadVideo', 'Audio', 'Img', 'MaudeVideo', 'MaudeAudio', 'MaudeImg'].includes(
      seq.label
    ) && seq.mediaSrc
      ? String(seq.mediaSrc).split('/').pop()
      : seq.label;
  return /^[a-f0-9]{6,16}\.\w+$/i.test(raw || '') ? `Clip ${i + 1}` : raw;
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** A song's name in words: its file name without the extension ("Hype instrumental.mp3" → "Hype instrumental"). */
const songName = (label) => String(label ?? '').replace(/\.[a-z0-9]{2,4}$/i, '') || 'Music';

/** P8 C3 (07 · .ve-wave) — deterministic bars (the board's `wave()`), one per ~1.1 % of the clip, as the stand-in
 *  until the real peaks are read. */
function WaveBars({ width, seed = 1 }) {
  const n = clamp(Math.round(width / 5), 4, 240);
  const bars = [];
  for (let k = 0; k < n; k++) {
    const h = 0.25 + 0.75 * Math.abs(Math.sin(k * 0.61 * seed + 1.3) * Math.cos(k * 0.17 + seed));
    bars.push(<i key={k} style={{ height: `${Math.round(h * 100)}%` }} />);
  }
  return (
    <span className="tl-wave-bars" aria-hidden="true">
      {bars}
    </span>
  );
}

/** A length in words, one decimal ("2.5 s"). */
const secs = (frames, fps) => `${Math.round((frames / (fps || 30)) * 10) / 10} s`;
/** A moment in words — m:ss, like the ruler (words.js header rule: never "10.10s"). */
function fmtTime(frame, fps) {
  return mss(frame / (fps || 30));
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

// The frame axis starts AFTER the label gutter: P8 C3 (07 · .ve-tl-labs) — a 22 px column of track chips in compact,
// 132 px of chip + name in full, then the lanes' 8 px gap.
const COMPACT_GUTTER = 30;
const FULL_GUTTER = 140;
// Padding the .tl-scroll container puts around the tracks (timeline.css: 3 px a side, room for the selection ring).
const SCROLL_PAD_X = 6;

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
  // S7.7 — the island around this body (null when it stands alone): the empty-comp block lives there.
  const island = useTimelineIsland();
  // P8 C3 — the board's two sizes: compact (the narrow icon gutter, no zoom, no Advanced) and full. A body with
  // no island around it is the full one.
  const full = !island || island.size === 'full';
  const gutter = full ? FULL_GUTTER : COMPACT_GUTTER;
  // S7.14 — an AI cut on this video: its edge, the shot that landed, the status chip (from the run's progress)
  const aiCut = useAiCut({
    activePath: island?.canvas ?? null,
    artboardId: comp?.artboardId ?? null,
    compKey: `${total}:${sequences.length}`,
  });
  // S7.8 — the loop band (I / O) and whether the playhead was just stepped by hand live in one store the keys write.
  const playback = usePlayback();
  const band = compId ? playback.loopFor(compId) : null;
  const poster = Number.isFinite(island?.poster) ? island.poster : null;
  // the default poster (poster.js: absent = 35 % of the length)
  const posterAt = clamp(poster ?? Math.round(totalFrames * 0.35), 0, totalFrames - 1);
  // S7.18 — Advanced at the foot (frames, keyframes, the cut as code), the asked-for empty tracks, and how long
  // one export of this video may be (C22). The fold is the shared `timeline` Advanced fold.
  const advOpen = useAdvancedOpen();
  const haveRef = useRef([]);
  const trackInfoRef = useRef({ counts: {}, labels: {} }); // S7.16 — what `timeline.fold-track` folds
  const adv = useAdvanced();
  useCapVersion();
  const capFile = island?.canvas ?? null;
  const capId = comp?.artboardId ?? null;
  useEffect(() => {
    if (capFile && capId) void loadMaxFrames(capFile, capId);
    bindCapTarget(() =>
      capFile && capId
        ? { file: capFile, artboardId: capId, have: haveRef.current, ...trackInfoRef.current }
        : null
    );
    return () => bindCapTarget(null);
  }, [capFile, capId]);
  const cap = capView({
    frames: totalFrames,
    fps,
    stored: capFile && capId ? maxFramesOf(capFile, capId) : null,
    label: scopedArtboard ?? 'This video',
  });
  const extraTracks = adv.tracks[trackKey(capFile, capId)] ?? [];
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
  const axisViewport = Math.max(40, viewW - gutter - SCROLL_PAD_X);
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
          ? clamp(Math.round(pxToFrame(e.clientX - rect.left - gutter, pxf)), 0, totalFrames - 1)
          : clamped;
      zoomTo(pxf * Math.exp(-e.deltaY * 0.01), anchor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pxf, clamped, totalFrames, zoomTo, scrollEl, gutter]);

  // Header slider — log scale from fit (0) to MAX_PX_PER_FRAME (100).
  const zoomSliderValue = (() => {
    const ratio = Math.log(pxf / fitPxf) / Math.log(MAX_PX_PER_FRAME / Math.max(1e-6, fitPxf));
    return clamp(Math.round((Number.isFinite(ratio) ? ratio : 0) * 100), 0, 100);
  })();
  const zoomFromSlider = (v) => {
    const ratio = clamp(v, 0, 100) / 100;
    return fitPxf * (MAX_PX_PER_FRAME / Math.max(1e-6, fitPxf)) ** ratio;
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
  // S7.10 — the join picker (07 · ve-transition): { seam, x, y }, opened by clicking the dot between two clips.
  // (The v1 clip dialog is gone: a selected clip is edited in the right-hand inspector, kinds/clip.jsx.)
  const [joinPicker, setJoinPicker] = useState(null);
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
      const f = pxToFrame(clientX - r.left - gutter, pxf);
      onSeek?.(clamp(Math.round(f), 0, totalFrames - 1));
    },
    [onSeek, totalFrames, pxf, gutter]
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
      const f = clamp(Math.round(pxToFrame(e.clientX - r.left - gutter, pxf)), 0, totalFrames - 1);
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
    [pxf, totalFrames, onAddComment, gutter]
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
      const end = snapFrame(rawEnd, retimeDrag.targets, e.altKey ? 0 : 8 / retimeDrag.pxf);
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
      if (d && d.curDur !== d.startDur)
        onRetime?.(d.ref ?? d.index, { durationInFrames: d.curDur });
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
      const curFrom = Math.max(
        0,
        snapFrame(rawFrom, moveDrag.targets, e.altKey ? 0 : 8 / moveDrag.pxf)
      );
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
    computeSnapTargets({
      fps,
      totalFrames,
      clips: sequences,
      movingIndex: index,
      playhead: clamped,
      beats: musicLane.snapBeats, // S7.12 — Snap to the beat
    });

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
    const story = sequences.map((s, i) => ({ s, i })).filter(({ s }) => s.series);
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

  // S7.8 — ruler ticks step 1/3/5/10/30/60 s by the visible span (07 · ve-play); past a second of zoom the
  // frame ladder takes over (ruler.js).
  const step = rulerStepFrames({
    pxPerFrame: pxf,
    fps,
    spanFrames: Math.min(totalFrames, axisViewport / pxf),
  });
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
  const bandMode = storyline.length > 0 && sequences.some((s) => rowKind(s) !== 'jsx');

  // S7.8 (C35) — the four tracks, derived from what the comp already says: row index → track id, and the
  // loose <Audio> beds' own. A track is a grouping of the rows below, never a new kind of row, so every row's
  // testid and drag is unchanged.
  const trackOfIdx = new Map();
  const trackOfBed = new Map();
  const trackOfCount = new Map(); // S7.16 — how many things each track holds
  const drawnTracks = deriveTracks({ sequences, audio, extra: extraTracks });
  haveRef.current = drawnTracks.map((t) => t.id);
  trackInfoRef.current = {
    counts: Object.fromEntries(drawnTracks.map((t) => [t.id, t.members.length])),
    labels: Object.fromEntries(drawnTracks.map((t) => [t.id, t.label])),
  };
  for (const t of drawnTracks) {
    for (const m of t.members) (m.kind === 'seq' ? trackOfIdx : trackOfBed).set(m.index, t.id);
    trackOfCount.set(t.id, t.members.length);
  }
  // S7.16 (07 · ve-long) — a track you do not need folds to "Text · 18": one line, no rows. A view (per viewer).
  useFoldVersion();
  useFootageAnswers(); // S7.16 — a waiting clip turns to here by itself when the file arrives
  const foldKey = trackKey(capFile, capId);
  // S7.16 — ruler markers ("Výkop", "TD 1"): part of the cut, in the video's meta; the flags jump the playhead
  useMarkersVersion();
  const markers = capFile && capId ? markersOf(capFile, capId) : [];
  const markerAt = useRef({ frame: 0, seek: null });
  markerAt.current = { frame: clamped, seek: onSeek };
  useEffect(() => {
    if (!capFile || !capId) return undefined;
    void loadMarkers(capFile, capId);
    bindMarkerSource(() => ({
      file: capFile,
      artboardId: capId,
      frame: markerAt.current.frame,
      seek: markerAt.current.seek,
    }));
    return () => bindMarkerSource(null);
  }, [capFile, capId]);
  const preparing = preparingCount(
    sequences.map((q) => (q.mediaSrc ? footageForSrc(island?.canvas, q.mediaSrc) : null))
  );
  // S7.16 — ⌘K finds a clip by name: the clips of this video, and what picking one does (select it, playhead on it)
  const goToClipRef = useRef(null);
  goToClipRef.current = (c) => {
    onSeek?.(c.from);
    onSelect?.(c.id);
  };
  useEffect(() => {
    bindClips(
      comp
        ? {
            fps,
            go: (c) => goToClipRef.current?.(c),
            clips: sequences
              .map((q, qi) => ({ q, qi }))
              .filter(({ q }) => q.stableId && !q.loose)
              .map(({ q, qi }) => ({
                id: q.stableId,
                name: displayNameOf(q, qi),
                from: q.from,
                frames: q.duration,
                src: q.mediaSrc ?? null,
              })),
          }
        : null
    );
  }, [comp, sequences, fps]);
  useEffect(() => () => bindClips(null), []);
  // P8 C3 (07 · .ve-tl-labs, .ve-lab) — a track is its chip in the gutter (a 20 px tinted icon; in full the name
  // beside it) over the rows it groups. No caption strip above the rows, no code-made lane ids. An empty track still
  // draws its lane (`.ve-row--empty`), with the hint when there is one; a folded one is one striped line.
  const TRACK_ICON = {
    text: 'type',
    gfx: 'image',
    video: 'video',
    video2: 'video',
    music: 'music',
    music2: 'music',
  };
  const trackChip = (id, label, { foldable, folded, count }) => {
    const chip = (
      <span className="tl-lab-ic" aria-hidden="true">
        <TGlyph name={folded ? 'submenu' : (TRACK_ICON[id] ?? 'video')} size={folded ? 10 : 12} />
      </span>
    );
    return (
      <div className="tl-track-cap" title={folded ? FOLD_WORDS.line(label, count) : label}>
        {foldable ? (
          <button
            type="button"
            className="tl-track-fold"
            data-testid={`timeline-track-fold-${id}`}
            aria-expanded={!folded}
            aria-label={folded ? FOLD_WORDS.unfold(label) : FOLD_WORDS.fold(label)}
            title={folded ? FOLD_WORDS.unfold(label) : FOLD_WORDS.fold(label)}
            onClick={() => trackFold.toggle(foldKey, id)}
          >
            {chip}
            <span className="tl-track-name">{folded ? FOLD_WORDS.line(label, count) : label}</span>
          </button>
        ) : (
          <>
            {chip}
            <span className="tl-track-name">{label}</span>
          </>
        )}
      </div>
    );
  };
  const trackShell = (id, label, children, hint, after = null) => {
    const count = trackOfCount.get(id) ?? 0;
    const foldable = FOLDABLE.includes(id) && count > 1;
    const folded = foldable && trackFold.isFolded(foldKey, id);
    const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
    return (
      <div
        className="tl-track"
        data-track={id}
        data-folded={folded ? '1' : undefined}
        data-testid={`timeline-track-${id}`}
        key={id}
      >
        {trackChip(id, label, { foldable, folded, count })}
        {folded ? (
          <div className="tl-row tl-row--fold" aria-hidden="true">
            <span className="tl-row-label" />
            <div className="tl-row-track" style={{ width: axisPx, flex: 'none' }}>
              <span className="tl-fold-bar" />
            </div>
          </div>
        ) : rows.length ? (
          rows
        ) : (
          <div className="tl-row tl-row--empty" data-testid={`timeline-track-empty-${id}`}>
            <span className="tl-row-label" />
            {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target for dragged files, like every lane — not a control */}
            <div
              className="tl-row-track"
              style={{ width: axisPx, flex: 'none' }}
              onDragOver={onLaneDragOver(
                id === 'music' || id === 'music2' ? 'audio' : 'overlay',
                `e-${id}`
              )}
              onDrop={onLaneDrop({ lane: id === 'music' || id === 'music2' ? 'audio' : 'overlay' })}
            >
              {hint ? <span className="tl-track-hint tl-row-hint">{hint}</span> : null}
              {laneCaret(id === 'music' || id === 'music2' ? 'audio' : 'overlay', `e-${id}`)}
            </div>
          </div>
        )}
        {folded ? null : after}
      </div>
    );
  };

  /** P8 C3 (07 · ve-select: titles side by side on one Text lane) — rows of one track that never overlap in time share
   *  a lane. Greedy by start; every row keeps its own element and testid (the later one is drawn ONTO its lane's
   *  first row, `data-lane-join`). A row whose layers are open keeps a lane to itself. */
  const laneJoins = (entries) => {
    const lanes = []; // { end, solo } per lane
    const laneOf = new Map();
    for (const { seq, i } of [...entries].sort((a, b) => a.seq.from - b.seq.from)) {
      const solo = Array.isArray(seq.layers) && seq.layers.length >= 2 && !collapsed.has(i);
      let k = solo ? -1 : lanes.findIndex((l) => !l.solo && l.end <= seq.from);
      if (k < 0) {
        k = lanes.length;
        lanes.push({ end: 0, solo });
      }
      lanes[k].end = seq.from + seq.duration;
      laneOf.set(i, k);
    }
    return laneOf;
  };
  /** Entries in drawing order: lane by lane, each lane left to right; `join` = drawn onto the row above it. */
  const packed = (entries) => {
    const laneOf = laneJoins(entries);
    const seen = new Set();
    return [...entries]
      .sort((a, b) => laneOf.get(a.i) - laneOf.get(b.i) || a.seq.from - b.seq.from)
      .map((e) => {
        const lane = laneOf.get(e.i);
        const join = seen.has(lane);
        seen.add(lane);
        return { ...e, join };
      });
  };

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
  // ── S7.10 — the join picker's numbers: who it joins, what it plays now, and the writes ──
  const picker = (() => {
    if (!joinPicker) return null;
    const t = (transitions || [])[joinPicker.seam];
    const tClip = transitionClips[joinPicker.seam];
    if (!t || !tClip) return null;
    const ai = t.afterIndex;
    const A = sequences[ai];
    const B = sequences[ai + 1];
    if (!A || !B) return null;
    // each shot is held on the frame the join meets it: the outgoing clip's last, the incoming clip's first
    const shot = (seq, i, end) => {
      const url = seq.mediaSrc ? resolveUrl(seq.mediaSrc) : null;
      const at = stillSecond(seq, end, fps);
      return { url: url && at != null ? `${url}#t=${at}` : url, label: displayNameOf(seq, i) };
    };
    const ref = { stableId: tClip.stableId, transition: true };
    return {
      title: joinTitle(displayNameOf(A, ai), displayNameOf(B, ai + 1)),
      tile: tileOfPresentation(t.presentation),
      frames: t.dur ?? 15,
      a: shot(A, ai, 'last'),
      b: shot(B, ai + 1, 'first'),
      set: (params) => onClipVerb?.(ref, 'video.transition.set', params),
    };
  })();

  // ── S7.10 — the selected clip, for the right-hand inspector and for the "how should it sit?" ask ──
  const selIndex =
    selectedClipId == null
      ? -1
      : sequences.findIndex((s2) => s2.stableId && s2.stableId === selectedClipId);
  const selSeq = selIndex >= 0 ? sequences[selIndex] : null;
  const canEditHere = island ? island.canEdit !== false : true;
  const fitFill = useFitFill({
    seq: selSeq,
    comp,
    url: selSeq?.mediaSrc ? resolveUrl(selSeq.mediaSrc) : null,
    canvas: island?.canvas ?? null,
    artboardId: comp?.artboardId ?? null,
    canEdit: canEditHere && !!onClipVerb,
    runFit: (fit) => selSeq && onClipVerb?.(refFor(selSeq, selIndex), 'video.fit', { fit }),
  });
  // S7.12 — the Music track: beats, the dip, Snap to the beat, and "Add music → beats detected"
  const musicLane = useMusicLane({
    canvas: island?.canvas ?? null,
    artboardId: comp?.artboardId ?? null,
    sequences,
    audio,
    canEdit: canEditHere && !!onClipVerb,
    runOp: onClipVerb,
  });
  const selBed = onClipVerb ? musicLane.bedById(selectedClipId) : null;
  // Cut to the beat rolls cuts through the footage's spare seconds: the lengths of the picture sources
  const sequencesNow = useRef(sequences);
  sequencesNow.current = sequences;
  const probeSources = async () => {
    const srcs = [
      ...new Set(sequencesNow.current.filter((q) => rowKind(q) === 'video').map((q) => q.mediaSrc)),
    ];
    const out = {};
    await Promise.all(
      srcs.filter(Boolean).map(async (src) => {
        const url = resolveUrl(src);
        const sec = url ? await probeMediaDuration(url) : null;
        if (sec) out[src] = sec;
      })
    );
    return out;
  };
  useEffect(() => {
    if (selBed) {
      timelineSelection.set(
        musicSelection({
          info: selBed.info,
          label: audio[selBed.index]?.label ?? 'Music',
          canvas: island?.canvas ?? null,
          artboardId: comp?.artboardId ?? null,
          fps,
          onClipVerb,
          onSelect,
          probeSources,
          changeSong: onReplaceAudio ? () => onReplaceAudio(selBed.index) : null,
        })
      );
      return;
    }
    if (!selSeq || selSeq.loose || !onClipVerb) {
      // S7.11 — a caption word is selected through the lane, not through a clip: a refetch must not clear it
      if (timelineSelection.get()?.kind !== 'caption') timelineSelection.set(null);
      return;
    }
    const i = selIndex;
    const ref = refFor(selSeq, i);
    const k = (transitions || []).findIndex((t2) => t2.afterIndex === i);
    const tClip = k >= 0 ? transitionClips[k] : null;
    const kind = timelineKindOf({ ...selSeq, rowKind: rowKind(selSeq) });
    const joinRef = (j) => ({ stableId: j.stableId, transition: true });
    timelineSelection.set({
      kind,
      canvas: island?.canvas ?? null,
      artboardId: comp?.artboardId ?? null,
      fps,
      stableId: selSeq.stableId,
      label: displayNameOf(selSeq, i),
      seq: {
        from: selSeq.from,
        duration: selSeq.duration,
        label: selSeq.label,
        series: !!selSeq.series,
        mediaTag: selSeq.mediaTag ?? null,
        mediaSrc: selSeq.mediaSrc ?? null,
        mediaProps: selSeq.mediaProps ?? null,
        placeholder: selSeq.placeholder ?? null,
        text: selSeq.text ?? null,
        titleMotion: selSeq.titleMotion ?? null,
        titleStyle: selSeq.titleStyle ?? null,
        fit: selSeq.fit ?? null,
        rowKind: rowKind(selSeq),
      },
      transitionAfter:
        tClip && k >= 0
          ? {
              k,
              stableId: tClip.stableId,
              dur: transitions[k].dur ?? 15,
              presentation: transitions[k].presentation ?? null,
            }
          : null,
      onVerb: (verb, params) => onClipVerb(ref, verb, params),
      onOp: (op, params, opts) => onClipVerb(ref, `video.${op}`, params, opts),
      probeSources,
      onJoin: (j, params) => onClipVerb(joinRef(j), 'video.transition.set', params),
      onRemoveJoin: (j) => onClipVerb(joinRef(j), 'remove-transition', {}),
      deselect: () => onSelect?.(null),
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: `refFor` is a pure helper; the rest is listed
  }, [
    selSeq,
    selIndex,
    transitions,
    transitionClips,
    onClipVerb,
    onSelect,
    fps,
    comp?.artboardId,
    island?.canvas,
    selBed?.info,
    selBed?.index,
    audio,
  ]);
  // the Timeline going away takes its selection with it
  useEffect(() => () => timelineSelection.set(null), []);

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

  // S7.9 — the line + words for a lifted beat: "Drop before Touchdown", at the gap its siblings left for it.
  const landing = (() => {
    if (!reorderDrag) return null;
    const rows = sequences.map((s, i) => ({ s, i })).filter(({ s }) => s.series);
    const l = landingOf({ story: rows.map(({ s }) => s), reorderDrag });
    const at = rows[reorderDrag.slot];
    return l && at ? { ...l, frame: previewFroms?.get(at.i) ?? at.s.from } : null;
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
    const story = sequences.filter((q) => q.series);
    const frames = story.map((q) => q.from);
    if (story.length) {
      const last = story[story.length - 1];
      frames.push(last.from + last.duration);
    }
    setDropCaret({
      lane: 'storyline',
      slot,
      x: pts[slot] ?? px,
      frame: frames[slot] ?? 0,
      count: fileCount(e.dataTransfer),
    });
  };

  const onLaneDragOver = (lane, row) => (e) => {
    if (!onDropMedia || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const f = clamp(Math.round(pxToFrame(px, pxf)), 0, totalFrames - 1);
    setDropCaret({ lane, row, frame: f, x: px, count: fileCount(e.dataTransfer) });
  };

  const laneCaret = (lane, row) =>
    dropCaret && dropCaret.lane === lane && dropCaret.row === row ? (
      <>
        <span
          className="tl-drop-caret"
          data-testid="timeline-drop-caret"
          style={{ left: dropCaret.x - 1 }}
        />
        <DropLanding x={dropCaret.x} count={dropCaret.count} atFrame={dropCaret.frame} fps={fps} />
      </>
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
    const displayLabel = displayNameOf(seq, i);
    // Task 11 — in-point trim preview: left edge follows, width shrinks.
    const trimming = !!(trimInDrag && trimInDrag.index === i);
    const trimDelta = trimming ? trimInDrag.delta : 0;
    const left = x(blockFrom) + dragOffset + (trimming ? x(trimDelta) : 0);
    const width = Math.max(2, x(dur - trimDelta));
    const mp = seq.mediaProps || null;
    // S7.16 (07 · ve-footage, ve-long) — footage not here yet / still preparing, and the name of a block too narrow to read
    const footage = seq.mediaSrc ? footageForSrc(island?.canvas, seq.mediaSrc) : null;
    const prepChip = preparingChip(footage);
    const namesOff = !nameVisible(width) && !isResizing && !moving;
    const tip = namesOff
      ? clipTip({
          name: clipNameWithState(displayLabel, footage),
          src: seq.mediaSrc,
          frames: dur,
          fps,
        })
      : null;
    return (
      <Fragment key={`b${i}`}>
        <button
          type="button"
          className={`tl-seq-block${isResizing ? ' is-resizing' : ''}${moving ? ' is-moving' : ''}${dragging ? ' is-dragging' : ''}${seq.hidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}${lane === 'storyline' ? ' tl-beat' : ''}${aiCut?.landing && aiCut.landing === seq.stableId ? ' is-landing' : ''}`}
          data-testid={`timeline-seq-${i}`}
          data-clip-id={seq.stableId || undefined}
          data-kind={rowKind(seq)}
          data-hidden={seq.hidden ? '1' : undefined}
          data-footage={footage?.kind}
          aria-description={footage?.line}
          data-names={namesOff ? 'off' : undefined}
          title={
            tip ??
            (seq.series
              ? `${displayLabel} · ${secs(dur, fps)} — drag to move, trim the right edge`
              : `${displayLabel} · ${secs(dur, fps)} — drag to move (⌥ = no snap)`)
          }
          aria-label={`${displayLabel}, ${fmtTime(blockFrom, fps)} to ${fmtTime(blockFrom + dur, fps)}. Click to select; drag to move.`}
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
            // S7.10 — double-click selects the clip; its inspector is the right-hand panel (it opens with the pick).
            onSelect?.(seq.stableId ?? null);
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
            <span
              className="tl-chip tl-chip-mute"
              title="Muted"
              data-testid={`timeline-mute-chip-${i}`}
            >
              <TGlyph name="mute" size={10} />
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
          {/* P8 C3 (07 · .ve-clip-lab / .ve-item) — the clip's name on a chip; a title or a graphic leads with
              its track's glyph. No kind glyph column, no frame counts (the trim / move tips say the length). */}
          <span className="tl-seq-name tl-clip-lab">
            {trackOfIdx.get(i) === 'text' ? (
              <TGlyph name="type" size={11} />
            ) : trackOfIdx.get(i) === 'gfx' ? (
              <TGlyph name="image" size={11} />
            ) : null}
            {clipNameWithState(displayLabel, footage)}
          </span>
          {prepChip ? (
            <span className="tl-chip tl-chip-prep" data-testid={`timeline-prep-chip-${i}`}>
              {prepChip}
            </span>
          ) : null}
          {(advOpen ? seq.keyframes : []).map((kf, k) => {
            const l = ((kf.from - seq.from) / Math.max(1, seq.duration)) * 100;
            const w = ((kf.to - kf.from) / Math.max(1, seq.duration)) * 100;
            // S7.18 — the markers show with Advanced open; a click picks the keyframe whose curve the foot shows
            const info = seq.keyframeInfo?.[k];
            const picked = !!info && adv.kf?.component === seq.label && adv.kf.index === info.index;
            return (
              <span
                key={k}
                className={`tl-kf${picked ? ' is-picked' : ''}`}
                data-testid={`timeline-kf-${i}-${k}`}
                style={{ left: `${clamp(l, 0, 100)}%`, width: `${Math.max(1.5, w)}%` }}
                title={`seek to keyframe ${kf.from}f (animates ${kf.from}–${kf.to}f)`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (info)
                    advancedStore.selectKeyframe({ component: seq.label, index: info.index });
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
                  setCommentPopover({
                    id: c.id,
                    x: ev.clientX - 130,
                    y: Math.max(60, ev.clientY - 180),
                  });
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
        {onClipVerb &&
        !seq.loose &&
        seq.mediaSrc &&
        (rowKind(seq) === 'video' || rowKind(seq) === 'audio') ? (
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
          <TrimTip
            testid="timeline-trim-in-tip"
            sequences={sequences}
            index={i}
            newDuration={Math.max(1, seq.duration - trimDelta)}
            fps={fps}
            left={left}
            clamped={trimDelta >= trimInDrag.maxDelta && trimDelta > 0}
          />
        ) : null}
        {isResizing ? (
          <TrimTip
            testid="timeline-trim-tip"
            sequences={sequences}
            index={i}
            newDuration={dur}
            fps={fps}
            left={left + width + 8}
            clamped={retimeDrag.atClamp}
          />
        ) : null}
        {moving ? (
          <TrimTip
            testid="timeline-move-tip"
            sequences={sequences}
            index={i}
            newDuration={seq.duration}
            newFrom={blockFrom}
            deltaFrames={blockFrom - moveDrag.startFrom}
            fps={fps}
            left={left}
          />
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

  /** Task 17 — "+" on a hard cut (no transition yet). P8 C3 (07 · ve-select): never drawn at rest — it shows while the
   *  pointer is over the video track or the button has keyboard focus (timeline.css). */
  const renderAddSeams = () => {
    if (!onClipVerb) return null;
    const withTrans = new Set((transitions || []).map((t) => t.afterIndex));
    return storyline.slice(0, -1).map(({ seq, i }, k) => {
      if (withTrans.has(i)) return null;
      const next = storyline[k + 1];
      if (!next) return null;
      const between = `${displayNameOf(seq, i)} and ${displayNameOf(next.seq, next.i)}`;
      return (
        <button
          key={`addseam${k}`}
          type="button"
          className="tl-seam tl-seam-add"
          data-testid={`timeline-seam-add-${k}`}
          aria-label={`Add a transition between ${between}`}
          title={`Add a transition between ${between} — a 0.5 s fade; click its dot to change it`}
          style={{ left: x(next.seq.from) }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClipVerb(refFor(seq, i), 'insert-transition', {
              presentation: 'fade',
              durationInFrames: 15,
            });
          }}
        >
          <TGlyph name="plus" size={12} />
        </button>
      );
    });
  };

  /** P8 C3 (07 · .ve-join) — the round dot on a join that has a transition; it opens the picker right there. The
   *  picker is placed from the dot itself, so a keyboard Enter (clientX/Y = 0) lands it on the join too. */
  const renderSeams = () =>
    (transitions || []).map((t, k) => {
      const next = sequences[t.afterIndex + 1];
      const prev = sequences[t.afterIndex];
      if (!next) return null;
      const center = x(next.from + (t.dur || 0) / 2);
      const name = `${prev ? displayNameOf(prev, t.afterIndex) : 'Clip'} → ${displayNameOf(next, t.afterIndex + 1)}`;
      return (
        <button
          key={`seam${k}`}
          type="button"
          className="tl-seam tl-join"
          data-testid={`timeline-seam-${k}`}
          data-sel={joinPicker?.seam === k ? 'true' : undefined}
          aria-label={`Transition ${name}`}
          aria-haspopup="dialog"
          aria-expanded={joinPicker?.seam === k}
          title={`${name} · ${secs(t.dur || 0, fps)} — click to change`}
          style={{ left: center }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setJoinPicker({ seam: k, x: r.left + r.width / 2, y: r.top, from: e.currentTarget });
          }}
        >
          <TGlyph name="transition" size={11} />
        </button>
      );
    });

  const renderAudioRow = (a, i) => {
    const bedInfo = musicLane.forBed(i); // S7.12 — the media's entry of this loose song
    const Bed = bedInfo ? 'button' : 'div'; // a song the studio knows is a control; one it doesn't is a picture
    return (
      <div className="tl-row" key={`a${i}`} data-testid={`timeline-audio-${i}`}>
        <span className="tl-row-label" title={a.label} />
        <div
          className="tl-row-track"
          style={{ width: axisPx, flex: 'none' }}
          onDragOver={onLaneDragOver('audio', `a${i}`)}
          onDrop={onLaneDrop({ lane: 'audio' })}
        >
          {laneCaret('audio', `a${i}`)}
          <Bed
            {...(bedInfo ? { type: 'button' } : {})}
            className={`tl-audio-block${bedInfo && selectedClipId === bedInfo.stableId ? ' is-selected' : ''}`}
            title={`${songName(a.label)} · ${secs(a.duration, fps)}`}
            aria-label={bedInfo ? `${songName(a.label)} — select the music` : undefined}
            style={{
              left: x(a.from),
              width: Math.max(2, x(a.duration)),
              cursor: bedInfo ? 'pointer' : undefined,
            }}
            data-clip-id={bedInfo?.stableId || undefined}
            // 07 · ve-music — a press on the song selects it (its inspector opens); it never starts a scrub of the track
            onPointerDown={bedInfo ? (e) => e.stopPropagation() : undefined}
            onClick={
              bedInfo
                ? (e) => {
                    e.stopPropagation();
                    onSelect?.(bedInfo.stableId);
                  }
                : undefined
            }
          >
            {a.src && visuals[`p|${a.src}`] ? (
              <svg className="tl-wave" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden>
                {/* Task 7 — real peaks (WebAudio decode), filled mirrored wave. */}
                <path className="tl-wave-real" d={peaksToPath(visuals[`p|${a.src}`])} />
              </svg>
            ) : (
              // P8 C3 (07 · .ve-wave) — until the peaks are read, the song draws as bars, never a sine line
              <WaveBars width={Math.max(2, x(a.duration))} seed={i + 1} />
            )}
            {bedInfo ? null : (
              <span className="tl-music-lab">
                <TGlyph name="music" size={10} />
                <span className="tl-music-n">{songName(a.label)}</span>
              </span>
            )}
          </Bed>
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
          <MusicLaneOverlay
            info={bedInfo}
            x={x}
            speech={musicLane.speech}
            fps={musicLane.fps}
            finding={musicLane.finding(a.src)}
            name={songName(a.label)}
          />
        </div>
      </div>
    );
  };

  return (
    <aside
      ref={rootRef}
      tabIndex={-1}
      data-size={full ? 'full' : 'compact'}
      data-ruler={advOpen && adv.mode === 'frames' ? 'frames' : undefined}
      className={`tl-panel${resizing ? ' is-resizing' : ''}${dropActive ? ' is-drop' : ''}${commentMode ? ' is-commenting' : ''}`}
      // compact is as tall as its tracks (07 · .ve-tl--compact); only the full timeline takes the dragged height
      style={{
        // 07 ve-advanced: with Advanced open the island grows past the dragged height (its cards must stay inside the
        // island and the tracks must stay on screen); CSS caps it at the window
        ...(height && full ? (advOpen ? { minHeight: height } : { height }) : {}),
        outline: 'none',
        '--tl-gutter': `${gutter}px`,
      }}
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
            {/* P8 C3 (07 · .ve-tl-hd) — play · loop · time / length · the video's name, then the status, four
                tools and the size. Everything else the v1 header carried is one disclosure down (Advanced). */}
            <button
              type="button"
              className="icon-btn k-icon-sm tl-play"
              aria-label={playing ? 'Pause' : 'Play'}
              aria-pressed={playing}
              title={playing ? 'Pause — tap space' : 'Play — tap space'}
              data-testid="timeline-playpause"
              onClick={() => (playing ? onPause?.() : onPlay?.())}
            >
              <TGlyph name={playing ? 'pause' : 'play'} />
            </button>
            <button
              type="button"
              className="icon-btn k-icon-sm"
              aria-label="Loop"
              aria-pressed={loop}
              title="Loop"
              data-testid="timeline-loop"
              onClick={() => onToggleLoop?.()}
            >
              <TGlyph name="loop" />
            </button>
            <span
              className="tl-readout"
              data-testid="timeline-readout"
              title={`Frame ${clamped} of ${totalFrames - 1}`}
            >
              {advOpen ? (
                <>
                  <b>{timecode(clamped, fps)}</b>{' '}
                  <span className="tl-readout-len">/ {timecode(totalFrames, fps)}</span>
                </>
              ) : (
                <>
                  <b>{readoutLabel(clamped, fps, playback.stepping())}</b>{' '}
                  <span className="tl-readout-len">/ {mss(totalFrames / fps)}</span>
                </>
              )}
            </span>
            {/* issue #75 — the rows + transport belong to ONE artboard: the header names it. On a canvas with
                several videos where the shell could not tell which, it says so instead of guessing. */}
            {scopedArtboard || comps.length > 1 ? (
              <span
                className={`tl-name${scopedArtboard ? '' : ' is-unknown'}`}
                data-testid="timeline-name"
                title={
                  scopedArtboard
                    ? `The timeline of “${scopedArtboard}”`
                    : 'This canvas has several videos and the timeline could not tell which one this is — Play may move a video you are not looking at.'
                }
              >
                <TGlyph name="video" size={12} />
                {scopedArtboard ?? 'This video'}
              </span>
            ) : null}
            <AiCutStatus cut={aiCut} />
            {cap.warn ? (
              // C22 — past 3 600 frames the video warns, here as everywhere (the Export sheet, the server). The
              // sentence is the same one; the badge opens Advanced, where Allow longer is.
              <button
                type="button"
                className="tl-status tl-status--warn tl-long-badge"
                data-testid="timeline-long-badge"
                title={cap.line}
                onClick={() => {
                  // Advanced is at the foot of the full timeline: open it, and make the timeline full if it is not
                  foldStore.set('timeline', true);
                  if (!full) island?.onToggleSize?.();
                }}
              >
                <TGlyph name="clock" size={12} />
                {clock(totalFrames, fps)}
              </button>
            ) : null}
            {preparing > 0 ? (
              <span className="tl-status tl-prep-status" data-testid="timeline-prep-status">
                <TGlyph name="sync" size={12} />
                {FOOTAGE_WORDS.preparing(preparing)}
              </span>
            ) : null}
            <SharedStatus canvas={island?.canvas} artboardId={comp?.artboardId} />
            <KeptStatus />
            {onToggleMute && (playing || muted) ? (
              // 07 · ve-play — "Sound on" while it plays with sound; the same chip mutes (and says so while muted)
              <button
                type="button"
                className="tl-status tl-sound"
                data-testid="timeline-sound"
                aria-pressed={!muted}
                title={muted ? 'Sound off — click to turn it on' : 'Sound on — click to mute'}
                onClick={() => onToggleMute()}
              >
                {muted ? (
                  <TGlyph name="mute" size={12} />
                ) : (
                  <span className="tl-meter" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
                {muted ? 'Sound off' : 'Sound on'}
              </button>
            ) : null}
            <span className="tl-spacer" />
            <span className="tl-tools">
              {onSplitAtPlayhead ? (
                <button
                  type="button"
                  className="icon-btn k-icon-sm"
                  aria-label="Split at the playhead"
                  title="Split at the playhead · S"
                  data-testid="timeline-split"
                  onClick={() => onSplitAtPlayhead()}
                >
                  <TGlyph name="scissors" />
                </button>
              ) : null}
              {onAddTitle ? (
                <button
                  type="button"
                  className="icon-btn k-icon-sm"
                  aria-label="Add text"
                  title="Add text"
                  data-testid="timeline-add-title"
                  onClick={() => onAddTitle(clamped)}
                >
                  <TGlyph name="type" />
                </button>
              ) : null}
              {island ? <CaptionsTool /> : null}
              {onDropMedia && canEditHere ? (
                <MusicTool onAddFiles={(files) => onDropMedia(files, null)} />
              ) : null}
            </span>
            <span className="tl-div" aria-hidden="true" />
            {full ? (
              <>
                <span className="tl-zoomer">
                  <button
                    type="button"
                    className="icon-btn k-icon-sm tl-zoom-step"
                    aria-label="Zoom out"
                    title="Zoom out · ⌘−"
                    onClick={() => zoomTo(pxf / ZOOM_STEP)}
                  >
                    <TGlyph name="minus" size={12} />
                  </button>
                  <input
                    type="range"
                    className="tl-zoom"
                    min="0"
                    max="100"
                    value={zoomSliderValue}
                    data-testid="timeline-zoom"
                    aria-label="Zoom the timeline"
                    title="Zoom the timeline"
                    onChange={(e) => zoomTo(zoomFromSlider(Number(e.target.value)))}
                  />
                  <button
                    type="button"
                    className="icon-btn k-icon-sm tl-zoom-step"
                    aria-label="Zoom in"
                    title="Zoom in · ⌘+"
                    onClick={() => zoomTo(pxf * ZOOM_STEP)}
                  >
                    <TGlyph name="plus" size={12} />
                  </button>
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm tl-fit"
                  data-testid="timeline-zoom-fit"
                  title="Fit the whole video · 0"
                  onClick={() => setZoomPxf(null)}
                >
                  Fit
                </button>
              </>
            ) : null}
          </>
        ) : (
          <span className="tl-title">Timeline</span>
        )}
        <SizeButton />
      </div>

      {!comp ? (
        <div className="tl-empty" data-testid="timeline-empty">
          No video on this canvas yet. Drop clips here to start a cut, or make one with{' '}
          <b>⌘K → New video</b>.
        </div>
      ) : island?.empty && sequences.length === 0 && audio.length === 0 ? (
        // S7.7 (05 · es-timeline) — a video artboard with no clips: the kit's line + one AI chip. The panel's
        // own onDrop is on its root, so the block is the drop zone too.
        island.empty
      ) : (
        <div className="tl-scroll" ref={setScrollRef}>
          <div
            className="tl-tracks"
            ref={trackRef}
            data-testid="timeline-track"
            style={{ width: gutter + axisPx }}
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
                    if (row)
                      frame =
                        row.from + Math.min(tl.frameOffset || 0, Math.max(0, row.duration - 1));
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
                      style={{ left: gutter + x(clamp(frame, 0, totalFrames - 1)) - 8 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeek?.(clamp(frame, 0, totalFrames - 1));
                        setCommentPopover({
                          id: c.id,
                          x: e.clientX - 130,
                          y: Math.max(60, e.clientY - 180),
                        });
                      }}
                    >
                      💬
                    </button>
                  );
                })}
              </div>
            ) : null}
            {isBand(band) ? (
              <span
                className="tl-loop-lane"
                data-testid="timeline-loop-lane"
                style={{ left: gutter + x(band.in), width: x(band.out - band.in) }}
              />
            ) : null}
            <div className="tl-ruler" style={{ width: axisPx }}>
              {isBand(band) ? (
                <span
                  className="tl-loop"
                  data-testid="timeline-loop-band"
                  title={`Loop ${fmtTime(band.in, fps)}–${fmtTime(band.out, fps)} · I and O set it`}
                  style={{ left: x(band.in), width: x(band.out - band.in) }}
                />
              ) : null}
              {/* 07 · .ve-poster-flag — the picture the video rests on; with none stored it is the default, 35 % in */}
              <span
                className="tl-poster-flag"
                data-testid="timeline-poster-flag"
                data-frame={posterAt}
                title={`Poster frame · ${fmtTime(posterAt, fps)}`}
                style={{ left: x(posterAt) }}
              >
                <TGlyph name="image" size={10} />
                Poster
              </span>
              {markers.map((m) => (
                <button
                  key={`mk${m.frame}`}
                  type="button"
                  className="tl-marker-flag"
                  data-testid={`timeline-marker-${m.frame}`}
                  style={{ left: x(clamp(m.frame, 0, totalFrames - 1)) }}
                  title={`${m.name || 'Marker'} · ${fmtTime(m.frame, fps)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek?.(m.frame);
                  }}
                >
                  <span className="tl-marker-name">{m.name}</span>
                </button>
              ))}
              {/* S7.17 — comment flags + time-pinned stickies on this video */}
              <RulerMarks
                file={capFile}
                artboardId={capId}
                fps={fps}
                total={totalFrames}
                x={x}
                onSeek={onSeek}
              />
              {ticks.map((f) => {
                const major = f % (fps || 30) === 0;
                const showLabel = (advOpen && adv.mode === 'frames') || major || step <= 5;
                return (
                  <span
                    key={f}
                    className={`tl-tick${major ? ' is-major' : ''}${f === 0 ? ' is-start' : ''}`}
                    style={{ left: x(f) }}
                  >
                    {showLabel ? (
                      <span className="tl-tick-label">
                        {advOpen && adv.mode === 'frames' ? frameTick(f) : rulerLabel(f, fps)}
                      </span>
                    ) : null}
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
                  const overlayOf = (id) => overlay.filter(({ i }) => trackOfIdx.get(i) === id);
                  const overlayRows = (list) =>
                    packed(list).map(({ seq, i, join }) => {
                      const docIdx = seq.loose ? null : zLadder.findIndex((o) => o.i === i);
                      const vNum = docIdx == null ? null : docIdx + 2; // V1 = the storyline
                      const rowCls =
                        `tl-row tl-row--overlay` +
                        (layerDrag && layerDrag.index === i ? ' is-layer-dragging' : '') +
                        (layerDrag &&
                        docIdx != null &&
                        layerDrag.index !== i &&
                        layerDrag.curTarget === docIdx
                          ? ' is-layer-target'
                          : '');
                      return (
                        <div
                          className={rowCls}
                          key={`o${i}`}
                          data-testid={`timeline-row-${i}`}
                          data-lane-join={join ? '1' : undefined}
                          {...(docIdx != null ? { 'data-layer-doc': docIdx } : {})}
                        >
                          <span className="tl-row-label">
                            {/* P8 C3 — the layer grip has no code-made id ("V2"); it shows on hover in full */}
                            {docIdx != null && full ? (
                              <span
                                className="tl-row-grip"
                                data-testid={`timeline-lane-chip-${i}`}
                                role="presentation"
                                title="Drag up or down to change which layer covers which"
                                onPointerDown={(e) => startLayerDrag(e, i, docIdx)}
                              />
                            ) : null}
                          </span>
                          <div
                            className="tl-row-track"
                            style={{ width: axisPx, flex: 'none' }}
                            onDragOver={onLaneDragOver('overlay', `o${i}`)}
                            onDrop={onLaneDrop({ lane: 'overlay' })}
                          >
                            {renderBlock(seq, i, {
                              lane: 'overlay',
                              laneName: vNum != null ? `V${vNum}` : 'loose',
                            })}
                            {laneCaret('overlay', `o${i}`)}
                          </div>
                        </div>
                      );
                    });
                  return [
                    trackShell(
                      'text',
                      'Text',
                      overlayRows(overlayOf('text')),
                      null,
                      // S7.11 — the captions are the Text track's second lane (derived from the words); it may
                      // draw nothing, so it never stands in for the track's own (empty) lane
                      <CaptionLane
                        key="captions"
                        canvas={island?.canvas ?? null}
                        artboardId={comp?.artboardId ?? null}
                        fps={fps}
                        frame={clamped}
                        x={x}
                        axisPx={axisPx}
                        onSeek={onSeek}
                      />
                    ),
                    trackShell('gfx', 'Graphics', overlayRows(overlayOf('gfx'))),
                    overlayOf('video2').length || extraTracks.includes('video2')
                      ? trackShell('video2', 'Video 2', overlayRows(overlayOf('video2')))
                      : null,
                  ];
                })()}
                {/* THE storyline — series beats butted side-by-side. */}
                <div className="tl-track" data-track="video" data-testid="timeline-track-video">
                  {trackChip('video', 'Video', {
                    foldable: false,
                    folded: false,
                    count: storyline.length,
                  })}
                  <div className="tl-row tl-row--storyline" data-testid="timeline-storyline">
                    <span className="tl-row-label" />
                    <div
                      className={`tl-row-track tl-storyline-track${reorderDrag ? ' is-reordering' : ''}${moveDrag?.overStory ? ' is-drop-target' : ''}`}
                      style={{ width: axisPx, flex: 'none' }}
                      onDragOver={onStoryDragOver}
                      onDrop={onLaneDrop({ lane: 'storyline' })}
                    >
                      {storyline.map(({ seq, i }) =>
                        renderBlock(seq, i, { lane: 'storyline', laneName: 'V1' })
                      )}
                      {reorderDrag ? null : renderSeams()}
                      {reorderDrag ? null : renderAddSeams()}
                      {dropCaret?.lane === 'storyline' ? (
                        <>
                          <span
                            className="tl-drop-caret"
                            data-testid="timeline-drop-caret"
                            style={{ left: dropCaret.x - 1 }}
                          />
                          <DropLanding
                            x={dropCaret.x}
                            count={dropCaret.count}
                            atFrame={dropCaret.frame}
                            fps={fps}
                          />
                        </>
                      ) : null}
                      {landing ? (
                        <MoveLanding x={x(landing.frame ?? 0)} text={landing.text} />
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
                        return (
                          <div
                            className="tl-row tl-row--layer"
                            key={`bl${i}-${li}`}
                            data-testid={`timeline-layer-${i}-${li}`}
                          >
                            <span className="tl-row-label" title={`${seq.label} · ${ly.label}`}>
                              <span className="tl-layer-indent" aria-hidden="true" />
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
                                  setCtxMenu({
                                    index: i,
                                    layerIndex: li,
                                    x: e.clientX,
                                    y: e.clientY,
                                  });
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
                </div>
                {/* Audio band — standalone audio clips (movable/trimmable) +
                    loose <Audio> beds, on Music (and Music 2 when two play at once). */}
                {(() => {
                  const clipRow = ({ seq, i }, k) => (
                    <div
                      className="tl-row tl-row--overlay tl-row--audio"
                      key={`ac${i}`}
                      data-testid={`timeline-row-${i}`}
                    >
                      <span className="tl-row-label" />
                      <div
                        className="tl-row-track"
                        style={{ width: axisPx, flex: 'none' }}
                        onDragOver={onLaneDragOver('audio', `ac${i}`)}
                        onDrop={onLaneDrop({ lane: 'audio' })}
                      >
                        {renderBlock(seq, i, { lane: 'audio', laneName: `A${k + 1}` })}
                        <MusicLaneOverlay
                          info={musicLane.forClip(seq.stableId)}
                          x={x}
                          speech={musicLane.speech}
                          fps={musicLane.fps}
                          finding={musicLane.finding(seq.mediaSrc)}
                          name={songName(displayNameOf(seq, i))}
                        />
                        {laneCaret('audio', `ac${i}`)}
                      </div>
                    </div>
                  );
                  const musicOf = (id) => [
                    ...audioClips
                      .map((entry, k) =>
                        trackOfIdx.get(entry.i) === id ? clipRow(entry, k) : null
                      )
                      .filter(Boolean),
                    ...audio
                      .map((a, i) => (trackOfBed.get(i) === id ? renderAudioRow(a, i) : null))
                      .filter(Boolean),
                  ];
                  const music = musicOf('music');
                  const music2 = musicOf('music2');
                  return [
                    trackShell(
                      'music',
                      'Music',
                      music,
                      music.length || music2.length || !isSilentVideo(sequences, audio) ? null : (
                        <MusicHint
                          artboard={scopedArtboard || undefined}
                          canAsk={island?.canAsk}
                          canEdit={canEditHere}
                          onAddFiles={onDropMedia ? (files) => onDropMedia(files, null) : undefined}
                        />
                      )
                    ),
                    music2.length || extraTracks.includes('music2')
                      ? trackShell('music2', 'Music 2', music2)
                      : null,
                  ];
                })()}
                {/* Debate verdict: the dead space below the lanes gets a JOB —
                    it IS the new-layer drop target, and says so. */}
                <div
                  className={`tl-newlayer-zone${dropCaret?.row === 'newlayer' ? ' is-active' : ''}`}
                  data-testid="timeline-newlayer-zone"
                  onDragOver={onLaneDragOver('overlay', 'newlayer')}
                  onDrop={onLaneDrop({ lane: 'overlay' })}
                >
                  <span style={{ marginLeft: gutter }}>Drop clips here — new layer</span>
                </div>
              </>
            ) : (
              <>
                {(() => {
                  // gate-b-polish3 (07 · C35) — a purely digital comp keeps its row-per-sequence view (layers
                  // expand under a row, dogfood 2026-07-30), but the rows sit in the SAME four tracks as a media
                  // cut: Text · Graphics · Video · Music, top covers bottom. A track groups rows; every row's
                  // testid, drag and expand are unchanged (S7.8: tracks are caption strips around the rows).
                  const stackRow = (seq, i) => {
                    const layers = Array.isArray(seq.layers) ? seq.layers : [];
                    const decomposable = layers.length >= 2;
                    const isExpanded = decomposable && !collapsed.has(i);
                    const dur =
                      retimeDrag && retimeDrag.index === i ? retimeDrag.curDur : seq.duration;
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
                                aria-label={
                                  isExpanded
                                    ? `Collapse ${seq.label} layers`
                                    : `Show ${seq.label} layers`
                                }
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
                            <span className="tl-row-label-text">{displayNameOf(seq, i)}</span>
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
                              const lyReplaceable = !!(ly.mediaCdId || ly.mediaArrayRef);
                              return (
                                <div
                                  className="tl-row tl-row--layer"
                                  key={`l${li}`}
                                  data-testid={`timeline-layer-${i}-${li}`}
                                >
                                  <span className="tl-row-label" title={ly.label}>
                                    <span className="tl-layer-indent" aria-hidden="true" />
                                    <span className="tl-row-label-text">{ly.label}</span>
                                  </span>
                                  <div
                                    className="tl-row-track"
                                    style={{ width: axisPx, flex: 'none' }}
                                  >
                                    <div
                                      className="tl-seq-block tl-layer-block"
                                      data-kind={lyKind}
                                      data-testid={`timeline-layer-block-${i}-${li}`}
                                      title={`${ly.label} (${ly.kind} layer)`}
                                      style={{ left: x(seq.from), width: Math.max(2, x(dur)) }}
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setCtxMenu({
                                          index: i,
                                          layerIndex: li,
                                          x: e.clientX,
                                          y: e.clientY,
                                        });
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
                  };
                  const rowsOn = (id) =>
                    sequences
                      .map((seq, i) => (trackOfIdx.get(i) === id ? stackRow(seq, i) : null))
                      .filter(Boolean);
                  const bedsOn = (id) =>
                    audio
                      .map((a, i) => (trackOfBed.get(i) === id ? renderAudioRow(a, i) : null))
                      .filter(Boolean);
                  return drawnTracks.map((t) =>
                    trackShell(t.id, t.label, [...rowsOn(t.id), ...bedsOn(t.id)])
                  );
                })()}
              </>
            )}

            {snapFlash ? (
              <span className="tl-snapline" style={{ left: gutter + x(snapFlash.frame) }} />
            ) : null}
            {/* S7.17 — teammates' playheads, and the tag over a caption word one of them is fixing */}
            <PeerHeads
              canvas={capFile}
              artboardId={capId}
              x={x}
              gutter={gutter}
              total={totalFrames}
            />
            <span
              className="tl-playhead"
              data-testid="timeline-playhead"
              style={{ left: gutter + x(clamped) }}
            />
            <AiEdge cut={aiCut} left={aiCut?.edge != null ? gutter + x(aiCut.edge) : Number.NaN} />
          </div>
        </div>
      )}
      {comp && full ? (
        <AdvancedFoot
          canvas={capFile}
          artboardId={capId}
          fps={fps}
          total={totalFrames}
          frame={clamped}
          sequences={sequences}
          selectedClipId={selectedClipId}
          canEdit={canEditHere && !!onClipVerb}
          canRead
          cap={cap}
          onCap={(action) =>
            capFile && capId
              ? void saveMaxFrames(capFile, capId, action === 'allow' ? CAP_CEILING : null)
              : undefined
          }
          have={drawnTracks.map((t) => t.id)}
          onWriteEasing={(kf, bezier) => onClipVerb?.(null, 'video.easing.set', { ...kf, bezier })}
          tools={
            // 07 · note 26 — "Everything the old timeline had, one disclosure down": the v1 header's other tools
            <div className="tla-tools" data-testid="timeline-more-tools">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label="Jump to start"
                onClick={() => onSeek?.(0)}
              >
                <TGlyph name="step-back" size={12} />
                To the start
              </button>
              {onAddImage ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  title="Add an image at the playhead"
                  data-testid="timeline-add-image"
                  onClick={() => onAddImage(clamped)}
                >
                  <TGlyph name="image" size={12} />
                  Add image
                </button>
              ) : null}
              {onAddAiClip ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  title="Add a shot for AI to make, at the end"
                  data-testid="timeline-placeholder-add"
                  onClick={() => onAddAiClip()}
                >
                  <TGlyph name="spark" size={12} />
                  Shot for AI
                </button>
              ) : null}
              {onAddComment ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-pressed={commentMode}
                  title="Click anywhere on the timeline to pin a comment · C"
                  data-testid="timeline-comment-tool"
                  onClick={() => setCommentMode((m) => !m)}
                >
                  <TGlyph name="comment" size={12} />
                  Comment
                </button>
              ) : null}
              {onToggleMute ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-pressed={!muted}
                  data-testid="timeline-mute"
                  onClick={() => onToggleMute()}
                >
                  <TGlyph name={muted ? 'mute' : 'volume'} size={12} />
                  {muted ? 'Sound off' : 'Sound on'}
                </button>
              ) : null}
              {onVolume ? (
                <label className="tla-vol">
                  Volume
                  <input
                    type="range"
                    className="tl-volume"
                    min="0"
                    max="100"
                    value={Math.round((muted ? 0 : volume) * 100)}
                    data-testid="timeline-volume"
                    onChange={(e) => onVolume(Number(e.target.value) / 100)}
                  />
                </label>
              ) : null}
            </div>
          }
        />
      ) : null}
      {commentDraft
        ? createPortal(
            <div
              className="tlci tlci--comment"
              style={{ left: commentDraft.x, top: commentDraft.y }}
            >
              <div className="tlci-head" style={{ cursor: 'default' }}>
                <span className="tlci-title">
                  Comment at {fmtTime(commentDraft.at, fps)}
                  {commentDraft.anchor.lane ? ` · ${commentDraft.anchor.lane}` : ''}
                </span>
                <button
                  type="button"
                  className="tlci-x"
                  aria-label="Close"
                  onClick={() => setCommentDraft(null)}
                >
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
        ? createPortal(
            (() => {
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
                    <button
                      type="button"
                      className="tlci-x"
                      aria-label="Close"
                      onClick={() => setCommentPopover(null)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="tlci-body">
                    <p className="tlci-comment-text">{c.text}</p>
                    {(c.thread || []).map((r2, k2) => (
                      <p key={k2} className="tlci-note">
                        ↳ {r2.author ? `${r2.author}: ` : ''}
                        {r2.body}
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
                          Delete comment
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })(),
            document.body
          )
        : null}
      {joinPicker && picker
        ? createPortal(
            <TransitionPicker
              title={picker.title}
              tile={picker.tile}
              frames={picker.frames}
              fps={fps}
              a={picker.a}
              b={picker.b}
              x={joinPicker.x}
              y={joinPicker.y}
              canEdit={island ? island.canEdit !== false : true}
              onPick={(key) => picker.set({ presentation: key })}
              onLength={(frames) => picker.set({ durationInFrames: frames })}
              onClose={() => {
                // a11y — esc / a click away hands focus back to the join it opened from
                const from = joinPicker.from;
                setJoinPicker(null);
                if (from?.isConnected) from.focus?.();
              }}
            />,
            document.body
          )
        : null}
      {/* S7.13 — Re-frame: the selected clip's window per format (drawn only while opened) */}
      <ReframeHost
        seq={selSeq}
        comp={comp}
        fps={fps}
        frame={frame}
        name={selSeq ? displayNameOf(selSeq, selIndex) : ''}
        canvas={island?.canvas ?? null}
        artboardId={comp?.artboardId ?? null}
        canEdit={canEditHere && !!onClipVerb}
        url={selSeq?.mediaSrc ? resolveUrl(selSeq.mediaSrc) : null}
        run={(params) => selSeq && onClipVerb?.(refFor(selSeq, selIndex), 'video.reframe', params)}
      />
      {/* S7.15 — Other takes: the selected clip's other good moments, swapped in at the same length (07 · ve-ai-adjust) */}
      <OtherTakesHost
        seq={selSeq}
        fps={fps}
        name={selSeq ? displayNameOf(selSeq, selIndex) : ''}
        canEdit={canEditHere && !!onClipVerb}
        url={selSeq?.mediaSrc ? resolveUrl(selSeq.mediaSrc) : null}
        run={(params) =>
          selSeq && onClipVerb?.(refFor(selSeq, selIndex), 'video.take.swap', params)
        }
      />
      {fitFill.ask
        ? createPortal(
            <FitFillAsk ask={fitFill.ask} onAnswer={fitFill.answer} onClose={fitFill.dismiss} />,
            document.body
          )
        : null}
      {ctxMenu && sequences[ctxMenu.index]
        ? createPortal(
            (() => {
              const seq = sequences[ctxMenu.index];
              const i = ctxMenu.index;
              const ref = refFor(seq, i);
              // Vertical z-order (overlay clips only) — mirrors the V-chip drag.
              const zLadder = overlay.filter((o) => !o.seq.loose);
              const docIdx = zLadder.findIndex((o) => o.i === i);
              // the series beats, in order: "earlier" and "later" are relative to THEM, not to every row
              const beats = sequences
                .map((s2, i2) => ({ s: s2, i: i2 }))
                .filter(({ s: s2 }) => s2.series);
              const at = beats.findIndex((b) => b.i === i);
              const prevBeat = at > 0 ? beats[at - 1] : null;
              const nextBeat = at >= 0 && at < beats.length - 1 ? beats[at + 1] : null;
              // S7.9 — the 17 v1 items, six drawn and eleven under Advanced ▸ (edit/clip-menu.js).
              return (
                <ClipMenu
                  x={ctxMenu.x}
                  y={ctxMenu.y}
                  onClose={() => setCtxMenu(null)}
                  model={{
                    seq,
                    index: seq.series ? Math.max(0, at) : i,
                    count: seq.series ? beats.length : sequences.length,
                    rowKind: rowKind(seq),
                    layerIndex: ctxMenu.layerIndex ?? null,
                    zLadder: docIdx >= 0 ? { docIdx, len: zLadder.length } : null,
                    has: {
                      comment: !!onAddComment,
                      generate: !!onGeneratePlaceholder,
                      verb: !!onClipVerb,
                      replace: !!onReplace,
                      reorder: !!onReorder,
                      hide: !!onToggleHide,
                      remove: !!onRemove,
                      replaceLayer: !!onReplaceLayer,
                    },
                  }}
                  run={{
                    comment: () =>
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
                      }),
                    generate: () => onGeneratePlaceholder(ref),
                    // S7.10 — Adjust… selects the clip: the right-hand inspector is where it is adjusted
                    adjust: () => onSelect?.(seq.stableId ?? null),
                    hide: () => onToggleHide(ref),
                    show: () => onToggleHide(ref),
                    remove: () => onRemove(ref),
                    replace: () => onReplace(ref),
                    mute: () => onClipVerb(ref, 'audio', { muted: true }),
                    unmute: () => onClipVerb(ref, 'audio', { muted: false }),
                    'detach-audio': () => onClipVerb(ref, 'detach-audio', {}),
                    'to-overlay': () => onClipVerb(ref, 'to-overlay', {}),
                    'to-storyline': () => onClipVerb(ref, 'to-storyline', {}),
                    'layer-up': () => onClipVerb(ref, 'layer-order', { toIndex: docIdx + 1 }),
                    'layer-down': () => onClipVerb(ref, 'layer-order', { toIndex: docIdx - 1 }),
                    // a series beat swaps places with its neighbour through the ONE move op; a layer re-stacks
                    earlier: () =>
                      seq.series
                        ? prevBeat && onReorderMove?.(ref, refFor(prevBeat.s, prevBeat.i), 'before')
                        : onReorder(ref, 'forward'),
                    later: () =>
                      seq.series
                        ? nextBeat && onReorderMove?.(ref, refFor(nextBeat.s, nextBeat.i), 'after')
                        : onReorder(ref, 'backward'),
                    'replace-layer': () => onReplaceLayer(ref, ctxMenu.layerIndex),
                  }}
                />
              );
            })(),
            document.body
          )
        : null}
      {island?.fileDrag && island.dropRect && onDropMedia ? (
        <ArtboardDropCatcher rect={island.dropRect} onFiles={(files) => onDropMedia(files, null)} />
      ) : null}
    </aside>
  );
}
