// editing/draw-tools.tsx — the Frame / Shape / More tools: draw by dragging (S2.13, artboard ed-shape).
//
//   F  a frame inside the artboard under the press; on empty canvas a Fixed size artboard (kind="digital")
//   R  a rectangle         More › Ellipse · Line · Polygon         More › Export area (writes nothing)
//
// While the tool is armed an overlay takes the pointer (the way the annotation tools do — `.dc-annot-input`'s
// sibling, in the same host, so wheel / space-pan still reach the viewport controller). A drag shows the box and
// its live tag ("Rectangle · 216 × 216"); ⇧ makes it square (a Line: 45° steps), ⌥ draws it from the centre, esc
// gives it up. A click without a drag draws the default 100 × 100. On release ONE edit-op goes out
// (`object.insert-shape`, or `artboard.draw` on empty canvas), the new object is selected and the tool steps back
// to Select. Export area opens the Export sheet (⇧⌘E) with the world rectangle instead and never writes.
//
// The container is the deepest frame under the press that can hold a child; a press on bare artboard draws into
// the artboard. The numbers the op gets are in that container's own px (its padding edge, divided by the world
// zoom), so a drawing lands exactly where the box showed.
//
// S7.20 hook: `onFrameToolArmed({ hasArtboardSelection })` (S7-slices Q9) — F with no artboard selected is the
// moment the size picker may open above the toolbar. Exported as a subscription; nothing here opens a picker.

import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getLiveViewport, useWorldRefContext } from '../canvas-lib.tsx';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import type { Tool } from '../input-router.tsx';
import type { CommandRecord } from '../undo-stack.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { worldScaleOf } from './arrange.ts';
import { selectWhenRendered as selectArtboardsWhenRendered } from './artboard-actions.ts';
import {
  type Box,
  clickBox,
  type DrawKind,
  type DrawTool,
  dragBox,
  isClick,
  isDrawTool,
  KIND_LABEL,
  KIND_OF_TOOL,
  lineEnd,
  liveTag,
  type Pt,
  pointToLocal,
  roundBox,
  toLocal,
  toWorld,
} from './draw-geometry.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import {
  refOfElement,
  selectWhenRendered as selectElementsWhenRendered,
} from './object-actions.ts';
import { isLockedDom } from './selection.tsx';

// ── the container under a press ─────────────────────────────────────────────────────────────

/** Tags that can hold a drawn child (a text run, an image, a control cannot). */
const CONTAINER_TAGS: ReadonlySet<string> = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'form',
  'figure',
  'ul',
  'ol',
  'li',
]);
/** Canvas chrome the press may land on first. */
const CHROME = '.ed-draw-input, .dc-annot-input, .dc-tool-palette, [data-dc-chrome]';

export interface Container {
  /** the frame, or the artboard body */
  el: HTMLElement;
  artboard: string;
  /** false = the artboard itself */
  frame: boolean;
}

/** The frame (or artboard) a drawing that starts at (x, y) goes into; null off every artboard. */
export function containerAt(doc: Document, x: number, y: number): Container | null {
  for (const hit of doc.elementsFromPoint(x, y)) {
    if (hit.closest(CHROME)) continue;
    const body = hit.closest<HTMLElement>('.dc-artboard-body');
    if (!body) continue;
    const artboard = body.closest('[data-dc-screen]')?.getAttribute('data-dc-screen') ?? '';
    if (!artboard) continue;
    for (let at: Element | null = hit; at && at !== body; at = at.parentElement) {
      if (
        at.hasAttribute('data-cd-id') &&
        CONTAINER_TAGS.has(at.tagName.toLowerCase()) &&
        !isLockedDom(at)
      )
        return { el: at as HTMLElement, artboard, frame: true };
    }
    return { el: body, artboard, frame: false };
  }
  return null;
}

