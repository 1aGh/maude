// editing/reorder-slot.tsx — drag to reorder: the slot opens (S2.11, artboard ed-lay-reorder).
//
//   "The card lifts and follows the pointer; the others slide over and an empty slot opens where it
//    will land, with the gaps measured. Layers shows the same slot."
//
// `ReorderDrag` (canvas-shell.tsx, DDR-138) is still the gesture: it floats the card on a transform
// (so its layout box stays reserved) and, once the pointer rests, really moves the node so the
// neighbours reflow. This file is the skin on top of that and the two drops it gained:
//   · the SLOT — the card's own layout box (the transform taken off) is where it will land; it is
//     drawn as an empty, numbered place ("1"), and a tag follows the card: "Small apps · moves to 1
//     of 3". Neighbours slide on `--dur-panel` with `--ease-out` (`panelMotion`); with reduced motion
//     they jump (canvas-shell's reflow already skips the animation) and the slot FADES in — an
//     opacity change, not movement, so it stays.
//   · ⌥ at the drop — a copy goes into the slot, the original stays (`object.reorder-to`, copy).
//   · a drop OUTSIDE the frame — the card is placed freely where it was let go (`object.place-freely`).
//   · esc puts it back (canvas-shell's cancel) and nothing is written.
// Plain drops keep the v1 `reorder-request` write — one write, one action, nothing deleted.
//
// Pure where it can be (the line, the numbering, the slot rect take numbers and rects).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { showCanvasToast } from '../canvas-notifications.tsx';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import type { CommandRecord } from '../undo-stack.ts';
import type { RectLike } from './arrange.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement } from './object-actions.ts';
import { placeFreely } from './place-freely.tsx';

// ── words ─────────────────────────────────────────────────────────────────────────────────────

export interface SlotLineInput {
  name: string;
  /** 1-based place it would land in, among its siblings */
  index: number;
  total: number;
  copy: boolean;
  /** the pointer is outside the frame it was lifted from */
  out: boolean;
}

/** The tag that follows the card. */
export function slotLine(i: SlotLineInput): string {
  if (i.out) return `${i.name} · placed freely`;
  if (i.copy) return `${i.name} · a copy goes to ${i.index} of ${i.total}`;
  return `${i.name} · moves to ${i.index} of ${i.total}`;
}

/** What to call the lifted object: its name in the code, its label, its first words, its tag. */
export function nameOf(el: Element): string {
  const named = el.getAttribute('data-dc-element') || el.getAttribute('aria-label');
  if (named) return named;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 24 ? `${text.slice(0, 23)}…` : text;
  return el.tagName.toLowerCase();
}

/**
 * The `reorder-slot` the canvas sends the shell so Layers draws the same numbered place (S2.11b).
 * `null` (the drag ended) = `index: 0`. A frame with no `data-cd-id` sends no `parentId`; the row's
 * parser then drops it and Layers draws nothing — the canvas's own slot is still there.
 */
export function slotMessage(
  s: Pick<SlotState, 'el' | 'frame'> | null,
  win: Window = window
): { dgn: 'reorder-slot'; index: number; total: number; parentId?: string } {
  if (!s) return { dgn: 'reorder-slot', index: 0, total: 0 };
  const { index, total } = placeAmong(s.el, win);
  const parentId = s.frame?.getAttribute('data-cd-id');
  return { dgn: 'reorder-slot', index, total, ...(parentId ? { parentId } : {}) };
}

function postSlot(msg: ReturnType<typeof slotMessage>): void {
  try {
    window.parent.postMessage(msg, '*');
  } catch {
    /* the shell is not there; the canvas's own slot is unaffected */
  }
}

const SKIP = '.dgn-pin, .dc-cv-halo, .dc-cv-group-bbox';

/** Its place among the siblings that take part in the layout (out-of-flow ones do not count). */
export function placeAmong(el: Element, win: Window = window): { index: number; total: number } {
  const siblings = Array.from(el.parentElement?.children ?? []).filter((c) => {
    if ((c as HTMLElement).matches?.(SKIP)) return false;
    const p = win.getComputedStyle(c).position;
    return p !== 'absolute' && p !== 'fixed';
  });
  const at = siblings.indexOf(el);
  return { index: at < 0 ? 1 : at + 1, total: Math.max(1, siblings.length) };
}

// ── geometry ──────────────────────────────────────────────────────────────────────────────────

/** `translate(12px, -4px)` → [12, -4]; anything else → [0, 0]. */
export function translateOf(transform: string): [number, number] {
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(transform);
  return m ? [Number.parseFloat(m[1] as string), Number.parseFloat(m[2] as string)] : [0, 0];
}

