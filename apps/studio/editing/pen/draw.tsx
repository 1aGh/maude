// editing/pen/draw.tsx — the Pen tool (P): draw a path point by point (S2.14, artboard ed-pen).
//
// While the tool is armed an overlay takes the pointer (the way the drag tools do — `.dc-annot-input`'s sibling in the
// same host, so wheel / space-pan still reach the viewport controller). Click = a sharp point, drag = a smooth one, ⇧
// keeps the next point to a 45° step, a press on the first point closes ("Click here to close"), ↵ finishes an open
// path, esc gives it up (a path of one point has nothing to finish). On finish ONE edit-op goes out
// (`object.insert-path`), the path is selected and the tool steps back to Select.
//
// The container is the deepest frame under the FIRST press (as the Frame and Shape tools do); every later point is
// measured against it, so a path never leaves the frame it began in.

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { useWorldRefContext } from '../../canvas-lib.tsx';
import { showCanvasToast } from '../../canvas-notifications.tsx';
import { serializePath } from '../../edit-ops/path-model.ts';
import type { EditOpResult, ElementRef } from '../../edit-ops/types.ts';
import type { Tool } from '../../input-router.tsx';
import type { CommandRecord } from '../../undo-stack.ts';
import { type Selection, useSelectionSet } from '../../use-selection-set.tsx';
import { useToolModeOptional } from '../../use-tool-mode.tsx';
import { useUndoStackOptional } from '../../use-undo-stack.tsx';
import { type Container, containerAt, localFrame, NOT_ON_ARTBOARD } from '../draw-tools.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from '../edit-op.ts';
import { refOfElement, selectWhenRendered } from '../object-actions.ts';
import { DRAW_HINTS, PEN_CSS, PenChip, PenHints, useFrameTick } from './overlay.tsx';
import {
  type Draft,
  draftModel,
  emptyDraft,
  type Frame,
  fromScreen,
  isPenTool,
  landing,
  mapPath,
  overFirst,
  press,
  pull,
  toScreen,
  undoPoint,
} from './pen-geometry.ts';

// ── what a finished path asks for ───────────────────────────────────────────────────────────

/** Where a path goes: a frame (or the artboard body) — measured again at each event. */
export interface PenTarget {
  artboard: string;
  /** null = straight into the artboard */
  frameRef: ElementRef | null;
  /** the frame is `position: static`: the op gives it `position: relative` */
  relativeParent: boolean;
}

export const NEEDS_TWO = 'A path needs two points. Click once more, or esc to give it up.';

export type PenPlan =
  | { type: 'op'; ask: EditOpAsk; label: string }
  | { type: 'none'; why?: string };

/** Pure: a draft and where it goes → the one op it becomes. */
export function planPen(draft: Draft, closed: boolean, t: PenTarget): PenPlan {
  if (draft.points.length < 2) return { type: 'none', why: NEEDS_TWO };
  const params: Record<string, unknown> = { artboard: t.artboard, path: draftModel(draft, closed) };
  if (t.relativeParent) params.relativeParent = true;
  return {
    type: 'op',
    ask: { op: 'object.insert-path', targets: t.frameRef ? [t.frameRef] : [], params },
    label: 'Draw path',
  };
}

export interface PenDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
  select?: (created: ElementRef[]) => void;
}

/** Finish a path: ONE edit-op (or a word about why not). Resolves true when a path was made. */
export async function finishPen(
  draft: Draft,
  closed: boolean,
  target: PenTarget,
  deps: PenDeps = {}
): Promise<boolean> {
  const toast = deps.toast ?? ((m, k) => showCanvasToast(m, k === 'error' ? 'error' : 'info'));
  const plan = planPen(draft, closed, target);
  if (plan.type === 'none') {
    if (plan.why) toast(plan.why, 'info');
    return false;
  }
  const r = await (deps.run ?? ((ask: EditOpAsk) => runEditOp(ask)))(plan.ask);
  if (!r.ok) {
    toast(r.message || 'That did not go through.', 'error');
    return false;
  }
  if (r.actionId === null && r.writeId) {
    const rec = editOpRecord(r.writeId, plan.label);
    if (rec) deps.record?.(rec);
  }
  if (r.created?.length) deps.select?.(r.created);
  return true;
}

/** A container the first press landed in, as the target. */
export function targetOf(c: Container): PenTarget {
  return {
    artboard: c.artboard,
    frameRef: c.frame ? refOfElement(c.el) : null,
    relativeParent: c.frame && getComputedStyle(c.el).position === 'static',
  };
}

// ── the component ───────────────────────────────────────────────────────────────────────────

