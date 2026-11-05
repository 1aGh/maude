/**
 * @file       artboard-webgl.ts — 2.0.5: the per-canvas WebGL context budget
 * @scope      apps/studio/artboard-webgl.ts (DOM half of artboard-live.ts `planWebgl`)
 * @purpose    A canvas of 88 three.js artboards created 88 WebGL contexts; the browsers drop the oldest past
 *             ~16 and WebKit kills the page long before memory runs out. Every WebGL context a canvas creates
 *             is tracked here (a `getContext` wrapper, installed only when artboards may sleep — never in a
 *             capture). At most `WEBGL_LIVE_CAP` stay live: those of live artboards nearest the viewport
 *             centre. The rest are released through `WEBGL_lose_context` and restored when their artboard is
 *             live again.
 *
 *             What a released canvas shows: its last frame, in an overlay laid ABOVE the canvas while the
 *             canvas itself is `visibility: hidden` — Blink paints its own lost-context icon over a lost WebGL
 *             canvas, so a picture under it (the first 2.0.5 build used the canvas's CSS background) never
 *             shows. A context created past the cap (one React commit mounts every artboard of a canvas opened
 *             zoomed out) is released at once, before it drew — the browser would otherwise drop the oldest
 *             for good. Such a never-awake artboard gets its first frame read later, ONE context at a time and
 *             only while the cap has room ("priming": restore, let the page draw a few frames, read, release).
 *             A page that never draws while asleep sleeps as a placeholder with the artboard's name.
 *
 *             We cancel the `webglcontextlost` of a loss WE caused (that is what lets `restoreContext()` work)
 *             and leave a loss the browser caused to the page. three.js re-initialises on
 *             `webglcontextrestored` by itself; raw WebGL code must listen for it (or gate its loop on
 *             `useArtboardActive()`) — the canvas plugin docs say so.
 */

import { type GlCandidate, planWebgl, WEBGL_LIVE_CAP } from './artboard-live.ts';

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type LoseExt = { loseContext(): void; restoreContext(): void };

interface Entry {
  key: number;
  canvas: HTMLCanvasElement;
  ext: LoseExt | null;
  /**
   * live · lost by us · being lost (reading its frame first) · restored only to read a first frame ·
   * lost by the browser.
   */
  state: 'live' | 'ours' | 'losing' | 'priming' | 'browser';
  lastLive: number;
  /** The last frame read from it (a data URL), kept across wakes as a fallback. */
  snap: string | null;
  /** No frame could be read (the page drew nothing): it sleeps as a placeholder until it wakes. */
  noFrame: boolean;
  /** The picture above the hidden canvas while it sleeps. */
  overlay: HTMLDivElement | null;
  /** We called `loseContext()` and have not restored it since. */
  glLost: boolean;
  /** …and its `webglcontextlost` has not come yet. */
  pendingLoss: boolean;
  /**
   * Our loss event has come (and was cancelled): only now does `restoreContext()` work — called earlier it
   * fails silently and the page never draws again. A restore asked for before it waits for the event.
   */
  lostSeen: boolean;
  /** The canvas's own inline `visibility`, put back when it shows again. */
  savedVisibility: string | null;
  watchers: { ro: ResizeObserver | null; mo: MutationObserver | null } | null;
  /** The most recent drawn frame of it while live (a page that stops drawing when asleep has no fresh one). */
  keeper: FrameKeeper | null;
  /** Frames until its next keep (the first comes soon after it wakes). */
  sampleIn: number;
}

/** Holds the most recent drawn frame of a live canvas: a GPU copy, encoded only when it is needed. */
export interface FrameKeeper {
  /** Copy the canvas's current frame in; `false` (the older copy kept) when the canvas is blank. */
  copy(canvas: HTMLCanvasElement): boolean;
  /** The kept frame as an image URL, or `null` when none was kept. */
  url(): string | null;
}

export interface WebglBudgetOptions {
  /** Read the canvas's current frame as an image URL; `null` when there is nothing (blank) to read. */
  readFrame?: (canvas: HTMLCanvasElement) => string | null;
  /** A keeper per sampled canvas (default: two ≤640 px 2D canvases). */
  keeper?: () => FrameKeeper;
  /** Run `fn` at the next animation frame. */
  frame?: (fn: () => void) => void;
  /** Pause between two first-frame reads (default `PRIME_GAP_MS`). */
  primeGapMs?: number;
}

