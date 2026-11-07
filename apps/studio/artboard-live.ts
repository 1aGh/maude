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
 *
 *             2.0.7 — the mount RING (Michal: "what is in the viewport is right, what is far away is released").
 *             In `sleep` an artboard's children mount when it comes into the prefetch ring (`NEAR_MARGIN`) and
 *             are RELEASED again once it has been outside the larger keep ring (`KEEP_MARGIN` — the hysteresis)
 *             for `RELEASE_AFTER_MS`, so a long canvas never holds every artboard's DOM at once (a 45k-node
 *             canvas froze WebKit for seconds per frame even with three artboards on screen). Mounting is
 *             bounded by a DOM budget (`MOUNT_NODE_BUDGET`, measured per artboard): on-screen artboards first,
 *             nearest the centre first, then the prefetch ring; one that does not fit stays a same-size
 *             placeholder. Mounting goes on DURING a gesture (on-screen artboards only, one per frame; the React
 *             side renders it as an interruptible transition), so a pan never waits for the canvas to load.
 *             Live wakes (WebGL, video) still wait for the settle.
 *
 *             2.0.7 — a LIGHT canvas has no ring (decision `v2-207-light-canvas-mounts-all`): when the whole canvas's
 *             estimated element count fits the budget (`isLight`), every artboard mounts — far ones too, through the
 *             same queue, never mid-gesture — and none is released, as in 1.x: no churn and no stand-in blocks. The
 *             estimate follows the weights as artboards mount, so a canvas that grows past the budget falls back to
 *             the ring (its far artboards are released after their grace, at a settle). Live wakes and a video
 *             artboard's media still follow the ring, as on any canvas.
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
/** The keep ring: a mounted artboard stays mounted while it is this near (hysteresis over `NEAR_MARGIN`). */
export const KEEP_MARGIN = '150%';
/** How long an artboard must have been outside the keep ring before its children are released (ms). */
export const RELEASE_AFTER_MS = 2500;
/**
 * How long a slot nobody subscribes to any more is kept (ms): an edit's soft reload remounts every gate, and the
 * new one must find its artboard still mounted (2.0.7 — a placeholder in between lost the shell's selection).
 */
export const RETIRE_AFTER_MS = 250;
/** The DOM budget of one canvas document: mounted artboards' element count stays about this (2.0.7). */
export const MOUNT_NODE_BUDGET = 12000;
/**
 * On-screen artboards mount past `MOUNT_NODE_BUDGET` up to this many elements (2.0.7): the budget bounds what is
 * off screen; this only stops a fit-all of a huge canvas, whose tiny artboards keep their still pictures.
 */
export const ON_SCREEN_NODE_CEILING = 30000;
/** The weight (elements) of an artboard nobody has measured yet, until one of the canvas has been. */
export const DEFAULT_WEIGHT = 400;
/** After a frame longer than this (ms) the next frame mounts one artboard, not `WAKE_PER_FRAME`. */
export const SLOW_FRAME_MS = 34;
/** Mid-gesture, at most one first mount per this many ms (a WebKit mount lays out and paints at once). */
export const GESTURE_MOUNT_GAP_MS = 350;
/**
 * More artboards than this on screen and WebKit drops their per-artboard compositing layers: it rasterizes each
 * layer at full size whatever the world's scale (40 on screen at 8 % = seconds per frame). An 18-board
 * moodboard keeps them (they are why its fit-all zoom is smooth — RCA issue-canvas-pan-zoom-jank-large-moodboard).
 */
export const LAYER_MAX_VISIBLE = 24;
/**
 * A light canvas mounts every artboard and keeps it (2.0.7, decision `v2-207-light-canvas-mounts-all`): when the
 * canvas's estimated element count — the measured artboards plus their average for each one not measured yet — fits
 * `MOUNT_NODE_BUDGET`. The estimate is trusted once this many artboards are measured (or all of a smaller canvas);
 * before that the ring decides, and `DEFAULT_WEIGHT` is never an estimate.
 */
export const LIGHT_MIN_MEASURED = 4;

/**
 * `off`   — every artboard live, every child mounted (captures, exports, headless, tests): the pre-2.0.5 behaviour.
 * `sleep` — the studio default: offscreen / overview artboards sleep, their DOM stays mounted.
 * `light` — "Show visible artboards only" after a crash: an artboard's children mount only while it is live
 *           (near the viewport and the canvas not in its overview).
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
  /** Its children may be mounted (always true in `sleep`/`off` once seen; follows `live` in `light`). */
  seen: boolean;
  /**
   * Its media may load (a `<video>`'s src, a Player). Equal to `seen`, except on an eager artboard: that one is
   * mounted wherever it is so its comp registers, but its media follows the ring as a lazy artboard's children
   * would — near or on screen, kept inside the keep ring, released after the grace (2.0.7).
   */
  media: boolean;
}

