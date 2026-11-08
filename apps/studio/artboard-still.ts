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
 *             Drawn in slices within a per-frame budget (`startStill`, artboard-still-raster.ts) — during a pan too, so
 *             an artboard that mounts mid-pan becomes its still within a few frames, never while the zoom moves, and
 *             not in the hold after a zoom settles. The children of a hidden body come back into the render tree for
 *             the walk only (`STILL_WALK_ATTR`, the body transparent); its pictures decode off the main thread.
 *
 *             The stills are drawn in this canvas document (artboard-still-raster.ts) and kept in its
 *             memory (`StillCache`, keyed by artboard id + a content signature, bounded in bytes) — never on disk and
 *             never in the canvas origin's storage, which every canvas on that origin can read (C4's named gap).
 */

import type { StillJob, WalkHooks } from './artboard-still-raster.ts';
import { frameRaf } from './frame-clock.ts';

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
/**
 * How long a still whose content changed waits before it is redrawn (ms): an edit's burst of DOM changes draws once.
 * A cover (an artboard with no still yet) is drawn at once — during a pan too (the 2.0.7 first-pass blocks).
 */
export const STILL_TAKE_DELAY_MS = 600;
/**
 * The main-thread time drawings may take per frame (ms), during a gesture and while settled. A drawing is sliced
 * (artboard-still-raster.ts `startStill`: the walk, then the pictures decode off the main thread, then the paint),
 * so an artboard that mounts mid-pan becomes its still within a few frames.
 */
export const STILL_PAN_BUDGET_MS = 4;
export const STILL_IDLE_BUDGET_MS = 8;
/**
 * After a zoom settles nothing is drawn for this long (ms): WebKit repaints its tiles at the new scale in those
 * frames, and a drawing among them pushed the fit-all zoom cycle's settle max over base. A pan in it waits too: a pan
 * right after a zoom is still those frames (2.0.7 — drawing there kept the sweep-after-zoom lane over the bar).
 */
export const STILL_SETTLE_HOLD_MS = 1200;
/** At most this many drawings wait for their pictures to decode at once; the next one walks meanwhile. */
export const STILL_MAX_DECODING = 4;
/** Kept for callers: drawings are paced by the frame budget now, not by a gap. */
export const STILL_TAKE_GAP_MS = 50;
/**
 * The DECODED tier (#212): the stills kept as bitmaps, in bytes (w × h × 4). Past it the least recently used still
 * that is not standing in right now leaves THIS tier only — its encoded copy stays, so it comes back as a still.
 * Stills are 400 px wide at most now (0.35–1.4 MB each), so 48 MB holds ~35–140 of them.
 */
export const STILL_CACHE_MAX_BYTES = 48 * 1024 * 1024;
/**
 * The ENCODED tier (#212): every still as a WebP blob (~20–60 kB), never evicted by the decoded LRU. Only this cap
 * drops one (oldest first) — 88 artboards are under 5 MB, so it is a safety net, not a working limit.
 */
export const STILL_ENCODED_MAX_BYTES = 64 * 1024 * 1024;
/** The attribute the article carries while its stand-in shows (`cover` | `still` | `paint` | `reveal`). */
export const STILL_ATTR = 'data-dc-still';
/**
 * The attribute the article carries while its hidden body is walked for a drawing: the children are back in the
 * render tree (laid out, so the walk can read them) and the body is transparent (not painted). Never shown.
 */
export const STILL_WALK_ATTR = 'data-dc-still-walk';
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
    // mid-gesture: shrinking under the cut swaps to the still; a cover takes its still the moment it exists
    if (s.hasStill && (s.view === 'cover' || (s.small && !standing))) return 'still';
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

/**
 * One kept still. `el` is the decoded bitmap (null once the decoded tier let go of it); `blob` the encoded copy
 * (null until it is encoded, or when no encoder exists); `bytes` the decoded size, remembered across a restore.
 */
export interface CachedStill {
  el: HTMLElement | null;
  blob: Blob | null;
  sig: string;
  bytes: number;
  used: number;
  /** the order its blob was stored in (the encoded tier drops the smallest first) */
  order: number;
  /** its encode is queued or running: the decoded tier does not drop it before it has a copy to restore from */
  encoding: boolean;
  url: string | null;
}

export interface StillCacheOptions {
  /** the encoded tier's byte cap */
  encodedMax?: number;
  /** a decoded still → its encoded copy (null: none) */
  encode?: (el: HTMLElement) => Promise<Blob | null>;
  /** an encoded copy → a decoded still, not yet in the document (null: it cannot) */
  decode?: (blob: Blob) => Promise<HTMLElement | null>;
  objectUrl?: { make(blob: Blob): string; revoke(url: string): void };
}

/**
 * The default encoder: WebP at 0.8 off a canvas (a missing `toBlob`, or one that never answers, is "no copy").
 * WebKit (Safari, the desktop app) has no WebP encoder and answers `image/png`: the blob keeps that type, and the
 * persist lane checks and labels the bytes by what they are (bridge/still-webp.ts `checkStillImage`).
 */
