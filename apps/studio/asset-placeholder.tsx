// asset-placeholder.tsx — S8.19 (L1): the placeholder frame a canvas draws over a picture that is not
// on this Mac. "Waiting for Jonas's Mac" is quiet (it fills in by itself); only a picture no device
// has is "Missing", with Relink….
//
// Data flow, one direction only: the shell (client/v2/assets/asset-state-lane.js) posts
// `{ dgn: 'asset-state', items }` — a state and a display name per rel the canvas FILE names (the
// shell asks the studio `?canvas=`, never a list from here). This layer never asks a route.
//
// A frame is drawn only over an element that actually FAILED to load: a picture that heals (the
// file plane lands it and the `mode:'asset'` heal reloads the element) drops its frame on `load`,
// with no reload and no second message — and a file on this disk always wins.
//
// Anything uncertain is "Not here yet", never Missing. Outside a shell (an export capture, a
// headless screenshot) nothing is ever sent, so nothing is ever drawn — exports carry no frames.
//
// 2.0.3 — a Git LFS placeholder (`lfs-pointer`: the file here is a pointer, not the picture) says so
// in plain words. Where the shell can repair it (`lfsActions`, the desktop app's AI chat) the frame
// adds "Fix with AI" and "Copy prompt"; both only NAME the rel (`asset-lfs-fix-request`,
// `asset-lfs-copy-request`) — the shell builds the prompt from its own answer and does the clipboard
// write (this iframe has no clipboard rights), then answers `asset-lfs-copied` for the "Copied" word.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UploadBars } from './asset-upload-bars.tsx';
import { type AssetStateItem, acceptFromShell } from './bridge/dgn-protocol.ts';
import { frameCaf, frameRaf } from './frame-clock.ts';

/** What a frame says. `null` = draw nothing (the picture is here, or still uploading from here). */
export interface FrameWords {
  state: 'waiting' | 'missing' | 'lfs-pointer';
  line: string;
  relink: boolean;
}

/** 2.0.3 — the line a Git LFS placeholder wears. */
export const LFS_LINE = 'Not downloaded — Git LFS placeholder';
/** How long "Copy prompt" reads "Copied" after the shell said it copied. */
export const LFS_COPIED_MS = 1500;

const KIND_WORD = { mac: 'Mac', pc: 'PC', linux: 'computer' } as const;

/**
 * Relink on a Missing frame: the shell's relink sheet and the `asset.relink` edit op are live (S8.19c).
 * The button only asks (`asset-relink-request`); the shell decides, from its own answer, and a session
 * that cannot edit opens nothing.
 */
export const RELINK_LIVE = true;

/** "jonas" → "Jonas's" (the canvas words: "Waiting for Jonas's Mac"). */
function possessive(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}'s`;
}

/** The §5.5 words. A name only, never an address: "Jonas's device" when the kind is unknown. */
export function frameWords(item: AssetStateItem | undefined): FrameWords | null {
  if (!item || item.state === 'here' || item.state === 'uploading') return null;
  if (item.state === 'lfs-pointer') return { state: 'lfs-pointer', line: LFS_LINE, relink: false };
  if (item.state === 'missing') {
    return { state: 'missing', line: 'Missing — no device has it', relink: RELINK_LIVE };
  }
  if (item.syncing) return { state: 'waiting', line: 'Syncing…', relink: false };
  const who = item.who;
  const kind = who?.kind ? KIND_WORD[who.kind] : 'device';
  if (who?.self) return { state: 'waiting', line: `Waiting for your other ${kind}`, relink: false };
  if (who?.name && !who.name.includes('@')) {
    return { state: 'waiting', line: `Waiting for ${possessive(who.name)} ${kind}`, relink: false };
  }
  return { state: 'waiting', line: 'Not here yet', relink: false };
}

/**
 * The rel an element's `src` names, among the rels the shell told us about. The raw attribute is
 * tried first (`/assets/x.png`, `./assets/x.png`), then the resolved URL's path suffix.
 */