/** The card's own layout box: where it will land is where the float's transform is taken off. */
export function slotRect(floating: RectLike, transform: string, zoom: number): RectLike {
  const [tx, ty] = translateOf(transform);
  const k = zoom > 0 ? zoom : 1;
  return {
    left: floating.left - tx * k,
    top: floating.top - ty * k,
    width: floating.width,
    height: floating.height,
  };
}

/** Is the point outside `frame` by more than `slop` px (a drag out of the frame, not a wobble)? */
export function outsideFrame(x: number, y: number, frame: RectLike, slop = 12): boolean {
  return (
    x < frame.left - slop ||
    x > frame.left + frame.width + slop ||
    y < frame.top - slop ||
    y > frame.top + frame.height + slop
  );
}

const FALLBACK_MS = 220;
const FALLBACK_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** `--dur-panel` and `--ease-out` as the canvas has them (the neighbours slide on these). */
export function panelMotion(win: Window = window): { ms: number; easing: string } {
  const cs = win.getComputedStyle(win.document.documentElement);
  const raw = cs.getPropertyValue('--dur-panel').trim();
  const m = /^(-?[\d.]+)(ms|s)$/.exec(raw);
  const ms = m
    ? Math.round(Number.parseFloat(m[1] as string) * (m[2] === 's' ? 1000 : 1))
    : FALLBACK_MS;
  return {
    ms: ms > 0 ? ms : FALLBACK_MS,
    easing: cs.getPropertyValue('--ease-out').trim() || FALLBACK_EASE,
  };
}

// ── the shared state between ReorderDrag and the skin ─────────────────────────────────────────

export interface SlotState {
  el: HTMLElement;
  frame: HTMLElement | null;
  copy: boolean;
  out: boolean;
}

let state: SlotState | null = null;
const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};

export const reorderSlot = {
  /** the card was lifted */
  begin(el: HTMLElement, frame: HTMLElement | null): void {
    state = { el, frame, copy: false, out: false };
    emit();
  },
  /**
   * The pointer moved; ⌥ makes it a copy. Leaving the frame makes it free placement — but only over
   * empty space: with an object under the pointer the v1 drop (move out / into that object) stands.
   */
  move(x: number, y: number, altKey: boolean, overTarget = false): void {
    if (!state) return;
    const out = !overTarget && state.frame ? outsideFrame(x, y, rectOf(state.frame)) : false;
    if (out === state.out && altKey === state.copy) return;
    state = { ...state, out, copy: altKey };
    emit();
  },
  /** dropped or put back */
  end(): SlotState | null {
    const was = state;
    if (state === null) return null;
    state = null;
    emit();
    return was;
  },
  get: (): SlotState | null => state,
  subscribe(f: () => void): () => void {
    subs.add(f);
    return () => subs.delete(f);
  },
};

const rectOf = (el: Element): RectLike => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

// ── the two drops that are not the v1 write ───────────────────────────────────────────────────

export interface LayoutOpsDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
}

