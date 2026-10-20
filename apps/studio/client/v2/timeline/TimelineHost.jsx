// client/v2/timeline/TimelineHost.jsx — S7.7: the timeline island, wired to today's shell.
//
// The v1 dock is gone: the timeline is an island tied to the selected VIDEO artboard (07 · ve-none, ve-select,
// ve-deselect). This host
//   · listens to the canvas's `artboard-anchor` (the active frame only) and feeds the store;
//   · places the island under that artboard (compact, notch on its centre) or edge to edge (full), and follows
//     pan and zoom because the canvas re-sends the rect;
//   · slides it in and out, and keeps it mounted until it has left, so the body never flashes empty;
//   · keeps `timelineOpen` — the flag every v1 data effect and the transport keys read — equal to "the island
//     is mounted", and turns the v1 openers / closers (artboard menu, New video, the ×) into keep-open / hide;
//   · retargets the transport to the followed video and gives each video its own playhead back;
//   · hides with the other panels (⌘\) like any panel.
//
// `children` is the v1 body (ShellTimelinePanel → Timeline.jsx). The shell mounts this once, always; the body
// is rendered only while the island is up.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isNativeApp } from '../../github.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { usePanelLayout } from '../shell/use-panel-layout.js';
import { anchorCentre, placeCompact, placeFull } from './anchor.js';
import { createAnchorLane } from './anchor-lane.js';
import { useFileDrag } from './edit/drop.jsx';
import { playToggle } from './keys.js';
import { loopJump } from './transport.js';
import { bindFollowed, playbackStore } from './playhead.js';
import { useTimelinePeersLane } from './peers.jsx';
import { bindPosterSource, loadPoster, posterOf, usePosterVersion } from './poster.js';
import { TimelineIslandContext } from './island-context.js';
import { TimelineIsland } from './island.jsx';
import { timelineSelection, useTimelineSelection } from './selection.js';
import { timelineStore, useTimelineView } from './timeline-store.js';
import { TimelineEmpty } from './timeline-empty.jsx';

/** How long the island takes to leave (--dur-panel is 220 ms; reduced motion cuts the animation, not this). */
const LEAVE_MS = 260;

