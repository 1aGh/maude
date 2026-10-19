// editing/image-drop.tsx — a tile from the Assets tab dropped on the canvas (S2.15; artboard ed-img: "drop a photo on a frame").
//
// The tile (shell, client/v2/assets/tile-drag.js) carries `{asset, w?, h?}` under its own MIME type (editing/asset-drag.ts).
// While it is over the canvas the thing it would land on wears a ring: a picture (its source is swapped, its box kept), a
// frame (the picture fills it, cropped to fit — `object-fit: cover`), or the artboard (placed loose, at its size, in the
// flow). A drop is ONE `image.place` edit-op: one write, one undo step; the new picture is selected.
//
// A Finder file is not handled here: that is the asset import's (S8.14), which ends in the same op.
// The payload is never trusted: it is a path, and the server checks it against `assets/<flat name>`.

import { useEffect, useRef, useState } from 'react';

import { showCanvasToast } from '../canvas-notifications.tsx';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { ASSET_DRAG_MIME, type AssetDrag, dragHasAsset, parseAssetDrag } from './asset-drag.ts';
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
  const undo = useUndoStackOptional();
  const live = useRef({ selSet, undo });
  live.current = { selSet, undo };
  const [ring, setRing] = useState<Ring | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined' || readOnly) return undefined;
    const clear = () => setRing(null);
    const over = (e: DragEvent) => {
      if (isReadOnlyCanvas() || !dragHasAsset(e.dataTransfer?.types)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      const t = dropTargetAt(document, e.clientX, e.clientY);
      if (!t || isLockedDom(t.el)) return clear();
      const r = t.el.getBoundingClientRect();
      setRing({ kind: t.kind, left: r.left, top: r.top, w: r.width, h: r.height });
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget == null) clear();
    };
    const drop = (e: DragEvent) => {
      clear();
      if (isReadOnlyCanvas() || !dragHasAsset(e.dataTransfer?.types)) return;
      e.preventDefault();
      e.stopPropagation();
      const drag = parseAssetDrag(e.dataTransfer?.getData(ASSET_DRAG_MIME));
      if (!drag) return;
      const t = dropTargetAt(document, e.clientX, e.clientY);
      if (!t) return;
      if (isLockedDom(t.el)) return void showCanvasToast(LOCKED_LINE, 'info');
      void runDrop(askForDrop(drag, t), {
        toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
        record: (rec) => live.current.undo?.record(rec),
        select: (refs) =>
          selectWhenRendered(refs, (s: Selection[]) => live.current.selSet.replace(s)),
      });
    };
    document.addEventListener('dragover', over, true);
    document.addEventListener('dragleave', leave, true);
    document.addEventListener('drop', drop, true);
    return () => {
      document.removeEventListener('dragover', over, true);
      document.removeEventListener('dragleave', leave, true);
      document.removeEventListener('drop', drop, true);
    };
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
