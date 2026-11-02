// client/v2/ds/use-ds-search.js — S10.13: the boards ⌘K searches inside (client/v2/search/search-ds.js).
//
// A converted system's board model (`GET /_api/ds/board`, the same model the canvas and the inspector read) holds
// every token's label and value names and every component's label. It is read once the shell is idle, again when
// the window is looked at again, and when the systems change — never on a keystroke, so typing in ⌘K waits for
// nothing. An unconverted system has nothing to read and its one row needs no board.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchBoard } from './token-write.js';

const IDLE_MS = 1500;

/** @returns {{ name: string, label?: string, converted: boolean, board?: any }[]} */
export function useDsSearchSystems(cfg) {
  const systems = cfg?.designSystems;
  const converted = cfg?.dsConverted;
  const key = useMemo(
    () =>
      (Array.isArray(systems) ? systems : [])
        .map((d) => `${d.name}:${converted?.[d.name] === true ? 1 : 0}`)
        .join('|'),
    [systems, converted]
  );
  const [boards, setBoards] = useState({});
  const live = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the systems and what is converted
  useEffect(() => {
    const names = (Array.isArray(systems) ? systems : [])
      .filter((d) => converted?.[d.name] === true)
      .map((d) => d.name);
    if (names.length === 0) {
      setBoards({});
      return undefined;
    }
    const read = async () => {
      const n = ++live.current;
      const got = await Promise.all(names.map(async (name) => [name, await fetchBoard(name)]));
      if (n !== live.current) return;
      setBoards(Object.fromEntries(got.filter(([, b]) => b)));
    };
    const t = setTimeout(read, IDLE_MS);
    const look = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', look);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', look);
    };
  }, [key]);
  return useMemo(
    () =>
      (Array.isArray(systems) ? systems : []).map((d) => ({
        name: d.name,
        label: d.label,
        converted: converted?.[d.name] === true,
        board: boards[d.name],
      })),
    [systems, converted, boards]
  );
}
