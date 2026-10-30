/**
 * @file       video-comp.tsx — DDR-148 video-comp canvas kind.
 * @scope      apps/studio/video-comp.tsx (re-exported from canvas-lib.tsx as
 *             part of the `@maude/canvas-lib` surface).
 * @purpose    Mount a Remotion composition inside `@remotion/player`'s `<Player>`
 *             for free scrub/preview, and expose the ONE deterministic seek
 *             bridge (`window.__maude_seek__`) that the capture spine
 *             (`bin/_video-playwright.mjs`) and the Timeline panel drive.
 *
 *             A video-comp is deterministic BY CONSTRUCTION — every animated
 *             value is a pure function of `useCurrentFrame()`, so seeking the
 *             Player's `frame` renders one exact frame with no free-running
 *             clock. The capture shim steps `__maude_seek__(0..N)` and
 *             screenshots each frame; two runs to frame N are pixel-identical.
 *
 *             Runtime wiring: `remotion` + `@remotion/player` are externalised
 *             through the canvas importmap (RUNTIME_PACKAGES / DDR-148), so the
 *             Player's provider stack and the composition's `useCurrentFrame()`
 *             bind to the SAME `remotion` module instance (no dual-package
 *             frozen-at-frame-0 hazard).
 */

import { Player, type PlayerRef } from '@remotion/player';
import {
  type ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import { videoLabelTail } from './editing/video-label.ts';
import { resolvedPoster } from './kinds/meta.ts';
import { VideoPlayChrome } from './video-play-chrome.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// Comp meta contract + the module-level seek registry

/** The temporal contract a video-comp artboard declares. */
export interface VideoCompMeta {
  /** Frames per second (Remotion timebase). */
  fps: number;
  /** Total composition length, in frames. */
  durationInFrames: number;
  /** Composition pixel width. */
  width: number;
  /** Composition pixel height. */
  height: number;
}

/** A live registration — the Player handle + its meta, keyed by artboard id. */
interface CompEntry extends VideoCompMeta {
  id: string;
  /** The enclosing DCArtboard's id (`data-dc-screen`), resolved by DOM
   *  containment at mount. The VideoComp's own `compId` is usually an
   *  author-omitted `videocomp-N` mount slug, so this is the ONLY reliable way
   *  for the shell to map "the artboard the user is looking at" → "the comp the
   *  transport must drive" (rca/issue-timeline-drives-wrong-artboard). Null on a
   *  comp mounted outside an artboard (bare preview / test harness). */
  artboardId: string | null;
  /** The artboard's visible label — shown in the Timeline head so the user can
   *  see WHICH artboard the rows + transport belong to. */
  artboardLabel: string | null;
  ref: React.RefObject<PlayerRef | null>;
  /** The Remotion composition component + its props — carried so the export
   *  capture's renderMediaOnWeb path (DDR-148 addendum, audio export) can
   *  render the SAME component tree Remotion owns the timeline math for
   *  (TransitionSeries offsets, <Audio volume={fn}> closures), rather than
   *  re-deriving it. Never serialized — component references don't survive
   *  postMessage/JSON, so this stays out of CompSnapshot. */
  component: ComponentType<Record<string, unknown>>;
  inputProps: Record<string, unknown>;
}

/** Serializable meta the capture shim + Timeline panel read (no functions). */
export interface CompSnapshot extends VideoCompMeta {
  id: string;
  /** Enclosing DCArtboard id + label — see CompEntry. */
  artboardId: string | null;
  artboardLabel: string | null;
}

/** Result contract for `__maude_render_video__` — see exporters/video-render-lib.ts. */
export interface RenderVideoResult {
  b64: string;
  bytes: number;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
}

/** Options accepted by `__maude_render_video__`, forwarded to renderMediaOnWeb. */
export interface RenderVideoOptions {
  container: 'mp4' | 'webm';
  videoCodec?: string;
  audioCodec?: string;
  scale?: number;
  muted?: boolean;
  frameRange?: [number, number];
  licenseKey?: string;
}

interface MaudeSeekWindow {
  __maudeVideoComps?: Map<string, CompEntry>;
  /** Seek every registered comp to `frame` (paused). Ordinary artboards fall
   *  back to a time-based WAAPI seek. Resolves once the frame has painted. */
  __maude_seek__?: (
    frame: number,
    opts?: {
      fps?: number;
      /** Capture mode: throw when a seek never lands, instead of only counting it. */
      strict?: boolean;
    }
  ) => Promise<void>;
  /**
   * Count of seeks that never landed. The capture shim reads this and refuses
   * to ship the export rather than encoding a stale frame — a silent wrong
   * frame is worse than a loud failure.
   */
  __maude_seek_failures__?: number;
  /** Serializable comp list for the capture shim / Timeline panel. */
  __maude_comps__?: () => CompSnapshot[];
  /**
   * DDR-148 addendum (audio export) — whole-comp render via renderMediaOnWeb
   * (video+audio, one pass; Remotion owns the TransitionSeries/volume-closure
   * timeline math). Looks up the component by compId and delegates to
   * `window.__maudeRenderVideo__`, which the export capture injects via
   * addScriptTag (exporters/video-render-lib.ts) — absent during normal
   * preview, so this throws outside a capture session.
   */
  __maude_render_video__?: (compId: string, opts: RenderVideoOptions) => Promise<RenderVideoResult>;
  __maudeRenderVideo__?: (
    opts: RenderVideoOptions & {
      component: ComponentType<Record<string, unknown>>;
      inputProps: Record<string, unknown>;
      width: number;
      height: number;
      fps: number;
      durationInFrames: number;
    }
  ) => Promise<RenderVideoResult>;
}

function seekWindow(): MaudeSeekWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as MaudeSeekWindow);
}

