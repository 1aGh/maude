// client/v2/present/present-controls.jsx — S3.2b: Present · Artboards, the shell's controls (04 md-present-full).
//
//   ‹  3 / 14  ›  │  [transport]  │  Post 1:1 · Combine 2026  │  [presenter view]  │  esc to leave
//
// SHELL DOM (DDR-117): they sit over the canvas iframe, so ‹ › work while the iframe holds focus and no
// key is needed. They appear when the mouse moves, and fade two seconds after the last move; with Reduce
// motion they just hide. The iframe is another document, so the shell never sees a mouse move over it:
// the hot zone below (a transparent strip under the controls) is where "a move" is heard, and a step
// brings them back too (a new `present-position`).
//
// SLOTS (shared with the next slices; this file stays yours as you add to them):
//   `transport`      — S3.3: media pause · 0:06 / 0:15 · sound, shown when the artboard holds a clip
//   `presenterView`  — S3.6b: the "Presenter view" button, desktop only, hidden with one display
// An empty slot renders nothing at all (hidden, never greyed — V2-4.9 decision 2).

import { useEffect, useMemo, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import {
  canStep,
  counterText,
  createReveal,
  FADE_AFTER_MS,
  mediaTimeText,
  mediaToggleOp,
  soundOp,
} from './present-controls-model.js';

const defaultDeps = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h),
  reducedMotion: () =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
};

/**
 * @param position `{ index, total, artboardId }` from `present-position`, or null before the first echo
 * @param label the presented artboard's name (or null)
 * @param onStep (to: 'next' | 'prev') => void
 * @param onLeave () => void
 * @param transport / presenterView slot nodes
 * @param deps test seam: `{ setTimer, clearTimer, reducedMotion }`
 */
