/**
 * @file       input-router.tsx — canvas pointer/keyboard classifier + hook
 * @scope      apps/studio/input-router.tsx
 * @purpose    Owned by canvas-lib's DesignCanvas. Classifies the NON-WHEEL
 *             subset of pointer + key events into discrete router actions.
 *             `useViewportController` keeps owning wheel + middle-mouse +
 *             space-pan + Cmd+0/1/+/- — the two stacks coexist without a
 *             listener race (DDR-026).
 *
 * Event ownership (read this before adding handlers):
 *
 *   ┌──────────────────────────────────┬─────────────────────────┐
 *   │ Event                            │ Owner                    │
 *   ├──────────────────────────────────┼─────────────────────────┤
 *   │ wheel / shift-wheel / cmd-wheel  │ useViewportController    │
 *   │ pointerdown btn=1 / space-held   │ useViewportController    │
 *   │ keydown Space / Cmd+0/1/+/-      │ useViewportController    │
 *   │ pointermove (hover)              │ input-router             │
 *   │ pointerdown btn=0 (select)       │ input-router             │
 *   │ pointerdown btn=2 (right-click)  │ input-router             │
 *   │ keydown V / H / C / Esc          │ input-router             │
 *   └──────────────────────────────────┴─────────────────────────┘
 *
 * The router does no DOM work itself — `classify()` is pure (testable without
 * a DOM) and `useInputRouter()` attaches listeners that dispatch through the
 * caller-supplied callbacks. Hover-target resolution + selection persistence
 * live in the consumer (DesignCanvas).
 */

import { type RefObject, useEffect } from 'react';

import { canvasKeyIndex } from './actions/canvas-keys.ts';
import { canvasKeyCtx } from './actions/ctx.ts';
import { CANVAS_KEYMAP } from './actions/keymap.gen.ts';
import { chordFromEvent } from './actions/keys.ts';
import { resolveChord } from './actions/resolve.ts';
import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import {
  ALL_CAPS,
  armTarget,
  type CanvasModeV2,
  escStep,
  type InsertKind,
  MODE_TOOLS,
  type ModeCaps,
  type SlotPanel,
  type ToolId,
  toolKeyAction,
  V1_TOOL_IDS,
} from './bridge/canvas-modes.ts';
import { escOwnerOpen } from './bridge/esc-ladder.ts';
import { modeShows } from './bridge/mode-shows.ts';
import { isEmbedCanvas, isHistoricalCanvas } from './read-only-mode.ts';
import { lastMarkerTip } from './toolbars/marker-tip.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Drag-vs-click threshold (T25)
//
// 4 px screen-pixel hypot separates "click" from "drag" — Microsoft Win32
// canonical (`SM_CXDRAG`/`SM_CYDRAG` default), also d3-drag and tldraw default.
// Owned here so artboard-drag, artboard-marquee, element-marquee, annotation-
// drag-vs-tap, and any future drag-class gesture all read the same constant.
// Wheel + pinch-zoom are EXEMPT — threshold is for `pointerdown → pointermove`
// drag classification only.

export const DRAG_THRESHOLD_PX = 4;

