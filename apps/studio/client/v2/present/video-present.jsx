// client/v2/present/video-present.jsx — S7.19: the full-screen video preview (07 ve-fullscreen).
//
// Present · Artboards with `only: 'formats'` (a video artboard was selected): the canvas shows that video and its
// formats, nothing else, and this is the only chrome there is —
//   top left     the format switch  [ Reels 9:16 | 16:9 | 1:1 ]  — switching never leaves Present, and the loop and the
//                volume come along (carryOver)
//   top right    esc  Back to the canvas
//   bottom bar   play/pause · loop · 0:10 / 0:15 · the scrub with the cut's loop ticks · sound · captions
// It replaces `<PresentControls>` (present-chrome-host.jsx) for this one spec; the clip itself is S3.3's engine
// (present-media.ts), the transport here drives it with the same `present-media-cmd` plus the Timeline's own
// `timeline-seek / -loop / -volume` messages (the Player is one, so there is no second playback path).
//
// SHELL DOM (DDR-117): it sits over the canvas iframe. Words per 07 ve-fullscreen; tokens only (video-present.css).

import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaTimeText, mediaToggleOp, soundOp } from './present-controls-model.js';
import {
  carryOver,
  compOf,
  formatSwitch,
  loopTicks,
  seekMessage,
  seekSeconds,
  stepIndexOf,
} from './video-present-model.js';

export const BACK_WORDS = 'Back to the canvas';

const GLYPHS = {
  play: <path d="M5 3.2v9.6L12.6 8z" />,
  pause: (
    <>
      <path d="M5.2 3.5v9" />
      <path d="M10.8 3.5v9" />
    </>
  ),
  loop: (
    <>
      <path d="M3 7.5V7a2.5 2.5 0 0 1 2.5-2.5H12" />
      <path d="M10 2.5l2 2-2 2" />
      <path d="M13 8.5V9a2.5 2.5 0 0 1-2.5 2.5H4" />
      <path d="M6 13.5l-2-2 2-2" />
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
  captions: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.8" />
      <path d="M5.2 7.6h1.6" />
      <path d="M9.2 7.6h1.6" />
      <path d="M5.2 10h5.6" />
    </>
  ),
};