function defaultEncode(el: HTMLElement): Promise<Blob | null> {
  const c = el as HTMLCanvasElement;
  if (typeof c.toBlob !== 'function') return Promise.resolve(null);
  return new Promise((res) => {
    const t = setTimeout(() => res(null), 4000);
    try {
      c.toBlob(
        (b) => {
          clearTimeout(t);
          res(b);
        },
        'image/webp',
        0.8
      );
    } catch {
      clearTimeout(t);
      res(null);
    }
  });
}

/** The default decoder: the blob into a canvas the size of the picture. */
async function defaultDecode(blob: Blob): Promise<HTMLElement | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')?.drawImage(bmp, 0, 0);
    bmp.close?.();
    return c;
  } catch {
    return null;
  }
}

const defaultObjectUrl = {
  make: (b: Blob) => URL.createObjectURL(b),
  revoke: (u: string) => URL.revokeObjectURL(u),
};

/**
 * The stills of this canvas document, by artboard id, in two tiers (#212) — kept when an artboard's children are
 * released, so it comes back as its still rather than a placeholder, and across an edit's soft reload (the runtime
 * lives on the document).
 *   - decoded: the bitmaps, an LRU bounded by `max` bytes; what stands in right now (`inUse`) is never dropped;
 *   - encoded: a WebP copy of each, made once the still exists, never touched by the decoded LRU (its own cap,
 *     oldest first). A still that leaves the decoded tier stays known (`peek` has it, `el` null) and `restore`
 *     decodes it again — so a still that was drawn never falls back to a blank.
 * Without an encoder (a document that cannot make one) a still dropped from the decoded tier is gone, as before.
 */