/** True once the pointer has moved ≥ DRAG_THRESHOLD_PX from its start. */
export function crossedDragThreshold(
  startX: number,
  startY: number,
  curX: number,
  curY: number
): boolean {
  const dx = curX - startX;
  const dy = curY - startY;
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types

/**
 * Tool union. Phase 4.1 shipped V/H/C; Phase 5 adds the draw set
 * (pen / rect / arrow / eraser). Draw-tool pointer events are owned by
 * `AnnotationsLayer` — the router classifies their letter shortcuts but
 * returns `no-op` for the corresponding pointer events so the SVG overlay
 * can grab them natively.
 */
export type Tool =
  // feature-4 (browse/move split) — `browse` is the BOOT default: a pure
  // native pass-through so a freshly-opened mock stays ALIVE (buttons click,
  // links follow, inputs focus). It carries ZERO select machinery — the router
  // returns `no-op` for every browse-tool pointer event so descendants see them
  // untouched. Pressing V flips to `move` (the select tool). See DDR-187.
  | 'browse'
  | 'move'
  // S3.11 — Viewing's resting tool: a click inspects (outline + size tag, no handles), a drag pans.
  | 'inspect'
  | 'hand'
  | 'comment'
  | 'pen'
  // Annotation polish (item 8) — FigJam-style highlighter. A `pen`-shaped tool
  // that produces a translucent wide multiply stroke (a PenStroke with
  // `highlighter:true`), not a new stroke type.
  | 'highlighter'
  // Phase 24 — `shape` is the single active draw tool that produces rect /
  // ellipse / polygon strokes (the kind is chosen via the palette popover).
  // `rect` / `ellipse` stay in the union as the stroke discriminants they
  // always were, but are no longer directly selectable active tools.
  | 'shape'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'sticky'
  | 'text'
  // S2.12b — Edit's Text: click to type (annotations-layer `beginStroke`), not an annotation.
  | 'el-text'
  // S2.13 — Edit's Frame (F), Shape (R) and More (Line · Ellipse · Polygon · Export area): drawn by dragging
  // (editing/draw-tools.tsx owns the pointer), not annotations. `ellipse` above is the same id.
  | 'frame'
  | 'el-shape'
  | 'line'
  | 'polygon'
  | 'slice'
  // S2.14 — Edit's Pen (P): points, drawn by editing/pen/draw.tsx
  | 'el-pen'
  // S2.15 — Edit's More › Crop: arm it, then click a picture (editing/crop-mode.tsx). It selects like Select does.
  | 'crop'
  // FigJam v3 — labelled organizing container (Shift+S).
  | 'section'
  | 'eraser';

const ANNOTATION_TOOLS = new Set<Tool>([
  'pen',
  'highlighter',
  'shape',
  'rect',
  'ellipse',
  'arrow',
  'sticky',
  'text',
  'el-text',
  // S2.13 — the drag tools of Edit own the pointer exactly as the annotation tools do
  'frame',
  'el-shape',
  'line',
  'polygon',
  'slice',
  'el-pen',
  'section',
  'eraser',
]);

export function isAnnotationTool(t: Tool): boolean {
  return ANNOTATION_TOOLS.has(t);
}

export type RouterAction =
  | { kind: 'no-op' }
  | { kind: 'hover'; deep: boolean; clientX: number; clientY: number }
  | {
      kind: 'select';
      /** `replace` swaps the selection set, `add` merges into it. */
      mode: 'replace' | 'add';
      /**
       * `true` resolves to the deepest descendant under the cursor (Cmd-held
       * mode). `false` resolves to the topmost interesting ancestor (top mode).
       * feature-4 (browse/move split, DDR-187) — the Move (select) tool now
       * fires the FULL Figma ladder: a BARE click selects the TOP-level object
       * (`deep:false`), Cmd selects the DEEPEST element (`deep:true`), Shift
       * adds, Cmd+Shift adds-deep. (Pre-feature-4 Move-tool select was
       * Cmd-only and always deep; bare clicks were passthrough — that role now
       * belongs to the `browse` tool, which never selects at all.)
       */
      deep: boolean;
      clientX: number;
      clientY: number;
    }
  | { kind: 'drop-comment'; clientX: number; clientY: number }
  | { kind: 'context-menu'; clientX: number; clientY: number }
  | { kind: 'tool'; tool: Tool }
  /** V2-4.5b — a governed key that belongs to another mode (or the role may not use): the shell
   *  decides (M3/M4). `panel` opens once the mode switched (Edit's E → Preview's Stickers). */
  | {
      kind: 'mode-request';
      mode: CanvasModeV2 | 'back';
      tool?: ToolId;
      panel?: SlotPanel;
      cause: 'key' | 'esc';
    }
  /** V2-4.5b — a momentary slot's key (Edit's F / T / I add one at the default size). */
  | { kind: 'insert'; insert: InsertKind }
  /** V2-4.5b — a panel-only slot's key (Preview's E → the shell's Stickers panel). */
  | { kind: 'panel'; panel: SlotPanel }
  /** `back` (V2-4.5b, governed): after the local step back, the canvas asks the shell for the
   *  previous mode — Preview at rest → Edit, Present → where it was entered from (escStep). */
  | { kind: 'escape'; back?: true }
  | { kind: 'undo' }
  | { kind: 'redo' };

export interface ClassifyInput {
  type: 'pointermove' | 'pointerdown' | 'contextmenu' | 'keydown';
  /** PointerEvent.button: 0 = left, 1 = middle, 2 = right. */
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  key?: string;
  /** KeyboardEvent.code — the physical key (chordFromEvent's layout fallback, V2-1.3 §5.4). */
  code?: string;
  clientX?: number;
  clientY?: number;
  /** Spacebar held — shared signal with `useViewportController`'s pan-drag. */
  spaceHeld?: boolean;
  /** Event target is editable (input/textarea/contentEditable) — caller computes. */
  isEditable?: boolean;
  activeTool: Tool;
  /** V2-4.5b — the shell's mode (bridge/canvas-mode-store.ts); null/absent = ungoverned (v1). */
  mode?: CanvasModeV2 | null;
  /** The governed caps (null = ungoverned: every tool, `setTool` still refuses a read-only one). */
  caps?: Readonly<ModeCaps> | null;
  /** The Marker's last-used tip (Q4); `pen` when absent. */
  markerTip?: ToolId;
  /** V2-4 gate — the shell's "Single-key shortcuts" switch (bridge `key-prefs`); absent = on. */
  singleKeys?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Keys (V2-2.4 step 5; V2-4.5b) — the router's keys are registry actions (actions/defs/tool.ts,
// view.ts, ui.ts, edit.ts), resolved against the canvas keymap with the mode in the context: the
// toolbar letters per mode (`modeKeys`), ⌥⌘P, esc with any modifier, ⌘Z / ⇧⌘Z / ⌘Y. What a tool
// key DOES is `toolKeyAction` (bridge/canvas-modes.ts): arm it here, add one (a momentary slot),
// open a panel, or — governed — ask the shell for the other mode (M3) or for the denial line.
//
// Ungoverned (no `set-mode` yet — a standalone canvas) keeps v1's local behaviour: the keys resolve
// against the posture the tool implies (`browse` → Preview, else Edit) and a crossing applies
// locally, as v1's mode-neutral tools did.

const ROUTER_FIXED: Readonly<Record<string, RouterAction>> = {
  'ui.step-back': { kind: 'escape' },
  'edit.undo': { kind: 'undo' },
  'edit.redo': { kind: 'redo' },
};
const ROUTER_KEYS = canvasKeyIndex(
  CANVAS_KEYMAP.filter(
    (a) => (a.id.startsWith('tool.') && a.id !== 'tool.hand-hold') || a.id === 'mode.preview'
  )
    .map((a) => a.id)
    .concat(Object.keys(ROUTER_FIXED))
);

// `el-text` (S2.12b) and the S2.13 drag tools are the v2 tools the canvas arms itself; the others wait on their slice.
const V1_TOOLS: ReadonlySet<string> = new Set<string>([
  ...V1_TOOL_IDS,
  'el-text',
  // S2.13 — drawn by editing/draw-tools.tsx
  'frame',
  'el-shape',
  'ellipse',
  'line',
  'polygon',
  'slice',
  // S2.14 — drawn by editing/pen/draw.tsx
  'el-pen',
  // S2.15 — More › Crop (editing/crop-mode.tsx)
  'crop',
  // S3.11 — `inspect` is a tool with no v1 bridge
  'inspect',
]);
/** A v2 slot tool as the `Tool` the canvas arms (S3.11: `inspect` is one, with no bridge). */
const v1Tool = (t: ToolId): Tool | null => armTarget(t, (x) => V1_TOOLS.has(x)) as Tool | null;

function classifyToolKey(chord: string, mode: CanvasModeV2, input: ClassifyInput): RouterAction {
  const governed = !!input.mode;
  const hit = toolKeyAction(mode, chord, input.caps ?? ALL_CAPS, input.markerTip ?? 'pen');
  if (!hit) return { kind: 'no-op' };
  if (hit.kind === 'insert') return { kind: 'insert', insert: hit.insert };
  if (hit.kind === 'panel') return { kind: 'panel', panel: hit.panel };
  if (hit.kind === 'arm') {
    const t = v1Tool(hit.tool);
    return t ? { kind: 'tool', tool: t } : { kind: 'no-op' };
  }
  if (governed) {
    // A panel-only slot the role may not use asks for the panel; the shell refuses it by role.
    if (hit.kind === 'deny' && hit.panel) return { kind: 'panel', panel: hit.panel };
    const out: Extract<RouterAction, { kind: 'mode-request' }> = {
      kind: 'mode-request',
      mode: hit.mode,
      cause: 'key',
    };
    if (hit.tool) out.tool = hit.tool;
    if (hit.kind === 'request' && hit.panel) out.panel = hit.panel;
    return out;
  }
  // Ungoverned: the crossing is local (V2-1.2 §5.4 "standalone: apply locally").
  if (hit.kind === 'request' && hit.panel) return { kind: 'panel', panel: hit.panel };
  const t = v1Tool(hit.tool ?? MODE_TOOLS[hit.mode].rest);
  return t ? { kind: 'tool', tool: t } : { kind: 'no-op' };
}

function classifyKey(input: ClassifyInput): RouterAction {
  const chord = chordFromEvent({
    key: input.key ?? '',
    code: input.code,
    metaKey: input.metaKey,
    ctrlKey: input.ctrlKey,
    altKey: input.altKey,
    shiftKey: input.shiftKey,
  });
  const governed = input.mode ?? null;
  const mode: CanvasModeV2 = governed ?? (input.activeTool === 'browse' ? 'preview' : 'edit');
  const r = resolveChord(
    ROUTER_KEYS,
    chord,
    canvasKeyCtx({
      typing: !!input.isEditable,
      readOnly: false,
      mode,
      singleKeys: input.singleKeys,
    })
  );
  if (!r) return { kind: 'no-op' };
  const id = r.action.id;
  if (id === 'mode.preview') {
    // Q1 — ⌥⌘P toggles: in Preview it steps back to baseMode, anywhere else it enters Preview.
    if (governed)
      return {
        kind: 'mode-request',
        mode: governed === 'preview' ? 'back' : 'preview',
        cause: 'key',
      };
    return { kind: 'tool', tool: input.activeTool === 'browse' ? 'move' : 'browse' };
  }
  if (id.startsWith('tool.')) return classifyToolKey(r.binding.chord, mode, input);
  const fixed = ROUTER_FIXED[id];
  if (!fixed) return { kind: 'no-op' };
  // DDR-247 — an embed's esc belongs to its relay; it never asks the embed's shell for a mode.
  if (fixed.kind === 'escape' && governed && !isEmbedCanvas()) {
    if (escStep(governed, input.activeTool) === 'back') return { kind: 'escape', back: true };
    // S1.14 — a past version (Viewing, `?sha=`): esc is "back to now"; the shell steps out of the hold.
    if (isHistoricalCanvas()) return { kind: 'escape', back: true };
  }
  return { ...fixed };
}

// ─────────────────────────────────────────────────────────────────────────────
// classify — pure function. All branching lives here so unit tests cover every
// row of the dispatch table without spinning up a DOM.

const metaOrCtrl = (i: ClassifyInput): boolean => !!(i.metaKey || i.ctrlKey);

/**
 * S4.9 - does an armed annotation tool own the pointer here? Only where annotations are Preview's to change.
 * In Edit (quiet layer), Viewing and Present a leftover annotation tool id owns nothing: the click reaches the
 * design under the sticky. A canvas no shell governs (mode null) keeps v1: the armed tool owns the pointer.
 */
export function annotationToolOwnsPointer(
  input: Pick<ClassifyInput, 'activeTool' | 'mode'>
): boolean {
  if (!isAnnotationTool(input.activeTool)) return false;
  return !input.mode || modeShows(input.mode, 'annotations-editable');
}

export function classify(input: ClassifyInput): RouterAction {
  if (input.type === 'keydown') return classifyKey(input);

  if (input.type === 'contextmenu') {
    return {
      kind: 'context-menu',
      clientX: input.clientX ?? 0,
      clientY: input.clientY ?? 0,
    };
  }

  if (input.type === 'pointermove') {
    // Phase 5 draw tools: pen / rect / arrow / eraser own all their pointer
    // events through `AnnotationsLayer`. The router never paints a hover halo
    // while drawing — that affordance is reserved for select / comment.
    if (annotationToolOwnsPointer(input)) return { kind: 'no-op' };
    // Hand tool: drag pan is owned by useViewportController; no hover paint.
    if (input.activeTool === 'hand') return { kind: 'no-op' };
    // Browse tool (feature-4 boot default): pass-through — no hover halo,
    // native interactions flow. Cmd-held hover previews the deepest element
    // (the escape-hatch select affordance, mirroring the old move-tool
    // behavior); bare hover stays native.
    if (input.activeTool === 'browse') {
      if (!metaOrCtrl(input)) return { kind: 'no-op' };
      return {
        kind: 'hover',
        deep: true,
        clientX: input.clientX ?? 0,
        clientY: input.clientY ?? 0,
      };
    }
    // S3.11 — Inspect: the halo previews the deepest element a click would inspect.
    if (input.activeTool === 'inspect') {
      return {
        kind: 'hover',
        deep: true,
        clientX: input.clientX ?? 0,
        clientY: input.clientY ?? 0,
      };
    }
    // Comment tool: always paint a preview halo on the deepest element under
    // cursor — that's the element the user is about to comment on. Comment
    // pin attachment is to the same element they were hovering.
    if (input.activeTool === 'comment') {
      return {
        kind: 'hover',
        deep: true,
        clientX: input.clientX ?? 0,
        clientY: input.clientY ?? 0,
      };
    }
    // Move (select) tool: paint a preview halo of exactly what a click would
    // select — the TOP-level object on a bare hover (Figma's hover outline),
    // the DEEPEST element while Cmd is held (deep-select preview).
    return {
      kind: 'hover',
      deep: metaOrCtrl(input),
      clientX: input.clientX ?? 0,
      clientY: input.clientY ?? 0,
    };
  }

  if (input.type === 'pointerdown') {
    if (input.button === 2) {
      return {
        kind: 'context-menu',
        clientX: input.clientX ?? 0,
        clientY: input.clientY ?? 0,
      };
    }
    if (input.button === 1 || input.spaceHeld) return { kind: 'no-op' };
    if (input.button !== 0) return { kind: 'no-op' };

    // Phase 5 draw tools own bare left-clicks; the router returns no-op so
    // the SVG layer's own listeners (no preventDefault) fire normally. Cmd-
    // modified clicks still flow into the move-tool select path below — that
    // stays available as an escape hatch even while a draw tool is active.
    if (annotationToolOwnsPointer(input) && !metaOrCtrl(input)) {
      return { kind: 'no-op' };
    }

    if (input.activeTool === 'comment') {
      // Comment tool: bare click drops a pin. Cmd / Shift modifiers reserved
      // for future "scope comment to deepest" variants — for now they fall
      // through to the same drop.
      return {
        kind: 'drop-comment',
        clientX: input.clientX ?? 0,
        clientY: input.clientY ?? 0,
      };
    }

    // Hand tool: pan is owned by useViewportController via `isPanDragActive`.
    // Router returns no-op so it doesn't preventDefault or stopPropagation —
    // the controller's pointerdown listener on the same host claims the drag.
    if (input.activeTool === 'hand') return { kind: 'no-op' };

    // S3.11 — Inspect: a click picks the deepest element and holds exactly one (Shift does not add).
    // The press is not claimed (see onPointerDown): a drag from here pans the canvas.
    if (input.activeTool === 'inspect') {
      return {
        kind: 'select',
        mode: 'replace',
        deep: true,
        clientX: input.clientX ?? 0,
        clientY: input.clientY ?? 0,
      };
    }

    // Browse tool (feature-4 boot default): bare/Shift left-clicks pass
    // through so the mock stays alive (a button press fires, a link follows,
    // an input focuses). Cmd/Ctrl+click is the ESCAPE HATCH (user steer
    // 2026-07-19): it selects the deepest element AND the consumer flips the
    // tool to Move — "I clicked to edit" shouldn't require pressing V first.
    if (input.activeTool === 'browse') {
      if (!metaOrCtrl(input)) return { kind: 'no-op' };
      return {
        kind: 'select',
        mode: input.shiftKey ? 'add' : 'replace',
        deep: true,
        clientX: input.clientX ?? 0,
        clientY: input.clientY ?? 0,
      };
    }

    // Move (select) tool. feature-4 (DDR-187) — the full Figma ladder:
    //   bare click       → select TOP-level object   (deep:false, replace)
    //   Shift+click      → add TOP-level object        (deep:false, add)
    //   Cmd/Ctrl+click   → select DEEPEST element      (deep:true, replace)
    //   Cmd+Shift+click  → add DEEPEST element          (deep:true, add)
    // Bare clicks are claimed (preventDefault) so native canvas interactions do
    // NOT fire in select mode — that's the browse tool's job. The click-vs-drag
    // threshold (canvas-shell.tsx ReorderDrag / marquee overlays, all still
    // gated on `tool === 'move'`) means a press that turns into a drag reorders
    // / marquees instead; a release-in-place is the select.
    const cmd = metaOrCtrl(input);
    const shift = !!input.shiftKey;
    return {
      kind: 'select',
      mode: shift ? 'add' : 'replace',
      deep: cmd,
      clientX: input.clientX ?? 0,
      clientY: input.clientY ?? 0,
    };
  }

  return { kind: 'no-op' };
}

// ─────────────────────────────────────────────────────────────────────────────
// useInputRouter — attach listeners scoped to `hostRef.current`. Dispatches
// through `callbacks`. Returns nothing; cleans up on unmount.

export interface RouterCallbacks {
  onHover?: (a: Extract<RouterAction, { kind: 'hover' }>) => void;
  onSelect?: (a: Extract<RouterAction, { kind: 'select' }>) => void;
  onDropComment?: (a: Extract<RouterAction, { kind: 'drop-comment' }>) => void;
  onContextMenu?: (a: Extract<RouterAction, { kind: 'context-menu' }>) => void;
  onTool?: (a: Extract<RouterAction, { kind: 'tool' }>) => void;
  /** S3.12 — `true` when the press ran a rung (the ladder in bridge/esc-ladder.ts): the mode is not
   *  asked to step back as well. Anything else (`void` included) is v1's "ran everything". */
  onEscape?: () => boolean | void;
  /** Phase 20 — Cmd+Z / Ctrl+Z. */
  onUndo?: () => void;
  /** Phase 20 — Cmd+Shift+Z / Ctrl+Y / Cmd+Y. */
  onRedo?: () => void;
}

export interface UseInputRouterOptions {
  hostRef: RefObject<HTMLElement | null>;
  /** Latest active tool — read at event time, not captured. */
  getActiveTool: () => Tool;
  /** Optional spacebar-held signal shared with useViewportController. */
  isSpaceHeld?: () => boolean;
  callbacks: RouterCallbacks;
  /** When false, listeners are not attached. Defaults to true. */
  enabled?: boolean;
  /**
   * Allowlist of action kinds this router is permitted to CLAIM (preventDefault
   * + stopImmediatePropagation + dispatch). Any classified action outside the
   * set is downgraded to `no-op` so it propagates untouched to other listeners.
   * Omit to claim everything (the default — used by the full DesignCanvas
   * router). The shell-owned comment mount layer passes a narrow set so it can
   * coexist as an ANCESTOR capture-listener over a UI canvas's own router
   * without swallowing select / context-menu / undo gestures it doesn't own.
   */
  claimableActions?: ReadonlySet<RouterAction['kind']>;
}

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t as HTMLElement).tagName) return false;
  const el = t as HTMLElement;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  // Dogfood fix — `.isContentEditable` is a computed/inherited property whose
  // handling of the `contenteditable="plaintext-only"` token (the value the
  // element-text-edit system uses, canvas-shell.tsx) has had cross-engine/
  // version inconsistencies. Check the raw attribute too so a tool-letter
  // shortcut (R, T, N, …) can never fire while that editor has focus,
  // regardless of whether isContentEditable correctly reflects it in a given
  // runtime — this was the reported bug (typing "R" while editing in-canvas
  // text switched to the Rectangle tool).
  const raw = el.getAttribute?.('contenteditable');
  if (raw === 'true' || raw === 'plaintext-only' || raw === '') return true;
  return false;
}

