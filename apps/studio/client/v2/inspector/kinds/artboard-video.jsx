// client/v2/inspector/kinds/artboard-video.jsx — S7.21: the Video artboard's rows (08 ak-video; 07's VideoInspector).
//
//   Size            Reels 9:16 — a preset of the one catalogue (Video), or Custom
//   Length          0:15 — as long as its clips (the comp announces it; trimming the end is the timeline's)
//   Poster frame    0:04 · Change (the frame under the playhead — registry `video.poster.set`, S7.8)
//   Sound           the music the comp plays, or "None yet"
//   Export          one row: an MP4 button that opens the export sheet (07's VideoInspector; no Export section, no
//                   Formats / Safe zones while the video has no other format — see sections/formats.jsx)
//
// Export is S8's ("MP4", `exportDefaults('video')`); the frame rate and codec are under Advanced
// (`kind video · fps 30 · durationInFrames 450 · codec h264 · poster frame 120`). Selecting a video artboard also
// brings the timeline (S7.7) — nothing here opens it.

import { useEffect } from 'react';
import { exportDefaults } from '../../../../kinds/export-defaults.ts';
import { StIcon } from '../../../shell/icons.jsx';
import { compMediaStore } from '../../transcript/comp-media-store.js';
import { formatsUi } from '../formats-ui.js';
import { Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { lengthWords, posterWords } from './artboard-kinds-model.js';
import { SizeSelectRow, useArtboardWrites } from './artboard-rows.jsx';
import { useVideoFacts } from './video-facts.js';

/**
 * The poster frame's picture (07 `.ve-in-poster-pic`, 22 x 38): the footage under the frame, held on that second.
 * A project-relative path only — a scheme or `//host` in canvas source never becomes a request from the shell origin.
 */
function PosterPic({ pic, cfg }) {
  const root = String(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  const src = pic?.src;
  const ok = typeof src === 'string' && !src.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(src);
  const url = ok ? (src.startsWith('/') ? src : `/${root}/${src}`) : null;
  return (
    <span className="insp-poster-pic" data-testid="insp-ab-poster-pic" aria-hidden="true">
      {url ? (
        <video
          src={`${url}#t=${Math.max(0.05, pic.t).toFixed(2)}`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
        />
      ) : null}
    </span>
  );
}

function VideoRows({ el, ctx }) {
  const { f, id, resize } = useArtboardWrites(el, ctx);
  const file = el?.file ?? ctx?.canvasFile ?? null;
  const v = useVideoFacts(file, id);
  const canChange = typeof ctx?.onShellAction === 'function';
  // a video is selected: Cmd-K "Add a format" can draw the Formats rows even before it has a second format
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new artboard is a new question
  useEffect(() => formatsUi.presence(), [id]);
  // whether the video has other formats decides if their rows join the card: read them once, here, for a video selected first
  useEffect(() => {
    if (file && id && !compMediaStore.get(file, id)) void compMediaStore.load(file, id);
  }, [file, id]);
  return (
    <>
      <SizeSelectRow k="Size" f={f} resize={resize} />
      <Row k="Length" name="ab-length">
        <span className="insp-ro insp-ro--well" data-testid="insp-ab-length">
          <StIcon name="clock" size={12} /> {lengthWords(v.durationInFrames, v.fps)}
        </span>
      </Row>
      <Row k="Poster frame" name="ab-poster">
        <span className="insp-poster" data-testid="insp-ab-poster-line">
          <PosterPic pic={v.pic} cfg={ctx?.cfg} />
          <span className="insp-ro" data-testid="insp-ab-poster">
            {posterWords(v.poster, v.fps)}
          </span>
        </span>
        {canChange ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm insp-poster-change"
            data-testid="insp-ab-poster-change"
            onClick={() => ctx.onShellAction('video.poster.set')}
          >
            Change
          </button>
        ) : null}
      </Row>
      <Row k="Sound" name="ab-sound" dim={!v.sound}>
        {v.sound ? (
          <span className="insp-ro insp-ro--pill" data-testid="insp-ab-sound">
            <i className="insp-ro-swatch" aria-hidden="true" />
            <b>{v.sound}</b>
          </span>
        ) : (
          <span className="insp-ro insp-ro--note" data-testid="insp-ab-sound">
            None yet
          </span>
        )}
      </Row>
      <Row k="Export" name="ab-export">
        <button
          type="button"
          className="btn btn--sm insp-export-btn"
          data-testid="insp-ab-export"
          aria-label={`Export — ${exportDefaults('video').word}`}
          onClick={() => ctx?.onShellAction?.('export.open')}
        >
          <StIcon name="download" size={12} />
          {exportDefaults('video').word}
        </button>
      </Row>
    </>
  );
}

const kindOf = (selection) => {
  const el = Array.isArray(selection) ? selection[0] : selection;
  return el?.attrs?.['data-dc-kind'] || 'digital';
};

export const ARTBOARD_VIDEO_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.artboard-video',
      order: 10,
      kinds: ['artboard'],
      title: 'Artboard',
      // 07 VideoInspector is one flat card under the name: no heading above Size
      headless: true,
      when: ({ selection }) => kindOf(selection) === 'video',
      Body: VideoRows,
    },
  ],
]);

/** @returns {() => void} take the Video rows back out of the registry */
export function registerArtboardVideoSlots() {
  const offs = ARTBOARD_VIDEO_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offArtboardVideo = registerArtboardVideoSlots();