export function PresentControls({
  position,
  label = null,
  onStep,
  onLeave,
  transport = null,
  presenterView = null,
  deps = null,
}) {
  const d = useMemo(() => ({ ...defaultDeps, ...(deps ?? {}) }), [deps]);
  const [shown, setShown] = useState(true);
  const revealRef = useRef(null);
  if (!revealRef.current)
    revealRef.current = createReveal({
      delay: FADE_AFTER_MS,
      setTimer: d.setTimer,
      clearTimer: d.clearTimer,
      onChange: (v) => setShown(v),
    });
  const reveal = revealRef.current;

  // Present starts with the controls up (the person just asked for it), then the clock runs.
  useEffect(() => {
    reveal.poke();
    return () => reveal.dispose();
  }, [reveal]);

  // A step is a move: a new place brings them back.
  const placeKey = position ? `${position.index}/${position.total}/${position.artboardId}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger
  useEffect(() => {
    reveal.poke();
  }, [placeKey, reveal]);

  // The shell's own document: any move or key over it is "a move".
  useEffect(() => {
    const poke = () => reveal.poke();
    document.addEventListener('pointermove', poke, true);
    document.addEventListener('keydown', poke, true);
    return () => {
      document.removeEventListener('pointermove', poke, true);
      document.removeEventListener('keydown', poke, true);
    };
  }, [reveal]);

  const counter = counterText(position);
  const reduced = d.reducedMotion();
  return (
    <>
      {/* The hot zone: a transparent strip under the controls. A mouse move here is heard by the shell
          (the iframe's own moves are not); a click here still means "next", as on the stage. */}
      <div
        className="pr-zone"
        data-testid="present-zone"
        aria-hidden="true"
        onPointerMove={() => reveal.poke()}
        onClick={() => canStep(position, 'next') && onStep('next')}
      />
      <div
        className="pr-controls"
        data-testid="present-controls"
        data-shown={shown ? 'true' : 'false'}
        data-motion={reduced ? 'reduced' : 'full'}
        role="toolbar"
        aria-label="Presentation controls"
        onPointerEnter={() => reveal.hold(true)}
        onPointerLeave={() => reveal.hold(false)}
        onFocus={() => reveal.hold(true)}
        onBlur={() => reveal.hold(false)}
      >
        <button
          type="button"
          className="st-iconbtn pr-step pr-step--prev"
          data-testid="present-prev"
          aria-label="Previous artboard"
          title="Previous artboard (←)"
          disabled={!canStep(position, 'prev')}
          onClick={() => onStep('prev')}
        >
          <StIcon name="chevron-right" size={15} />
        </button>
        <span className="pr-counter" data-testid="present-counter" aria-live="polite">
          {counter ?? ''}
        </span>
        <button
          type="button"
          className="st-iconbtn pr-step"
          data-testid="present-next"
          aria-label="Next artboard"
          title="Next artboard (→)"
          disabled={!canStep(position, 'next')}
          onClick={() => onStep('next')}
        >
          <StIcon name="chevron-right" size={15} />
        </button>
        {transport ? (
          <>
            <span className="pr-div" aria-hidden="true" />
            <span className="pr-slot" data-testid="present-slot-transport">
              {transport}
            </span>
          </>
        ) : null}
        {label ? (
          <>
            <span className="pr-div" aria-hidden="true" />
            <span className="pr-label" data-testid="present-label">
              {label}
            </span>
          </>
        ) : null}
        {presenterView ? (
          <>
            <span className="pr-div" aria-hidden="true" />
            <span className="pr-slot" data-testid="present-slot-presenter">
              {presenterView}
            </span>
          </>
        ) : null}
        <span className="pr-div" aria-hidden="true" />
        <button
          type="button"
          className="pr-esc"
          data-testid="present-leave"
          aria-label="Leave the presentation"
          onClick={onLeave}
        >
          <kbd className="kbd">esc</kbd>
          <span>to leave</span>
        </button>
      </div>
    </>
  );
}

// ─── S3.3 · the transport: pause · 0:06 / 0:15 · sound (04 md-present-video) ─────────────────────────
// The shell mirrors the clip the presented artboard plays (`present-media`) and drives it back with
// `present-media-cmd`. 16-box glyphs in the controls' own stroke; the shell's icon set has no media ones.

const GLYPHS = {
  play: <path d="M5 3.2v9.6L12.6 8z" />,
  pause: (
    <>
      <path d="M5.2 3.5v9" />
      <path d="M10.8 3.5v9" />
    </>
  ),
  sound: (
    <>
      <path d="M2.5 6.2h2.4L8 3.4v9.2L4.9 9.8H2.5z" />
      <path d="M10.4 5.9a3 3 0 0 1 0 4.2" />
      <path d="M12 4.2a5.4 5.4 0 0 1 0 7.6" />
    </>
  ),
  'sound-off': (
    <>
      <path d="M2.5 6.2h2.4L8 3.4v9.2L4.9 9.8H2.5z" />
      <path d="M10.6 6.2l3 3.6" />
      <path d="M13.6 6.2l-3 3.6" />
    </>
  ),
};

function MediaGlyph({ name }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {GLYPHS[name]}
    </svg>
  );
}

/**
 * @param media `{ playing, t, duration, muted }` from `present-media`, or null (no clip: nothing renders)
 * @param onCommand (op: 'play' | 'pause' | 'mute' | 'unmute') => void
 */
export function PresentTransport({ media, onCommand }) {
  if (!media) return null;
  const time = mediaTimeText(media);
  return (
    <span className="pr-transport" data-testid="present-transport">
      <button
        type="button"
        className="st-iconbtn"
        data-testid="present-media-toggle"
        aria-label={media.playing ? 'Pause' : 'Play'}
        title={media.playing ? 'Pause (click the video)' : 'Play (click the video)'}
        onClick={() => onCommand(mediaToggleOp(media))}
      >
        <MediaGlyph name={media.playing ? 'pause' : 'play'} />
      </button>
      {time ? (
        <span className="pr-time" data-testid="present-media-time">
          {time}
        </span>
      ) : null}
      <button
        type="button"
        className="st-iconbtn"
        data-testid="present-media-sound"
        aria-label="Sound"
        aria-pressed={!media.muted}
        title={media.muted ? 'Turn the sound on' : 'Turn the sound off'}
        onClick={() => onCommand(soundOp(media))}
      >
        <MediaGlyph name={media.muted ? 'sound-off' : 'sound'} />
      </button>
    </span>
  );
}
