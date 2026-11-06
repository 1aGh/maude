/**
 * @file       artboard-still.ts — 2.0.7: small artboards show a still picture while the canvas zooms
 * @scope      apps/studio/artboard-still.ts (React-free; wired by artboard-live-gate.tsx, fed by canvas-lib.tsx)
 * @purpose    Michal (decision `v2-michal-207-overview-still-during-gesture`): on a heavy canvas at overview zoom,
 *             an artboard smaller than about `STILL_MAX_SCREEN_PX` on screen shows a still picture of itself instead
 *             of its live content — only while a zoom is running. The live DOM stays mounted (hidden with
 *             `visibility`, so layout, ids and the selection keep working) and comes back on the settle.
 *
 *             Why: WebKit repaints every on-screen artboard at each scale step. On the mascot canvas at 10 % that
 *             is ~8.5k mounted SVG and HTML elements a frame (277–564 ms zoom frames in Safari, 17–33 ms in
 *             Chromium, spike `207-mascot-webkit-gesture-quiet`). A still is one bitmap per artboard.
 *
 *             The still is drawn in this canvas document (`drawStill`, artboard-still-raster.ts) once an artboard
 *             has settled on screen, and redrawn after its DOM changes. It lives in memory only, like the
 *             placeholder picture (artboard-placeholder.ts): never on disk and never in the canvas origin's
 *             storage. An artboard with no still yet stays live — a still that does not exist cannot match what
 *             was just shown, and the own-colour placeholder would be a visible jump.
 *
 *             Never swapped: the active artboard and the one holding the selection (`pinned`, the shell works in
 *             their DOM), video artboards (`eager`, their media follows the ring — `v2-207-eager-video-media-follows-ring`).
 *             Only a ZOOM engages it: a pure pan keeps its painted tiles in WebKit, so swapping would only add a
 *             repaint at its settle. The restore on the settle costs nothing extra: a zoom's settle re-rasters
 *             the world crisp anyway (canvas-lib `writeTransform({ crisp })`).
 *
 *             Where: WebKit only, and only while the on-screen mounted DOM is heavy (`STILL_MIN_ON_SCREEN_NODES`).
 *             Chromium rasterizes on the GPU and its zoom frames are already under 34 ms on the same canvas.
 */

/** An artboard narrower than this on screen (CSS px) shows its still during a zoom. One constant (Michal: ~120). */
export const STILL_MAX_SCREEN_PX = 200;
/**
 * How many artboards go live again per frame after the settle (nearest the centre first). All at once was one
 * 350 ms WebKit frame on the mascot canvas; a few per frame keep each settle frame short. The still matches, so the
 * hand-over is not visible.
 */
export const STILL_RESTORE_PER_FRAME = 4;
/** Stills are drawn for artboards up to this many times the threshold (a zoom-out reaches them next). */
export const STILL_PREPARE_FACTOR = 2;
/** Only while the artboards on screen hold at least this many mounted elements (the mascot canvas: ~8.5k). */
export const STILL_MIN_ON_SCREEN_NODES = 3000;
/** How long the canvas must be still before a still is drawn (ms) — never during or right after a gesture. */
export const STILL_TAKE_DELAY_MS = 600;
/** Gap between two drawings (ms): one artboard at a time, so drawing never blocks a frame for long. */
export const STILL_TAKE_GAP_MS = 50;
/** The attribute the article carries while its still stands in. */
export const STILL_ATTR = 'data-dc-still';
/** The class of the still element (a `<canvas>` appended to the article). */
export const STILL_CLASS = 'dc-artboard-still';
/** The frame parameter that forces the feature on or off (`?artboard-still=on|off`, tests and A/B runs). */
export const STILL_PARAM = 'artboard-still';

export type StillMode = 'on' | 'off';

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

