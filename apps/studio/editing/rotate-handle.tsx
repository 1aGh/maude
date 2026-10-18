// editing/rotate-handle.tsx — the rotate handle (S2.7, artboard ed-obj-multi).
//
// A small round handle just outside the bottom-right corner of the selection. Hover says
// "Rotate · ⇧ 15°"; drag turns the selection and shows the angle; ⇧ snaps to 15°; esc cancels. One
// object turns to an absolute angle; several each turn BY the same angle about their own centre.
// The write is one `object.rotate` edit-op (edit-ops/rotate.ts), which keeps the rest of the
// transform and shares `withRotation` with the inspector's Rotation row, so the two always agree.
//
// The v1 invisible rotate zones at an element's corners (`use-element-resize.tsx`) stay in the DOM
// but are switched off while this handle is on screen, so there is one rotate gesture, not two.

import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { showCanvasToast } from '../canvas-notifications.tsx';
import { isElementDragActive } from '../drag-state.ts';
import { rotationOf, withRotation } from '../edit-ops/words-css.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { pointerAngleRad, rotateDeltaDeg } from '../use-element-resize.tsx';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { type ObjectTarget, objectTargets, runArranged } from './arrange.ts';

export const SNAP_DEGREES = 15;

/** The angle (−180…180] a ⇧ drag lands on, or the angle itself rounded to a whole degree. */
export function turnTo(
  startDeg: number,
  startPointerRad: number,
  curPointerRad: number,
  shift: boolean
): number {
  const deg = rotateDeltaDeg(startDeg, startPointerRad, curPointerRad, shift);
  return shift ? deg : Math.round(deg);
}

export interface RotateAsk {
  op: 'object.rotate';
  params: { degrees: number } | { by: number };
}

/** One object turns TO an angle; several turn BY the same angle (each about its own centre). */
export function rotateAsk(count: number, startDeg: number, toDeg: number): RotateAsk {
  if (count === 1) return { op: 'object.rotate', params: { degrees: toDeg } };
  let by = toDeg - startDeg;
  while (by > 180) by -= 360;
  while (by <= -180) by += 360;
  return { op: 'object.rotate', params: { by: Math.round(by * 100) / 100 } };
}

const CSS_TEXT = `
.ed-rot-handle {
  position: fixed; z-index: 7; width: 22px; height: 22px; margin: 0; padding: 0;
  display: none; align-items: center; justify-content: center;
  border: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.12)); border-radius: 50%;
  background: var(--maude-chrome-bg-0, #fff); color: var(--maude-chrome-fg-0, #1a1a1a);
  box-shadow: 0 2px 8px var(--maude-chrome-shadow, rgba(0,0,0,0.12));
  cursor: grab; touch-action: none; pointer-events: auto;
}
.ed-rot-handle:hover, .ed-rot-handle[data-on="true"] { color: var(--maude-hud-accent); border-color: var(--maude-hud-accent); }
.ed-rot-handle[data-on="true"] { cursor: grabbing; }
.ed-rot-hint {
  position: fixed; z-index: 7; display: none; pointer-events: none; white-space: nowrap;
  padding: 2px 6px; border-radius: 4px;
  background: var(--maude-chrome-fg-0, #1a1a1a); color: var(--maude-chrome-bg-0, #fff);
  font: 500 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}
.ed-rot-hint kbd {
  font: inherit; padding: 0 3px; margin: 0 1px; border-radius: 3px;
  background: color-mix(in oklab, var(--maude-chrome-bg-0, #fff) 22%, transparent);
}
.dc-el-resize-handle[data-corner^="rot-"] { pointer-events: none; }
`;

const HINT = (
  <>
    Rotate · <kbd>⇧</kbd> {SNAP_DEGREES}°
  </>
);

interface Turning {
  pointerId: number;
  cx: number;
  cy: number;
  startPointer: number;
  startDeg: number;
  /** the inline transform of each target before the drag */
  before: string[];
  targets: ObjectTarget[];
  deg: number;
}

const unionOf = (els: Element[]) => {
  let l = Number.POSITIVE_INFINITY;
  let t = Number.POSITIVE_INFINITY;
  let r = Number.NEGATIVE_INFINITY;
  let b = Number.NEGATIVE_INFINITY;
  for (const el of els) {
    const q = el.getBoundingClientRect();
    if (q.width === 0 && q.height === 0) continue;
    l = Math.min(l, q.left);
    t = Math.min(t, q.top);
    r = Math.max(r, q.right);
    b = Math.max(b, q.bottom);
  }
  return Number.isFinite(l) ? { l, t, r, b } : null;
};

