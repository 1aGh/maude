// apps/studio/present/pointer-dot.tsx — S3.2b: the presenter's Pointer (L), md-present-full / md-keys.
//
// "L turns the pointer into a ringed dot in your presence colour." The dot follows the mouse with a short
// trail (none under Reduce motion), the native cursor hides while it is on, and the point is published on
// the canvas's collab awareness as `pointer` — WORLD coordinates, so a peer on a different pan/zoom (or the
// follower page, S3.7a) sees the dot on the same spot of the same artboard. It goes to null the moment the
// dot turns off, the mouse leaves the window, or Present ends. Present starts with it off.
//
// Plain TS engine with injected scheduling (the tests drive it frame by frame), mounted by
// `usePresentStage` through `usePointerDot` — the canvas-lib mount point stays untouched. The key is owned
// here (capture phase, only while presenting): the input router cannot arm a tool that has no v1
// descriptor, and the Pointer is not a tool the canvas draws with.

import { type JSX, useEffect, useRef } from 'react';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { useCollab, useForeignAwareness } from '../use-collab.tsx';
import { sanitizePointer, type WorldPoint } from './pointer-point.ts';

export { sanitizePointer, type WorldPoint };

/** A trail point lives this long. */
export const TRAIL_MS = 420;
/** Awareness cadence (~30 Hz, as the cursors). */
export const PUBLISH_MS = 33;
const MAX_TRAIL_POINTS = 64;

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

/** The trail points still alive at `now`. */
export function trailPoints(points: readonly TrailPoint[], now: number): TrailPoint[] {
  return points.filter((p) => now - p.t <= TRAIL_MS).slice(-MAX_TRAIL_POINTS);
}

export interface PointerDeps {
  win: Window;
  /** Client (window) coordinates → world coordinates, through the canvas's current camera. */
  toWorld(clientX: number, clientY: number): WorldPoint | null;
  /** Awareness: a world point, or null (withdrawn). */
  publish(p: WorldPoint | null): void;
  /** The presenter's presence colour. */
  color(): string;
  now(): number;
  raf(cb: (now: number) => void): number;
  caf(id: number): void;
  reducedMotion(): boolean;
}

export interface PointerDot {
  isOn(): boolean;
  toggle(): void;
  /** Present started / ended. Ending turns the dot off; the next Present starts off. */
  setPresenting(on: boolean): void;
  dispose(): void;
}

const RING_INK = 'oklch(0.2 0.02 260)';
const STYLE_ID = 'dc-present-pointer-style';
const HIDE_CURSOR_CLASS = 'dc-present-pointer-on';

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false;
  const tag = String(el.tagName).toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