/**
 * Phase 6 — the comments overlay (pins / composer / thread popover / mention
 * popup) lives INSIDE the canvas world, which means its DOM nodes are inside
 * the input-router's capture host. Without an explicit bail-out the router
 * would `preventDefault + stopImmediatePropagation` every click on a
 * composer button while comment mode is active, blocking Save / Cancel.
 *
 * We treat the overlay nodes like editable form widgets — the router yields,
 * the React event handler runs.
 */
export function isOverlayTarget(t: EventTarget | null): boolean {
  if (!t || !(t as Element).closest) return false;
  const el = t as Element;
  // Security review (issue-90) — `.dc-world` is exactly the subtree the
  // active canvas's own JSX renders into (`canvas-lib.tsx`'s
  // `<div className="dc-world">{children}</div>`); every selector below is
  // shell-owned chrome that NEVER renders inside it (ToolPalette/
  // AnnotationsLayer/ContextMenuView are siblings of `.dc-canvas`,
  // DCZoomToolbar/DCMiniMap are children of `.dc-canvas` but siblings of
  // `.dc-world`). Since untrusted, AI/user-authored canvas content is the one
  // thing that DOES render inside `.dc-world`, it could otherwise spoof one
  // of these class names on its own element to make the router yield to it
  // (skip `preventDefault`) instead of claiming the gesture — bail out first
  // so a same-name imposter inside the canvas never qualifies.
  if (el.closest('.dc-world')) return false;
  // [data-mediaref-player] — the inline <video>/<audio controls> on a media
  // reference chip (DDR-150 dogfood #8). The router must never claim (and
  // preventDefault) pointerdowns over the player, or its native controls
  // (play button, scrubber drag, volume) die under the move tool.
  //
  // .dc-tool-palette, .dc-zoom-tb, .dc-mm, .dc-context-menu (issue-90) — the
  // shell's floating chrome renders as SIBLINGS of `.dc-canvas` but INSIDE
  // this router's host (`[data-mc-host]` wraps the whole surface, chrome
  // included). Without this exemption, once comment mode is armed every
  // click on the palette/zoom-pill/minimap/context-menu was claimed as
  // `drop-comment` (preventDefault + stopImmediatePropagation) and dropped a
  // stray pin at the chrome's own coordinates instead of reaching its React
  // onClick — `classifyContextKind` (canvas-shell.tsx) already treats these
  // same selectors as `'overlay'`, non-canvas chrome; this router's claim
  // gate was the one place that didn't.
  return !!el.closest(
    '.cm-composer, .cm-thread, .cm-mention-popup, .cm-pin, [data-mediaref-player], .dc-tool-palette, .dc-zoom-tb, .dc-mm, .dc-context-menu'
  );
}

