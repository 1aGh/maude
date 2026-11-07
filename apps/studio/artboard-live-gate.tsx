/**
 * @file       artboard-live-gate.tsx — 2.0.5: the React half of artboard-live.ts
 * @scope      apps/studio/artboard-live-gate.tsx (used by canvas-lib.tsx's DCArtboardBody + DesignCanvas)
 * @purpose    One `LiveRegistry` + one `WebglBudget` per canvas document, fed by three shared
 *             IntersectionObservers (prefetch ring, on screen, keep ring). `ArtboardLiveGate` wraps an
 *             artboard's children: it hands them `useArtboardActive()` / `useArtboardSeen()`, pauses the
 *             artboard's `<video>`s and CSS animations while it sleeps, and mounts the children only while the
 *             registry admits them. `holdAllLive()` is the in-frame export's guarantee: every artboard live
 *             for the capture.
 *
 *             2.0.7: in `sleep` too the children mount only while admitted (the mount ring: on screen + a
 *             prefetch ring, released when far, within a DOM budget). First mounts go through the registry's
 *             queue paced per frame, so it never blocks a pan or a zoom. What stands in is a same-size
 *             placeholder in the artboard's own colours (artboard-placeholder.ts) — never the bare frame,
 *             which on a dark design system is a black box.
 */

import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  type ArtboardLiveState,
  KEEP_MARGIN,
  type LiveMode,
  LiveRegistry,
  NEAR_MARGIN,
  resolveLiveMode,
} from './artboard-live.ts';
import {
  backgroundOf,
  canvasBackground,
  choosePlaceholder,
  knownBackground,
  rememberBackground,
  rememberPicture,
  subscribeCanvasBackground,
  takePicture,
} from './artboard-placeholder.ts';
import {
  ARTBOARD_STILL_CSS,
  inOverviewCut,
  resolveStillMode,
  StillController,
} from './artboard-still.ts';
import { rasterTimings, startStill } from './artboard-still-raster.ts';
import { StillWarmup, WARM_ENABLED } from './artboard-still-warmup.ts';
import { WebglBudget } from './artboard-webgl.ts';

const ALL_LIVE: ArtboardLiveState = { live: true, seen: true, media: true };
const LiveContext = createContext<ArtboardLiveState>(ALL_LIVE);

/**
 * May this artboard's media load (a Player, a `<video>` with its src)? Follows the mount ring: near or on screen,
 * kept inside the keep ring. A video artboard is mounted wherever it is (its comp registers itself), so a
 * `VideoComp` mounts its Player only while this holds — far away it fetches and decodes nothing (2.0.7). Always
 * `true` outside an artboard, in captures and exports.
 */
export function useArtboardMedia(): boolean {
  return useContext(LiveContext).media;
}

/**
 * Is this artboard running live? `false` while it is offscreen or the canvas is zoomed out to its overview —
 * pause a render loop, a video, a simulation. Always `true` outside an artboard, in captures and exports.
 */
export function useArtboardActive(): boolean {
  return useContext(LiveContext).live;
}

/**
 * Are this artboard's children mounted now (it is on screen or near it)? Gate an expensive first mount on it
 * (the design-system board's specimens do). Always `true` in captures and exports.
 */
export function useArtboardSeen(): boolean {
  return useContext(LiveContext).seen;
}

interface Runtime {
  registry: LiveRegistry;
  budget: WebglBudget | null;
  near: IntersectionObserver | null;
  visible: IntersectionObserver | null;
  keep: IntersectionObserver | null;
  ids: WeakMap<Element, string>;
  /** 2.0.7 — the overview level: artboards under the cut show their still (WebKit). */
  stills: StillController | null;
  /** 2.0.7 — draws the stills of artboards that never mounted, one at a time while nothing moves. */
  warmup: StillWarmup | null;
  /** the article of each observed artboard (the warm-up's distance and cut) */
  articles: Map<string, HTMLElement>;
}