export function createPointerDot(deps: PointerDeps): PointerDot {
  const { win } = deps;
  const doc = win.document;
  let presenting = false;
  let on = false;
  let layer: HTMLElement | null = null;
  let dot: HTMLElement | null = null;
  let trail: SVGPolylineElement | null = null;
  let last: { x: number; y: number } | null = null;
  let inside = true;
  let points: TrailPoint[] = [];
  let frame: number | null = null;
  let lastPublish = Number.NEGATIVE_INFINITY;
  let published = false;
  let dirty = false;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const ensureStyle = () => {
    if (doc.getElementById(STYLE_ID)) return;
    const s = doc.createElement('style');
    s.id = STYLE_ID;
    // The native cursor hides while the dot is the pointer; the ring holds on yellow art (ink ring, then
    // a soft halo in the presence colour).
    s.textContent = `.${HIDE_CURSOR_CLASS}, .${HIDE_CURSOR_CLASS} * { cursor: none !important; }`;
    doc.head.appendChild(s);
  };

  const build = () => {
    ensureStyle();
    layer = doc.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('data-testid', 'present-pointer');
    layer.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;';
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = 'position:absolute;inset:0;overflow:visible;';
    trail = doc.createElementNS(SVG_NS, 'polyline') as SVGPolylineElement;
    trail.setAttribute('data-testid', 'present-pointer-trail');
    trail.setAttribute('fill', 'none');
    trail.setAttribute('stroke', deps.color());
    trail.setAttribute('stroke-width', '4');
    trail.setAttribute('stroke-linecap', 'round');
    trail.setAttribute('stroke-linejoin', 'round');
    trail.setAttribute('opacity', '0.4');
    trail.setAttribute('points', '');
    svg.appendChild(trail);
    dot = doc.createElement('span');
    dot.setAttribute('data-testid', 'present-pointer-dot');
    const c = deps.color();
    dot.style.cssText =
      'position:absolute;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:999px;' +
      `background:${c};` +
      `box-shadow:0 0 0 2px ${RING_INK},0 0 0 7px color-mix(in oklch, ${c} 35%, transparent),` +
      `0 0 24px 8px color-mix(in oklch, ${c} 40%, transparent);`;
    dot.setAttribute('data-hidden', 'true');
    dot.style.transform = 'translate(-100px, -100px)';
    layer.appendChild(svg);
    layer.appendChild(dot);
    doc.body.appendChild(layer);
    doc.documentElement.classList.add(HIDE_CURSOR_CLASS);
  };

  const unbuild = () => {
    layer?.remove();
    layer = null;
    dot = null;
    trail = null;
    doc.documentElement.classList.remove(HIDE_CURSOR_CLASS);
  };

  const withdraw = () => {
    if (published) deps.publish(null);
    published = false;
    lastPublish = Number.NEGATIVE_INFINITY;
  };

  const schedule = () => {
    if (frame !== null) return;
    frame = deps.raf(tick);
  };

  function tick(): void {
    frame = null;
    if (!on) return;
    const now = deps.now();
    if (dot) {
      if (last && inside) {
        dot.style.transform = `translate(${last.x}px, ${last.y}px)`;
        dot.setAttribute('data-hidden', 'false');
      } else dot.setAttribute('data-hidden', 'true');
    }
    if (trail) {
      points = deps.reducedMotion() || !inside ? [] : trailPoints(points, now);
      trail.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
    }
    if (dirty && last && inside && now - lastPublish >= PUBLISH_MS) {
      const w = deps.toWorld(last.x, last.y);
      if (w) {
        deps.publish(w);
        published = true;
        lastPublish = now;
        dirty = false;
      }
    } else if (dirty && last && inside) {
      schedule(); // too soon: the last point is sent on a later frame
    }
    if (points.length > 0) schedule(); // let the trail fade out
  }

  const onMove = (e: Event) => {
    if (!on) return;
    const m = e as MouseEvent;
    if (!Number.isFinite(m.clientX) || !Number.isFinite(m.clientY)) return;
    inside = true;
    last = { x: m.clientX, y: m.clientY };
    if (!deps.reducedMotion()) {
      points.push({ x: m.clientX, y: m.clientY, t: deps.now() });
      if (points.length > MAX_TRAIL_POINTS) points.shift();
    }
    dirty = true;
    schedule();
  };

  const onLeave = () => {
    if (!on) return;
    inside = false;
    dirty = false;
    withdraw();
    schedule();
  };

  const turnOn = () => {
    if (on) return;
    on = true;
    build();
    doc.documentElement.addEventListener('mouseleave', onLeave);
  };

  const turnOff = () => {
    if (!on) return;
    on = false;
    if (frame !== null) deps.caf(frame);
    frame = null;
    doc.documentElement.removeEventListener('mouseleave', onLeave);
    withdraw();
    points = [];
    last = null;
    dirty = false;
    inside = true;
    unbuild();
  };

  const toggle = () => (on ? turnOff() : turnOn());

  const onKey = (e: KeyboardEvent) => {
    if (!presenting) return;
    if (e.key !== 'l' && e.key !== 'L') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditable(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) toggle();
  };

  // The shell can hold the focus (its controls, a click on its chrome): its L arrives as `tool.key`.
  const onMessage = (e: MessageEvent) => {
    if (!presenting || e.source !== win.parent) return;
    const d = e.data as { dgn?: unknown; id?: unknown; params?: { key?: unknown } } | null;
    if (d?.dgn !== 'run-action' || d.id !== 'tool.key') return;
    if (d.params?.key === 'L') toggle();
  };

  win.addEventListener('keydown', onKey, true);
  win.addEventListener('pointermove', onMove, { capture: true, passive: true });
  win.addEventListener('message', onMessage);

  return {
    isOn: () => on,
    toggle,
    setPresenting(p) {
      presenting = p;
      if (!p) turnOff();
    },
    dispose() {
      presenting = false;
      turnOff();
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('pointermove', onMove, true);
      win.removeEventListener('message', onMessage);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The React mounts

export interface UsePointerDotOptions {
  /** The viewport controller's camera as published: screen = world × zoom + (x, y). */
  viewport: { x: number; y: number; zoom: number };
}

type AwarenessPatch = Parameters<NonNullable<ReturnType<typeof useCollab>>['publishAwareness']>[0];

/**
 * Mount the Pointer on this canvas document. Active whenever the shell says `present` — Artboards or the
 * Canvas — and inert otherwise. Called from `usePresentStage`.
 */
export function usePointerDot(opts: UsePointerDotOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const collab = useCollab();
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const win = typeof window === 'undefined' ? null : window;
  const engineRef = useRef<PointerDot | null>(null);

  useEffect(() => {
    if (!win) return;
    const store = canvasModeStore(win);
    const eng = createPointerDot({
      win,
      toWorld: (cx, cy) => {
        const v = optsRef.current.viewport;
        if (!v || !(v.zoom > 0)) return null;
        return { x: (cx - v.x) / v.zoom, y: (cy - v.y) / v.zoom };
      },
      publish: (p) => {
        // `pointer` rides awareness next to `cursor`; the typed field lands with the use-collab patch.
        collabRef.current?.publishAwareness({ pointer: p } as unknown as AwarenessPatch);
      },
      color: () => collabRef.current?.myColor || 'oklch(0.74 0.16 40)',
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      raf: (cb) => win.requestAnimationFrame(cb),
      caf: (id) => win.cancelAnimationFrame(id),
      reducedMotion: () => {
        try {
          return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        } catch {
          return false;
        }
      },
    });
    engineRef.current = eng;
    const sync = () => eng.setPresenting(store.get().mode === 'present');
    sync();
    const off = store.subscribe(sync);
    return () => {
      off();
      eng.dispose();
      engineRef.current = null;
    };
  }, [win]);
}

/**
 * A peer's Pointer, drawn where they put it: world → this canvas's screen through the live camera. Mounted
 * beside the cursor overlay (cursors-overlay.tsx). Reads `pointer` off the sanitised foreign state.
 */
export function PointerPeers({
  viewport,
}: {
  viewport: { x: number; y: number; zoom: number };
}): JSX.Element | null {
  const peers = useForeignAwareness() as Array<{
    clientID: number;
    color: string;
    pointer?: unknown;
  }>;
  const dots = peers
    .map((p) => ({ p, pt: sanitizePointer(p.pointer) }))
    .filter((x): x is { p: (typeof peers)[number]; pt: WorldPoint } => x.pt !== null);
  if (dots.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="present-peer-pointers"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147482999 }}
    >
      {dots.map(({ p, pt }) => (
        <span
          key={p.clientID}
          data-testid="present-peer-pointer"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 16,
            height: 16,
            margin: '-8px 0 0 -8px',
            borderRadius: 999,
            background: p.color,
            boxShadow: `0 0 0 2px ${RING_INK}, 0 0 0 7px color-mix(in oklch, ${p.color} 35%, transparent)`,
            transform: `translate(${pt.x * viewport.zoom + viewport.x}px, ${pt.y * viewport.zoom + viewport.y}px)`,
          }}
        />
      ))}
    </div>
  );
}
