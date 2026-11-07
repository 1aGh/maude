/**
 * @file       artboard-still.ts — 2.0.7: the overview level — small artboards show a still picture of themselves
 * @scope      apps/studio/artboard-still.ts (React-free; wired by artboard-live-gate.tsx, fed by canvas-lib.tsx)
 * @purpose    Michal (decision `v2-michal-207-overview-level`, replacing the gesture-only stills): below the overview
 *             cut — an artboard narrower than `STILL_MAX_SCREEN_PX` on screen — an artboard shows ONLY its still,
 *             settled or not. Live content appears only once the artboard is big enough on screen.
 *
 *             Why: WebKit repaints every on-screen artboard at each scale step, and paints each artboard handed back
 *             for the first time at the new zoom. On the mascot canvas at 10 % that is ~8.5k mounted SVG/HTML
 *             elements (zoom frames 300–900 ms in Safari). A still is one bitmap; a body whose children are out of
 *             the render tree (`display: none`, the box kept) costs neither style, layout nor paint.
 *
 *             ONE visual sequence per artboard (Michal: "the switch from still to live must be almost unnoticeable"):
 *             - `cover` — the own-colour stand-in, only while nothing better exists (never after a still or live);
 *             - `still` — the still picture; replaced only by a newer still (its content changed) or by live;
 *             - `paint` → `reveal` → live — the hand-over: the body is shown UNDER the still, and the still fades out
 *               only after the body has painted (two frames, its pictures decoded, the fonts ready).
 *             Zooming out past the cut swaps live back to the still at once (a still drawn from that very DOM).
 *             Never a still after cover→live, never cover after a still, never a blank frame: the stand-in sits
 *             outside the body, so neither its `content-visibility` nor an unpainted WebKit tile shows through.
 *
 *             Never a still: the active artboard and the one holding the selection (`pinned` — the shell works in
 *             their DOM, and a click on an overview artboard selects it, which brings it live), video artboards
 *             (`eager`, `v2-207-eager-video-media-follows-ring`).
 *
 *             The stills are drawn in this canvas document (`drawStill`, artboard-still-raster.ts) and kept in its
 *             memory (`StillCache`, keyed by artboard id + a content signature, bounded in bytes) — never on disk and
 *             never in the canvas origin's storage, which every canvas on that origin can read (C4's named gap).
 */

/**
 * The overview cut: an artboard narrower than this on screen (CSS px) shows its still. One constant (Michal first
 * said ~120; at his 10 % lane the mascot canvas's artboards are 132–160 px, so 120 changes nothing — see the contract).
 */
export const STILL_MAX_SCREEN_PX = 200;
/**
 * The hand-back when the zoom crosses the cut (nearest the centre first): after `STILL_HANDBACK_QUIET_FRAMES` quiet
 * frames, one artboard a frame, doubling up to `STILL_RESTORE_PER_FRAME` while frames stay under
 * `STILL_HANDBACK_SLOW_MS`, back to one after a slow one. Any gesture input pauses it.
 */
export const STILL_RESTORE_PER_FRAME = 4;
export const STILL_HANDBACK_QUIET_FRAMES = 2;
export const STILL_HANDBACK_SLOW_MS = 20;
/** After this many frames in a row waited, the hand-back goes on (one a frame) however slow the frames are. */
export const STILL_HANDBACK_MAX_WAIT_FRAMES = 3;
/** How long the still fades out over the painted live body (ms). Short: the eye takes it as one change. */
export const STILL_REVEAL_MS = 140;
/** Stills are drawn for artboards up to this many times the cut (a zoom-out reaches them next). */
export const STILL_PREPARE_FACTOR = 2;
/** How long the canvas must be still before a still is drawn (ms) — never during or right after a gesture. */
export const STILL_TAKE_DELAY_MS = 600;
/** Gap between two drawings (ms): one artboard at a time, so drawing never blocks a frame for long. */
export const STILL_TAKE_GAP_MS = 50;
/**
 * The stills kept in memory, in bytes of bitmap (w × h × 4). Past it the least recently used still that is not
 * standing in right now is dropped (an artboard released far away shows its own-colour placeholder again).
 */
