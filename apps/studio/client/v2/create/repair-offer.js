// client/v2/create/repair-offer.js — P8 C8 (01 `cf-render-error`): the render-error card is ONE verb ("Go back to
// 14:05"); the AI repair is a chip in the AI panel ("Ask AI to fix it", board 01 `AIPanel chips`). This is the
// one place the card tells the panel a repair is on offer for a canvas — a tiny external store, so the card (the
// viewport) and the chip (the AI panel) need no new plumbing between them. The chip prefills the composer with
// `text` and never sends (S11.7).

let offers = {};
const subs = new Set();
const emit = () => {
  for (const fn of subs) fn();
};

/** The card for `canvas` is showing (`text` = the composer text) or gone (`text` = null). */
export function setRepairOffer(canvas, text) {
  if (!canvas) return;
  if ((offers[canvas] ?? null) === (text ?? null)) return;
  const next = { ...offers };
  if (text) next[canvas] = text;
  else delete next[canvas];
  offers = next;
  emit();
}

/** The composer text of the repair on offer for `canvas`, or null. */
export const repairOfferFor = (canvas) => (canvas ? (offers[canvas] ?? null) : null);

export const subscribeRepairOffer = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

/** Test seam. */
export const resetRepairOffers = () => {
  offers = {};
  emit();
};
