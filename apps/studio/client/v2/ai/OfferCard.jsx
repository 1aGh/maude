// client/v2/ai/OfferCard.jsx — S4.15 (15 Annotations `an-ai-read`, 03 `ai-question`): AI read the stickies and
// offers one change. The card shows the plan in one line ("says") and ONE button. Nothing has changed yet — the
// button only sends the canned follow-up "Make these changes" with the same stickies as the scope (contract
// S4-S5-ai-annotations §4); the apply run does the work, resolves the stickies it answered and rides ONE undo.
//
// While the card is the latest message it hands its targets to the seen store (seen-relay.js), and the canvas
// outlines them. It folds when answered (Make these changes / Not now) or when the chat moves on.
//
// The words on the buttons are the app's, not the agent's (OFFER_WORDS); the agent writes `says` only, which is
// rendered as TEXT.

import { useMessage, useThread } from '@assistant-ui/react';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Spark } from './icons.jsx';
import { askedAnnotations, OFFER_WORDS, parseOffer, seenTargetsFor } from './ai-offer.js';
import { sendAskSelection } from './ask-selection.js';
import { annotationsScope } from './scope.js';
import { getSeenStore } from './seen-relay.js';

/** Message ids whose card was answered or put away — it stays folded after a re-mount. */
const answered = new Set();
const subs = new Set();
const fold = (id) => {
  if (answered.has(id)) return;
  answered.add(id);
  for (const fn of subs) fn();
};
const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

/** "1 sticky isn't included." — the stickies the offer leaves alone, counted (their words stay on the layer). */
export function leavesLine(n) {
  if (!n) return '';
  return n === 1 ? '1 sticky isn’t included.' : `${n} stickies aren’t included.`;
}

const textOf = (parts) =>
  (Array.isArray(parts) ? parts : [])
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');

/** The assistant message's offer, validated against the ask it answers (null: plain text). */
export function offerOf(parts, ask = askedAnnotations()) {
  return parseOffer(textOf(parts), { scopeIds: ask?.ids ?? [] }).offer;
}

export function OfferSlot({ parts, status }) {
  const id = useMessage((m) => m.id);
  const latestId = useThread((t) => t.messages[t.messages.length - 1]?.id);
  const done = useSyncExternalStore(
    subscribe,
    () => answered.has(id),
    () => answered.has(id)
  );
  const ask = askedAnnotations();
  const offer = useMemo(
    () => (status === 'complete' ? offerOf(parts, ask) : null),
    [parts, status, ask]
  );
  const visible = !!offer && latestId === id && !done;

  // the canvas outlines what the offer points at, for as long as the card is the latest, unanswered message
  useEffect(() => {
    if (!visible) return undefined;
    const store = getSeenStore();
    store.set(seenTargetsFor(offer));
    return () => store.set([]);
  }, [visible, offer]);

  if (!visible) return null;
  const make = () => {
    const sent = sendAskSelection({
      text: OFFER_WORDS.primary,
      scope: annotationsScope({
        file: ask?.file,
        ids: ask?.ids,
        artboards: ask?.artboards,
        kinds: ask?.kinds,
        answers: offer.answers,
      }),
    });
    if (sent) fold(id);
  };
  const leaves = leavesLine(offer.leaves.length);
  return (
    <div
      className="ai-nc ai-nc-choice"
      role="group"
      aria-label="AI offers to change the design"
      data-testid="ai-offer"
    >
      <p className="ai-nc-t">
        <span className="ai-nc-ic ai-nc-ic--ask" aria-hidden="true">
          <Spark size={12} />
        </span>
        <span className="ai-nc-tt" data-testid="ai-offer-says">
          {offer.says}
        </span>
      </p>
      {leaves ? (
        <p className="ai-nc-d" data-testid="ai-offer-leaves">
          {leaves}
        </p>
      ) : null}
      <span className="ai-nc-a">
        <button
          type="button"
          className="btn btn--sm btn--danger ai-nc-decline"
          data-testid="ai-offer-skip"
          onClick={() => fold(id)}
        >
          {OFFER_WORDS.secondary}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          data-testid="ai-offer-make"
          onClick={make}
        >
          {OFFER_WORDS.primary}
        </button>
      </span>
    </div>
  );
}
