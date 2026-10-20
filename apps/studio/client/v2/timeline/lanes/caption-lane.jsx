// client/v2/timeline/lanes/caption-lane.jsx — S7.11: the captions on the Text track (07 · ve-text, ve-captions).
//
// Captions are the Text track's SECOND lane (C35): one chip per word, at the frames the clip shows it. The word
// being said lights up as it plays. They are derived — a trim or a cut moves them with no write — so the lane
// reads `GET /_api/comp-media` (the shared store) and draws nothing the file does not say.
//
//   click          selects the word: the right-hand inspector becomes the Captions' (kinds/caption.jsx)
//   double-click   opens the Transcript panel on that word (Q17)
//
// `CaptionsTool` is the island's "Captions from speech" button (video.captions.add).

import { Captions } from 'lucide-react';
import { useEffect } from 'react';
import {
  addCaptionsFromSpeech,
  transcriptUi,
  useTranscriptUi,
} from '../../transcript/captions-api.js';
import { useCompMedia } from '../../transcript/comp-media-store.js';
import { wordKey } from '../../transcript/transcript-model.js';
import { fixingText, useTimelinePeers, wordHolder } from '../peers.jsx';
import { timelineSelection, useTimelineSelection } from '../selection.js';

const LOW_P = 0.5;

/** The snapshot the inspector's Captions kind reads (the timeline's selection store, kind `caption`). */
export function captionSelection({ canvas, artboardId, fps, media, key }) {
  const lang = Object.values(media?.transcripts ?? {})[0]?.lang ?? null;
  return {
    kind: 'caption',
    canvas,
    artboardId,
    fps,
    stableId: 'captions',
    label: 'Captions',
    seq: {
      captions: media?.captions ?? null,
      wordCount: media?.words?.length ?? 0,
      lang,
    },
    wordKey: key ?? null,
    transitionAfter: null,
    onVerb: async () => null,
    onOp: async () => null,
    deselect: () => {},
  };
}

/**
 * @param {{ canvas: string|null, artboardId: string|null, fps: number, frame: number,
 *   x: (frame: number) => number, axisPx: number, onSeek?: (frame: number) => void }} props
 */
export function CaptionLane({ canvas, artboardId, fps, frame, x, axisPx, onSeek }) {
  const { media } = useCompMedia(canvas, artboardId);
  const sel = useTimelineSelection();
  const { peers } = useTimelinePeers();
  const words = media?.words ?? [];
  const captionsSelected = sel?.kind === 'caption' && sel.canvas === canvas;

  // a rewrite of the captions (a style change, a fix, a teammate) refreshes the open inspector
  useEffect(() => {
    if (!captionsSelected || !media?.captions) return;
    timelineSelection.set(
      captionSelection({ canvas, artboardId, fps, media, key: timelineSelection.get()?.wordKey })
    );
  }, [media, captionsSelected, canvas, artboardId, fps]);

  if (!media?.captions) return null;
  return (
    <div className="tl-row tl-row--captions" data-testid="timeline-captions-lane">
      <span className="tl-row-label" title="Captions">
        <span className="tl-lane-id">CC</span>
      </span>
      <div className="tl-row-track" style={{ width: axisPx, flex: 'none' }}>
        {words.map((w) => {
          const key = wordKey(w);
          // S7.17 — a word a teammate is fixing wears their ring and says so
          const heldBy = wordHolder(peers, artboardId, key);
          const left = x(w.f0);
          const width = Math.max(2, x(w.f1 - w.f0) - 1);
          return (
            <button
              type="button"
              key={key}
              className="tl-cap"
              data-testid={`timeline-caption-${w.wordId}`}
              data-key={key}
              data-hl={frame >= w.f0 && frame < w.f1 ? 'true' : undefined}
              data-sel={captionsSelected && sel.wordKey === key ? 'true' : undefined}
              data-low={typeof w.p === 'number' && w.p < LOW_P && !w.fixed ? 'true' : undefined}
              data-held={heldBy ? 'true' : undefined}
              style={{ left, width }}
              title={heldBy ? `${w.text} · ${fixingText(heldBy)}` : w.text}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                // one thing is selected at a time: a clip's highlight lets go before the captions take the inspector
                const prev = timelineSelection.get();
                if (prev && prev.kind !== 'caption') prev.deselect?.();
                timelineSelection.set(captionSelection({ canvas, artboardId, fps, media, key }));
                onSeek?.(w.f0);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                transcriptUi.open();
                transcriptUi.select([key], key);
              }}
            >
              {w.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The island's "Captions from speech" button (video.captions.add). */
export function CaptionsTool() {
  const ui = useTranscriptUi();
  return (
    <button
      type="button"
      className="tl-btn tl-cap-tool"
      aria-label="Captions from speech"
      title="Captions from speech"
      data-testid="timeline-captions-tool"
      data-busy={ui.working ? 'true' : undefined}
      onClick={() => void addCaptionsFromSpeech()}
    >
      <Captions size={14} strokeWidth={1.75} style={{ display: 'block', flex: 'none' }} />
    </button>
  );
}