export class StillCache {
  private map = new Map<string, CachedStill>();
  private bytes = 0;
  private encBytes = 0;
  private tick = 0;
  private order = 0;
  private readonly encodedMax: number;
  private readonly encode: (el: HTMLElement) => Promise<Blob | null>;
  private readonly decode: (blob: Blob) => Promise<HTMLElement | null>;
  private readonly objectUrl: NonNullable<StillCacheOptions['objectUrl']>;
  private readonly customEncode: boolean;
  private encQueue: string[] = [];
  private encRunning = false;
  private restoring = new Map<string, Promise<HTMLElement | null>>();
  private evictListeners = new Set<(id: string) => void>();
  /** #212 §5 — persisted stills not yet checked against their artboard (outside `map`: nothing shows them) */
  private seeds = new Map<string, { blob: Blob; sig: string }>();
  private seedBytes = 0;
  private encodedListeners = new Set<(id: string, blob: Blob, sig: string) => void>();
  constructor(
    readonly max = STILL_CACHE_MAX_BYTES,
    o: StillCacheOptions = {}
  ) {
    this.encodedMax = o.encodedMax ?? STILL_ENCODED_MAX_BYTES;
    this.customEncode = !!o.encode;
    this.encode = o.encode ?? defaultEncode;
    this.decode = o.decode ?? defaultDecode;
    this.objectUrl = o.objectUrl ?? defaultObjectUrl;
  }
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
    this.dropSeed(id); // a fresh drawing wins over a persisted one
    const old = this.map.get(id);
    if (old) {
      if (old.el) this.bytes -= old.bytes;
      if (old.el && old.el !== el) old.el.remove();
      this.dropBlob(old);
    }
    // an element that cannot be encoded (no `toBlob`, no custom encoder) has nothing to wait for
    const encoding = this.customEncode || typeof (el as HTMLCanvasElement).toBlob === 'function';
    this.map.set(id, {
      el,
      blob: null,
      sig,
      bytes,
      used: ++this.tick,
      order: 0,
      encoding,
      url: null,
    });
    this.bytes += bytes;
    this.trim(id, inUse);
    if (encoding) {
      if (!this.encQueue.includes(id)) this.encQueue.push(id);
      this.pumpEncode();
    }
  }
  /** The decoded tier over its cap: the least recently used still that does not stand in leaves it. */
  private trim(keep: string, inUse: (id: string) => boolean): void {
    if (this.bytes <= this.max) return;
    const victims = [...this.map.entries()]
      .filter(([k, v]) => k !== keep && v.el && !v.encoding && !inUse(k))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [k, v] of victims) {
      if (this.bytes <= this.max) break;
      this.bytes -= v.bytes;
      v.el?.remove();
      v.el = null;
      if (!v.blob) this.map.delete(k);
      for (const fn of this.evictListeners) fn(k);
    }
  }
  private pumpEncode(): void {
    if (this.encRunning) return;
    const id = this.encQueue.shift();
    if (id === undefined) return;
    const e = this.map.get(id);
    const el = e?.el;
    if (!e || !el) {
      if (e) e.encoding = false;
      this.pumpEncode();
      return;
    }
    this.encRunning = true;
    this.encode(el)
      .catch(() => null)
      .then((blob) => {
        if (this.map.get(id) !== e) return;
        e.encoding = false;
        if (blob && blob.size > 0) {
          this.dropBlob(e);
          e.blob = blob;
          e.order = ++this.order;
          this.encBytes += blob.size;
          this.trimEncoded(id);
          // #212 §5 — a still this document drew of its current content: it may be kept across sessions
          if (e.sig && this.map.get(id) === e)
            for (const fn of this.encodedListeners) {
              try {
                fn(id, blob, e.sig);
              } catch {}
            }
        }
      })
      .finally(() => {
        this.encRunning = false;
        // a gap between encodes: they must not stack up inside one frame
        setTimeout(() => this.pumpEncode(), 0);
      });
  }
  /** The encoded tier over its cap: the oldest copy goes (a still with no bitmap either is forgotten). */
  private trimEncoded(keep: string): void {
    if (this.encBytes <= this.encodedMax) return;
    const victims = [...this.map.entries()]
      .filter(([k, v]) => k !== keep && v.blob)
      .sort((a, b) => a[1].order - b[1].order);
    for (const [k, v] of victims) {
      if (this.encBytes <= this.encodedMax) break;
      this.dropBlob(v);
      if (!v.el) this.map.delete(k);
    }
  }
  private dropBlob(v: CachedStill): void {
    if (v.blob) this.encBytes -= v.blob.size;
    if (v.url) {
      try {
        this.objectUrl.revoke(v.url);
      } catch {}
    }
    v.blob = null;
    v.url = null;
  }
  /**
   * The decoded still of `id`, decoding it from the encoded tier if the decoded tier let go of it (a second ask
   * while it decodes shares the decode). Null when nothing can be restored (then the entry is forgotten).
   */
  restore(id: string, inUse: (id: string) => boolean = () => false): Promise<HTMLElement | null> {
    const e = this.map.get(id);
    if (!e) return Promise.resolve(null);
    if (e.el) {
      e.used = ++this.tick;
      return Promise.resolve(e.el);
    }
    const going = this.restoring.get(id);
    if (going) return going;
    const blob = e.blob;
    if (!blob) return Promise.resolve(null);
    const p = this.decode(blob)
      .catch(() => null)
      .then((el) => {
        this.restoring.delete(id);
        if (this.map.get(id) !== e) return null;
        if (e.el) return e.el;
        if (!el) {
          this.dropBlob(e);
          this.map.delete(id);
          return null;
        }
        e.el = el;
        e.used = ++this.tick;
        // a still adopted from a seed never had a decoded size: the bitmap's (canvas width × height × 4)
        if (!e.bytes) e.bytes = elementBytes(el);
        this.bytes += e.bytes;
        this.trim(id, inUse);
        return el;
      });
    this.restoring.set(id, p);
    return p;
  }
  /** An object URL of the encoded copy (what a placeholder shows when the bitmap left the decoded tier). */
  blobUrl(id: string): string | null {
    const e = this.map.get(id);
    if (!e?.blob) return null;
    if (!e.url) {
      try {
        e.url = this.objectUrl.make(e.blob);
      } catch {
        return null;
      }
    }
    return e.url;
  }
  /** A bitmap left the decoded tier (the placeholder holding it shows the encoded copy instead). */
  onEvict(fn: (id: string) => void): () => void {
    this.evictListeners.add(fn);
    return () => this.evictListeners.delete(fn);
  }
  /** The content changed under a kept still: it may still stand in (better than nothing), but is redrawn. */
  stale(id: string): void {
    const c = this.map.get(id);
    if (c) c.sig = '';
  }
  stats(): { n: number; bytes: number; encoded: number; encodedBytes: number } {
    let encoded = 0;
    for (const v of this.map.values()) if (v.blob) encoded += 1;
    return { n: this.map.size, bytes: this.bytes, encoded, encodedBytes: this.encBytes };
  }
  ids(): string[] {
    return [...this.map.keys()];
  }
  /**
   * #212 §5 — a persisted still of `id` (the shell's answer), with the content signature it was drawn from. Kept
   * OUTSIDE the cache until `adopt` checks it against the artboard's own body: no placeholder, `hasStill` or warm-up
   * sees a seed. Refused when the artboard already has a still, the signature is empty, or the seeds would pass the
   * encoded tier's cap.
   */
  seed(id: string, blob: Blob, sig: string): boolean {
    if (!sig || this.map.has(id) || !(blob?.size > 0)) return false;
    this.dropSeed(id);
    if (this.seedBytes + blob.size > this.encodedMax) return false;
    this.seeds.set(id, { blob, sig });
    this.seedBytes += blob.size;
    return true;
  }
  hasSeed(id: string): boolean {
    return this.seeds.has(id);
  }
  /**
   * The seed of `id` becomes its kept still (encoded only; `restore` decodes it) iff it was drawn from the same
   * content: `sig` = the artboard body's signature now. The seed is used up either way — a stale one is dropped.
   */
  adopt(id: string, sig: string): boolean {
    const s = this.seeds.get(id);
    if (!s) return false;
    this.dropSeed(id);
    if (!sig || s.sig !== sig || this.map.has(id)) return false;
    this.map.set(id, {
      el: null,
      blob: s.blob,
      sig,
      bytes: 0,
      used: ++this.tick,
      order: ++this.order,
      encoding: false,
      url: null,
    });
    this.encBytes += s.blob.size;
    this.trimEncoded(id);
    return this.map.has(id);
  }
  private dropSeed(id: string): void {
    const s = this.seeds.get(id);
    if (!s) return;
    this.seedBytes -= s.blob.size;
    this.seeds.delete(id);
  }
  seedIds(): string[] {
    return [...this.seeds.keys()];
  }
  /** #212 §5 — a still this document drew got its encoded copy (`sig` non-empty: drawn from the current content). */
  onEncoded(fn: (id: string, blob: Blob, sig: string) => void): () => void {
    this.encodedListeners.add(fn);
    return () => this.encodedListeners.delete(fn);
  }
}

