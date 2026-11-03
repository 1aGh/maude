// client/v2/ai/use-activity-line.js — rc3-h (#182): feeds the chat's live stream into the activity line
// (activity-line.js) and re-renders only when what it shows changes — a waiting swap, the idle fallback, a
// new announcement. While `live` is false the line is empty and the canvas target is let go.

import { useEffect, useRef, useState } from 'react';
import { createActivityLine } from './activity-line.js';
import { getActivityStore } from './activity-store.js';

const EMPTY = { text: null, step: null, target: null, announce: null };
const sameView = (a, b) =>
  a.text === b.text &&
  a.step === b.step &&
  a.target === b.target &&
  (a.announce?.id ?? null) === (b.announce?.id ?? null);

/**
 * @param {{ onTurnFrame?: (fn: (frame: any) => void) => () => void } | null} conn
 * @param {boolean} live  a turn or run of this chat is working
 * @param {{ designRel?: string, labels?: Map<string, Array<{id: string, label: string}>>, store?: any,
 *   now?: () => number }} [o]
 */
export function useActivityLine(conn, live, o = {}) {
  const { designRel = '.design', labels = null } = o;
  const store = o.store ?? getActivityStore();
  const now = o.now ?? Date.now;
  const lineRef = useRef(null);
  if (!lineRef.current) lineRef.current = createActivityLine();
  const ctxRef = useRef(null);
  ctxRef.current = { designRel, labelsFor: (f) => labels?.get?.(f) ?? [] };
  const liveRef = useRef(live);
  liveRef.current = live;
  const [view, setView] = useState(EMPTY);
  const [wake, setWake] = useState(0);
  const viewRef = useRef(EMPTY);

  const publish = () => {
    const v = liveRef.current ? lineRef.current.view(now()) : EMPTY;
    if (!sameView(v, viewRef.current)) {
      viewRef.current = v;
      setView(v);
    }
    store.set(liveRef.current ? v.target : null);
  };
  const publishRef = useRef(publish);
  publishRef.current = publish;

  useEffect(() => {
    if (!conn?.onTurnFrame) return undefined;
    return conn.onTurnFrame((frame) => {
      if (frame?.t === 'update') lineRef.current.feed(frame.update, now(), ctxRef.current);
      publishRef.current();
      setWake((n) => n + 1);
    });
  }, [conn, now]);

  // a run that ended, failed or was stopped: forget it all
  useEffect(() => {
    if (!live) lineRef.current.reset();
    publishRef.current();
  }, [live]);

  // wake when the view changes by itself (a waiting swap, the idle fallback, an announcement)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wake` re-arms the timer after every event
  useEffect(() => {
    if (!live) return undefined;
    const at = lineRef.current.nextAt(now());
    if (at === null) return undefined;
    const id = setTimeout(
      () => {
        publishRef.current();
        setWake((n) => n + 1);
      },
      Math.max(16, at - now())
    );
    return () => clearTimeout(id);
  }, [live, wake, view, now]);

  useEffect(() => () => store.set(null), [store]);

  return view;
}
