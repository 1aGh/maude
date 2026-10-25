// client/v2/export/sections/video.jsx — S8.6: a video artboard → MP4, GIF, WebM or Sound only (09 ex-video).
//
// Which formats (the artboard and its linked formats, each ticked), which format, how sharp, what sound,
// whether captions — Off unless asked (C19) — and the filmstrip: the whole edit, scrub it to check any
// frame. A video past 3 600 frames warns (C22) with one way out, "Allow longer"; the SERVER holds the
// cap, so this only says what the estimate says. v1 re-emit: `export-format-mp4` / `-gif` / `-webm`.

import { useEffect, useState } from 'react';
import { getStillsAt } from '../../../panels/timeline-media-cache.js';
import { StIcon } from '../../../shell/icons.jsx';
import { TGlyph } from '../../timeline/glyphs.jsx';
import { Hint, Row, Seg } from '../parts.jsx';
import { Switch } from '../advanced/fields.jsx';
import {
  ALLOW_LONGER,
  ALLOW_LONGER_OFF,
  CAPTIONS_BURNED,
  CAPTIONS_GIF,
  CAPTIONS_LABEL,
  CAPTIONS_NONE,
  CAPTIONS_OFF,
  clock,
  tickSeconds,
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
  SOUND_NONE,
  CAPTIONS_BOTH,
  CAPTIONS_FILE,
  CAPTIONS_HELD,
  SOUND_ONLY_NOTE,
  SOUND_SHARED_NOTE,
  VIDEO_FORMATS,
} from './video-copy.js';
import { lengthState, qualityReaches, scaleOf, sizeWords } from './video-model.js';

const labelOf = (format) => (format === 'webm' ? 'WebM' : String(format).toUpperCase());

/** The URL a clip's file is read from: a designRoot-relative path under the design root, never another host. */
function stillUrl(src, designRel) {
  if (!src || src.startsWith('//') || /^(https?:|data:|blob:)/i.test(src)) return null;
  if (src.startsWith('/')) return src;
  return `/${String(designRel).replace(/^\/+|\/+$/g, '')}/${src}`;
}

