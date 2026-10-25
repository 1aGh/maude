// editing/artboard-handles.tsx — S2.8 (artboards ed-ab-select, ed-ab-resize): a selected artboard gets eight handles.
//
//   · the name turns azure and says its size ("Desktop  1440 × 1573") — an attribute on the frame
//     (`data-ed-selected` / `data-ed-size`) styled below, so the real label button stays the real label;
//   · four corners + four edges; an edge drag changes one side, a corner two; ⌘ ignores presets, ⌥ resizes from the
//     centre, ⇧ keeps the ratio; esc gives the drag back;
//   · the width clicks onto the next preset (preset-ruler.tsx draws the ruler, the ghost and "Laptop · 1280 × 1573");
//   · the page reflows while you drag (the frame's inline size is moved live), and on release ONE write goes out:
//     `artboard.resize` through the edit-op route (JSX width/height, DDR-027; a bottom/top-edge drag also pins
//     the board to Fixed) and, when a left/top edge or ⌥ moved the origin, the layout lane's position commit
//     (`meta.layout.artboards[]`, versioned — never the per-user camera, DDR-115).
//
// Same mechanism as EditingSelection: `position: fixed` overlay divs outside the world transform, so the handles stay
// 8 px at any zoom and never sit inside the artboard's `contain: paint` subtree. v1's three growth-only handles
// (use-element-resize.tsx) stand down for an artboard — one set of handles, not two.

import { useCallback, useEffect, useRef, useState } from 'react';

import { useDragStateContext } from '../canvas-lib.tsx';
import { physicalSizeWords } from '../kinds/physical.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolMode } from '../use-tool-mode.tsx';
import {
  type Box,
  computeArtboardResize,
  HANDLES,
  type Handle,
  type ResizeResult,
  rulerStops,
  sizeText,
} from './artboard-resize.ts';
import { runEditOp } from './edit-op.ts';
import { videoLabelTail } from './video-label.ts';
import { PresetRuler, type RulerHud, type ScreenRect } from './preset-ruler.tsx';

/** The two attributes a size on paper is read from (`kind`, `print`), off the artboard's frame. */
const attrsOf = (el: HTMLElement) => ({
  'data-dc-kind': el.getAttribute('data-dc-kind') ?? undefined,
  'data-dc-print': el.getAttribute('data-dc-print') ?? undefined,
});

// ── measuring + the live preview (exported for tests) ─────────────────────────────────────────

export interface Measured {
  article: HTMLElement;
  body: HTMLElement;
  /** world px: the design surface's size, the frame's origin */
  box: Box;
  /** screen px per world px */
  zoom: number;
  /** the design surface on screen */
  rect: ScreenRect;
  /** the frame minus the surface (border + label): what the frame adds to the surface */
  extraW: number;
}

const num = (s: string | null | undefined): number => Number.parseFloat(s ?? '') || 0;

/** The artboard `id`'s frame + design surface and where they are, or null when it is not on screen. */
export function measureArtboard(doc: Document, id: string): Measured | null {
  let article: HTMLElement | null = null;
  try {
    article = doc.querySelector<HTMLElement>(`[data-dc-screen="${CSS.escape(id)}"]`);
  } catch {
    return null;
  }
  const body = article?.querySelector<HTMLElement>(':scope > .dc-artboard-body') ?? null;
  if (!article || !body || !body.offsetWidth) return null;
  const r = body.getBoundingClientRect();
  const zoom = r.width / body.offsetWidth || 1;
  return {
    article,
    body,
    box: {
      x: num(article.style.left),
      y: num(article.style.top),
      w: body.offsetWidth,
      h: body.offsetHeight,
    },
    zoom,
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    extraW: article.offsetWidth - body.offsetWidth,
  };
}

interface Saved {
  article: Pick<CSSStyleDeclaration, 'width' | 'left' | 'top'>;
  body: Pick<CSSStyleDeclaration, 'height' | 'flex' | 'boxSizing'>;
}

export function savePreview(m: Measured): Saved {
  return {
    article: { width: m.article.style.width, left: m.article.style.left, top: m.article.style.top },
    body: {
      height: m.body.style.height,
      flex: m.body.style.flex,
      boxSizing: m.body.style.boxSizing,
    },
  };
}

/**
 * The size the name chip says. While a handle is being dragged it is the SAME box the pill beside the pointer reads
 * (`computeArtboardResize`'s result) — the page may refuse to get that narrow (its own min-content), and a chip
 * reading 1058 beside a pill reading 1052 is two answers to one question (14 ed-ab-resize). At rest it is what is
 * measured.
 */
