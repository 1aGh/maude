// client/v2/signin/use-whats-new-line.js — Home's What's New line (02 Onboarding ob-edge-whats-new, S6.8, Q11).
//
// After an update Home shows ONE quiet line, once: the newest unseen entry's `title` — no modal, no tour.
// "Once" is Home's own mark (the entry id it already showed); "unseen" is the per-Mac `whatsNewSeen` in
// ui-prefs that Menu › Help also reads, so Help keeps its dot until the entries are read (opening the
// list is reading them). A first-ever run acknowledges the current version silently (resolveSeen), and
// the line never shows while the sign-in card does — a first run is not an update.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getWhatsNew, markWhatsNewSeen } from '../../home/home-api.js';
import { bestSeenVersion, computeUnseen, resolveSeen } from '../../whats-new-seen.js';

const SHOWN_KEY = 'maude-home-whatsnew-shown';

function readShown() {
  try {
    return localStorage.getItem(SHOWN_KEY) || '';
  } catch {
    return '';
  }
}
function writeShown(id) {
  try {
    localStorage.setItem(SHOWN_KEY, id);
  } catch {
    /* private window / blocked storage: the line just shows again next time */
  }
}

/**
 * Pure: what the line needs from a `/_home/whats-new` answer.
 * `write` = a mark Home must store (a first run's silent acknowledgement), `entries` = the unseen ones,
 * newest first (the feed is newest-first), `entry` = the one the line names.
 */
export function whatsNewLineFor(feed) {
  if (!feed || !Array.isArray(feed.entries)) return { write: null, entries: [], entry: null };
  const { seen, write } = resolveSeen({
    stored: feed.seen,
    legacy: null,
    current: feed.version,
  });
  const entries = computeUnseen(feed.entries, seen).filter(
    (e) => e && typeof e.title === 'string' && e.title
  );
  return { write: feed.seen ? null : write, entries, entry: entries[0] ?? null };
}

export function useWhatsNewLine({ enabled, native }) {
  const [feed, setFeed] = useState(null);
  const [gone, setGone] = useState(false);
  const [reading, setReading] = useState(false);
  // decided once, the first render that has an entry to show: was this line already shown before?
  const alreadyShown = useRef(undefined);

  // the feed is read whenever Home is in the app (a first run acknowledges the version silently) — the
  // line itself waits for `enabled`
  useEffect(() => {
    if (!native || feed) return undefined;
    let alive = true;
    getWhatsNew().then((r) => {
      if (!alive || !r.ok || !r.json || !Array.isArray(r.json.entries)) return;
      const { write } = whatsNewLineFor(r.json);
      if (write) markWhatsNewSeen(write);
      setFeed(r.json);
    });
    return () => {
      alive = false;
    };
  }, [native, feed]);

  const { entries, entry } = whatsNewLineFor(feed);
  if (enabled && entry && alreadyShown.current === undefined)
    alreadyShown.current = readShown() === entry.id;
  const show = enabled && !gone && !!entry && alreadyShown.current === false;

  // the line counts as shown from the moment it is on screen; the next visit to Home is quiet again
  useEffect(() => {
    if (show && entry) writeShown(entry.id);
  }, [show, entry]);

  const dismiss = useCallback(() => setGone(true), []);
  const open = useCallback(() => setReading(true), []);
  const close = useCallback(() => {
    setReading(false);
    setGone(true);
    if (feed) markWhatsNewSeen(bestSeenVersion(feed.entries, feed.version));
  }, [feed]);

  return { show, entry, entries, reading, open, close, dismiss };
}