/** EditingLayer fills this in (it holds the hooks): the toast, the undo stack. */
export const layoutOpsDeps: { current: LayoutOpsDeps } = {
  current: { toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info') },
};

export interface TakeOver {
  /** the card, put back where it was lifted from and un-floated, as the file still has it */
  el: HTMLElement;
  /** where the float was when the pointer let go (screen px) */
  floatRect: RectLike;
  /** the neighbour the drop names, and which side */
  ref: HTMLElement | null;
  position: 'before' | 'after' | 'inside-end' | null;
  altKey: boolean;
  out: boolean;
}

/**
 * ⌥ drop or a drop outside the frame: the two writes the v1 drop does not make. Returns true when
 * it took the drop over (the caller then skips the v1 `reorder-request`); false = carry on as v1.
 * The caller has already un-floated the card and put it back at its origin.
 */
export function takeOver(t: TakeOver, deps: LayoutOpsDeps = layoutOpsDeps.current): boolean {
  if (t.out) {
    void placeFreely(t.el, deps, { at: t.floatRect });
    return true;
  }
  if (t.altKey && t.ref && t.position) {
    const moved = refOfElement(t.el);
    const ref = refOfElement(t.ref);
    if (!moved || !ref) return false;
    void (async () => {
      const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
      const result = await run({
        op: 'object.reorder-to',
        targets: [moved, ref] as ElementRef[],
        params: { position: t.position, copy: true },
      });
      if (!result.ok) deps.toast?.(result.message || 'That did not go through.', 'error');
      else if (result.actionId === null && result.writeId)
        deps.record?.(editOpRecord(result.writeId, 'Copy'));
    })();
    return true;
  }
  return false;
}

// ── the skin ──────────────────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
.ed-slot {
  position: fixed;
  z-index: 3;
  pointer-events: none;
  box-sizing: border-box;
  border: 1.5px dashed var(--maude-hud-accent, #7c5cff);
  border-radius: 6px;
  background: color-mix(in srgb, var(--maude-hud-accent, #7c5cff) 10%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ed-slot-fade var(--dur-panel, 220ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.ed-slot[data-out="true"] { border-style: solid; border-color: var(--guide, var(--guide-magenta, #ff24bd)); }
.ed-slot-n {
  min-width: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--maude-hud-accent, #7c5cff);
  color: var(--maude-hud-accent-fg, #fff);
  font: 600 12px/20px var(--maude-chrome-font-mono, ui-monospace, monospace);
  text-align: center;
}
.ed-slot-tag {
  position: fixed;
  z-index: 9;
  pointer-events: none;
  transform: translateY(-100%);
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--maude-hud-accent, #7c5cff);
  color: var(--maude-hud-accent-fg, #fff);
  font: 500 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace);
  white-space: nowrap;
}
@keyframes ed-slot-fade { from { opacity: 0; } to { opacity: 1; } }
/* Reduce motion: the neighbours jump (canvas-shell skips the slide); the slot still FADES in — an
   opacity change is not movement, and it is what tells you where the card will land. */
@media (prefers-reduced-motion: reduce) {
  .ed-slot { animation-name: ed-slot-fade; }
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-slot-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-slot-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

export const SLOT_CSS = CSS_TEXT;

interface Paint {
  slot: RectLike;
  tag: RectLike;
  line: string;
  index: number;
  out: boolean;
}

function paintOf(s: SlotState): Paint | null {
  const el = s.el;
  if (!el.isConnected) return null;
  const rect = rectOf(el);
  const zoom = el.offsetWidth ? rect.width / el.offsetWidth : 1;
  const slot = slotRect(rect, el.style.transform, zoom);
  const { index, total } = placeAmong(el);
  return {
    slot,
    tag: rect,
    line: slotLine({ name: nameOf(el), index, total, copy: s.copy, out: s.out }),
    index,
    out: s.out,
  };
}

/** Dropped or put back: Layers closes the slot (once). */
function tellEnd(told: { current: string }): void {
  if (!told.current) return;
  told.current = '';
  postSlot(slotMessage(null));
}

export function ReorderSlot() {
  ensureStyles();
  const s = useSyncExternalStore(reorderSlot.subscribe, reorderSlot.get, reorderSlot.get);
  const [paint, setPaint] = useState<Paint | null>(null);
  const raf = useRef<number | null>(null);
  // what Layers was last told, kept across `s` changes (⌥ / leaving the frame swap `s`, not the slot)
  const told = useRef('');
  // unmounting with a slot open closes it too
  useEffect(() => () => tellEnd(told), []);

  useEffect(() => {
    if (!s) {
      setPaint(null);
      tellEnd(told);
      return;
    }
    let last = '';
    const tick = () => {
      raf.current = requestAnimationFrame(tick);
      const next = paintOf(s);
      // Layers draws the same slot: tell the shell when the place changes (not on every frame)
      const msg = next ? slotMessage(s) : null;
      const sig = msg ? `${msg.index}/${msg.total}/${msg.parentId ?? ''}` : '';
      if (msg && sig !== told.current) {
        told.current = sig;
        postSlot(msg);
      }
      const key = next
        ? `${next.line}|${Math.round(next.slot.left)},${Math.round(next.slot.top)}|${Math.round(next.tag.left)},${Math.round(next.tag.top)}`
        : '';
      if (key === last) return;
      last = key;
      setPaint(next);
    };
    tick();
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      setPaint(null);
    };
  }, [s]);

  if (!s || !paint) return null;
  return (
    <div aria-hidden="true" data-testid="edit-reorder-slot-layer">
      {paint.out ? null : (
        <div
          className="ed-slot"
          data-testid="edit-reorder-slot"
          data-n={paint.index}
          style={{
            left: paint.slot.left,
            top: paint.slot.top,
            width: paint.slot.width,
            height: paint.slot.height,
          }}
        >
          <span className="ed-slot-n" data-testid="edit-reorder-slot-n">
            {paint.index}
          </span>
        </div>
      )}
      <div
        className="ed-slot-tag"
        data-testid="edit-reorder-tag"
        data-copy={s.copy ? 'true' : undefined}
        data-out={paint.out ? 'true' : undefined}
        style={{ left: paint.tag.left, top: paint.tag.top - 4 }}
      >
        {paint.line}
      </div>
    </div>
  );
}