export function RotateHandle({ readOnly = false }: { readOnly?: boolean }) {
  const { selected } = useSelectionSet();
  const undo = useUndoStackOptional();
  const tool = useToolModeOptional()?.tool;
  const targets = useMemo(
    () => (typeof document === 'undefined' ? [] : objectTargets(selected, document)),
    [selected]
  );
  const live = useRef({ targets, undo, tool });
  live.current = { targets, undo, tool };
  const handle = useRef<HTMLButtonElement | null>(null);
  const hint = useRef<HTMLDivElement | null>(null);
  const turning = useRef<Turning | null>(null);
  const [text, setText] = useState<'hint' | string | null>(null);

  const canRotate = !readOnly && targets.length > 0 && tool !== 'browse';

  // keep the handle at the selection's bottom-right corner, every frame (pan / zoom / write)
  useEffect(() => {
    const h = handle.current;
    const tip = hint.current;
    if (!h || !tip) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const els = live.current.targets.map((t) => t.el);
      const locked = els.some((e) => e.hasAttribute('data-cd-locked'));
      const mode = canvasModeStore(window).get().mode;
      const box =
        canRotate && !locked && !isElementDragActive() && (mode ?? 'edit') === 'edit'
          ? unionOf(els)
          : null;
      if (!box) {
        h.style.display = 'none';
        tip.style.display = 'none';
        return;
      }
      h.style.display = 'flex';
      h.style.left = `${Math.round(box.r + 8)}px`;
      h.style.top = `${Math.round(box.b + 8)}px`;
      tip.style.display = tip.dataset.show === 'true' ? 'block' : 'none';
      tip.style.left = `${Math.round(box.r + 36)}px`;
      tip.style.top = `${Math.round(box.b + 10)}px`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canRotate]);

  const restore = (t: Turning) => {
    t.targets.forEach((x, i) => {
      x.el.style.transform = t.before[i] ?? '';
    });
  };

  const finish = async (t: Turning, apply: boolean) => {
    turning.current = null;
    handle.current?.removeAttribute('data-on');
    setText(null);
    const changed = Math.abs(t.deg - t.startDeg) >= 0.5;
    if (!apply || !changed) return restore(t);
    const ask = rotateAsk(t.targets.length, t.startDeg, t.deg);
    const result = await runArranged(
      ask.op,
      'Rotate',
      t.targets.map((x) => x.ref),
      ask.params,
      {
        toast: (m, k) => showCanvasToast(m, k === 'error' ? 'error' : 'info'),
        record: (rec) => live.current.undo?.record(rec),
      }
    );
    if (!result?.ok) restore(t);
  };

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || turning.current) return;
    const ts = live.current.targets;
    const box = unionOf(ts.map((x) => x.el));
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const cx = (box.l + box.r) / 2;
    const cy = (box.t + box.b) / 2;
    const before = ts.map((x) => x.el.style.transform);
    const startDeg = ts.length === 1 ? rotationOf(before[0]) : 0;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events may reject capture */
    }
    handle.current?.setAttribute('data-on', 'true');
    turning.current = {
      pointerId: e.pointerId,
      cx,
      cy,
      startPointer: pointerAngleRad(cx, cy, e.clientX, e.clientY),
      startDeg,
      before,
      targets: ts,
      deg: startDeg,
    };
    setText(`${startDeg}°`);
  };

  // move / up / esc live on the window so a fast drag cannot leave the handle behind
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const t = turning.current;
      if (!t || e.pointerId !== t.pointerId) return;
      e.preventDefault();
      const to = turnTo(
        t.startDeg,
        t.startPointer,
        pointerAngleRad(t.cx, t.cy, e.clientX, e.clientY),
        e.shiftKey
      );
      t.deg = to;
      const by = to - t.startDeg;
      t.targets.forEach((x, i) => {
        const own = t.targets.length === 1 ? to : rotationOf(t.before[i]) + by;
        x.el.style.transform = withRotation(t.before[i], own) ?? '';
      });
      setText(`${t.targets.length === 1 ? to : Math.round(by * 100) / 100}°`);
    };
    const onUp = (e: PointerEvent) => {
      const t = turning.current;
      if (t && e.pointerId === t.pointerId) void finish(t, true);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = turning.current;
      if (t && e.key === 'Escape') {
        e.stopPropagation();
        void finish(t, false);
      }
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
  });

  // ⌘K "Rotate 90°" (and any caller that names an angle): the shell's run-action
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'run-action')
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'run-action' || m.id !== 'object.rotate' || isReadOnlyCanvas()) return;
      const ts = live.current.targets;
      if (ts.length === 0) return;
      const p = (m.params ?? {}) as Record<string, unknown>;
      const params: Record<string, unknown> =
        typeof p.degrees === 'number'
          ? { degrees: p.degrees }
          : { by: typeof p.by === 'number' ? p.by : 90 };
      void runArranged(
        'object.rotate',
        'Rotate',
        ts.map((x) => x.ref),
        params,
        {
          toast: (msg, k) => showCanvasToast(msg, k === 'error' ? 'error' : 'info'),
          record: (rec) => live.current.undo?.record(rec),
        }
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (readOnly) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <button
        ref={handle}
        type="button"
        className="ed-rot-handle"
        data-testid="edit-rotate-handle"
        aria-label="Rotate"
        onPointerDown={onDown}
        onPointerEnter={() => setText((t) => t ?? 'hint')}
        onPointerLeave={() => setText((t) => (turning.current ? t : null))}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
      <div
        ref={hint}
        className="ed-rot-hint"
        data-testid={text === 'hint' ? 'edit-rotate-hint' : 'edit-rotate-angle'}
        data-show={text ? 'true' : 'false'}
        aria-hidden="true"
      >
        {text === 'hint' ? HINT : text}
      </div>
    </>
  );
}
