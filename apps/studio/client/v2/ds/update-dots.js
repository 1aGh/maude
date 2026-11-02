// client/v2/ds/update-dots.js — S10.8: the dots on a left-out canvas (13 · ds-edit-review: "it keeps Azure with a
// dot"). The Canvases row has its word (row-dots.js); inside the canvas the elements that wear what changed get a
// small dot. The studio only names the elements (`ds-update-dots {ids}`, dgn table); the canvas shell draws them.
//
// Which elements: the usage index already knows, per token and per master, the elements that use it in each
// canvas (S10.5, `elements`). A canvas left out of an update is missing exactly the tokens and masters that
// changed between its revision and head (update-model.js `diffRevisions`), so the ids are the union of those
// elements on THIS canvas, capped at DS_DOTS_MAX.

import { useEffect, useRef } from 'react';
import { DS_DOTS_MAX } from '../../../bridge/dgn-protocol.ts';
import { diffRevisions, leftOutOf, relOf } from './update-model.js';

export { DS_DOTS_MAX };
const ASK_CAP = 12; // distinct tokens / masters asked about: one request each

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** The element ids of `rel` that use something in `diff`, from the usage answers (pure). */
export function dotIdsOf(rel, answers) {
  const ids = new Set();
  for (const a of answers) {
    for (const c of a?.canvases ?? []) {
      if (c?.rel !== rel) continue;
      for (const e of c.elements ?? []) {
        if (typeof e?.id === 'string' && ID.test(e.id)) ids.add(e.id);
        if (ids.size >= DS_DOTS_MAX) return [...ids];
      }
    }
  }
  return [...ids];
}

/** Ask the usage index for what `diff` touches on `rel`. Resolves to the ids (empty on any failure). */
export async function loadDotIds({ ds, rel, diff }, fetchImpl = globalThis.fetch) {
  const asks = [
    ...new Set(diff.tokens.map((t) => `css=${encodeURIComponent(t.css)}`)),
    ...new Set(diff.components.map((c) => `component=${encodeURIComponent(c.component)}`)),
  ].slice(0, ASK_CAP);
  const answers = await Promise.all(
    asks.map(async (q) => {
      try {
        const r = await fetchImpl(`/_api/ds/usage?ds=${encodeURIComponent(ds)}&${q}`, {
          cache: 'no-store',
        });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    })
  );
  return dotIdsOf(rel, answers);
}

/**
 * Keep the ACTIVE canvas's dots right: left out of an update → its dots; anything else → none.
 * @param {{ cfg: any, activePath: string | null, revisionBody: (ds: string, rev: string) => Promise<any>,
 *           frameFor: () => HTMLIFrameElement | null, fetchImpl?: typeof fetch }} p
 */
export function useDsUpdateDots({ cfg, activePath, revisionBody, frameFor, fetchImpl }) {
  const live = useRef({ cfg, frameFor });
  live.current = { cfg, frameFor };
  const info = activePath ? leftOutOf(activePath, cfg) : null;
  const key = info
    ? `${activePath}|${info.ds}|${info.dsRev}|${info.head}`
    : `${activePath ?? ''}|-`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the canvas and the two ids
  useEffect(() => {
    let dead = false;
    const timers = [];
    // a canvas that is still loading has no listener yet: the same message again, idempotent
    const send = (ids) => {
      for (const ms of [0, 700, 2200])
        timers.push(
          setTimeout(() => {
            const win = dead ? null : live.current.frameFor()?.contentWindow;
            if (win)
              win.postMessage(
                { dgn: 'ds-update-dots', ids },
                live.current.cfg?.canvasOrigin || window.location.origin
              );
          }, ms)
        );
    };
    (async () => {
      if (!info) return send([]);
      const [a, b] = await Promise.all([
        revisionBody(info.ds, info.dsRev),
        revisionBody(info.ds, info.head),
      ]);
      if (dead || !a || !b) return;
      const ids = await loadDotIds(
        { ds: info.ds, rel: relOf(activePath, live.current.cfg), diff: diffRevisions(a, b) },
        fetchImpl ?? globalThis.fetch
      );
      if (!dead) send(ids);
    })();
    return () => {
      dead = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [key]);
}