/**
 * Artboard "chrome" — inside an artboard (`[data-dc-screen]`) but OUTSIDE its
 * `.dc-artboard-body` content box, i.e. the label strip + border that
 * `use-artboard-drag.tsx` binds its own bubble-phase `onPointerDown` to
 * (`bindHandle()`, spread directly on the `.dc-artboard` article). The router
 * runs in the CAPTURE phase ahead of that handler; claiming a bare press here
 * — same as any other chrome hit, the router still selects the artboard —
 * used to `stopImmediatePropagation` the native event before it ever reached
 * the drag hook's listener, so no artboard could be repositioned by its
 * header at all (issue-71). A modifier-held press is not exempted: the drag
 * hook itself ignores Cmd/Ctrl (reserved for deep-select), so nothing
 * downstream needs the raw event in that case.
 */
export function isArtboardDragChrome(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false;
  const el = t as Element;
  return !!el.closest('[data-dc-screen]') && !el.closest('.dc-artboard-body');
}

/** S3.9 — is the target inside an artboard's design surface (`.dc-artboard-body`)? The label strip and
 *  the bare canvas are not. */
export function isDesignSurface(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false;
  return !!(t as Element).closest('.dc-artboard-body');
}

/**
 * S3.9 (V2-1.2 Q3) — does a bare left-button drag pan the canvas? Hand always does; Preview's Hand rests on
 * `browse`, where a click uses the design, so a drag pans only when it starts OFF the design (empty canvas,
 * an artboard's label) — a drag on the design goes to the design (sliders, scroll areas, text selection).
 * Space-drag and middle-button pan everywhere, ahead of this.
 */
