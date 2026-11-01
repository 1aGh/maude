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
// S2.4: the target may be several objects. One write goes to every one of them ("Changes go to all 3."); `cssAll`
// carries one declaration map per object so a section can show the shared value or "Mixed".
//
// (S2.1's /_api/edit-op will replace the N-posts-for-N-properties with one write per words edit; sections call
// `write(patch)` either way, so nothing here is a section's business.)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const keyOf = (t) => `${t?.id ?? ''}#${t?.index ?? 0}`;

/**
 * @param {any} target  the selected element, or several (the panel's selection payloads)
 * @param {{ onOptimistic?: Function, onRecordEdit?: Function, editable?: boolean }} ctx
 * @returns {{ css: Record<string,string>, cssAll: Array<Record<string,string>>, count: number, editable: boolean, parent: { display?: string, flexDirection?: string }, write: (patch: Record<string, string|null>) => void, live: (toPatch: (n: number) => Record<string, string|null> | null) => { onInput: (n: number) => void, onCancel: () => void } }}
 *   `css` is the first object's declarations (what a single selection reads).
 *   `live(toPatch)` is the scrub-to-change preview for a NumberField: while the person drags, the live element on the
 *   canvas follows (no POST, no undo record); Esc puts it back; the release commits through `write` once.
 */
export function useCssWrite(target, ctx) {
  const targets = useMemo(
    () => (Array.isArray(target) ? target : target ? [target] : []),
    [target]
  );
  const el = targets[0];
  const editable = targets.length > 0 && targets.every((t) => !!t?.id) && ctx?.editable !== false;
  // an optimistic overlay over the authored map; `null` marks a removed key. Every write carries the same value to
  // every object, so one overlay serves them all. A fresh payload (a reselect, a teammate's change) drops it: the
  // canvas re-posts the source as it is now.
  const [overlay, setOverlay] = useState({});
  const fresh = `${targets.map(keyOf).join('|')}~${JSON.stringify(targets.map((t) => t?.authored ?? null))}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on a fresh selection payload only
  useEffect(() => setOverlay({}), [fresh]);

  const cssAll = useMemo(
    () =>
      targets.map((t) => {
        const out = { ...(t?.authored || {}) };
        for (const [k, v] of Object.entries(overlay)) {
          if (v === null) delete out[k];
          else out[k] = v;
        }
        return out;
      }),
    [targets, overlay]
  );
  const css = cssAll[0] ?? {};

  const parent = useMemo(
    () => ({ display: el?.parentDisplay, flexDirection: el?.parentFlexDirection }),
    [el?.parentDisplay, el?.parentFlexDirection]
  );

  // the scrub preview: the live element only — nothing is written until the drag is released (then `write` runs once)
  const previewed = useRef(new Set());
  const preview = useCallback(
    (patch) => {
      if (!editable || !patch) return;
      // removals before sets, like `write` below (a linked corner radius removes its per-corner longhands)
      const keys = Object.keys(patch).sort(
        (a, b) => Number((patch[a] ?? null) !== null) - Number((patch[b] ?? null) !== null)
      );
      for (const prop of keys) {
        const value = patch[prop] ?? null;
        previewed.current.add(prop);
        for (const t of targets) {
          ctx?.onOptimistic?.({
            id: t.id,
            artboardId: t.artboardId ?? null,
            index: t.index ?? 0,
            prop,
            value,
          });
        }
      }
    },
    [editable, targets, ctx]
  );
  const revert = useCallback(() => {
    targets.forEach((t, i) => {
      for (const prop of previewed.current) {
        ctx?.onOptimistic?.({
          id: t.id,
          artboardId: t.artboardId ?? null,
          index: t.index ?? 0,
          prop,
          value: cssAll[i]?.[prop] ?? null,
        });
      }
    });
    previewed.current.clear();
  }, [targets, cssAll, ctx]);
  const live = useCallback(
    (toPatch) => ({ onInput: (n) => preview(toPatch(n)), onCancel: revert }),
    [preview, revert]
  );

  const write = useCallback(
    (patch) => {
      if (!editable) return;
      previewed.current.clear();
      // the properties that change for at least one object — removals FIRST, then the sets, each in patch order.
      // The live preview is plain CSSOM, where removing a longhand clears that part of a shorthand that was set
      // before it: `background: blue` then `remove background-color` leaves the object white (and a corner radius
      // then loses a corner), with the reload that would repair it suppressed. Removed-then-set is right for every
      // pair: a shorthand set after its longhands' removal keeps all of itself, and a longhand set after its
      // shorthand's removal survives. The source is a plain object, so it ends the same either way.
      const props = Object.keys(patch)
        .filter((prop) => cssAll.some((c) => prop in diffPatch(c, { [prop]: patch[prop] })))
        .sort((a, b) => Number((patch[a] ?? null) !== null) - Number((patch[b] ?? null) !== null));
      for (const prop of props) {
        const value = patch[prop] ?? null;
        setOverlay((o) => ({ ...o, [prop]: value }));
        targets.forEach((t, i) => {
          if (!(prop in diffPatch(cssAll[i], { [prop]: value }))) return; // already there
          const before = cssAll[i][prop] ?? null;
          ctx?.onOptimistic?.({
            id: t.id,
            artboardId: t.artboardId ?? null,
            index: t.index ?? 0,
            prop,
            value,
          });
          const file = t.file;
          const payload =
            value === null
              ? { canvas: file, id: t.id, property: prop, reset: true }
              : { canvas: file, id: t.id, property: prop, value };
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
                id: t.id,
                key: prop,
                before: prev == null || prev === '' ? null : prev,
                after: value == null || value === '' ? null : value,
              });
            })
          );
        });
      }
    },
    [cssAll, editable, targets, ctx]
  );

  return { css, cssAll, count: targets.length, editable, parent, write, live };
}
