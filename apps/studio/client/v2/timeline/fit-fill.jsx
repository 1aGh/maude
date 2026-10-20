// client/v2/timeline/fit-fill.jsx — S7.10 (07 · ve-fit-fill): "A vertical clip on 16:9 — how should it sit?"
//
// `useFitFill` watches the SELECTED clip: when it is a picture taller than wide in a video wider than tall, and this
// person has not been asked about it, it says so (`ask`). `FitFillAsk` is the popover over the clip — Fill · Fit ·
// Blur behind, and a tick for "Same for every vertical clip". The answer is `video.fit` (nothing written for Fill, it
// is the default). With a standing answer the next vertical clip is not asked: it gets the answer on its first select.

import { useEffect, useRef, useState } from 'react';
import {
  FIT_CHOICES,
  askKey,
  markAsked,
  probeSize,
  setStandingFit,
  shouldAsk,
  standingFit,
  wasAsked,
} from './fit-model.js';

/**
 * @param {{
 *   seq: any|null,                           // the selected Timeline row (with stableId, mediaSrc, mediaTag, fit)
 *   comp: { width: number, height: number }|null,
 *   url: string|null,                        // the clip's picture, resolved for this origin
 *   canvas: string|null, artboardId: string|null,
 *   canEdit: boolean,
 *   runFit: (fit: 'fill'|'fit'|'blur') => void,   // video.fit on the selected clip
 * }} p
 * @returns {{ ask: { stableId: string, name: string, url: string }|null, answer: (fit: string, same: boolean) => void, dismiss: () => void }}
 */
export function useFitFill({ seq, comp, url, canvas, artboardId, canEdit, runFit }) {
  const [ask, setAsk] = useState(null);
  const run = useRef(runFit);
  run.current = runFit;
  const stableId = seq?.stableId ?? null;
  const fit = seq?.fit ?? null;
  const tag = seq?.mediaTag ?? null;
  const src = seq?.mediaSrc ?? null;
  const w = comp?.width;
  const h = comp?.height;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different clip, picture or video is the trigger
  useEffect(() => {
    setAsk(null);
    if (!stableId || !url || !canEdit) return undefined;
    const key = askKey(canvas, artboardId, stableId);
    if (wasAsked(key)) return undefined;
    let dead = false;
    probeSize(url).then((size) => {
      if (dead) return;
      const q = {
        seq: { stableId, mediaSrc: src, mediaTag: tag, fit },
        comp: { width: w, height: h },
        size,
        asked: wasAsked(key),
      };
      if (!shouldAsk(q)) return;
      const standing = standingFit();
      if (standing) {
        // "Same for every vertical clip": no question; the answer is applied once, then it is theirs to change
        markAsked(key);
        if (standing !== 'fill') run.current(standing);
        return;
      }
      setAsk({ stableId, name: String(src).split('/').pop(), url });
    });
    return () => {
      dead = true;
    };
  }, [stableId, url, canEdit, canvas, artboardId, w, h]);
  return {
    ask,
    answer(choice, same) {
      if (!ask) return;
      markAsked(askKey(canvas, artboardId, ask.stableId));
      if (same) setStandingFit(choice);
      if (choice !== 'fill') run.current(choice);
      setAsk(null);
    },
    dismiss() {
      // closing without an answer is an answer for now: it does not ask again for this clip
      if (ask) markAsked(askKey(canvas, artboardId, ask.stableId));
      setAsk(null);
    },
  };
}

/** The popover, hung over the clip block `[data-clip-id]` it is about. */
export function FitFillAsk({ ask, onAnswer, onClose }) {
  const [same, setSame] = useState(true);
  const rootRef = useRef(null);
  const [at, setAt] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed once per question
  useEffect(() => {
    const block = ask
      ? document.querySelector(`[data-clip-id="${CSS.escape(ask.stableId)}"]`)
      : null;
    const r = block?.getBoundingClientRect?.();
    setAt(
      r
        ? { x: r.left + Math.min(r.width / 2, 160), y: r.top }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    );
  }, [ask?.stableId]);
  useEffect(() => {
    if (!ask) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask, onClose]);
  if (!ask || !at) return null;
  const W = 320;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, at.x - W / 2));
  const photo = { backgroundImage: `url("${ask.url.replace(/"/g, '%22')}")` };
  return (
    <div
      ref={rootRef}
      className="tf-pop"
      role="dialog"
      aria-label={`${ask.name} is vertical — how should it sit?`}
      data-testid="timeline-fit-ask"
      style={{ left, bottom: window.innerHeight - at.y + 14 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p className="tf-title" data-testid="timeline-fit-ask-title">
        {ask.name} is vertical — how should it sit?
      </p>
      {FIT_CHOICES.map(([key, label, small]) => (
        <button
          key={key}
          type="button"
          className="tf-opt"
          data-on={key === 'blur' ? 'true' : undefined}
          data-testid={`timeline-fit-${key}`}
          onClick={() => onAnswer(key, same)}
        >
          <span
            className={`tf-pic tf-pic--${key}`}
            style={key === 'fit' ? undefined : photo}
            aria-hidden="true"
          >
            {key === 'fit' || key === 'blur' ? <i style={photo} /> : null}
          </span>
          <span>
            <strong>{label}</strong>
            <small>{small}</small>
          </span>
        </button>
      ))}
      <label className="tf-foot tf-same">
        <input
          type="checkbox"
          data-testid="timeline-fit-same"
          checked={same}
          onChange={(e) => setSame(e.target.checked)}
        />
        Same for every vertical clip
      </label>
    </div>
  );
}
