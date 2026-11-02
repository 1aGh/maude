// editing/image-drop.tsx — a tile from the Assets tab dropped on the canvas (S2.15; artboard ed-img: "drop a photo on a frame").
//
// r3 — the SHELL owns the drag. WebKit (the app, Safari) gives the canvas origin no event of a drag the shell started, so
// the shell lays a catcher over this frame (client/v2/assets/canvas-drop-catcher.jsx) and tells the canvas where the
// pointer is: `asset-drag-over {x, y}` → the thing it would land on wears a ring — a picture (its source is swapped, its
// box kept), a frame (the picture fills it, cropped to fit — `object-fit: cover`), or the artboard (placed loose, at its
// size, in the flow). On drop the shell asks `asset-drop-at {x, y}`; the canvas answers WHAT lies there
// (`asset-drop-target`, never an asset) and the shell runs ONE `image.place` with the path it started dragging;
// `asset-drop-done` comes back so the new picture is selected (or the refusal said in one line).
//
// A Finder file is not handled here: that is the asset import's (S8.14), which ends in the same op.

import { useEffect, useRef, useState } from 'react';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import {
  type AssetDropTarget,
  acceptFromShell,
  type ShellToCanvasMessage,
} from '../bridge/dgn-protocol.ts';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import type { AssetDrag } from './asset-drag.ts';
import { containerAt } from './draw-tools.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement, selectWhenRendered } from './object-actions.ts';
import { isLockedDom } from './selection.tsx';

export const PLACE_ACTION = 'image.place' as const;
export const LOCKED_LINE = 'That is locked. Unlock it to put a picture on it.';

export interface DropTarget {
  kind: 'picture' | 'frame' | 'artboard';
  el: HTMLElement;
  /** null for the artboard (it is named by `artboard`) */
  ref: ElementRef | null;
  artboard: string;
}

/** What a drop at (x, y) would land on: the picture under it, else the frame, else the artboard; null off every artboard. */
export function dropTargetAt(doc: Document, x: number, y: number): DropTarget | null {
  const hit = doc.elementsFromPoint(x, y)[0];
  const pic = hit?.closest('img[data-cd-id]');
  if (pic?.closest('.dc-artboard-body')) {
    const ref = refOfElement(pic);
    if (ref) return { kind: 'picture', el: pic as HTMLElement, ref, artboard: ref.artboard };
  }
  const c = containerAt(doc, x, y);
  if (!c) return null;
  if (!c.frame) return { kind: 'artboard', el: c.el, ref: null, artboard: c.artboard };
  const ref = refOfElement(c.el);
  return ref ? { kind: 'frame', el: c.el, ref, artboard: c.artboard } : null;
}

/** The `image.place` ask for a drop on `target`. */
export function askForDrop(drag: AssetDrag, target: DropTarget): EditOpAsk {
  const params: Record<string, unknown> = {
    asset: drag.asset,
    mode: target.kind === 'artboard' ? 'loose' : 'fill',
  };
  if (target.kind === 'artboard') params.artboard = target.artboard;
  if (target.kind === 'artboard' && drag.w && drag.h) params.natural = { w: drag.w, h: drag.h };
  return { op: PLACE_ACTION, targets: target.ref ? [target.ref] : [], params };
}

/** What the canvas tells the shell a drop at (x, y) lands on — kind and ref only; null when nothing may take it. */
export function dropTargetMessage(t: DropTarget | null): AssetDropTarget | null {
  if (!t || isLockedDom(t.el)) return null;
  if (t.kind === 'artboard') return { kind: 'artboard', artboard: t.artboard };
  if (!t.ref) return null;
  return {
    kind: t.kind,
    artboard: t.ref.artboard,
    element: t.ref.element,
    ...(t.ref.occurrence && t.ref.occurrence > 0 ? { occurrence: t.ref.occurrence } : {}),
  };
}

export interface DropDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: NonNullable<ReturnType<typeof editOpRecord>>) => void;
  select?: (refs: ElementRef[]) => void;
}

/** One drop: ask, say a refusal in one line, record ONE undo step, select what was placed. */
export async function runDrop(ask: EditOpAsk, deps: DropDeps = {}): Promise<EditOpResult> {
  const run = deps.run ?? ((a: EditOpAsk) => runEditOp(a));
  const result = await run(ask);
  if (!result.ok) {
    deps.toast?.(result.message, 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    const rec = editOpRecord(result.writeId, 'Place picture');
    if (rec) deps.record?.(rec);
  }
  if (result.created?.length) deps.select?.(result.created);
  return result;
}

const CSS_TEXT = `
.ed-drop-ring {
  position: fixed;
  z-index: 6;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px solid var(--maude-hud-accent, #4a7bff);
  background: color-mix(in oklab, var(--maude-hud-accent, #4a7bff) 12%, transparent);
  border-radius: 2px;
}
.ed-drop-ring[data-kind="artboard"] { border-style: dashed; background: transparent; }
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-drop-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-drop-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

interface Ring {
  kind: DropTarget['kind'];
  left: number;
  top: number;
  w: number;
  h: number;
}

export function ImageDrop({ readOnly }: { readOnly?: boolean }) {
  ensureStyles();
  const selSet = useSelectionSet();
  const live = useRef({ selSet });
  live.current = { selSet };
  const [ring, setRing] = useState<Ring | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || readOnly) return undefined;
    const clear = () => setRing(null);
    const ringAt = (x: number, y: number) => {
      const t = isReadOnlyCanvas() ? null : dropTargetAt(document, x, y);
      if (!t || isLockedDom(t.el)) return clear();
      const r = t.el.getBoundingClientRect();
      setRing({ kind: t.kind, left: r.left, top: r.top, w: r.width, h: r.height });
    };
    const onMessage = (e: MessageEvent) => {
      // only the shell says these (a sibling canvas frame shares this origin, DDR-054)
      if (e.source !== window.parent) return;
      const type = (e.data as { dgn?: unknown } | null)?.dgn;
      if (type !== 'asset-drag-over' && type !== 'asset-drop-at' && type !== 'asset-drop-done')
        return;
      const m: ShellToCanvasMessage | null = acceptFromShell(e, window);
      if (!m) return;
      if (m.dgn === 'asset-drag-over') {
        // r4 #2 — in Preview the drop becomes an annotation picture (annotations-layer): no frame ring
        if (
          m.x === null ||
          typeof m.y !== 'number' ||
          canvasModeStore(window).get().mode === 'preview'
        )
          clear();
        else ringAt(m.x, m.y);
      } else if (m.dgn === 'asset-drop-at') {
        clear();
        const t = isReadOnlyCanvas() ? null : dropTargetAt(document, m.x, m.y);
        if (t && isLockedDom(t.el)) showCanvasToast(LOCKED_LINE, 'info');
        window.parent.postMessage(
          { dgn: 'asset-drop-target', requestId: m.requestId, target: dropTargetMessage(t) },
          '*'
        );
      } else if (m.dgn === 'asset-drop-done') {
        if (!m.ok) showCanvasToast(m.message ?? 'Not placed; try again.', 'error');
        else if (m.created?.length)
          selectWhenRendered(m.created, (sel: Selection[]) => live.current.selSet.replace(sel));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [readOnly]);

  if (!ring) return null;
  return (
    <i
      className="ed-drop-ring"
      data-testid="edit-drop-target"
      data-kind={ring.kind}
      aria-hidden="true"
      style={{ left: ring.left, top: ring.top, width: ring.w, height: ring.h }}
    />
  );
}