export function PenTool({ readOnly = false }: { readOnly?: boolean }) {
  const tm = useToolModeOptional();
  const tool = tm?.tool;
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const worldRef = useWorldRefContext();
  const host = worldRef?.current?.parentElement ?? null;
  const [, force] = useState({});
  useEffect(() => {
    if (host) return;
    const id = setTimeout(() => force({}), 0);
    return () => clearTimeout(id);
  }, [host]);

  const armed = !readOnly && isPenTool(tool);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const container = useRef<Container | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [shift, setShift] = useState(false);
  const spaceRef = useRef(false);
  const ctx = useRef({ selSet, undo, tm });
  ctx.current = { selSet, undo, tm };

  const reset = useCallback(() => {
    container.current = null;
    setDraft(emptyDraft());
    setPointer(null);
  }, []);

  const frame = (): Frame | null => (container.current ? localFrame(container.current) : null);
  const frameKey = useCallback(() => {
    const f = container.current ? localFrame(container.current) : null;
    return f ? `${f.origin.x}|${f.origin.y}|${f.k}` : '';
  }, []);
  useFrameTick(frameKey, armed && draft.points.length > 0);

  const finish = useCallback(
    (closed: boolean) => {
      const c = container.current;
      const d = draftRef.current;
      if (!c) return;
      reset();
      void finishPen(d, closed, targetOf(c), {
        record: (rec) => ctx.current.undo?.record(rec),
        select: (created) =>
          selectWhenRendered(created, (s: Selection[]) => ctx.current.selSet.replace(s)),
      }).then((made) => {
        if (made) ctx.current.tm?.setTool('move' as Tool);
      });
    },
    [reset]
  );

  // leaving the tool drops a path in progress
  useEffect(() => {
    if (!armed) reset();
  }, [armed, reset]);

  useEffect(() => {
    if (!armed || typeof document === 'undefined') return;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = true;
      if (e.key === 'Shift') setShift(true);
      const d = draftRef.current;
      if (d.points.length === 0) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (d.points.length < 2) reset();
        else finish(false);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        const next = undoPoint(d);
        if (next.points.length === 0) reset();
        else setDraft(next);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
      if (e.key === 'Shift') setShift(false);
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
    };
  }, [armed, finish, reset]);

  if (!armed || !host) return null;

  const begin = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || spaceRef.current || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic events can refuse capture */
    }
    if (!container.current) {
      const c = containerAt(document, e.clientX, e.clientY);
      if (!c) {
        showCanvasToast(NOT_ON_ARTBOARD, 'info');
        return;
      }
      container.current = c;
    }
    const f = frame() as Frame;
    setShift(e.shiftKey);
    setDraft((d) => press(d, f, { x: e.clientX, y: e.clientY }, e.shiftKey));
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    setPointer({ x: e.clientX, y: e.clientY });
    setShift(e.shiftKey);
    const f = frame();
    if (f && draftRef.current.press) setDraft((d) => pull(d, f, { x: e.clientX, y: e.clientY }));
  };
  const end = () => {
    const p = draftRef.current.press;
    if (!p) return;
    if (p.closing) return finish(true);
    setDraft((d) => ({ ...d, press: null }));
  };

  const f = frame();
  const screenModel =
    f && draft.points.length ? mapPath(draftModel(draft), (p) => toScreen(f, p)) : null;
  const d = screenModel ? serializePath(screenModel) : '';
  const last =
    f && draft.points.length
      ? toScreen(f, draft.points[draft.points.length - 1] as { x: number; y: number })
      : null;
  const rubberTo =
    f && pointer && last && !draft.press
      ? toScreen(f, landing(draft, fromScreen(f, pointer), shift))
      : null;
  const first =
    f && draft.points.length ? toScreen(f, draft.points[0] as { x: number; y: number }) : null;
  const closing = !!(f && pointer && overFirst(draft, f, pointer));

  return (
    <>
      <style>{PEN_CSS}</style>
      {createPortal(
        <div
          className="ed-draw-input"
          data-testid="edit-pen-input"
          data-tool="el-pen"
          aria-hidden="true"
          style={{ cursor: 'crosshair' }}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={reset}
        />,
        host
      )}
      <PenHints hints={DRAW_HINTS} testid="edit-pen-hints" />
      {f && draft.points.length ? (
        <>
          <svg className="ed-pen-svg" aria-hidden="true" data-testid="edit-pen-svg">
            <path className="ed-pen-path" data-testid="edit-pen-path" d={d} />
            {rubberTo && last ? (
              <path
                className="ed-pen-rubber"
                data-testid="edit-pen-rubber"
                d={`M${last.x} ${last.y}L${rubberTo.x} ${rubberTo.y}`}
              />
            ) : null}
            {first && draft.points.length >= 2 ? (
              <circle
                className="ed-pen-close"
                data-testid="edit-pen-close"
                cx={first.x}
                cy={first.y}
                r={10}
              />
            ) : null}
            {screenModel?.subs[0]?.points.map((p, i, all) => (
              <g key={`${p.x}|${p.y}|${i}`}>
                {draft.press?.pulled && i === all.length - 1 && p.out ? (
                  <>
                    <path
                      className="ed-pen-h"
                      d={`M${(p.in ?? p).x} ${(p.in ?? p).y}L${p.x} ${p.y}L${p.out.x} ${p.out.y}`}
                    />
                    <circle className="ed-pen-hd" data-on="true" cx={p.out.x} cy={p.out.y} r={4} />
                  </>
                ) : null}
                <rect
                  className="ed-pen-pt"
                  data-on={i === all.length - 1 ? 'true' : undefined}
                  x={p.x - 4}
                  y={p.y - 4}
                  width={8}
                  height={8}
                />
              </g>
            ))}
          </svg>
          {closing && first ? (
            <PenChip x={first.x + 16} y={first.y + 8} tone="quiet" testid="edit-pen-chip-close">
              Click here to close
            </PenChip>
          ) : null}
          {shift && rubberTo ? (
            <PenChip x={rubberTo.x + 18} y={rubberTo.y + 12} testid="edit-pen-chip-45">
              45°
            </PenChip>
          ) : null}
        </>
      ) : null}
    </>
  );
}
PenTool.displayName = 'PenTool';
