// client/v2/ai/row-slots-lane.js — S5.18 (03 `ai-needs-hidden`): the AI's words in the Canvases panel's rows.
//
// The panel's row slot has had an 'ai' source since T-S1a (client/v2/canvases/row-slots.js) and nothing ever
// published into it, so a canvas row never said "Needs you". This is that provider, fed by the run list
// (runs-store.js, the same snapshot the rings and the run list read):
//
//   a run of YOURS on a canvas waits for a person  →  "Needs you"     (azure — the folded spark's colour)
//   a run of YOURS on a canvas is going / in line   →  "AI is working" (quiet)
//
// One word per row, and Needs you beats working. The slot store's own precedence decides what an access or sync
// word does next to it (meta: ai > sync > access > trash). Other people's runs are not words in YOUR list: they
// are View only rows in the run list (S5.11), never counted as yours.
//
//   rowSlotsFor(view, { designRel })   Map<designRoot-relative path, RowSlot>   pure
//   createRowSlotsLane({ store, setSlots })  → dispose()
//   useAiRowSlotsLane()                mount once (the AI island is always mounted)

import { useEffect } from 'react';
import { setRowSlots } from '../canvases/row-slots.js';
import { isLiveRun } from './runs-model.js';
import { getRunsStore } from './runs-store.js';

export const WORD_NEEDS = 'Needs you';
export const WORD_WORKING = 'AI is working';

/** A run's canvas as the Canvases panel names it: relative to the design root. Null for a lazy run. */
function canvasRel(run, designRel) {
  const raw = run?.scope?.canvas;
  if (typeof raw !== 'string' || !raw) return null;
  const prefix = designRel ? `${String(designRel).replace(/^\.\//, '').replace(/\/$/, '')}/` : null;
  return prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

export function rowSlotsFor(view, { designRel = '.design' } = {}) {
  const out = new Map();
  for (const run of view?.mine || []) {
    if (!isLiveRun(run)) continue;
    const path = canvasRel(run, designRel);
    if (!path) continue;
    const needs = run.state === 'needs-you';
    if (!needs && out.has(path)) continue; // a word is already there (working, or the stronger Needs you)
    out.set(path, {
      meta: needs
        ? { word: WORD_NEEDS, tone: 'azure', title: 'AI is waiting for your answer' }
        : { word: WORD_WORKING, tone: 'quiet' },
    });
  }
  return out;
}

export function createRowSlotsLane({ store, designRel, setSlots = setRowSlots } = {}) {
  const publish = () => setSlots('ai', rowSlotsFor(store.getSnapshot().view, { designRel }));
  const off = store.subscribe(publish);
  publish();
  return () => {
    off();
    setSlots('ai', null);
  };
}

/** Mount once: the Canvases panel's rows say "Needs you" / "AI is working". */
export function useAiRowSlotsLane(store, designRel) {
  useEffect(
    () => createRowSlotsLane({ store: store || getRunsStore(), designRel }),
    [store, designRel]
  );
}
