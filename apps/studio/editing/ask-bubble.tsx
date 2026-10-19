// editing/ask-bubble.tsx — ⌘/ on a selection, in place (S2.19; artboard `ed-edge-ask`, rule `ask-where-you-are`).
//
// The canvas's whole part is to say WHAT is selected and WHERE: it measures the selected elements and posts
// `ask-selection { refs, selection, rect }` (bridge/dgn-protocol.ts). The SHELL draws the bubble under that
// rect and owns the words — a canvas is the untrusted side (DDR-054), so a prompt never travels canvas →
// shell, and what the shell takes from this message can only narrow an ask (a scope), never send one.
//
//   ⌘/ (registry `ai.ask-selection`, canvas focus, Edit mode, an object selected)   → post
//   the shell's `run-action ai.ask-selection` (⌘K / the menu)                       → post
//
// Nothing is drawn here. The AI outline that follows the ask is `ai-scope-outline.tsx`.

import { useEffect, useRef } from 'react';

import { canvasKeyIndex, resolveCanvasKey } from '../actions/canvas-keys.ts';
import { canvasModeStore, canvasSingleKeys } from '../bridge/canvas-mode-store.ts';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { resolveSelectionEl } from '../dom-selection.ts';
import { isEditableTarget } from '../input-router.tsx';
import { isEmbedCanvas, isReadOnlyCanvas } from '../read-only-mode.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { refsOf } from './object-ops.ts';

export const ASK_SELECTION_ACTION = 'ai.ask-selection';
/** S2.21 — the artboard menu's “Ask AI about this artboard” row announces itself here: `detail: { artboardId }`. */
export const ASK_ARTBOARD_EVENT = 'maude:ask-artboard';
const KEYS = canvasKeyIndex([ASK_SELECTION_ACTION]);

type Box = { x: number; y: number; w: number; h: number };

/** The box that holds every rect (iframe viewport px, whole numbers), or null when none is visible. */
export function unionRect(
  rects: ReadonlyArray<Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>>
): Box | null {
  let l = Number.POSITIVE_INFINITY;
  let t = Number.POSITIVE_INFINITY;
  let r = Number.NEGATIVE_INFINITY;
  let b = Number.NEGATIVE_INFINITY;
  for (const x of rects) {
    if (!(x.right > x.left) || !(x.bottom > x.top)) continue;
    l = Math.min(l, x.left);
    t = Math.min(t, x.top);
    r = Math.max(r, x.right);
    b = Math.max(b, x.bottom);
  }
  if (!Number.isFinite(l)) return null;
  return { x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(b - t) };
}

/** What the prompt may say of a selected element: locators only, short (the shell sanitises again). */
export function locatorsOf(selected: readonly Selection[], max = 12) {
  return selected.slice(0, max).map((s) => ({
    ...(s.id ? { id: s.id.slice(0, 128) } : {}),
    ...(s.tag ? { tag: s.tag.slice(0, 24) } : {}),
    ...(s.text ? { text: s.text.slice(0, 120) } : {}),
    ...(s.selector ? { selector: s.selector.slice(0, 200) } : {}),
    ...(typeof s.index === 'number' ? { index: s.index } : {}),
  }));
}

/**
 * The `ask-selection` payload for the current selection, or null (nothing stamped is selected, or none of it is
 * on screen).
 */
export function askPayload(selected: readonly Selection[], doc: Document) {
  const refs = refsOf(selected);
  if (!refs.length) return null;
  const rects: DOMRect[] = [];
  for (const s of selected) {
    if (!s.id || !s.artboardId) continue;
    const el = resolveSelectionEl(doc, s);
    if (el?.isConnected) rects.push(el.getBoundingClientRect());
  }
  const rect = unionRect(rects);
  if (!rect) return null;
  return { refs, selection: locatorsOf(selected.filter((s) => s.id && s.artboardId)), rect };
}

/**
 * S2.21 — the `ask-selection` payload for a whole artboard: no elements, the artboard's id, and where it is on
 * screen. The shell turns it into an `artboards` scope for the same bubble; null when the artboard is not here.
 */
export function askArtboardPayload(artboardId: string, doc: Document) {
  const el = doc.querySelector(`[data-dc-screen="${CSS.escape(artboardId)}"]`);
  const rect = el?.isConnected ? unionRect([el.getBoundingClientRect()]) : null;
  return rect ? { refs: [], artboard: artboardId, rect } : null;
}

export function AskBubble({ readOnly }: { readOnly: boolean }): null {
  const { selected } = useSelectionSet();
  const selRef = useRef(selected);
  selRef.current = selected;
  const tool = useToolModeOptional()?.tool;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const ask = () => {
      if (readOnly || isReadOnlyCanvas() || isEmbedCanvas()) return;
      const payload = askPayload(selRef.current, document);
      if (!payload || window.parent === window) return;
      // A literal `{ dgn }` (not postToShell) so the bridge inventory sees this send site.
      try {
        window.parent.postMessage({ dgn: 'ask-selection', ...payload }, '*');
      } catch {
        /* detached */
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || readOnly || toolRef.current === 'browse') return;
      const id = resolveCanvasKey(
        KEYS,
        e,
        isEditableTarget(e.target),
        canvasModeStore(window).get().mode ?? 'edit',
        canvasSingleKeys(),
        refsOf(selRef.current).length > 0 ? 'object' : 'none'
      );
      if (id !== ASK_SELECTION_ACTION) return;
      e.preventDefault();
      ask();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'run-action')
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn === 'run-action' && m.id === ASK_SELECTION_ACTION) ask();
    };
    const onAskArtboard = (e: Event) => {
      if (readOnly || isReadOnlyCanvas() || isEmbedCanvas()) return;
      const id = (e as CustomEvent<{ artboardId?: unknown }>).detail?.artboardId;
      if (typeof id !== 'string' || window.parent === window) return;
      const payload = askArtboardPayload(id, document);
      if (!payload) return;
      try {
        window.parent.postMessage({ dgn: 'ask-selection', ...payload }, '*');
      } catch {
        /* detached */
      }
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    window.addEventListener(ASK_ARTBOARD_EVENT, onAskArtboard);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
      window.removeEventListener(ASK_ARTBOARD_EVENT, onAskArtboard);
    };
  }, [readOnly]);

  return null;
}
