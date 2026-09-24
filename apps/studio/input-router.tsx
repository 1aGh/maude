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

import { isEmbedCanvas } from './read-only-mode.ts';

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
  | { kind: 'escape' }
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
  clientX?: number;
  clientY?: number;
  /** Spacebar held — shared signal with `useViewportController`'s pan-drag. */
  spaceHeld?: boolean;
  /** Event target is editable (input/textarea/contentEditable) — caller computes. */
  isEditable?: boolean;
  activeTool: Tool;
}

// ─────────────────────────────────────────────────────────────────────────────
// classify — pure function. All branching lives here so unit tests cover every
// row of the dispatch table without spinning up a DOM.

const metaOrCtrl = (i: ClassifyInput): boolean => !!(i.metaKey || i.ctrlKey);

export function classify(input: ClassifyInput): RouterAction {
  if (input.type === 'keydown') {
    if (input.isEditable) return { kind: 'no-op' };
    // Tool letters are bare keys — Cmd/Ctrl/Alt+letter belongs to shell / browser.
    if (input.metaKey || input.ctrlKey || input.altKey) {
      // Esc with modifiers still dismisses.
      if (input.key === 'Escape') return { kind: 'escape' };
      // Undo / redo (Phase 20). Alt is reserved — Cmd+Opt+Z is a browser
      // text-input gesture we don't claim. `metaKey || ctrlKey` covers both
      // mac and Windows / Linux without a platform sniff.
      const k = (input.key || '').toLowerCase();
      if (!input.altKey && (input.metaKey || input.ctrlKey)) {
        if (k === 'z' && input.shiftKey) return { kind: 'redo' };
        if (k === 'z') return { kind: 'undo' };
        if (k === 'y' && !input.shiftKey) return { kind: 'redo' };
      }
      return { kind: 'no-op' };
    }
    const k = (input.key || '').toLowerCase();
    if (k === 'v') return { kind: 'tool', tool: 'move' };
    if (k === 'h') return { kind: 'tool', tool: 'hand' };
    if (k === 'c') return { kind: 'tool', tool: 'comment' };
    if (k === 'b') return { kind: 'tool', tool: 'pen' };
    // I = hIghlighter (a free bare letter; 'H' is taken by Hand).
    if (k === 'i') return { kind: 'tool', tool: 'highlighter' };
    // Phase 24 — R (and legacy O) both arm the single Shape tool; the specific
    // primitive is picked from the palette's shape-kind popover.
    if (k === 'r' || k === 'o') return { kind: 'tool', tool: 'shape' };
    if (k === 'a') return { kind: 'tool', tool: 'arrow' };
    // Phase 21 — N = sticky Note ('S' is taken by the shell Design-system view
    // + Shift-marquee); T = standalone Text. Both are bare letters the shell
    // yields when focus is inside the canvas iframe (app.jsx onKey bail).
    if (k === 'n') return { kind: 'tool', tool: 'sticky' };
    if (k === 't') return { kind: 'tool', tool: 'text' };
    // FigJam v3 — Shift+S arms the Section tool (FigJam's own binding; bare S
    // stays with the shell's Design-system view). Checked here because the
    // modifier guard above only filters Cmd/Ctrl/Alt.
    if (k === 's' && input.shiftKey) return { kind: 'tool', tool: 'section' };
    if (k === 'e') return { kind: 'tool', tool: 'eraser' };
    if (input.key === 'Escape') return { kind: 'escape' };
    return { kind: 'no-op' };
  }

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
    if (isAnnotationTool(input.activeTool)) return { kind: 'no-op' };
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
    if (isAnnotationTool(input.activeTool) && !metaOrCtrl(input)) {
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
  onEscape?: () => void;
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
  modifiers: { metaKey: boolean; ctrlKey: boolean }
): boolean {
  return (
    action.kind === 'select' &&
    !modifiers.metaKey &&
    !modifiers.ctrlKey &&
    isArtboardDragChrome(target)
  );
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
        case 'escape':
          callbacks.onEscape?.();
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
      const yields = yieldsToArtboardDrag(action, e.target, e);
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
          : tool === 'move' && e.button === 0
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
      const action = claim(
        classify({
          type: 'keydown',
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          isEditable: isEditableTarget(e.target),
          activeTool: getActiveTool(),
        })
      );
      if (
        action.kind === 'tool' ||
        // DDR-242 — in an embed, the router's catch-all Escape (drop the
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
  while (cur && cur !== bodyEl) {
    if (cur.hasAttribute?.('data-cd-id')) topCdEl = cur;
    cur = cur.parentElement;
  }
  const el = topCdEl ?? hit;
  const cdId = el.getAttribute?.('data-cd-id') ?? null;
  return { el, cdId, artboardId };
}
