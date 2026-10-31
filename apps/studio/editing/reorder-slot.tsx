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
import { crumbLabel } from './crumbs.ts';
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

/**
 * What to call the lifted object — the breadcrumb's rule (`crumbLabel`): its name in the code, its label, the first
 * words of its OWN text, else the kind word. Never the glued text of everything inside it ("ct designApps and …")
 * and never the tag (14 R4).
 */
export function nameOf(el: Element): string {
  let own = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) own += n.textContent ?? '';
  return crumbLabel({
    id: el.getAttribute('data-cd-id'),
    name: el.getAttribute('data-dc-element'),
    aria: el.getAttribute('aria-label'),
    text: own.replace(/\s+/g, ' ').trim(),
    tag: el.tagName.toLowerCase(),
  });
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

/**
 * The lifted card (14 ed-lay-reorder: "the card lifts and follows the pointer"): tilted and a touch larger, with the
 * accent ring and a deep shadow. Set with the INDIVIDUAL `rotate` / `scale` properties so the drag's own
 * `transform: translate(…)` (which `translateOf` reads and `slotRect` takes off) stays the only thing in `transform`.
 */
export const LIFT = Object.freeze({
  rotate: '-2deg',
  scale: '1.03',
  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28), 0 0 0 1.5px var(--maude-hud-accent, #0d99ff)',
});

/** Lift `el` (inline style; the drag restores its own `prevStyle` on drop, so nothing to undo here). */
export function liftCard(el: HTMLElement): void {
  el.style.rotate = LIFT.rotate;
  el.style.scale = LIFT.scale;
  el.style.boxShadow = LIFT.boxShadow;
  el.style.opacity = '1';
}

/**
 * The card's own (unrotated, unscaled) box on screen. The lift tilts and scales it about its centre, so its
 * bounding rect is bigger than the card; the slot is the CARD's size (not the tilted bounds) and the tag sits at the
 * card's corner. `zoom` is the world's screen scale.
 */
export function cardBox(rect: RectLike, offsetW: number, offsetH: number, zoom: number): RectLike {
  const w = offsetW * zoom;
  const h = offsetH * zoom;
  return {
    left: rect.left + rect.width / 2 - w / 2,
    top: rect.top + rect.height / 2 - h / 2,
    width: w,
    height: h,
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
      else if (result.actionId === null && result.writeId) {
        // null on the op log: the write is a kernel action there, ⌘Z is the shell's projection
        const rec = editOpRecord(result.writeId, 'Copy');
        if (rec) deps.record?.(rec);
      }
    })();
    return true;
  }
  return false;
}

/**
 * r1 #15 — an ⌥-drop of a PLACED object (`position: absolute`): the original stays, a copy lands where the drop put
 * it (`left` / `top` in the frame's px). ONE `object.reorder-to` (copy, the object as its own neighbour, `at`) — one
 * write, one ⌘Z. Resolves true when the copy was made.
 */
export async function copyPlacedTo(
  el: Element,
  at: { left: number; top: number },
  deps: LayoutOpsDeps = layoutOpsDeps.current
): Promise<boolean> {
  const self = refOfElement(el);
  if (!self) return false;
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  const result = await run({
    op: 'object.reorder-to',
    targets: [self, self] as ElementRef[],
    params: { position: 'after', copy: true, at },
  });
  if (!result.ok) {
    deps.toast?.(result.message || 'That did not go through.', 'error');
    return false;
  }
  if (result.actionId === null && result.writeId) {
    const rec = editOpRecord(result.writeId, 'Copy');
    if (rec) deps.record?.(rec);
  }
  return true;
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
  font: 600 12px/20px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  text-align: center;
}
.ed-slot-tag {
  position: fixed;
  z-index: 9;
  pointer-events: none;
  transform: translateY(-100%);
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--maude-hud-accent, #7c5cff);
  color: var(--maude-hud-accent-fg, #fff);
  font: 600 11px/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  white-space: nowrap;
}
/* 14 ed-lay-reorder: what the gesture offers, as light pills under the work (the board's .ed-hints) */
.ed-slot-hints {
  position: fixed;
  z-index: 9;
  left: 50%;
  bottom: 92px;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  pointer-events: none;
}
.ed-slot-hint {
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--maude-chrome-bg-1);
  color: var(--maude-chrome-fg-1);
  border: 1px solid var(--maude-chrome-border);
  box-shadow: 0 1px 3px var(--maude-chrome-shadow, rgba(0, 0, 0, 0.18));
  font: 500 11px/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  white-space: nowrap;
}
.ed-slot-hint kbd {
  font: inherit;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--maude-chrome-bg-2);
  color: var(--maude-chrome-fg-0);
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

/** The four things a reorder drag offers (14 ed-lay-reorder's hint pills); a key is `[key, rest]`. */
export const SLOT_HINTS: ReadonlyArray<{ key?: string; text: string }> = [
  { text: 'Let go — it moves here' },
  { key: 'esc', text: ' puts it back' },
  { key: '⌥', text: ' while dragging — a copy' },
  { text: 'Drag out of the frame — place it freely' },
];

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
  const bounds = rectOf(el);
  // the world's scale from the (unlifted) parent, the card's own bounds are tilted + scaled by the lift
  const par = el.parentElement;
  const zoom = par?.offsetWidth ? par.getBoundingClientRect().width / par.offsetWidth : 1;
  const rect = cardBox(bounds, el.offsetWidth, el.offsetHeight, zoom);
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
      <div className="ed-slot-hints" data-testid="edit-reorder-hints">
        {SLOT_HINTS.map((hint) => (
          <span key={hint.text} className="ed-slot-hint">
            {hint.key ? <kbd>{hint.key}</kbd> : null}
            {hint.text}
          </span>
        ))}
      </div>
    </div>
  );
}
