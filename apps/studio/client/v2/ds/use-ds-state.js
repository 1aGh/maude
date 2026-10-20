// client/v2/ds/use-ds-state.js — S10.13: what the pinned rows need to know about each system beyond the tree:
// its name for people (`label`) and how far it is from the schema (`level`, `reasons`) — the amber dot.
// One read of `GET /_api/ds/state` (maude.ds-state/1, S10.3), again whenever `stamp` changes (the tree
// reloaded) after a pause, and when the window is looked at again. A project without a system asks nothing.

import { useEffect, useRef, useState } from 'react';

const PAUSE_MS = 600;

/** `{ [system]: { label, level, reasons, converted } }` from a maude.ds-state/1 body. */
export function stateByName(body) {
  const out = {};
  if (body?.format !== 'maude.ds-state' || !Array.isArray(body.systems)) return out;
  for (const s of body.systems) {
    if (!s || typeof s.name !== 'string') continue;
    out[s.name] = {
      label: typeof s.label === 'string' && s.label ? s.label : null,
      level: typeof s.level === 'number' ? s.level : null,
      reasons: Array.isArray(s.reasons) ? s.reasons.filter((r) => typeof r === 'string') : [],
      converted: s.converted === true,
    };
  }
  return out;
}

export async function fetchDsState(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/_api/ds/state', { cache: 'no-store' });
    if (!res.ok) return null;
    return stateByName(await res.json());
  } catch {
    return null;
  }
}

/** @param {{ enabled: boolean, stamp?: unknown }} a */
export function useDsState({ enabled, stamp }) {
  const [state, setState] = useState({});
  const live = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the trigger
  useEffect(() => {
    if (!enabled) return undefined;
    const read = async () => {
      const n = ++live.current;
      const next = await fetchDsState();
      if (next && n === live.current) setState(next);
    };
    const t = setTimeout(read, PAUSE_MS);
    const look = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', look);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', look);
    };
  }, [enabled, stamp]);
  return state;
}
