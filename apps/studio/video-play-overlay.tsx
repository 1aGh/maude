// video-play-overlay.tsx — r5-2 (Michal: "video lze prehrat jen v presentation mode"). A `<video controls>` on the canvas (an
// artboard's placed clip, or an annotation video) gets a small play / pause button over its corner while the pointer is on it
// or it is selected, in Edit AND Preview. In Edit the canvas takes the press (it selects the clip), so the native controls are
// out of reach; the button is its own hit target — one click plays or pauses, and the press never reaches the selection
// handlers (`.dc-vplay` is in their chrome lists). Space still plays the selected clip (editing/video-play.ts).
//
// rc3 walk (r4-1): a paused clip that has not started also shows WebKit's own big centre ▶ (and Chromium's), and in Edit
// a click on it only selected — the canvas takes the press. The layer draws its own centre ▶ exactly over it (the same
// 60 px disc, measured in a WKWebView), so the first click there plays; a click anywhere else on the clip still selects.
// It goes once the clip has started, when the native one does too.
//
// Drawn as a body-level fixed layer (like asset-placeholder.tsx's frames), never inside the design, so it is never exported
// and never part of the artboard's content. Outside the shell's frame (an export capture) nothing is drawn.

import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import { selectedVideoElements, togglePlayback } from './editing/video-play.ts';
import { frameCaf, frameRaf } from './frame-clock.ts';
import { useSelectionSetOptional } from './use-selection-set.tsx';

/** The chrome marker the selection / annotation handlers skip (input-router, artboard-marquee, annotations-layer). */
export const VPLAY_SELECTOR = '[data-vplay]';

/** A clip smaller than this on screen (zoomed far out) has no room for a button. */
export const VPLAY_MIN = 48;
const BTN = 30;
const INSET = 8;
/** WebKit's (and Chromium's) start-playback disc over a paused clip: 60 px, centred, whatever the clip's size. */
export const VPLAY_CENTRE = 60;