function registry(): Map<string, CompEntry> {
  const w = seekWindow();
  if (!w) return new Map();
  if (!w.__maudeVideoComps) w.__maudeVideoComps = new Map();
  return w.__maudeVideoComps;
}

// rca/issue-video-artboard-frame-reset-on-edit — the LAST live-preview frame
// per comp, hoisted above every remount boundary (module scope, mirrors
// canvas-lib.tsx's `liveViewport`). A canvas edit (ACP/agent/inspector/text)
// remounts the canvas subtree (canvas-comment-mount.tsx `key={attempt}`), and
// video-comp.tsx's own module survives that remount — so a fresh VideoComp
// mount can read the Timeline's last position here instead of always opening
// on the static `posterFrame`. A full page load clears it — correct; the
// shell re-seeds via the `timeline-comps` re-announce (app.jsx) once the new
// Player registers. Never touched during capture (`hideChrome()` forces the
// deterministic frame 0 / render-shim frame regardless of this mirror).
const liveTimelineFrame = new Map<string, number>();

// ─────────────────────────────────────────────────────────────────────────────
// S4.16 — the read-only playhead (annotations pin a note to a moment; S7 draws the marks)
//
// `usePlayhead(artboardId)` answers "where is the clip on this artboard, in seconds" and nothing else: it
// has no setter, so a reader (the annotation layer, the timeline) can never move the transport. The
// writers stay the Player's own `frameupdate` and the Timeline's `timeline-seek`, both below.

/** Where a clip stands: seconds, plus the clip's length. */
export interface Playhead {
  t: number;
  duration: number;
}

/**
 * Window-level, like the seek registry: the annotation layer (canvas shell bundle) and the VideoComp (the
 * canvas's own bundle) can be two instances of this module, so the mirror and its listeners must not live
 * in module scope or the layer would never hear the clip move.
 */
interface PlayheadHub {
  frames: Map<string, number>;
  listeners: Set<() => void>;
  memo: Map<string, Playhead | null>;
}
const HUB_KEY = Symbol.for('maude.playhead.v1');
const localHub: PlayheadHub = { frames: new Map(), listeners: new Set(), memo: new Map() };
function hub(): PlayheadHub {
  const w = seekWindow() as unknown as Record<symbol, PlayheadHub | undefined> | null;
  if (!w) return localHub;
  let h = w[HUB_KEY];
  if (!h) {
    h = { frames: new Map(), listeners: new Set(), memo: new Map() };
    w[HUB_KEY] = h;
  }
  return h;
}

function emitPlayhead(compId?: string, frame?: number): void {
  const h = hub();
  if (compId !== undefined && frame !== undefined) h.frames.set(compId, frame);
  for (const fn of [...h.listeners]) {
    try {
      fn();
    } catch {
      /* a listener failing must not stop the transport */
    }
  }
}

