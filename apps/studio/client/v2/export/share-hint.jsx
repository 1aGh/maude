// client/v2/export/share-hint.jsx — S8.2: Export points at Share when a link would do (09 ex-share-vs).
//
// "Tereza and Jonas are in this project. A link shows them the latest, with comments." — once, with one
// action (Copy link). It only shows when other people are in the project, and never again after it has
// been seen once in this browser. The sheet owns the data (`names`) and the action; this owns the
// one-time rule, kept in this browser's localStorage (a per-viewer convenience, never state anyone else
// needs), wrapped so a blocked store just means the line shows each time.

import { useEffect, useState } from 'react';
import { SHARE_HINT_ACTION, shareHint } from './export-copy.js';
import { Hint } from './parts.jsx';

export const SHARE_HINT_KEY = 'maude-export-link-hint-seen';

export const hintSeen = (store = safeStore()) => {
  try {
    return store?.getItem(SHARE_HINT_KEY) === '1';
  } catch {
    return false;
  }
};
export const markHintSeen = (store = safeStore()) => {
  try {
    store?.setItem(SHARE_HINT_KEY, '1');
  } catch {
    /* a blocked store: the line shows again, harmlessly */
  }
};
function safeStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** @param names the other people in the project; @param onCopyLink () => void */
export function ShareHint({ names, onCopyLink }) {
  const people = (names ?? []).filter(Boolean);
  // decided once per opening: seeing it counts as seen, but it stays up while this sheet is open
  const [show] = useState(() => people.length > 0 && !hintSeen());
  useEffect(() => {
    if (show) markHintSeen();
  }, [show]);
  if (!show) return null;
  return (
    <Hint
      icon="link"
      action={SHARE_HINT_ACTION}
      onAction={onCopyLink}
      testid="export-share-hint"
    >
      {shareHint(people)}
    </Hint>
  );
}