export const STILL_CACHE_MAX_BYTES = 96 * 1024 * 1024;
/** The attribute the article carries while its stand-in shows (`cover` | `still` | `paint` | `reveal`). */
export const STILL_ATTR = 'data-dc-still';
/** The class of the stand-in element (a `<div>` appended to the article; the still `<canvas>` is its child). */
export const STILL_CLASS = 'dc-artboard-still';
/** The frame parameter that forces the feature on or off (`?artboard-still=on|off`, tests and A/B runs). */
export const STILL_PARAM = 'artboard-still';

export type StillMode = 'on' | 'off';
/** What one artboard shows. `live` = its body, nothing over it. */
export type StillView = 'live' | 'cover' | 'still' | 'paint' | 'reveal';

/** On in the studio on WebKit; `?artboard-still=` wins; off in captures (the live mode is `off` there). */
export function resolveStillMode(env: {
  search: string;
  webkit: boolean;
  liveMode: 'off' | 'sleep' | 'light';
}): StillMode {
  if (env.liveMode === 'off') return 'off';
  const p = new URLSearchParams(env.search).get(STILL_PARAM);
  if (p === 'on' || p === 'off') return p;
  return env.webkit ? 'on' : 'off';
}

/** Below the overview cut at this zoom (`width` in the artboard's own world px). */
export function inOverviewCut(width: number, zoom: number): boolean {
  return width > 0 && zoom > 0 && width * zoom < STILL_MAX_SCREEN_PX;
}

/**
 * Where one artboard is heading: its still (or the cover when it has none and has never shown live), or live.
 * Mid-gesture a live artboard that shrinks under the cut swaps to its still at once (cheaper than painting it), and
 * one that grows past it holds its still until the settle (a mid-gesture hand-back would paint it at once).
 */
export function targetView(s: {
  view: StillView;
  small: boolean;
  exempt: boolean;
  hasStill: boolean;
  gesture: boolean;
}): StillView {
  const standing = s.view === 'cover' || s.view === 'still';
  if (s.exempt) return 'live';
  if (s.gesture) {
    if (s.small && s.hasStill && !standing) return 'still';
    return s.view === 'paint' || s.view === 'reveal' ? 'live' : standing ? s.view : 'live';
  }
  if (!s.small) return 'live';
  if (s.hasStill) return 'still';
  // no still yet: what is already live stays live until its still exists (live → still is then the one change);
  // what has shown nothing better than the cover keeps it
  return standing ? 'cover' : 'live';
}

/**
 * May this artboard stand in as its still right now? (The pre-overview predicate, kept for callers and tests: the
 * still exists, the artboard is not exempt, and it is under the cut or already showing it this gesture.)
 */
export function stillEligible(s: {
  width: number;
  zoom: number;
  pinned: boolean;
  eager: boolean;
  hasStill: boolean;
  showing?: boolean;
}): boolean {
  if (s.pinned || s.eager || !s.hasStill) return false;
  if (s.showing) return true;
  return inOverviewCut(s.width, s.zoom);
}

/** Is a still worth drawing for this artboard at the settled zoom? */
export function stillWanted(s: {
  width: number;
  zoom: number;
  pinned: boolean;
  eager: boolean;
}): boolean {
  if (s.pinned || s.eager || !(s.width > 0) || !(s.zoom > 0)) return false;
  return s.width * s.zoom < STILL_MAX_SCREEN_PX * STILL_PREPARE_FACTOR;
}

/**
 * A content signature of a body: what it renders (its markup) and its size. Two equal signatures paint the same
 * still (a picture that came in later redraws through its `load`). FNV-1a over the markup — a few ms on an 8k-node
 * body, against 10–40 ms for a drawing.
 */
