// client/v2/timeline/advanced/foot.jsx — S7.18: the Timeline's Advanced, at its foot (06 ad-timeline, 07 ve-advanced).
//
// Closed it is one quiet row, "› Advanced · Frames, keyframes, the cut as code". Open it turns the ruler to
// frames (Timecode | Frames), the header's time to a timecode, draws the keyframes, and shows three columns:
// This video (render settings, how long an export may be, + track), the selected keyframe's curve, and the cut as
// code. Mono and raw words live only in here. The fold is the shared Advanced fold `timeline` (remembered per
// Mac, covered by ⌘K "Open all Advanced sections").

import { useState } from 'react';
import { AdvancedFold } from '../../fold/advanced-fold.jsx';
import { useFold } from '../../fold/use-fold.js';
import { advancedStore, trackKey, useAdvanced } from './advanced-store.js';
import { CutAsCode } from './cut-as-code.jsx';
import { EasingCurve } from './easing-curve.jsx';
import { ADV_WORDS, frameReadout, timecode } from './model.js';
import { RenderSettings } from './render-settings.jsx';

export { advancedStore, trackKey, useAdvanced } from './advanced-store.js';

/** `[open]` of the Advanced fold at the Timeline's foot — the header, the ruler and the markers follow it. */
export const useAdvancedOpen = () => useFold('timeline')[0];

/** The keyframe the panel shows: the sequence, its window and what it says. */
export function selectedKeyframe(sequences, kf) {
  if (!kf) return null;
  const seq = sequences.find((s) => s.label === kf.component && Array.isArray(s.keyframeInfo));
  if (!seq) return null;
  const k = seq.keyframeInfo.findIndex((i) => i?.index === kf.index);
  if (k < 0) return null;
  return { seq, k, info: seq.keyframeInfo[k], win: seq.keyframes[k] };
}

/**
 * @param {{ canvas: string|null, artboardId: string|null, fps: number, total: number, frame: number,
 *   sequences: object[], selectedClipId: string|null, canEdit: boolean, canRead: boolean,
 *   cap: ReturnType<import('./video-cap.js').capView>, onCap: (a: 'allow'|'back') => void,
 *   have: string[], onWriteEasing: (kf: {component: string, index: number}, b: number[]|null) => void,
 *   fetchImpl?: typeof fetch }} p
 */
export function AdvancedFoot({
  canvas,
  artboardId,
  fps,
  total,
  frame,
  sequences,
  selectedClipId,
  canEdit,
  canRead,
  cap,
  onCap,
  have,
  onWriteEasing,
  fetchImpl,
}) {
  const [open] = useFold('timeline');
  const adv = useAdvanced();
  const [copied, setCopied] = useState(false);
  const key = trackKey(canvas, artboardId);
  const picked = selectedKeyframe(sequences, adv.kf);
  const clip =
    sequences.find((s) => s.stableId && s.stableId === selectedClipId) ?? picked?.seq ?? null;

  return (
    <div className="tla" data-testid="timeline-advanced" data-open={open ? 'true' : undefined}>
      <AdvancedFold
        panel="timeline"
        label={ADV_WORDS.advanced}
        hint={open ? undefined : ADV_WORDS.hint}
        testid="timeline-advanced-fold"
        buttonTestid="timeline-advanced-toggle"
      >
        <div className="tla-body">
          <RenderSettings
            fps={fps}
            total={total}
            cap={cap}
            canEdit={canEdit}
            onCap={onCap}
            have={have}
            onAddTrack={(id) => advancedStore.addTrack(key, id)}
          />
          <section className="tla-sec" data-testid="timeline-keyframe">
            <h3 className="tla-h">
              {picked ? ADV_WORDS.easing(picked.seq.label) : 'Keyframe'}
              {picked?.info?.prop ? <span className="tla-chip">{picked.info.prop}</span> : null}
            </h3>
            {picked ? (
              <EasingCurve
                info={picked.info}
                from={picked.win.from}
                to={picked.win.to}
                name={picked.seq.label}
                canEdit={canEdit}
                onWrite={(b) =>
                  onWriteEasing({ component: picked.seq.label, index: picked.info.index }, b)
                }
              />
            ) : (
              <p className="tla-note" data-testid="timeline-keyframe-none">
                {ADV_WORDS.noKeyframe}
              </p>
            )}
            <div className="tla-acts">
              <button
                type="button"
                className="tla-btn"
                data-testid="timeline-copy-timecode"
                onClick={() => {
                  Promise.resolve(globalThis.navigator?.clipboard?.writeText(timecode(frame, fps)))
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {ADV_WORDS.copyTimecode}
              </button>
              {copied ? <span className="tla-note">{ADV_WORDS.copied}</span> : null}
            </div>
          </section>
          <CutAsCode canvas={canvas} seq={clip} fps={fps} canRead={canRead} fetchImpl={fetchImpl} />
        </div>
      </AdvancedFold>
      {open ? (
        <div className="tla-readout" data-testid="timeline-frame-readout">
          <span className="tla-readout-t">{frameReadout({ fps, frame, total })}</span>
          <span className="tla-seg" role="group" aria-label="Ruler">
            {[
              ['timecode', ADV_WORDS.timecode],
              ['frames', ADV_WORDS.frames],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="tla-seg-btn"
                aria-pressed={adv.mode === id}
                data-on={adv.mode === id ? 'true' : undefined}
                data-testid={`timeline-ruler-${id}`}
                onClick={() => advancedStore.setMode(id)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}