/** The bytes a decoded still holds (a canvas: width × height × 4; anything else: 0). */
function elementBytes(el: HTMLElement): number {
  const c = el as HTMLCanvasElement;
  return typeof c.width === 'number' && typeof c.height === 'number' ? c.width * c.height * 4 : 0;
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
  /** bumps on every content change: a drawing that saw an older one is shown but drawn again */
  gen: number;
  /** not drawn before this `now()` (a changed still waits `STILL_TAKE_DELAY_MS`; a cover is drawn at once) */
  readyAt: number;
  view: StillView;
  /** bumps on every view change: a hand-over in flight checks it before its next step */
  seq: number;
  observer: MutationObserver | null;
  /** has this entry's body been shown live since it registered (the cover is never shown after that) */
  wasLive: boolean;
  /** its drawing in flight */
  job: Current | null;
  /** its kept still is being decoded from the encoded tier */
  restoring: boolean;
}

/** The drawing in flight (one at a time). */
interface Current {
  e: Entry;
  job: StillJob;
  sig: string;
  gen: number;
  t0: number;
  waiting: boolean;
  /** diagnostics: slices, the longest one, when each phase ended (ms after t0) */
  slices: number;
  sliceMax: number;
  phaseMax: Record<string, number>;
  marks: Record<string, number>;
}

/** One finished drawing (diagnostics, `__maudeStillJobs`). */
export interface StillJobTrace {
  id: string;
  /** what the artboard showed when the drawing ended (before its new still) */
  view: StillView;
  /** the longest slice per phase it started in (ms) */
  phaseMax: Record<string, number>;
  slices: number;
  sliceMax: number;
  /** ms after the start: the walk done, the pictures decoded, the end */
  marks: Record<string, number>;
}

