// client/v2/export/sections/video.jsx — S8.6: a video artboard → MP4, GIF, WebM or Sound only (09 ex-video).
//
// Which formats (the artboard and its linked formats, each ticked), which format, how sharp, what sound,
// whether captions — Off unless asked (C19) — and the filmstrip: the whole edit, scrub it to check any
// frame. A video past 3 600 frames warns (C22) with one way out, "Allow longer"; the SERVER holds the
// cap, so this only says what the estimate says. v1 re-emit: `export-format-mp4` / `-gif` / `-webm`.

import { useState } from 'react';
import { StIcon } from '../../../shell/icons.jsx';
import { Hint, Row, Seg } from '../parts.jsx';
import {
  ALLOW_LONGER,
  ALLOW_LONGER_OFF,
  CAPTIONS_BURNED,
  CAPTIONS_GIF,
  CAPTIONS_LABEL,
  CAPTIONS_NONE,
  CAPTIONS_OFF,
  clock,
  FILM_LABEL,
  FILM_SCRUB,
  FORMAT_LABEL,
  FORMATS_LABEL,
  formatsNote,
  overCapLine,
  QUALITIES,
  QUALITY_LABEL,
  SOUND_FILE_LABEL,
  SOUND_FILES,
  SOUND_GIF,
  SOUND_LABEL,
  SOUND_MIXED,
  SOUND_ONLY_NOTE,
  SOUND_SHARED_NOTE,
  VIDEO_FORMATS,
} from './video-copy.js';
import { lengthState, sizeWords } from './video-model.js';

const labelOf = (format) => (format === 'webm' ? 'WebM' : String(format).toUpperCase());