interface Slot {
  near: boolean;
  visible: boolean;
  /** Inside the keep ring (starts true: an artboard nobody has reported on is not far). */
  keep: boolean;
  /** When it left the keep ring (ms), or 0. */
  farSince: number;
  /** Distance of its centre to the viewport centre (px, the near observer's last word). */
  dist: number;
  /** Measured element count of its mounted children, or 0. */
  weight: number;
  /** Never released (the active artboard — a selection or an edit lives in its DOM). */
  pinned: boolean;
  /**
   * Always mounted in `sleep`, wherever it is (a video artboard: its comp registers itself only while mounted, and
   * the link glyph, the Timeline's shared count and Present's format switch read those registrations).
   */
  eager: boolean;
  /**
   * Mounted for the stills' warm-up (2.0.7, artboard-still-warmup.ts): far away, asleep, within the DOM budget, until
   * its still is drawn. Never a prefetch past the budget, never mid-gesture (the drain's own rules).
   */
  warm: boolean;
  admitted: boolean;
  live: boolean;
  /** Its media may load: `admitted`, except on an eager artboard, where it is the ring's own answer. */
  media: boolean;
  /** The last state handed out — one object per change, so React's external store sees a stable snapshot. */
  view: ArtboardLiveState;
  subs: Set<(s: ArtboardLiveState) => void>;
}

const ASLEEP: ArtboardLiveState = Object.freeze({ live: false, seen: false, media: false });