export interface StillControllerOptions {
  /** Start a sliced drawing of `body` (artboard-still-raster.ts `startStill`). Wins over `take`. */
  job?: (body: HTMLElement, walk: WalkHooks) => StillJob;
  /** Draw a still of `body` whole (null when it cannot) — tests and callers without slicing. */
  take?: (body: HTMLElement) => Promise<HTMLElement | null>;
  later?: (fn: () => void, ms: number) => unknown;
  /** the next animation frame (drawings, the staggered hand-back, the hand-over's two frames) */
  frame?: (fn: () => void) => unknown;
  /** a clock (ms) — the hand-back paces itself on frame times, drawings on the frame budget */
  now?: () => number;
  cancel?: (handle: unknown) => void;
  /** observe DOM changes (null in tests that do not need it); `why` is 'load' for a picture that came in */
  observe?: ((el: HTMLElement, onChange: (why?: string) => void) => MutationObserver | null) | null;
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

/** A whole (unsliced) drawing as a job: one walk, then the wait for its promise. */
function wholeJob(take: (body: HTMLElement) => Promise<HTMLElement | null>) {
  return (body: HTMLElement, walk: WalkHooks): StillJob => {
    let phase: StillJob['phase'] = 'collect';
    let ready: Promise<unknown> | null = null;
    let result: HTMLElement | null = null;
    let settled = false;
    return {
      get ready() {
        return ready;
      },
      get result() {
        return result;
      },
      get phase() {
        return phase;
      },
      abort() {
        phase = 'done';
      },
      step() {
        if (phase === 'collect') {
          let p: Promise<HTMLElement | null>;
          walk.enter();
          try {
            p = take(body);
          } catch {
            p = Promise.resolve(null);
          } finally {
            walk.leave();
          }
          phase = 'decode';
          ready = p
            .then(
              (r) => {
                result = r;
              },
              () => {
                result = null;
              }
            )
            .then(() => {
              settled = true;
            });
          return 'wait';
        }
        if (phase === 'decode' && !settled) return 'wait';
        phase = 'done';
        return 'done';
      },
    };
  };
}

/**
 * One per canvas document. Artboards register while their children are mounted (in a layout effect, so the body is
 * hidden before its first paint when it is under the cut); the viewport reports every zoom it writes (`noteZoom`)
 * and the settle (`settle`). Stills are drawn one at a time in slices, within a per-frame budget — during a pan too,
 * never while the zoom is moving, and not in the `STILL_SETTLE_HOLD_MS` after a zoom settles (a pan in it waits too).
 */
export class StillController {
  private entries = new Map<string, Entry>();
  private zoom = 1;
  private gestureZoom: number | null = null;
  /** the gesture in flight changed the zoom (drawings wait; a pure pan draws) */
  private zooming = false;
  private holdUntil = 0;
  /** a zoom was published before (the first one is the canvas opening, never held) */
  private zoomKnown = false;
  private holdTimer: unknown = null;
  private readyTimer: unknown = null;
  private pumpQueued = false;
  /** drawings that can take a slice now (decoded ones first) — one walks at a time, the queue's head */
  private queue: Current[] = [];
  /** drawings whose pictures are decoding (off the main thread): the next one walks meanwhile */
  private decoding = new Set<Current>();
  /** drawings so far, their total and longest wall time (ms), the longest slice (ms), draws skipped by an equal signature */
  private takes = { n: 0, ms: 0, max: 0, slice: 0, reused: 0 };
  private readonly job: ((body: HTMLElement, walk: WalkHooks) => StillJob) | null;
  private readonly later: (fn: () => void, ms: number) => unknown;
  private readonly frame: (fn: () => void) => unknown;
  private restoring: Entry[] = [];
  private restoreScheduled = false;
  private readonly now: () => number;
  private handbackQuiet = 0;
  private handbackStep = 1;
  private lastFrameAt = 0;
  private handbackWaited = 0;
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
  /** the last drawings (≤ 64) — diagnostics */
  private traces: StillJobTrace[] = [];
  /** the last camera write or settle (ms, `now()`) — the warm-up waits for quiet after it */
  private activityAt = Number.NEGATIVE_INFINITY;
  private stillListeners = new Set<(id: string, ok: boolean) => void>();

  constructor(o: StillControllerOptions) {
    this.job = o.job ?? (o.take ? wholeJob(o.take) : null);
    this.later = o.later ?? ((fn, ms) => setTimeout(fn, ms));
    this.now =
      o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.frame =
      o.frame ??
      ((fn) => (typeof requestAnimationFrame === 'function' ? frameRaf(fn) : setTimeout(fn, 16)));
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
    this.activityAt = this.now();
    this.zoom = zoom;
    // a programmatic zoom (fit, a jump) repaints like a gesture's settle — not the first one (the canvas opening)
    if (this.zoomKnown) this.holdUntil = this.now() + STILL_SETTLE_HOLD_MS;
    this.zoomKnown = true;
    this.reconcileAll();
    this.schedulePump();
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
      gen: 0,
      readyAt: 0,
      view: 'live',
      seq: 0,
      observer: null,
      wasLive: false,
      job: null,
      restoring: false,
    };
    e.observer = this.observe ? this.observe(target.body, (why) => this.markDirty(id, why)) : null;
    this.entries.set(id, e);
    // #212 §5 — a persisted still (a seed) stands in only for the very content it was drawn from
    if (this.cache.hasSeed(id)) this.cache.adopt(id, this.sigOf(target.body));
    // A fresh mount: it has painted nothing yet. Under the cut it starts as its kept still (or the cover) with the
    // body hidden before its first paint; over the cut it starts as a hand-over from that stand-in.
    const kept = this.cache.get(id);
    if (kept?.el) this.putStill(e, kept.el);
    const small = this.small(e, this.zoom);
    // #169 T8.1b (decision A): mid-zoom, a mount over the cut that has a kept still shows that still and is handed
    // over at the settle (reconcileAll queues it) — a hand-over now would lay out and paint the body mid-zoom
    const held = !!kept && this.zooming;
    if ((small || held) && !e.pinned && !e.eager) {
      this.setView(e, kept?.el ? 'still' : 'cover');
      // a still the decoded tier let go of: decoded again from the encoded copy, never drawn again (#212)
      if (kept && !kept.el) this.restoreFor(e);
    } else if (kept?.el) this.handOver(e, true);
    else e.wasLive = true;
    this.schedulePump();
    return () => {
      if (this.entries.get(id) === e) this.unregister(id);
    };
  }

  /**
   * #212 §5 — the persisted stills came in after their artboards mounted: each mounted artboard with no still on
   * screen adopts its seed when the signatures match (a drawing in flight for it is dropped) and is restored from it.
   */
  adoptSeeds(): void {
    for (const e of this.entries.values()) {
      if (e.shown || !this.cache.hasSeed(e.id)) continue;
      if (!this.cache.adopt(e.id, this.sigOf(e.target.body))) continue;
      if (e.job) this.dropJob(e.job);
      if (this.small(e, this.zoom) && !e.pinned && !e.eager) this.restoreFor(e);
    }
    this.schedulePump();
  }

