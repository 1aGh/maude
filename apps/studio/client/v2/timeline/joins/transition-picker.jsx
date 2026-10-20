// client/v2/timeline/joins/transition-picker.jsx — S7.10 (07 · ve-transition): "Click a join for a transition".
//
// An anchored popover on the dot between two clips, titled with them ("Oslava → Logo"): six tiles — Cut · Fade ·
// Slide · Wipe · Flip · Clock wipe — and a Length slider. A tile draws the join as a small picture; HOVER (or focus)
// plays it on the two real shots above the grid — the outgoing clip's last frame under the incoming clip's first.
// Picking a tile is one `video.transition.set`; the slider writes the join's length when it is let go. Esc closes.
//
// Where the old dialog's Transition tab went (D15): the six tiles are its presentation grid
// (`timeline-transition-<name>`), the slider is its Frames field, and "Remove transition (hard cut)" is the foot
// link here and under the clip inspector's Advanced › Transition frames.

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

/** One of the two shots: its still frame (a muted video held on a frame), or a flat block with its name. */
function Shot({ shot, refEl, testid }) {
  return (
    <div className="tj-shot" ref={refEl} data-testid={testid}>
      {shot.url ? (
        <video
          className="tj-shot-media"
          src={shot.url}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : (
        <span className="tj-shot-flat">{shot.label}</span>
      )}
    </div>
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
 *   onRemove?: () => void,
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
  onRemove,
  onClose,
}) {
  const aRef = useRef(null);
  const bRef = useRef(null);
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
  // hover / focus plays the join on the two shots; leaving puts them back
  const play = (key) => {
    stop();
    const ea = aRef.current;
    const eb = bRef.current;
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
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p className="tj-title" data-testid="timeline-transition-title">
        {title}
      </p>
      <div className="tj-preview" data-testid="timeline-transition-preview" aria-hidden="true">
        <Shot shot={a} refEl={aRef} testid="timeline-transition-shot-a" />
        <Shot shot={b} refEl={bRef} testid="timeline-transition-shot-b" />
      </div>
      <div
        className="tj-grid"
        role="radiogroup"
        aria-label="Transition"
        data-testid="timeline-transition-grid"
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
            disabled={!canEdit}
            onMouseEnter={() => play(key)}
            onFocus={() => play(key)}
            onMouseLeave={stop}
            onBlur={stop}
            onClick={() => onPick?.(key)}
          >
            <span className={`tj-pic tj-pic--${key}`} aria-hidden="true">
              <i />
              <i className="tj-pic-b" />
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
      <p className="tj-foot">
        Hover a tile to play it.
        {onRemove && canEdit ? (
          <button
            type="button"
            className="tj-remove"
            data-testid="timeline-transition-remove"
            onClick={onRemove}
          >
            Remove transition (hard cut)
          </button>
        ) : null}
      </p>
    </div>
  );
}

export { tileOfPresentation };