export function chipSize(drag: Pick<Box, 'w' | 'h'> | null | undefined, measured: string): string {
  return drag ? sizeText(drag.w, drag.h) : measured;
}

/** Move the frame to `box` for the duration of the drag ("the page reflows while you drag"). */
export function applyPreview(m: Measured, box: Box, heightTouched: boolean): void {
  m.article.style.width = `${box.w + m.extraW}px`;
  m.article.style.left = `${box.x}px`;
  m.article.style.top = `${box.y}px`;
  if (heightTouched) {
    m.body.style.height = `${box.h}px`;
    m.body.style.flex = 'none';
    m.body.style.boxSizing = 'border-box';
  }
}

export function restorePreview(m: Measured, s: Saved): void {
  m.article.style.width = s.article.width;
  m.article.style.left = s.article.left;
  m.article.style.top = s.article.top;
  m.body.style.height = s.body.height;
  m.body.style.flex = s.body.flex;
  m.body.style.boxSizing = s.body.boxSizing;
}

/** What goes to the edit-op for a finished drag: only what changed; a touched height also pins Fixed. */
export function resizeParams(
  artboard: string,
  start: Box,
  r: ResizeResult
): Record<string, unknown> | null {
  const p: Record<string, unknown> = { artboard };
  if (r.widthChanged) p.width = r.box.w;
  if (r.heightChanged) p.height = r.box.h;
  if (r.fixedHeight) p.fixed = true;
  return r.widthChanged || r.heightChanged ? p : null;
}

/** The position to commit to the layout lane, or null when the origin did not move. */
export function movedOrigin(start: Box, box: Box): { x: number; y: number } | null {
  return box.x !== start.x || box.y !== start.y ? { x: box.x, y: box.y } : null;
}

// ── chrome ─────────────────────────────────────────────────────────────────────────────────

const CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

const CSS_TEXT = `
.ed-ab-handle {
  position: fixed;
  z-index: 6;
  box-sizing: border-box;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  /* P8 C5 (14 R2, board .ed-h): eight 8 x 8 bg-2 squares, 1.5 px inset accent, no radius */
  background: var(--maude-chrome-bg-2, #ffffff);
  border: 0;
  box-shadow: inset 0 0 0 1.5px var(--maude-hud-accent);
  border-radius: 0;
  touch-action: none;
}
.ed-ab-frame {
  position: fixed;
  z-index: 4;
  pointer-events: none;
  box-sizing: border-box;
  border: 1.5px solid var(--maude-hud-accent);
}
.dc-canvas .dc-artboard[data-ed-selected] > .dc-artboard-label,
.dc-canvas .dc-artboard[data-ed-selected] > .dc-artboard-label * {
  color: var(--maude-hud-accent);
}
/* gate-a-polish - a selected name is the accent pill (04/14 canvases): --maude-hud-accent-fg on --maude-hud-accent
   (6.3:1 dark, 5.4:1 light), semibold, with the size after it in tabular figures. */
.dc-canvas .dc-artboard.dc-positioned[data-ed-selected] > .dc-artboard-label {
  left: -2px;
  max-width: none;
  padding: 2px 8px;
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
  font-weight: 600;
}
.dc-canvas .dc-artboard.dc-positioned[data-ed-selected] > .dc-artboard-label * {
  color: inherit;
}
.dc-artboard[data-ed-selected] > .dc-artboard-label::after {
  content: attr(data-ed-size);
  margin-left: 8px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  opacity: 0.86;
  white-space: pre;
}
/* 07 M1 - a video's tail ("\00a0· Reels · 0:14", then the size chip) already starts with its own gap and its
   separator; the rest label carries the same words (no chip) so the name never changes under the pointer. */
.dc-canvas .dc-artboard[data-dc-kind='video'][data-ed-selected] > .dc-artboard-label[data-dc-vtail]::after {
  content: attr(data-ed-size);
  margin-left: 0;
}
`;

/**
 * A video artboard's selected label ends with " · Reels · 0:15" and the size chip (07 · M1 - "Name · Format · Length",
 * the board's "Hype trailer · Reels · 0:14   1080 × 1920"), not a bare pixel size. Read off the comp the page
 * registered; '' for any other kind or a comp not yet mounted.
 */