export function dragPansCanvas(tool: Tool, onDesign: boolean): boolean {
  return tool === 'hand' || tool === 'inspect' || (tool === 'browse' && !onDesign);
}

/**
 * Should the router's pointerdown/mousedown handler skip
 * `stopImmediatePropagation` so the event still reaches use-artboard-drag.tsx?
 * Pulled out of the two near-identical handlers below so the decision itself
 * — not just `isArtboardDragChrome`'s target test — is covered by a DOM-free
 * unit test (issue-71).
 */
export function yieldsToArtboardDrag(
  action: RouterAction,
  target: EventTarget | null,
  modifiers: { metaKey: boolean; ctrlKey: boolean; clientX?: number; clientY?: number }
): boolean {
  return (
    action.kind === 'select' &&
    !modifiers.metaKey &&
    !modifiers.ctrlKey &&
    (isArtboardDragChrome(target) || isPageHit(target, modifiers.clientX, modifiers.clientY))
  );
}

/**
 * V2-8.5 round 3 (14 ed-ab-arrange) — a press ON the page (the artboard's one root element, nothing under the
 * pointer but the page itself) is a press on the artboard: its drag moves the artboard, like its label does.
 * A press on an object inside the page is that object's (select, then the element's own drag).
 */
export function isPageHit(
  target: EventTarget | null,
  clientX: number | undefined,
  clientY: number | undefined
): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as Element;
  if (
    !el.closest('.dc-artboard-body') ||
    typeof clientX !== 'number' ||
    typeof clientY !== 'number'
  )
    return false;
  const hit = resolveHoverTarget(el.ownerDocument, clientX, clientY, { deep: false });
  return !!hit && hit.cdId === null && hit.el.hasAttribute('data-dc-screen');
}

/**
 * Click-phase counterpart to `yieldsToArtboardDrag` (issue-78). The onClick
 * handler below suppresses the browser's native `click` for every gesture it
 * already routed as `select` on the matching pointerdown, so a just-selected
 * element's own click handler doesn't also fire. But an artboard-chrome
 * control — e.g. the video-timeline badge (`.dc-artboard-video-badge`,
 * DDR-148) rendered as a sibling of `.dc-artboard-body` — never goes through
 * `select`; it's an interactive button that needs its own `onClick` to reach
 * React. Without this exemption a bare click on it while in Move (or a
 * Cmd/Ctrl+click from Browse/an annotation tool) is preventDefault +
 * stopImmediatePropagation'd in the capture phase before React's delegated
 * listener ever runs, so the button silently does nothing. Mirrors
 * `yieldsToArtboardDrag`'s modifier gate: a held Cmd/Ctrl is reserved for
 * deep-select and stays unexempted.
 */
export function yieldsClickToArtboardChrome(
  wouldRouteKind: RouterAction['kind'] | null,
  target: EventTarget | null,
  modifiers: { metaKey: boolean; ctrlKey: boolean }
): boolean {
  return (
    wouldRouteKind === 'select' &&
    !modifiers.metaKey &&
    !modifiers.ctrlKey &&
    isArtboardDragChrome(target)
  );
}

/** V2-4.5b — a momentary slot's key asks the toolbar (tool-palette.tsx owns the insert anchor). */
export const TOOLBAR_INSERT_EVENT = 'maude:toolbar-insert';