/**
 * The runtime lives on the canvas DOCUMENT, not in this module. Each canvas module bundles its own copy of
 * canvas-lib (Bun.build inlines `@maude/canvas-lib`), so an edit's soft reload evaluates a fresh copy of this file:
 * a module-level runtime started every artboard of the remounted canvas as a placeholder again, just as the shell
 * reselected after `loaded` — the selected clip was gone (2.0.7 video regression). Bump `RUNTIME_SHAPE` when
 * `Runtime` or `LiveRegistry` changes shape (a canvas-lib change hard-reloads the frame anyway).
 */
const RUNTIME_SHAPE = 4;
const RUNTIME_KEY = '__maudeArtboardLive';
interface RuntimeSlot {
  shape: number;
  search: string;
  runtime: Runtime;
}
function runtimeSlot(): RuntimeSlot | null {
  const slot = (window as unknown as Record<string, unknown>)[RUNTIME_KEY] as
    | RuntimeSlot
    | undefined;
  return slot && slot.shape === RUNTIME_SHAPE ? slot : null;
}

function embedded(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

/** Test hook: forget the per-document runtime (the URL decides the mode at first use). */
export function resetArtboardLive(): void {
  if (typeof window === 'undefined') return;
  delete (window as unknown as Record<string, unknown>)[RUNTIME_KEY];
}

/** WebKit / WKWebView — the same test as canvas-lib's `IS_WEBKIT`. */
function isWebkit(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (/apple/i.test(navigator.vendor || '') ||
      (typeof window !== 'undefined' && 'GestureEvent' in window))
  );
}

/** Distance (px) of an observed artboard's centre to the viewport centre — the mount queue's order. */
function centreDistance(en: IntersectionObserverEntry): number {
  const b = en.boundingClientRect;
  if (!b) return Number.POSITIVE_INFINITY;
  const W = typeof innerWidth === 'number' ? innerWidth : 0;
  const H = typeof innerHeight === 'number' ? innerHeight : 0;
  return Math.hypot(b.left + b.width / 2 - W / 2, b.top + b.height / 2 - H / 2);
}