  private sigOf(body: HTMLElement): string {
    try {
      return this.signature(body);
    } catch {
      return '';
    }
  }

  private unregister(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.seq += 1;
    e.observer?.disconnect();
    if (e.job) this.dropJob(e.job);
    e.target.article.removeAttribute(STILL_WALK_ATTR);
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
    this.schedulePump();
  }

  /**
   * The content changed (a DOM mutation, a picture that came in, a wake or a sleep): the still is redrawn before it
   * is trusted again — after `STILL_TAKE_DELAY_MS` when a still stands in, at once for a cover. A picture that came
   * in while a drawing of this artboard waits for its pictures is part of that drawing, not a change.
   */
  markDirty(id: string, why?: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (why === 'load' && e.job && e.job.job.phase !== 'paint') return;
    e.gen += 1;
    if (e.shown || !hiddenView(e.view)) e.readyAt = this.now() + STILL_TAKE_DELAY_MS;
    if (!e.dirty) {
      e.dirty = true;
      this.cache.stale(id);
    }
    this.schedulePump();
  }

  /** The viewport wrote this zoom (every frame of a gesture, and every programmatic move). */
  noteZoom(zoom: number): void {
    if (!(zoom > 0)) return;
    this.activityAt = this.now();
    if (this.gestureZoom === null) {
      // the first write of a gesture: remember where it started; nothing changes for a pure pan
      this.gestureZoom = this.zoom;
      this.zooming = false;
    }
    if (zoom === this.zoom) {
      this.schedulePump(); // a pan: drawings go on, within the frame budget
      return;
    }
    this.zoom = zoom;
    if (!this.zooming) {
      this.zooming = true;
      // a walk in progress puts its children back out of the render tree; it starts again after the settle
      for (const c of [...this.queue]) if (c.job.phase === 'collect') this.dropJob(c);
    }
    for (const e of this.entries.values()) this.reconcile(e, true);
  }

  /** The gesture settled: what is now over the cut is handed back (paced), what is under it shows its still. */
  settle(zoom?: number): void {
    this.activityAt = this.now();
    if (zoom !== undefined && zoom > 0) this.zoom = zoom;
    if (this.zooming) this.holdUntil = this.now() + STILL_SETTLE_HOLD_MS;
    this.gestureZoom = null;
    this.zooming = false;
    this.reconcileAll();
    this.schedulePump();
  }

  /**
   * #169 T8.1b (decision A) — may this artboard's first mount wait for the settle? While a zoom is in flight, one
   * with a kept still keeps showing it (its placeholder holds that still), so its body mounts, lays out and paints
   * only at the settle: still → live is a settle change, never a mid-zoom one. No still: never (a placeholder with
   * nothing better is a block the user sees — v2-207-drop-undercut-midgesture-wait); a pure pan: never. The mount
   * ring keeps the exemptions (the active artboard, a video one).
   */
  holdsForSettle(id: string): boolean {
    return this.zooming && !!this.cache.peek(id);
  }

  /** Is the zoom in flight (diagnostics)? */
  engaged(): boolean {
    return this.gestureZoom !== null;
  }

  /** The settled zoom (the warm-up asks which artboards would be under the cut). */
  zoomNow(): number {
    return this.zoom;
  }

  /** The last camera write or settle (ms on this controller's clock). */
  lastActivity(): number {
    return this.activityAt;
  }

  /**
   * Nothing moves and nothing is held: no gesture, past the settle hold, no hand-back. `drawing` also asks that no
   * drawing is in flight or waiting to start for an artboard on screen.
   */
  quiet(drawing = false): boolean {
    if (this.gestureZoom !== null || this.zooming || this.restoring.length > 0) return false;
    if (this.now() < this.holdUntil) return false;
    return !drawing || (this.queue.length === 0 && this.decoding.size === 0);
  }

  /** Has this artboard a kept still (current or stale)? */
  hasStill(id: string): boolean {
    return !!this.cache.peek(id);
  }

