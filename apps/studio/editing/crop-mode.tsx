// editing/crop-mode.tsx — crop mode (S2.15; artboard ed-img: "double-click it").
//
//   Enter     double-click a picture that is already selected (the drill has reached it) · More › Crop, then a click on a
//             picture · ⌘K "Crop" / the inspector's Crop with a picture selected.
//   In        the whole picture shows faded beyond the frame, the frame wears four brackets, and the picture has four
//             corner handles. Drag the picture to move it inside the frame; drag a corner to zoom it (the opposite corner
//             stays). The real element follows live (inline style), so what the frame shows is what will be saved.
//   Out       ↵ saves — ONE `image.crop` edit-op, one undo step · esc puts everything back as it was.
//
// The inspector's Fit control and its Zoom row do not use this: they ask the same op through `run-action` (`image.crop`
// with `params.fit` / `zoom`) and the canvas runs it here, so the undo record is made in one place.
//
// Nothing is written while the pointer is down. A read-only canvas never enters; a locked picture says so.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import {
  type Corner,
  type Crop,
  cornerPoint,
  cropFromStyle,
  cropParams,
  dragCorner,
  pan,
  pictureRect,
} from './crop-geometry.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement } from './object-actions.ts';
import { refsOf } from './object-ops.ts';
import { isLockedDom } from './selection.tsx';

export const CROP_ACTION = 'image.crop' as const;
export const LOCKED_LINE = 'That picture is locked. Unlock it to crop it.';
export const LOADING_LINE = 'That picture is still loading. Try again in a moment.';
export const SELECT_PICTURE_LINE = 'Select a picture to crop.';

/** A picture crop mode can work on: an `<img>` with an authored id (a tile has no crop). */
export function isCroppable(el: Element | null | undefined): el is HTMLImageElement {
  return !!el && el.tagName === 'IMG' && el.hasAttribute('data-cd-id');
}

const refSelector = (r: ElementRef): string =>
  `[data-dc-screen="${CSS.escape(r.artboard)}"] [data-cd-id="${CSS.escape(r.element)}"]`;

/** The DOM node a ref names (the n-th of a repeated id). */
export function elementOfRef(r: ElementRef, doc: Document = document): Element | null {
  try {
    const all = doc.querySelectorAll(refSelector(r));
    return all[r.occurrence ?? 0] ?? all[0] ?? null;
  } catch {
    return null;
  }
}

// ── the box the picture is cropped to ──────────────────────────────────────────────────────

export interface BoxRect {
  left: number;
  top: number;
  w: number;
  h: number;
}

/** The picture's own box in screen px, measured with its zoom taken off (the zoom grows its rectangle). */
export function measureBox(el: HTMLElement): BoxRect {
  const keep = el.style.transform;
  if (keep) el.style.transform = 'none';
  const r = el.getBoundingClientRect();
  if (keep) el.style.transform = keep;
  return { left: r.left, top: r.top, w: r.width, h: r.height };
}

const applyCrop = (el: HTMLElement, c: Crop): void => {
  el.style.objectFit = 'cover';
  el.style.objectPosition = `${c.x}% ${c.y}%`;
  el.style.transform = c.zoom > 1 ? `scale(${c.zoom})` : '';
  el.style.transformOrigin = c.zoom > 1 ? `${c.x}% ${c.y}%` : '';
};

interface Saved {
  objectFit: string;
  objectPosition: string;
  transform: string;
  transformOrigin: string;
}
const saveStyle = (el: HTMLElement): Saved => ({
  objectFit: el.style.objectFit,
  objectPosition: el.style.objectPosition,
  transform: el.style.transform,
  transformOrigin: el.style.transformOrigin,
});
const restoreStyle = (el: HTMLElement, s: Saved): void => {
  el.style.objectFit = s.objectFit;
  el.style.objectPosition = s.objectPosition;
  el.style.transform = s.transform;
  el.style.transformOrigin = s.transformOrigin;
};

// ── one run of the op ──────────────────────────────────────────────────────────────────────

export interface CropDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: ReturnType<typeof editOpRecord>) => void;
}