function getRuntime(): Runtime | null {
  if (typeof window === 'undefined') return null;
  const held = runtimeSlot();
  if (held && held.search === window.location.search) return held.runtime;
  const mode: LiveMode = resolveLiveMode({ search: window.location.search, embedded: embedded() });
  const schedule = (fn: () => void) =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16);
  const registry = new LiveRegistry(mode, schedule);
  const ids = new WeakMap<Element, string>();
  let near: IntersectionObserver | null = null;
  let visible: IntersectionObserver | null = null;
  let keep: IntersectionObserver | null = null;
  let budget: WebglBudget | null = null;
  if (mode !== 'off' && typeof IntersectionObserver === 'function') {
    near = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const id = ids.get(en.target);
          if (id) registry.setNear(id, en.isIntersecting, centreDistance(en));
        }
      },
      { rootMargin: NEAR_MARGIN }
    );
    keep = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const id = ids.get(en.target);
          if (id) registry.setKeep(id, en.isIntersecting);
        }
      },
      { rootMargin: KEEP_MARGIN }
    );
    visible = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const id = ids.get(en.target);
        if (id) registry.setVisible(id, en.isIntersecting);
      }
    });
    budget = new WebglBudget((id) => (id ? registry.isLive(id) : true));
    budget.install(window as Window & typeof globalThis);
    registry.onChange(() => budget?.update());
    // 2.0.7 — WebKit: with many artboards on screen (`crowded`, LAYER_MAX_VISIBLE) they stop being a compositing
    // layer each. WebKit rasterizes every such layer at full size whatever the world's scale, so 40 artboards on
    // screen at 8 % were 40 full-size rasters per frame (seconds per pan frame on the mascot canvas, ~40 ms
    // without). Switched only outside a gesture, so a pinch never re-rasters mid-flight. Blink keeps its layers.
    if (isWebkit()) {
      const sync = () => {
        if (registry.isInteracting()) return;
        document.documentElement.toggleAttribute('data-dc-crowded', registry.crowded());
      };
      registry.onChange(sync);
      registry.onSettle(sync);
    }
    (window as unknown as { __maudeWebglStats?: () => unknown }).__maudeWebglStats = () => ({
      ...budget?.stats(),
      mode,
      visible: registry.visibleCount(),
      mounted: registry.mountedCount(),
      mountedNodes: Math.round(registry.mountedWeight()),
    });
  }
  const articles = new Map<string, HTMLElement>();
  let stills: StillController | null = null;
  let warmup: StillWarmup | null = null;
  if (
    resolveStillMode({ search: window.location.search, webkit: isWebkit(), liveMode: mode }) ===
    'on'
  ) {
    const st = new StillController({ job: startStill, info: (id) => registry.slotInfo(id) });
    registry.onSettle(() => st.settle());
    stills = st;
    const w = window as unknown as Record<string, unknown>;
    w.__maudeStillStats = () => ({ ...st.stats(), raster: { ...rasterTimings } });
    // the views each artboard went through (the flicker count of the overview level)
    w.__maudeStillHistory = (id?: string) => st.history(id);
    // the last drawings: slices, the longest one, when the walk / the decode / the drawing ended
    w.__maudeStillJobs = () => st.jobs();
    if (mode === 'sleep' && WARM_ENABLED) {
      warmup = startWarmup(registry, st, articles);
      const wu = warmup;
      w.__maudeStillWarm = () => ({ ...wu.stats(), cache: st.cache.stats() });
    }
  }
  const runtime: Runtime = {
    registry,
    budget,
    near,
    visible,
    keep,
    ids,
    stills,
    warmup,
    articles,
  };
  const slot: RuntimeSlot = { shape: RUNTIME_SHAPE, search: window.location.search, runtime };
  (window as unknown as Record<string, unknown>)[RUNTIME_KEY] = slot;
  return runtime;
}

/** The ring's own mounts are done when it mounted nothing for this long (ms) — the warm-up waits for them. */
const WARM_RING_QUIET_MS = 300;

/** The stills' warm-up (artboard-still-warmup.ts) on this document's registry and still controller. */
function startWarmup(
  registry: LiveRegistry,
  st: StillController,
  articles: Map<string, HTMLElement>
): StillWarmup {
  const now = () => performance.now();
  const W = () => (typeof innerWidth === 'number' ? innerWidth : 0);
  const H = () => (typeof innerHeight === 'number' ? innerHeight : 0);
  const wu = new StillWarmup({
    now,
    later: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    candidates: () =>
      registry.warmCandidates().map((k) => {
        const a = articles.get(k.id);
        if (!a) return k;
        const r = a.getBoundingClientRect();
        return {
          ...k,
          dist: Math.hypot(r.left + r.width / 2 - W() / 2, r.top + r.height / 2 - H() / 2),
        };
      }),
    wanted: (id) => {
      const a = articles.get(id);
      return !!a && inOverviewCut(a.offsetWidth, st.zoomNow());
    },
    hasStill: (id) => st.hasStill(id),
    mount: (id) => registry.setWarm(id, true),
    release: (id) => registry.setWarm(id, false),
    mounted: (id) => registry.isMounted(id),
    quiet: () =>
      st.quiet(true) &&
      !registry.isInteracting() &&
      now() - registry.lastMountAt() >= WARM_RING_QUIET_MS,
    lastActivity: () => st.lastActivity(),
    cacheRoom: () => {
      const c = st.cache.stats();
      const each = c.n ? c.bytes / c.n : 0;
      return c.bytes + 2 * each <= st.cache.max;
    },
  });
  st.onStill((id, ok) => wu.stillDone(id, ok));
  registry.onSettle(() => wu.wake());
  // any input pauses it at once (capture: before the canvas's own handlers; passive: never delays them)
  const onInput = () => wu.input();
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'])
    window.addEventListener(type, onInput, { capture: true, passive: true });
  wu.kick();
  return wu;
}