// ── S3.10a — on-click links, Preview branch only (contract S3-links-format §5 step 1) ────────────
// A plain left click in Preview whose `closest('[data-cd-link]')` also carries a `data-cd-id` posts
// `link-follow {elementId, artboardId}` and prevents the default. The canvas never posts the TARGET (the
// shell reads it from the TSX, `GET /_api/links`): the canvas origin is untrusted (DDR-054). Edit,
// Viewing and Present never post it; ⌘-click inspects (S3.11).
const LINK_ELEMENT_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LINK_ARTBOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** What a click asks the shell to follow, or null. Pure over the DOM it is handed. */
export function linkFollowOf(
  target: EventTarget | null,
  click: { mode: CanvasModeV2 | null | undefined; button: number; mod: boolean; shift?: boolean }
): { elementId: string; artboardId: string | null } | null {
  if (!modeShows(click.mode, 'live-design') || click.button !== 0 || click.mod || click.shift)
    return null;
  const el = (target as Element | null)?.closest?.('[data-cd-link]');
  const id = el?.getAttribute('data-cd-id');
  if (!el || !id || id.length > 48 || !LINK_ELEMENT_ID_RE.test(id) || /^[0-9a-f]{8}$/.test(id))
    return null;
  const ab = el.closest('[data-dc-screen]')?.getAttribute('data-dc-screen') ?? null;
  return { elementId: id, artboardId: ab && LINK_ARTBOARD_ID_RE.test(ab) ? ab : null };
}

// Both routers of a document (the comment-mount ancestor too) see one click: post once per event.
const linkFollowed = new WeakSet<Event>();

function postLinkFollow(e: MouseEvent): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false;
  const hit = linkFollowOf(e.target, {
    mode: canvasModeStore(window).get()?.mode ?? null,
    button: e.button,
    mod: e.metaKey || e.ctrlKey,
    shift: e.shiftKey,
  });
  if (!hit) return false;
  e.preventDefault();
  if (linkFollowed.has(e)) return true;
  linkFollowed.add(e);
  try {
    window.parent.postMessage(
      { dgn: 'link-follow', elementId: hit.elementId, artboardId: hit.artboardId },
      '*'
    );
  } catch {
    /* detached */
  }
  return true;
}

/** V2-4.5b — a key's `mode-request` (M3: no local change). Both routers of a document can see one
 *  keydown (the comment-mount ancestor claims esc too), so the document asks once (claimRequest).
 *  Literal posts, so the dgn inventory sees the send sites. */
export function postModeRequest(r: {
  mode: CanvasModeV2 | 'back';
  tool?: ToolId;
  cause: 'key' | 'esc';
}): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  if (!canvasModeStore(window).claimRequest(`${r.mode}|${r.tool ?? ''}`)) return;
  try {
    window.parent.postMessage(
      r.tool
        ? { dgn: 'mode-request', mode: r.mode, tool: r.tool, cause: r.cause }
        : { dgn: 'mode-request', mode: r.mode, cause: r.cause },
      '*'
    );
  } catch {
    /* detached */
  }
}

/** V2-4.5b — the shell renders the tool panels (V2-1.2 §5.5); it anchors them to `toolbar-rect`. */
function postPanelOpen(panel: SlotPanel): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage({ dgn: 'tool-panel-open', panel, anchor: null }, '*');
  } catch {
    /* detached */
  }
}

