// client/v2/canvases/use-canvas-index.js — S1.1: the project index (`GET /_api/index`, V2-1.17) for the
// Canvases panel — the project id, the design root, and per-canvas meta (artboard kinds, made by AI, cover).
//
// Re-read when the tree changes (`?since=<seq>` answers `{unchanged}` when nothing moved) and when the
// server says a canvas's content moved (`index-changed` over the socket, relayed by the shell as the window
// event below) — a trashed or added artboard changes no path, so the tree stamp alone never saw it (S1.23:
// the panel foot kept "21 artboards" after one was trashed). If the server has
// no index (an older server, a cloud tab that does not serve it) the panel is simply without badges.

import { useEffect, useRef, useState } from 'react';
import { fetchIfServed } from '../shell/served-routes.js';

/** The shell's relay of the socket's `index-changed { seq, rels }` (client/app.jsx). */
export const INDEX_CHANGED_EVENT = 'maude:index-changed';

export function useCanvasIndex({ stamp, fetchImpl } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    const on = () => setMoved((n) => n + 1);
    window.addEventListener(INDEX_CHANGED_EVENT, on);
    return () => window.removeEventListener(INDEX_CHANGED_EVENT, on);
  }, []);
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;
  const seq = useRef(0);
  // #204 R — ONE read at a time. A change that lands while a read is out asks once more after it (with
  // `?since=`), instead of dropping that answer and asking the whole index again: on boot the tree stamp
  // moves several times inside the first read, and each move used to discard it and ask anew (7 full reads
  // per load against a cell, where the route is withheld anyway — `fetchIfServed` no longer asks it there).
  const flight = useRef({ busy: false, again: false, alive: true });
  useEffect(() => {
    const f = flight.current;
    f.alive = true;
    return () => {
      f.alive = false;
    };
  }, []);
  const read = useRef(null);
  read.current ??= async () => {
    const f = flight.current;
    if (f.busy) {
      f.again = true;
      return;
    }
    f.busy = true;
    try {
      do {
        f.again = false;
        const url = seq.current ? `/_api/index?since=${seq.current}` : '/_api/index';
        const r = await fetchIfServed(url, { cache: 'no-store' }, fetchRef.current);
        if (!r.ok || !f.alive) break; // not here (or refused): asking again cannot help
        const data = await r.json();
        if (!f.alive) break;
        if (!data?.unchanged && Array.isArray(data?.canvases)) {
          seq.current = data.writer?.seq || 0;
          setSnapshot(data);
        }
      } while (f.again);
    } catch {
      /* no index: no badges */
    } finally {
      f.busy = false;
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` and `moved` are the "something changed" signals
  useEffect(() => {
    const t = setTimeout(() => read.current(), 200);
    return () => clearTimeout(t);
  }, [stamp, moved]);

  return snapshot;
}