/** The clip mounted on `artboardId`: its playhead in seconds, or null when no comp is registered there. */
export function playheadOf(artboardId: string | null | undefined): Playhead | null {
  if (!artboardId) return null;
  let entry: CompEntry | undefined;
  for (const e of registry().values()) {
    if (e.artboardId === artboardId) {
      entry = e;
      break;
    }
  }
  if (!entry || !(entry.fps > 0)) {
    hub().memo.set(artboardId, null);
    return null;
  }
  const frame =
    hub().frames.get(entry.id) ??
    liveTimelineFrame.get(entry.id) ??
    (() => {
      try {
        return entry.ref.current?.getCurrentFrame() ?? 0;
      } catch {
        return 0;
      }
    })();
  const t = Math.round((frame / entry.fps) * 1000) / 1000;
  const duration = Math.round((entry.durationInFrames / entry.fps) * 1000) / 1000;
  const prev = hub().memo.get(artboardId);
  if (prev && prev.t === t && prev.duration === duration) return prev;
  const next = { t, duration };
  hub().memo.set(artboardId, next);
  return next;
}

/** S7.17 — the same playhead in FRAMES (what a teammate's timeline draws), or null with no clip there. */
export function playheadFrameOf(artboardId: string | null | undefined): number | null {
  const head = playheadOf(artboardId);
  if (!head) return null;
  for (const e of registry().values()) {
    if (e.artboardId === artboardId && e.fps > 0) return Math.max(0, Math.round(head.t * e.fps));
  }
  return null;
}