function Glyph({ name }) {
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
 * @param formats `formatSwitch(...)` — `[{ id, name, current }]`, or [] (a deck of one: no switch)
 * @param media `{ playing, t, duration, muted }` from `present-media`, or null before the clip reports
 * @param ticks fractions (0..1) of the scrub where the cut's clips begin
 * @param loop / volume / captions the transport's state; `on*` setters
 */
export function VideoPresent({
  formats = [],
  media = null,
  ticks = [],
  loop = false,
  volume = 1,
  captions = true,
  onFormat,
  onToggle,
  onLoop,
  onSeek,
  onSound,
  onVolume,
  onCaptions,
  onLeave,
}) {
  const duration = media?.duration ?? 0;
  const at = media && duration > 0 ? Math.min(1, Math.max(0, media.t / duration)) : 0;
  const time = media ? mediaTimeText(media) : null;
  const muted = media?.muted === true;
  return (
    <div className="vp" data-testid="video-present">
      {formats.length > 0 ? (
        <div
          className="vp-fmt"
          role="radiogroup"
          aria-label="Format"
          data-testid="video-present-formats"
        >
          {formats.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={f.current}
              className="vp-fmt-o"
              data-on={f.current ? 'true' : undefined}
              data-testid={`video-present-format-${f.id}`}
              onClick={() => onFormat?.(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="vp-esc"
        data-testid="video-present-leave"
        aria-label={BACK_WORDS}
        onClick={onLeave}
      >
        <kbd className="kbd">esc</kbd>
        <span>{BACK_WORDS}</span>
      </button>
      {media ? (
        <div
          className="vp-bar"
          role="toolbar"
          aria-label="Video controls"
          data-testid="video-present-bar"
        >
          <button
            type="button"
            className="st-iconbtn"
            data-testid="video-present-toggle"
            aria-label={media.playing ? 'Pause' : 'Play'}
            aria-pressed={media.playing}
            onClick={() => onToggle?.(mediaToggleOp(media))}
          >
            <Glyph name={media.playing ? 'pause' : 'play'} />
          </button>
          <button
            type="button"
            className="st-iconbtn"
            data-testid="video-present-loop"
            aria-label="Loop"
            aria-pressed={loop}
            onClick={() => onLoop?.(!loop)}
          >
            <Glyph name="loop" />
          </button>
          {time ? (
            <span className="vp-time" data-testid="video-present-time">
              {time}
            </span>
          ) : null}
          <span className="vp-scrub">
            <span className="vp-track" aria-hidden="true">
              <b style={{ width: `${at * 100}%` }} />
              <em style={{ left: `${at * 100}%` }} />
              {ticks.map((p) => (
                <span
                  key={p}
                  className="vp-tick"
                  data-testid="video-present-tick"
                  style={{ left: `${p * 100}%` }}
                />
              ))}
            </span>
            <input
              type="range"
              className="vp-range"
              data-testid="video-present-scrub"
              aria-label="Scrub the video"
              min={0}
              max={1000}
              step={1}
              value={Math.round(at * 1000)}
              onChange={(e) => {
                const s = seekSeconds(Number(e.target.value) / 1000, duration);
                if (s !== null) onSeek?.(s);
              }}
            />
          </span>
          {/* 07 ve-fullscreen: the bar shows the sound icon alone; the volume slider opens beside it on hover / focus */}
          <span className="vp-snd">
            <button
              type="button"
              className="st-iconbtn"
              data-testid="video-present-sound"
              aria-label="Sound"
              aria-pressed={!muted}
              onClick={() => onSound?.(soundOp(media))}
            >
              <Glyph name={muted ? 'sound-off' : 'sound'} />
            </button>
            <input
              type="range"
              className="vp-volume"
              data-testid="video-present-volume"
              aria-label="Volume"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              onChange={(e) => onVolume?.(Number(e.target.value) / 100)}
            />
          </span>
          <button
            type="button"
            className="st-iconbtn"
            data-testid="video-present-captions"
            aria-label="Captions"
            aria-pressed={captions}
            onClick={() => onCaptions?.(!captions)}
          >
            <Glyph name="captions" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The wiring (present-chrome-host.jsx mounts this for `present.only === 'formats'`).
 * @param position `{ index, total, artboardId }` from `present-position`
 * @param run `[{ id, label, x, y, w, h }]` — the deck, as the canvas reported it (`present-run`)
 * @param media the `present-media` echo
 * @param canvas { activePath, comps, post, loop, setLoop, volume, setVolume }
 */
export function VideoPresentHost({ position, run, media, canvas, onStep, onCommand, onLeave }) {
  const artboardId = position?.artboardId ?? null;
  const cells = run?.artboards ?? [];
  const formats = useMemo(() => formatSwitch(cells, artboardId), [cells, artboardId]);
  const comp = useMemo(() => compOf(canvas.comps, artboardId), [canvas.comps, artboardId]);
  const [captions, setCaptions] = useState(true);
  const ticks = useTicks(canvas.activePath, artboardId, media?.duration ?? 0);

  // The loop and the volume come along: a new artboard's comp is told what the last one had.
  const carried = useRef('');
  const { post, loop, volume } = canvas;
  useEffect(() => {
    if (!comp || carried.current === comp.id) return;
    carried.current = comp.id;
    for (const m of carryOver(comp, { loop, volume })) post(m);
  }, [comp, loop, volume, post]);

  return (
    <VideoPresent
      formats={formats}
      media={media}
      ticks={ticks}
      loop={canvas.loop}
      volume={canvas.volume}
      captions={captions}
      onFormat={(id) => {
        const i = stepIndexOf(cells, id);
        if (i >= 0) onStep(i);
      }}
      onToggle={onCommand}
      onSound={onCommand}
      onLoop={(next) => {
        canvas.setLoop(next);
        if (comp) post({ dgn: 'timeline-loop', loop: next, id: comp.id });
      }}
      onSeek={(s) => {
        const m = seekMessage(comp, s);
        if (!m) return;
        const was = media?.playing === true;
        post(m);
        if (was) onCommand('play');
      }}
      onVolume={(v) => {
        canvas.setVolume(v);
        if (comp) post({ dgn: 'timeline-volume', volume: v, id: comp.id });
        if (v > 0 && media?.muted) onCommand('unmute');
      }}
      onCaptions={(on) => {
        setCaptions(on);
        onCommand(on ? 'captions-on' : 'captions-off');
      }}
      onLeave={onLeave}
    />
  );
}

/** The cut's loop ticks for the presented artboard (`GET /_api/comp-media` — clips and fps); [] while unknown. */
function useTicks(activePath, artboardId, durationSec) {
  const [cut, setCut] = useState(null);
  useEffect(() => {
    setCut(null);
    if (!activePath || !artboardId) return undefined;
    const ac = new AbortController();
    const url = `/_api/comp-media?canvas=${encodeURIComponent(activePath)}&artboard=${encodeURIComponent(artboardId)}`;
    fetch(url, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && Array.isArray(j.clips)) setCut({ clips: j.clips, fps: j.fps });
      })
      .catch(() => {});
    return () => ac.abort();
  }, [activePath, artboardId]);
  return useMemo(() => (cut ? loopTicks(cut.clips, cut.fps, durationSec) : []), [cut, durationSec]);
}
