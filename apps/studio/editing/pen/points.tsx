// editing/pen/points.tsx — edit a path's points: double-click a Pen path (S2.14, artboard ed-pen).
//
// Anchors, the selected point's handles and the path itself are drawn over the canvas in screen px; ONLY those
// elements take the pointer, so a click anywhere else reaches the canvas as usual (and leaves point editing, because
// the path is no longer the selection). Click the path = a point there; click a point = select it (its handles show,
// a chip says Smooth or Sharp); drag a point = move it; drag a handle = bend (the other handle turns to stay opposite),
// ⌥-drag a handle = break it (the point turns sharp); double-click a point = smooth ↔ sharp; ⌫ removes the selected
// point; ↵ / esc finish. The previous curve stays dashed while a drag is in flight.
//
// Every drag (and every add, toggle, removal) is ONE `path.edit` edit-op on release: one write, one undo step. The
// numbers the op gets are in the container's px (the svg's own origin added back to the local ones); the model shown
// is re-read from the file's `d` whenever it changes (an undo, a peer's edit), so the overlay never lies.

import { useCallback, useEffect, useRef, useState } from 'react';

import { showCanvasToast } from '../../canvas-notifications.tsx';
import {
  type PathModel,
  PathParseError,
  type Pt,
  parsePathD,
  serializePath,
  translatePath,
} from '../../edit-ops/path-model.ts';
import type { EditOpResult, ElementRef } from '../../edit-ops/types.ts';
import { useSelectionSet } from '../../use-selection-set.tsx';
import { useToolModeOptional } from '../../use-tool-mode.tsx';
import { useUndoStackOptional } from '../../use-undo-stack.tsx';
import { worldScaleOf } from '../arrange.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from '../edit-op.ts';
import { refOfElement, selectionOf } from '../object-actions.ts';
import { isLockedDom } from '../selection.tsx';
import { EDIT_HINTS, PEN_CSS, PenChip, PenHints, useFrameTick } from './overlay.tsx';
import {
  addedAt,
  dragged,
  type Frame,
  fromScreen,
  type Hit,
  hitTest,
  mapPath,
  type PointRef,
  removed,
  toggled,
  toScreen,
  typeChip,
} from './pen-geometry.ts';

export const PATH_SELECTOR = 'svg[data-shape="path"][data-cd-id]';

/** The first path's `d` read from an svg as a model in the svg's own px; null when it cannot be edited. */
export function modelOfSvg(svg: Element): PathModel | null {
  const d = svg.querySelector('path')?.getAttribute('d');
  if (!d) return null;
  try {
    return parsePathD(d);
  } catch (e) {
    if (e instanceof PathParseError) return null;
    throw e;
  }
}

/** Where the svg's box sits in its container's px (its inline left / top, else measured). */
export function svgOrigin(svg: Element): Pt {
  const el = svg as HTMLElement;
  const l = Number.parseFloat(el.style?.left ?? '');
  const t = Number.parseFloat(el.style?.top ?? '');
  if (Number.isFinite(l) && Number.isFinite(t)) return { x: l, y: t };
  const parent = el.parentElement;
  if (!parent) return { x: 0, y: 0 };
  const pr = parent.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const k = worldScaleOf(el);
  return {
    x: (r.left - pr.left - parent.clientLeft * k) / k,
    y: (r.top - pr.top - parent.clientTop * k) / k,
  };
}

/** The svg's local px → screen px. */
export function svgFrame(svg: Element): Frame {
  const r = svg.getBoundingClientRect();
  const vb = (svg as SVGSVGElement).viewBox?.baseVal;
  const k = vb?.width ? r.width / vb.width : worldScaleOf(svg);
  return { origin: { x: r.left, y: r.top }, k: k > 0 ? k : 1 };
}

/** What a committed edit asks for: the model in the container's px. */
export function editAsk(ref: ElementRef, local: PathModel, svg: Element): EditOpAsk {
  const o = svgOrigin(svg);
  return { op: 'path.edit', targets: [ref], params: { path: translatePath(local, o.x, o.y) } };
}

// ── the component ───────────────────────────────────────────────────────────────────────────

interface Edit {
  svg: Element;
  ref: ElementRef;
  model: PathModel;
  sel: PointRef | null;
}
interface Drag {
  hit: Hit;
  base: PathModel;
  moved: boolean;
  at: Pt;
}

