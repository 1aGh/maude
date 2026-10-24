// client/v2/timeline/joins/transition-picker.jsx — S7.10 (07 · ve-transition): "Click a join for a transition".
//
// An anchored popover on the dot between two clips, titled with them ("Oslava → Logo"): six tiles — Cut · Fade ·
// Slide · Wipe · Flip · Clock wipe — and a Length slider. A tile IS the preview (07 draws no separate slab): its
// picture is the two real shots (the outgoing clip's last frame, the incoming one's first), HOVER (or focus) plays the
// join inside it. ← ↑ → ↓ move between tiles (roving tabindex); a tip points at the dot it hangs from.
// Picking a tile is one `video.transition.set`; the slider writes the join's length when it is let go. Esc closes.
//
// Where the old dialog's Transition tab went (D15): the six tiles are its presentation grid
// (`timeline-transition-<name>`), the slider is its Frames field, and "Remove transition (hard cut)" is under the clip
// inspector's Advanced › Transition frames (07 draws no remove link in the picker: V2-8.5 c4-video).

import { useEffect, useRef, useState } from 'react';
import {
  JOIN_SECONDS,
  JOIN_TILES,
  PREVIEW_MS,
  joinFrames,
  joinSeconds,
  joinSecondsWords,
  previewKeyframes,
  tileOfPresentation,
} from './join-model.js';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A tile's picture: the two real shots the join meets (the outgoing clip's last frame, the incoming one's first), or
 *  the flat colours when a clip has no media (a title, a graphic). Held, never played: hover plays the tile itself. */
function ShotFrame({ shot, b = false }) {
  // a clip whose file is missing (or cannot be read) draws the flat colours, never a black video box
  const [bad, setBad] = useState(false);
  const show = !!shot.url && !bad;
  return (
    <i className={b ? 'tj-pic-b' : undefined} data-media={show ? 'true' : undefined}>
      {show ? (
        <video
          src={shot.url}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
          onError={() => setBad(true)}
        />
      ) : null}
    </i>
  );
}

/**
 * @param {{
 *   title: string,
 *   tile: string|null,                    // the lit tile key (cut · fade · slide · wipe · flip · clock)
 *   frames: number, fps: number,
 *   a: { url: string|null, label: string }, b: { url: string|null, label: string },
 *   x: number, y: number,                 // window px: the dot the popover hangs from
 *   canEdit?: boolean,
 *   onPick: (key: string) => void,
 *   onLength: (frames: number) => void,
 *   onClose: () => void,
 * }} props
 */
export function TransitionPicker({
  title,
  tile,
  frames,
  fps,
  a,
  b,
  x,
  y,
  canEdit = true,
  onPick,
  onLength,
  onClose,
}) {
  const anims = useRef([]);
  const rootRef = useRef(null);
  const [secs, setSecs] = useState(() => joinSeconds(frames, fps));
  const dirty = useRef(false);
  // a refetch that changed the length (a teammate's edit, or our own write coming back) re-seeds the slider
  useEffect(() => {
    setSecs(joinSeconds(frames, fps));
    dirty.current = false;
  }, [frames, fps]);

  const stop = () => {
    for (const an of anims.current) an.cancel?.();
    anims.current = [];
  };
  // hover / focus plays the join inside the tile's own two shots; leaving puts them back (07: the tiles ARE the preview)
  const play = (key, tile) => {
    stop();
    const [ea, eb] = tile?.querySelectorAll?.('.tj-pic > i') ?? [];
    if (!ea || !eb || typeof eb.animate !== 'function') return;
    const k = previewKeyframes(key, { rm: reducedMotion() });
    const opts = { duration: PREVIEW_MS, easing: 'ease-in-out', fill: 'both', iterations: 1 };
    anims.current = [ea.animate(k.a, opts), eb.animate(k.b, opts)];
  };
  useEffect(
    () => () => {
      for (const an of anims.current) an.cancel?.();
    },
    []
  );

  // Esc closes (and only closes); the lit tile takes focus so the keyboard lands somewhere real
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    rootRef.current?.querySelector('[aria-checked="true"], .tj-tile')?.focus?.();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // a click anywhere else closes it
  useEffect(() => {
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) onClose?.();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  // the slider moves the number on screen; the write waits for the release (a drag would be a write per tick)
  const slide = (e) => {
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    dirty.current = true;
    setSecs(n);
  };
  const commitLength = () => {
    if (!dirty.current) return;
    dirty.current = false;
    onLength?.(joinFrames(secs, fps));
  };

  // a radiogroup: ← ↑ → ↓ move between the tiles (focus plays the join on it); Enter / Space picks
  const arrows = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const tiles = [...e.currentTarget.querySelectorAll('button:not(:disabled)')];
    const at = tiles.indexOf(document.activeElement);
    if (!tiles.length || at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    tiles[(at + step + tiles.length) % tiles.length].focus();
  };

  const W = 288;
  const left = Math.max(
    8,
    Math.min((typeof window === 'undefined' ? 1440 : window.innerWidth) - W - 8, x - W / 2)
  );
  return (
    <div
      ref={rootRef}
      className="tj-pop"
      role="dialog"
      aria-label={`Transition ${title}`}
      data-testid="timeline-transition-picker"
      style={{
        left,
        bottom: (typeof window === 'undefined' ? 900 : window.innerHeight) - y + 14,
        width: W,
        '--tj-tip-x': `${Math.round(x - left)}px`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p className="tj-title" data-testid="timeline-transition-title">
        {title}
      </p>
      <div
        className="tj-grid"
        role="radiogroup"
        aria-label="Transition"
        data-testid="timeline-transition-grid"
        onKeyDown={arrows}
      >
        {JOIN_TILES.map(([label, key]) => (
          // biome-ignore lint/a11y/useSemanticElements: a picture tile that is one of six; a native radio could not draw it
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={tile === key}
            className="tj-tile"
            data-on={tile === key ? 'true' : undefined}
            data-testid={`timeline-transition-${key}`}
            tabIndex={tile === key || (!tile && key === JOIN_TILES[0][1]) ? 0 : -1}
            disabled={!canEdit}
            onMouseEnter={(e) => play(key, e.currentTarget)}
            onFocus={(e) => play(key, e.currentTarget)}
            onMouseLeave={stop}
            onBlur={stop}
            onClick={() => onPick?.(key)}
          >
            <span className={`tj-pic tj-pic--${key}`} aria-hidden="true">
              <ShotFrame shot={a} />
              <ShotFrame shot={b} b />
            </span>
            {label}
          </button>
        ))}
      </div>
      <label className="tj-row">
        <span>Length</span>
        <input
          type="range"
          className="tj-range"
          data-testid="timeline-transition-length"
          aria-label="Transition length"
          min={JOIN_SECONDS.min}
          max={JOIN_SECONDS.max}
          step={JOIN_SECONDS.step}
          value={secs}
          disabled={!canEdit}
          onInput={slide}
          onChange={slide}
          onPointerUp={commitLength}
          onKeyUp={commitLength}
          onBlur={commitLength}
        />
        <output className="tj-len" data-testid="timeline-transition-length-words">
          {joinSecondsWords(secs)}
        </output>
      </label>
      <p className="tj-foot">Hover a tile to play it.</p>
    </div>
  );
}

export { tileOfPresentation };
