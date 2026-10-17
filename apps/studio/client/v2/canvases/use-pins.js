// client/v2/canvases/use-pins.js — S1.1: this person's pinned canvases, from `/_api/pins` (V2-3.3).
//
// Pins are per person and per project (`_canvas-state/_pins.json`, keyed by the designRoot-relative path);
// a read-only session pins too. The list is read on mount and again whenever the tree changes (a move or
// a rename re-keys a pin on the server). A toggle is optimistic and is put back if the server refuses.
// The same answer may carry `opened` ({ rel: ms } — when each canvas was last opened here); the
// "Recently opened" sort uses it when it is there and falls back to when a canvas last changed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** The list with `rel` pinned or unpinned — a new array, pin order kept (oldest first). */
export function withPin(pins, rel, pinned, at = Date.now()) {
  const has = pins.some((p) => p.canvas === rel);
  if (pinned === has) return pins;
  return pinned ? [...pins, { canvas: rel, at }] : pins.filter((p) => p.canvas !== rel);
}

/** `/_api/pins` answer → `{ pins: [{canvas, at}], opened }`, whatever shape came back. */
export function normalisePins(raw) {
  const pins = Array.isArray(raw?.pins)
    ? raw.pins.filter((p) => p && typeof p.canvas === 'string')
    : [];
  const opened = {};
  if (raw?.opened && typeof raw.opened === 'object' && !Array.isArray(raw.opened)) {
    for (const [k, v] of Object.entries(raw.opened)) if (Number.isFinite(v)) opened[k] = Number(v);
  }
  return { pins: [...pins].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)), opened };
}

export function usePins({ stamp, fetchImpl } = {}) {
  const [state, setState] = useState({ pins: [], opened: {}, loaded: false });
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;

  const load = useCallback(async () => {
    try {
      const r = await fetchRef.current('/_api/pins', { cache: 'no-store' });
      if (!r.ok) return;
      setState({ ...normalisePins(await r.json()), loaded: true });
    } catch {
      /* the panel works without pins */
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the "the tree changed" signal
  useEffect(() => {
    const t = setTimeout(load, 150); // a burst of tree changes reads once
    return () => clearTimeout(t);
  }, [load, stamp]);

  const toggle = useCallback(
    async (rel, pinned) => {
      setState((s) => ({ ...s, pins: withPin(s.pins, rel, pinned) }));
      try {
        const r = await fetchRef.current('/_api/pins', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canvas: rel, pinned }),
        });
        if (!r.ok) throw new Error(String(r.status));
      } catch {
        await load(); // the server's list is the truth
      }
    },
    [load]
  );

  const { pins, opened, loaded } = state;
  return useMemo(
    () => ({
      pins,
      pinSet: new Set(pins.map((p) => p.canvas)),
      pinOrder: pins.map((p) => p.canvas),
      opened,
      loaded,
      toggle,
    }),
    [pins, opened, loaded, toggle]
  );
}
