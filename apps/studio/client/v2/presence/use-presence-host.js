// client/v2/presence/use-presence-host.js — S9.23: what the Share cluster's faces need from the shell.
//
//   presence   { run(id, params), labelOf(artboardId), roleOf?, canSummon, canvasLabel } — the faces' menu,
//              the people list, and the canvas iframe's `run-action` lane behind them
//   context    the canvas owns the room's awareness but cannot see the shell: the Comments panel being open
//              and input that happens in the shell (the chat, the inspector) are told to it as
//              `presence.context`, so "in Comments" is true and typing in the chat is not "idle".
//
// A person whose only input is in the shell must not grey out after 3 minutes (Q9 idle is about the
// person, not the iframe) — the activity ping is throttled and carries no content.

import { useEffect, useMemo, useRef } from 'react';

/** At most one "the person is active" ping per this long. */
export const ACTIVITY_PING_MS = 10_000;

/** `/designs/Combine-kampan.tsx` → "Combine-kampan". */
export function canvasLabelOf(activePath) {
  const file = String(activePath ?? '')
    .split('/')
    .pop();
  return (file || '').replace(/\.[a-z0-9]+$/i, '');
}

/** artboard id → label from the canvas index's `boards`, or null. */
export function labelFromBoards(boards) {
  const map = new Map();
  if (Array.isArray(boards))
    for (const b of boards) if (b && typeof b.id === 'string') map.set(b.id, b.label || b.id);
  return (id) => map.get(id) ?? null;
}

export function usePresenceHost({ lane, boards, activePath, canSummon, commentsOpen }) {
  const laneRef = useRef(lane);
  laneRef.current = lane;

  const presence = useMemo(
    () => ({
      run: (id, params) => laneRef.current.presence(id, params),
      labelOf: labelFromBoards(boards),
      canSummon: !!canSummon,
      canvasLabel: canvasLabelOf(activePath),
    }),
    [boards, activePath, canSummon]
  );

  // The Comments panel: told on change and whenever another canvas becomes the active one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `activePath` re-seeds the newly active canvas
  useEffect(() => {
    laneRef.current.presence('presence.context', { inComments: !!commentsOpen });
  }, [commentsOpen, activePath]);

  // Input in the shell is the person being here.
  useEffect(() => {
    let last = 0;
    const ping = () => {
      const now = Date.now();
      if (now - last < ACTIVITY_PING_MS) return;
      last = now;
      laneRef.current.presence('presence.context', { active: true });
    };
    const opts = { capture: true, passive: true };
    window.addEventListener('pointerdown', ping, opts);
    window.addEventListener('keydown', ping, opts);
    return () => {
      window.removeEventListener('pointerdown', ping, opts);
      window.removeEventListener('keydown', ping, opts);
    };
  }, []);

  return presence;
}