const SNAPSHOT_MAX = 640;
/** Frames to wait for a page to draw before giving up on a frame (WebKit reads blank until it composited). */
const READ_FRAMES = 8;
/** A restored context gets this many frames to re-initialise and draw before the first read. */
const PRIME_SETTLE = 2;
/** Live contexts' frames are kept every this many frames (~1 s): one GPU copy + a 16 px readback each. */
const SAMPLE_EVERY = 60;
/** …the first one this many frames after it went live. */
const FIRST_SAMPLE = 10;
/** Pause between two first-frame reads: each restores a context, so the page re-initialises its scene. */
const PRIME_GAP_MS = 150;

/** Every pixel the same and transparent or black: the page has drawn nothing into it. */
function isBlank(data: Uint8ClampedArray): boolean {
  const [r, g, b, a] = [data[0], data[1], data[2], data[3]];
  if (!(a === 0 || (r === 0 && g === 0 && b === 0))) return false;
  for (let i = 4; i < data.length; i += 4)
    if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== a) return false;
  return true;
}

/** The default keeper: the frame is drawn into a scratch canvas, checked on a 16 px probe, then kept. */
export function canvasFrameKeeper(): FrameKeeper {
  let keep: HTMLCanvasElement | null = null;
  let scratch: HTMLCanvasElement | null = null;
  let probe: CanvasRenderingContext2D | null = null;
  return {
    copy(c) {
      if (!c.width || !c.height || typeof document === 'undefined') return false;
      try {
        const k = Math.min(1, SNAPSHOT_MAX / Math.max(c.width, c.height));
        const w = Math.max(1, Math.round(c.width * k));
        const h = Math.max(1, Math.round(c.height * k));
        scratch ??= document.createElement('canvas');
        if (scratch.width !== w || scratch.height !== h) {
          scratch.width = w;
          scratch.height = h;
        }
        const g = scratch.getContext('2d');
        if (!g) return false;
        g.clearRect(0, 0, w, h);
        g.drawImage(c, 0, 0, w, h);
        if (!probe) {
          const pc = document.createElement('canvas');
          pc.width = 16;
          pc.height = 16;
          probe = pc.getContext('2d', { willReadFrequently: true });
        }
        if (probe) {
          probe.clearRect(0, 0, 16, 16);
          probe.drawImage(scratch, 0, 0, 16, 16);
          if (isBlank(probe.getImageData(0, 0, 16, 16).data)) return false;
        }
        [keep, scratch] = [scratch, keep];
        return true;
      } catch {
        return false; // a tainted or unreadable canvas
      }
    },
    url() {
      try {
        return keep ? keep.toDataURL('image/png') : null;
      } catch {
        return null;
      }
    },
  };
}

/** The default `readFrame`: a ≤640 px PNG of the drawing buffer, or `null` when it is blank. */
export function readCanvasFrame(c: HTMLCanvasElement): string | null {
  const k = canvasFrameKeeper();
  return k.copy(c) ? k.url() : null;
}

function artboardName(c: HTMLCanvasElement): string {
  const board = c.closest('[data-dc-screen]');
  if (!board) return '';
  const label = board.querySelector('.dc-artboard-label');
  const text = label instanceof HTMLInputElement ? label.value : (label?.textContent ?? '').trim();
  return text || board.getAttribute('data-dc-screen') || '';
}

