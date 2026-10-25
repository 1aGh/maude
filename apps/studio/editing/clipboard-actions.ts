// editing/clipboard-actions.ts — the canvas wiring of V2-clipboard-objects: one hook the editing layer
// (chords, `run-action`, the native paste) and the two context menus share, so every entry runs the same
// `runClipAction` with the same toast, undo record and re-selection.

import { useMemo, useRef } from 'react';
import { useDragStateContext } from '../canvas-lib.tsx';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { ElementRef } from '../edit-ops/types.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { selectWhenRendered as selectBoardsWhenRendered } from './artboard-actions.ts';
import {
  type ClipAction,
  type ClipCtx,
  type ClipDeps,
  runClipAction,
  writeClipMarker,
} from './clipboard.ts';
import { selectWhenRendered as selectObjectsWhenRendered } from './object-actions.ts';
import { refsOf } from './object-ops.ts';

/** The selection as the clipboard reads it: stamped objects, else whole artboards. */
export function clipCtxOf(selected: readonly Selection[]): ClipCtx {
  const objects = refsOf(selected);
  const artboards = selected.filter((s) => !s.id && s.artboardId).map((s) => String(s.artboardId));
  return { objects, artboards };
}

/** Where pasted artboards land: right of the rightmost board, on the anchor's line, at the row gap. */
export function pasteSpot(
  boards: ReadonlyArray<{ id: string; x: number; y: number; w: number }>,
  anchor: string | undefined,
  gap = 80
): { x: number; y: number } | undefined {
  if (boards.length === 0) return undefined;
  const right = Math.max(...boards.map((b) => b.x + b.w));
  const line = boards.find((b) => b.id === anchor) ?? boards[0];
  return { x: Math.round(right + gap), y: Math.round(line?.y ?? 0) };
}

export interface Clipboard {
  run(action: ClipAction, ctx?: Partial<ClipCtx>): Promise<void>;
}

export function useClipboard(): Clipboard {
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const bus = useDragStateContext();
  const live = useRef({ selSet, undo, bus });
  live.current = { selSet, undo, bus };
  return useMemo<Clipboard>(() => {
    const deps: ClipDeps = {
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => live.current.undo?.record(rec),
      select: (created: ElementRef[], kind) => {
        const replace = (s: Selection[]) => live.current.selSet.replace(s);
        if (kind === 'artboards')
          selectBoardsWhenRendered(
            created.map((r) => r.artboard),
            replace
          );
        else selectObjectsWhenRendered(created, replace);
      },
      mark: writeClipMarker,
    };
    return {
      async run(action, over) {
        const base = clipCtxOf(live.current.selSet.selected);
        const ctx: ClipCtx = {
          objects: over?.objects ?? base.objects,
          artboards: over?.artboards ?? base.artboards,
        };
        if (action === 'canvas.paste' && !ctx.objects.length) {
          const boards = live.current.bus?.layoutRects() ?? [];
          const at = pasteSpot(boards, ctx.artboards[0]);
          if (at) ctx.at = at;
        }
        await runClipAction(action, ctx, deps);
      },
    };
  }, []);
}