/** The mode this canvas document runs in. */
export function artboardLiveMode(): LiveMode {
  return getRuntime()?.registry.mode ?? 'off';
}

/**
 * Every artboard live for a capture, at once. Resolves after two frames (restored WebGL contexts and woken
 * players draw again); call the returned release when the capture is done.
 */
export async function holdAllLive(): Promise<() => void> {
  const rt = getRuntime();
  if (!rt || rt.registry.mode === 'off') return () => {};
  const release = rt.registry.holdAllLive();
  rt.budget?.apply();
  if (typeof requestAnimationFrame === 'function')
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  return release;
}

/**
 * The viewport wrote this zoom (canvas-lib's applyViewport, every frame of a gesture): small artboards swap to
 * their stills on the first scale step of a gesture. Cheap — a comparison per registered artboard.
 */
export function noteGestureZoom(zoom: number): void {
  getRuntime()?.stills?.noteZoom(zoom);
}

/** Feeds the published (settle-cadence) zoom and the gesture flag. Renders nothing. */
export function ArtboardLiveFeed({ zoom, interacting }: { zoom: number; interacting: boolean }) {
  useEffect(() => {
    const rt = getRuntime();
    if (!rt || rt.registry.mode === 'off') return;
    rt.registry.setZoom(zoom);
    rt.stills?.setZoom(zoom);
    rt.warmup?.wake();
  }, [zoom]);
  useEffect(() => {
    const rt = getRuntime();
    if (!rt || rt.registry.mode === 'off') return;
    rt.registry.setInteracting(interacting);
    // A settle can change which contexts are nearest the centre.
    if (!interacting) rt.budget?.update();
  }, [interacting]);
  return null;
}

/** Pause what plays inside a sleeping artboard; resume what WE paused when it wakes. */
function useMediaSleep(articleRef: RefObject<HTMLElement | null>, live: boolean, on: boolean) {
  const paused = useRef(new Set<HTMLMediaElement>());
  useEffect(() => {
    const el = articleRef.current;
    if (!on || !el) return;
    el.toggleAttribute('data-dc-asleep', !live);
    // VideoComp drives its own Player (useArtboardActive); its <video>s are the Player's to sync.
    const own = (m: Element) => !m.closest('.dc-video-comp');
    if (!live) {
      for (const m of el.querySelectorAll<HTMLMediaElement>('video')) {
        if (!own(m) || m.paused) continue;
        m.pause();
        paused.current.add(m);
      }
      // An autoplay that starts later (data arrives after we slept) is paused too.
      const onPlay = (ev: Event) => {
        const m = ev.target as HTMLMediaElement;
        if (m instanceof HTMLVideoElement && own(m)) {
          m.pause();
          paused.current.add(m);
        }
      };
      el.addEventListener('play', onPlay, true);
      return () => el.removeEventListener('play', onPlay, true);
    }
    for (const m of paused.current) if (m.isConnected) void m.play?.()?.catch?.(() => {});
    paused.current.clear();
    return undefined;
  }, [articleRef, live, on]);
}

/** How long after a first mount the placeholder's picture is taken (images and fonts have come in). */
const PICTURE_DELAY_MS = 900;

