// client/v2/inspector/kinds/artboard-video.jsx — S7.21: the Video artboard's rows (08 ak-video; 07's VideoInspector).
//
//   Size            Reels 9:16 — a preset of the one catalogue (Video), or Custom
//   Length          0:15 — as long as its clips (the comp announces it; trimming the end is the timeline's)
//   Poster frame    0:04 · Change (the frame under the playhead — registry `video.poster.set`, S7.8)
//   Sound           the music the comp plays, or "None yet"
//
// Export is S8's ("MP4", `exportDefaults('video')`); the frame rate and codec are under Advanced
// (`kind video · fps 30 · durationInFrames 450 · codec h264 · poster frame 120`). Selecting a video artboard also
// brings the timeline (S7.7) — nothing here opens it.

import { StIcon } from '../../../shell/icons.jsx';
import { Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { lengthWords, posterWords } from './artboard-kinds-model.js';
import { SizeSelectRow, useArtboardWrites } from './artboard-rows.jsx';
import { useVideoFacts } from './video-facts.js';

function VideoRows({ el, ctx }) {
  const { f, id, resize } = useArtboardWrites(el, ctx);
  const file = el?.file ?? ctx?.canvasFile ?? null;
  const v = useVideoFacts(file, id);
  const canChange = typeof ctx?.onShellAction === 'function';
  return (
    <>
      <SizeSelectRow k="Size" f={f} resize={resize} />
      <Row k="Length" name="ab-length">
        <span className="insp-ro insp-ro--well" data-testid="insp-ab-length">
          <StIcon name="clock" size={12} /> {lengthWords(v.durationInFrames, v.fps)}
        </span>
      </Row>
      <Row k="Poster frame" name="ab-poster">
        <span className="insp-ro" data-testid="insp-ab-poster">
          {posterWords(v.poster, v.fps)}
        </span>
        {canChange ? (
          <button
            type="button"
            className="insp-quietlink"
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
