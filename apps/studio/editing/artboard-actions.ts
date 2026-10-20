// editing/artboard-actions.ts — the canvas half of S2.10: ⌘D, "Duplicate at another width", the ⌥-drag drop
// and "Reset position" (14 Editing: ed-ab-menu). One hook, `useArtboardActions()`, used by the editing
// layer (the chord, the shell's `run-action`, the drop) and by the artboard's context menu, so the menu
// row, the chord and ⌘K run the same function.
//
//   duplicate           artboard.duplicate: a copy to the right at the row's gap (duplicate-rhythm.ts), selected
//   duplicateAtWidth    artboard.duplicate-at-width: the same, at Laptop / Tablet / Mobile / a custom width
//   duplicateOnDrop     an ⌥-drag: a copy at each drop place; the originals stay
//   resetPosition       the board goes back to its default-grid slot (the layout lane, riders ride along)
//
// Every write is ONE edit-op request (`runEditOp`): the copy's source, its id and label and its place in the
// layout lane land together. On a legacy link the write pushes ONE revert record (S2-edit-ops.md §5).

import { useMemo, useRef } from 'react';
import { synthDefaultGrid, useDragStateContext } from '../canvas-lib.tsx';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { ContextTarget } from '../context-menu.tsx';
import type { EditOpResult } from '../edit-ops/types.ts';
import type { CommandRecord } from '../undo-stack.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import type { ArtboardMenuDeps } from './artboard-menu.tsx';
import { type Box, copyPlaces, dropPlaces, pinsFor } from './duplicate-rhythm.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { requestRename } from './rename-order.ts';

/** The window event that opens the "Custom width…" field next to the pointer. */
export const CUSTOM_WIDTH_EVENT = 'maude:artboard-custom-width';
/** At most this many other boards are pinned in one request (the body is capped at 64 KiB). */
const MAX_PINS = 600;

export const DUPLICATE_LABEL = 'Duplicate artboard';

export interface ArtboardActionDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
  /** select the copies once the canvas shows them */
  select?: (ids: string[]) => void;
  /** the committed layout (world px) */
  boards: () => Box[];
}

