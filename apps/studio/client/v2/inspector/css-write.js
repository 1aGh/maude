// client/v2/inspector/css-write.js — S2.3: the write lane every inspector section shares.
//
// A section hands it a CSS patch ({ prop: value | null }, the shape edit-ops/words-css.ts produces) and it does
// what the v1 knobs do for one property, for each property that actually changes:
//   · nudges the live element (`onOptimistic`) and the panel's own overlay, so the value shows before the reload,
//   · POSTs the existing /_api/edit-css (value, or `reset: true` for null),
//   · records the undo entry from what the server says it replaced (`previous`), in edit order.
// The chain is one per page, not one per section: the file lock serialises the writes anyway, and one order of
// undo records is what ⌘Z needs. A failed write records nothing and takes its overlay value back.
//
// (S2.1's /_api/edit-op will replace the N-posts-for-N-properties with one write per words edit; sections call
// `write(patch)` either way, so nothing here is a section's business.)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { diffPatch } from '../../../edit-ops/words-css.ts';
import { trackRecordableWrite } from '../../inspector/css-knobs.jsx';

let chain = Promise.resolve();

async function post(payload) {
  try {
    const res = await fetch('/_api/edit-css', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    return res.ok && j?.ok ? j : null;
  } catch {
    return null;
  }
}

/**
 * @param {any} el   the selected element (the panel's selection payload)
 * @param {{ onOptimistic?: Function, onRecordEdit?: Function, editable?: boolean }} ctx
 * @returns {{ css: Record<string,string>, editable: boolean, parent: { display?: string, flexDirection?: string }, write: (patch: Record<string, string|null>) => void }}
 */
export function useCssWrite(el, ctx) {
  const editable = !!el?.id && ctx?.editable !== false;
  // an optimistic overlay over the authored map; `null` marks a removed key. A fresh payload (a reselect, a
  // teammate's change) drops it: the canvas re-posts the source as it is now.
  const [overlay, setOverlay] = useState({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on a fresh selection payload only
  useEffect(() => setOverlay({}), [el?.id, el?.authored]);

  const css = useMemo(() => {
    const out = { ...(el?.authored || {}) };
    for (const [k, v] of Object.entries(overlay)) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
    return out;
  }, [el?.authored, overlay]);

  const parent = useMemo(
    () => ({ display: el?.parentDisplay, flexDirection: el?.parentFlexDirection }),
    [el?.parentDisplay, el?.parentFlexDirection]
  );

  const write = useCallback(
    (patch) => {
      if (!editable) return;
      const changes = diffPatch(css, patch);
      const file = el.file;
      for (const [prop, value] of Object.entries(changes)) {
        const before = css[prop] ?? null;
        ctx?.onOptimistic?.({
          id: el.id,
          artboardId: el.artboardId ?? null,
          index: el.index ?? 0,
          prop,
          value,
        });
        setOverlay((o) => ({ ...o, [prop]: value }));
        const payload =
          value === null
            ? { canvas: file, id: el.id, property: prop, reset: true }
            : { canvas: file, id: el.id, property: prop, value };
        chain = trackRecordableWrite(
          chain.then(async () => {
            const j = await post(payload);
            if (!j) {
              // nothing was written: show what the file says again
              setOverlay((o) => {
                const next = { ...o };
                delete next[prop];
                return next;
              });
              return;
            }
            const prev = Object.hasOwn(j, 'previous') ? j.previous : before;
            if ((prev ?? null) === (value ?? null)) return; // nothing changed to undo
            ctx?.onRecordEdit?.({
              op: 'css',
              canvas: file,
              id: el.id,
              key: prop,
              before: prev == null || prev === '' ? null : prev,
              after: value == null || value === '' ? null : value,
            });
          })
        );
      }
    },
    [css, editable, el, ctx]
  );

  return { css, editable, parent, write };
}