const CSS = `
.dc-vplay-layer { position: fixed; inset: 0; z-index: 7; pointer-events: none; }
.dc-vplay { position: fixed; display: none; width: ${BTN}px; height: ${BTN}px; padding: 0; border: 0; border-radius: 50%;
  place-items: center; cursor: pointer; pointer-events: auto; color: #fff; background: oklch(0.2 0.01 250 / 0.72);
  box-shadow: 0 0 0 1.5px oklch(1 0 0 / 0.55), 0 1px 4px oklch(0 0 0 / 0.35); }
.dc-vplay:hover { background: oklch(0.2 0.01 250 / 0.9); }
.dc-vplay:focus-visible { outline: 2px solid oklch(0.64 0.165 238); outline-offset: 2px; }
.dc-vplay svg { display: block; }
.dc-vplay--centre { width: ${VPLAY_CENTRE}px; height: ${VPLAY_CENTRE}px; background: oklch(0.2 0.01 250 / 0.8); box-shadow: none; }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('dc-vplay-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-vplay-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** A video the button belongs to: one with native controls (a placed clip / an annotation clip), not a timeline `<Video>`. */
export function isPlayableClip(el: Element | null | undefined): el is HTMLVideoElement {
  return (
    !!el &&
    el.tagName === 'VIDEO' &&
    el.hasAttribute('controls') &&
    !el.closest('.dc-absent-layer') &&
    !el.closest('[data-vplay-layer]')
  );
}

/** The clip under a screen point (the topmost one), or null. */
export function clipAt(doc: Document, x: number, y: number): HTMLVideoElement | null {
  let stack: Element[] = [];
  try {
    stack = doc.elementsFromPoint(x, y);
  } catch {
    return null;
  }
  for (const el of stack) if (isPlayableClip(el)) return el;
  return null;
}

/** Where a clip's button sits: its top-left corner, inset; null when the clip is too small (or off screen) to carry one. */
export function buttonBox(r: {
  left: number;
  top: number;
  width: number;
  height: number;
}): { left: number; top: number } | null {
  if (r.width < VPLAY_MIN || r.height < VPLAY_MIN) return null;
  return { left: Math.round(r.left + INSET), top: Math.round(r.top + INSET) };
}

/** Where the centre ▶ sits over a clip: centred, the native disc's size; null when the clip cannot hold it. */
export function centreBox(r: {
  left: number;
  top: number;
  width: number;
  height: number;
}): { left: number; top: number } | null {
  if (r.width < VPLAY_CENTRE + 2 * INSET || r.height < VPLAY_CENTRE + 2 * INSET) return null;
  return {
    left: Math.round(r.left + r.width / 2 - VPLAY_CENTRE / 2),
    top: Math.round(r.top + r.height / 2 - VPLAY_CENTRE / 2),
  };
}

const isPlaying = (v: HTMLVideoElement): boolean => !v.paused && !v.ended;
/** The native centre ▶ is drawn only before the clip has started: so is this one. */
export const showsCentre = (v: HTMLVideoElement): boolean =>
  v.paused && !v.ended && !(v.currentTime > 0);

export function VideoPlayLayer({ inShell }: { inShell?: boolean } = {}): ReactElement | null {
  const sel = useSelectionSetOptional();
  const [hover, setHover] = useState<HTMLVideoElement | null>(null);
  const [, bump] = useState(0);
  const nodes = useRef(new Map<HTMLVideoElement, HTMLButtonElement>());
  const centres = useRef(new Map<HTMLVideoElement, HTMLButtonElement>());
  const hoverRef = useRef<HTMLVideoElement | null>(null);
  const inside = inShell ?? (typeof window !== 'undefined' && window.parent !== window);

  useEffect(() => {
    if (!inside || typeof document === 'undefined') return undefined;
    ensureStyles();
    const move = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      // on the button itself: keep the clip it belongs to
      if (t?.closest(VPLAY_SELECTOR)) return;
      const clip = clipAt(document, e.clientX, e.clientY);
      if (clip !== hoverRef.current) {
        hoverRef.current = clip;
        setHover(clip);
      }
    };
    const leave = () => {
      if (hoverRef.current) {
        hoverRef.current = null;
        setHover(null);
      }
    };
    // play / pause / ended do not bubble: capture them so the glyph follows the clip, however it was started
    const state = () => bump((n) => n + 1);
    document.addEventListener('pointermove', move, true);
    document.documentElement.addEventListener('pointerleave', leave);
    for (const t of ['play', 'pause', 'ended']) document.addEventListener(t, state, true);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.documentElement.removeEventListener('pointerleave', leave);
      for (const t of ['play', 'pause', 'ended']) document.removeEventListener(t, state, true);
    };
  }, [inside]);

  const selected =
    inside && typeof document !== 'undefined'
      ? selectedVideoElements(document, sel?.selected).filter(isPlayableClip)
      : [];
  const targets: HTMLVideoElement[] = [...selected];
  if (hover?.isConnected && isPlayableClip(hover) && !targets.includes(hover)) targets.push(hover);

  // follow each clip's rectangle while there is a button to place (pan / zoom / a selection nudge)
  const targetKey = targets.map((t) => t.getAttribute('data-cd-id') ?? t.src).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `targets` is rebuilt every render; its identity is the key
  useEffect(() => {
    if (targets.length === 0 || typeof window === 'undefined') return undefined;
    let raf: number | null = null;
    const tick = () => {
      const present = canvasModeStore(window).get().mode === 'present';
      for (const v of targets) {
        const rect = v.isConnected && !present ? v.getBoundingClientRect() : null;
        for (const [b, at] of [
          [nodes.current.get(v), rect ? buttonBox(rect) : null],
          [centres.current.get(v), rect ? centreBox(rect) : null],
        ] as const) {
          if (!b) continue;
          if (!at) {
            b.style.display = 'none';
            continue;
          }
          b.style.display = 'grid';
          b.style.left = `${at.left}px`;
          b.style.top = `${at.top}px`;
        }
      }
      raf = frameRaf(tick);
    };
    raf = frameRaf(tick);
    return () => {
      if (raf != null) frameCaf(raf);
    };
  }, [targetKey]);

  const toggle = useCallback((v: HTMLVideoElement) => {
    togglePlayback([v]);
    bump((n) => n + 1);
  }, []);

  if (!inside || typeof document === 'undefined' || targets.length === 0) return null;
  return createPortal(
    <div className="dc-vplay-layer" data-vplay-layer="" data-testid="video-play-layer">
      {targets.flatMap((v) => {
        const playing = isPlaying(v);
        const key = v.getAttribute('data-cd-id') ?? v.src;
        const centre = showsCentre(v) ? (
          <button
            key={`${key}:centre`}
            type="button"
            className="dc-vplay dc-vplay--centre"
            data-vplay=""
            data-testid="video-play-centre"
            aria-label="Play video"
            title="Play"
            ref={(el) => {
              if (el) centres.current.set(v, el);
              else centres.current.delete(v);
            }}
            onClick={(e) => {
              e.stopPropagation();
              toggle(v);
            }}
          >
            <svg width="22" height="22" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
              <path d="M3.5 1.8v10.4L12 7z" />
            </svg>
          </button>
        ) : null;
        const corner = (
          <button
            key={key}
            type="button"
            className="dc-vplay"
            data-vplay=""
            data-testid="video-play-button"
            data-playing={playing ? 'true' : 'false'}
            aria-label={playing ? 'Pause video' : 'Play video'}
            title={playing ? 'Pause' : 'Play'}
            ref={(el) => {
              if (el) nodes.current.set(v, el);
              else nodes.current.delete(v);
            }}
            onClick={(e) => {
              e.stopPropagation();
              toggle(v);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
              {playing ? <path d="M3 2h3v10H3zM8 2h3v10H8z" /> : <path d="M3.5 1.8v10.4L12 7z" />}
            </svg>
          </button>
        );
        return centre ? [corner, centre] : [corner];
      })}
    </div>,
    document.body
  );
}