/** React: re-renders when the clip on `artboardId` moves. `null` for an artboard with no clip. */
export function usePlayhead(artboardId: string | null | undefined): Playhead | null {
  return useSyncExternalStore(
    (fn) => {
      const { listeners } = hub();
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => playheadOf(artboardId),
    () => null
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Two rAFs — enough for the Player to commit a seeked frame to the DOM. */
function afterPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** How many paint-spaced attempts a cold Player gets before a seek is a failure. */
const SEEK_ATTEMPTS = 3;

/**
 * Seek one comp, giving a not-yet-mounted Player a bounded number of chances.
 *
 * Returns whether the seek actually landed. The retry replaces the old silent
 * swallow: a Player that is genuinely mid-mount settles within a paint or two,
 * and one that never settles is a real fault the caller must not paper over.
 */
async function seekEntryWithRetry(
  ref: { current: { pause?: () => void; seekTo: (f: number) => void } | null },
  frame: number
): Promise<boolean> {
  for (let attempt = 0; attempt < SEEK_ATTEMPTS; attempt += 1) {
    try {
      const player = ref.current;
      if (player) {
        player.pause?.();
        player.seekTo(frame);
        return true;
      }
    } catch {
      /* fall through to the retry — the next paint may settle it */
    }
    if (attempt < SEEK_ATTEMPTS - 1) await afterPaint();
  }
  return false;
}

/**
 * Install the singleton seek bridge on `window`. Idempotent — the first
 * VideoComp to mount wins; later mounts reuse the same functions. The bridge
 * reads the live registry, so it always reflects the currently-mounted comps.
 * Exported so tests (and a defensive capture-shim call) can install it without
 * mounting a Player.
 */
export function installMaudeSeekBridge(): void {
  const w = seekWindow();
  if (!w || w.__maude_seek__) return;

  w.__maude_seek__ = async (frame, opts) => {
    const entries = [...registry().values()];
    if (entries.length > 0) {
      for (const e of entries) {
        const f = clamp(Math.round(frame), 0, Math.max(0, e.durationInFrames - 1));
        // This used to be a bare try/catch with an empty body and the comment
        // "Player not yet ready — a later seek settles it". That made a seek
        // that COMPLETELY FAILED resolve as success: `afterPaint()` proves a
        // paint happened, not that the right content was in it. Serially it was
        // benign — frame N+1 repaired frame N's miss, and only frame 0 was ever
        // exposed — which is exactly why it survived. It is not benign the
        // moment anything captures ranges in parallel: every range boundary is a
        // first seek on a cold page, so "a later seek settles it" would be
        // invoked once per worker instead of once per export, and a stale frame
        // is a valid-looking file with wrong pixels, not a crash.
        //
        // So the hope becomes an explicit bounded retry, and exhausting it is a
        // real failure the capture shim can see and refuse to ship.
        if (!(await seekEntryWithRetry(e.ref, f))) {
          // ALWAYS recorded, so the capture shim can refuse the export even on
          // the non-strict path. Only THROWN under `strict`, which the shim
          // passes: a live UI scrub of a still-mounting comp should stay
          // resilient, but a capture must never proceed on a seek that did not
          // happen. The old code did neither — it just resolved.
          w.__maude_seek_failures__ = (w.__maude_seek_failures__ ?? 0) + 1;
          if (opts?.strict) {
            throw new Error(
              `__maude_seek__: comp did not accept frame ${f} after ${SEEK_ATTEMPTS} attempts ` +
                '(Player never became ready) — refusing to report a seek that did not happen'
            );
          }
        }
      }
      await afterPaint();
      return;
    }
    // Ordinary-artboard fallback (no registered comp): drive WAAPI by time so a
    // manual `__maude_seek__` still works. The capture shim owns the primary
    // ordinary-artboard path (it seeks <video>.currentTime + getAnimations()).
    const fps = opts?.fps ?? 30;
    const ms = (frame / fps) * 1000;
    if (typeof document !== 'undefined') {
      for (const a of document.getAnimations()) {
        try {
          a.pause();
          a.currentTime = ms;
        } catch {
          /* unseekable animation — skip */
        }
      }
    }
    await afterPaint();
  };

  w.__maude_comps__ = () =>
    [...registry().values()].map((e) => ({
      id: e.id,
      fps: e.fps,
      durationInFrames: e.durationInFrames,
      width: e.width,
      height: e.height,
      artboardId: e.artboardId ?? null,
      artboardLabel: e.artboardLabel ?? null,
    }));

  w.__maude_render_video__ = async (compId, opts) => {
    const entry = registry().get(compId);
    if (!entry) throw new Error(`no registered video-comp with id "${compId}"`);
    if (typeof w.__maudeRenderVideo__ !== 'function') {
      throw new Error(
        'render-lib bundle not injected — the export capture must addScriptTag ' +
          'exporters/video-render-lib.ts before calling __maude_render_video__'
      );
    }
    return w.__maudeRenderVideo__({
      ...opts,
      component: entry.component,
      inputProps: entry.inputProps,
      width: entry.width,
      height: entry.height,
      fps: entry.fps,
      durationInFrames: entry.durationInFrames,
    });
  };
}

/** Find the compId of the nearest VideoComp mounted inside `container` (the
 *  target artboard element) — the artboard's own `data-dc-screen` id and the
 *  VideoComp's `id` prop are independent (an author rarely sets the latter),
 *  so the capture shim resolves by DOM containment rather than assuming a
 *  1:1 id match. Returns null when the artboard has no video-comp (an
 *  ordinary artboard, or a comp not yet mounted). */
export function findCompIdIn(container: Element): string | null {
  return container.querySelector('[data-comp-id]')?.getAttribute('data-comp-id') ?? null;
}

/** The inverse of `findCompIdIn` — walk UP from a mounted comp to the artboard
 *  that contains it, and read its id + visible label. Same rationale (the two
 *  ids are independent), used at registration time so every announced comp
 *  carries the artboard the user actually sees it on. */
export function findArtboardOf(el: Element | null): {
  artboardId: string | null;
  artboardLabel: string | null;
} {
  const board = el?.closest?.('[data-dc-screen]') ?? null;
  if (!board) return { artboardId: null, artboardLabel: null };
  // DIRECT children only, and only the two tags canvas-lib actually renders the
  // label as (`<header>` unpositioned / `<button>` positioned). A subtree-wide
  // `querySelector('.dc-artboard-label')` would take the first match in document
  // order anywhere below the artboard — including a hidden node planted ahead of
  // the real header, or one belonging to a nested artboard — and `textContent`
  // reads hidden nodes happily. The label is shell chrome the user reads to know
  // which artboard the transport moves, so it must come from the element
  // canvas-lib owns, not from whatever matches the class first.
  const header = labelElementOf(board);
  return {
    artboardId: board.getAttribute('data-dc-screen'),
    artboardLabel: header?.textContent?.trim() || null,
  };
}

/** The artboard's own label element (a direct child, the two tags canvas-lib renders it as), else null. */
function labelElementOf(board: Element): Element | undefined {
  return Array.from(board.children).find(
    (c) =>
      (c.tagName === 'HEADER' || c.tagName === 'BUTTON') &&
      c.classList.contains('dc-artboard-label')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoComp — the canvas-lib wrapper

export interface VideoCompProps extends VideoCompMeta {
  /** The Remotion composition component (frame-driven; NO CSS animations). */
  component: ComponentType<Record<string, unknown>>;
  /** Stable id (defaults to a mount-order slug) — keys the seek registry + the
   *  Timeline rows; match the enclosing DCArtboard id when there are several. */
  id?: string;
  /** Props forwarded to the composition (Remotion `inputProps`). */
  inputProps?: Record<string, unknown>;
  /** Show the Player's own transport chrome in PREVIEW. Auto-hidden during
   *  capture/export (the `?hide-chrome=1` shell flag). Default true. */
  controls?: boolean;
  /** Loop preview playback. Default false — the user opts in via the Timeline. */
  loop?: boolean;
  /**
   * Autoplay in preview. Default: play unless the viewer prefers reduced motion
   * (a11y) or the shell is in capture mode. Never autoplays during export.
   */
  autoPlay?: boolean;
}

let mountCounter = 0;

/**
 * S3.3 — the loop the Player gets. Present · Artboards plays a clip once and HOLDS its last frame (04
 * md-edge-mixed: "Holds its last frame when it ends; → moves on"), whatever the author or the Timeline
 * asked for in the editor. Everywhere else the loop is the author's / the Timeline's.
 */
export function loopFor(loop: boolean, presentingArtboards: boolean): boolean {
  return presentingArtboards ? false : loop;
}

const NO_SUBSCRIBE = () => () => {};

/** True while the shell has this canvas in Present · Artboards (the mode store the stage reads). */
function usePresentingArtboards(): boolean {
  const store = typeof window === 'undefined' ? null : canvasModeStore(window);
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    () => {
      const s = store?.get();
      return !!s && s.mode === 'present' && s.present?.kind === 'artboards';
    },
    () => false
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** True when the shell asked for a chrome-free render (export capture / diff). */
function hideChrome(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('hide-chrome') === '1';
  } catch {
    return false;
  }
}

/**
 * Mount a Remotion composition as a scrubbable video-comp artboard body. Place
 * it inside a `DCArtboard` whose width/height match the composition:
 *
 * ```tsx
 * const Intro = () => {
 *   const frame = useCurrentFrame();
 *   const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
 *   return <AbsoluteFill style={{ opacity }}>…</AbsoluteFill>;
 * };
 * // …inside the canvas:
 * <DCArtboard id="intro" label="Intro" width={640} height={360}>
 *   <VideoComp component={Intro} durationInFrames={90} fps={30} width={640} height={360} />
 * </DCArtboard>
 * ```
 */
export function VideoComp({
  component,
  durationInFrames,
  fps,
  width,
  height,
  id,
  inputProps,
  controls,
  loop = false,
  autoPlay,
}: VideoCompProps) {
  const ref = useRef<PlayerRef | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Stable id across re-renders; unique per mount when the author omits one.
  const [autoId] = useState(() => id ?? `videocomp-${++mountCounter}`);
  const compId = id ?? autoId;
  // Loop is live-controlled from the Timeline (timeline-loop message), not just
  // the mount prop — so toggling loop OFF actually stops the replay.
  const [loopState, setLoopState] = useState(loop);
  const presenting = usePresentingArtboards();
  const capturing = hideChrome();
  // The Timeline panel is the control surface (transport + scrub + volume), so
  // the Player's own chrome is redundant on the artboard — hidden by default.
  // Opt back in per-comp with `controls`; never shown during capture. (DDR-148.)
  const showControls = (controls ?? false) && !capturing;
  // Default to PAUSED in preview so the comp is editable on open (a moving,
  // frame-driven element can't be Cmd+Click-selected). The author can opt into
  // autoplay; capture never autoplays (the shim drives frames). Opens on a
  // poster frame ~35% in so a paused comp shows content, not an empty frame 0.
  const play = (autoPlay ?? false) && !capturing;
  const maxFrame = Math.max(0, durationInFrames - 1);
  // S7.8 — the poster frame is `artboardMeta[id].poster` (the picture the artboard rests on, and the export's);
  // absent = today's 35 % of the length.
  const posterFrame = capturing
    ? 0
    : resolvedPoster(readCanvasArtboardMeta(), compId, Math.max(1, Math.round(durationInFrames)));
  // rca/issue-video-artboard-frame-reset-on-edit — reopen on the Timeline's
  // last known frame for this comp (survives the remount that tore this
  // instance down), not the fixed poster-frame formula. Falls back to
  // posterFrame on a genuinely first-ever mount (nothing recorded yet).
  const initialFrame = capturing
    ? 0
    : clamp(liveTimelineFrame.get(compId) ?? posterFrame, 0, maxFrame);

  // Register with the seek bridge for the lifetime of this mount.
  useEffect(() => {
    installMaudeSeekBridge();
    // Resolved here (not at render) because the wrapper is only in the DOM once
    // the effect runs — that's also when the enclosing DCArtboard exists.
    const { artboardId, artboardLabel } = findArtboardOf(hostRef.current);
    const entry: CompEntry = {
      id: compId,
      artboardId,
      artboardLabel,
      fps,
      durationInFrames,
      width,
      height,
      ref,
      component,
      inputProps: inputProps ?? {},
    };
    registry().set(compId, entry);
    // 07 · M1: the label reads "Name · Format · Length" — the tail is data the label's ::after draws (canvas-lib css)
    const board = hostRef.current?.closest?.('[data-dc-screen]') ?? null;
    const labelEl = board ? labelElementOf(board) : undefined;
    labelEl?.setAttribute(
      'data-dc-vtail',
      videoLabelTail(artboardLabel ?? '', { fps, durationInFrames, width, height }, false)
    );
    emitPlayhead();
    // Announce comps to the shell so the Timeline panel can auto-suggest.
    postToShell({ dgn: 'timeline-comps', comps: seekWindow()?.__maude_comps__?.() ?? [] });
    return () => {
      const cur = registry().get(compId);
      if (cur === entry) registry().delete(compId);
      labelEl?.removeAttribute('data-dc-vtail');
      emitPlayhead();
      postToShell({ dgn: 'timeline-comps', comps: seekWindow()?.__maude_comps__?.() ?? [] });
    };
  }, [compId, fps, durationInFrames, width, height, component, inputProps]);

  // Shell → iframe transport: the Timeline panel drives preview scrub/playback.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      const m = e.data as {
        dgn?: string;
        frame?: number;
        id?: string;
        muted?: boolean;
        volume?: number;
        loop?: boolean;
      } | null;
      if (!m || typeof m !== 'object' || typeof m.dgn !== 'string') return;
      // The shell asks a (possibly already-mounted) canvas to re-announce its
      // comps — answer regardless of Player readiness so a tab-switch / panel-
      // open re-syncs the Timeline panel.
      if (m.dgn === 'timeline-request-comps') {
        postToShell({ dgn: 'timeline-comps', comps: seekWindow()?.__maude_comps__?.() ?? [] });
        return;
      }
      if (m.id && m.id !== compId) return; // targeted seek to another comp
      const p = ref.current;
      if (!p) return;
      try {
        if (m.dgn === 'timeline-seek' && typeof m.frame === 'number') {
          const f = clamp(Math.round(m.frame), 0, Math.max(0, durationInFrames - 1));
          p.pause();
          p.seekTo(f);
          liveTimelineFrame.set(compId, f);
          emitPlayhead(compId, f);
        } else if (m.dgn === 'timeline-play') {
          p.play();
        } else if (m.dgn === 'timeline-pause') {
          p.pause();
        } else if (m.dgn === 'timeline-mute') {
          // Sound is controlled from the Timeline (the artboard has no chrome).
          if (m.muted) p.mute();
          else p.unmute();
        } else if (m.dgn === 'timeline-volume' && typeof m.volume === 'number') {
          p.setVolume(clamp(m.volume, 0, 1));
        } else if (m.dgn === 'timeline-loop') {
          setLoopState(!!m.loop);
        }
      } catch {
        /* Player transitional — ignore */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [compId, durationInFrames]);

  // iframe → shell: mirror the playhead so the Timeline panel tracks preview.
  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const onFrame = () => {
      try {
        const f = p.getCurrentFrame();
        liveTimelineFrame.set(compId, f);
        emitPlayhead(compId, f);
        postToShell({ dgn: 'timeline-frame', id: compId, frame: f });
      } catch {
        /* ignore */
      }
    };
    p.addEventListener('frameupdate', onFrame);
    return () => {
      try {
        p.removeEventListener('frameupdate', onFrame);
      } catch {
        /* ignore */
      }
    };
  }, [compId]);

  // S7.8 — the poster moved (set from the timeline, or by a peer): a video nobody has played or scrubbed
  // rests on the new picture; one whose playhead was moved keeps its place. The poster is keyed by the
  // enclosing artboard's id (the `<VideoComp id>` when it matches), so it is looked up once mounted too.
  const resting = useRef<number | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined' || capturing) return undefined;
    const rest = () => {
      const p = ref.current;
      if (!p) return;
      const seen = liveTimelineFrame.get(compId);
      if (seen !== undefined && seen !== resting.current) return; // moved by hand, or playing
      const artboard = findArtboardOf(hostRef.current).artboardId ?? compId;
      const to = clamp(
        resolvedPoster(
          readCanvasArtboardMeta(),
          artboard,
          Math.max(1, Math.round(durationInFrames))
        ),
        0,
        Math.max(0, durationInFrames - 1)
      );
      if (to === resting.current && seen === to) return;
      resting.current = to;
      try {
        p.seekTo(to);
      } catch {
        /* Player transitional */
      }
    };
    rest();
    document.addEventListener('maude:meta-refreshed', rest);
    return () => document.removeEventListener('maude:meta-refreshed', rest);
  }, [compId, durationInFrames, capturing]);

  // S7.8 — the Player is the truth about playing: tell the shell on every play / pause, so a click on the
  // artboard's own button and the Timeline's Space or button can never disagree.
  useEffect(() => {
    const p = ref.current;
    if (!p || capturing) return undefined;
    const tell = (playing: boolean) => () =>
      postToShell({ dgn: 'timeline-playing', id: compId, playing });
    const onPlay = tell(true);
    const onPause = tell(false);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    return () => {
      try {
        p.removeEventListener('play', onPlay);
        p.removeEventListener('pause', onPause);
      } catch {
        /* unmounted */
      }
    };
  }, [compId, capturing]);

  // iframe → shell: with loop off (now the default), the Player stops itself
  // at the last frame — nothing else tells the Timeline panel's Play/Pause
  // button to flip back to Play, so it reads "still playing" forever. Mirror
  // the Player's own `ended` event so the shell can resync (rca/issue-video-
  // artboard-loop-defaults-on).
  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const onEnded = () => postToShell({ dgn: 'timeline-ended', id: compId });
    p.addEventListener('ended', onEnded);
    return () => {
      try {
        p.removeEventListener('ended', onEnded);
      } catch {
        /* ignore */
      }
    };
  }, [compId]);

  const style = useMemo(() => ({ width: '100%', height: '100%', display: 'block' as const }), []);

  return (
    <div
      className="dc-video-comp"
      ref={hostRef}
      data-comp-id={compId}
      style={{ width, height, maxWidth: '100%', position: 'relative' }}
    >
      <Player
        ref={ref}
        component={component}
        durationInFrames={Math.max(1, Math.round(durationInFrames))}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        inputProps={inputProps ?? {}}
        controls={showControls}
        loop={loopFor(loopState, presenting)}
        autoPlay={play}
        initialFrame={initialFrame}
        // Clicking the artboard must NOT toggle playback — it selects elements
        // for editing (the whole point of a canvas). Play only via the explicit
        // transport button (Player controls / Timeline panel). Same for the
        // spacebar, which is the canvas pan chord. (DDR-148 feedback #2.)
        clickToPlay={false}
        spaceKeyToPlayOrPause={false}
        doubleClickToFullscreen={false}
        // We ship Remotion in-house and disclose the license (DDR-148); ack in
        // code so the Player never nags/watermarks the preview.
        acknowledgeRemotionLicense
        style={style}
      />
      {capturing || presenting ? null : (
        <VideoPlayChrome
          playerRef={ref}
          fps={fps}
          durationInFrames={Math.max(1, Math.round(durationInFrames))}
        />
      )}
    </div>
  );
}
VideoComp.displayName = 'VideoComp';

/** `window.__canvas_meta__` (the shell injects the sidecar before mount): what a canvas may read of it. */
function readCanvasArtboardMeta(): unknown {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __canvas_meta__?: unknown }).__canvas_meta__;
}

function postToShell(payload: Record<string, unknown>): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage(payload, '*');
  } catch {
    /* cross-origin parent without our listener — no-op */
  }
}