export function ArtboardLiveGate({
  id,
  articleRef,
  bodyRef,
  heightFloor,
  background,
  pinned = false,
  eager = false,
  children,
}: {
  id: string;
  articleRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
  heightFloor: number;
  /** the artboard's own `background` prop — the colour a never-rendered placeholder takes */
  background?: string;
  /** the active artboard, or the one holding the selection: never released (the shell works in its DOM) */
  pinned?: boolean;
  /** a video artboard: always mounted (its comp registers itself only while mounted) */
  eager?: boolean;
  children: ReactNode;
}) {
  const rt = getRuntime();
  const on = !!rt && rt.registry.mode !== 'off';
  const [state, setState] = useState<ArtboardLiveState>(() =>
    on && rt ? rt.registry.get(id) : ALL_LIVE
  );
  // Subscribe before the observers report (layout effects run before effects). Every change applies at once:
  // a first mount as a React transition was measured and dropped — the canvas's own sync updates kept
  // restarting it, so an on-screen artboard waited for the transition lane's ~5 s expiry (first paint 1.3 s →
  // 15 s on math-learning-spaces). The queue's pacing (one per frame, one per GESTURE_MOUNT_GAP_MS mid-gesture)
  // is what keeps a mount from blocking a pan.
  useLayoutEffect(() => {
    if (!on || !rt) return;
    const off = rt.registry.subscribe(id, setState);
    setState(rt.registry.get(id));
    return off;
  }, [on, rt, id]);
  const { live, seen } = state;
  // A skeleton drawn before any artboard of the canvas rendered took the mid tone: it repaints once the canvas
  // colour is known (only while it is a placeholder — a mounted artboard never re-renders for it).
  useSyncExternalStore(
    subscribeCanvasBackground,
    () => (on && !seen ? canvasBackground() : ''),
    () => ''
  );

  useEffect(() => {
    if (on && rt) rt.registry.setPinned(id, pinned);
  }, [on, rt, id, pinned]);
  useEffect(() => {
    if (on && rt) rt.registry.setEager(id, eager);
  }, [on, rt, id, eager]);

  // Observe the artboard (the article — its size is stable whether its children are mounted or not).
  useEffect(() => {
    const el = articleRef.current;
    if (!on || !rt || !el) return;
    if (!rt.near || !rt.visible) {
      // No IntersectionObserver: fail open, everything near and on screen.
      rt.registry.setNear(id, true);
      rt.registry.setVisible(id, true);
      return;
    }
    rt.ids.set(el, id);
    rt.articles.set(id, el);
    rt.near.observe(el);
    rt.visible.observe(el);
    rt.keep?.observe(el);
    return () => {
      rt.near?.unobserve(el);
      rt.visible?.unobserve(el);
      rt.keep?.unobserve(el);
      rt.ids.delete(el);
      if (rt.articles.get(id) === el) rt.articles.delete(id);
      // an edit's remount: the new gate already holds the id and its observers report on its own article —
      // clearing near/visible here would put the artboard to sleep (and pause its video) for a frame
      rt.registry.unobserve(id);
    };
  }, [articleRef, id, on, rt]);

  useMediaSleep(articleRef, live, on);

  // 2.0.7 — the overview level (artboard-still.ts): registered while the children are mounted; under the cut the
  // artboard shows its still. The selected / active artboard and a video one never do (`pinned`, `eager`).
  const stills = on && rt ? rt.stills : null;
  const flags = useRef({ pinned, eager, bg: background });
  flags.current = { pinned, eager, bg: background };
  // A layout effect: an artboard mounting under the cut is hidden behind its still (or cover) before it paints.
  useLayoutEffect(() => {
    const article = articleRef.current;
    const body = bodyRef.current;
    if (!stills || !seen || !article || !body) return;
    const f = flags.current;
    return stills.register(id, { article, body, bg: knownBackground(id, f.bg) }, f);
  }, [stills, seen, id, articleRef, bodyRef]);
  useEffect(() => {
    stills?.update(id, { pinned, eager });
  }, [stills, id, pinned, eager]);
  // a wake or a sleep changes what is painted (paused animations, a WebGL picture): draw it again
  useEffect(() => {
    stills?.markDirty(id, live ? 'woke' : 'slept');
  }, [stills, id, live]);

  // Remember the height the children had, so the placeholder holds it.
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    if (!seen) return;
    const b = bodyRef.current;
    return () => {
      if (b) lastHeight.current = b.offsetHeight;
    };
  }, [seen, bodyRef]);

  // Mounted: weigh it (the DOM budget's unit) and, once it settled, take its picture for the placeholder.
  useEffect(() => {
    if (!on || !rt || !seen) return;
    const b = bodyRef.current;
    if (!b) return;
    rt.registry.setWeight(id, b.getElementsByTagName('*').length);
    // its colour at once (four elements at most): the next placeholders of this canvas take it
    rememberBackground(id, backgroundOf(b));
    const own = knownBackground(id, background);
    if (own) {
      articleRef.current?.style.setProperty('--dc-own-bg', own);
      stills?.update(id, { bg: own });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const shoot = () => {
      if (!b.isConnected) return;
      if (rt.registry.isInteracting()) {
        timer = setTimeout(shoot, PICTURE_DELAY_MS);
        return;
      }
      rt.registry.setWeight(id, b.getElementsByTagName('*').length);
      const pic = takePicture(b);
      if (pic) rememberPicture(id, pic);
    };
    timer = setTimeout(shoot, PICTURE_DELAY_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [on, rt, id, seen, bodyRef, articleRef, background, stills]);

  // Not mounted: the frame takes the colour known so far (an unpainted body is never var(--bg-0)).
  const ownBg = on && !seen ? knownBackground(id, background) : '';
  useLayoutEffect(() => {
    if (ownBg) articleRef.current?.style.setProperty('--dc-own-bg', ownBg);
  }, [ownBg, articleRef]);

  const value = on ? state : ALL_LIVE;
  if (!on || seen) return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
  const ph = choosePlaceholder(id, background);
  const kept = stills?.cache.peek(id);
  // a kept still stands in for a released artboard (the same picture it shows when mounted under the cut)
  const pic = kept ? undefined : ph.picture;
  return (
    <LiveContext.Provider value={value}>
      <div
        className="dc-artboard-sleeping"
        data-dc-placeholder={ph.kind}
        aria-hidden="true"
        style={{
          minHeight: Math.max(lastHeight.current, pic?.h ?? 0, heightFloor),
          backgroundColor: ph.bg || undefined,
        }}
      >
        {kept ? <StillCopy still={kept.el} /> : null}
        {pic?.blocks.map((b, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: a still picture; its blocks never reorder
            key={i}
            data-media={b.c ? undefined : ''}
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
              background: b.c || undefined,
            }}
          />
        ))}
      </div>
    </LiveContext.Provider>
  );
}