export function PointEdit({ readOnly = false }: { readOnly?: boolean }) {
  const tm = useToolModeOptional();
  const tool = tm?.tool;
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();

  const [edit, setEdit] = useState<Edit | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const latest = useRef<PathModel | null>(null);
  const ctx = useRef({ undo, selSet });
  ctx.current = { undo, selSet };

  const on = !readOnly && !!edit;
  const frameKey = useCallback(() => {
    const e = editRef.current;
    if (!e) return '';
    const f = svgFrame(e.svg);
    return `${f.origin.x}|${f.origin.y}|${f.k}`;
  }, []);
  useFrameTick(frameKey, on);

  const leave = useCallback(() => {
    setEdit(null);
    setDrag(null);
  }, []);

  // Double-click a Pen path to edit its points.
  useEffect(() => {
    if (readOnly || typeof document === 'undefined') return;
    const onDbl = (e: MouseEvent) => {
      if (tool !== 'move' && tool !== undefined && tool !== null) return;
      const t = e.target as Element | null;
      if (!t || t.closest('.ed-pen-svg')) return;
      const svg = t.closest?.(PATH_SELECTOR);
      if (!svg || isLockedDom(svg)) return;
      const model = modelOfSvg(svg);
      const ref = refOfElement(svg);
      if (!model || !ref) {
        showCanvasToast('This path uses arcs or a computed shape; edit it in the code.', 'info');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      ctx.current.selSet.replace(selectionOf(svg));
      setEdit({ svg, ref, model, sel: null });
    };
    document.addEventListener('dblclick', onDbl, true);
    return () => document.removeEventListener('dblclick', onDbl, true);
  }, [readOnly, tool]);

  // The path stopped being the selection (or another tool took over): leave.
  useEffect(() => {
    if (!edit) return;
    const keep = ctx.current.selSet.selected.some(
      (s) => s.id === edit.ref.element && s.artboardId === edit.ref.artboard
    );
    if (!keep || (tool && tool !== 'move')) leave();
  }, [edit, selSet.selected, tool, leave]);

  // The file's `d` changed (our own edit landed, an undo, a peer): re-read it.
  useEffect(() => {
    if (!edit || typeof MutationObserver === 'undefined') return;
    const svg = edit.svg;
    const obs = new MutationObserver(() => {
      const m = modelOfSvg(svg);
      if (!m) return leave();
      setEdit((e) => (e && e.svg === svg ? { ...e, model: m } : e));
    });
    obs.observe(svg, {
      attributes: true,
      subtree: true,
      attributeFilter: ['d', 'width', 'height'],
    });
    return () => obs.disconnect();
  }, [edit?.svg, leave]);

  const commit = useCallback(async (e: Edit, next: PathModel): Promise<EditOpResult | null> => {
    const ask = editAsk(e.ref, next, e.svg);
    const r = await runEditOp(ask);
    if (!r.ok) {
      showCanvasToast(r.message || 'That did not go through.', 'error');
      const m = modelOfSvg(e.svg);
      if (m) setEdit((cur) => (cur && cur.svg === e.svg ? { ...cur, model: m } : cur));
      return null;
    }
    if (r.actionId === null && r.writeId) {
      const rec = editOpRecord(r.writeId, 'Edit path');
      if (rec) ctx.current.undo?.record(rec);
    }
    return r;
  }, []);

  // ⌫ removes the selected point; ↵ / esc finish.
  useEffect(() => {
    if (!on || typeof document === 'undefined') return;
    const onKey = (ev: KeyboardEvent) => {
      const e = editRef.current;
      if (!e) return;
      if (ev.key === 'Enter' || ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        return leave();
      }
      if ((ev.key === 'Backspace' || ev.key === 'Delete') && e.sel) {
        ev.preventDefault();
        ev.stopPropagation();
        const next = removed(e.model, e.sel);
        if (!next) {
          showCanvasToast(
            'A path keeps at least two points. ⌫ with the path selected removes it.',
            'info'
          );
          return;
        }
        setEdit({ ...e, model: next, sel: null });
        void commit(e, next);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [on, leave, commit]);

  const press = (ev: React.PointerEvent, hit: Hit) => {
    const e = editRef.current;
    if (!e || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    let base = e.model;
    let at: Hit = hit;
    let sel: PointRef | null = e.sel;
    if (hit.kind === 'segment') {
      const added = addedAt(e.model, hit);
      base = added.model;
      sel = added.point;
      at = { kind: 'anchor', sub: added.point.sub, i: added.point.i };
      setEdit({ ...e, model: base, sel });
    } else if (hit.kind === 'anchor') {
      sel = { sub: hit.sub, i: hit.i };
      setEdit({ ...e, sel });
    }
    const start: Drag = {
      hit: at,
      base,
      moved: hit.kind === 'segment',
      at: { x: ev.clientX, y: ev.clientY },
    };
    latest.current = base;
    setDrag(start);
    const f = () => svgFrame(e.svg);
    const onMove = (m: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(m.clientX - d.at.x, m.clientY - d.at.y) >= 3;
      if (!moved) return;
      const model = dragged(d.base, d.hit, fromScreen(f(), { x: m.clientX, y: m.clientY }), {
        alt: m.altKey,
        shift: m.shiftKey,
      });
      latest.current = model;
      setDrag({ ...d, moved: true });
      setEdit((cur) => (cur ? { ...cur, model } : cur));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      const d = dragRef.current;
      setDrag(null);
      const cur = editRef.current;
      if (d?.moved && cur) void commit(cur, latest.current ?? cur.model);
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
  };

  const dbl = (ref: PointRef) => {
    const e = editRef.current;
    if (!e) return;
    const next = toggled(e.model, ref);
    setEdit({ ...e, model: next, sel: ref });
    void commit(e, next);
  };

  if (!on || !edit) return null;
  const f = svgFrame(edit.svg);
  const screen = mapPath(edit.model, (p) => toScreen(f, p));
  const was = drag?.moved ? mapPath(drag.base, (p) => toScreen(f, p)) : null;
  const sel = edit.sel ? screen.subs[edit.sel.sub]?.points[edit.sel.i] : null;
  const hitOnPath = (ev: React.PointerEvent) =>
    hitTest(edit.model, f, { x: ev.clientX, y: ev.clientY }, edit.sel);

  return (
    <>
      <style>{PEN_CSS}</style>
      <PenHints hints={EDIT_HINTS} testid="edit-pen-edit-hints" />
      {
        <svg className="ed-pen-svg" data-testid="edit-pen-points" aria-hidden="true">
          {was ? (
            <path className="ed-pen-was" data-testid="edit-pen-was" d={serializePath(was)} />
          ) : null}
          <path className="ed-pen-path" data-testid="edit-pen-outline" d={serializePath(screen)} />
          <path
            className="ed-pen-hit"
            data-testid="edit-pen-segments"
            d={serializePath(screen)}
            onPointerDown={(ev) => {
              const hit = hitOnPath(ev);
              if (hit) press(ev, hit);
            }}
          />
          {screen.subs.map((s, si) =>
            s.points.map((p, i) => {
              const on = edit.sel?.sub === si && edit.sel.i === i;
              return (
                <g key={`${si}:${i}`}>
                  {on
                    ? (['in', 'out'] as const).map((which) => {
                        const h = p[which];
                        return h ? (
                          <g key={which}>
                            <path className="ed-pen-h" d={`M${p.x} ${p.y}L${h.x} ${h.y}`} />
                            <circle
                              className="ed-pen-hd"
                              data-testid={`edit-pen-handle-${which}`}
                              cx={h.x}
                              cy={h.y}
                              r={4.5}
                              onPointerDown={(ev) =>
                                press(ev, { kind: 'handle', sub: si, i, which })
                              }
                            />
                          </g>
                        ) : null;
                      })
                    : null}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: an SVG anchor in a pointer overlay; ↵ / ⌫ are the keyboard path */}
                  <rect
                    className="ed-pen-pt"
                    data-testid={`edit-pen-point-${si}-${i}`}
                    data-on={on ? 'true' : undefined}
                    x={p.x - 5}
                    y={p.y - 5}
                    width={10}
                    height={10}
                    onPointerDown={(ev) => press(ev, { kind: 'anchor', sub: si, i })}
                    onDoubleClick={(ev) => {
                      ev.stopPropagation();
                      dbl({ sub: si, i });
                    }}
                  />
                </g>
              );
            })
          )}
        </svg>
      }
      {sel && edit.sel ? (
        <PenChip x={sel.x + 14} y={sel.y + 14} testid="edit-pen-chip-type">
          {typeChip(edit.model, edit.sel)}
        </PenChip>
      ) : null}
    </>
  );
}
PointEdit.displayName = 'PointEdit';