/** A container's content corner on screen (inside its border) and its screen px per px. */
export function localFrame(c: Container): { origin: Pt; k: number } {
  const r = c.el.getBoundingClientRect();
  const k = worldScaleOf(c.el);
  return { origin: { x: r.left + c.el.clientLeft * k, y: r.top + c.el.clientTop * k }, k };
}

// ── the S7.20 hook ──────────────────────────────────────────────────────────────────────────

type ArmedListener = (info: { hasArtboardSelection: boolean }) => void;
const armedListeners = new Set<ArmedListener>();
/** F was armed (S7-slices Q9): with no artboard selected the size picker may open above the toolbar. */
export function onFrameToolArmed(fn: ArmedListener): () => void {
  armedListeners.add(fn);
  return () => armedListeners.delete(fn);
}

// ── the overlay ─────────────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
.ed-draw-input { position: absolute; inset: 0; z-index: 4; touch-action: none; }
.ed-draw-box, .ed-draw-svg { position: fixed; pointer-events: none; z-index: 5; box-sizing: border-box; }
.ed-draw-box { border: 1px solid var(--maude-hud-accent); background: color-mix(in oklab, var(--maude-hud-accent) 10%, transparent); }
.ed-draw-box[data-kind="ellipse"] { border-radius: 50%; }
.ed-draw-box[data-kind="area"] { border-style: dashed; background: color-mix(in oklab, var(--maude-hud-accent) 6%, transparent); }
.ed-draw-svg { left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; }
.ed-draw-svg line { stroke: var(--maude-hud-accent); stroke-width: 2; stroke-linecap: round; }
.ed-draw-tag {
  position: fixed; pointer-events: none; z-index: 6; padding: 1px 6px; border-radius: 3px;
  background: var(--maude-hud-accent); color: var(--maude-hud-accent-fg);
  font: 500 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
`;

/**
 * A press at `from`: where the drawing will go. `'off-artboard'` = a shape tool pressed on empty canvas (only the
 * Frame may start there, as a new artboard; the Export area is always world and needs no container).
 */
export function beginLive(
  doc: Document,
  kind: DrawKind,
  from: Pt,
  mods: { altKey: boolean; shiftKey: boolean }
): Live | 'off-artboard' {
  let target: Target | null = null;
  if (kind !== 'area') {
    const c = containerAt(doc, from.x, from.y);
    if (!c && kind !== 'frame') return 'off-artboard';
    if (c) {
      const frameRef = c.frame ? refOfElement(c.el) : null;
      const { origin, k } = localFrame(c);
      target = {
        artboard: c.artboard,
        frameRef,
        origin,
        k,
        relativeParent: !!frameRef && getComputedStyle(c.el).position === 'static',
      };
    }
  }
  return { kind, from, to: from, alt: mods.altKey, shift: mods.shiftKey, target };
}

/** Where a drawing goes: a frame (or the artboard body) and how to turn screen px into its own px. */
export interface Target {
  artboard: string;
  /** null = straight into the artboard */
  frameRef: ElementRef | null;
  origin: Pt;
  k: number;
  /** the frame is `position: static`: the op gives it `position: relative` so left / top mean something */
  relativeParent: boolean;
}

export interface Live {
  kind: DrawKind;
  from: Pt;
  to: Pt;
  alt: boolean;
  shift: boolean;
  /** null = empty canvas (a Frame there is a new artboard; the Export area is always world) */
  target: Target | null;
}

/** The screen box a live drag shows (a Line: its two points). */
export function screenShape(l: Live): { box: Box; a: Pt; b: Pt } {
  if (l.kind === 'line') {
    const b = lineEnd(l.from, l.to, { shift: l.shift });
    return {
      box: {
        x: Math.min(l.from.x, b.x),
        y: Math.min(l.from.y, b.y),
        w: Math.abs(b.x - l.from.x),
        h: Math.abs(b.y - l.from.y),
      },
      a: l.from,
      b,
    };
  }
  return { box: dragBox(l.from, l.to, { shift: l.shift, alt: l.alt }), a: l.from, b: l.to };
}

export type Plan =
  | { type: 'export'; detail: Record<string, unknown> }
  | {
      type: 'op';
      ask: EditOpAsk;
      label: string;
      /** what to select once the canvas shows it */
      select: 'artboard' | 'element';
    }
  | { type: 'none'; why?: string };

export const NOT_ON_ARTBOARD = 'Draw on an artboard. F draws a new artboard on empty canvas.';

/** What a finished drag asks for. Pure: the geometry above and a viewport. */
export function planDraw(l: Live, vp: { x: number; y: number; zoom: number }): Plan {
  const click = isClick(l.from, l.to);
  const { box, a, b } = screenShape(l);

  if (l.kind === 'area') {
    if (click) return { type: 'none' };
    const w = toWorld({ x: box.x, y: box.y }, vp);
    const rect = roundBox({ x: w.x, y: w.y, w: box.w / (vp.zoom || 1), h: box.h / (vp.zoom || 1) });
    // The Export sheet reads `region`; `scope` is v1's word for "an area of the canvas" until S8's sheet lands.
    return { type: 'export', detail: { scope: 'selection-bounds', region: { rect }, unit: 'one' } };
  }

  if (!l.target) {
    if (l.kind !== 'frame') return { type: 'none', why: NOT_ON_ARTBOARD };
    const w = toWorld({ x: box.x, y: box.y }, vp);
    const world = click
      ? clickBox(w)
      : { x: w.x, y: w.y, w: box.w / (vp.zoom || 1), h: box.h / (vp.zoom || 1) };
    return {
      type: 'op',
      ask: { op: 'artboard.draw', targets: [], params: { rect: roundBox(world) } },
      label: 'Draw an artboard',
      select: 'artboard',
    };
  }

  const t = l.target;
  const params: Record<string, unknown> = { kind: l.kind, artboard: t.artboard };
  if (t.relativeParent) params.relativeParent = true;
  if (l.kind === 'line') {
    if (click) return { type: 'none' };
    const p = pointToLocal(a, t.origin, t.k);
    const q = pointToLocal(b, t.origin, t.k);
    params.line = {
      x1: Math.round(p.x),
      y1: Math.round(p.y),
      x2: Math.round(q.x),
      y2: Math.round(q.y),
    };
  } else {
    const at = pointToLocal(l.from, t.origin, t.k);
    params.rect = roundBox(click ? clickBox(at) : toLocal(box, t.origin, t.k));
  }
  return {
    type: 'op',
    ask: { op: 'object.insert-shape', targets: t.frameRef ? [t.frameRef] : [], params },
    label: `Draw ${KIND_LABEL[l.kind].toLowerCase()}`,
    select: 'element',
  };
}

export interface DrawDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
  select?: (kind: 'artboard' | 'element', created: ElementRef[]) => void;
  openExport?: (detail: Record<string, unknown>) => void;
  viewport?: () => { x: number; y: number; zoom: number } | null;
}

const defaultOpenExport = (detail: Record<string, unknown>) =>
  window.dispatchEvent(new CustomEvent('maude:open-export', { detail }));

/** Finish a drag: ONE edit-op, or the Export sheet. Resolves true when something was made / opened. */
export async function finishDraw(l: Live, deps: DrawDeps = {}): Promise<boolean> {
  const toast = deps.toast ?? ((m, k) => showCanvasToast(m, k === 'error' ? 'error' : 'info'));
  const plan = planDraw(l, (deps.viewport ?? getLiveViewport)() ?? { x: 0, y: 0, zoom: 1 });
  if (plan.type === 'none') {
    if (plan.why) toast(plan.why, 'info');
    return false;
  }
  if (plan.type === 'export') {
    (deps.openExport ?? defaultOpenExport)(plan.detail);
    return true;
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
  if (r.created?.length) deps.select?.(plan.select, r.created);
  return true;
}

// ── the component ───────────────────────────────────────────────────────────────────────────

/** px per screen px for the tag: the container's own px when drawing into one, else world px. */
function unitScale(l: Live): number {
  if (l.target) return l.target.k > 0 ? l.target.k : 1;
  return getLiveViewport()?.zoom || 1;
}

export function DrawTools({ readOnly = false }: { readOnly?: boolean }) {
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

  const [live, setLive] = useState<Live | null>(null);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;
  const spaceRef = useRef(false);
  const ctx = useRef({ selSet, undo, tm });
  ctx.current = { selSet, undo, tm };

  const armed = !readOnly && isDrawTool(tool);

  // S7.20: F armed — tell the picker whether an artboard is selected.
  useEffect(() => {
    if (tool !== 'frame') return;
    const has = ctx.current.selSet.selected.some((s) => !s.id && !!s.artboardId);
    for (const fn of armedListeners) fn({ hasArtboardSelection: has });
  }, [tool]);

  useEffect(() => {
    if (!armed || typeof document === 'undefined') return;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = true;
      if (e.key === 'Escape' && liveRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setLive(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
    };
  }, [armed]);

  if (!armed || !host || !tool) return null;
  const kind = KIND_OF_TOOL[tool as DrawTool];

  const begin = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || spaceRef.current || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic events can refuse capture */
    }
    const started = beginLive(document, kind, { x: e.clientX, y: e.clientY }, e);
    if (started === 'off-artboard') {
      showCanvasToast(NOT_ON_ARTBOARD, 'info');
      return;
    }
    setLive(started);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    setLive((l) =>
      l ? { ...l, to: { x: e.clientX, y: e.clientY }, alt: e.altKey, shift: e.shiftKey } : l
    );
  };

  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    const l = liveRef.current;
    if (!l) return;
    const done: Live = {
      ...l,
      to: { x: e.clientX, y: e.clientY },
      alt: e.altKey,
      shift: e.shiftKey,
    };
    setLive(null);
    void finishDraw(done, {
      record: (rec) => ctx.current.undo?.record(rec),
      select: (what, created) => {
        const replace = (s: Selection | Selection[]) => ctx.current.selSet.replace(s);
        if (what === 'artboard')
          selectArtboardsWhenRendered(
            created.map((c) => c.artboard),
            replace
          );
        else selectElementsWhenRendered(created, replace);
      },
    }).then((made) => {
      if (made) ctx.current.tm?.setTool('move' as Tool);
    });
  };

  const shape = live ? screenShape(live) : null;
  const k = live ? unitScale(live) : 1;
  return (
    <>
      <style>{CSS_TEXT}</style>
      {createPortal(
        <div
          className="ed-draw-input"
          data-testid="edit-draw-input"
          data-tool={tool}
          aria-hidden="true"
          style={{ cursor: 'crosshair' }}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => setLive(null)}
        />,
        host
      )}
      {live && shape ? (
        <>
          {live.kind === 'line' ? (
            <svg className="ed-draw-svg" aria-hidden="true">
              <line
                data-testid="edit-draw-line"
                x1={shape.a.x}
                y1={shape.a.y}
                x2={shape.b.x}
                y2={shape.b.y}
              />
            </svg>
          ) : (
            <div
              className="ed-draw-box"
              data-testid="edit-draw-box"
              data-kind={live.kind}
              aria-hidden="true"
              style={{
                left: shape.box.x,
                top: shape.box.y,
                width: shape.box.w,
                height: shape.box.h,
              }}
            />
          )}
          <div
            className="ed-draw-tag"
            data-testid="edit-draw-tag"
            aria-hidden="true"
            style={{ left: shape.box.x, top: Math.max(0, shape.box.y - 22) }}
          >
            {liveTag(
              live.kind,
              { x: 0, y: 0, w: shape.box.w / k, h: shape.box.h / k },
              live.kind === 'line'
                ? {
                    from: { x: shape.a.x / k, y: shape.a.y / k },
                    to: { x: shape.b.x / k, y: shape.b.y / k },
                  }
                : undefined
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
DrawTools.displayName = 'DrawTools';