export function useInputRouter(opts: UseInputRouterOptions): void {
  const { hostRef, getActiveTool, isSpaceHeld, callbacks, enabled = true, claimableActions } = opts;

  useEffect(() => {
    if (!enabled) return;
    const host = hostRef.current;
    if (!host) return;

    // Downgrade any action this router isn't permitted to claim to no-op so it
    // propagates untouched (no preventDefault / no dispatch). Identity pass-
    // through when no allowlist is configured.
    const claim = (action: RouterAction): RouterAction =>
      claimableActions && action.kind !== 'no-op' && !claimableActions.has(action.kind)
        ? { kind: 'no-op' }
        : action;

    const dispatch = (action: RouterAction): void => {
      switch (action.kind) {
        case 'hover':
          callbacks.onHover?.(action);
          break;
        case 'select':
          callbacks.onSelect?.(action);
          break;
        case 'drop-comment':
          callbacks.onDropComment?.(action);
          break;
        case 'context-menu':
          callbacks.onContextMenu?.(action);
          break;
        case 'tool':
          callbacks.onTool?.(action);
          break;
        case 'escape': {
          const ranRung = callbacks.onEscape?.();
          // V2-4.5b — nothing left to leave here: the shell steps the mode back (escStep). S3.12: only when
          // the press ran no rung — a cleared selection is the step, the mode stays (04 md-esc, one at a time).
          if (action.back && ranRung !== true) postModeRequest({ mode: 'back', cause: 'esc' });
          break;
        }
        case 'mode-request':
          postModeRequest(action);
          if (action.panel) postPanelOpen(action.panel);
          break;
        case 'insert':
          if (typeof document !== 'undefined')
            document.dispatchEvent(
              new CustomEvent(TOOLBAR_INSERT_EVENT, { detail: { kind: action.insert } })
            );
          break;
        case 'panel':
          postPanelOpen(action.panel);
          break;
        case 'undo':
          callbacks.onUndo?.();
          break;
        case 'redo':
          callbacks.onRedo?.();
          break;
        case 'no-op':
          break;
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      const action = claim(
        classify({
          type: 'pointermove',
          button: e.button,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          clientX: e.clientX,
          clientY: e.clientY,
          spaceHeld: isSpaceHeld?.() ?? false,
          activeTool: getActiveTool(),
        })
      );
      dispatch(action);
    };

    const onPointerDown = (e: PointerEvent): void => {
      // Phase 6 — overlay surfaces (composer / thread / mention popup) own
      // their own clicks. The router is in capture phase, so we have to
      // bail HERE before classify can claim the event.
      if (isOverlayTarget(e.target)) return;
      // feature-4 text-gestures (2026-07-20) — an ACTIVE inline text editor
      // (contenteditable) owns its clicks natively: single click places the
      // caret, dblclick selects a word, triple-click selects all. Claiming
      // these as `select` killed every in-edit gesture.
      if (isEditableTarget(e.target)) return;
      const action = claim(
        classify({
          type: 'pointerdown',
          button: e.button,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          clientX: e.clientX,
          clientY: e.clientY,
          spaceHeld: isSpaceHeld?.() ?? false,
          activeTool: getActiveTool(),
        })
      );
      // issue-71 — a bare press on an artboard's own drag chrome must still
      // reach that artboard's `onPointerDown` (use-artboard-drag.tsx) so its
      // pending→dragging state machine can arm, or no artboard can ever be
      // repositioned by its header. The router still SELECTS (dispatch below
      // is unconditional) and still preventDefaults the browser's native
      // click-drag text-selection — it only skips stopImmediatePropagation,
      // which is the one call that would keep the event from ever reaching
      // the bubble-phase listener bound to the very element it targeted.
      // S3.11 — the same exemption for Inspect: its select must not keep the viewport controller from
      // arming a pan on the same press (a click inspects, a drag pans).
      const yields =
        yieldsToArtboardDrag(action, e.target, e) ||
        (action.kind === 'select' && getActiveTool() === 'inspect');
      if (action.kind !== 'no-op') {
        // Suppress native behavior on every event the router claims —
        // button presses don't fire, inputs don't focus, the canvas
        // content's own click handlers don't run. The router lives in
        // capture phase so this fires before descendants.
        e.preventDefault();
        if (!yields) e.stopImmediatePropagation();
      }
      dispatch(action);
    };

    /**
     * Paired mousedown listener — preventDefault on pointerdown does NOT
     * suppress the mousedown event that browsers fire alongside, and
     * `<input>` / `<button>` focus is driven by mousedown's default behavior.
     * We mirror the same gate as pointerdown so suppressed pointerdowns also
     * stop their twin mousedown.
     */
    const onMouseDown = (e: MouseEvent): void => {
      if (isOverlayTarget(e.target)) return;
      if (isEditableTarget(e.target)) return;
      const action = claim(
        classify({
          type: 'pointerdown',
          button: e.button,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          clientX: e.clientX,
          clientY: e.clientY,
          spaceHeld: isSpaceHeld?.() ?? false,
          activeTool: getActiveTool(),
        })
      );
      // issue-71 — same exemption as onPointerDown above: preventDefault still
      // runs (blocks the native click-drag text-selection an un-prevented
      // mousedown would start), but stopImmediatePropagation is skipped so the
      // paired pointerdown reaching use-artboard-drag.tsx isn't undone here.
      const yields = yieldsToArtboardDrag(action, e.target, e);
      if (action.kind !== 'no-op') {
        e.preventDefault();
        if (!yields) e.stopImmediatePropagation();
        // preventDefault above stops mousedown's default FOCUS, so a Cmd-click
        // select would leave the iframe unfocused and every in-canvas keyboard
        // shortcut (arrow-nudge, Cmd+D, copy/paste-style, Delete) dead until a
        // drag happened to focus it (dogfood: "funguje jen když hnu myší").
        // Restore canvas focus explicitly so the keydown listeners fire.
        if (action.kind === 'select') {
          try {
            window.focus();
          } catch {
            /* focus may be rejected outside a user gesture */
          }
        }
      }
    };

    /**
     * Click listener — fires AFTER pointerdown+pointerup. Even with
     * preventDefault on mousedown, the click event still synthesizes for
     * non-form elements. We suppress it whenever the router claimed the
     * matching pointerdown (re-classify with the same modifiers).
     */
    const onClick = (e: MouseEvent): void => {
      if (isOverlayTarget(e.target)) return;
      if (isEditableTarget(e.target)) return;
      if (postLinkFollow(e)) return; // S3.10a — Preview only; the shell follows (or drops) it
      const tool = getActiveTool();
      const mod = e.metaKey || e.ctrlKey;
      // Map the click to the action kind the matching pointerdown would have
      // produced, then honor the claim allowlist so a scoped router (the
      // comment mount layer) doesn't suppress clicks it never claimed.
      // feature-4 — in the Move (select) tool EVERY bare left click is a select
      // (not just Cmd), so its synthetic click must be swallowed too or the
      // native handler under the just-selected element would still fire. Draw
      // tools keep the Cmd-only escape-hatch select. Browse claims nothing.
      const wouldRouteKind: RouterAction['kind'] | null =
        tool === 'comment'
          ? 'drop-comment'
          : (tool === 'move' || tool === 'inspect') && e.button === 0
            ? 'select'
            : (isAnnotationTool(tool) || tool === 'browse') && mod && e.button === 0
              ? 'select'
              : e.button === 2
                ? 'context-menu'
                : null;
      if (wouldRouteKind && (!claimableActions || claimableActions.has(wouldRouteKind))) {
        // issue-78 — a bare click on an artboard-chrome control (the video-
        // timeline badge) must still reach its own onClick; see
        // yieldsClickToArtboardChrome for why. Mirrors the onPointerDown/
        // onMouseDown pattern above: preventDefault always runs (so a forged
        // chrome-alike element inside untrusted canvas content can't use this
        // exemption to let its own native click default action — e.g. an
        // <a>'s navigation or an <input type="file">'s picker — fire), but
        // stopImmediatePropagation is skipped so the real chrome button's own
        // React onClick still gets the (now-inert-by-default) event.
        const yields = yieldsClickToArtboardChrome(wouldRouteKind, e.target, e);
        e.preventDefault();
        if (!yields) e.stopImmediatePropagation();
      }
    };

    const onContextMenu = (e: MouseEvent): void => {
      const action = claim(
        classify({
          type: 'contextmenu',
          clientX: e.clientX,
          clientY: e.clientY,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          activeTool: getActiveTool(),
        })
      );
      if (action.kind === 'no-op') return; // not ours to claim — let it bubble
      e.preventDefault();
      e.stopImmediatePropagation();
      dispatch(action);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      // V2-4.5b — the governed mode + caps, read at keydown (the shell may have switched since).
      const gov = typeof window !== 'undefined' ? canvasModeStore(window).get() : null;
      const action = claim(
        classify({
          type: 'keydown',
          key: e.key,
          code: e.code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          isEditable: isEditableTarget(e.target),
          activeTool: getActiveTool(),
          mode: gov?.mode ?? null,
          caps: gov?.caps ?? null,
          markerTip: lastMarkerTip(),
          singleKeys: gov?.singleKeys ?? true,
        })
      );
      // S3.12 — a context menu / thread popover / picker owns this esc and closes itself: no rung runs,
      // the mode does not move, the key is not consumed here.
      if (action.kind === 'escape' && escOwnerOpen(host.ownerDocument ?? document)) return;
      if (
        action.kind === 'tool' ||
        action.kind === 'mode-request' ||
        action.kind === 'insert' ||
        action.kind === 'panel' ||
        // DDR-247 — in an embed, the router's catch-all Escape (drop the
        // selection) does not CONSUME the key: left unprevented, it reaches
        // the embed's relay and closes the app's dialog around it. Anything
        // that genuinely owns Escape (a menu, an inline edit) still prevents it.
        (action.kind === 'escape' && !isEmbedCanvas()) ||
        action.kind === 'undo' ||
        action.kind === 'redo'
      ) {
        e.preventDefault();
      }
      dispatch(action);
    };

    // Capture phase for pointer/mouse/click events — router runs BEFORE
    // descendants (buttons, inputs, canvas content listeners). For events the
    // classifier claims, we preventDefault + stopImmediatePropagation so the
    // descendants never see them.
    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerdown', onPointerDown, { capture: true });
    host.addEventListener('mousedown', onMouseDown, { capture: true });
    host.addEventListener('click', onClick, { capture: true });
    host.addEventListener('contextmenu', onContextMenu, { capture: true });
    // Key events: attach on document so focus inside any descendant is OK;
    // the editable-target gate handles the "user is typing" case.
    const doc = host.ownerDocument ?? document;
    doc.addEventListener('keydown', onKeyDown, true);

    return () => {
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerdown', onPointerDown, {
        capture: true,
      } as EventListenerOptions);
      host.removeEventListener('mousedown', onMouseDown, { capture: true } as EventListenerOptions);
      host.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
      host.removeEventListener('contextmenu', onContextMenu, {
        capture: true,
      } as EventListenerOptions);
      doc.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled, hostRef, getActiveTool, isSpaceHeld, callbacks, claimableActions]);
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveHoverTarget — walks from a clientX/clientY pair to the canvas element
// of interest. Default = topmost `[data-cd-id]` ancestor (the stable
// pipeline-stamped anchor). `deep = true` returns the deepest descendant
// (Cmd-hover behavior).

export interface HoverTarget {
  el: Element;
  cdId: string | null;
  artboardId: string | null;
}

/**
 * V2-8.5 round 3 — the page root IS the artboard (14 Editing: Layers lists Nav · Hero · Services under "Desktop";
 * 01/04: a click on the page selects the artboard). An artboard's page is ONE stamped element that fills the
 * body; return it, or null when the body has several top-level objects or the lone one is a card smaller than the
 * artboard (then it is an object like any other and stays selectable by a plain click).
 */
export function pageRootOf(bodyEl: Element): Element | null {
  // The first stamped element in document order cannot sit under another stamped one (an ancestor comes first), so
  // it is a top-level object; the body has a single page when nothing after it, on the way up to the body, holds
  // another. Walks the path and its later siblings only — cheap enough for a hover frame on a long page.
  const root = bodyEl.querySelector('[data-cd-id]');
  if (!root) return null;
  for (let at: Element | null = root; at && at !== bodyEl; at = at.parentElement) {
    for (let sib = at.nextElementSibling; sib; sib = sib.nextElementSibling) {
      if (sib.hasAttribute('data-cd-id') || sib.querySelector('[data-cd-id]')) return null;
    }
  }
  const b = bodyEl.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  // a hair of slack: scrollbars, sub-pixel scale. Both boxes share one transform, so the ratio is zoom-proof.
  if (!(b.width > 0 && b.height > 0)) return null;
  if (r.width < b.width * 0.98 || r.height < b.height * 0.98) return null;
  return root;
}

/** The double-click ladder / top-object chain below the page: drop the page root (the artboard) from its head. */
export function dropPageRoot<T extends Element>(chain: readonly T[]): T[] {
  const head = chain[0];
  const body = head?.closest('.dc-artboard-body');
  if (head && body && pageRootOf(body) === head) return chain.slice(1);
  return [...chain];
}

export function resolveHoverTarget(
  doc: Document,
  clientX: number,
  clientY: number,
  opts: { deep: boolean }
): HoverTarget | null {
  const hit = doc.elementFromPoint(clientX, clientY);
  if (!hit) return null;
  // Skip the floating chrome (MiniMap / ZoomToolbar / ToolPalette / ContextMenu)
  // AND the canvas/world frame itself — the user is never asking to "select
  // the entire canvas viewport," that's a UI accident from climbing too high.
  if (hit.closest?.('.dc-mm, .dc-zoom-tb, .dc-tool-palette, .dc-context-menu, .dc-cv-group-bbox')) {
    return null;
  }

  const artboardEl = hit.closest?.('[data-dc-screen]') ?? null;
  const artboardId = artboardEl?.getAttribute('data-dc-screen') ?? null;

  // Hover-target hard ceiling = `.dc-artboard-body`. Inner DOM content lives
  // there; chrome lives outside (label, header, article root). The two paths
  // diverge from here:
  //   * hit ∈ body → resolve to the deepest stamped element (existing
  //     deep/top logic below).
  //   * hit ∈ chrome (label/header/article-root) → the user wants to select
  //     the WHOLE artboard. Return the article element itself with no cdId;
  //     consumers (hoverTargetToSelection) fall back to a
  //     `[data-dc-screen="…"]` selector that wraps the whole frame. This is
  //     what enables Cmd+Shift+Click multi-select of artboards (T24 / G8).
  const bodyEl = hit.closest?.('.dc-artboard-body') ?? null;
  if (!bodyEl) {
    if (artboardEl && artboardId) {
      return { el: artboardEl, cdId: null, artboardId };
    }
    return null;
  }
  if (hit === bodyEl) {
    // Clicked the body wrapper itself (empty padding inside an artboard, no
    // user content under the cursor). Promote to "select whole artboard" so
    // the gesture stays consistent with chrome clicks above.
    if (artboardEl && artboardId) {
      return { el: artboardEl, cdId: null, artboardId };
    }
    return null;
  }

  if (opts.deep) {
    // Deepest mode — the hit element IS the target. Use its OWN data-cd-id
    // when present; never climb to an ancestor's id (climbing was the cause
    // of "Cmd-click on a deep span selects the whole artboard root"). When
    // the hit lacks a stamped id, consumers fall back to a CSS-path selector.
    const cdId = hit.getAttribute?.('data-cd-id') ?? null;
    return { el: hit, cdId, artboardId };
  }

  // Top mode — climb to the topmost descendant of the artboard body that
  // still carries a data-cd-id. Hard ceiling is bodyEl itself (never select
  // the body wrapper or higher).
  let cur: Element | null = hit;
  let topCdEl: Element | null = null;
  let belowRoot: Element | null = null; // the stamped rung just under the page root
  while (cur && cur !== bodyEl) {
    if (cur.hasAttribute?.('data-cd-id')) {
      belowRoot = topCdEl;
      topCdEl = cur;
    }
    cur = cur.parentElement;
  }
  // The page root is the artboard: a click ON the page (no object under it) selects the artboard, a click on
  // an object selects the top object inside the page.
  if (topCdEl && pageRootOf(bodyEl) === topCdEl) {
    if (!belowRoot) {
      return artboardEl && artboardId ? { el: artboardEl, cdId: null, artboardId } : null;
    }
    topCdEl = belowRoot;
  }
  const el = topCdEl ?? hit;
  const cdId = el.getAttribute?.('data-cd-id') ?? null;
  return { el, cdId, artboardId };
}