  /** A drawing of `id` ended (`ok`: a still came of it, or its kept still was reused). */
  onStill(fn: (id: string, ok: boolean) => void): () => void {
    this.stillListeners.add(fn);
    return () => this.stillListeners.delete(fn);
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
    if (!this.restoring.length || this.restoreScheduled) {
      if (!this.restoring.length) this.schedulePump(); // the hand-back is done: drawings go on
      return;
    }
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
    takes: { n: number; ms: number; max: number; slice: number; reused: number };
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
      takes: {
        ...this.takes,
        ms: Math.round(this.takes.ms),
        max: Math.round(this.takes.max),
        slice: Math.round(this.takes.slice * 10) / 10,
      },
      cache: this.cache.stats(),
      views,
    };
  }

  /** The views each artboard went through since it first registered (oldest first, ≤ 32). */
  history(id?: string): Record<string, StillView[]> {
    if (id) return { [id]: [...(this.changes.get(id) ?? [])] };
    return Object.fromEntries([...this.changes].map(([k, v]) => [k, [...v]]));
  }

  /** The last drawings, oldest first (diagnostics). */
  jobs(): StillJobTrace[] {
    return this.traces.map((t) => ({ ...t, phaseMax: { ...t.phaseMax }, marks: { ...t.marks } }));
  }

  isShowing(id: string): boolean {
    return this.entries.get(id)?.view === 'still';
  }

  viewOf(id: string): StillView | null {
    return this.entries.get(id)?.view ?? null;
  }

  /** Drawings wait while the zoom moves and while the hand-back paints. */
  private blocked(): boolean {
    return this.zooming || this.restoring.length > 0 || !this.job;
  }

  /** Draw on the next frame, if there is anything to draw and drawing is allowed now. */
  private schedulePump(): void {
    if (this.pumpQueued || this.blocked()) return;
    const t = this.now();
    if (t < this.holdUntil) {
      if (this.holdTimer === null)
        this.holdTimer = this.later(() => {
          this.holdTimer = null;
          this.schedulePump();
        }, this.holdUntil - t);
      return;
    }
    this.pumpQueued = true;
    this.frame(() => {
      this.pumpQueued = false;
      this.pump();
    });
  }

  /** One frame's drawing: slices of the drawing in flight (and the next ones) until the frame budget is spent. */
  private pump(): void {
    if (this.blocked()) return;
    const t0 = this.now();
    if (t0 < this.holdUntil) {
      this.schedulePump();
      return;
    }
    const deadline = t0 + (this.gestureZoom !== null ? STILL_PAN_BUDGET_MS : STILL_IDLE_BUDGET_MS);
    for (let guard = 0; guard < 64; guard++) {
      const c = this.queue[0];
      if (!c) {
        // nothing to step: start the next drawing (a kept still reused counts as one), unless enough are decoding
        if (this.decoding.size >= STILL_MAX_DECODING || !this.startNext()) return;
        continue;
      }
      const s0 = this.now();
      const p0 = c.job.phase;
      let r: 'more' | 'wait' | 'done';
      try {
        r = c.job.step(deadline);
      } catch {
        c.job.abort();
        r = 'done';
      }
      const sd = this.now() - s0;
      this.takes.slice = Math.max(this.takes.slice, sd);
      c.slices += 1;
      c.sliceMax = Math.max(c.sliceMax, sd);
      c.phaseMax[p0] = Math.round(Math.max(c.phaseMax[p0] ?? 0, sd) * 10) / 10;
      const ph = c.job.phase;
      if (ph !== 'collect' && c.marks.walk === undefined)
        c.marks.walk = Math.round(this.now() - c.t0);
      if ((ph === 'paint' || ph === 'done') && c.marks.decode === undefined)
        c.marks.decode = Math.round(this.now() - c.t0);
      if (r === 'wait') {
        this.queue.shift();
        this.decoding.add(c);
        void Promise.resolve(c.job.ready).then(() => {
          if (!this.decoding.delete(c)) return; // dropped meanwhile
          this.queue.unshift(c); // decoded: it paints before the next walk goes on
          this.schedulePump();
        });
      } else if (r === 'done') {
        this.queue.shift();
        this.finishJob(c);
      }
      if (this.now() >= deadline) break;
    }
    this.schedulePump();
  }

  /** Forget a drawing in flight (its artboard left, or a zoom started mid-walk): its walk state goes. */
  private dropJob(c: Current): void {
    c.job.abort();
    this.queue = this.queue.filter((x) => x !== c);
    this.decoding.delete(c);
    if (c.e.job === c) c.e.job = null;
  }

  /** Pick the next artboard to draw and start it (or reuse its kept still). False when there is none now. */
  private startNext(): boolean {
    const e = this.nextToTake();
    if (!e || !this.job) return false;
    // the same content as the kept still: nothing to draw
    let sig = '';
    try {
      sig = this.signature(e.target.body);
    } catch {
      sig = '';
    }
    const kept = this.cache.peek(e.id);
    if (sig && kept && kept.sig === sig) {
      e.dirty = false;
      this.takes.reused += 1;
      if (!kept.el) {
        this.restoreFor(e);
        return true;
      }
      if (e.shown !== kept.el) this.putStill(e, kept.el);
      this.afterTake(e);
      for (const fn of this.stillListeners) fn(e.id, true);
      return true;
    }
    const a = e.target.article;
    const walk: WalkHooks = {
      // a body under its stand-in is out of the render tree: back in (transparent) for the walk only
      enter: () => {
        if (hiddenView(e.view)) a.setAttribute(STILL_WALK_ATTR, '');
      },
      leave: () => a.removeAttribute(STILL_WALK_ATTR),
    };
    const c: Current = {
      e,
      job: this.job(e.target.body, walk),
      sig,
      gen: e.gen,
      t0: this.now(),
      waiting: false,
      slices: 0,
      sliceMax: 0,
      phaseMax: {},
      marks: {},
    };
    e.job = c;
    this.queue.push(c);
    return true;
  }

  /** Decode the entry's kept still from the encoded tier and stand it in (a failed decode: drawn again). */
  private restoreFor(e: Entry): void {
    if (e.restoring) return;
    e.restoring = true;
    void this.cache
      .restore(e.id, (k) => this.entries.has(k))
      .then((el) => {
        e.restoring = false;
        if (this.entries.get(e.id) !== e) return;
        if (!el) {
          e.dirty = true;
          e.readyAt = this.now();
          this.schedulePump();
          return;
        }
        if (!e.shown) this.putStill(e, el);
        this.afterTake(e);
        for (const fn of this.stillListeners) fn(e.id, true);
      });
  }

  private finishJob(c: Current): void {
    const e = c.e;
    if (e.job === c) e.job = null;
    const still = c.job.result;
    const dt = this.now() - c.t0;
    this.takes.n += 1;
    this.takes.ms += dt;
    this.takes.max = Math.max(this.takes.max, dt);
    c.marks.end = Math.round(dt);
    this.traces.push({
      id: e.id,
      view: e.view,
      slices: c.slices,
      sliceMax: Math.round(c.sliceMax * 10) / 10,
      phaseMax: c.phaseMax,
      marks: c.marks,
    });
    if (this.traces.length > 64) this.traces.shift();
    if (this.entries.get(e.id) !== e) {
      still?.remove();
      for (const fn of this.stillListeners) fn(e.id, false);
      return;
    }
    // changed while it was drawn: shown (better than a cover), drawn again once the change settles
    const current = e.gen === c.gen;
    if (current) e.dirty = false;
    if (still) {
      this.cache.set(e.id, still, current ? c.sig : '', this.sizeOf(still), (k) =>
        this.entries.has(k)
      );
      this.putStill(e, still);
    }
    this.afterTake(e);
    for (const fn of this.stillListeners) fn(e.id, !!still);
  }

  private nextToTake(): Entry | null {
    const t = this.now();
    let soonest = Number.POSITIVE_INFINITY;
    let bestRank = 99;
    let best: Entry[] = [];
    for (const e of this.entries.values()) {
      if (!e.dirty || e.job) continue;
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
      if (e.readyAt > t) {
        soonest = Math.min(soonest, e.readyAt);
        continue;
      }
      // a cover on screen first, then a missing still on screen, a stale one, then the prefetch ring
      const rank = (this.visibleOf(e) ? 0 : 3) + (covered ? 0 : e.shown ? 2 : 1);
      if (rank < bestRank) {
        bestRank = rank;
        best = [e];
      } else if (rank === bestRank) best.push(e);
    }
    if (!best.length) {
      if (soonest < Number.POSITIVE_INFINITY && this.readyTimer === null)
        this.readyTimer = this.later(() => {
          this.readyTimer = null;
          this.schedulePump();
        }, soonest - t);
      return null;
    }
    if (best.length === 1) return best[0] as Entry;
    // nearest the centre of the view first
    const W = typeof innerWidth === 'number' ? innerWidth : 0;
    const H = typeof innerHeight === 'number' ? innerHeight : 0;
    let pick = best[0] as Entry;
    let d0 = Number.POSITIVE_INFINITY;
    for (const e of best) {
      const r = e.target.article.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - W / 2, r.top + r.height / 2 - H / 2) || 0;
      if (d < d0) {
        d0 = d;
        pick = e;
      }
    }
    return pick;
  }

  /** A still came in: a cover becomes it (mid-pan too), a live artboard under the cut swaps to it (the one change). */
  private afterTake(e: Entry): void {
    if (this.zooming) return;
    this.reconcile(e, this.gestureZoom !== null);
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

function defaultObserve(
  el: HTMLElement,
  onChange: (why?: string) => void
): MutationObserver | null {
  if (typeof MutationObserver !== 'function') return null;
  const mo = new MutationObserver((list) => {
    if (list.some(isPaintMutation)) onChange();
  });
  mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
  // a picture that came in (load does not bubble: capture)
  const onLoad = () => onChange('load');
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
.dc-artboard[${STILL_ATTR}='still']:not([${STILL_WALK_ATTR}]) > .dc-artboard-body > *,
.dc-artboard[${STILL_ATTR}='cover']:not([${STILL_WALK_ATTR}]) > .dc-artboard-body > * { display: none !important; }
.dc-artboard[${STILL_WALK_ATTR}] > .dc-artboard-body { opacity: 0; }
.dc-artboard[${STILL_ATTR}='reveal'] > .${STILL_CLASS} { opacity: 0; transition: opacity ${STILL_REVEAL_MS}ms linear; }
`;