export function contentSignature(body: {
  innerHTML: string;
  offsetWidth: number;
  offsetHeight: number;
}): string {
  const s = body.innerHTML;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}:${s.length}:${body.offsetWidth}x${body.offsetHeight}`;
}

/** One kept still: its bitmap, the signature it was drawn from, its size in bytes, and when it was last used. */
export interface CachedStill {
  el: HTMLElement;
  sig: string;
  bytes: number;
  used: number;
}

/**
 * The stills of this canvas document, by artboard id — kept when an artboard's children are released, so it comes
 * back as its still rather than a placeholder, and across an edit's soft reload (the runtime lives on the document).
 * Bounded by `STILL_CACHE_MAX_BYTES`; what stands in right now (`inUse`) is never dropped.
 */
export class StillCache {
  private map = new Map<string, CachedStill>();
  private bytes = 0;
  private tick = 0;
  constructor(private readonly max = STILL_CACHE_MAX_BYTES) {}
  get(id: string): CachedStill | undefined {
    const c = this.map.get(id);
    if (c) c.used = ++this.tick;
    return c;
  }
  peek(id: string): CachedStill | undefined {
    return this.map.get(id);
  }
  set(
    id: string,
    el: HTMLElement,
    sig: string,
    bytes: number,
    inUse: (id: string) => boolean
  ): void {
    const old = this.map.get(id);
    if (old) {
      this.bytes -= old.bytes;
      if (old.el !== el) old.el.remove();
    }
    this.map.set(id, { el, sig, bytes, used: ++this.tick });
    this.bytes += bytes;
    if (this.bytes <= this.max) return;
    const victims = [...this.map.entries()]
      .filter(([k]) => k !== id && !inUse(k))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [k, v] of victims) {
      if (this.bytes <= this.max) break;
      this.map.delete(k);
      this.bytes -= v.bytes;
      v.el.remove();
    }
  }
  /** The content changed under a kept still: it may still stand in (better than nothing), but is redrawn. */
  stale(id: string): void {
    const c = this.map.get(id);
    if (c) c.sig = '';
  }
  stats(): { n: number; bytes: number } {
    return { n: this.map.size, bytes: this.bytes };
  }
  ids(): string[] {
    return [...this.map.keys()];
  }
}

/** What the controller needs from one artboard's DOM (an adapter, so tests need no canvas). */
export interface StillTarget {
  article: HTMLElement;
  body: HTMLElement;
  /** the own colour the cover takes ('' = the frame's own) */
  bg?: string;
}

interface Entry {
  id: string;
  target: StillTarget;
  pinned: boolean;
  eager: boolean;
  visible: boolean;
  weight: number;
  /** the stand-in element (a `<div>` child of the article; holds the still) — created on first need */
  slot: HTMLElement | null;
  /** the still currently inside the slot */
  shown: HTMLElement | null;
  dirty: boolean;
  view: StillView;
  /** bumps on every view change: a hand-over in flight checks it before its next step */
  seq: number;
  observer: MutationObserver | null;
  /** has this entry's body been shown live since it registered (the cover is never shown after that) */
  wasLive: boolean;
}

export interface StillControllerOptions {
  /** Draw a still of `body` (null when it cannot). Async: inline SVGs load as images. */
  take: (body: HTMLElement) => Promise<HTMLElement | null>;
  later?: (fn: () => void, ms: number) => unknown;
  /** the next animation frame (the staggered hand-back, the hand-over's two frames) */
  frame?: (fn: () => void) => unknown;
  /** a clock (ms) — the hand-back paces itself on frame times */
  now?: () => number;
  cancel?: (handle: unknown) => void;
  /** observe DOM changes (null in tests that do not need it) */
  observe?: ((el: HTMLElement, onChange: () => void) => MutationObserver | null) | null;
  /** on screen + mounted weight, from the mount ring (default: what `update` was told) */
  info?: (id: string) => { visible: boolean; weight: number } | null;
  /** the body has painted what it shows: its pictures decoded, the fonts ready (default: those two promises) */
  painted?: (body: HTMLElement) => Promise<void>;
  /** make a stand-in element (default: a `<div>`; tests pass a fake) */
  makeSlot?: () => HTMLElement;
  /** the content signature of a body (default `contentSignature`) */
  signature?: (body: HTMLElement) => string;
  /** the bytes a still holds (default: canvas width × height × 4) */
  sizeOf?: (still: HTMLElement) => number;
  cache?: StillCache;
  /** a view change, for the trace (tests, `__maudeStillStats`) */
  onView?: (id: string, view: StillView) => void;
}

/**
 * One per canvas document. Artboards register while their children are mounted (in a layout effect, so the body is
 * hidden before its first paint when it is under the cut); the viewport reports every zoom it writes (`noteZoom`)
 * and the settle (`settle`). Stills are drawn when the canvas has been quiet for `STILL_TAKE_DELAY_MS`, one at a time.
 */
export class StillController {
  private entries = new Map<string, Entry>();
  private zoom = 1;
  private gestureZoom: number | null = null;
  private timer: unknown = null;
  private taking = false;
  /** drawings so far, their total and longest wall time (ms), and draws skipped by an equal signature */
  private takes = { n: 0, ms: 0, max: 0, reused: 0 };
  private readonly take: StillControllerOptions['take'];
  private readonly later: (fn: () => void, ms: number) => unknown;
  private readonly frame: (fn: () => void) => unknown;
  private restoring: Entry[] = [];
  private restoreScheduled = false;
  private readonly now: () => number;
  private handbackQuiet = 0;
  private handbackStep = 1;
  private lastFrameAt = 0;
  private handbackWaited = 0;
  private readonly cancel: (h: unknown) => void;
  private readonly observe: StillControllerOptions['observe'];
  private readonly info: StillControllerOptions['info'];
  private readonly painted: (body: HTMLElement) => Promise<void>;
  private readonly makeSlot: () => HTMLElement;
  private readonly signature: (body: HTMLElement) => string;
  private readonly sizeOf: (still: HTMLElement) => number;
  private readonly onView: StillControllerOptions['onView'];
  readonly cache: StillCache;
  /** view changes per artboard since it first registered — the flicker count (diagnostics) */
  private changes = new Map<string, StillView[]>();

  constructor(o: StillControllerOptions) {
    this.take = o.take;
    this.later = o.later ?? ((fn, ms) => setTimeout(fn, ms));
    this.now =
      o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.frame =
      o.frame ??
      ((fn) =>
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(fn)
          : setTimeout(fn, 16));
    this.cancel = o.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.observe = o.observe === undefined ? defaultObserve : o.observe;
    this.info = o.info;
    this.painted = o.painted ?? defaultPainted;
    this.makeSlot = o.makeSlot ?? (() => document.createElement('div'));
    this.signature = o.signature ?? ((b) => contentSignature(b));
    this.sizeOf = o.sizeOf ?? defaultSize;
    this.cache = o.cache ?? new StillCache();
    this.onView = o.onView;
  }

  private visibleOf(e: Entry): boolean {
    return this.info ? !!this.info(e.id)?.visible : e.visible;
  }

  /** The settled (published) zoom — the one a gesture starts from. Ignored mid-gesture. */
  setZoom(zoom: number): void {
    if (!(zoom > 0) || this.gestureZoom !== null) return;
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.reconcileAll();
    this.scheduleTake();
  }

  register(
    id: string,
    target: StillTarget,
    flags: { pinned?: boolean; eager?: boolean } = {}
  ): () => void {
    this.unregister(id);
    const e: Entry = {
      id,
      target,
      pinned: !!flags.pinned,
      eager: !!flags.eager,
      visible: false,
      weight: 0,
      slot: null,
      shown: null,
      dirty: true,
      view: 'live',
      seq: 0,
      observer: null,
      wasLive: false,
    };
    e.observer = this.observe ? this.observe(target.body, () => this.markDirty(id)) : null;
    this.entries.set(id, e);
    // A fresh mount: it has painted nothing yet. Under the cut it starts as its kept still (or the cover) with the
    // body hidden before its first paint; over the cut it starts as a hand-over from that stand-in.
    const kept = this.cache.get(id);
    if (kept) this.putStill(e, kept.el);
    const small = this.small(e, this.zoom);
    if (small && !e.pinned && !e.eager) this.setView(e, kept ? 'still' : 'cover');
    else if (kept) this.handOver(e, true);
    else e.wasLive = true;
    this.scheduleTake();
    return () => {
      if (this.entries.get(id) === e) this.unregister(id);
    };
  }

  private unregister(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.seq += 1;
    e.observer?.disconnect();
    if (e.shown) e.shown.remove(); // stays in the cache
    e.slot?.remove();
    e.target.article.removeAttribute(STILL_ATTR);
    this.restoring = this.restoring.filter((x) => x !== e);
    this.entries.delete(id);
  }

  update(
    id: string,
    s: Partial<{ pinned: boolean; eager: boolean; visible: boolean; weight: number; bg: string }>
  ): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (s.pinned !== undefined) e.pinned = s.pinned;
    if (s.eager !== undefined) e.eager = s.eager;
    if (s.visible !== undefined) e.visible = s.visible;
    if (s.weight !== undefined && Number.isFinite(s.weight)) e.weight = s.weight;
    if (s.bg !== undefined) {
      e.target.bg = s.bg;
      if (e.slot) e.slot.style.backgroundColor = s.bg || '';
    }
    // the selection lands (mid-gesture too): its artboard goes live at once — the shell works in its DOM
    this.reconcile(e, this.gestureZoom !== null);
    this.scheduleTake();
  }

  /** The content changed (a DOM mutation, a wake or a sleep): the still is redrawn before it is trusted again. */
  markDirty(id: string, _why?: string): void {
    const e = this.entries.get(id);
    if (!e || e.dirty) return;
    e.dirty = true;
    this.cache.stale(id);
    this.scheduleTake();
  }

  /** The viewport wrote this zoom (every frame of a gesture, and every programmatic move). */
  noteZoom(zoom: number): void {
    if (!(zoom > 0)) return;
    if (this.gestureZoom === null) {
      // the first write of a gesture: remember where it started; nothing changes for a pure pan
      this.gestureZoom = this.zoom;
      this.stopTaking();
    }
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    for (const e of this.entries.values()) this.reconcile(e, true);
  }

  /** The gesture settled: what is now over the cut is handed back (paced), what is under it shows its still. */
  settle(zoom?: number): void {
    if (zoom !== undefined && zoom > 0) this.zoom = zoom;
    this.gestureZoom = null;
    this.reconcileAll();
    this.scheduleTake();
  }

  /** Is the zoom in flight (diagnostics)? */
  engaged(): boolean {
    return this.gestureZoom !== null;
  }

  private small(e: Entry, zoom: number): boolean {
    return inOverviewCut(e.target.article.offsetWidth, zoom);
  }

  private reconcileAll(): void {
    const handBack: Entry[] = [];
    for (const e of this.entries.values()) {
      const t = this.reconcile(e, false, true);
      if (t) handBack.push(e);
    }
    if (handBack.length) this.queueHandBack(handBack);
  }

  /**
   * Move one entry toward its target. Returns true when it should be handed back by the paced queue (only when
   * `queue` — the settle's batch); otherwise a hand-back starts at once.
   */
  private reconcile(e: Entry, gesture: boolean, queue = false): boolean {
    const exempt = e.pinned || e.eager;
    const t = targetView({
      view: e.view,
      small: this.small(e, this.zoom),
      exempt,
      hasStill: !!e.shown,
      gesture,
    });
    if (t === 'still' && e.view !== 'still') {
      this.setView(e, 'still');
      return false;
    }
    if (t === 'cover' && e.view !== 'cover') {
      this.setView(e, 'cover');
      return false;
    }
    if (t === 'live' && (e.view === 'still' || e.view === 'cover')) {
      if (exempt) {
        this.handOver(e, false);
        return false;
      }
      if (queue) return !this.restoring.includes(e);
      if (!gesture) this.handOver(e, false);
    }
    return false;
  }

  private queueHandBack(list: Entry[]): void {
    const W = typeof innerWidth === 'number' ? innerWidth : 0;
    const H = typeof innerHeight === 'number' ? innerHeight : 0;
    const dist = new Map<Entry, number>();
    for (const e of list) {
      const r = e.target.article.getBoundingClientRect();
      dist.set(e, Math.hypot(r.left + r.width / 2 - W / 2, r.top + r.height / 2 - H / 2) || 0);
    }
    list.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
    this.restoring = [...this.restoring.filter((x) => !list.includes(x)), ...list];
    this.handbackQuiet = STILL_HANDBACK_QUIET_FRAMES;
    this.handbackStep = 1;
    this.lastFrameAt = 0;
    this.handbackWaited = 0;
    this.scheduleHandback();
  }

  private scheduleHandback(): void {
    if (!this.restoring.length || this.restoreScheduled) return;
    this.restoreScheduled = true;
    this.frame(() => {
      this.restoreScheduled = false;
      this.handbackTick();
    });
  }

  /** One frame of the hand-back: wait for quiet frames, then a few artboards, fewer after a slow frame. */
  private handbackTick(): void {
    if (this.gestureZoom !== null) return; // paused: the gesture's settle queues again
    const t = this.now();
    const dt = this.lastFrameAt ? t - this.lastFrameAt : 0;
    this.lastFrameAt = t;
    const slow = dt > STILL_HANDBACK_SLOW_MS;
    const stalled = this.handbackWaited >= STILL_HANDBACK_MAX_WAIT_FRAMES;
    if (this.handbackQuiet > 0 && !stalled) {
      if (!slow) this.handbackQuiet -= 1;
      else this.handbackWaited += 1;
    } else if (slow && !stalled) {
      this.handbackStep = 1;
      this.handbackWaited += 1;
    } else {
      this.handbackQuiet = 0;
      this.handbackWaited = 0;
      if (slow) this.handbackStep = 1;
      const batch = this.restoring.splice(0, this.handbackStep);
      for (const e of batch) {
        // still heading live? (a zoom-out in between, or it was released)
        if (this.entries.get(e.id) !== e) continue;
        if (e.view !== 'still' && e.view !== 'cover') continue;
        if (this.small(e, this.zoom) && !(e.pinned || e.eager)) continue;
        this.handOver(e, false);
      }
      this.handbackStep = Math.min(STILL_RESTORE_PER_FRAME, this.handbackStep * 2);
    }
    this.scheduleHandback();
  }

  /**
   * The hand-over to live: the body is shown under its stand-in (`paint`); two frames later, with its pictures
   * decoded and the fonts ready, the stand-in fades out (`reveal`) and is gone (`live`). A view change in between
   * (a zoom back out) cancels it.
   */
  private handOver(e: Entry, fresh: boolean): void {
    if (fresh && !e.shown && !e.slot) {
      e.wasLive = true;
      return;
    }
    this.setView(e, 'paint');
    const seq = e.seq;
    const ok = () => this.entries.get(e.id) === e && e.seq === seq;
    this.frame(() =>
      this.frame(() => {
        if (!ok()) return;
        void this.painted(e.target.body)
          .catch(() => {})
          .then(() => {
            if (!ok()) return;
            this.setView(e, 'reveal');
            const seq2 = e.seq;
            this.later(() => {
              if (this.entries.get(e.id) === e && e.seq === seq2) this.setView(e, 'live');
            }, STILL_REVEAL_MS + 20);
          });
      })
    );
  }

  private setView(e: Entry, v: StillView): void {
    if (e.view === v) return;
    const prev = e.view;
    e.view = v;
    e.seq += 1;
    if (v === 'live') {
      e.wasLive = true;
      e.target.article.removeAttribute(STILL_ATTR);
    } else {
      if (v === 'paint' || v === 'reveal') e.wasLive = true;
      else if (!hiddenView(prev)) {
        // its box keeps the height it has now while its children are out of the render tree
        const h = e.target.body.offsetHeight;
        if (h > 0) e.target.body.style?.setProperty?.('--dc-still-h', `${h}px`);
      }
      this.ensureSlot(e);
      e.target.article.setAttribute(STILL_ATTR, v);
    }
    const h = this.changes.get(e.id) ?? [];
    h.push(v);
    if (h.length > 32) h.shift();
    this.changes.set(e.id, h);
    this.onView?.(e.id, v);
  }

  private ensureSlot(e: Entry): HTMLElement {
    if (!e.slot) {
      const s = this.makeSlot();
      s.classList.add(STILL_CLASS);
      s.setAttribute?.('aria-hidden', 'true');
      if (e.target.bg) s.style.backgroundColor = e.target.bg;
      e.slot = s;
    }
    place(e.slot, e.target);
    if (e.slot.parentNode !== e.target.article) e.target.article.appendChild(e.slot);
    return e.slot;
  }

  private putStill(e: Entry, still: HTMLElement): void {
    const slot = this.ensureSlot(e);
    if (e.shown === still) return;
    if (e.shown && e.shown.parentNode === slot) e.shown.remove();
    slot.appendChild(still);
    e.shown = still;
  }

  /** Test / diagnostics view. */
  stats(): {
    registered: number;
    withStill: number;
    showing: number;
    covers: number;
    engaged: boolean;
    takes: { n: number; ms: number; max: number; reused: number };
    cache: { n: number; bytes: number };
    views: Record<string, number>;
  } {
    let withStill = 0;
    let showing = 0;
    let covers = 0;
    const views: Record<string, number> = {};
    for (const e of this.entries.values()) {
      if (e.shown) withStill += 1;
      if (e.view === 'still') showing += 1;
      if (e.view === 'cover') covers += 1;
      views[e.view] = (views[e.view] ?? 0) + 1;
    }
    return {
      registered: this.entries.size,
      withStill,
      showing,
      covers,
      engaged: this.gestureZoom !== null,
      takes: { ...this.takes, ms: Math.round(this.takes.ms), max: Math.round(this.takes.max) },
      cache: this.cache.stats(),
      views,
    };
  }

  /** The views each artboard went through since it first registered (oldest first, ≤ 32). */
  history(id?: string): Record<string, StillView[]> {
    if (id) return { [id]: [...(this.changes.get(id) ?? [])] };
    return Object.fromEntries([...this.changes].map(([k, v]) => [k, [...v]]));
  }

  isShowing(id: string): boolean {
    return this.entries.get(id)?.view === 'still';
  }

  viewOf(id: string): StillView | null {
    return this.entries.get(id)?.view ?? null;
  }

  private stopTaking(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }

  private scheduleTake(delay = STILL_TAKE_DELAY_MS): void {
    if (this.gestureZoom !== null || this.taking) return;
    this.stopTaking();
    this.timer = this.later(() => {
      this.timer = null;
      void this.takeNext();
    }, delay);
  }

  private nextToTake(): Entry | null {
    let best: Entry | null = null;
    let bestRank = 99;
    for (const e of this.entries.values()) {
      if (!e.dirty) continue;
      const covered = e.view === 'cover';
      if (
        !covered &&
        !stillWanted({
          width: e.target.article.offsetWidth,
          zoom: this.zoom,
          pinned: e.pinned,
          eager: e.eager,
        })
      )
        continue;
      // a cover on screen first, then a missing still on screen, a stale one, then the prefetch ring
      const rank = (this.visibleOf(e) ? 0 : 3) + (covered ? 0 : e.shown ? 2 : 1);
      if (!best || rank < bestRank) {
        best = e;
        bestRank = rank;
      }
    }
    return best;
  }

  private async takeNext(): Promise<void> {
    if (this.gestureZoom !== null) return;
    // never draw while the hand-back is painting: try again once it is done
    if (this.restoring.length) {
      this.scheduleTake();
      return;
    }
    const e = this.nextToTake();
    if (!e) return;
    const id = e.id;
    // the same content as the kept still: nothing to draw
    let sig = '';
    try {
      sig = this.signature(e.target.body);
    } catch {
      sig = '';
    }
    const kept = this.cache.peek(id);
    if (sig && kept && kept.sig === sig) {
      e.dirty = false;
      this.takes.reused += 1;
      if (e.shown !== kept.el) this.putStill(e, kept.el);
      this.afterTake(e);
      this.scheduleTake(STILL_TAKE_GAP_MS);
      return;
    }
    this.taking = true;
    let still: HTMLElement | null = null;
    const t0 = this.now();
    try {
      // a body under its stand-in is hidden: show it for the synchronous walk (no frame paints in between)
      const hidden = e.view === 'still' || e.view === 'cover';
      if (hidden) e.target.article.setAttribute(STILL_ATTR, 'paint');
      const p = this.take(e.target.body);
      if (hidden && this.entries.get(id) === e) e.target.article.setAttribute(STILL_ATTR, e.view);
      still = await p;
    } catch {
      still = null;
    } finally {
      this.taking = false;
      const dt = this.now() - t0;
      this.takes.n += 1;
      this.takes.ms += dt;
      this.takes.max = Math.max(this.takes.max, dt);
    }
    if (this.entries.get(id) !== e || this.gestureZoom !== null) {
      // released, or a gesture started while we drew: keep what stood in for this one, try again after the settle
      still?.remove();
      if (this.entries.get(id) === e) this.scheduleTake();
      return;
    }
    e.dirty = false;
    if (still) {
      this.cache.set(id, still, sig, this.sizeOf(still), (k) => this.entries.has(k));
      this.putStill(e, still);
    }
    this.afterTake(e);
    this.scheduleTake(STILL_TAKE_GAP_MS);
  }

  /** A still came in: a cover becomes it, a live artboard under the cut swaps to it (the one change). */
  private afterTake(e: Entry): void {
    if (this.gestureZoom !== null) return;
    this.reconcile(e, false);
  }
}

const hiddenView = (v: StillView) => v === 'still' || v === 'cover';

/** Put the stand-in over the body: same offset and size inside the (positioned) article. */
function place(slot: HTMLElement, t: StillTarget): void {
  const st = slot.style;
  st.left = `${t.body.offsetLeft}px`;
  st.top = `${t.body.offsetTop}px`;
  st.width = `${t.body.offsetWidth}px`;
  st.height = `${t.body.offsetHeight}px`;
}

function defaultSize(still: HTMLElement): number {
  const c = still as unknown as { width?: number; height?: number };
  return Math.max(1, (c.width ?? 0) * (c.height ?? 0) * 4);
}

/** The body's pictures decoded and the fonts ready (each bounded: a picture that never loads does not hold it). */
async function defaultPainted(body: HTMLElement): Promise<void> {
  const waits: Promise<unknown>[] = [];
  for (const img of Array.from(body.getElementsByTagName('img'))) {
    if (img.complete && img.naturalWidth === 0) continue; // a missing picture: nothing to wait for
    waits.push(img.decode().catch(() => {}));
  }
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) waits.push(fonts.ready);
  await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 400))]);
}

/**
 * A change to what the body paints. A picture's `src` changing is not one yet (the asset layer retries a missing
 * picture every few seconds, which redrew those stills forever): its `load` is.
 */
export function isPaintMutation(
  m: Pick<MutationRecord, 'type' | 'attributeName' | 'target'>
): boolean {
  if (m.type !== 'attributes') return true;
  const t = m.target as Element;
  return !(
    (m.attributeName === 'src' || m.attributeName === 'srcset') &&
    (t.tagName === 'IMG' || t.tagName === 'VIDEO' || t.tagName === 'SOURCE')
  );
}

function defaultObserve(el: HTMLElement, onChange: () => void): MutationObserver | null {
  if (typeof MutationObserver !== 'function') return null;
  const mo = new MutationObserver((list) => {
    if (list.some(isPaintMutation)) onChange();
  });
  mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
  // a picture that came in (load does not bubble: capture)
  const onLoad = () => onChange();
  el.addEventListener('load', onLoad, true);
  const disconnect = mo.disconnect.bind(mo);
  mo.disconnect = () => {
    el.removeEventListener('load', onLoad, true);
    disconnect();
  };
  return mo;
}

/**
 * The stand-in's CSS (folded into the canvas-lib stylesheet with ARTBOARD_LIVE_CSS). Under its still or cover the
 * body's children leave the render tree (`display: none` — no style, layout or paint; the DOM, ids and React state
 * stay) and the body keeps its box (`--dc-still-h`). Measured in Safari on the mascot canvas at 10 %: zoom p95 44 ms
 * this way, 89 with `visibility: hidden`, 150 with `content-visibility: hidden`, 526 live. During the hand-over the
 * body paints under the stand-in, which then fades.
 */
export const ARTBOARD_STILL_CSS = `
.dc-artboard > .${STILL_CLASS} { display: none; position: absolute; pointer-events: none; overflow: hidden; z-index: 1; }
.dc-artboard[${STILL_ATTR}] > .${STILL_CLASS} { display: block; }
.dc-artboard > .${STILL_CLASS} > canvas { display: block; width: 100%; height: 100%; }
.dc-artboard[${STILL_ATTR}='still'] > .dc-artboard-body,
.dc-artboard[${STILL_ATTR}='cover'] > .dc-artboard-body { min-height: var(--dc-still-h, 0px); }
.dc-artboard[${STILL_ATTR}='still'] > .dc-artboard-body > *,
.dc-artboard[${STILL_ATTR}='cover'] > .dc-artboard-body > * { display: none !important; }
.dc-artboard[${STILL_ATTR}='reveal'] > .${STILL_CLASS} { opacity: 0; transition: opacity ${STILL_REVEAL_MS}ms linear; }
`;