/** Ask `image.crop` for `targets`; say a refusal in one line; record ONE undo step. */
export async function runCrop(
  targets: ElementRef[],
  params: Record<string, unknown>,
  deps: CropDeps = {}
): Promise<EditOpResult> {
  const run = deps.run ?? ((a: EditOpAsk) => runEditOp(a));
  const result = await run({ op: CROP_ACTION, targets, params });
  if (!result.ok) {
    deps.toast?.(result.message, 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    const rec = editOpRecord(result.writeId, 'Crop picture');
    if (rec) deps.record?.(rec);
  }
  return result;
}

// ── chrome ─────────────────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
.ed-crop-ghost {
  position: fixed;
  z-index: 5;
  pointer-events: auto;
  cursor: grab;
  opacity: 0.38;
  user-select: none;
  -webkit-user-drag: none;
}
.ed-crop-ghost[data-dragging] { cursor: grabbing; }
.ed-crop-frame {
  position: fixed;
  z-index: 6;
  pointer-events: none;
  box-shadow: 0 0 0 1.5px var(--accent, #4a7bff);
}
.ed-crop-bracket {
  position: fixed;
  z-index: 7;
  width: 14px;
  height: 14px;
  pointer-events: none;
  border: 0 solid var(--accent, #4a7bff);
}
.ed-crop-bracket[data-c="nw"] { border-top-width: 3px; border-left-width: 3px; }
.ed-crop-bracket[data-c="ne"] { border-top-width: 3px; border-right-width: 3px; }
.ed-crop-bracket[data-c="se"] { border-bottom-width: 3px; border-right-width: 3px; }
.ed-crop-bracket[data-c="sw"] { border-bottom-width: 3px; border-left-width: 3px; }
.ed-crop-handle {
  position: fixed;
  z-index: 8;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border: 1.5px solid var(--accent, #4a7bff);
  border-radius: 2px;
  background: var(--bg-0, #fff);
  touch-action: none;
}
.ed-crop-handle[data-c="nw"], .ed-crop-handle[data-c="se"] { cursor: nwse-resize; }
.ed-crop-handle[data-c="ne"], .ed-crop-handle[data-c="sw"] { cursor: nesw-resize; }
.ed-crop-tag {
  position: fixed;
  z-index: 8;
  pointer-events: none;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--accent, #4a7bff);
  color: var(--accent-fg, #fff);
  font: 500 11px/16px var(--maude-chrome-font, system-ui, sans-serif);
  white-space: nowrap;
}
.ed-crop-hint {
  position: fixed;
  z-index: 8;
  pointer-events: none;
  padding: 3px 10px;
  border-radius: 8px;
  background: var(--bg-3, #222);
  color: var(--fg-0, #fff);
  font: 500 11px/16px var(--maude-chrome-font, system-ui, sans-serif);
  white-space: nowrap;
}
.ed-crop-hint kbd {
  font: inherit;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--bg-4, #444);
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-crop-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-crop-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

// ── the mode ───────────────────────────────────────────────────────────────────────────────

interface Active {
  el: HTMLImageElement;
  ref: ElementRef;
  nat: { w: number; h: number };
  saved: Saved;
  start: Crop;
  src: string;
  name: string;
}

type Drag =
  | { kind: 'pan'; x: number; y: number; from: Crop }
  | { kind: 'corner'; corner: Corner; from: Crop };

export function CropMode({ readOnly }: { readOnly?: boolean }) {
  ensureStyles();
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const tm = useToolModeOptional();
  const live = useRef({ selSet, undo, tm });
  live.current = { selSet, undo, tm };
  const [active, setActive] = useState<Active | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 50, y: 50 });
  const [box, setBox] = useState<BoxRect | null>(null);
  const [dragging, setDragging] = useState(false);
  const activeRef = useRef<Active | null>(null);
  const cropRef = useRef(crop);
  activeRef.current = active;
  cropRef.current = crop;
  const drag = useRef<Drag | null>(null);

  const deps = useCallback(
    (): CropDeps => ({
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => rec && live.current.undo?.record(rec),
    }),
    []
  );

  /** Open crop mode on `el`; false (and a line) when it cannot be. */
  const enter = useCallback(
    (el: Element | null): boolean => {
      if (isReadOnlyCanvas() || readOnly) return false;
      if (!isCroppable(el)) {
        showCanvasToast(SELECT_PICTURE_LINE, 'info');
        return false;
      }
      if (isLockedDom(el)) {
        showCanvasToast(LOCKED_LINE, 'info');
        return false;
      }
      const ref = refOfElement(el);
      if (!ref) return false;
      const nat = { w: el.naturalWidth, h: el.naturalHeight };
      if (!nat.w || !nat.h) {
        showCanvasToast(LOADING_LINE, 'info');
        return false;
      }
      const start = cropFromStyle(el.style);
      const next: Active = {
        el,
        ref,
        nat,
        saved: saveStyle(el),
        start,
        src: el.currentSrc || el.src,
        name: el.getAttribute('alt') || ref.element,
      };
      applyCrop(el, start);
      setActive(next);
      setCrop(start);
      setBox(measureBox(el));
      live.current.tm?.setTool('move' as never);
      return true;
    },
    [readOnly]
  );

  const leave = useCallback((restore: boolean) => {
    const a = activeRef.current;
    if (a && restore) restoreStyle(a.el, a.saved);
    drag.current = null;
    setDragging(false);
    setActive(null);
    setBox(null);
  }, []);

  const commit = useCallback(async () => {
    const a = activeRef.current;
    if (!a) return;
    const c = cropRef.current;
    leave(false);
    const r = await runCrop([a.ref], cropParams(c), deps());
    if (!r.ok) restoreStyle(a.el, a.saved);
  }, [deps, leave]);

  // the shell's ask (⌘K, the inspector): with params it is the op; without, crop mode on the selection
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'run-action')
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'run-action' || m.id !== CROP_ACTION || isReadOnlyCanvas()) return;
      const p = (m.params ?? {}) as {
        targets?: unknown;
        fit?: unknown;
        zoom?: unknown;
        x?: unknown;
        y?: unknown;
      };
      const named = Array.isArray(p.targets) ? (p.targets as ElementRef[]) : null;
      const asked: Record<string, unknown> = {};
      for (const k of ['fit', 'zoom', 'x', 'y'] as const) if (p[k] !== undefined) asked[k] = p[k];
      if (Object.keys(asked).length > 0) {
        const targets = named ?? refsOf(live.current.selSet.selected);
        if (targets.length === 0) return void showCanvasToast(SELECT_PICTURE_LINE, 'info');
        void runCrop(targets, asked, deps());
        return;
      }
      const ref = named?.[0] ?? refsOf(live.current.selSet.selected)[0];
      enter(ref ? elementOfRef(ref) : null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [deps, enter]);

  // a double-click on a picture that is already selected (the drill has reached it) opens crop mode
  useEffect(() => {
    if (typeof document === 'undefined' || readOnly) return undefined;
    const onDbl = (e: MouseEvent) => {
      if (activeRef.current || isReadOnlyCanvas()) return;
      const t = (e.target as Element | null)?.closest?.('[data-cd-id]') ?? null;
      if (!isCroppable(t)) return;
      const only = live.current.selSet.selected;
      if (only.length !== 1 || only[0]?.id !== t.getAttribute('data-cd-id')) return;
      e.preventDefault();
      e.stopPropagation();
      enter(t);
    };
    document.addEventListener('dblclick', onDbl, true);
    return () => document.removeEventListener('dblclick', onDbl, true);
  }, [enter, readOnly]);

  // More › Crop is armed: the first picture selected opens crop mode
  const tool = tm?.tool;
  const selected = selSet.selected;
  const handled = useRef('');
  useEffect(() => {
    if (tool !== ('crop' as never) || active || readOnly) {
      if (tool !== ('crop' as never)) handled.current = '';
      return;
    }
    if (selected.length === 0) return;
    const key = JSON.stringify(refsOf(selected));
    if (key === handled.current) return;
    handled.current = key;
    const ref = refsOf(selected)[0];
    const el = ref ? elementOfRef(ref) : null;
    if (selected.length === 1 && isCroppable(el)) enter(el);
    else showCanvasToast(SELECT_PICTURE_LINE, 'info');
  }, [tool, selected, active, readOnly, enter]);

  // keys, and the frame following the page while it pans or zooms
  useEffect(() => {
    if (!active) return undefined;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        leave(true);
      }
    };
    document.addEventListener('keydown', key, true);
    let raf = 0;
    const tick = () => {
      if (!drag.current)
        setBox((b) => {
          const n = measureBox(active.el);
          return b && b.left === n.left && b.top === n.top && b.w === n.w && b.h === n.h ? b : n;
        });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      document.removeEventListener('keydown', key, true);
      cancelAnimationFrame(raf);
    };
  }, [active, commit, leave]);

  // the picture went away under us (a reload): drop out without writing
  // biome-ignore lint/correctness/useExhaustiveDependencies: `box` is the per-frame tick that re-checks the connection
  useEffect(() => {
    if (active && !active.el.isConnected) leave(false);
  }, [active, leave, box]);

  const move = useCallback((e: PointerEvent) => {
    const a = activeRef.current;
    const d = drag.current;
    if (!a || !d) return;
    const b = measureBox(a.el);
    const rel = { w: b.w, h: b.h };
    const next =
      d.kind === 'pan'
        ? pan(rel, a.nat, d.from, e.clientX - d.x, e.clientY - d.y)
        : dragCorner(rel, a.nat, d.from, d.corner, e.clientX - b.left, e.clientY - b.top);
    applyCrop(a.el, next);
    setCrop(next);
    setBox(b);
  }, []);
  const up = useCallback(() => {
    drag.current = null;
    setDragging(false);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
  }, [move]);
  const begin = (d: Drag) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // the press point and the crop AT the press, not at render
    drag.current =
      d.kind === 'pan'
        ? { kind: 'pan', x: e.clientX, y: e.clientY, from: cropRef.current }
        : { ...d, from: cropRef.current };
    setDragging(true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  };

  const rect = useMemo(
    () => (active && box ? pictureRect({ w: box.w, h: box.h }, active.nat, crop) : null),
    [active, box, crop]
  );

  if (!active || !box || !rect) return null;
  const pic = { left: box.left + rect.left, top: box.top + rect.top, w: rect.w, h: rect.h };
  const corners: Corner[] = ['nw', 'ne', 'se', 'sw'];
  const boxCorner = (c: Corner) =>
    cornerPoint({ left: box.left, top: box.top, w: box.w, h: box.h }, c);
  return (
    <div data-testid="edit-crop-mode" data-dc-chrome>
      <img
        className="ed-crop-ghost"
        data-testid="edit-crop-ghost"
        data-dragging={dragging ? 'true' : undefined}
        src={active.src}
        alt=""
        draggable={false}
        style={{ left: pic.left, top: pic.top, width: pic.w, height: pic.h }}
        onPointerDown={begin({ kind: 'pan', x: 0, y: 0, from: crop })}
      />
      <i
        className="ed-crop-frame"
        data-testid="edit-crop-frame"
        style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
      />
      {corners.map((c) => {
        const p = boxCorner(c);
        return (
          <i
            key={`b${c}`}
            className="ed-crop-bracket"
            data-c={c}
            data-testid={`edit-crop-bracket-${c}`}
            style={{
              left: c === 'nw' || c === 'sw' ? p.x - 1 : p.x - 13,
              top: c === 'nw' || c === 'ne' ? p.y - 1 : p.y - 13,
            }}
          />
        );
      })}
      {corners.map((c) => {
        const p = cornerPoint({ left: pic.left, top: pic.top, w: pic.w, h: pic.h }, c);
        return (
          <i
            key={`h${c}`}
            className="ed-crop-handle"
            data-c={c}
            data-testid={`edit-crop-handle-${c}`}
            style={{ left: p.x, top: p.y }}
            onPointerDown={begin({ kind: 'corner', corner: c, from: crop })}
          />
        );
      })}
      <span
        className="ed-crop-tag"
        data-testid="edit-crop-tag"
        style={{ left: box.left, top: box.top - 24 }}
      >
        {active.name} · crop
      </span>
      <span
        className="ed-crop-hint"
        data-testid="edit-crop-hint"
        style={{ left: box.left, top: box.top + box.h + 10 }}
      >
        <kbd>↵</kbd> done · <kbd>esc</kbd> cancel
      </span>
    </div>
  );
}