/** `{ artboard, at }` for every board to copy, → the request, → the toast / record / selection. */
export async function writeCopies(
  places: ReadonlyArray<{ artboard: string; at: { x: number; y: number }; width?: number }>,
  deps: ArtboardActionDeps,
  width?: number
): Promise<EditOpResult | null> {
  if (places.length === 0) return null;
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  // S7.21: a place may carry its own width ("Tablet and Mobile" is two copies of one board in ONE request)
  const widthOf = (p: { width?: number }) => p.width ?? width;
  const atWidth = places.some((p) => widthOf(p) !== undefined);
  const result = await run({
    op: atWidth ? 'artboard.duplicate-at-width' : 'artboard.duplicate',
    targets: [],
    params: {
      items: places.map((p) => {
        const w = widthOf(p);
        return { artboard: p.artboard, at: p.at, ...(w === undefined ? {} : { width: w }) };
      }),
      pin: pinsFor(deps.boards(), new Set()).slice(0, MAX_PINS),
    },
  });
  if (!result.ok) {
    deps.toast?.(result.message || 'That did not go through.', 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    // null on the op log: the write is a kernel action there, ⌘Z is the shell's projection
    const rec = editOpRecord(result.writeId, DUPLICATE_LABEL);
    if (rec) deps.record?.(rec);
  }
  const ids = (result.created ?? []).map((c) => c.artboard);
  if (ids.length) deps.select?.(ids);
  return result;
}

/** ⌘D / the menu: each board's copy at the row's gap. */
export function duplicatePlaces(ids: readonly string[], boards: readonly Box[], width?: number) {
  const sources = ids.map((id) => boards.find((b) => b.id === id)).filter((b): b is Box => !!b);
  return copyPlaces(sources, boards, width === undefined ? undefined : () => width);
}

/**
 * S7.21 (08 ak-web-widths): the same board at several widths in one go — "Tablet and Mobile are beside Desktop".
 * The first copy lands right of the source at the row's gap, the next right of that one; each carries its own width.
 */
export function duplicatePlacesAtWidths(
  ids: readonly string[],
  boards: readonly Box[],
  widths: readonly number[]
): Array<{ artboard: string; at: { x: number; y: number }; width: number }> {
  const out: Array<{ artboard: string; at: { x: number; y: number }; width: number }> = [];
  let all: Box[] = boards.map((b) => ({ ...b }));
  for (const width of widths) {
    const places = duplicatePlaces(ids, all, width);
    for (const p of places) {
      out.push({ ...p, width });
      const src = all.find((b) => b.id === p.artboard);
      // the copy counts as a board for the next width (its height is the source's: a hug page grows later)
      all = [
        ...all,
        {
          id: `copy-${out.length}-of-${p.artboard}`,
          x: p.at.x,
          y: p.at.y,
          w: width,
          h: src?.h ?? 0,
        },
      ];
    }
  }
  return out;
}

/** Where "Reset position" sends a board: its default-grid slot (canvas-lib's `synthDefaultGrid`). */
export function defaultSlots(boards: readonly Box[]): Map<string, { x: number; y: number }> {
  const grid = synthDefaultGrid(
    boards.map((b) => ({ id: b.id, w: b.w, h: b.h, kind: 'digital' as const }))
  );
  return new Map(grid.map((r) => [r.id, { x: r.x, y: r.y }]));
}

const artboardSelection = (id: string): Selection => ({
  selector: `[data-dc-screen="${CSS.escape(id)}"]`,
  artboardId: id,
});

/** Select `ids` as soon as the canvas shows them (a source write re-renders asynchronously). */
export function selectWhenRendered(ids: string[], replace: (s: Selection[]) => void): void {
  let tries = 0;
  const attempt = () => {
    const found = ids.filter((id) =>
      document.querySelector(`[data-dc-screen="${CSS.escape(id)}"]`)
    );
    if (found.length === ids.length) return replace(ids.map(artboardSelection));
    if (++tries < 25) setTimeout(attempt, 100);
  };
  attempt();
}

export interface ArtboardActions {
  /** the artboards a menu / chord acts on: the selected ones when `id` is among them, else `id` alone */
  idsFor(id: string | null | undefined): string[];
  duplicate(ids?: string[]): Promise<void>;
  duplicateAtWidth(ids: string[] | undefined, width: number): Promise<void>;
  /** S7.21: several widths of the same board(s) in ONE request (one ⌘Z). */
  duplicateAtWidths(ids: string[] | undefined, widths: readonly number[]): Promise<void>;
  duplicateOnDrop(moved: ReadonlyArray<{ id: string; x: number; y: number }>): Promise<void>;
  resetPosition(ids?: string[]): void;
  rename(id?: string): void;
  menuDeps: ArtboardMenuDeps;
}

export function useArtboardActions(): ArtboardActions {
  const selSet = useSelectionSet();
  const bus = useDragStateContext();
  const undo = useUndoStackOptional();
  const live = useRef({ selSet, bus, undo });
  live.current = { selSet, bus, undo };
  return useMemo<ArtboardActions>(() => {
    const boards = (): Box[] => live.current.bus?.layoutRects().map((r) => ({ ...r })) ?? [];
    const selectedIds = (): string[] =>
      live.current.selSet.selected
        .filter((s) => !s.id && s.artboardId)
        .map((s) => String(s.artboardId));
    const deps = (): ArtboardActionDeps => ({
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => live.current.undo?.record(rec),
      select: (ids) => selectWhenRendered(ids, (s) => live.current.selSet.replace(s)),
      boards,
    });
    const idsFor: ArtboardActions['idsFor'] = (id) => {
      const picked = selectedIds();
      if (id && picked.includes(id)) return picked;
      return id ? [id] : picked;
    };
    const duplicate: ArtboardActions['duplicate'] = async (ids) => {
      const list = ids ?? selectedIds();
      await writeCopies(duplicatePlaces(list, boards()), deps());
    };
    const duplicateAtWidth: ArtboardActions['duplicateAtWidth'] = async (ids, width) => {
      const list = ids ?? selectedIds();
      await writeCopies(duplicatePlaces(list, boards(), width), deps(), width);
    };
    const duplicateAtWidths: ArtboardActions['duplicateAtWidths'] = async (ids, widths) => {
      const list = ids ?? selectedIds();
      await writeCopies(duplicatePlacesAtWidths(list, boards(), widths), deps());
    };
    const duplicateOnDrop: ArtboardActions['duplicateOnDrop'] = async (moved) => {
      await writeCopies(dropPlaces(moved), deps());
    };
    const resetPosition: ArtboardActions['resetPosition'] = (ids) => {
      const b = live.current.bus;
      const list = ids ?? selectedIds();
      if (!b || list.length === 0) return;
      const slots = defaultSlots(boards());
      const moved = list.flatMap((id) => {
        const at = slots.get(id);
        return at ? [{ id, x: at.x, y: at.y }] : [];
      });
      if (moved.length === 0) return;
      b.commitPositions(moved, {
        label: moved.length === 1 ? 'reset position' : `reset ${moved.length} positions`,
      });
    };
    const rename: ArtboardActions['rename'] = (id) => {
      const target = id ?? selectedIds()[0];
      if (target) requestRename(target);
    };
    const customWidth = (t: ContextTarget) => {
      if (!t.artboardId) return;
      window.dispatchEvent(
        new CustomEvent(CUSTOM_WIDTH_EVENT, {
          detail: { ids: idsFor(t.artboardId), x: t.clientX, y: t.clientY },
        })
      );
    };
    const menuDeps: ArtboardMenuDeps = {
      duplicate: (t) => void duplicate(idsFor(t.artboardId)),
      duplicateAtWidth: (t, width) => void duplicateAtWidth(idsFor(t.artboardId), width),
      customWidth,
      rename: (t) => rename(t.artboardId ?? undefined),
      resetPosition: (t) => resetPosition(idsFor(t.artboardId)),
    };
    return {
      idsFor,
      duplicate,
      duplicateAtWidth,
      duplicateAtWidths,
      duplicateOnDrop,
      resetPosition,
      rename,
      menuDeps,
    };
  }, []);
}
