// client/v2/shell/held-conflict.js — p8-held-conflict-status: the one-time toast for a held source conflict.
//
// While a held source conflict waits (this Mac kept its copy; the project's version is in
// `_history/<slug>/sync-recovery/`), the Share cluster says Not saved · Compare (save-status.js). Once per
// conflict — not per render, not per status push — a toast says "<canvas> differs from the project" with the
// same Compare. A conflict is its notice: `{ slug, at }` (sync-details-model `heldConflicts`), so the same
// canvas conflicting again later (a new notice) is a new conflict and toasts again.

import { useEffect } from 'react';
import { cleanName } from '../diagnostics/sync-details/sync-details-model.js';
import { COMPARE } from './save-status.js';

// Per page, not per mount: the cluster can remount (a layout change, Preview) without the toast coming back.
const toasted = new Set();
const keyOf = (c) => `${c.slug}@${c.at ?? 0}`;

/** Tests only — forget which conflicts were told. */
export function resetHeldConflictToasts() {
  toasted.clear();
}

/** The toast's words (CONTRACT voice: say what is true, one action). */
export function heldConflictToast({ slug, name, onCompare }) {
  return {
    id: `held-conflict-${slug}`,
    title: `${cleanName(name || slug, 'This canvas')} differs from the project`,
    kind: 'warning',
    action: { label: COMPARE.label, onClick: () => onCompare?.(slug) },
  };
}

/**
 * Toast each held conflict once.
 * @param held     `heldConflicts(syncStatus)` — `[{ slug, at }]`
 * @param names    slug → the name a person knows the canvas by (`canvasNamesBySlug`), or null
 * @param onCompare (slug) => void — what the status's Compare does
 * @param toast    the notice primitive (`notify`)
 */
export function useHeldConflictToast({ held, names, onCompare, toast }) {
  const list = Array.isArray(held) ? held : [];
  const key = list.map(keyOf).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the identity of `held`
  useEffect(() => {
    for (const c of list) {
      const k = keyOf(c);
      if (toasted.has(k)) continue;
      toasted.add(k);
      toast?.(heldConflictToast({ slug: c.slug, name: names?.get?.(c.slug), onCompare }));
    }
  }, [key]);
}
