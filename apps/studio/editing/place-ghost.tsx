// editing/place-ghost.tsx — S2.16: placing a component from the picker (⇧I; artboard ed-comp-pick).
//
// The shell's Component picker (client/v2/inspector/component-picker.jsx) hands a pick down as
// `place-component {component, label, variant?, glyph?, mode}` (dgn, shell → canvas, parent-gated). Two ways in:
//
//   mode 'ghost'      the pick follows the pointer until a click: a dashed ghost with its name, a guide down
//                     the artboard's centre, and a snap onto that guide (within SNAP_PX) so a button lands
//                     centred without a measurement. A click places it; esc lets go. Over an auto layout
//                     (a flex / grid frame) the click puts it INTO that frame, in the flow; anywhere else it is
//                     placed freely in the artboard (position: absolute, left / top, or centred).
//   mode 'selection'  ↵ in the picker: into the selected frame, after its last child, in the flow.
//
// Both end in ONE `component.insert` edit-op (edit-ops/insert-component.ts): the import, the instance and
// — on a canvas left out of the design system's current revision — `data-ds-rev="head"`, in one write and
// ONE undo step (editOpRecord → a revert record on a legacy link; the kernel action on the op log).
// The canvas never writes source; it measures the drop and asks the shell.

import { useCallback, useEffect, useRef, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import type { CommandRecord } from '../undo-stack.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement, selectWhenRendered } from './object-actions.ts';
import { refsOf } from './object-ops.ts';

export const PLACE_ACTION = 'component.insert' as const;

/** Within this many SCREEN px of the artboard's centre line the pick snaps onto it. */
export const SNAP_PX = 8;

export const NEEDS_FRAME_LINE = 'Select a frame to put it in.';
export const OUTSIDE_LINE = 'Click inside an artboard to place it.';
export const ONE_FRAME_LINE = 'Select one frame to put it in.';
export const CANNOT_HOLD_LINE = 'That object cannot hold anything; select a frame.';

export interface PlaceRequest {
  component: string;
  label: string;
  variant: string | null;
  glyph: string | null;
  mode: 'ghost' | 'selection';
}

/** The fields of a `place-component` the parent-gated listener below accepted, or null when malformed. */
export function requestFrom(m: unknown): PlaceRequest | null {
  const x = m as Record<string, unknown> | null;
  if (typeof x?.component !== 'string') return null;
  if (x.mode !== 'ghost' && x.mode !== 'selection') return null;
  return {
    component: x.component,
    label: typeof x.label === 'string' && x.label ? x.label : x.component,
    variant: typeof x.variant === 'string' ? x.variant : null,
    glyph: typeof x.glyph === 'string' ? x.glyph : null,
    mode: x.mode,
  };
}

// ── where a click lands ───────────────────────────────────────────────────────────────────────

/** `'centre'` within SNAP_PX screen px of the body's centre line, else the rounded world x. */
export function snapX(
  localWorldX: number,
  bodyWorldWidth: number,
  scale: number,
  snapPx: number = SNAP_PX
): 'centre' | number {
  const k = scale > 0 ? scale : 1;
  return Math.abs(localWorldX - bodyWorldWidth / 2) * k <= snapPx
    ? 'centre'
    : Math.round(localWorldX);
}

export interface Drop {
  artboard: string;
  body: HTMLElement;
  /** the auto-layout frame under the pointer (the drop goes INTO it), or null (placed freely) */
  frame: HTMLElement | null;
}

const isAutoLayout = (el: Element, win: Window): boolean => {
  const d = win.getComputedStyle(el).display;
  return d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid';
};

/** The artboard under (x, y) and the stamped auto-layout frame inside it that holds the point, if any. */
export function dropAt(doc: Document, x: number, y: number, win: Window = window): Drop | null {
  const stack = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : [];
  let body: HTMLElement | null = null;
  let hit: Element | null = null;
  for (const el of stack) {
    const b = el.closest('.dc-artboard-body') as HTMLElement | null;
    if (b) {
      body = b;
      hit = el;
      break;
    }
  }
  const artboard = body?.closest('[data-dc-screen]')?.getAttribute('data-dc-screen');
  if (!body || !artboard || !hit) return null;
  let frame: HTMLElement | null = null;
  for (let el: Element | null = hit; el && el !== body; el = el.parentElement) {
    if (el.hasAttribute('data-cd-id') && isAutoLayout(el, win)) {
      frame = el as HTMLElement;
      break;
    }
  }
  return { artboard, body, frame };
}

/** The edit-op ask for a click at screen (x, y) over `drop`. */
export function askForDrop(
  req: PlaceRequest,
  drop: Drop,
  at: { x: number; y: number },
  win: Window = window
): EditOpAsk | null {
  const params: Record<string, unknown> = { component: req.component, artboard: drop.artboard };
  if (req.variant) params.variant = req.variant;
  if (req.glyph) params.glyph = req.glyph;
  let targets: ElementRef[] = [];
  if (drop.frame) {
    const ref = refOfElement(drop.frame);
    if (!ref) return null;
    targets = [ref];
  } else {
    const r = drop.body.getBoundingClientRect();
    const k = drop.body.offsetWidth > 0 && r.width > 0 ? r.width / drop.body.offsetWidth : 1;
    const lx = (at.x - r.left) / k;
    const ly = (at.y - r.top) / k;
    const cx = snapX(lx, drop.body.offsetWidth, k);
    params.at = { x: cx, y: Math.round(ly) };
  }
  void win;
  return { op: PLACE_ACTION, targets, params };
}

/** ↵: into the one selected frame (after its last child), or the selected artboard. */
export function askForSelection(
  req: PlaceRequest,
  selected: readonly Selection[]
): { ask: EditOpAsk } | { line: string } {
  const params: Record<string, unknown> = { component: req.component };
  if (req.variant) params.variant = req.variant;
  if (req.glyph) params.glyph = req.glyph;
  if (selected.length === 0) return { line: NEEDS_FRAME_LINE };
  if (selected.length > 1) return { line: ONE_FRAME_LINE };
  const refs = refsOf(selected);
  const only = selected[0] as Selection;
  if (refs.length === 1) return { ask: { op: PLACE_ACTION, targets: refs, params } };
  if (!only.id && only.artboardId)
    return {
      ask: { op: PLACE_ACTION, targets: [], params: { ...params, artboard: only.artboardId } },
    };
  return { line: NEEDS_FRAME_LINE };
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────

export interface PlaceDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
  select?: (refs: ElementRef[]) => void;
}

/** One placement: ask, say what went wrong in one line, record ONE undo step, select the new instance. */
export async function runPlace(
  req: PlaceRequest,
  ask: EditOpAsk,
  deps: PlaceDeps = {}
): Promise<EditOpResult> {
  const run = deps.run ?? ((a: EditOpAsk) => runEditOp(a));
  const result = await run(ask);
  if (!result.ok) {
    deps.toast?.(result.message || CANNOT_HOLD_LINE, 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    const rec = editOpRecord(result.writeId, `Place ${req.label}`);
    if (rec) deps.record?.(rec);
  }
  if (result.created?.length) deps.select?.(result.created);
  return result;
}

// ── chrome ────────────────────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
.ed-place-ghost {
  position: fixed;
  z-index: 6;
  pointer-events: none;
  padding: 4px 10px;
  border: 1.5px dashed var(--accent, #4a7bff);
  border-radius: 6px;
  background: var(--accent-muted, rgba(74, 123, 255, 0.12));
  color: var(--fg-0, #111);
  font: 500 11px/16px var(--maude-chrome-font, system-ui, sans-serif);
  white-space: nowrap;
}
.ed-place-ghost[data-snapped] { border-style: solid; }
.ed-place-guide {
  position: fixed;
  z-index: 5;
  pointer-events: none;
  width: 1px;
  background: var(--guide, var(--guide-magenta, #ff24bd));
  opacity: 0.45;
}
.ed-place-guide[data-snapped] { opacity: 1; }
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-place-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-place-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

interface Hover {
  x: number;
  y: number;
  /** the artboard body the pointer is over, in screen px */
  box: { left: number; top: number; width: number; height: number } | null;
  snapped: boolean;
  /** dropping into an auto-layout frame: no snap, no guide */
  inFlow: boolean;
}

function hoverAt(doc: Document, x: number, y: number): Hover {
  const drop = dropAt(doc, x, y);
  if (!drop) return { x, y, box: null, snapped: false, inFlow: false };
  const r = drop.body.getBoundingClientRect();
  const k = drop.body.offsetWidth > 0 && r.width > 0 ? r.width / drop.body.offsetWidth : 1;
  const snapped = !drop.frame && snapX((x - r.left) / k, drop.body.offsetWidth, k) === 'centre';
  return {
    x,
    y,
    box: { left: r.left, top: r.top, width: r.width, height: r.height },
    snapped,
    inFlow: !!drop.frame,
  };
}

export function PlaceGhost({ readOnly }: { readOnly?: boolean }) {
  ensureStyles();
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const live = useRef({ selSet, undo });
  live.current = { selSet, undo };
  const [req, setReq] = useState<PlaceRequest | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  // stable: it reads the live refs, so the effects below subscribe once per request, not per render
  const deps = useCallback(
    (): PlaceDeps => ({
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => live.current.undo?.record(rec),
      select: (refs) => selectWhenRendered(refs, (s) => live.current.selSet.replace(s)),
    }),
    []
  );

  // the shell's pick
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (
        e.source !== window.parent ||
        (e.data as { dgn?: unknown } | null)?.dgn !== 'place-component'
      )
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'place-component' || isReadOnlyCanvas()) return;
      const r = requestFrom(m);
      if (!r) return;
      if (r.mode === 'ghost') {
        setHover(null);
        setReq(r);
        return;
      }
      const target = askForSelection(r, live.current.selSet.selected);
      if ('line' in target) showCanvasToast(target.line, 'info');
      else void runPlace(r, target.ask, deps());
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [deps]);

  // armed: follow the pointer, click places, esc lets go
  useEffect(() => {
    if (!req || readOnly) return undefined;
    let swallowClick = 0;
    const move = (e: PointerEvent) => setHover(hoverAt(document, e.clientX, e.clientY));
    const leave = () => setHover(null);
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      swallowClick = Date.now();
      const drop = dropAt(document, e.clientX, e.clientY);
      if (!drop) {
        showCanvasToast(OUTSIDE_LINE, 'info');
        return;
      }
      const ask = askForDrop(req, drop, { x: e.clientX, y: e.clientY });
      setReq(null);
      setHover(null);
      if (ask) void runPlace(req, ask, deps());
    };
    const click = (e: MouseEvent) => {
      if (Date.now() - swallowClick < 600) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setReq(null);
      setHover(null);
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, [req, readOnly, deps]);

  if (!req || !hover) return null;
  const centreX = hover.box ? hover.box.left + hover.box.width / 2 : 0;
  const GHOST_W = 120;
  const left = hover.snapped ? centreX - GHOST_W / 2 : hover.x;
  return (
    <div aria-hidden="true">
      {hover.box && !hover.inFlow ? (
        <i
          className="ed-place-guide"
          data-testid="edit-place-guide"
          data-snapped={hover.snapped ? 'true' : undefined}
          style={{ left: centreX, top: hover.box.top, height: hover.box.height }}
        />
      ) : null}
      <span
        className="ed-place-ghost"
        data-testid="edit-place-ghost"
        data-snapped={hover.snapped ? 'true' : undefined}
        style={{ left, top: hover.y, minWidth: GHOST_W - 20 }}
      >
        {req.label}
      </span>
    </div>
  );
}