export function relOfSrc(
  raw: string | null,
  resolved: string,
  known: ReadonlySet<string>
): string | null {
  if (raw) {
    let s = raw.trim().replace(/[?#].*$/, '');
    while (s.startsWith('./')) s = s.slice(2);
    s = s.replace(/^\/+/, '');
    if (known.has(s)) return s;
  }
  let p = '';
  try {
    p = decodeURIComponent(new URL(resolved).pathname);
  } catch {
    return null;
  }
  for (const rel of known) if (p === `/${rel}` || p.endsWith(`/${rel}`)) return rel;
  return null;
}

type Media = HTMLImageElement | HTMLVideoElement;

/** Failed, not merely loading: an `<img>` that completed with no pixels, a `<video>` with no source. */
function failed(el: Media): boolean {
  if (el instanceof HTMLImageElement) return el.complete && el.naturalWidth === 0;
  return el.error !== null || el.networkState === 3; // NETWORK_NO_SOURCE
}

/** A frame smaller than this in either direction has no room for the card (12 · ia-missing-gone: a collapsed broken `<img>`). */
export const FRAME_MIN = 96;

/** The line a picture that cannot be loaded wears (a src no shell state explained: the file is gone, or never served). */
export const LOST_LINE = 'Picture not found';
/** r5-1: the same, for a `<video>` that cannot be loaded ("Video not found · <path>" — never "Picture not found" for a clip). */
export const LOST_VIDEO_LINE = 'Video not found';

/** A failed `<img>` asks again after each delay (a picture refused on first load because its canvas write had not landed). */
export const LOST_RETRY_DELAYS_MS: readonly number[] = [400, 1200, 3000, 6000];

/**
 * The project path a failed element asked for, for the frame's name: `assets/x.png`, `ui/assets/x.png`. Null for a
 * blob: / data: source or anything with no readable path (nothing useful to name, so no frame).
 */
export function lostPathOf(raw: string | null, resolved: string): string | null {
  const src = (raw ?? '').trim();
  if (!src || /^(?:blob|data):/i.test(src)) return null;
  let p = '';
  try {
    p = decodeURIComponent(new URL(resolved || src, 'http://x.invalid/').pathname);
  } catch {
    return null;
  }
  p = p.replace(/^\/+/, '');
  return p ? p : null;
}

/** `assets/x.png?v=2` becomes `assets/x.png?v=2&r=1`: the same file asked for again (the first answer is not kept). */
export function retryHref(href: string, attempt: number): string {
  const base = href.replace(/([?&])r=\d+(&|$)/, '$1').replace(/[?&]$/, '');
  return `${base}${base.includes('?') ? '&' : '?'}r=${attempt}`;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The rectangle a failed picture's frame covers. A broken `<img>` with no authored height collapses to a few pixels, so
 * following ITS rectangle draws a hatched strip and clips the card away. The board hatches the whole picture frame, so a
 * collapsed element takes the nearest ancestor that is big enough to hold the card (never past the body).
 */
export function frameBox(el: {
  getBoundingClientRect(): Box;
  parentElement: unknown;
  tagName?: string;
}): Box | null {
  const own = el.getBoundingClientRect();
  if (own.width >= FRAME_MIN && own.height >= FRAME_MIN) return own;
  // r5-1: a `<video>` never collapses (it has its own size), so a clip that is merely SMALL (zoomed out) keeps its own
  // rectangle. Walking up to "an ancestor big enough for the card" took the whole world there and hatched the screen.
  if (el.tagName === 'VIDEO' && own.width >= 2 && own.height >= 2) return own;
  const vw = typeof window !== 'undefined' ? window.innerWidth : Number.POSITIVE_INFINITY;
  const vh = typeof window !== 'undefined' ? window.innerHeight : Number.POSITIVE_INFINITY;
  let up = el.parentElement as (typeof el & { tagName?: string }) | null;
  for (let i = 0; up && up.tagName !== 'BODY' && up.tagName !== 'HTML' && i < 6; i++) {
    const r = up.getBoundingClientRect();
    // an ancestor that fills the viewport is the page / the world, never "the picture's frame"
    if (r.width >= vw && r.height >= vh) break;
    if (r.width >= FRAME_MIN && r.height >= FRAME_MIN) return r;
    up = up.parentElement as typeof up;
  }
  // nothing around it is big enough: hold the card in a box of its own, anchored where the picture is
  if (own.width < 2 && own.height < 2) return null;
  return {
    left: own.left,
    top: own.top,
    width: Math.max(own.width, FRAME_MIN * 1.6),
    height: Math.max(own.height, FRAME_MIN),
  };
}

const CSS = `
.dc-absent-layer {
  --dc-absent-bg: oklch(0.96 0.004 250);
  --dc-absent-stripe: oklch(0.9 0.006 250);
  --dc-absent-edge: oklch(0.82 0.008 250);
  --dc-absent-card: oklch(0.995 0.002 250);
  --dc-absent-ink: oklch(0.22 0.01 250);
  --dc-absent-muted: oklch(0.45 0.01 250);
  --dc-absent-error: oklch(0.58 0.2 27);
  --dc-absent-error-soft: oklch(0.58 0.2 27 / 0.28);
  --dc-absent-accent: oklch(0.53 0.175 238);
  --dc-absent-accent-fg: oklch(0.99 0.004 238);
  position: fixed; inset: 0; z-index: 6; pointer-events: none;
  font: 12px/1.35 var(--font-body, system-ui, -apple-system, sans-serif);
}
.dc-absent-ride { position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: visible;
  transform-origin: 0 0; will-change: transform; }
:root[data-maude-theme="dark"] .dc-absent-layer {
  --dc-absent-bg: oklch(0.25 0.006 250);
  --dc-absent-stripe: oklch(0.3 0.008 250);
  --dc-absent-edge: oklch(0.4 0.01 250);
  --dc-absent-card: oklch(0.2 0.006 250);
  --dc-absent-ink: oklch(0.96 0.004 250);
  --dc-absent-muted: oklch(0.75 0.008 250);
  --dc-absent-error: oklch(0.68 0.18 27);
  --dc-absent-error-soft: oklch(0.68 0.18 27 / 0.3);
  --dc-absent-accent: oklch(0.64 0.165 238);
  --dc-absent-accent-fg: oklch(0.18 0.03 238);
}
.dc-absent { position: fixed; display: none; place-items: center; overflow: hidden; box-sizing: border-box;
  background-color: var(--dc-absent-bg); }
.dc-absent[data-state="waiting"] { background-image: repeating-linear-gradient(135deg, var(--dc-absent-stripe) 0 2px, transparent 2px 9px);
  box-shadow: inset 0 0 0 1px var(--dc-absent-edge); }
.dc-absent[data-state="missing"] { background-image: repeating-linear-gradient(135deg, var(--dc-absent-error-soft) 0 2px, transparent 2px 9px);
  box-shadow: inset 0 0 0 1.5px var(--dc-absent-error); }
.dc-absent-in { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: calc(100% - 16px);
  padding: 8px 12px; border-radius: 8px; background: var(--dc-absent-card); text-align: center;
  box-shadow: 0 1px 2px oklch(0 0 0 / 0.12); }
.dc-absent-ic { display: none; color: var(--dc-absent-error); }
.dc-absent[data-state="missing"] .dc-absent-ic { display: block; }
.dc-absent-n { font-weight: 600; color: var(--dc-absent-ink); overflow-wrap: anywhere; }
.dc-absent-d { color: var(--dc-absent-muted); }
.dc-absent[data-state="missing"] .dc-absent-d { color: var(--dc-absent-error); }
.dc-absent-btn { pointer-events: auto; margin-top: 2px; padding: 3px 10px; border: 0; border-radius: 6px; cursor: pointer;
  font: inherit; font-weight: 600; background: var(--dc-absent-accent); color: var(--dc-absent-accent-fg); }
.dc-absent-btn:focus-visible { outline: 2px solid var(--dc-absent-accent); outline-offset: 2px; }
.dc-absent[data-state="lfs-pointer"] { background-image: repeating-linear-gradient(135deg, var(--dc-absent-stripe) 0 2px, transparent 2px 9px);
  box-shadow: inset 0 0 0 1px var(--dc-absent-edge); }
.dc-absent-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.dc-absent-btn--quiet { background: transparent; color: var(--dc-absent-ink); box-shadow: inset 0 0 0 1px var(--dc-absent-edge); }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('dc-absent-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-absent-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

interface Frame {
  key: string;
  rel: string;
  el: Media;
  words: FrameWords;
  /** r4 img 44: no shell state explained this failure, so the frame names the path it asked for. */
  lost?: boolean;
  /** 2.0.7 — the canvas world the picture sits in: its frame rides the camera (null: a picture outside the world). */
  world: HTMLElement | null;
}

/** The camera the canvas last wrote (canvas-lib `getLiveViewport`): screen = canvas origin + (x, y) + zoom · world. */
export interface FrameCamera {
  x: number;
  y: number;
  zoom: number;
}

const sameCamera = (a: FrameCamera, b: FrameCamera) =>
  a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/**
 * 2.0.7 — the transform that carries frames measured under camera `at` (world origin `origin` on screen then) to
 * where camera `now` puts them. The world moved by (now − at) and scaled by now.zoom / at.zoom about its origin, so a
 * point p measured then is now at origin' + k·(p − origin): translate(origin' − k·origin) scale(k).
 */
export function rideTransform(
  at: FrameCamera,
  origin: { left: number; top: number },
  now: FrameCamera
): string {
  const k = now.zoom / (at.zoom || 1);
  const ox = origin.left + (now.x - at.x);
  const oy = origin.top + (now.y - at.y);
  return `translate(${ox - k * origin.left}px, ${oy - k * origin.top}px) scale(${k})`;
}

/** A failed picture or clip is asked for again (its first answer may have been refused before the canvas write landed). */
const retriable = (el: Media): boolean =>
  el instanceof HTMLImageElement || el instanceof HTMLVideoElement;

const baseName = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

/** The canvas world (`.dc-world`, canvas-lib) a picture sits in, if any. */
const worldOf = (el: Element): HTMLElement | null => el.closest<HTMLElement>('.dc-world');

/** The layer. Mounted once by DesignCanvas (canvas-lib's named S8.19 block). */
export function AssetPlaceholderLayer({
  inShell,
  retryDelays = LOST_RETRY_DELAYS_MS,
  camera,
  interacting,
}: {
  /** Test seam: the layer only judges pictures inside the shell's frame (an export capture carries no frames). */
  inShell?: boolean;
  retryDelays?: readonly number[];
  /**
   * 2.0.7 — the live camera (DesignCanvas passes canvas-lib's `getLiveViewport`). With it, a frame over a picture in
   * the world rides a camera move on one transform instead of a layout read per frame. Omitted: every frame measures.
   */
  camera?: () => FrameCamera | null;
  /** 2.0.7 — a pan / zoom gesture is running (the controller's `isInteracting`): nothing is measured until it ends. */
  interacting?: boolean;
} = {}) {
  const [items, setItems] = useState<ReadonlyMap<string, AssetStateItem>>(new Map());
  const [frames, setFrames] = useState<Frame[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  // 2.0.3: the shell can repair an LFS placeholder (its AI chat exists); rel → what Copy prompt says now.
  const [lfsActions, setLfsActions] = useState(false);
  const [copied, setCopied] = useState<ReadonlyMap<string, 'copied' | 'failed'>>(new Map());
  const copiedTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timers = copiedTimers.current;
    const onMessage = (e: MessageEvent) => {
      // Only the shell may say it (DDR-054); the table parses it (≤ 256 items, no e-mail names).
      if (e.source !== window.parent) return;
      const dgn = (e.data as { dgn?: string } | null)?.dgn;
      if (dgn !== 'asset-state' && dgn !== 'asset-lfs-copied') return;
      const m = acceptFromShell(e, window);
      if (m && m.dgn === 'asset-state') {
        ensureStyles();
        setItems(new Map(m.items.map((it) => [it.rel, it])));
        setLfsActions(m.lfsActions === true);
      } else if (m && m.dgn === 'asset-lfs-copied') {
        const rel = m.rel;
        setCopied((prev) => new Map(prev).set(rel, m.ok ? 'copied' : 'failed'));
        const old = timers.get(rel);
        if (old) clearTimeout(old);
        timers.set(
          rel,
          setTimeout(() => {
            timers.delete(rel);
            setCopied((prev) => {
              const next = new Map(prev);
              next.delete(rel);
              return next;
            });
          }, LFS_COPIED_MS)
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Which elements need a frame: rescanned on news, and on every media load / error (capture
  // phase — neither bubbles). A healed picture's `load` drops its frame.
  const known = useMemo(() => {
    const s = new Set<string>();
    for (const [rel, it] of items) if (frameWords(it)) s.add(rel);
    return s;
  }, [items]);
  // r4 img 44: a picture that FIRED an error and that no shell state explains (the state said "here", or named
  // nothing) is never left as the browser's bare "?" icon. An `<img>` asks again on a short ladder (a first answer
  // refused before the canvas write landed), then the layer says "Picture not found" with the path it asked for.
  const lostRef = useRef({
    errored: new WeakSet<Media>(),
    attempts: new WeakMap<Media, number>(),
    timers: new Set<ReturnType<typeof setTimeout>>(),
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const lost = lostRef.current;
    const inside = inShell ?? (typeof window !== 'undefined' && window.parent !== window);
    const scan = () => {
      const next: Frame[] = [];
      const els = document.querySelectorAll<Media>('img, video');
      els.forEach((el, i) => {
        if (el.closest('.dc-absent-layer') || !failed(el)) return;
        const raw = el.getAttribute('src');
        const resolved = el.currentSrc || (el as HTMLImageElement).src || '';
        const rel = known.size ? relOfSrc(raw, resolved, known) : null;
        const words = rel ? frameWords(items.get(rel)) : null;
        if (rel && words) {
          next.push({ key: `${rel}#${i}`, rel, el, words, world: worldOf(el) });
          return;
        }
        if (!inside || !lost.errored.has(el)) return;
        // still asking again (see onMedia)
        if (retriable(el) && (lost.attempts.get(el) ?? 0) < retryDelays.length) return;
        const path = lostPathOf(raw, resolved);
        if (path) ensureStyles();
        if (path)
          next.push({
            key: `${path}#${i}`,
            rel: path,
            el,
            words: {
              state: 'missing',
              line: el instanceof HTMLVideoElement ? LOST_VIDEO_LINE : LOST_LINE,
              relink: false,
            },
            lost: true,
            world: worldOf(el),
          });
      });
      setFrames((prev) =>
        prev.length === next.length &&
        prev.every(
          (p, i) =>
            p.key === next[i]?.key &&
            p.el === next[i]?.el &&
            p.words.line === next[i]?.words.line &&
            p.world === next[i]?.world
        )
          ? prev
          : next
      );
    };
    // One failure: remember it, and (an `<img>` inside the shell) ask again after the next delay on the ladder.
    const pending = new Map<Media, ReturnType<typeof setTimeout>>();
    const fail = (el: Media) => {
      lost.errored.add(el);
      const n = lost.attempts.get(el) ?? 0;
      const src = el.getAttribute('src') ?? '';
      if (!inside || !retriable(el) || !src || /^(?:blob|data):/i.test(src)) return;
      if (n >= retryDelays.length || pending.has(el)) return;
      const t = setTimeout(() => {
        lost.timers.delete(t);
        pending.delete(el);
        lost.attempts.set(el, n + 1);
        if (el.isConnected) el.setAttribute('src', retryHref(src, n + 1));
      }, retryDelays[n] ?? 0);
      pending.set(el, t);
      lost.timers.add(t);
    };
    // A first scan also takes a picture that failed before this layer listened (no `error` seen for it).
    document.querySelectorAll<Media>('img, video').forEach((el) => {
      const src = el.getAttribute('src') ?? '';
      if (failed(el) && src && !/\.svg(?:[?#]|$)/i.test(src)) fail(el);
    });
    scan();
    // 2.0.7 — one scan per burst, not one per event: a heavy canvas mounting artboard after artboard fires a
    // mutation and an image `load` per picture, and every scan walks every <img>/<video> of the document
    // (quadratic in pictures while it loads — the mascot canvas spent ~130 ms of a pan here).
    let scanTimer: ReturnType<typeof setTimeout> | null = null;
    const scanSoon = () => {
      if (scanTimer != null) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scan();
      }, 120);
    };
    const onMedia = (ev?: Event) => {
      const el = ev?.target as Media | undefined;
      const isMedia = el instanceof HTMLImageElement || el instanceof HTMLVideoElement;
      if (isMedia && ev?.type === 'load') {
        lost.errored.delete(el);
        lost.attempts.delete(el);
        const t = pending.get(el);
        if (t) clearTimeout(t);
        pending.delete(el);
      } else if (isMedia && ev?.type === 'error') {
        // a failure is rare and its frame must show at once (r5-1): scan now; loads and mutations batch
        fail(el);
        scan();
        return;
      }
      scanSoon();
    };
    document.addEventListener('error', onMedia, true);
    document.addEventListener('load', onMedia, true);
    const mo = new MutationObserver(() => onMedia());
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    return () => {
      document.removeEventListener('error', onMedia, true);
      document.removeEventListener('load', onMedia, true);
      mo.disconnect();
      if (scanTimer != null) clearTimeout(scanTimer);
      for (const t of lost.timers) clearTimeout(t);
      lost.timers.clear();
    };
  }, [items, known, inShell, retryDelays]);

  // One animation-frame loop while any frame exists: follow each element's on-screen rectangle.
  //
  // 2.0.7 — not by reading layout while the camera moves. Measuring every frame was a getBoundingClientRect per
  // missing picture (more for a collapsed one, frameBox walks up) in every frame of a pan or zoom: ~40 ms a frame
  // in WebKit on the mascot canvas (59 missing pictures). The frames stay in this body layer — inside `.dc-world`
  // the input router would claim their buttons (isOverlayTarget refuses anything in the world) — so a frame over a
  // picture in the world rides the camera instead: the wrapper takes one transform computed from the camera
  // numbers (rideTransform), and the frames are measured again on the first frame the camera is still and no
  // gesture runs. With no camera (an older mount, a test page), every frame measures as before.
  const interactingRef = useRef(!!interacting);
  interactingRef.current = !!interacting;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const rideRef = useRef<HTMLDivElement | null>(null);
  const rideWorld = camera ? (frames.find((f) => f.world)?.world ?? null) : null;
  useEffect(() => {
    if (frames.length === 0) return;
    let raf: number | null = null;
    let last: FrameCamera | null = null; // the camera on the previous frame
    let at: FrameCamera | null = null; // the camera the riding frames were last measured under
    let origin = { left: 0, top: 0 }; // the world's origin on screen then
    const written = new Map<HTMLDivElement, string>();
    const place = (f: Frame, div: HTMLDivElement) => {
      const r = f.el.isConnected ? frameBox(f.el) : null;
      const box =
        !r || r.width < 2 || r.height < 2
          ? 'none'
          : `${Math.round(r.left)} ${Math.round(r.top)} ${Math.round(r.width)} ${Math.round(r.height)}`;
      if (written.get(div) === box) return;
      written.set(div, box);
      if (!r || box === 'none') {
        div.style.display = 'none';
        return;
      }
      div.style.display = 'grid';
      div.style.left = `${Math.round(r.left)}px`;
      div.style.top = `${Math.round(r.top)}px`;
      div.style.width = `${Math.round(r.width)}px`;
      div.style.height = `${Math.round(r.height)}px`;
    };
    const setRide = (t: string) => {
      const ride = rideRef.current;
      if (ride && ride.style.transform !== t) ride.style.transform = t;
    };
    const tick = () => {
      raf = null;
      const cam = rideWorld ? (cameraRef.current?.() ?? null) : null;
      const moved = !!cam && !!last && !sameCamera(cam, last);
      last = cam;
      const riding = !!cam && (moved || interactingRef.current);
      if (riding && cam) {
        // the camera is moving (or a gesture holds it): carry what was measured, read nothing
        if (at) setRide(rideTransform(at, origin, cam));
      } else if (cam && rideWorld) {
        const o = rideWorld.getBoundingClientRect();
        origin = { left: o.left, top: o.top };
        at = cam;
        setRide('');
      }
      for (const f of frames) {
        if (riding && f.world === rideWorld) continue;
        const div = nodes.current.get(f.key);
        if (div) place(f, div);
      }
      raf = frameRaf(tick);
    };
    raf = frameRaf(tick);
    return () => {
      if (raf != null) frameCaf(raf);
    };
  }, [frames, rideWorld]);

  if (typeof document === 'undefined') return null;
  // S8.14 — a picture still going up wears a thin bar (asset-upload-bars.tsx); it is a sibling layer, so it needs no frame
  const bars = <UploadBars items={items} relOf={relOfSrc} />;
  if (frames.length === 0) return bars;
  const draw = (f: Frame) => {
    const lfs = f.words.state === 'lfs-pointer' && lfsActions && !f.lost;
    const copyWord = copied.get(f.rel);
    return (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is `group` or `img` (both take a name)
      <div
        key={f.key}
        ref={(el) => {
          if (el) nodes.current.set(f.key, el);
          else nodes.current.delete(f.key);
        }}
        className="dc-absent"
        data-testid="asset-frame"
        data-rel={f.rel}
        data-state={f.words.state}
        data-lost={f.lost ? '1' : undefined}
        // gate-b-a11y: `img` cannot hold the Relink… button (axe nested-interactive) — a labelled group can
        role={f.words.relink || lfs ? 'group' : 'img'}
        aria-label={
          f.lost && f.words.line === LOST_VIDEO_LINE
            ? `${f.words.line} · ${f.rel}`
            : `${f.lost ? f.rel : baseName(f.rel)} · ${f.words.line}`
        }
      >
        <span className="dc-absent-in">
          <svg
            className="dc-absent-ic"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2.2 14.2 13H1.8z" />
            <path d="M8 6.4v3.2" />
            <circle cx="8" cy="11.3" r="0.4" fill="currentColor" />
          </svg>
          <span className="dc-absent-n">{f.lost ? f.rel : baseName(f.rel)}</span>
          <span className="dc-absent-d">{f.words.line}</span>
          {f.words.relink ? (
            <button
              type="button"
              className="dc-absent-btn"
              data-testid="asset-frame-relink"
              onClick={() => {
                // A literal `{ dgn }` so the bridge inventory sees this send site.
                try {
                  window.parent.postMessage({ dgn: 'asset-relink-request', rel: f.rel }, '*');
                } catch {
                  /* detached */
                }
              }}
            >
              Relink…
            </button>
          ) : null}
          {lfs ? (
            <span className="dc-absent-row">
              <button
                type="button"
                className="dc-absent-btn"
                data-testid="asset-frame-lfs-fix"
                onClick={() => {
                  // A literal `{ dgn }` so the bridge inventory sees this send site.
                  try {
                    window.parent.postMessage({ dgn: 'asset-lfs-fix-request', rel: f.rel }, '*');
                  } catch {
                    /* detached */
                  }
                }}
              >
                Fix with AI
              </button>
              <button
                type="button"
                className="dc-absent-btn dc-absent-btn--quiet"
                data-testid="asset-frame-lfs-copy"
                aria-live="polite"
                onClick={() => {
                  // A literal `{ dgn }` so the bridge inventory sees this send site.
                  try {
                    window.parent.postMessage({ dgn: 'asset-lfs-copy-request', rel: f.rel }, '*');
                  } catch {
                    /* detached */
                  }
                }}
              >
                {copyWord === 'copied'
                  ? 'Copied'
                  : copyWord === 'failed'
                    ? 'Couldn’t copy'
                    : 'Copy prompt'}
              </button>
            </span>
          ) : null}
        </span>
      </div>
    );
  };
  // 2.0.7 — frames over pictures in the world ride the camera in one wrapper; any other frame is placed directly.
  const riders = frames.filter((f) => rideWorld && f.world === rideWorld);
  const fixed = frames.filter((f) => !(rideWorld && f.world === rideWorld));
  return (
    <>
      {bars}
      {createPortal(
        <div className="dc-absent-layer" data-testid="asset-frames">
          <div className="dc-absent-ride" ref={rideRef}>
            {riders.map(draw)}
          </div>
          {fixed.map(draw)}
        </div>,
        document.body
      )}
    </>
  );
}
