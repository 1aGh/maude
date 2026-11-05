/**
 * @file       artboard-live-gate.tsx — 2.0.5: the React half of artboard-live.ts
 * @scope      apps/studio/artboard-live-gate.tsx (used by canvas-lib.tsx's DCArtboardBody + DesignCanvas)
 * @purpose    One `LiveRegistry` + one `WebglBudget` per canvas document, fed by two shared
 *             IntersectionObservers. `ArtboardLiveGate` wraps an artboard's children: it hands them
 *             `useArtboardActive()` / `useArtboardSeen()`, pauses the artboard's `<video>`s and CSS
 *             animations while it sleeps, and in `light` mode mounts the children only while it is near
 *             (a placeholder of the last measured height stands in, so nothing reflows).
 *             `holdAllLive()` is the in-frame export's guarantee: every artboard live for the capture.
 */

import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import {
  type ArtboardLiveState,
  type LiveMode,
  LiveRegistry,
  NEAR_MARGIN,
  resolveLiveMode,
} from './artboard-live.ts';
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
 * Has this artboard been near the viewport yet? Gate an expensive first mount on it (the design-system
 * board's specimens do). Always `true` in captures and exports.
 */
export function useArtboardSeen(): boolean {
  return useContext(LiveContext).seen;
}

interface Runtime {
  registry: LiveRegistry;
  budget: WebglBudget | null;
  near: IntersectionObserver | null;
  visible: IntersectionObserver | null;
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
  let budget: WebglBudget | null = null;
  if (mode !== 'off' && typeof IntersectionObserver === 'function') {
    near = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const id = ids.get(en.target);
          if (id) registry.setNear(id, en.isIntersecting);
        }
      },
      { rootMargin: NEAR_MARGIN }
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
    (window as unknown as { __maudeWebglStats?: () => unknown }).__maudeWebglStats = () => ({
      ...budget?.stats(),
      mode,
      visible: registry.visibleCount(),
    });
  }
  runtime = { registry, budget, near, visible, ids };
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

export function ArtboardLiveGate({
  id,
  articleRef,
  bodyRef,
  heightFloor,
  children,
}: {
  id: string;
  articleRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
  heightFloor: number;
  children: ReactNode;
}) {
  const rt = getRuntime();
  const on = !!rt && rt.registry.mode !== 'off';
  // Stable per (runtime, id): a new subscribe each render would drop the slot (and its near state) in between.
  const subscribe = useCallback(
    (fn: () => void) => (on && rt ? rt.registry.subscribe(id, fn) : () => {}),
    [on, rt, id]
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (on && rt ? rt.registry.get(id) : ALL_LIVE),
    () => ALL_LIVE
  );
  const { live, seen } = state;

  // Observe the artboard (the article — its size is stable whether its children are mounted or not).
  useEffect(() => {
    const el = articleRef.current;
    if (!on || !rt || !el) return;
    if (!rt.near || !rt.visible) {
      // No IntersectionObserver: fail open, everything near and on screen.
      rt.registry.setNear(id, true);
      return;
    }
    rt.ids.set(el, id);
    rt.near.observe(el);
    rt.visible.observe(el);
    return () => {
      rt.near?.unobserve(el);
      rt.visible?.unobserve(el);
      rt.registry.setNear(id, false);
      rt.registry.setVisible(id, false);
    };
  }, [articleRef, id, on, rt]);

  useMediaSleep(articleRef, live, on);

  // light mode: remember the height the children had, so the placeholder holds it.
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    if (!seen) return;
    const b = bodyRef.current;
    return () => {
      if (b) lastHeight.current = b.offsetHeight;
    };
  }, [seen, bodyRef]);

  const value = on ? state : ALL_LIVE;
  const mountChildren = !on || rt?.registry.mode !== 'light' || seen;
  return (
    <LiveContext.Provider value={value}>
      {mountChildren ? (
        children
      ) : (
        <div
          className="dc-artboard-sleeping"
          aria-hidden="true"
          style={{ minHeight: Math.max(lastHeight.current, heightFloor) }}
        />
      )}
    </LiveContext.Provider>
  );
}

/** Paused CSS animations while asleep. (A released WebGL canvas's picture is an overlay: artboard-webgl.ts.) */
export const ARTBOARD_LIVE_CSS = `
.dc-artboard[data-dc-asleep] .dc-artboard-body *,
.dc-artboard[data-dc-asleep] .dc-artboard-body *::before,
.dc-artboard[data-dc-asleep] .dc-artboard-body *::after { animation-play-state: paused !important; }
.dc-artboard-sleeping { width: 100%; }
`;
