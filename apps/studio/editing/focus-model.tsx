// editing/focus-model.tsx — the keyboard's place on the canvas (S2.21; artboard `ed-edge-keys`, rule
// `every-object-reachable-without-a-mouse`).
//
//   tab · ⇧tab   next / previous object on this level, in reading order        `object.select-next` / `-prev`
//   F6 · ⇧F6     out to the panels and back (`ui.cycle-region`) — the shell cycles (client/v2/shell/f6-cycle.js); the
//                way out of THIS document is the inspector script's forward (inspect.ts), which every canvas has
//   R · T · F, ↵ adds one at its default size, with no pointer                   `tool.create-default`
//
// Every chord is resolved through the registry (canvas-keys), never matched by hand. The keyboard has a MODALITY:
// after a key, the focused object wears the FOCUS RING; after a pointer press the ring goes and the ordinary
// selection stays. The ring is thicker than the selection's line and has a halo, and it reads its own token
// (`--ed-focus-ring`, the v2 `--focus-ring`), never the selection's (`--maude-hud-accent`) — a person who tabs must
// never wonder whether an object is focused or selected.

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { canvasKeyIndex } from '../actions/canvas-keys.ts';
import { canvasKeyCtx } from '../actions/ctx.ts';
import { chordFromEvent } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import { canvasModeStore, canvasSingleKeys } from '../bridge/canvas-mode-store.ts';
import { getLiveViewport } from '../canvas-lib.tsx';
import { showCanvasToast } from '../canvas-notifications.tsx';
import { resolveSelectionEl } from '../dom-selection.ts';
import { isEditableTarget, TOOLBAR_INSERT_EVENT, type Tool } from '../input-router.tsx';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { selectWhenRendered as selectArtboardsWhenRendered } from './artboard-actions.ts';
import { typeIntoSelected } from './click-to-type.ts';
import { CLICK_SIZE, type DrawTool, KIND_OF_TOOL } from './draw-geometry.ts';
import { beginLive, type DrawDeps, finishDraw, type Live } from './draw-tools.tsx';
import { selectWhenRendered as selectElementsWhenRendered } from './object-actions.ts';
import { refsOf } from './object-ops.ts';
import { enterSelection } from './selection.tsx';
import { stepSelection } from './tab-order.tsx';

export const NEXT_ACTION = 'object.select-next';
export const PREV_ACTION = 'object.select-prev';
export const CREATE_DEFAULT_ACTION = 'tool.create-default';

export const ENTER_ACTION = 'object.enter';

const KEYS = canvasKeyIndex([NEXT_ACTION, PREV_ACTION, CREATE_DEFAULT_ACTION, ENTER_ACTION]);

/**
 * V2-8.7 — ↵ on the one selected object (`object.enter`): inside a frame that holds objects (its first child is
 * selected, tab then walks the children), or typing in a text (the whole text selected, as a double click does).
 * Until now ↵ had no listener in the canvas — only ⌘K and the menu could say it — so a keyboard-only run could not
 * go inside a frame or type in a text, though VoiceOver says "Press Return to go inside / to type".
 * 'code' = a text filled in from code (no inline edit); null = nothing to enter.
 */
export function goInside(
  doc: Document,
  selected: readonly Selection[],
  replace: (s: Selection) => void
): 'inside' | 'type' | 'code' | null {
  const one = selected.length === 1 ? selected[0] : null;
  if (!one) return null;
  const next = enterSelection(doc, one);
  if (next) {
    replace(next);
    return 'inside';
  }
  const typed = typeIntoSelected(doc, resolveSelectionEl(doc, one) as HTMLElement | null);
  return typed === 'edit' ? 'type' : typed;
}

/** Enter on a focused control (a toolbar button) is the control's own — ↵ here only counts on the bare canvas. */
export const isBareCanvasTarget = (t: EventTarget | null, doc: Document): boolean =>
  !t || t === doc.body || t === doc.documentElement;

// ── the tokens ──────────────────────────────────────────────────────────────────────────────

/** The custom property each ring reads. A test holds them apart (test/v2-edit-keyboard.test.tsx). */
export const FOCUS_RING_TOKEN = '--ed-focus-ring';
export const SELECTION_TOKEN = '--maude-hud-accent';