/** The cut as lanes — the pictures, then the music — with a playhead. Numbers come from the estimate. */
function Film({ row, at, onAt }) {
  const total = Math.max(1, row.frames ?? Math.max(1, ...row.clips.map((c) => c.from + c.frames)));
  const pct = (f) => `${(f / total) * 100}%`;
  const pics = row.clips.filter((c) => c.track === 'video' || c.track === 'video2');
  const beds = row.clips.filter((c) => c.track === 'music' || c.track === 'music2');
  const here = Math.min(total, Math.max(0, at));
  return (
    <div
      className="ex-film"
      data-testid="export-film"
      role="group"
      aria-label={`${row.label} — ${FILM_LABEL}`}
    >
      <div className="ex-film-lanes">
        <div className="ex-film-lane ex-film-lane--v">
          {pics.map((c, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: clips are positional and never reorder here
              key={i}
              className={`ex-film-clip${c.track === 'video2' ? ' ex-film-clip--2' : ''}`}
              style={{ left: pct(c.from), width: pct(c.frames) }}
            />
          ))}
        </div>
        {beds.length > 0 ? (
          <div className="ex-film-lane ex-film-lane--m">
            {beds.map((c, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: beds are positional and never reorder here
                key={i}
                className="ex-film-bed"
                style={{ left: pct(c.from), width: pct(c.frames) }}
              />
            ))}
          </div>
        ) : null}
        <span className="ex-film-head" style={{ left: pct(here) }} data-testid="export-film-head">
          <b>{clock(here, row.fps)}</b>
        </span>
        <input
          type="range"
          className="ex-film-scrub"
          data-testid="export-film-scrub"
          aria-label={FILM_SCRUB}
          min={0}
          max={total}
          step={1}
          value={here}
          onChange={(e) => onAt(Number(e.target.value))}
        />
      </div>
      <div className="ex-film-ticks" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <span key={p} style={{ left: `${p * 100}%` }}>
            {clock(total * p, row.fps)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * @param video { formats, ticked, overrides, onTick, rows (reached), lengths }
 * @param other the "Other…" button node, drawn after the formats
 */
export function VideoSection({ state, set, setFormat, other, video }) {
  const [at, setAt] = useState(0);
  const format = state.format;
  const picture = format !== 'audio';
  const gif = format === 'gif';
  const audio = format === 'audio';
  const formats = video?.formats ?? [];
  const rows = video?.rows ?? [];
  const first = rows[0] ?? null;
  const vq = state.vq ?? '1080p';
  const allowLonger = state.allowLonger === true;
  const len = lengthState(rows, allowLonger);
  const options = VIDEO_FORMATS.map(([id, label]) => ({
    id,
    label,
    testid: id === 'audio' ? 'export-format-audio' : `export-format-${id}`,
  }));
  if (!VIDEO_FORMATS.some(([id]) => id === format))
    options.push({ id: format, label: labelOf(format), testid: `export-format-${format}` });
  const captions = video?.captionsAvailable === true;
  const selected = video?.selected ?? 0;
  const linked = formats.some((f) => f.linked && video.ticked.includes(f.artboardId));

  return (
    <>
      {formats.length > 0 ? (
        <Row
          k={FORMATS_LABEL}
          top
          note={formatsNote({ selected, videos: video.ticked.length, linked })}
          testid="export-row-formats"
        >
          <span className="ex-shapes" data-testid="export-video-formats">
            {formats.map((f) => {
              const on = video.ticked.includes(f.artboardId);
              return (
                <label
                  key={f.artboardId}
                  className="ex-shape"
                  data-on={on ? 'true' : undefined}
                  data-linked={f.linked ? 'true' : undefined}
                >
                  <input
                    type="checkbox"
                    className="ex-shape-in"
                    checked={on}
                    data-testid={`export-video-format-${f.artboardId}`}
                    onChange={() => video.onTick(f.artboardId)}
                  />
                  <span className="ex-box" data-on={on ? 'true' : undefined} aria-hidden="true">
                    {on ? <StIcon name="check" size={10} /> : null}
                  </span>
                  <span className="ex-shape-t">
                    {f.label}
                    {f.size ? <small>{f.size}</small> : null}
                  </span>
                </label>
              );
            })}
          </span>
        </Row>
      ) : null}

      <Row k={FORMAT_LABEL} testid="export-row-format">
        <Seg label={FORMAT_LABEL} options={options} value={format} onPick={setFormat} />
        {other}
      </Row>
      {video?.ticked?.length > 1 ? (
        <p className="ex-sound-shared" data-testid="export-sound-shared">
          {SOUND_SHARED_NOTE}
        </p>
      ) : null}

      {picture ? (
        <Row k={QUALITY_LABEL} testid="export-row-quality">
          <Seg
            label={QUALITY_LABEL}
            testid="export-quality"
            options={QUALITIES.map(([id, label, scale]) => ({
              id,
              label,
              small: sizeWords(first, scale) || undefined,
              testid: `export-quality-${id}`,
            }))}
            value={vq}
            onPick={(id) => set({ vq: id })}
          />
        </Row>
      ) : (
        <Row k={SOUND_FILE_LABEL} note={SOUND_ONLY_NOTE} testid="export-row-sound-file">
          <Seg
            label={SOUND_FILE_LABEL}
            testid="export-sound-file"
            options={SOUND_FILES.map(([id, label, small]) => ({
              id,
              label,
              small,
              testid: `export-sound-${id}`,
            }))}
            value={state.audioCodec ?? 'm4a'}
            onPick={(id) => set({ audioCodec: id })}
          />
        </Row>
      )}

      {picture ? (
        <Row k={SOUND_LABEL} testid="export-row-sound">
          <span className="ex-val" data-testid="export-sound-note">
            {gif ? SOUND_GIF : SOUND_MIXED}
          </span>
        </Row>
      ) : null}

      {picture ? (
        <Row k={CAPTIONS_LABEL} testid="export-row-captions">
          <Seg
            label={CAPTIONS_LABEL}
            testid="export-captions"
            options={[
              { id: 'off', label: CAPTIONS_OFF, testid: 'export-captions-off' },
              {
                id: 'burned',
                label: CAPTIONS_BURNED,
                disabled: gif || !captions,
                testid: 'export-captions-burned',
              },
            ]}
            value={state.captions && captions && !gif ? 'burned' : 'off'}
            onPick={(id) => set({ captions: id === 'burned' })}
          />
          {gif || !captions ? (
            <span className="ex-row-n ex-row-n--in" data-testid="export-captions-note">
              {gif ? CAPTIONS_GIF : CAPTIONS_NONE}
            </span>
          ) : null}
        </Row>
      ) : null}

      {len.kind === 'warn' || len.kind === 'past' ? (
        <Hint
          icon="problem"
          tone="warn"
          testid="export-video-length"
          action={len.kind === 'warn' ? ALLOW_LONGER : undefined}
          actionTestid="export-video-allow-longer"
          onAction={() => set({ allowLonger: true })}
        >
          {overCapLine({
            label: len.row.label,
            frames: len.row.frames,
            fps: len.row.fps,
            cap: len.row.cap,
            allowed: len.kind === 'past',
          })}
        </Hint>
      ) : null}
      {len.kind === 'longer' ? (
        <Hint
          icon="clock"
          testid="export-video-length"
          action={ALLOW_LONGER_OFF}
          actionTestid="export-video-allow-longer-off"
          onAction={() => set({ allowLonger: false })}
        >
          {overCapLine({
            label: len.row.label,
            frames: len.row.frames,
            fps: len.row.fps,
            cap: len.row.cap,
            allowed: true,
          })}
        </Hint>
      ) : null}

      {first ? <Film row={first} at={at} onAt={setAt} /> : null}
    </>
  );
}