/** One small picture per clip of the cut (the frame the clip starts on); the tile stays flat until it arrives. */
function useStills(pics, designRel) {
  const [stills, setStills] = useState({});
  const sig = pics.map((c) => `${c.src}@${c.at ?? 0}`).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sig` is the clips' identity
  useEffect(() => {
    let live = true;
    const byUrl = new Map();
    pics.forEach((c, i) => {
      const url = stillUrl(c.src, designRel);
      if (!url) return;
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push([i, c.at ?? 0]);
    });
    for (const [url, list] of byUrl) {
      getStillsAt(
        url,
        list.map(([, t]) => t)
      ).then((got) => {
        if (!live) return;
        setStills((old) => {
          const next = { ...old };
          list.forEach(([i], k) => {
            if (got[k]) next[i] = got[k];
          });
          return next;
        });
      });
    }
    return () => {
      live = false;
    };
  }, [sig, designRel]);
  return stills;
}

/** The cut as lanes — its titles, the pictures with their names, then the music — with a playhead. Numbers come from the estimate. */
function Film({ row, at, onAt, designRel }) {
  const total = Math.max(1, row.frames ?? Math.max(1, ...row.clips.map((c) => c.from + c.frames)));
  const pct = (f) => `${(f / total) * 100}%`;
  const pics = row.clips.filter((c) => c.track === 'video' || c.track === 'video2');
  const beds = row.clips.filter((c) => c.track === 'music' || c.track === 'music2');
  const titles = pics.filter((c) => c.title);
  const stills = useStills(pics, designRel);
  const here = Math.min(total, Math.max(0, at));
  return (
    <div
      className="ex-film"
      data-testid="export-film"
      role="group"
      aria-label={`${row.label} — ${FILM_LABEL}`}
    >
      <div className="ex-film-lanes">
        {titles.length > 0 ? (
          <div className="ex-film-lane ex-film-lane--t" data-testid="export-film-titles">
            {titles.map((c, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: titles are positional and never reorder here
                key={i}
                className="ex-film-ti"
                style={{ left: pct(c.from), width: pct(c.frames) }}
              >
                {c.title}
              </span>
            ))}
          </div>
        ) : null}
        <div className="ex-film-lane ex-film-lane--v">
          {pics.map((c, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: clips are positional and never reorder here
              key={i}
              className={`ex-film-clip${c.track === 'video2' ? ' ex-film-clip--2' : ''}`}
              data-testid="export-film-clip"
              style={{
                left: pct(c.from),
                width: pct(c.frames),
                ...(stills[i] ? { backgroundImage: `url(${stills[i]})` } : {}),
              }}
            >
              {c.name ? <em>{c.name}</em> : null}
            </span>
          ))}
        </div>
        {beds.length > 0 ? (
          <div className="ex-film-lane ex-film-lane--m" data-testid="export-film-music">
            {beds.map((c, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: beds are positional and never reorder here
                key={i}
                className="ex-film-bed"
                style={{ left: pct(c.from), width: pct(c.frames) }}
              />
            ))}
            <span className="ex-film-bed-t">
              <TGlyph name="music" size={11} />
              {beds[0]?.name ?? ''}
            </span>
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
        {tickSeconds(total / Math.max(1, row.fps)).map((t) => (
          <span key={t} style={{ left: `${((t * row.fps) / total) * 100}%` }}>
            {clock(t * row.fps, row.fps)}
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
/** The whole edit under the sheet's rows (09 ex-video: full width, above the summary), with its own playhead. */
export function VideoFilm({ video, designRel = '.design' }) {
  const [at, setAt] = useState(0);
  const first = video?.rows?.[0] ?? null;
  return first ? <Film row={first} at={at} onAt={setAt} designRel={designRel} /> : null;
}

export function VideoSection({ state, set, setFormat, other, video }) {
  const format = state.format;
  const picture = format !== 'audio';
  const gif = format === 'gif';
  const _audio = format === 'audio';
  const formats = video?.formats ?? [];
  const rows = video?.rows ?? [];
  const first = rows[0] ?? null;
  const shortSide = first?.w && first?.h ? Math.min(first.w, first.h) : null;
  // the cut's own sound: a music bed on the timeline (the engine mixes what the timeline has)
  const hasSound = rows.some((r) =>
    r.clips?.some((c) => c.track === 'music' || c.track === 'music2')
  );
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
            options={QUALITIES.map(([id, label]) => ({
              id,
              label,
              // 1080p / 4K name the size (the shorter side): "1080 × 1920", "2160 × 3840"
              small: sizeWords(first, scaleOf(id, shortSide)) || undefined,
              disabled: !qualityReaches(id, shortSide),
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
          <Switch
            checked={!gif && hasSound}
            disabled
            onChange={() => {}}
            label={SOUND_LABEL}
            testid="export-sound-switch"
          />
          <span className="ex-row-n ex-row-n--in" data-testid="export-sound-note">
            {gif ? SOUND_GIF : hasSound ? SOUND_MIXED : SOUND_NONE}
          </span>
        </Row>
      ) : null}

      {picture ? (
        <Row k={CAPTIONS_LABEL} testid="export-row-captions">
          <Seg
            label={CAPTIONS_LABEL}
            testid="export-captions"
            options={[
              {
                id: 'burned',
                label: CAPTIONS_BURNED,
                disabled: gif || !captions,
                testid: 'export-captions-burned',
              },
              // a caption FILE next to the video is an exporter feature that is not built yet: drawn, held back
              {
                id: 'file',
                label: CAPTIONS_FILE,
                disabled: true,
                title: CAPTIONS_HELD,
                testid: 'export-captions-file',
              },
              {
                id: 'both',
                label: CAPTIONS_BOTH,
                disabled: true,
                title: CAPTIONS_HELD,
                testid: 'export-captions-both',
              },
              { id: 'off', label: CAPTIONS_OFF, testid: 'export-captions-off' },
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

    </>
  );
}