/** May this artboard stand in as its still right now? */
export function stillEligible(s: {
  /** the artboard's width in its own (world) px */
  width: number;
  zoom: number;
  pinned: boolean;
  eager: boolean;
  hasStill: boolean;
  /**
   * already showing its still this gesture: it stays a still until the settle, however far the zoom goes (a
   * mid-gesture hand-back would repaint it at once — the cost this avoids; a zoomed-in still is soft, like
   * WebKit's own scaled tiles mid-pinch, and is crisp again on the settle)
   */
  showing?: boolean;
}): boolean {
  if (s.pinned || s.eager || !s.hasStill) return false;
  if (s.showing) return true;
  if (!(s.width > 0) || !(s.zoom > 0)) return false;
  return s.width * s.zoom < STILL_MAX_SCREEN_PX;
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

/** What the controller needs from one artboard's DOM (an adapter, so tests need no canvas). */
export interface StillTarget {
  article: HTMLElement;
  body: HTMLElement;
}

interface Entry {
  target: StillTarget;
  pinned: boolean;
  eager: boolean;
  visible: boolean;
  weight: number;
  still: HTMLElement | null;
  dirty: boolean;
  showing: boolean;
  observer: MutationObserver | null;
}

export interface StillControllerOptions {
  /** Draw a still of `body` (null when it cannot). Async: inline SVGs load as images. */
  take: (body: HTMLElement) => Promise<HTMLElement | null>;
  later?: (fn: () => void, ms: number) => unknown;
  /** the next animation frame (the staggered restore) */
  frame?: (fn: () => void) => unknown;
  cancel?: (handle: unknown) => void;
  /** observe DOM changes (null in tests that do not need it) */
  observe?: ((el: HTMLElement, onChange: () => void) => MutationObserver | null) | null;
  /** on screen + mounted weight, from the mount ring (default: what `update` was told) */
  info?: (id: string) => { visible: boolean; weight: number } | null;
  minNodes?: number;
}

/**
 * One per canvas document. Artboards register while their children are mounted; the viewport reports every
 * zoom it writes (`noteZoom`, per frame of a gesture) and the settle (`settle`). Stills are drawn when the
 * canvas has been quiet for `STILL_TAKE_DELAY_MS`, one artboard at a time.
 */
export class StillController {
  private entries = new Map<string, Entry>();
  private zoom = 1;
  private gestureZoom: number | null = null;
  private engaged = false;
  private timer: unknown = null;
  private taking = false;
  /** drawings so far, their total and longest wall time (ms) — diagnostics */
  private takes = { n: 0, ms: 0, max: 0 };
  private readonly take: StillControllerOptions['take'];
  private readonly later: (fn: () => void, ms: number) => unknown;
  private readonly frame: (fn: () => void) => unknown;
  private restoring: Entry[] = [];
  private restoreScheduled = false;
  private readonly cancel: (h: unknown) => void;
  private readonly observe: StillControllerOptions['observe'];
  private readonly info: StillControllerOptions['info'];
  readonly minNodes: number;

  constructor(o: StillControllerOptions) {
    this.take = o.take;
    this.later = o.later ?? ((fn, ms) => setTimeout(fn, ms));
    this.frame =
      o.frame ??
      ((fn) =>
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(fn)
          : setTimeout(fn, 16));
    this.cancel = o.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.observe = o.observe === undefined ? defaultObserve : o.observe;
    this.info = o.info;
    this.minNodes = o.minNodes ?? STILL_MIN_ON_SCREEN_NODES;
  }

  private visibleOf(id: string, e: Entry): boolean {
    return this.info ? !!this.info(id)?.visible : e.visible;
  }

  private weightOf(id: string, e: Entry): number {
    return this.info ? (this.info(id)?.weight ?? 0) : e.weight;
  }

  /** The settled (published) zoom — the one a gesture starts from. Ignored mid-gesture. */
  setZoom(zoom: number): void {
    if (zoom > 0 && this.gestureZoom === null) this.zoom = zoom;
  }

  register(id: string, target: StillTarget): () => void {
    this.unregister(id);
    const e: Entry = {
      target,
      pinned: false,
      eager: false,
      visible: false,
      weight: 0,
      still: null,
      dirty: true,
      showing: false,
      observer: null,
    };
    e.observer = this.observe ? this.observe(target.body, () => this.markDirty(id)) : null;
    this.entries.set(id, e);
    this.scheduleTake();
    return () => {
      if (this.entries.get(id) === e) this.unregister(id);
    };
  }

  private unregister(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.hide(e);
    e.observer?.disconnect();
    e.still?.remove();
    this.entries.delete(id);
  }

  update(
    id: string,
    s: Partial<{ pinned: boolean; eager: boolean; visible: boolean; weight: number }>
  ): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (s.pinned !== undefined) e.pinned = s.pinned;
    if (s.eager !== undefined) e.eager = s.eager;
    if (s.visible !== undefined) e.visible = s.visible;
    if (s.weight !== undefined && Number.isFinite(s.weight)) e.weight = s.weight;
    // the selection lands mid-gesture: its artboard goes live at once
    if (e.showing && (e.pinned || e.eager)) this.hide(e);
    this.scheduleTake();
  }

  /** The content changed (a DOM mutation, a wake or a sleep): the still is redrawn before it is used again. */
  markDirty(id: string, _why?: string): void {
    const e = this.entries.get(id);
    if (!e || e.dirty) return;
    e.dirty = true;
    this.scheduleTake();
  }

  /** Elements mounted in the artboards on screen. */
  onScreenWeight(): number {
    let n = 0;
    for (const [id, e] of this.entries) if (this.visibleOf(id, e)) n += this.weightOf(id, e);
    return n;
  }

  heavy(): boolean {
    return this.onScreenWeight() >= this.minNodes;
  }

  /** The viewport wrote this zoom (every frame of a gesture, and every programmatic move). */
  noteZoom(zoom: number): void {
    if (!(zoom > 0)) return;
    if (this.gestureZoom === null) {
      // the first write of a gesture: remember where it started; nothing swaps for a pure pan
      this.gestureZoom = this.zoom;
      this.stopTaking();
      // a new gesture before the restore finished: what is still a still stays one until this one settles
      this.restoring = [];
    }
    this.zoom = zoom;
    if (!this.engaged) {
      if (zoom === this.gestureZoom || !this.heavy()) return;
      this.engaged = true;
    }
    for (const e of this.entries.values()) this.apply(e);
  }

  /**
   * The gesture settled: every artboard goes live again (its DOM never left), `STILL_RESTORE_PER_FRAME` per
   * frame, nearest the viewport centre first. Stills are redrawn later, once it is quiet.
   */
  settle(zoom?: number): void {
    if (zoom !== undefined && zoom > 0) this.zoom = zoom;
    this.gestureZoom = null;
    this.engaged = false;
    const showing = [...this.entries.values()].filter((e) => e.showing);
    if (showing.length) {
      const W = typeof innerWidth === 'number' ? innerWidth : 0;
      const H = typeof innerHeight === 'number' ? innerHeight : 0;
      const dist = new Map<Entry, number>();
      for (const e of showing) {
        const r = e.target.article.getBoundingClientRect();
        dist.set(e, Math.hypot(r.left + r.width / 2 - W / 2, r.top + r.height / 2 - H / 2) || 0);
      }
      showing.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
      this.restoring = showing;
      this.restoreStep();
    }
    this.scheduleTake();
  }

  /** Hand back the next few artboards now, the rest on the next frames. */
  private restoreStep(): void {
    const batch = this.restoring.splice(0, STILL_RESTORE_PER_FRAME);
    for (const e of batch) this.hide(e);
    if (!this.restoring.length || this.restoreScheduled) return;
    this.restoreScheduled = true;
    this.frame(() => {
      this.restoreScheduled = false;
      if (this.gestureZoom === null) this.restoreStep();
    });
  }

  /** Test / diagnostics view. */
  stats(): {
    registered: number;
    withStill: number;
    showing: number;
    engaged: boolean;
    onScreenNodes: number;
    takes: { n: number; ms: number; max: number };
  } {
    let withStill = 0;
    let showing = 0;
    for (const e of this.entries.values()) {
      if (e.still) withStill += 1;
      if (e.showing) showing += 1;
    }
    return {
      registered: this.entries.size,
      withStill,
      showing,
      engaged: this.engaged,
      onScreenNodes: this.onScreenWeight(),
      takes: { ...this.takes, ms: Math.round(this.takes.ms), max: Math.round(this.takes.max) },
    };
  }

  isShowing(id: string): boolean {
    return !!this.entries.get(id)?.showing;
  }

  private apply(e: Entry): void {
    const ok = stillEligible({
      width: e.target.article.offsetWidth,
      zoom: this.zoom,
      pinned: e.pinned,
      eager: e.eager,
      hasStill: !!e.still,
      showing: e.showing,
    });
    if (ok && !e.showing) this.show(e);
    else if (!ok && e.showing) this.hide(e);
  }

  private show(e: Entry): void {
    if (!e.still) return;
    e.showing = true;
    e.target.article.setAttribute(STILL_ATTR, '');
  }

  private hide(e: Entry): void {
    if (!e.showing) return;
    e.showing = false;
    e.target.article.removeAttribute(STILL_ATTR);
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

  private nextToTake(): [string, Entry] | null {
    let best: [string, Entry] | null = null;
    for (const kv of this.entries) {
      const e = kv[1];
      if (!e.dirty) continue;
      const want = stillWanted({
        width: e.target.article.offsetWidth,
        zoom: this.zoom,
        pinned: e.pinned,
        eager: e.eager,
      });
      if (!want) continue;
      // on screen before the prefetch ring, a missing still before a stale one
      const rank = (x: [string, Entry]) =>
        (this.visibleOf(x[0], x[1]) ? 0 : 2) + (x[1].still ? 1 : 0);
      if (!best || rank(kv) < rank(best)) best = kv;
    }
    return best;
  }

  private async takeNext(): Promise<void> {
    if (this.gestureZoom !== null || !this.heavy()) return;
    const next = this.nextToTake();
    if (!next) return;
    const [id, e] = next;
    this.taking = true;
    let still: HTMLElement | null = null;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      still = await this.take(e.target.body);
    } catch {
      still = null;
    } finally {
      this.taking = false;
      const dt = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      this.takes.n += 1;
      this.takes.ms += dt;
      this.takes.max = Math.max(this.takes.max, dt);
    }
    if (this.entries.get(id) !== e) {
      still?.remove();
      return;
    }
    // a gesture that started while we drew: keep the old still for this one, try again after the settle
    if (this.gestureZoom !== null) {
      still?.remove();
      return;
    }
    e.dirty = false;
    if (still) {
      still.classList.add(STILL_CLASS);
      place(still, e.target);
      e.still?.remove();
      e.target.article.appendChild(still);
      e.still = still;
    }
    this.scheduleTake(STILL_TAKE_GAP_MS);
  }
}

/** Put the still over the body: same offset and size inside the (positioned) article. */
function place(still: HTMLElement, t: StillTarget): void {
  const st = still.style;
  st.left = `${t.body.offsetLeft}px`;
  st.top = `${t.body.offsetTop}px`;
  st.width = `${t.body.offsetWidth}px`;
  st.height = `${t.body.offsetHeight}px`;
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

/** The still's CSS (folded into the canvas-lib stylesheet with ARTBOARD_LIVE_CSS). */
export const ARTBOARD_STILL_CSS = `
.dc-artboard > .${STILL_CLASS} { display: none; position: absolute; pointer-events: none; }
.dc-artboard[${STILL_ATTR}] > .${STILL_CLASS} { display: block; }
.dc-artboard[${STILL_ATTR}] > .dc-artboard-body { visibility: hidden; }
`;
