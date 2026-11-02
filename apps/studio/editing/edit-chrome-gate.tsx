/**
 * @file       editing/edit-chrome-gate.tsx — P8 C5 (04 md-preview / md-annotate / md-comment / md-inspect, R1)
 * @purpose    Edit's object chrome — the selection's name tag and handles, the artboard's eight handles + size tag,
 *             the rotate handle, corner dots, gap bands, the token ruler, the tab-order badges, the align bar… —
 *             is Edit's only. Preview / Viewing / Present draw the design, the annotation layer and pins (CONTRACT
 *             §2, the md-model table): the what-shows table's `object-tools` cell answers it (`modeShows`), and an
 *             ungoverned canvas keeps v1 (the tool provider's posture).
 *
 *             The gate HIDES (display:none on a `display:contents` wrapper) instead of unmounting, so the layers'
 *             listeners (F's size picker, ⌘D, the run-action lane) keep working whatever the mode.
 *
 *             And the handoff: leaving Edit drops the Edit selection, so neither the canvas halo nor the shell's
 *             Inspector carries an Edit pick into Preview (⌘-click there picks anew — Inspect).
 */

import { type ReactNode, useEffect, useRef } from 'react';
import type { CanvasModeV2 } from '../bridge/canvas-modes.ts';
import { modeShows } from '../bridge/mode-shows.ts';

/** Does the canvas draw Edit's object chrome? `governed` = the shell's mode (null = ungoverned). */
export function editChromeShown(
  governed: CanvasModeV2 | null,
  posture: 'edit' | 'preview' | null,
  embed = false
): boolean {
  if (embed) return false;
  if (governed) return modeShows(governed, 'object-tools');
  return posture === null || posture === 'edit';
}

export function EditChromeGate({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <div
      data-testid="edit-chrome"
      data-shown={shown ? 'true' : 'false'}
      style={{ display: shown ? 'contents' : 'none' }}
    >
      {children}
    </div>
  );
}

/** Leaving Edit (governed) clears the selection once, on the transition. */
export function useDropSelectionOnLeaveEdit(
  governed: CanvasModeV2 | null,
  clear: () => void
): void {
  const was = useRef(governed);
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    const prev = was.current;
    was.current = governed;
    if (!governed || prev === governed) return;
    const before = prev ? modeShows(prev, 'object-tools') : true;
    if (before && !modeShows(governed, 'object-tools')) clearRef.current();
  }, [governed]);
}
