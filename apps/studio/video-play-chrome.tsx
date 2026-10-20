// video-play-chrome.tsx — S7.8 (07 · ve-play): the controls ON a video artboard — a centred play button over
// the poster frame, and a scrub bar (play / pause · progress · "0:07 / 0:30") once it has started.
//
// A click on the button plays the clip right on the canvas, WITH sound (the Timeline's mute state is the
// person's, not this button's: an unmuted Player is what "plays in place with sound" means), and the Player's
// own play / pause events tell the shell so its transport never disagrees (VideoComp posts
// `timeline-playing`). The artboard itself still never toggles playback on a click — that selects (DDR-148);
// only these two controls play. They carry no `data-cd-id`, so the inspector never selects them, and they
// are not rendered in a capture (export, thumbnails) or while Present owns the transport.

import type { PlayerRef } from '@remotion/player';
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from 'react';

/** `m:ss` for a frame count. */
export function clock(frame: number, fps: number): string {
  const s = Math.max(0, Math.floor(frame / Math.max(1, fps) + 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const stop = (e: PointerEvent) => e.stopPropagation();

const BTN = {
  appearance: 'none',
  border: 0,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
  color: 'var(--fg-0, #fff)',
  background: 'color-mix(in oklab, var(--bg-0, #000) 62%, transparent)',
  padding: 0,
} as const;

function Glyph({ playing, size }: { playing: boolean; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {playing ? (
        <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
      ) : (
        <path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z" />
      )}
    </svg>
  );
}

export function VideoPlayChrome({
  playerRef,
  fps,
  durationInFrames,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  durationInFrames: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const last = Math.max(1, durationInFrames - 1);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return undefined;
    const sync = () => {
      try {
        setPlaying(p.isPlaying());
        setFrame(p.getCurrentFrame());
      } catch {
        /* Player transitional */
      }
    };
    sync();
    for (const ev of ['play', 'pause', 'ended', 'frameupdate'] as const)
      p.addEventListener(ev, sync);
    return () => {
      for (const ev of ['play', 'pause', 'ended', 'frameupdate'] as const) {
        try {
          p.removeEventListener(ev, sync);
        } catch {
          /* unmounted */
        }
      }
    };
  }, [playerRef]);

  const toggle = () => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (p.isPlaying()) {
        p.pause();
      } else {
        p.unmute(); // in place, with sound
        if (p.getCurrentFrame() >= last) p.seekTo(0);
        p.play();
      }
    } catch {
      /* Player transitional */
    }
  };

  const seekFrom = (e: PointerEvent) => {
    const r = trackRef.current?.getBoundingClientRect();
    const p = playerRef.current;
    if (!r || !p || r.width <= 0) return;
    const f = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * last);
    try {
      p.seekTo(f);
    } catch {
      /* Player transitional */
    }
  };

  const started = playing || frame > 0;
  return (
    <>
      {playing ? null : (
        <button
          type="button"
          data-dc-video-chrome="play"
          data-testid="video-play-button"
          aria-label="Play with sound"
          title="Play"
          tabIndex={-1}
          onPointerDown={stop}
          onClick={toggle}
          style={{
            ...BTN,
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 56,
            height: 56,
            translate: '-50% -50%',
            borderRadius: '50%',
          }}
        >
          <Glyph playing={false} size={26} />
        </button>
      )}
      {started ? (
        <div
          data-dc-video-chrome="scrub"
          data-testid="video-scrub-bar"
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 8,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 8px',
            borderRadius: 8,
            color: 'var(--fg-0, #fff)',
            background: 'color-mix(in oklab, var(--bg-0, #000) 62%, transparent)',
            font: '500 11px/1 var(--font-ui, system-ui, sans-serif)',
            fontVariantNumeric: 'tabular-nums',
          }}
          onPointerDown={stop}
        >
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play with sound'}
            tabIndex={-1}
            onClick={toggle}
            style={{ ...BTN, background: 'none', width: 20, height: 20 }}
          >
            <Glyph playing={playing} size={14} />
          </button>
          <div
            ref={trackRef}
            role="slider"
            aria-label="Position"
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={frame}
            tabIndex={-1}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              seekFrom(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) seekFrom(e);
            }}
            style={{
              position: 'relative',
              flex: 1,
              height: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: 3,
                borderRadius: 2,
                background: 'color-mix(in oklab, var(--fg-0, #fff) 28%, transparent)',
              }}
            />
            <div
              data-testid="video-scrub-fill"
              style={{
                position: 'absolute',
                left: 0,
                width: `${(Math.min(frame, last) / last) * 100}%`,
                height: 3,
                borderRadius: 2,
                background: 'var(--accent, currentColor)',
              }}
            />
          </div>
          <span data-testid="video-scrub-time">
            {clock(frame, fps)} / {clock(durationInFrames, fps)}
          </span>
        </div>
      ) : null}
    </>
  );
}