function videoLengthWords(article: Element, id: string): string {
  if (article.getAttribute('data-dc-kind') !== 'video') return '';
  const comps = (
    window as unknown as {
      __maude_comps__?: () => {
        artboardId: string | null;
        fps: number;
        durationInFrames: number;
        width?: number;
        height?: number;
      }[];
    }
  ).__maude_comps__?.();
  const c = comps?.find((x) => x.artboardId === id);
  if (!c || !(c.fps > 0) || !(c.durationInFrames > 0)) return '';
  const label = article.querySelector(':scope > .dc-artboard-label')?.textContent ?? '';
  return videoLabelTail(
    label,
    { fps: c.fps, durationInFrames: c.durationInFrames, width: c.width ?? 0, height: c.height ?? 0 },
    true
  );
}

type DragMods = { alt: boolean; meta: boolean; shift: boolean };

interface Drag {
  pointerId: number;
  handle: Handle;
  m: Measured;
  saved: Saved;
  startX: number;
  startY: number;
  last: ResizeResult | null;
}

type LiveSize =
  | { dgn: 'artboard-live-size'; id: string; w: number; h: number; preset: string | null }
  | { dgn: 'artboard-live-size'; id: null };

/** What the canvas tells the shell while an edge is dragged (the inspector's Preset / Size follow it); null = over. */
export function liveSizeMessage(
  id: string,
  r: Pick<ResizeResult, 'box' | 'preset'> | null
): LiveSize {
  if (!r) return { dgn: 'artboard-live-size', id: null };
  return {
    dgn: 'artboard-live-size',
    id,
    w: Math.round(r.box.w),
    h: Math.round(r.box.h),
    preset: r.preset?.label ?? null,
  };
}

function postLiveSize(m: LiveSize): void {
  try {
    window.parent.postMessage(m, '*');
  } catch {
    /* detached */
  }
}

function artboardIdOf(sel: { id?: string | null; artboardId?: string | null } | undefined) {
  return sel && !sel.id && typeof sel.artboardId === 'string' ? sel.artboardId : null;
}

