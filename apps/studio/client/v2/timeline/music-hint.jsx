// client/v2/timeline/music-hint.jsx — S7.10 (07 · ve-fit-fill, bottom): "No clip has sound, so the music track offers some."
//
// The Music track of a video that makes no sound — every clip muted or silent, no music bed — says so in one line and
// offers the two ways out: Add music (a file picker; the file lands in the audio band like a dropped one) and, where
// the AI chat exists, "or ask AI for a track" (pre-fills the chat, never sends). A video whose clips DO have sound
// is not silent and gets no line: the track is simply empty.

import { useRef } from 'react';
import { isNativeApp } from '../../github.js';
import { getPaletteEnv } from '../search/search-env.js';
import { TGlyph } from './glyphs.jsx';

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

/**
 * P8 C3 (07 · .ve-tl-tools) — the header's "Add music" tool: the same file picker as the silent video's line, so a
 * song lands in the Music track like a dropped one. Drawn only where the person can edit.
 * @param {{ onAddFiles: (files: File[]) => void }} props
 */
export function MusicTool({ onAddFiles }) {
  const pick = useRef(null);
  return (
    <>
      <button
        type="button"
        className="icon-btn k-icon-sm"
        aria-label="Add music"
        title="Add music"
        data-testid="timeline-music-tool"
        onClick={() => pick.current?.click()}
      >
        <TGlyph name="music" />
      </button>
      <input
        ref={pick}
        type="file"
        accept="audio/*"
        hidden
        data-testid="timeline-music-tool-file"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onAddFiles(files);
        }}
      />
    </>
  );
}