export class WebglBudget {
  private entries = new Map<number, Entry>();
  private byCanvas = new WeakMap<HTMLCanvasElement, Entry>();
  private seq = 0;
  private queued = false;
  private toPlace = new Set<Entry>();
  private placeQueued = false;
  private readonly readFrame: (c: HTMLCanvasElement) => string | null;
  private readonly frame: (fn: () => void) => void;
  private readonly newKeeper: () => FrameKeeper;
  private sampling = false;
  private readonly primeGapMs: number;
  private primeAfter = 0;
  private primeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly isLive: (artboardId: string | null) => boolean,
    private readonly cap: number = WEBGL_LIVE_CAP,
    opts: WebglBudgetOptions = {}
  ) {
    this.readFrame = opts.readFrame ?? readCanvasFrame;
    this.newKeeper = opts.keeper ?? canvasFrameKeeper;
    this.primeGapMs = opts.primeGapMs ?? PRIME_GAP_MS;
    this.frame =
      opts.frame ??
      ((fn) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
        else setTimeout(fn, 16);
      });
  }

  /** Wraps `HTMLCanvasElement.prototype.getContext` once per window. Returns the uninstall. */
  install(win: Window & typeof globalThis): () => void {
    const proto = win.HTMLCanvasElement?.prototype;
    if (!proto) return () => {};
    const orig = proto.getContext;
    const budget = this;
    const wrapped = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (ctx && typeof type === 'string' && /webgl/i.test(type)) budget.track(this, ctx as GL);
      return ctx;
    } as typeof proto.getContext;
    proto.getContext = wrapped;
    return () => {
      if (proto.getContext === wrapped) proto.getContext = orig;
    };
  }

  track(canvas: HTMLCanvasElement, gl: GL): void {
    if (this.byCanvas.has(canvas)) return;
    let ext: LoseExt | null = null;
    try {
      ext = (gl.getExtension('WEBGL_lose_context') as LoseExt | null) ?? null;
    } catch {
      ext = null;
    }
    const e: Entry = {
      key: ++this.seq,
      canvas,
      ext,
      state: 'live',
      lastLive: Date.now(),
      snap: null,
      noFrame: false,
      overlay: null,
      glLost: false,
      pendingLoss: false,
      lostSeen: false,
      savedVisibility: null,
      watchers: null,
      keeper: null,
      sampleIn: FIRST_SAMPLE,
    };
    this.entries.set(e.key, e);
    this.byCanvas.set(canvas, e);
    canvas.addEventListener('webglcontextlost', (ev) => {
      if (!e.pendingLoss) {
        e.state = 'browser';
        return;
      }
      ev.preventDefault();
      e.pendingLoss = false;
      // The browser allows a restore only once this dispatch has returned (Blink reads `defaultPrevented`
      // after it; a microtask still runs inside it), so act a task later.
      setTimeout(() => {
        e.lostSeen = true;
        // Asked back (woken, or picked for a first-frame read) before the loss even arrived: restore now.
        if (e.state === 'live' || e.state === 'priming') this.restoreNow(e);
        else this.update(); // it can be primed now
      }, 0);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (e.state === 'browser') e.state = 'live';
    });
    if (ext) this.evictOverCap(e);
    // Created while the page builds: plan once the current task (the whole React commit) is done.
    this.update();
  }

  /** Re-plan soon (coalesced to one microtask). */
  update(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.apply();
    });
  }

  stats(): { tracked: number; live: number; lost: number } {
    let live = 0;
    for (const e of this.entries.values()) if (e.state === 'live') live += 1;
    return { tracked: this.entries.size, live, lost: this.entries.size - live };
  }

  /** Plan and act now. */
  apply(): void {
    const win = typeof window === 'undefined' ? null : window;
    const cx = (win?.innerWidth ?? 0) / 2;
    const cy = (win?.innerHeight ?? 0) / 2;
    const now = Date.now();
    const cands: GlCandidate[] = [];
    for (const e of [...this.entries.values()]) {
      if (!e.canvas.isConnected) {
        // Unmounted (a light-mode artboard, a re-render): free its context instead of waiting for GC.
        this.drop(e);
        continue;
      }
      if (e.state === 'browser' || !e.ext) continue;
      const board = e.canvas.closest('[data-dc-screen]');
      const live = this.isLive(board ? board.getAttribute('data-dc-screen') : null);
      const r = e.canvas.getBoundingClientRect();
      const distance = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      cands.push({ key: e.key, live, distance, lastLive: e.lastLive, lost: e.state !== 'live' });
    }
    const { lose, restore } = planWebgl(cands, this.cap);
    for (const key of lose) {
      const e = this.entries.get(key);
      if (e?.state === 'live') this.loseWithSnapshot(e);
    }
    const restoring = new Set(restore);
    for (const e of this.entries.values()) {
      // Live artboards come first: a first-frame read gives its slot back (and is tried again later).
      if (restore.length && e.state === 'priming' && !restoring.has(e.key)) {
        this.cover(e);
        this.loseNow(e);
      }
    }
    for (const key of restore) {
      const e = this.entries.get(key);
      if (e) this.restore(e, now);
    }
    for (const c of cands) {
      const e = this.entries.get(c.key);
      if (e && e.state === 'live') e.lastLive = now;
    }
    if (this.busy() > 0) this.sample();
    // A never-awake artboard: read its first frame, one context at a time, while the cap has room.
    const primeWait = this.primeAfter - now;
    if (primeWait > 0) {
      if (!this.primeTimer)
        this.primeTimer = setTimeout(() => {
          this.primeTimer = null;
          this.update();
        }, primeWait);
    } else if (
      this.busy() < this.cap &&
      ![...this.entries.values()].some((e) => e.state === 'priming')
    ) {
      const next = cands
        .filter((c) => {
          const e = this.entries.get(c.key);
          return (
            e?.state === 'ours' && e.lostSeen && !e.snap && !e.noFrame && !restoring.has(c.key)
          );
        })
        .sort((a, b) => a.distance - b.distance)[0];
      const e = next && this.entries.get(next.key);
      if (e) this.prime(e);
    }
  }

  /** While any context is live: keep its frame every `SAMPLE_EVERY` frames (after the page drew it). */
  private sample(): void {
    if (this.sampling) return;
    this.sampling = true;
    const step = () => {
      let any = false;
      for (const e of this.entries.values()) {
        if (e.state !== 'live' || e.glLost || !e.canvas.isConnected) continue;
        any = true;
        e.sampleIn -= 1;
        if (e.sampleIn <= 0) {
          e.sampleIn = SAMPLE_EVERY;
          e.keeper ??= this.newKeeper();
          e.keeper.copy(e.canvas);
        }
      }
      if (!any) {
        this.sampling = false;
        return;
      }
      this.frame(step);
    };
    this.frame(step);
  }

  /** Contexts holding a slot: live, about to be lost, or restored to read a frame. */
  private busy(): number {
    let n = 0;
    for (const e of this.entries.values())
      if (e.state === 'live' || e.state === 'losing' || e.state === 'priming') n += 1;
    return n;
  }

  /**
   * Past the cap at creation: release one now — a not-live artboard's first, oldest first, never the one
   * just created (its page is still initialising it). It has drawn nothing yet; it is primed later.
   */
  private evictOverCap(fresh: Entry): void {
    if (this.busy() <= this.cap) return;
    let victim: Entry | null = null;
    let victimLive = true;
    for (const e of this.entries.values()) {
      if (e === fresh || !e.ext) continue;
      if (e.state !== 'live' && e.state !== 'losing' && e.state !== 'priming') continue;
      const board = e.canvas.closest('[data-dc-screen]');
      const live = this.isLive(board ? board.getAttribute('data-dc-screen') : null);
      if (!victim || (victimLive && !live)) {
        victim = e;
        victimLive = live;
      }
    }
    if (!victim) return;
    this.cover(victim);
    this.loseNow(victim);
  }

  /** Read its frame (waiting up to `READ_FRAMES` for one), cover the canvas with it, release the context. */
  private loseWithSnapshot(e: Entry): void {
    e.state = 'losing';
    this.readThenLose(e, 'losing', 1);
  }

  /** Restore a never-awake context only to read its first frame, then release it again. */
  private prime(e: Entry): void {
    e.state = 'priming';
    this.cover(e); // the placeholder stays on top while it draws
    this.showCanvas(e); // …but the canvas must paint, or WebKit has no frame to read
    if (!this.restoreNow(e)) {
      e.noFrame = true;
      this.cover(e);
      this.hideCanvas(e);
      e.state = 'ours';
      return;
    }
    this.readThenLose(e, 'priming', PRIME_SETTLE);
  }

  private readThenLose(e: Entry, as: 'losing' | 'priming', from: number): void {
    let n = 0;
    const step = () => {
      if (e.state !== as) return; // restored (or dropped) before the frame came
      n += 1;
      if (n >= from) {
        // In a frame our callback runs after the page's own render loop (it registered first), so the
        // drawing buffer still holds the frame the page just drew.
        const url = e.canvas.isConnected ? this.readFrame(e.canvas) : null;
        if (url) {
          e.snap = url;
          e.noFrame = false;
        } else if (n < from + READ_FRAMES) {
          this.frame(step);
          return;
        } else {
          // Nothing fresh (a page that stops drawing once asleep): the frame kept while it was live.
          const kept = e.keeper?.url() ?? null;
          if (kept) e.snap = kept;
          else if (!e.snap) e.noFrame = true;
        }
        e.keeper = null;
        this.cover(e);
        this.loseNow(e);
        // A slot is free: the next never-awake one can be primed — after a pause, so a canvas opened
        // zoomed out fills in over a few seconds instead of re-initialising every scene at once.
        if (as === 'priming') this.primeAfter = Date.now() + this.primeGapMs;
        this.update();
        return;
      }
      this.frame(step);
    };
    this.frame(step);
  }

  private loseNow(e: Entry): void {
    e.state = 'ours';
    this.hideCanvas(e);
    if (e.glLost) return; // still lost from before (a wake that had not come through yet)
    e.glLost = true;
    e.pendingLoss = true;
    try {
      e.ext?.loseContext();
    } catch {
      e.pendingLoss = false; // already lost
    }
  }

  /** `restoreContext()` once our loss event has come; before it, the event handler does it. */
  private restoreNow(e: Entry): boolean {
    if (!e.lostSeen) return true;
    e.lostSeen = false;
    e.glLost = false;
    try {
      e.ext?.restoreContext();
      return true;
    } catch {
      return false; // not restorable — the page keeps a blank canvas until it rebuilds
    }
  }

  private restore(e: Entry, now: number): void {
    if (e.state === 'losing') {
      e.state = 'live';
      return;
    }
    if (e.state !== 'ours' && e.state !== 'priming') return;
    const wasPriming = e.state === 'priming';
    e.state = 'live';
    e.lastLive = now;
    e.noFrame = false;
    e.sampleIn = FIRST_SAMPLE;
    this.showCanvas(e);
    if (!wasPriming) this.restoreNow(e);
    // Leave the picture above the canvas until the page has drawn again.
    this.frame(() => this.frame(() => this.uncover(e)));
  }

  private drop(e: Entry): void {
    this.entries.delete(e.key);
    this.uncover(e, true);
    if (e.state === 'live' || e.state === 'losing' || e.state === 'priming') {
      e.state = 'ours';
      try {
        e.ext?.loseContext();
      } catch {
        /* already lost */
      }
    }
  }

  // ── the picture above a sleeping canvas ─────────────────────────────────────────────────────────

  /** Lay (or refresh) the overlay right after the canvas: its last frame, or a placeholder with a name. */
  private cover(e: Entry): void {
    const c = e.canvas;
    const parent = c.parentNode;
    if (!parent || typeof document === 'undefined') return;
    let o = e.overlay;
    if (!o) {
      o = document.createElement('div');
      o.setAttribute('aria-hidden', 'true');
      const s = o.style;
      s.position = 'absolute';
      s.pointerEvents = 'none';
      s.boxSizing = 'border-box';
      s.margin = '0';
      s.overflow = 'hidden';
      s.display = 'flex';
      s.alignItems = 'center';
      s.justifyContent = 'center';
      s.textAlign = 'center';
      e.overlay = o;
    }
    if (o.parentNode !== parent || o.previousSibling !== c) parent.insertBefore(o, c.nextSibling);
    const s = o.style;
    if (e.snap) {
      o.setAttribute('data-dc-gl-snapshot', 'frame');
      o.textContent = '';
      s.backgroundColor = 'transparent';
      s.backgroundImage = `url("${e.snap}")`;
      s.backgroundSize = '100% 100%';
      s.backgroundRepeat = 'no-repeat';
    } else {
      // The same quiet tile in either theme: a neutral wash, the name in the artboard's own text colour.
      o.setAttribute('data-dc-gl-snapshot', 'placeholder');
      o.textContent = artboardName(c);
      s.backgroundImage = 'none';
      s.backgroundColor = 'rgb(128 128 128 / 0.14)';
      s.color = 'rgb(128 128 128)';
      s.font = '500 14px/1.3 system-ui, sans-serif';
      s.padding = '8px';
    }
    this.schedulePlace(e);
    if (!e.watchers) {
      const ro =
        typeof ResizeObserver === 'function'
          ? new ResizeObserver(() => this.schedulePlace(e))
          : null;
      ro?.observe(c);
      const mo =
        typeof MutationObserver === 'function'
          ? new MutationObserver(() => {
              if (!c.isConnected) this.drop(e);
              else if (c.parentNode !== e.overlay?.parentNode) {
                // Moved by its page: follow it.
                const asleep = e.state !== 'live';
                this.uncover(e, true);
                if (asleep) {
                  this.cover(e);
                  this.hideCanvas(e);
                }
              }
            })
          : null;
      mo?.observe(parent, { childList: true });
      e.watchers = { ro, mo };
    }
  }

  /** Placement is batched (all reads, then all writes): a commit of 60 artboards forces two layouts, not 120. */
  private schedulePlace(e: Entry): void {
    this.toPlace.add(e);
    if (this.placeQueued) return;
    this.placeQueued = true;
    queueMicrotask(() => {
      this.placeQueued = false;
      const list = [...this.toPlace].filter((x) => x.overlay && x.canvas.isConnected);
      this.toPlace.clear();
      this.placeAll(list);
    });
  }

  /** Same box as the canvas, in the canvas's own containing block (corrected if it differs from offsetParent). */
  private placeAll(list: Entry[]): void {
    if (!list.length) return;
    try {
      const boxes = list.map((e) => {
        const c = e.canvas;
        return {
          left: c.offsetLeft,
          top: c.offsetTop,
          w: c.offsetWidth,
          h: c.offsetHeight,
          radius: getComputedStyle(c).borderRadius,
        };
      });
      list.forEach((e, i) => {
        const b = boxes[i];
        const s = (e.overlay as HTMLDivElement).style;
        if (!b) return;
        s.left = `${b.left}px`;
        s.top = `${b.top}px`;
        s.width = `${b.w}px`;
        s.height = `${b.h}px`;
        s.borderRadius = b.radius;
        if (!e.snap) s.fontSize = `${Math.max(12, Math.round(b.w / 10))}px`;
      });
      const fixes = list.map((e) => {
        const o = e.overlay as HTMLDivElement;
        const cr = e.canvas.getBoundingClientRect();
        const or = o.getBoundingClientRect();
        if (!(or.width > 0 && o.offsetWidth > 0)) return null;
        const k = or.width / o.offsetWidth; // the artboard's zoom
        const dx = (cr.left - or.left) / k;
        const dy = (cr.top - or.top) / k;
        return Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ? { dx, dy } : null;
      });
      list.forEach((e, i) => {
        const f = fixes[i];
        const b = boxes[i];
        if (!f || !b) return;
        const s = (e.overlay as HTMLDivElement).style;
        s.left = `${b.left + f.dx}px`;
        s.top = `${b.top + f.dy}px`;
      });
    } catch {
      /* no layout (a test DOM): the offsets stand */
    }
  }

  private uncover(e: Entry, force = false): void {
    if (!force && e.state !== 'live') return;
    e.watchers?.ro?.disconnect();
    e.watchers?.mo?.disconnect();
    e.watchers = null;
    e.overlay?.remove();
    e.overlay = null;
    this.showCanvas(e);
  }

  /** Hidden while lost: nothing the browser paints for a lost context can show. */
  private hideCanvas(e: Entry): void {
    if (e.savedVisibility === null) e.savedVisibility = e.canvas.style.visibility;
    e.canvas.style.visibility = 'hidden';
  }

  private showCanvas(e: Entry): void {
    if (e.savedVisibility === null) return;
    e.canvas.style.visibility = e.savedVisibility;
    e.savedVisibility = null;
  }
}
