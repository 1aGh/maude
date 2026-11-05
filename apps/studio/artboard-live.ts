/**
 * @file       artboard-live.ts — 2.0.5: heavy canvases must not crash the tab
 * @scope      apps/studio/artboard-live.ts (React-free core; the React half is artboard-live-gate.tsx)
 * @purpose    Decides which artboards of an open canvas run LIVE. A canvas with 88 three.js scenes or 30
 *             artboards of decoding video ran every one of them at once, and WebKit killed the page.
 *
 *             An artboard is LIVE when it is near the viewport AND the canvas is not in its overview
 *             (zoomed out below `LIVE_MIN_ZOOM`, the annotation mosaic's own cut-over, or more than
 *             `LIVE_MAX_VISIBLE` artboards on screen at once). A sleeping artboard keeps its DOM and its
 *             size; what stops is its heavy content: WebGL contexts (lost, with a snapshot of the last
 *             frame), `<video>` (paused), CSS animations (paused), `VideoComp` players (paused) and anything
 *             a canvas gates on `useArtboardActive()`.
 *
 *             Artboards come back a few per frame (`WAKE_PER_FRAME`) and only once a gesture settles, so a
 *             pan never pays for re-starting a dozen scenes at once. The first mount of an artboard's
 *             children waits for the same queue in `light` mode (and for `useArtboardSeen()` consumers —
 *             the design-system board's specimens), so a canvas never builds what nobody looked at.
 *
 *             Captures render EVERYTHING: the mode is `off` for every headless/export render (top-level
 *             page, `?hide-chrome=1`, `?thumb-only=`), and the in-frame export (`export-capture`) wakes
 *             every artboard for the length of the capture (`forceAll`).
 */

import { LOD_ZOOM } from './annotations/ui/lod.tsx';

/** Below this (published) zoom the canvas is in its overview: nothing runs live. Same cut-over as the annotation mosaic. */
export const LIVE_MIN_ZOOM = LOD_ZOOM;
/** More artboards than this on screen at once is an overview too, whatever the zoom. */
export const LIVE_MAX_VISIBLE = 16;
/** At most this many WebGL contexts per canvas stay live — well under the browsers' hard limit (~16). */
export const WEBGL_LIVE_CAP = 8;
/** How far past the viewport an artboard still counts as near (IntersectionObserver rootMargin). */
export const NEAR_MARGIN = '50%';
/** How many artboards wake (or first mount) per animation frame. */
export const WAKE_PER_FRAME = 3;

/**
 * `off`   — every artboard live, every child mounted (captures, exports, headless, tests): the pre-2.0.5 behaviour.
 * `sleep` — the studio default: offscreen / overview artboards sleep, their DOM stays mounted.
 * `light` — "Show visible artboards only" after a crash: an artboard's children mount only while it is near.
 */
export type LiveMode = 'off' | 'sleep' | 'light';

/** The frame parameter that picks a mode explicitly (`?artboard-live=off|sleep|light`). */
export const LIVE_PARAM = 'artboard-live';

export function resolveLiveMode(env: { search: string; embedded: boolean }): LiveMode {
  const p = new URLSearchParams(env.search);
  // A capture — whoever asks for it — renders every artboard live. This wins over an explicit mode.
  if (p.get('hide-chrome') === '1' || p.has('thumb-only')) return 'off';
  const explicit = p.get(LIVE_PARAM);
  if (explicit === 'off' || explicit === 'sleep' || explicit === 'light') return explicit;
  // Only the studio frames a canvas. A top-level canvas page is a headless render (screenshot,
  // smoke, canvas-rects, perf without --studio) or someone opening the shell URL by hand: all live.
  return env.embedded ? 'sleep' : 'off';
}

/** The overview: zoomed out past the mosaic cut-over, or too many artboards on screen at once. */
export function inOverview(zoom: number, visibleCount: number): boolean {
  return (zoom > 0 && zoom < LIVE_MIN_ZOOM) || visibleCount > LIVE_MAX_VISIBLE;
}

/** Whether one artboard should be live. `forceAll` (a capture in progress) always wins. */
export function decideLive(s: {
  near: boolean;
  zoom: number;
  visibleCount: number;
  forceAll: boolean;
}): boolean {
  if (s.forceAll) return true;
  if (!s.near) return false;
  return !inOverview(s.zoom, s.visibleCount);
}

export interface ArtboardLiveState {
  /** Runs its heavy content. */
  live: boolean;
  /** Its children may be mounted (always true in `sleep`/`off` once seen; follows `near` in `light`). */
  seen: boolean;
}

interface Slot {
  near: boolean;
  visible: boolean;
  admitted: boolean;
  live: boolean;
  /** The last state handed out — one object per change, so React's external store sees a stable snapshot. */
  view: ArtboardLiveState;
  subs: Set<(s: ArtboardLiveState) => void>;
}

const ASLEEP: ArtboardLiveState = Object.freeze({ live: false, seen: false });

const ALL_LIVE: ArtboardLiveState = Object.freeze({ live: true, seen: true });

/**
 * One per canvas document. Fed by two IntersectionObservers (near / visible), the published zoom and the
 * gesture flag; artboards subscribe by id. Sleeping is immediate; waking goes through a queue drained
 * `WAKE_PER_FRAME` at a time on `schedule` (rAF in the browser), and holds while a gesture is in flight.
 */
export class LiveRegistry {
  readonly mode: LiveMode;
  private slots = new Map<string, Slot>();
  private zoom = 1;
  private interacting = false;
  private forceAll = 0;
  private pending = new Set<string>();
  private scheduled = false;
  private readonly schedule: (fn: () => void) => void;
  private listeners = new Set<() => void>();

