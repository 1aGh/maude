// client/v2/timeline/comment-strip-host.jsx — Round 11 (10 · co-comment-video): the shell's mount for the
// Preview comment strip. Preview selects no video, so no timeline island follows one; this reads what the shell
// already has — the active canvas's threads, the videos the canvas announced (`timeline-comps`) and the
// playhead the Player mirrors back — and puts the strip at the foot of the free canvas, where the island sits in
// Edit. Edit keeps its own (Timeline.jsx); this one draws in Preview only and hides with the other panels.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { measureShellInsets } from '../shell/occlusion-insets.js';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { placeCompact } from './anchor.js';
import { CommentStrip } from './comment-strip.jsx';
import { commentStrip } from './comment-strip-model.js';
import { useBoard } from './marks.jsx';

const STRIP_W = 600;
const modeNow = () => shellMode.get().mode;

export function CommentStripHost() {
  const {
    shellCore: {
      activeComps,
      activePath,
      commentsByFile,
      iframesRef,
      postToActiveCanvas,
      setTimelineFrame,
      timelineCompId,
      timelineFrame,
    },
  } = useShellStore();
  const mode = useSyncExternalStore(shellMode.subscribe, modeNow, modeNow);
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const comments = canvasOpen ? commentsByFile?.[activePath] : null;
  // p8-r11-15 (an-video): the notes pinned to a video live on the canvas's annotation board — the same read the
  // Layers list and the Edit timeline's ruler marks make; only read while Preview draws the strip.
  const board = useBoard(mode === 'preview' && canvasOpen ? activePath : null);
  const strip = useMemo(
    () =>
      mode === 'preview' && canvasOpen
        ? commentStrip({
            comments,
            board,
            comps: activeComps,
            compId: timelineCompId,
            frame: timelineFrame,
          })
        : null,
    [mode, canvasOpen, comments, board, activeComps, timelineCompId, timelineFrame]
  );

  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const onSeek = useCallback(
    (_id, seconds) => {
      const comp = (activeComps || []).find((c) => c.artboardId === strip?.artboardId);
      if (!comp) return;
      const frame = Math.max(
        0,
        Math.min(comp.durationInFrames - 1, Math.round(seconds * (comp.fps || 30)))
      );
      setTimelineFrame?.(frame);
      postToActiveCanvas?.({ dgn: 'timeline-seek', frame, id: comp.id });
    },
    [activeComps, strip?.artboardId, postToActiveCanvas, setTimelineFrame]
  );

  if (!strip) return null;
  // the free canvas, between the open panels (the same measure the timeline island takes)
  const f = iframesRef?.current?.get(activePath);
  const r = f?.getBoundingClientRect?.();
  const ins = r ? measureShellInsets(f, document, { presenting: false }) : null;
  const minX = r && ins ? r.left + ins.left : 0;
  const maxX = r && ins ? r.right - ins.right : vw;
  const placement = placeCompact({
    cx: (minX + maxX) / 2,
    viewportW: vw,
    width: STRIP_W,
    minX,
    maxX,
  });
  return (
    <div className="tl-host" data-testid="comment-strip-host">
      <CommentStrip strip={strip} placement={placement} onSeek={onSeek} />
    </div>
  );
}
