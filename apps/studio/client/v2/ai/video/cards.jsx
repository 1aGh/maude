// client/v2/ai/video/cards.jsx — S7.15: the two run cards of an AI cut, registered by progress kind
// (run-cards.js). `watch` = the run is watching the footage it was given; `place` = the cut is landing / landed.
// RunSurface.jsx draws whichever the run's `progress.kind` has, at two places (`where`): above the working
// line / the result, and under the result.

import { useCallback } from 'react';
import { registerRunCard } from '../run-cards.js';
import { clipsAttachedModel, leftOutModel, anywayAsk, watchModel } from './card-model.js';
import { ClipsAttached } from './ClipsAttached.jsx';
import { assetUrlOf } from './clip-pic.js';
import { LeftOut } from './LeftOut.jsx';
import { WatchProgress } from './WatchProgress.jsx';

export function WatchCard({ run, where, designRel }) {
  if (where !== 'top') return null;
  const urlOf = (a) => assetUrlOf(designRel, a);
  return (
    <>
      <ClipsAttached model={clipsAttachedModel(run.progress)} urlOf={urlOf} />
      <WatchProgress model={watchModel(run.progress)} urlOf={urlOf} />
    </>
  );
}

export function PlaceCard({ run, where, ended, designRel, onAsk }) {
  const model = leftOutModel(run.progress, { ended: !!ended });
  const onUseThem = useCallback(() => {
    const text = anywayAsk(model?.left);
    if (text) onAsk?.(text);
  }, [model, onAsk]);
  if (where === 'top') {
    return (
      <>
        <ClipsAttached
          model={clipsAttachedModel(run.progress)}
          urlOf={(a) => assetUrlOf(designRel, a)}
        />
        {ended ? null : <LeftOut model={model} ended={false} />}
      </>
    );
  }
  return ended ? <LeftOut model={model} ended onUseThem={onUseThem} /> : null;
}

/** Idempotent: the kinds keep the first card they were given. */
export function registerVideoRunCards() {
  registerRunCard('watch', WatchCard);
  registerRunCard('place', PlaceCard);
}

registerVideoRunCards();
