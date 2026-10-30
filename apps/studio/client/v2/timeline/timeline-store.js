// client/v2/timeline/timeline-store.js — S7.7: when the timeline island is up, and over which video.
//
// The rules (07 · ve-deselect, "the timeline, in five rules"):
//   · select a video artboard → the island slides out of it; another video takes it over, and each video
//     keeps its own playhead;
//   · select anything else, or esc → it slides back (esc clears the canvas selection, which says so here) (compact or full, the same);
//   · ⇧⌘T → shows / hides it; shown that way it stays open whatever you select (it shows the last video);
//   · Expand / Compact → the island's size (no key);
//   · ⌘\ hides it with the other panels — that is the shell's `panelsHidden`, not this store.
//
// A pure state machine with a tiny subscribe seam, so the rules are a unit test and the island is a view of
// `get()`. The canvas names the selection (`artboard-anchor`, applied through `anchor()`); nothing here reads
// the DOM.

import { useSyncExternalStore } from 'react';

const MAX_PLAYHEADS = 200;

/** @typedef {{ artboardId: string, label: string, rect: { x: number, y: number, w: number, h: number } }} Followed */

const initial = () => ({
  /** the video artboard that is selected right now (and its rect in the canvas frame), or null */
  follow: /** @type {Followed|null} */ (null),
  /** the last video that was followed — what a kept-open island shows when nothing is selected */
  last: /** @type {Followed|null} */ (null),
  keepOpen: false,
  /** hidden by esc / ⇧⌘T / the close button until the selection changes */
  dismissed: false,
  size: /** @type {'compact'|'full'} */ ('compact'),
});

/**
 * What the island draws.
 * @returns {{ visible: boolean, size: 'compact'|'full', target: Followed|null, kept: boolean }}
 */
export function viewOf(s) {
  const visible = !s.dismissed && (s.follow !== null || s.keepOpen);
  return {
    visible,
    size: s.size,
    target: s.follow ?? s.last,
    kept: visible && s.keepOpen,
  };
}

export function createTimelineStore() {
  let s = initial();
  /** artboard id → its playhead frame; not part of the view, so remembering one never re-renders the island */
  let playheads = new Map();
  let cached = null;
  let cachedFor = null;
  const subs = new Set();
  const set = (next) => {
    s = next;
    for (const fn of subs) fn();
  };
  return {
    /** The island's current view (stable between changes — safe for useSyncExternalStore). */
    get() {
      if (cachedFor !== s) {
        cachedFor = s;
        cached = viewOf(s);
      }
      return cached;
    },
    /** The raw state, for tests. */
    state: () => s,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    /**
     * The canvas's `artboard-anchor`: which whole artboard is selected, what kind it is, where it is.
     * Anything but a video (or nothing) sends the island back.
     */
    anchor(m) {
      const id = typeof m?.artboardId === 'string' && m.artboardId ? m.artboardId : null;
      if (id && m.kind === 'video' && m.rect) {
        const follow = { artboardId: id, label: String(m.label || id), rect: m.rect };
        // the same video panned or zoomed keeps what esc / ⇧⌘T decided; a different one is a new summons
        const dismissed = s.follow?.artboardId === id ? s.dismissed : false;
        set({ ...s, follow, last: follow, dismissed });
        return;
      }
      if (s.follow === null && !s.dismissed) return;
      set({ ...s, follow: null, dismissed: false });
    },

    /** ⇧⌘T: keep it open / hide it. */
    toggleKeep() {
      if (s.keepOpen) set({ ...s, keepOpen: false, dismissed: true });
      else set({ ...s, keepOpen: true, dismissed: false });
    },
    /** A legacy opener (the artboard menu's "Open Timeline", "New video…") asked for the timeline. */
    open() {
      if (s.keepOpen && !s.dismissed) return;
      set({ ...s, keepOpen: true, dismissed: false });
    },
    /** A legacy closer (the × in the header, the old toggle) asked for it to go. */
    close() {
      if (!s.keepOpen && s.dismissed) return;
      set({ ...s, keepOpen: false, dismissed: true });
    },
    expand() {
      if (s.size !== 'full') set({ ...s, size: 'full' });
    },
    compact() {
      if (s.size !== 'compact') set({ ...s, size: 'compact' });
    },
    toggleSize() {
      set({ ...s, size: s.size === 'full' ? 'compact' : 'full' });
    },

    /** Each video keeps its own playhead. */
    remember(artboardId, frame) {
      if (typeof artboardId !== 'string' || !Number.isFinite(frame)) return;
      playheads.delete(artboardId);
      playheads.set(artboardId, frame);
      if (playheads.size > MAX_PLAYHEADS) playheads.delete(playheads.keys().next().value);
    },
    frameFor: (artboardId) => playheads.get(artboardId),

    /** The open canvas changed: its videos are not these videos. Keep-open and size are the person's. */
    reset() {
      playheads = new Map();
      set({ ...initial(), keepOpen: s.keepOpen, size: s.size });
    },
  };
}

/** The shell's one store. */
export const timelineStore = createTimelineStore();

/** The island's view; re-renders when it changes. */
export function useTimelineView(store = timelineStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Is the timeline kept open (⇧⌘T)? The menu's check mark and the palette's state. */
export function useTimelineKept(store = timelineStore) {
  return useSyncExternalStore(
    store.subscribe,
    () => store.state().keepOpen,
    () => store.state().keepOpen
  );
}
