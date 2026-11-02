// client/v2/ai/run-cards.js — S7 §2.2 (S7.15): run cards by kind, append-only.
//
// A run's studio-local `progress` names what it is counting (`kind`: place, watch, …). The chat's run surface
// (RunSurface.jsx) asks `runCardFor(run.progress.kind)` and draws what is registered, so a feature that owns a
// kind owns its card without editing the surface. Registration is append-only: the first component a kind gets
// is the one it keeps (registering the same one again is a no-op), so a later module cannot silently swap
// another feature's card.
//
// A card is `({ run, where, live, ended, designRel, onAsk }) => ReactNode`:
//   where 'top'   above the working line / the result — the attached footage, the watching grid
//   where 'tail'  under the result card — the lines that outlive the run ("Left out: …" + Use them anyway)
//   onAsk(text)   sends a new ask to this chat (the same door the follow-up chips use)

const cards = new Map();

/** Register the card for a progress kind. Returns true when it is now (or already was) that kind's card. */
export function registerRunCard(kind, Component) {
  if (typeof kind !== 'string' || !kind || typeof Component !== 'function') return false;
  const had = cards.get(kind);
  if (had) return had === Component;
  cards.set(kind, Component);
  return true;
}

/** The card for a progress kind, or null when none is registered. */
export function runCardFor(kind) {
  return (typeof kind === 'string' && cards.get(kind)) || null;
}

/** The kinds that have a card (tests, the registry's own listing). */
export const runCardKinds = () => [...cards.keys()];