export default function TimelineHost({ children }) {
  const {
    shellCore: {
      activeComps,
      activePath,
      cfg,
      iframesRef,
      postToActiveCanvas,
      setCanvasActiveArtboard,
      setInspectorOpen,
      setTimelineFrame,
      setTimelineOpen,
      setTimelinePlaying,
      timelineCompId,
      timelineFrame,
      timelineLoop,
      timelineOpen,
      timelinePlaying,
      viewerMode,
    },
    photoAndTimeline,
  } = useShellStore();
  const tlKeyRef = photoAndTimeline?.tlKeyRef;
  const view = useTimelineView();
  // S7.10 — a clip selected on the Timeline is edited in the right-hand inspector: it comes up when a different
  // clip is picked (a person who closed it keeps it closed until the next pick, like the canvas's own auto-open)
  const pickedClip = useTimelineSelection()?.stableId ?? null;
  useEffect(() => {
    if (pickedClip) setInspectorOpen?.(true);
  }, [pickedClip, setInspectorOpen]);
  const { hidden: panelsHidden } = usePanelLayout();
  const present = view.visible && !panelsHidden;

  // ── the canvas says which artboard is selected ──
  const live = useRef({});
  live.current = { activePath, iframesRef, canvasOrigin: cfg?.canvasOrigin };
  // S7.8 — a quick Space on the canvas plays the followed video (07 · ve-play); the same toggle the key runs.
  const deps = useRef({});
  deps.current = {
    tlKeyRef,
    setTimelineFrame,
    setTimelinePlaying,
    follows: !!tlKeyRef && !!view.target && present,
  };
  useEffect(() => {
    const lane = createAnchorLane({
      onSpaceTap: () => {
        if (deps.current.follows) playToggle(deps.current);
      },
      // S7.10 — a canvas selection takes the right-hand inspector back from the selected clip
      onCanvasSelect: () => timelineSelection.release(),
      canvasOrigin: () => live.current.canvasOrigin || window.location.origin,
      activePath: () => live.current.activePath,
      frameOf: (p) => live.current.iframesRef?.current?.get(p),
      store: timelineStore,
    });
    window.addEventListener('message', lane.onMessage);
    return () => window.removeEventListener('message', lane.onMessage);
  }, []);
  // S7.17 — teammates' playheads and caption words, from the active canvas (always listening)
  useTimelinePeersLane();
  // another canvas: its videos are not these videos
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching canvases is the trigger
  useEffect(() => {
    timelineStore.reset();
    playbackStore.reset();
  }, [activePath]);

  // ── a loop band: playback that reaches its end goes back to its start (the Player loops the whole cut) ──
  useEffect(() => {
    if (!timelinePlaying || !timelineCompId) return;
    const to = loopJump(playbackStore.loopFor(timelineCompId), timelineFrame, timelineLoop);
    if (to === null) return;
    setTimelineFrame(to);
    postToActiveCanvas({ dgn: 'timeline-seek', frame: to, id: timelineCompId });
    postToActiveCanvas({ dgn: 'timeline-play', id: timelineCompId });
  }, [
    timelineFrame,
    timelinePlaying,
    timelineLoop,
    timelineCompId,
    postToActiveCanvas,
    setTimelineFrame,
  ]);

  // ── mounted while present, and for the length of the slide out ──
  const [mounted, setMounted] = useState(present);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (present) {
      setMounted(true);
      setLeaving(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setLeaving(true);
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [present, mounted]);

  // ── `timelineOpen` is "the island is mounted"; a v1 opener / closer is a keep-open / hide ──
  const mirror = useRef(false);
  useEffect(() => {
    if (timelineOpen === mirror.current) return; // our own write coming back
    if (timelineOpen) timelineStore.open();
    else timelineStore.close();
  }, [timelineOpen]);
  useEffect(() => {
    if (mounted === mirror.current) return;
    mirror.current = mounted;
    setTimelineOpen(mounted);
  }, [mounted, setTimelineOpen]);

  // ── the transport follows the video; each video keeps its own playhead ──
  const targetId = view.target?.artboardId ?? null;
  const frameRef = useRef(timelineFrame);
  frameRef.current = timelineFrame;
  const compsRef = useRef(activeComps);
  compsRef.current = activeComps;
  useEffect(() => {
    if (!targetId) return undefined;
    setCanvasActiveArtboard?.(targetId);
    const remembered = timelineStore.frameFor(targetId);
    setTimelineFrame(remembered ?? 0);
    if (remembered !== undefined) {
      const comp = (compsRef.current || []).find((c) => c?.artboardId === targetId);
      postToActiveCanvas({ dgn: 'timeline-seek', frame: remembered, id: comp?.id ?? targetId });
    }
    // leaving this video (or the island going away) files its playhead under its own name
    return () => timelineStore.remember(targetId, frameRef.current);
  }, [targetId, postToActiveCanvas, setCanvasActiveArtboard, setTimelineFrame]);

  // ── the poster frame: read for the ruler's flag, and the playhead `video.poster.set` writes it at ──
  usePosterVersion();
  useEffect(() => {
    if (activePath && targetId) void loadPoster(activePath, targetId);
  }, [activePath, targetId]);
  const posterNow = useRef({});
  posterNow.current = {
    file: activePath,
    artboardId: targetId,
    frame: timelineFrame,
    fps: (activeComps || []).find((c) => c?.artboardId === targetId)?.fps || 30,
  };
  const followedNow = useRef({});
  followedNow.current = {
    compId: timelineCompId,
    frame: timelineFrame,
    total: tlKeyRef?.current?.total,
  };
  useEffect(() => {
    bindPosterSource(() => (posterNow.current.artboardId ? posterNow.current : null));
    bindFollowed(() => (followedNow.current.compId ? followedNow.current : null));
    return () => {
      bindPosterSource(null);
      bindFollowed(null);
    };
  }, []);
  const poster = activePath && targetId ? posterOf(activePath, targetId) : null;

  // ── footage dragged over the window: the canvas draws "Or drop here — adds at the end" on this artboard (S7.9) ──
  const fileDrag = useFileDrag(present && !!targetId);
  useEffect(() => {
    if (!targetId || !fileDrag) return undefined;
    postToActiveCanvas({ dgn: 'timeline-drop-hint', artboardId: targetId, on: true });
    return () => postToActiveCanvas({ dgn: 'timeline-drop-hint', artboardId: targetId, on: false });
  }, [fileDrag, targetId, postToActiveCanvas]);
  // where the artboard is, in window pixels: the canvas frame's corner plus the rect the canvas reported
  const dropRect = (() => {
    if (!fileDrag || !view.target?.rect) return null;
    const f = activePath ? iframesRef?.current?.get(activePath) : null;
    const fr = f?.getBoundingClientRect?.();
    if (!fr) return null;
    const r = view.target.rect;
    return { left: fr.left + r.x, top: fr.top + r.y, width: r.w, height: r.h };
  })();

  // ── the island's words and hands ──
  const canAsk = isNativeApp() && !viewerMode;
  const artboardLabel = view.target?.label ?? 'this video';
  const ctx = useMemo(
    () => ({
      size: view.size,
      kept: view.kept,
      poster,
      fileDrag,
      dropRect,
      // S7.10 — what the clip inspector, the join picker and the Music hint need to know about their surroundings
      canvas: activePath ?? null,
      canEdit: !viewerMode,
      canAsk,
      onToggleSize: () => timelineStore.toggleSize(),
      empty: <TimelineEmpty artboard={artboardLabel} canAsk={canAsk} />,
    }),
    [
      view.size,
      view.kept,
      poster,
      artboardLabel,
      canAsk,
      fileDrag,
      dropRect,
      activePath,
      viewerMode,
    ]
  );

  // ── where it goes: the window, and the canvas frame the artboard's rect is measured in ──
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const frameLeft = useCallback(() => {
    const f = activePath ? iframesRef?.current?.get(activePath) : null;
    return f?.getBoundingClientRect?.().left ?? 0;
  }, [activePath, iframesRef]);

  if (!mounted) return null;
  const placement =
    view.size === 'full'
      ? placeFull({ viewportW: vw })
      : placeCompact({
          cx: view.target ? anchorCentre({ left: frameLeft() }, view.target.rect) : vw / 2,
          viewportW: vw,
        });
  return (
    <div className="tl-host">
      <TimelineIsland
        size={view.size}
        placement={placement}
        artboardId={targetId}
        leaving={leaving}
      >
        <TimelineIslandContext.Provider value={ctx}>{children}</TimelineIslandContext.Provider>
      </TimelineIsland>
    </div>
  );
}
