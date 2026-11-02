// client/v2/ds/truth-card.jsx — S10.11: the cards in the inspector's empty place (13 · ds-truth-outside,
// ds-truth-conflict). With nothing selected on a Design system canvas whose files changed outside the app, or whose
// token changed in two places, the panel says so instead of "Press V, then click an element" — three kinds of card:
//
//   Published in two places           two heads, a pick between them (V2-1.6 §5.7)
//   <Token> changed in two places     one per token, side by side
//   N tokens changed outside the app  Keep / Undo
//
// `DsTruthCards` draws a value (tests pass one); `useDsTruthCards` is what the inspector calls: the cards, or null
// when there is nothing to say so the panel keeps its own hint.

import { ConflictPick, PublishedTwice } from './conflict-pick.jsx';
import { OutsideBanner } from './outside-banner.jsx';
import { conflictCards } from './truth-model.js';
import { useDsTruth } from './truth-store.js';

const fileNameOf = (truth) => {
  const files = truth?.outside?.files ?? [];
  const css = files.find((f) => /\.css$/.test(String(f?.path))) ?? files[0];
  return typeof css?.path === 'string' ? css.path.replace(/^.*\//, '') : '';
};

/** Does this value draw anything? (an outside card needs a token change or an other-change to show) */
export function hasCards(value) {
  const t = value?.truth;
  if (!t) return false;
  if (Array.isArray(t.twice) && t.twice.length >= 2) return true;
  if (t.conflicts.length) return true;
  const o = t.outside;
  return !!o && ((o.changes?.length ?? 0) > 0 || (o.otherChanges?.length ?? 0) > 0);
}

/** @param {{ value: any, actions: any, now?: number }} props */
export function DsTruthCards({ value, actions, now }) {
  if (!hasCards(value)) return null;
  const { truth, board, headNames, contrast, busy, note } = value;
  const noop = () => {};
  const cards = conflictCards({
    conflicts: truth.conflicts,
    pending: truth.pending,
    outside: truth.outside,
    board,
    headNames,
    themes: board?.themes,
    now,
  });
  const noteAt = truth.twice ? 'twice' : cards.length ? 'conflict' : 'outside';
  return (
    <div className="dst-stack" data-testid="ds-truth" data-system={value.ds}>
      <PublishedTwice
        places={truth.twice}
        busy={busy}
        note={noteAt === 'twice' ? note : null}
        onPick={actions?.pickHead ?? noop}
        now={now}
      />
      {cards.map((c, i) => (
        <ConflictPick
          key={c.css}
          card={c}
          fileName={fileNameOf(truth)}
          busy={busy}
          note={noteAt === 'conflict' && i === 0 ? note : null}
          onPick={actions?.pick ?? noop}
        />
      ))}
      <OutsideBanner
        truth={truth}
        contrast={contrast}
        themes={board?.themes}
        busy={busy}
        note={noteAt === 'outside' ? note : null}
        onKeep={actions?.keep ?? noop}
        onUndo={actions?.undo ?? noop}
        now={now}
      />
    </div>
  );
}

/** For the inspector's empty place: the cards, or null. */
export function useDsTruthCards() {
  const { value, actions } = useDsTruth();
  return hasCards(value) ? <DsTruthCards value={value} actions={actions} /> : null;
}