/** The eight handles + the selected name + the preset ruler for a whole-artboard selection. */
export function ArtboardHandles(): React.ReactNode {
  const { selected } = useSelectionSet();
  const { tool } = useToolMode();
  const dragBus = useDragStateContext();
  const id = selected.length === 1 ? artboardIdOf(selected[0]) : null;
  const active = !!id && tool === 'move' && !isReadOnlyCanvas();

  const handleEls = useRef<Map<Handle, HTMLDivElement>>(new Map());
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [hud, setHud] = useState<RulerHud | null>(null);

  // The azure name + size, and the handles' positions: follow the artboard every frame (pan, zoom, reflow).
  useEffect(() => {
    if (!id || typeof document === 'undefined') return;
    let raf = 0;
    let lastSize = '';
    let marked: HTMLElement | null = null;
    const hide = () => {
      frameRef.current?.style.setProperty('display', 'none');
      for (const el of handleEls.current.values()) el.style.display = 'none';
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const m = measureArtboard(document, id);
      if (!m) return hide();
      if (marked !== m.article) {
        marked?.removeAttribute('data-ed-selected');
        marked?.removeAttribute('data-ed-size');
        m.article.setAttribute('data-ed-selected', '');
        marked = m.article;
        lastSize = '';
      }
      // S7.23: a print artboard says its size on paper ("105 × 148 mm"), not in px
      let size =
        videoLengthWords(m.article, id) ||
        physicalSizeWords({ attrs: attrsOf(m.article) }) ||
        sizeText(m.box.w, m.box.h);
      size = chipSize(dragRef.current?.last?.box, size);
      // a video's rule draws its tail flush (it carries its own gap): a plain size still needs one
      if (m.article.getAttribute('data-dc-kind') === 'video' && !size.startsWith('\u00a0'))
        size = `\u00a0${size}`;
      if (size !== lastSize) {
        lastSize = size;
        const label = m.article.querySelector(':scope > .dc-artboard-label');
        label?.setAttribute('data-ed-size', size);
      }
      if (!active) return hide();
      const { left, top, width, height } = m.rect;
      const frame = frameRef.current;
      if (frame) {
        frame.style.display = 'block';
        frame.style.left = `${Math.round(left)}px`;
        frame.style.top = `${Math.round(top)}px`;
        frame.style.width = `${Math.round(width)}px`;
        frame.style.height = `${Math.round(height)}px`;
      }
      const cx = left + width / 2;
      const cy = top + height / 2;
      const at: Record<Handle, [number, number]> = {
        nw: [left, top],
        n: [cx, top],
        ne: [left + width, top],
        e: [left + width, cy],
        se: [left + width, top + height],
        s: [cx, top + height],
        sw: [left, top + height],
        w: [left, cy],
      };
      for (const h of HANDLES) {
        const el = handleEls.current.get(h);
        if (!el) continue;
        el.style.display = 'block';
        el.style.left = `${Math.round(at[h][0])}px`;
        el.style.top = `${Math.round(at[h][1])}px`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      marked?.removeAttribute('data-ed-selected');
      const label = marked?.querySelector(':scope > .dc-artboard-label');
      label?.removeAttribute('data-ed-size');
    };
  }, [id, active]);

  const finish = useCallback(
    async (d: Drag, commit: boolean) => {
      dragRef.current = null;
      setHud(null);
      if (id) postLiveSize(liveSizeMessage(id, null));
      const r = d.last;
      if (!commit || !r || !id) return restorePreview(d.m, d.saved);
      const params = resizeParams(id, d.m.box, r);
      const origin = movedOrigin(d.m.box, r.box);
      if (!params && !origin) return restorePreview(d.m, d.saved);
      // the origin first (layout lane: positions only), then the size — one write each, in their own lanes
      // S2.9b — a resize is not a rider (contract §2): members keep their world positions.
      if (origin)
        dragBus?.commitPositions([{ id, ...origin }], { label: 'resize artboard', riders: false });
      if (params) {
        const res = await runEditOp({ op: 'artboard.resize', targets: [], params });
        // a refused write gives the page back its old size; a move already sent to the layout lane stays (⌘Z)
        if (!res.ok) restorePreview(d.m, d.saved);
      }
    },
    [dragBus, id]
  );

  const onDown = (handle: Handle) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!id || e.button !== 0) return;
    const m = measureArtboard(document, id);
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events may reject capture */
    }
    dragRef.current = {
      pointerId: e.pointerId,
      handle,
      m,
      saved: savePreview(m),
      startX: e.clientX,
      startY: e.clientY,
      last: null,
    };
  };

  // move / up / esc on the window: the pointer leaves the handle the moment the board resizes under it
  useEffect(() => {
    if (!id) return;
    const modsOf = (e: PointerEvent | KeyboardEvent): DragMods => ({
      alt: e.altKey,
      meta: e.metaKey || e.ctrlKey,
      shift: e.shiftKey,
    });
    const run = (d: Drag, e: PointerEvent) => {
      const dx = (e.clientX - d.startX) / d.m.zoom;
      const dy = (e.clientY - d.startY) / d.m.zoom;
      const mods = modsOf(e);
      const r = computeArtboardResize(d.m.box, d.handle, dx, dy, mods, d.m.zoom);
      d.last = r;
      applyPreview(d.m, r.box, r.heightChanged);
      postLiveSize(liveSizeMessage(id, d.last));
      const scr = {
        left: d.m.rect.left + (r.box.x - d.m.box.x) * d.m.zoom,
        top: d.m.rect.top + (r.box.y - d.m.box.y) * d.m.zoom,
        width: r.box.w * d.m.zoom,
        height: r.box.h * d.m.zoom,
      };
      const horizontal = d.handle.includes('e') || d.handle.includes('w');
      setHud({
        ghost: d.m.rect,
        rect: scr,
        box: r.box,
        preset: r.preset,
        stops: horizontal ? rulerStops(r.box.w, d.m.zoom, r.preset) : [],
        pointer: { x: e.clientX, y: e.clientY },
        edge: horizontal ? (d.handle.includes('e') ? 'e' : 'w') : null,
        presetsOff: mods.meta,
      });
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      e.preventDefault();
      run(d, e);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      void finish(d, e.type === 'pointerup');
    };
    const onKey = (e: KeyboardEvent) => {
      const d = dragRef.current;
      if (!d || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      void finish(d, false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [id, finish]);

  if (!id) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      {active ? (
        <>
          <div
            ref={frameRef}
            className="ed-ab-frame"
            data-testid="ed-ab-frame"
            aria-hidden="true"
          />
          {HANDLES.map((h) => (
            <div
              key={h}
              ref={(el) => {
                if (el) handleEls.current.set(h, el);
                else handleEls.current.delete(h);
              }}
              className="ed-ab-handle"
              data-h={h}
              data-testid={`ed-ab-handle-${h}`}
              aria-hidden="true"
              style={{ display: 'none', cursor: CURSOR[h] }}
              onPointerDown={onDown(h)}
            />
          ))}
        </>
      ) : null}
      {hud ? <PresetRuler hud={hud} /> : null}
    </>
  );
}