const ALL_LIVE: ArtboardLiveState = Object.freeze({ live: true, seen: true, media: true });

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
  private readonly now: () => number;
  private readonly later: (fn: () => void, ms: number) => void;
  private sweepAt = 0;
  private lastDrainAt = 0;
  private lastGestureMountAt = Number.NEGATIVE_INFINITY;
  private lastAnyMountAt = Number.NEGATIVE_INFINITY;
  /** First mounts made during the current gesture (2.0.7: the settle frees what they took past the budget). */
  private gestureMounts = 0;
  /** The canvas fits the budget whole (`isLight`): every artboard mounted and kept. Kept current by `recompute`. */
  private light = false;
  readonly budget: number;
  readonly ceiling: number;

  constructor(
    mode: LiveMode,
    schedule: (fn: () => void) => void,
    opts: {
      now?: () => number;
      later?: (fn: () => void, ms: number) => void;
      budget?: number;
      ceiling?: number;
    } = {}
  ) {
    this.mode = mode;
    this.schedule = schedule;
    this.now =
      opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.later = opts.later ?? ((fn, ms) => void setTimeout(fn, ms));
    this.budget = opts.budget ?? MOUNT_NODE_BUDGET;
    this.ceiling = opts.ceiling ?? ON_SCREEN_NODE_CEILING;
  }

  private mayWait: (id: string) => boolean = () => false;

  /**
   * 2.0.7 — which on-screen artboards may wait for the settle to mount (the gate: under the overview cut, where
   * the placeholder shows its colour or its kept still and a mount would show nothing more mid-gesture). The
   * rest mount mid-gesture as before: a placeholder over the cut is a block the user sees.
   */
  setMayWait(fn: (id: string) => boolean): void {
    this.mayWait = fn;
  }

  /** The active artboard and a video one never wait (neither is ever a still). */
  private waits(id: string, s: Slot): boolean {
    return !s.pinned && !s.eager && this.mayWait(id);
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

  private settleListeners = new Set<() => void>();

  /** A gesture settled. */
  onSettle(fn: () => void): () => void {
    this.settleListeners.add(fn);
    return () => this.settleListeners.delete(fn);
  }

  subscribe(id: string, fn: (s: ArtboardLiveState) => void): () => void {
    const s = this.slot(id);
    s.subs.add(fn);
    return () => {
      s.subs.delete(fn);
      if (s.subs.size > 0) return;
      // Not dropped at once: an edit soft-reloads the canvas and remounts every gate in ONE commit (old cleanup,
      // then the new subscribe). The new gate must find the slot mounted, or its artboard falls back to a
      // placeholder just as the shell reselects — the 2.0.7 video regression. Nobody back within the grace: gone.
      this.later(() => {
        if (s.subs.size > 0 || this.slots.get(id) !== s) return;
        this.slots.delete(id);
        this.pending.delete(id);
        this.recompute();
      }, RETIRE_AFTER_MS);
    };
  }

  /**
   * The gate stopped observing its article (an unmount, or the old gate of a remount). Clears what the observers
   * said — unless another gate holds the id now (the remount: its own observers report on its new article).
   * Never creates a slot.
   */
  unobserve(id: string): void {
    const s = this.slots.get(id);
    if (!s || s.subs.size > 0) return;
    if (!s.near && !s.visible) return;
    s.near = false;
    s.visible = false;
    this.recompute();
  }

  setNear(id: string, near: boolean, dist?: number): void {
    const s = this.slot(id);
    if (dist !== undefined && Number.isFinite(dist)) s.dist = dist;
    if (s.near === near) return;
    s.near = near;
    // near is inside the keep ring by definition (the two observers can report in either order)
    if (near) this.setKeepState(s, true);
    this.recompute();
  }

  /** The keep ring (`KEEP_MARGIN`): outside it for `RELEASE_AFTER_MS`, a mounted artboard is released. */
  setKeep(id: string, keep: boolean): void {
    const s = this.slot(id);
    const k = keep || s.near;
    if (s.keep === k) return;
    this.setKeepState(s, k);
    this.recompute();
  }

  /** The active artboard is never released nor pushed out of the budget (its selection lives in its DOM). */
  setPinned(id: string, pinned: boolean): void {
    const s = this.slot(id);
    if (s.pinned === pinned) return;
    s.pinned = pinned;
    this.recompute();
  }

  /** A video artboard: mounted wherever it is, past the budget, never released nor pushed out (`sleep` only). */
  setEager(id: string, eager: boolean): void {
    const s = this.slot(id);
    if (s.eager === eager) return;
    s.eager = eager;
    this.recompute();
  }

  /**
   * The stills' warm-up mounts a far artboard (`on`) and releases it once its still is drawn. The release is at once
   * (not the keep ring's grace) unless the artboard came near, on screen, or is pinned / eager meanwhile.
   */
  setWarm(id: string, on: boolean): void {
    const s = this.slots.get(id);
    if (!s || s.warm === on) return;
    s.warm = on;
    if (on) {
      this.recompute();
      return;
    }
    const stays = s.near || s.visible || s.pinned || s.eager || this.forceAll > 0;
    if (s.admitted && !stays) {
      s.admitted = false;
      s.live = false;
      s.media = false;
      this.pending.delete(id);
      this.notify(id, s);
      this.emit();
    } else if (!s.admitted) this.pending.delete(id);
    this.kick();
  }

  /** Is this artboard's warm mount done (its children mounted)? */
  isMounted(id: string): boolean {
    return !!this.slots.get(id)?.admitted;
  }

  /**
   * Artboards the warm-up may mount: a gate holds them, not mounted, not on screen nor near, not pinned nor eager (a
   * video keeps its own media rule), and their first mount fits the DOM budget now. Nearest the viewport first.
   */
  warmCandidates(): Array<{ id: string; dist: number; fits: boolean }> {
    if (this.mode !== 'sleep' || this.forceAll > 0) return [];
    const mounted = this.mountedWeight();
    const out: Array<{ id: string; dist: number; fits: boolean }> = [];
    for (const [id, s] of this.slots) {
      if (s.admitted || s.warm || s.visible || s.near || s.pinned || s.eager || s.subs.size === 0)
        continue;
      out.push({ id, dist: s.dist, fits: mounted + this.weightOf(s) <= this.budget });
    }
    return out;
  }

  /** When the queue last mounted or woke an artboard (ms) — the warm-up waits for the ring's own mounts. */
  lastMountAt(): number {
    return this.lastAnyMountAt;
  }

  /** The element count an artboard's children came to once mounted (the DOM budget's unit). */
  setWeight(id: string, nodes: number): void {
    const s = this.slots.get(id);
    if (!s || !Number.isFinite(nodes) || nodes < 0) return;
    s.weight = Math.max(1, Math.round(nodes));
    if (this.computeLight() !== this.light) this.recompute();
  }

  /** The whole canvas fits the DOM budget: every artboard is mounted and kept (2.0.7, `LIGHT_MIN_MEASURED`). */
  isLight(): boolean {
    return this.light;
  }

  /** The estimated element count of the whole canvas (every artboard a gate holds), or -1 before it is known. */
  estimatedWeight(): number {
    let held = 0;
    let measured = 0;
    let sum = 0;
    for (const s of this.slots.values()) {
      if (s.subs.size === 0) continue;
      held += 1;
      if (s.weight) {
        measured += 1;
        sum += s.weight;
      }
    }
    if (held === 0 || measured < Math.min(LIGHT_MIN_MEASURED, held)) return -1;
    return sum + ((held - measured) * sum) / measured;
  }

  private computeLight(): boolean {
    if (this.mode !== 'sleep') return false;
    const est = this.estimatedWeight();
    return est >= 0 && est <= this.budget;
  }

  /** Elements mounted now (measured, or estimated for one not measured yet). */
  mountedWeight(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.admitted) n += this.weightOf(s);
    return n;
  }

  /** How many artboards have their children mounted now. */
  mountedCount(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.admitted) n += 1;
    return n;
  }

  private weightOf(s: Slot): number {
    if (s.weight) return s.weight;
    let sum = 0;
    let k = 0;
    for (const o of this.slots.values())
      if (o.weight) {
        sum += o.weight;
        k += 1;
      }
    return k ? sum / k : DEFAULT_WEIGHT;
  }

  private setKeepState(s: Slot, keep: boolean): void {
    if (s.keep === keep) return;
    s.keep = keep;
    s.farSince = keep ? 0 : this.now();
    if (!keep) this.sweepLater(RELEASE_AFTER_MS);
  }

  private sweepLater(ms: number): void {
    const at = this.now() + ms;
    if (this.sweepAt && this.sweepAt <= at) return;
    this.sweepAt = at;
    this.later(() => {
      this.sweepAt = 0;
      this.recompute();
      // the ones whose grace has not run out yet (they left later) get their own sweep
      let next = Number.POSITIVE_INFINITY;
      // (one whose grace ran out and is still held waits for what holds it — a settle, an unpin, a light canvas
      // growing — and each of those recomputes: rescheduling it here was a sweep every 16 ms meanwhile)
      const now = this.now();
      for (const s of this.slots.values())
        if ((s.admitted || s.media) && !s.keep && s.farSince && s.farSince + RELEASE_AFTER_MS > now)
          next = Math.min(next, s.farSince + RELEASE_AFTER_MS);
      if (Number.isFinite(next)) this.sweepLater(Math.max(16, next - this.now()));
    }, ms);
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
    // the settle wakes what waited, and lets the releases that waited for it happen
    if (!on) {
      this.recompute();
      // 2.0.7 — a mount mid-gesture pushed nothing out (no unmount while the camera moves): what it took past
      // the budget is freed now, from what is off screen, the farthest first
      if (this.gestureMounts > 0 && this.mode === 'sleep' && this.forceAll === 0) {
        const over = this.mountedWeight() - this.budget;
        if (over > 0 && this.evictFor(over) > 0) this.emit();
      }
      this.gestureMounts = 0;
      for (const fn of this.settleListeners) fn();
    } else this.kick(); // on-screen artboards keep mounting during the gesture
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

  /** The canvas is in its overview right now (zoomed out, or too many artboards on screen). */
  overview(): boolean {
    return this.mode !== 'off' && inOverview(this.zoom, this.visibleCount());
  }

  /**
   * So many artboards on screen that a compositing layer each costs more than it saves (WebKit, 2.0.7). Never on a
   * light canvas (`isLight`): its layers are cheap, and they are what keeps its fit-all zoom smooth.
   */
  crowded(): boolean {
    return this.mode !== 'off' && !this.light && this.visibleCount() > LAYER_MAX_VISIBLE;
  }

  /** A gesture is in flight (the gate defers its picture-taking past it). */
  isInteracting(): boolean {
    return this.interacting;
  }

  /** On screen, and the elements its children came to (measured, or the estimate) — the stills' heavy signal. */
  slotInfo(id: string): { visible: boolean; weight: number } | null {
    const s = this.slots.get(id);
    if (!s) return null;
    return { visible: s.visible, weight: s.admitted ? this.weightOf(s) : 0 };
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
        keep: true,
        farSince: 0,
        dist: Number.POSITIVE_INFINITY,
        weight: 0,
        pinned: false,
        eager: false,
        warm: false,
        admitted: false,
        live: false,
        media: false,
        view: ASLEEP,
        subs: new Set(),
      };
      this.slots.set(id, s);
    }
    return s;
  }

  private target(s: Slot): { live: boolean; admitted: boolean; media: boolean } {
    const force = this.forceAll > 0;
    const live = decideLive({
      near: s.near,
      zoom: this.zoom,
      visibleCount: this.visibleCount(),
      forceAll: force,
    });
    // `sleep` mounts what came near and keeps it. `light` (after a crash) mounts only what is LIVE — near and
    // not in the overview — so a zoomed-out view of 60 scenes mounts none of them, and unmounts what leaves.
    // `sleep` (2.0.7): wanted while in the prefetch ring or on screen, KEPT while inside the keep ring, and
    // released only after `RELEASE_AFTER_MS` outside it (the sweep). Whether a first mount fits the DOM budget
    // is the queue's call (drain).
    // The ring's answer is the same for an eager artboard (a video), but there it decides its MEDIA only: the
    // artboard itself is mounted wherever it is (its comp registers), its Player and <video> load in the ring.
    // On a light canvas (2.0.7) every artboard a gate holds is mounted and kept, like an eager one: the ring then
    // decides its media only (a non-video artboard has none — its children are mounted, asleep).
    const kept = this.mode === 'sleep' && (s.eager || (this.light && s.subs.size > 0));
    const held = kept ? s.media : s.admitted;
    const ring =
      this.mode === 'light'
        ? live
        : force ||
          s.near ||
          s.visible ||
          (this.mode === 'sleep' && s.warm) ||
          (this.mode === 'sleep' && held && !this.releasable(s, held));
    const admitted = ring || kept;
    return { live, admitted, media: ring };
  }

  /** Mounted (`held`), outside the keep ring for long enough, not on screen, and no gesture in flight. */
  private releasable(s: Slot, held: boolean): boolean {
    return (
      held &&
      !s.pinned &&
      !s.keep &&
      !s.visible &&
      !s.near &&
      s.farSince > 0 &&
      this.now() - s.farSince >= RELEASE_AFTER_MS &&
      !this.interacting
    );
  }

  private recompute(): void {
    if (this.mode === 'off') return;
    const force = this.forceAll > 0;
    // 2.0.7 — nothing goes down mid-gesture (no sleep, no media release, no unmount): the frame freeze already
    // stops the artboards' own work while the camera moves, and each change is a render. The settle applies them.
    const hold = this.interacting && !force;
    this.light = this.computeLight();
    let changed = false;
    for (const [id, s] of this.slots) {
      const t = this.target(s);
      const goesDown = (s.live && !t.live) || (s.admitted && !t.admitted) || (s.media && !t.media);
      const goesUp = (!s.live && t.live) || (!s.admitted && t.admitted) || (!s.media && t.media);
      if (hold && goesDown) {
        if (goesUp) this.pending.add(id);
      } else if (goesDown && !goesUp) {
        s.live = t.live;
        s.admitted = t.admitted;
        s.media = t.media;
        this.pending.delete(id);
        this.notify(id, s);
        changed = true;
      } else if (goesUp) {
        if (force) {
          s.live = t.live;
          s.admitted = t.admitted;
          s.media = t.media;
          this.pending.delete(id);
          this.notify(id, s);
          changed = true;
        } else {
          // The part that goes down applies now; the part that goes up waits for the queue.
          if ((s.live && !t.live) || (s.media && !t.media)) {
            if (!t.live) s.live = false;
            if (!t.media) s.media = false;
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
    if (this.scheduled || this.pending.size === 0) return;
    if (this.interacting && !this.hasVisibleMount()) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.drain();
    });
  }

  private hasVisibleMount(): boolean {
    for (const id of this.pending) {
      const s = this.slots.get(id);
      if (!s?.visible || this.waits(id, s)) continue;
      const t = this.target(s);
      if ((!s.admitted && t.admitted) || (!s.media && t.media)) return true;
    }
    return false;
  }

  /**
   * One frame's worth of wakes and first mounts. Exposed for tests (the browser drains on rAF).
   *
   * Order: on screen before the prefetch ring, nearest the viewport centre first. A first mount must fit the
   * DOM budget; an on-screen one may push out mounted artboards that are not on screen (outside the prefetch
   * ring first, the farthest first); a prefetch never pushes anything out. During a gesture only on-screen
   * artboards mount (asleep), one per frame, and nothing wakes. After a slow frame, one per frame.
   */
  drain(): void {
    const t = this.now();
    const slow = this.lastDrainAt > 0 && t - this.lastDrainAt > SLOW_FRAME_MS;
    this.lastDrainAt = t;
    // mid-gesture: one first mount, after a fast frame, and not sooner than GESTURE_MOUNT_GAP_MS after the last
    const gestureHold =
      this.interacting && (slow || t - this.lastGestureMountAt < GESTURE_MOUNT_GAP_MS);
    const cap = gestureHold ? 0 : this.interacting || slow ? 1 : WAKE_PER_FRAME;
    const order: Array<{ id: string; s: Slot }> = [];
    for (const id of this.pending) {
      const s = this.slots.get(id);
      if (s) order.push({ id, s });
      else this.pending.delete(id);
    }
    order.sort((a, b) => Number(b.s.visible) - Number(a.s.visible) || a.s.dist - b.s.dist);
    let n = 0;
    let changed = false;
    let mounted = this.mountedWeight();
    for (const { id, s } of order) {
      if (n >= cap) break;
      const tg = this.target(s);
      if (tg.live === s.live && tg.admitted === s.admitted && tg.media === s.media) {
        this.pending.delete(id);
        continue;
      }
      // an eager artboard's media coming up is a mount too (its Player): paced the same, outside the budget
      const mounts = (tg.admitted && !s.admitted) || (tg.media && !s.media);
      // mid-gesture only what is on screen and would show a block mounts (2.0.7: under the cut it waits)
      if (this.interacting && !(mounts && s.visible && !this.waits(id, s))) continue; // waits for the settle
      if (mounts && this.forceAll === 0 && this.mode === 'sleep' && !s.eager) {
        const w = this.weightOf(s);
        if (mounted > 0 && mounted + w > this.budget) {
          if (s.visible && !this.interacting) {
            const freed = this.evictFor(mounted + w - this.budget);
            if (freed) changed = true;
            mounted -= freed;
          }
          // What is ON SCREEN mounts past the budget (up to the ceiling) once nothing off screen is left to push
          // out: the budget bounds what you do not see. At a settled view of the mascot canvas 41 on-screen
          // artboards weighed 17k and three of them stayed placeholders for good.
          const limit = s.visible ? Math.max(this.budget, this.ceiling) : this.budget;
          if (mounted > 0 && mounted + w > limit) continue; // a placeholder until there is room
        }
        mounted += w;
      }
      // mid-gesture a mount only raises (nothing goes down until the settle)
      s.admitted = this.interacting ? s.admitted || tg.admitted : tg.admitted;
      s.media = this.interacting ? s.media || tg.media : tg.media;
      if (this.interacting) {
        // a first mount mid-gesture comes up asleep (`live` stays what it was); its wake waits for the settle
        this.lastGestureMountAt = t;
        this.gestureMounts += 1;
      } else {
        s.live = tg.live;
        this.pending.delete(id);
      }
      this.notify(id, s);
      this.lastAnyMountAt = t;
      changed = true;
      n += 1;
    }
    if (changed) this.emit();
    this.kick();
  }

  /** Release mounted artboards that are not on screen to free `need` elements; returns what it freed. */
  private evictFor(need: number): number {
    const victims = [...this.slots.values()]
      .filter((v) => v.admitted && !v.visible && !v.pinned && !v.eager)
      .sort((a, b) => Number(a.near) - Number(b.near) || b.dist - a.dist);
    let freed = 0;
    for (const v of victims) {
      if (freed >= need) break;
      freed += this.weightOf(v);
      v.admitted = false;
      v.live = false;
      v.media = false;
      this.notify('', v);
    }
    return freed;
  }

  private notify(_id: string, s: Slot): void {
    if (s.view.live === s.live && s.view.seen === s.admitted && s.view.media === s.media) return;
    const c = this.churn;
    if (s.admitted !== s.view.seen) {
      if (s.admitted) c.mounts += 1;
      else c.releases += 1;
    }
    if (this.interacting) {
      if (s.admitted && !s.view.seen) c.gestureMounts += 1;
      if ((!s.live && s.view.live) || (!s.admitted && s.view.seen) || (!s.media && s.view.media))
        c.gestureDowns += 1;
    }
    s.view = Object.freeze({ live: s.live, seen: s.admitted, media: s.media });
    for (const fn of s.subs) fn(s.view);
  }

  private churn = { mounts: 0, releases: 0, gestureMounts: 0, gestureDowns: 0 };

  /** Ring churn since the open: mounts, releases, and what changed mid-gesture (2.0.7 — the measurement). */
  churnStats(): { mounts: number; releases: number; gestureMounts: number; gestureDowns: number } {
    return { ...this.churn };
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
