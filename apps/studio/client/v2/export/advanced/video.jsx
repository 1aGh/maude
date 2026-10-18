// client/v2/export/advanced/video.jsx — S8.3: Advanced › Video (MP4 · GIF · WebM).
//
// Frame rate and bitrate reach the spec (`video.fps`, `video.quality`); the codec follows the format
// and is shown, not chosen. Captions, longer videos and linked formats are the Video section's (S8.6).

import { Row } from '../parts.jsx';
import {
  BITRATE,
  BITRATE_AUTO,
  CODEC,
  CODEC_WORDS,
  FRAME_RATE,
  FRAME_RATE_MADE,
  VIDEO_NOTE,
  VIDEO_TITLE,
} from './advanced-copy.js';
import { Note, Select } from './fields.jsx';
import { FPS_CHOICES, VIDEO_QUALITY } from './model.js';

const videoOf = (spec) => {
  const hit = Object.values(spec.byKind ?? {}).find((e) => e.options?.video)?.options.video;
  return hit ?? spec.options?.video ?? {};
};

/** @param formats the video formats in this export (mp4 · webm · gif) */
export function VideoPart({ spec, formats, setAdv }) {
  const video = videoOf(spec);
  return (
    <section className="ex-advp" data-testid="export-adv-video" aria-label={VIDEO_TITLE}>
      <Row k={FRAME_RATE}>
        <Select
          label={FRAME_RATE}
          testid="export-adv-fps"
          value={video.fps ?? ''}
          options={[['', FRAME_RATE_MADE], ...FPS_CHOICES.map((f) => [f, `${f} fps`])]}
          onChange={(v) => setAdv({ fps: v === '' ? null : Number(v) })}
        />
      </Row>
      <Row k={CODEC}>
        <span className="ex-val" data-testid="export-adv-codec">
          {formats.map((f) => CODEC_WORDS[f]).join(' · ')}
        </span>
      </Row>
      <Row k={BITRATE}>
        <Select
          label={BITRATE}
          testid="export-adv-bitrate"
          value={video.quality ?? ''}
          options={[['', BITRATE_AUTO], ...VIDEO_QUALITY]}
          onChange={(v) => setAdv({ vquality: v === '' ? null : v })}
        />
      </Row>
      <Note>{VIDEO_NOTE}</Note>
    </section>
  );
}