  constructor(mode: LiveMode, schedule: (fn: () => void) => void) {
    this.mode = mode;
    this.schedule = schedule;
  }

  get(id: string): ArtboardLiveState {
    if (this.mode === 'off') return ALL_LIVE;
    return this.slots.get(id)?.view ?? ASLEEP;
  }

  isLive(id: string): boolean {
    return this.get(id).live;
  }

  /** Any change at all (the WebGL budget re-plans on it). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribe(id: string, fn: (s: ArtboardLiveState) => void): () => void {
    const s = this.slot(id);
    s.subs.add(fn);
    return () => {
      s.subs.delete(fn);
      if (s.subs.size === 0) {
        this.slots.delete(id);
        this.pending.delete(id);
        this.recompute();
      }
    };
  }

  setNear(id: string, near: boolean): void {
    const s = this.slot(id);
    if (s.near === near) return;
    s.near = near;
    this.recompute();
  }

  setVisible(id: string, visible: boolean): void {
    const s = this.slot(id);
    if (s.visible === visible) return;
    s.visible = visible;
    this.recompute();
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom) || zoom === this.zoom) return;
    this.zoom = zoom;
    this.recompute();
  }

  setInteracting(on: boolean): void {
    if (on === this.interacting) return;
    this.interacting = on;
    if (!on) this.kick();
  }

  /** A capture is running: everything live, NOW (no queue). Returns the release. */
  holdAllLive(): () => void {
    this.forceAll += 1;
    this.recompute();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.forceAll -= 1;
      this.recompute();
    };
  }

  visibleCount(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.visible) n += 1;
    return n;
  }

  private slot(id: string): Slot {
    let s = this.slots.get(id);
    if (!s) {
      s = {
        near: false,
        visible: false,
        admitted: false,
        live: false,
        view: ASLEEP,
        subs: new Set(),
      };
      this.slots.set(id, s);
    }
    return s;
  }

  private target(s: Slot): { live: boolean; admitted: boolean } {
    const force = this.forceAll > 0;
    const live = decideLive({
      near: s.near,
      zoom: this.zoom,
      visibleCount: this.visibleCount(),
      forceAll: force,
    });
    // `light` unmounts what left the viewport; `sleep` keeps whatever was once mounted.
    const admitted = force || s.near || (this.mode === 'sleep' && s.admitted);
    return { live, admitted };
  }

  private recompute(): void {
    if (this.mode === 'off') return;
    const force = this.forceAll > 0;
    let changed = false;
    for (const [id, s] of this.slots) {
      const t = this.target(s);
      const goesDown = (s.live && !t.live) || (s.admitted && !t.admitted);
      const goesUp = (!s.live && t.live) || (!s.admitted && t.admitted);
      if (goesDown && !goesUp) {
        s.live = t.live;
        s.admitted = t.admitted;
        this.pending.delete(id);
        this.notify(id, s);
        changed = true;
      } else if (goesUp) {
        if (force) {
          s.live = t.live;
          s.admitted = t.admitted;
          this.pending.delete(id);
          this.notify(id, s);
          changed = true;
        } else {
          // The part that goes down applies now; the part that goes up waits for the queue.
          if (s.live && !t.live) {
            s.live = false;
            this.notify(id, s);
            changed = true;
          }
          this.pending.add(id);
        }
      } else {
        this.pending.delete(id);
      }
    }
    if (changed) this.emit();
    this.kick();
  }

  private kick(): void {
    if (this.scheduled || this.pending.size === 0 || this.interacting) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.drain();
    });
  }

  /** One frame's worth of wakes. Exposed for tests (the browser drains on rAF). */
  drain(): void {
    if (this.interacting) return;
    let n = 0;
    let changed = false;
    for (const id of [...this.pending]) {
      if (n >= WAKE_PER_FRAME) break;
      this.pending.delete(id);
      const s = this.slots.get(id);
      if (!s) continue;
      const t = this.target(s);
      if (t.live === s.live && t.admitted === s.admitted) continue;
      s.live = t.live;
      s.admitted = t.admitted;
      this.notify(id, s);
      changed = true;
      n += 1;
    }
    if (changed) this.emit();
    this.kick();
  }

  private notify(_id: string, s: Slot): void {
    if (s.view.live === s.live && s.view.seen === s.admitted) return;
    s.view = Object.freeze({ live: s.live, seen: s.admitted });
    for (const fn of s.subs) fn(s.view);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

// ── WebGL budget ───────────────────────────────────────────────────────────────────────────────────

export interface GlCandidate {
  key: number;
  /** Its artboard is live (a canvas outside any artboard counts as live). */
  live: boolean;
  /** Distance of its centre to the viewport centre, in screen px. */
  distance: number;
  /** Last time it was kept live (ms) — the LRU tie-break. */
  lastLive: number;
  /** Currently lost by us. */
  lost: boolean;
}

/**
 * Which contexts to lose and which to restore: of the live artboards' canvases, the `cap` nearest the
 * viewport centre (ties: most recently live) stay; every other context is released.
 */
export function planWebgl(
  entries: readonly GlCandidate[],
  cap: number = WEBGL_LIVE_CAP
): { lose: number[]; restore: number[] } {
  const ranked = entries
    .filter((e) => e.live)
    .sort((a, b) => a.distance - b.distance || b.lastLive - a.lastLive);
  const keep = new Set(ranked.slice(0, Math.max(0, cap)).map((e) => e.key));
  const lose: number[] = [];
  const restore: number[] = [];
  for (const e of entries) {
    if (keep.has(e.key)) {
      if (e.lost) restore.push(e.key);
    } else if (!e.lost) lose.push(e.key);
  }
  return { lose, restore };
}
