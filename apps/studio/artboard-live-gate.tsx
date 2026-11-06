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
  choosePlaceholder,
  rememberBackground,
  rememberPicture,
  takePicture,
} from './artboard-placeholder.ts';
import { WebglBudget } from './artboard-webgl.ts';

const ALL_LIVE: ArtboardLiveState = { live: true, seen: true };
const LiveContext = createContext<ArtboardLiveState>(ALL_LIVE);

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
}

let runtime: Runtime | null = null;
let runtimeSearch: string | null = null;

function embedded(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

/** Test hook: forget the per-document runtime (the URL decides the mode at first use). */
export function resetArtboardLive(): void {
  runtime = null;
  runtimeSearch = null;
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
  if (runtime && runtimeSearch === window.location.search) return runtime;
  const mode: LiveMode = resolveLiveMode({ search: window.location.search, embedded: embedded() });
  runtimeSearch = window.location.search;
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
  runtime = { registry, budget, near, visible, keep, ids };
  return runtime;
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

/** Feeds the published (settle-cadence) zoom and the gesture flag. Renders nothing. */
export function ArtboardLiveFeed({ zoom, interacting }: { zoom: number; interacting: boolean }) {
  useEffect(() => {
    const rt = getRuntime();
    if (!rt || rt.registry.mode === 'off') return;
    rt.registry.setZoom(zoom);
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
  children,
}: {
  id: string;
  articleRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
  heightFloor: number;
  /** the artboard's own `background` prop — the colour a never-rendered placeholder takes */
  background?: string;
  /** the active artboard: never released (its selection lives in its DOM) */
  pinned?: boolean;
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

  useEffect(() => {
    if (on && rt) rt.registry.setPinned(id, pinned);
  }, [on, rt, id, pinned]);

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
    rt.near.observe(el);
    rt.visible.observe(el);
    rt.keep?.observe(el);
    return () => {
      rt.near?.unobserve(el);
      rt.visible?.unobserve(el);
      rt.keep?.unobserve(el);
      rt.registry.setNear(id, false);
      rt.registry.setVisible(id, false);
    };
  }, [articleRef, id, on, rt]);

  useMediaSleep(articleRef, live, on);

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
  }, [on, rt, id, seen, bodyRef]);

  const value = on ? state : ALL_LIVE;
  if (!on || seen) return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
  const ph = choosePlaceholder(id, background);
  const pic = ph.picture;
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

/** Paused CSS animations while asleep, and the placeholder. (A released WebGL canvas's picture is artboard-webgl.ts's.) */
export const ARTBOARD_LIVE_CSS = `
.dc-artboard[data-dc-asleep] .dc-artboard-body *,
.dc-artboard[data-dc-asleep] .dc-artboard-body *::before,
.dc-artboard[data-dc-asleep] .dc-artboard-body *::after { animation-play-state: paused !important; }
html[data-dc-crowded] .dc-canvas .dc-artboard { will-change: auto; }
.dc-artboard-sleeping { width: 100%; position: relative; overflow: hidden; }
.dc-artboard-sleeping > i { position: absolute; display: block; opacity: 0.45; border-radius: 2px; }
.dc-artboard-sleeping > i[data-media] { background: color-mix(in srgb, currentColor 16%, transparent); }
.dc-artboard-sleeping[data-dc-placeholder='skeleton'] {
  background-image: linear-gradient(color-mix(in srgb, currentColor 8%, transparent), color-mix(in srgb, currentColor 8%, transparent));
  background-size: 56% 12px;
  background-position: 8% 32px;
  background-repeat: no-repeat;
}
`;