/** Focus ring: 2.5 px line + a 7 px halo (the design's `ed-sel--focus`); the selection line is 1.5 px. */
export const FOCUS_RING_CSS = `
:root,
:root[data-maude-theme="light"] {
  ${FOCUS_RING_TOKEN}: oklch(0.53 0.175 238);
  --ed-focus-ring-fg: oklch(1 0 0);
  --ed-focus-halo: oklch(0.53 0.175 238 / 0.22);
}
:root[data-maude-theme="dark"] {
  ${FOCUS_RING_TOKEN}: oklch(0.72 0.14 238);
  --ed-focus-ring-fg: oklch(0.18 0.03 238);
  --ed-focus-halo: oklch(0.64 0.165 238 / 0.3);
}
/* 14 ed-edge-keys: while the keyboard is walking, the focused object wears the focus ring and NOTHING of the
   selection — a person who tabs must never wonder whether an object is focused or selected. */
.dc-el-resize-handle,
.dc-el-resize-readout,
.ed-name-tag,
.ed-parent-outline,
.dc-cv-halo--selected {
  display: none !important;
}
.ed-focus-ring {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  box-sizing: border-box;
  border-radius: 2px;
  box-shadow: 0 0 0 2.5px var(${FOCUS_RING_TOKEN}), 0 0 0 7px var(--ed-focus-halo);
}
`;

// ── the modality ────────────────────────────────────────────────────────────────────────────

