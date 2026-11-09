// client/v2/settings/use-open-card.js — 2.1.1 T6: which card of a Settings tab is open (one at a time),
// remembered per tab for this session (settings-cards.js). `focus` is ⌘K's ask — `{ card, n }`, a new `n`
// each time — and opens the card that holds the hit even when the person had closed it.

import { useCallback, useEffect, useState } from 'react';

import { openCardOf, readOpenCards, toggleCard, writeOpenCard } from './settings-cards.js';

export function useOpenCard(tab, focus = null) {
  const [open, setOpen] = useState(() => focus?.card ?? openCardOf(tab, readOpenCards()));
  const focusCard = focus?.card ?? null;
  const focusN = focus?.n ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new ask (`n`) re-opens the same card
  useEffect(() => {
    if (!focusCard) return;
    setOpen(focusCard);
    writeOpenCard(tab, focusCard);
  }, [tab, focusCard, focusN]);
  const toggle = useCallback(
    (id) =>
      setOpen((cur) => {
        const next = toggleCard(cur, id);
        writeOpenCard(tab, next);
        return next;
      }),
    [tab]
  );
  /** Open `id` (a header action that needs its card's body, e.g. Manage…). */
  const show = useCallback(
    (id) => {
      setOpen(id);
      writeOpenCard(tab, id);
    },
    [tab]
  );
  return { open, toggle, show };
}
