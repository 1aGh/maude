// comment-reattach.ts — "Re-attach to element" (#151 §5, T2.3 D5), the two halves of one gesture.
//
// A thread whose anchor no longer finds its element (an edit moved the id, the element was never
// instrumented) can be pointed at another one. The thread card (comments-overlay.tsx) asks for it;
// the comment mount (canvas-comment-mount.tsx), which owns the canvas click, takes the next
// comment-tool click as the new anchor instead of opening a composer; the overlay then sends the
// `reattach` op (comments/ops.ts) through the same door every other op uses.
//
// Three document events carry it, so neither side imports the other:
//   cm:reattach-start   { id }                          overlay → mount   (arm; the mount picks the comment tool)
//   cm:reattach         { id, selection, clientX/Y }    mount → overlay   (the click that names the element)
//   cm:reattach-cancel  {}                              either side       (Esc, a closed thread)

import type { WorldPoint } from './comment-anchor.ts';

export const REATTACH_START = 'cm:reattach-start';
export const REATTACH_PICK = 'cm:reattach';
export const REATTACH_CANCEL = 'cm:reattach-cancel';

/** The slice of a comment selection (dom-selection.ts `Selection`) an anchor is made of. */
export interface ReattachSelection {
  selector: string;
  index?: number;
  dom_path?: string[];
  tag?: string;
  classes?: string;
  bounds?: { x: number; y: number; w: number; h: number } | null;
  html?: string;
  artboardId?: string | null;
  annotationId?: string;
  world?: WorldPoint;
}

export interface ReattachPick {
  id: string;
  selection: ReattachSelection;
  clientX: number;
  clientY: number;
}

let pending: string | null = null;

/** The thread waiting for its next element click, or null. */
export function pendingReattach(): string | null {
  return pending;
}

function fire(type: string, detail: unknown): void {
  if (typeof document === 'undefined') return;
  try {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  } catch {
    /* CustomEvent absent — nothing to tell */
  }
}

/** Overlay → mount: the next element click re-attaches thread `id`. */
export function requestReattach(id: string): void {
  fire(REATTACH_START, { id });
}

/** Either side: stop waiting. */
export function cancelReattach(): void {
  // Always told: the two halves may be separate bundles, so this side cannot know what the other waits for.
  pending = null;
  fire(REATTACH_CANCEL, {});
}

/**
 * Mount side: listen for a start, keep the pending id, and run `arm` (pick the comment tool).
 * `onCancel` runs when the wait ends without a pick. Returns the disposer.
 */
export function listenForReattach(arm: () => void, onCancel: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const onStart = (e: Event) => {
    const id = (e as CustomEvent<{ id?: unknown }>).detail?.id;
    if (typeof id !== 'string' || !id) return;
    pending = id;
    arm();
  };
  const onStop = () => {
    pending = null;
    onCancel();
  };
  document.addEventListener(REATTACH_START, onStart);
  document.addEventListener(REATTACH_CANCEL, onStop);
  return () => {
    document.removeEventListener(REATTACH_START, onStart);
    document.removeEventListener(REATTACH_CANCEL, onStop);
    pending = null;
  };
}

/**
 * Mount side: the click that names the element. Returns true when a re-attach was waiting and took
 * the click (the caller must NOT open a composer), false when none was.
 */
export function pickForReattach(
  selection: ReattachSelection,
  clientX: number,
  clientY: number
): boolean {
  const id = pending;
  if (id === null) return false;
  pending = null;
  fire(REATTACH_PICK, { id, selection, clientX, clientY } satisfies ReattachPick);
  return true;
}

/** Overlay side: listen for the pick. Returns the disposer. */
export function listenForReattachPick(
  onPick: (pick: ReattachPick) => void,
  onCancel: () => void
): () => void {
  if (typeof document === 'undefined') return () => {};
  const onEvent = (e: Event) => {
    const d = (e as CustomEvent<Partial<ReattachPick>>).detail;
    if (!d || typeof d.id !== 'string' || !d.selection || typeof d.selection.selector !== 'string')
      return;
    onPick(d as ReattachPick);
  };
  document.addEventListener(REATTACH_PICK, onEvent);
  document.addEventListener(REATTACH_CANCEL, onCancel);
  return () => {
    document.removeEventListener(REATTACH_PICK, onEvent);
    document.removeEventListener(REATTACH_CANCEL, onCancel);
  };
}

/** The `reattach` comment op for a pick. `anchors.artboard` is where the click landed (anchorsAt). */
export function reattachOpFor(
  id: string,
  sel: ReattachSelection,
  anchors: { artboard?: string } = {}
): Record<string, unknown> {
  return {
    op: 'reattach',
    id,
    selector: sel.selector,
    index: sel.index,
    dom_path: sel.dom_path,
    tag: sel.tag,
    classes: sel.classes,
    bounds: sel.bounds,
    html_excerpt: sel.html,
    ...(sel.world ? { world: sel.world } : {}),
    ...(anchors.artboard ? { artboard: anchors.artboard } : {}),
  };
}
