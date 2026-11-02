// client/v2/timeline/keys.js — S7.8: the shell handlers of the timeline's own keys (C26: timeline focus beats
// selection, tools and global). The registry (`actions/defs/timeline.ts`) decides WHICH key runs; these are
// what runs:
//   I / O   the loop band's ends at the playhead      (`timeline.loop-in` / `timeline.loop-out`)
//   —       clear the band                            (`timeline.loop-clear`, ⌘K and the ruler)
//   ← / →   one frame, ⇧ one second — and the time then shows the frame ("0:07 + 2 frames")
//   Space   play / pause with sound (canvas tap arrives as `space-tap`; both run `playToggle`)
// `d` is the deps object the shell hands every handler (`tlKeyRef`, `setTimelineFrame`, …); nothing here
// reads the DOM, so each handler is a function of its inputs.

import { loopAt, playbackStore } from './playhead.js';
import { playPlan, stepTarget } from './transport.js';

/** The comp the transport is on and its frame rate. */
const target = (d) => {
  const s = d.tlKeyRef.current;
  const fps = s.comps?.find?.((c) => c?.id === s.compId)?.fps || s.comps?.[0]?.fps || 30;
  return { s, fps, total: Math.max(1, s.total || 1) };
};

/** Play / pause the followed video in place, with sound. Shared by Space (shell focus) and `space-tap`. */
export function playToggle(d, store = playbackStore) {
  const { s, total } = target(d);
  if (!s.compId) return false;
  const plan = playPlan({
    playing: !!s.playing,
    muted: !!s.muted,
    loop: !!s.loop,
    compId: s.compId,
    frame: s.frame ?? 0,
    total,
    band: store.loopFor(s.compId),
  });
  if (plan.seekTo !== null) {
    d.setTimelineFrame(plan.seekTo);
    s.post({ dgn: 'timeline-seek', frame: plan.seekTo, id: s.compId });
  }
  d.setTimelinePlaying(plan.playing);
  for (const m of plan.messages) s.post(m);
  return true;
}

/** ← / → (⇧ = a second): move the playhead and say which frame it is on. */
export function stepPlayhead(d, event, store = playbackStore) {
  const { s, fps, total } = target(d);
  const dir = event.key === 'ArrowRight' ? 1 : -1;
  const next = stepTarget({ frame: s.frame ?? 0, dir, shift: !!event.shiftKey, fps, total });
  d.setTimelineFrame(next);
  d.setTimelinePlaying(false);
  s.post({ dgn: 'timeline-seek', frame: next, id: s.compId });
  store.markStep();
}

/** What the key handlers hand `loopAt`: the transport's comp, playhead and length. */
const atOf = (d) => {
  const { s, total } = target(d);
  return { compId: s.compId, frame: s.frame ?? 0, total };
};

export const TIMELINE_KEY_HANDLERS = {
  'timeline.loop-in': (d, { event: e }) => {
    e.preventDefault();
    loopAt('in', atOf(d));
  },
  'timeline.loop-out': (d, { event: e }) => {
    e.preventDefault();
    loopAt('out', atOf(d));
  },
  'timeline.loop-clear': (d, { event: e } = {}) => {
    e?.preventDefault?.();
    const { s } = target(d);
    if (s.compId) playbackStore.clearLoop(s.compId);
  },
};