/** A copy of a kept still (the cache's own canvas stays the cache's): drawn once, on mount. */
function StillCopy({ still }: { still: HTMLElement }) {
  return (
    <canvas
      className="dc-artboard-still-copy"
      ref={(c) => {
        const src = still as HTMLCanvasElement;
        if (!c || !src.width || c.width === src.width) return;
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d')?.drawImage(src, 0, 0);
      }}
    />
  );
}

/** Paused CSS animations while asleep, the placeholder and the still. (A released WebGL canvas's picture is artboard-webgl.ts's.) */
export const ARTBOARD_LIVE_CSS = `${ARTBOARD_STILL_CSS}
.dc-artboard[data-dc-asleep] .dc-artboard-body *,
.dc-artboard[data-dc-asleep] .dc-artboard-body *::before,
.dc-artboard[data-dc-asleep] .dc-artboard-body *::after { animation-play-state: paused !important; }
html[data-dc-crowded] .dc-canvas .dc-artboard { will-change: auto; }
.dc-artboard-sleeping { width: 100%; position: relative; overflow: hidden; }
.dc-artboard-sleeping > i { position: absolute; display: block; opacity: 0.45; border-radius: 2px; }
.dc-artboard-sleeping > i[data-media] { background: color-mix(in srgb, currentColor 16%, transparent); }
.dc-artboard-sleeping > .dc-artboard-still-copy { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
`;
