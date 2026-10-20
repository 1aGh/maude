// client/v2/timeline/music-hint.jsx — S7.10 (07 · ve-fit-fill, bottom): "No clip has sound, so the music track offers some."
//
// The Music track of a video that makes no sound — every clip muted or silent, no music bed — says so in one line and
// offers the two ways out: Add music (a file picker; the file lands in the audio band like a dropped one) and, where
// the AI chat exists, "or ask AI for a track" (pre-fills the chat, never sends). A video whose clips DO have sound
// is not silent and gets no line: the track is simply empty.

import { useRef } from 'react';
import { isNativeApp } from '../../github.js';
import { getPaletteEnv } from '../search/search-env.js';

/** The prompt the AI link pre-fills (the person presses send). */
export const musicPrompt = (artboard) => `Find a music track for ${artboard || 'this video'}.`;

/**
 * @param {{ artboard?: string, canAsk?: boolean, canEdit?: boolean, onAddFiles?: (files: File[]) => void }} props
 */
export function MusicHint({ artboard, canAsk = isNativeApp(), canEdit = true, onAddFiles }) {
  const pick = useRef(null);
  return (
    <span className="tl-music-hint" data-testid="timeline-music-hint">
      No sound in this video.
      {canEdit && onAddFiles ? (
        <>
          <button
            type="button"
            className="tl-link"
            data-testid="timeline-music-add"
            onClick={() => pick.current?.click()}
          >
            Add music
          </button>
          <input
            ref={pick}
            type="file"
            accept="audio/*"
            hidden
            data-testid="timeline-music-file"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) onAddFiles(files);
            }}
          />
        </>
      ) : null}
      {canAsk && canEdit ? (
        <>
          <span className="tl-music-or">or</span>
          <button
            type="button"
            className="tl-link"
            data-testid="timeline-music-ask"
            onClick={() => getPaletteEnv().askAI(musicPrompt(artboard))}
          >
            ask AI for a track
          </button>
        </>
      ) : null}
    </span>
  );
}