/** Is the last thing the person did a key (the ring shows) or a pointer press (it does not)? */
export function createModality(initial = false) {
  let keyboard = initial;
  const subs = new Set<() => void>();
  const set = (v: boolean) => {
    if (v === keyboard) return;
    keyboard = v;
    for (const fn of subs) fn();
  };
  return {
    get: () => keyboard,
    key: () => set(true),
    pointer: () => set(false),
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export const modality = createModality();

/** The keys that WALK the keyboard's place — Tab / ⇧Tab through the reading order, F6 between regions. Everything else
 *  is a key press on whatever the pointer selected and must not paint the order pills over a pointer selection
 *  (14 R3, ed-edge-ask / ed-edge-undo / ed-edge-keys): a tool letter, Esc, Delete, a chord (⌘Z, ⌘/, ⌘D) — and an ARROW,
 *  which nudges the selected object, it does not move the keyboard's place. */
const WALKING_KEYS = new Set(['Tab', 'F6']);

export const isNavigationKey = (
  key: string,
  mods?: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }
): boolean => WALKING_KEYS.has(key) && !(mods?.metaKey || mods?.ctrlKey || mods?.altKey);

export function useKeyboardModality(): boolean {
  return useSyncExternalStore(modality.subscribe, modality.get, () => false);
}

// ── the ring ────────────────────────────────────────────────────────────────────────────────

/** The focus ring around the one selected object while the keyboard is the last thing used. */
export function FocusRing() {
  const kb = useKeyboardModality();
  const { selected } = useSelectionSet();
  const ring = useRef<HTMLDivElement | null>(null);
  const one = selected.length === 1 && selected[0]?.id ? (selected[0] as Selection) : null;

  useEffect(() => {
    if (!kb || !one || typeof document === 'undefined') return;
    let raf: number | null = null;
    const tick = () => {
      const el = resolveSelectionEl(document, one);
      const div = ring.current;
      const r = el?.isConnected ? el.getBoundingClientRect() : null;
      if (div) {
        if (!r || (r.width === 0 && r.height === 0)) div.style.display = 'none';
        else {
          div.style.display = 'block';
          div.style.left = `${Math.round(r.left)}px`;
          div.style.top = `${Math.round(r.top)}px`;
          div.style.width = `${Math.round(r.width)}px`;
          div.style.height = `${Math.round(r.height)}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [kb, one]);

  if (!kb || !one) return null;
  return (
    <>
      <style>{FOCUS_RING_CSS}</style>
      <div ref={ring} className="ed-focus-ring" data-testid="edit-focus-ring" aria-hidden="true" />
    </>
  );
}

// ── R · T · F, then ↵ ───────────────────────────────────────────────────────────────────────

/** Is a create tool armed? (F a frame, R a shape, T a text.) */
export const isCreateTool = (t: string | null | undefined): t is DrawTool | 'el-text' =>
  t === 'frame' || t === 'el-shape' || t === 'el-text';

/** Where the new object goes: the middle of what is selected, else the middle of what the person sees. */
export function createPoint(
  doc: Document,
  selected: readonly Selection[],
  view: { w: number; h: number }
): { x: number; y: number } {
  const last = [...selected].reverse().find((s) => s.id || s.artboardId);
  const el = last
    ? last.id
      ? resolveSelectionEl(doc, last)
      : doc.querySelector(`[data-dc-screen="${CSS.escape(last.artboardId ?? '')}"]`)
    : null;
  const r = el?.isConnected ? el.getBoundingClientRect() : null;
  if (r && r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  return { x: view.w / 2, y: view.h / 2 };
}

/** The live draw a ↵ makes: a click's default box, centred on `at` instead of hanging from it. */
export function centredClick(
  doc: Document,
  tool: DrawTool,
  at: { x: number; y: number },
  zoom = 1
): Live | 'off-artboard' {
  const live = beginLive(doc, KIND_OF_TOOL[tool], at, { altKey: false, shiftKey: false });
  if (live === 'off-artboard') return live;
  const half = (CLICK_SIZE / 2) * (live.target ? live.target.k : zoom || 1);
  const from = { x: at.x - half, y: at.y - half };
  return { ...live, from, to: from };
}

export interface CreateDeps {
  doc: Document;
  selected: readonly Selection[];
  record: NonNullable<DrawDeps['record']>;
  replace: (s: Selection | Selection[]) => void;
  /** the tool steps back to Select once something was made */
  done: () => void;
  view?: { w: number; h: number };
  zoom?: number;
}

/** ↵ with a create tool armed: ONE object at its default size, selected, the tool back to Select. */
export async function createDefault(tool: DrawTool | 'el-text', d: CreateDeps): Promise<boolean> {
  if (tool === 'el-text') {
    d.doc.dispatchEvent(new CustomEvent(TOOLBAR_INSERT_EVENT, { detail: { kind: 'text' } }));
    d.done();
    return true;
  }
  const view = d.view ?? { w: window.innerWidth, h: window.innerHeight };
  const live = centredClick(
    d.doc,
    tool,
    createPoint(d.doc, d.selected, view),
    d.zoom ?? getLiveViewport()?.zoom
  );
  if (live === 'off-artboard') {
    showCanvasToast('Draw on an artboard. F draws a new artboard on empty canvas.', 'info');
    return false;
  }
  const made = await finishDraw(live, {
    record: d.record,
    select: (what, created) => {
      if (what === 'artboard')
        selectArtboardsWhenRendered(
          created.map((c) => c.artboard),
          d.replace
        );
      else selectElementsWhenRendered(created, d.replace);
    },
  });
  if (made) d.done();
  return made;
}

// ── the layer ───────────────────────────────────────────────────────────────────────────────

/** tab / ⇧tab / F6 / ↵-after-a-tool, resolved through the registry; owns the modality and the ring. */
export function KeyboardLayer({ readOnly = false }: { readOnly?: boolean }) {
  const selSet = useSelectionSet();
  const selRef = useRef(selSet);
  selRef.current = selSet;
  const tm = useToolModeOptional();
  const tmRef = useRef(tm);
  tmRef.current = tm;
  const undo = useUndoStackOptional();
  const undoRef = useRef(undo);
  undoRef.current = undo;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const tool = tmRef.current?.tool;
      const armed = !readOnly && !isReadOnlyCanvas() && isCreateTool(tool);
      const typing = isEditableTarget(e.target);
      if (isNavigationKey(e.key, e) && !typing) modality.key();
      const hit = resolveChord(
        KEYS,
        chordFromEvent(e),
        canvasKeyCtx({
          typing,
          readOnly: false,
          mode: canvasModeStore(window).get().mode ?? 'edit',
          // V2-8.7 — an object the shell just inserted (T then ↵) is selected by id with NO artboard yet, which
          // `refsOf` does not count; ↵ must still find it, so count a stamped id, not a resolved ref
          selection: selRef.current.selected.some((s) => !!s.id) ? 'object' : 'none',
          singleKeys: canvasSingleKeys(),
          toolArmed: armed,
        })
      );
      const id = hit?.action.id;
      if (!id) return;
      if (typing || tool === 'browse') return;
      if (id === NEXT_ACTION || id === PREV_ACTION) {
        // swallowed even with nowhere to go, so the browser's own tab never walks out of the canvas
        e.preventDefault();
        e.stopPropagation();
        const next = stepSelection(document, selRef.current.selected, id === NEXT_ACTION ? 1 : -1);
        if (next) selRef.current.replace(next);
      } else if (id === ENTER_ACTION) {
        if (readOnly || isReadOnlyCanvas() || !isBareCanvasTarget(e.target, document)) return;
        const went = goInside(document, selRef.current.selected, selRef.current.replace);
        if (!went) return;
        e.preventDefault();
        e.stopPropagation();
        if (went === 'code')
          showCanvasToast(
            'This text is filled in from code (a variable) — edit it via chat or /design:edit.'
          );
      } else if (id === CREATE_DEFAULT_ACTION && armed && isCreateTool(tool)) {
        e.preventDefault();
        e.stopPropagation();
        void createDefault(tool, {
          doc: document,
          selected: selRef.current.selected,
          record: (rec) => undoRef.current?.record(rec),
          replace: (s) => selRef.current.replace(s),
          done: () => tmRef.current?.setTool('move' as Tool),
        });
      }
    };
    const onPointer = () => modality.pointer();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('mousedown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('mousedown', onPointer, true);
    };
  }, [readOnly]);

  return <FocusRing />;
}
