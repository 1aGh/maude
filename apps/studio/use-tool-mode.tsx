/**
 * @file       use-tool-mode.tsx — Phase 4.1 tool-mode store
 * @scope      apps/studio/use-tool-mode.tsx
 * @purpose    Context + hook for the active canvas tool. Wired into
 *             DesignCanvas. Phase 5 will
 *             register additional tools (pen, circle, arrow, eraser) via
 *             the same provider — the API is intentionally open.
 *
 * The router's `onTool` callback (input-router.tsx) writes into this store.
 * The ToolPalette + cursor sync read from it. Selecting a tool also mutates
 * `document.body.style.cursor` so the affordance matches across the iframe.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import {
  baseMode,
  type CanvasModeV2,
  homeModeOfTool,
  type ModeCaps,
  REST_TOOL,
  V1_POSTURE,
} from './bridge/canvas-modes.ts';
import { TOOL_CURSORS } from './canvas-cursors.ts';
import type { Tool } from './input-router.tsx';
import { canCommentCanvas, isReadOnlyCanvas } from './read-only-mode.ts';
import { openToolPanel, panelOnArm } from './toolbars/tool-panel.ts';

/** V2-4.3b — the governed path (V2-1.2 §5.4): once the shell has sent its first `set-mode`, the mode
 *  is the shell's. A gesture that would cross modes asks the shell (`mode-request`) instead of moving
 *  the mode here (M1, M3). Literal posts, so the dgn inventory sees the send sites. */
function requestMode(mode: CanvasModeV2, tool?: Tool): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  if (!canvasModeStore(window).claimRequest(`${mode}|${tool ?? ''}`)) return;
  try {
    window.parent.postMessage(
      tool
        ? { dgn: 'mode-request', mode, tool, cause: 'toolbar' }
        : { dgn: 'mode-request', mode, cause: 'toolbar' },
      '*'
    );
  } catch {
    /* detached */
  }
}

interface Governed {
  mode: CanvasModeV2;
  caps: ModeCaps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types

export interface ToolDescriptor {
  id: Tool;
  label: string;
  /** Letter-key shortcut shown in the palette tooltip. */
  shortcut: string;
  /** CSS cursor value applied to <body> when this tool is active. */
  cursor: string;
}

/**
 * Phase 24 — the six primitives the single Shape tool can draw. Maps onto the
 * stroke model: square/rounded → `rect` (cornerRadius 0 / 8); circle →
 * `ellipse`; diamond/triangle/triangle-down → `polygon`.
 */
export type ShapeKind = 'square' | 'rounded' | 'circle' | 'diamond' | 'triangle' | 'triangle-down';

/**
 * DDR-223 (issue #93) — the binary canvas mode over the tool set. `preview`
 * rests on `browse` (pure pass-through, the mock is alive; annotation tools
 * stay usable); `edit` rests on `move` (the Figma select ladder). The mode is
 * a store-level layer — `classify()` and every `tool === 'move'` gate are
 * untouched (DDR-187's decomposition stands).
 */
export type CanvasMode = 'preview' | 'edit';

/** Document event two provider instances keep one active tool through. */
export const TOOL_SYNC_EVENT = 'maude:tool-sync';

/** The resting tool each mode arms (and returns to via `resetTool`). */
export const MODE_DEFAULT_TOOL: Readonly<Record<CanvasMode, Tool>> = Object.freeze({
  preview: 'browse',
  edit: 'move',
});

/**
 * Mode implied by arming a mode-exclusive resting tool. `browse` and `move`
 * are the only mode-carrying tools; everything else (comment, draw set) is
 * mode-NEUTRAL — arming pen in preview keeps you in preview (the issue-#93
 * "annotations work in preview" contract).
 */
function modeForTool(t: Tool): CanvasMode | null {
  if (t === 'browse') return 'preview';
  if (t === 'move') return 'edit';
  return null;
}

// Phase 21 — every tool ships a custom 32×32 SVG cursor (canvas-cursors.ts)
// with a white outline halo so the glyph reads on any background. The native
// crosshair/text/cell were thin + tiny ("pen almost invisible"); these mirror
// the tool-palette icons. `move` keeps the system arrow on purpose.
export const DEFAULT_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  // feature-4 — Browse is the pure pass-through tool: the mock is alive
  // (buttons click). Since DDR-223 it is the PREVIEW mode's resting tool (the
  // boot default moved to edit/`move`); no letter shortcut — it's armed via
  // the Preview toggle / Esc-in-preview.
  { id: 'browse', label: 'Browse', shortcut: '', cursor: TOOL_CURSORS.browse },
  { id: 'move', label: 'Select', shortcut: 'V', cursor: TOOL_CURSORS.move },
  // S3.11 — Viewing's resting tool (04 md-inspect): a click inspects, a drag pans. No letter of its own:
  // Viewing's toolbar key (H) arms it.
  { id: 'inspect', label: 'Inspect', shortcut: '', cursor: TOOL_CURSORS.inspect },
  { id: 'hand', label: 'Hand', shortcut: 'H', cursor: TOOL_CURSORS.hand },
  { id: 'comment', label: 'Comment', shortcut: 'C', cursor: TOOL_CURSORS.comment },
  { id: 'pen', label: 'Pen', shortcut: 'B', cursor: TOOL_CURSORS.pen },
  // Annotation polish (item 8) — highlighter sits next to the pen.
  { id: 'highlighter', label: 'Highlighter', shortcut: 'I', cursor: TOOL_CURSORS.highlighter },
  // Phase 24 — one Shape tool replaces the separate Rect (R) + Ellipse (O)
  // buttons; the primitive is chosen from the palette popover.
  { id: 'shape', label: 'Shape', shortcut: 'R', cursor: TOOL_CURSORS.shape },
  { id: 'sticky', label: 'Sticky', shortcut: 'N', cursor: TOOL_CURSORS.sticky },
  // FigJam v3 — labelled organizing container.
  { id: 'section', label: 'Section', shortcut: '⇧S', cursor: TOOL_CURSORS.shape },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', cursor: TOOL_CURSORS.arrow },
  { id: 'text', label: 'Text', shortcut: 'T', cursor: TOOL_CURSORS.text },
  // S2.12b — Edit's Text: click to type (a click on text types in place, else adds a text element).
  { id: 'el-text', label: 'Text', shortcut: 'T', cursor: TOOL_CURSORS['el-text'] },
  // S2.13 — Edit's drag tools (editing/draw-tools.tsx): Frame, Shape, and More's Line · Ellipse · Polygon · Export area.
  { id: 'frame', label: 'Frame', shortcut: 'F', cursor: TOOL_CURSORS.frame },
  { id: 'el-shape', label: 'Shape', shortcut: 'R', cursor: TOOL_CURSORS['el-shape'] },
  { id: 'ellipse', label: 'Ellipse', shortcut: '', cursor: TOOL_CURSORS.ellipse },
  { id: 'line', label: 'Line', shortcut: '', cursor: TOOL_CURSORS.line },
  { id: 'polygon', label: 'Polygon', shortcut: '', cursor: TOOL_CURSORS.polygon },
  { id: 'slice', label: 'Export area', shortcut: '', cursor: TOOL_CURSORS.slice },
  // S2.14 — Edit's Pen (editing/pen/draw.tsx)
  { id: 'el-pen', label: 'Pen', shortcut: 'P', cursor: TOOL_CURSORS['el-pen'] },
  // S2.15 — More › Crop: click a picture to crop it (editing/crop-mode.tsx); selects like Select
  { id: 'crop', label: 'Crop', shortcut: '', cursor: TOOL_CURSORS.crop },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', cursor: TOOL_CURSORS.eraser },
]);

/**
 * Cloud Phase 25 C2 — the tools a READ-ONLY session keeps: navigate and
 * inspect, nothing that writes. Everything else (comment included — the cell
 * refuses viewer comments until Phase 25 C3 lands them on its allowlist) is
 * ABSENT from the palette, its letter shortcut dead, and `setTool` refuses it
 * (which also covers the shell's `tool-set` postMessage lane).
 */
const READ_ONLY_TOOL_IDS: ReadonlySet<Tool> = new Set<Tool>(['browse', 'move', 'hand', 'inspect']);

/** Pure filter — exported for unit tests. `canComment` (S9.22 `cm=1`): a read-only Can comment
 *  session keeps the Comment tool — its Preview toolbar is Hand and Comment (15 an-viewer). */
export function filterToolsForReadOnly(
  tools: readonly ToolDescriptor[],
  readOnly: boolean,
  canComment = false
): readonly ToolDescriptor[] {
  return readOnly
    ? tools.filter((t) => READ_ONLY_TOOL_IDS.has(t.id) || (canComment && t.id === 'comment'))
    : tools;
}

interface ToolContextValue {
  tool: Tool;
  setTool: (t: Tool) => void;
  tools: readonly ToolDescriptor[];
  /** DDR-223 — the binary canvas mode. Kept coherent with `tool` (arming
   *  `move`/`browse` moves the mode; `setMode` arms the mode's resting tool). */
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
  /** Arm the current mode's resting tool — the Esc / post-draw-commit flip.
   *  `move` in edit (byte-identical to the pre-DDR-223 hardcode), `browse` in
   *  preview (drawing an annotation never silently exits the alive posture). */
  resetTool: () => void;
  /** T19 — sticky-tool double-click lock. When `sticky.locked === true` AND
   *  `sticky.tool === tool`, draw tools stay armed after each shape commit
   *  (T18 auto-flip is suppressed). Single-click on any other tool clears
   *  sticky; Esc clears + flips to Move. */
  sticky: { tool: Tool | null; locked: boolean };
  toggleSticky: (t: Tool) => void;
  clearSticky: () => void;
  /** Phase 24 — the primitive the Shape tool will draw next. */
  shapeKind: ShapeKind;
  setShapeKind: (k: ShapeKind) => void;
}

const ToolContext = createContext<ToolContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Provider

export function ToolProvider({
  children,
  tools: toolsProp = DEFAULT_TOOLS,
  // DDR-223 (issue #93, supersedes DDR-187's boot half) — authoring surfaces
  // boot into EDIT with `move` (V) armed: click-selects from the first frame,
  // Preview (the alive pass-through posture) is one always-visible toggle
  // away. Read-only canvases (cloud viewers) keep the DDR-187 posture and
  // boot preview/`browse` — a viewer's job is to use the live mock. The
  // comment-mount layer passes `initial='browse'` explicitly so bare DS
  // specimens stay alive too.
  initial,
  initialMode,
  governed = false,
}: {
  children: ReactNode;
  tools?: readonly ToolDescriptor[];
  initial?: Tool;
  initialMode?: CanvasMode;
  /** V2-4.3b — this instance is the one the shell's `set-mode` governs: canvas-lib's, under
   *  `DesignCanvas` (it owns the toolbar, V2-1.2 §5.4). It arms, echoes and asks; the comment-mount
   *  ancestor stays v1 and converges through `maude:tool-sync` as it always has — so a bare DS
   *  specimen (no DesignCanvas) stays alive whatever the shell's mode. */
  governed?: boolean;
}) {
  // Cloud Phase 25 C2 — a read-only canvas keeps only navigate/inspect tools.
  // Filtering HERE covers every consumer at once: the palette renders from
  // `tools`, the input router's letter shortcuts resolve against `tools`, and
  // `setTool` below refuses anything outside the list (the shell `tool-set`
  // postMessage lane included).
  const readOnly = isReadOnlyCanvas();
  const canComment = readOnly && canCommentCanvas();
  const tools = useMemo(
    () => filterToolsForReadOnly(toolsProp, readOnly, canComment),
    [toolsProp, readOnly, canComment]
  );
  const bootTool: Tool = initial ?? (readOnly ? 'browse' : 'move');
  const bootMode: CanvasMode =
    initialMode ?? modeForTool(bootTool) ?? (readOnly ? 'preview' : 'edit');
  const [tool, setToolState] = useState<Tool>(bootTool);
  const [mode, setModeState] = useState<CanvasMode>(bootMode);
  const [sticky, setSticky] = useState<{ tool: Tool | null; locked: boolean }>(() => ({
    tool: null,
    locked: false,
  }));
  // V2-4.3b — governed once the shell's first `set-mode` is applied (null = v1, DDR-223 byte for byte).
  const govRef = useRef<Governed | null>(null);
  const setTool = useCallback(
    (t: Tool) => {
      // Refuse tools that aren't offered (read-only filtering above) — a
      // shortcut or postMessage can't arm a tool the palette doesn't show.
      if (!tools.some((d) => d.id === t)) return;
      const gov = govRef.current;
      if (gov) {
        // Governed: a tool another mode's toolbar owns (V2-4.5b: an editor's annotation tools are
        // Preview's, Select is Edit's) is a request to the shell, never a local mode change (M3).
        // Present keeps its posture: a stray resting-tool arm there (an Esc ladder, a letter key)
        // neither leaves Present nor asks to — esc out of Present is the shell's.
        const m = homeModeOfTool(t, gov.caps, gov.mode);
        if (m && m !== gov.mode) {
          if (gov.mode !== 'present') requestMode(m, t);
          return;
        }
        setToolState(t);
        setSticky((prev) =>
          prev.locked && prev.tool === t ? prev : { tool: null, locked: false }
        );
        return;
      }
      setToolState(t);
      // DDR-223 — mode⇄tool invariant: arming a resting tool moves the mode
      // with it, so V, the menubar `tool-set` lane, and the Cmd+click-in-
      // browse escape hatch all land in EDIT coherently (and arming browse
      // lands in PREVIEW). Annotation tools leave the mode alone. This is
      // also what keeps `move` structurally unreachable inside preview — the
      // moment it arms, the mode is edit, so no `tool === 'move'` gate can
      // ever fire while the UI claims preview.
      const m = modeForTool(t);
      if (m) setModeState(m);
      // Single-click on a different tool clears any sticky lock — sticky is
      // a per-tool flag, not global.
      setSticky((prev) => (prev.locked && prev.tool === t ? prev : { tool: null, locked: false }));
    },
    [tools]
  );
  const setMode = useCallback(
    (m: CanvasMode) => {
      // Switching mode arms its resting tool (Figma-style: the toggle IS the
      // posture). Read-only keeps both browse+move on its allowlist, so the
      // guard below never fires there; it exists for exotic custom `tools`.
      const gov = govRef.current;
      if (gov) {
        requestMode(m === 'edit' ? baseMode(gov.caps) : 'preview');
        return;
      }
      const rest = MODE_DEFAULT_TOOL[m];
      if (!tools.some((d) => d.id === rest)) return;
      setModeState(m);
      setToolState(rest);
      setSticky((prev) =>
        prev.locked && prev.tool === rest ? prev : { tool: null, locked: false }
      );
    },
    [tools]
  );
  const resetTool = useCallback(() => {
    const gov = govRef.current;
    setTool(gov ? (REST_TOOL[gov.mode] as Tool) : MODE_DEFAULT_TOOL[mode]);
  }, [mode, setTool]);

  // V2-4.3b — adopt the shell's `set-mode` from the document's one mode store (both provider
  // instances read the same snapshot, so they cannot disagree). The mode's resting tool is armed when
  // the mode changes or the shell names a tool; a seed that repeats the current mode keeps the tool.
  // Exactly one provider per document echoes each applied seq (M2).
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const toolNowRef = useRef(tool);
  toolNowRef.current = tool;
  // S4.19 (canvas 15 `an-templates`) - arming Section, by any road, opens the Templates panel above the toolbar.
  const armedWasRef = useRef<Tool>(tool);
  useEffect(() => {
    const panel = panelOnArm(armedWasRef.current, tool);
    armedWasRef.current = tool;
    if (panel) openToolPanel(panel);
  }, [tool]);
  useEffect(() => {
    if (!governed || typeof window === 'undefined') return;
    const store = canvasModeStore(window);
    let lastSeq = -1;
    // This provider's own last governed mode: one that mounts after the shell's seeds (the
    // comment-mount and canvas-lib bundles mount at different times) compares against ITS state.
    let lastMode: CanvasModeV2 | null = null;
    const apply = () => {
      const s = store.get();
      if (s.mode === null || !s.caps || s.modeSeq <= lastSeq) return;
      lastSeq = s.modeSeq;
      govRef.current = { mode: s.mode, caps: s.caps };
      const posture = V1_POSTURE[s.mode];
      const changed = lastMode === null ? modeRef.current !== posture : lastMode !== s.mode;
      lastMode = s.mode;
      const rest = REST_TOOL[s.mode] as Tool;
      const offered = (t: Tool | null): t is Tool => !!t && tools.some((d) => d.id === t);
      const want: Tool | null = (s.tool as Tool | null) ?? (changed ? rest : null);
      // A tool this canvas cannot arm (S2's Frame before it is a tool) lands on the mode's rest.
      const arm = offered(want) ? want : changed && offered(rest) ? rest : null;
      setModeState(posture);
      if (arm) {
        setToolState(arm);
        toolNowRef.current = arm;
      }
      if (changed) setSticky({ tool: null, locked: false }); // Q7 — a lock never survives a mode change
      if (store.claimEcho(s.modeSeq) && window.parent !== window) {
        try {
          window.parent.postMessage(
            {
              dgn: 'mode-changed',
              seq: s.modeSeq,
              mode: s.mode,
              tool: arm ?? toolNowRef.current,
              present: s.present,
              cause: s.clamped ? 'clamp' : 'set-mode',
            },
            '*'
          );
        } catch {
          /* detached */
        }
      }
    };
    apply(); // the shell may have spoken before this provider mounted
    return store.subscribe(apply);
  }, [tools, governed]);
  const toggleSticky = useCallback((t: Tool) => {
    setSticky((prev) => {
      if (prev.locked && prev.tool === t) return { tool: null, locked: false };
      return { tool: t, locked: true };
    });
    setToolState(t);
  }, []);
  const clearSticky = useCallback(() => {
    setSticky({ tool: null, locked: false });
  }, []);
  // FigJam v3 — soft default: a fresh Shape tool draws ROUNDED squares (the
  // FigJam look); sharp squares stay one popover click away.
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rounded');

  // ONE ACTIVE TOOL PER CANVAS DOCUMENT, across provider instances.
  //
  // A UI canvas carries TWO providers: the comment-mount layer's (it owns the
  // comment drop) and canvas-lib's own (it owns the palette) — separate
  // bundles, so separate contexts. They used to converge only through a tool
  // KEYDOWN, which both routers see; a palette CLICK reached canvas-lib's
  // provider alone. So "Comment" in the palette lit up while the comment
  // layer stayed in browse, and clicking the canvas dropped nothing — you had
  // to know to press C (plan T31/L11). A change here is announced on the
  // document and every other instance adopts it. The boot posture is NOT
  // announced (the two instances deliberately boot differently — see
  // `initial`); only a change after mount is.
  const syncId = useRef(Math.random().toString(36).slice(2));
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const announced = useRef(false);
  useEffect(() => {
    if (!announced.current) {
      announced.current = true;
      return;
    }
    if (typeof document === 'undefined') return;
    document.dispatchEvent(
      new CustomEvent(TOOL_SYNC_EVENT, { detail: { tool, from: syncId.current } })
    );
  }, [tool]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onSync = (e: Event) => {
      const d = (e as CustomEvent<{ tool?: unknown; from?: unknown }>).detail;
      if (!d || d.from === syncId.current || typeof d.tool !== 'string') return;
      // Already there: nothing to do, and — for a sticky-locked tool — not
      // touching it keeps the lock.
      if (d.tool === toolRef.current) return;
      // V2-4.5b — the ungoverned sibling (comment-mount) never drives the mode: a tool it armed that
      // another mode owns (its v1 esc arms `move` in Preview) is not a request. Say our tool back
      // so it converges on it.
      const gov = govRef.current;
      if (gov) {
        const m = homeModeOfTool(d.tool, gov.caps, gov.mode);
        if (m && m !== gov.mode) {
          document.dispatchEvent(
            new CustomEvent(TOOL_SYNC_EVENT, {
              detail: { tool: toolRef.current, from: syncId.current },
            })
          );
          return;
        }
      }
      setTool(d.tool as Tool);
    };
    document.addEventListener(TOOL_SYNC_EVENT, onSync);
    return () => document.removeEventListener(TOOL_SYNC_EVENT, onSync);
  }, [setTool]);

  // Cursor sync — applied inside the canvas (this hook runs in the canvas
  // context). The active tool's cursor is set on <body> AND forced across the
  // whole canvas working area via an `!important` rule, so the custom cursor
  // shows EVERYWHERE — including over artboard CONTENT, whose own `cursor:
  // pointer`/`text`/… would otherwise win (Phase 24, the "custom cursors in the
  // whole app" requirement; FigJam behaviour). Chrome that lives OUTSIDE
  // `.dc-world` (tool palette, context toolbar, resize handles) is intentionally
  // NOT matched, so its buttons/handles keep their affordance cursors. The
  // viewport-controller still owns the grab/grabbing swap during space-pan.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const desc = tools.find((t) => t.id === tool);
    if (!desc) return;
    const prev = document.body.style.cursor;
    let styleEl = document.getElementById('dc-tool-cursor') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'dc-tool-cursor';
      document.head.appendChild(styleEl);
    }
    // feature-4 — the browse tool is a pure pass-through: it must NOT force a
    // global cursor, or the `* { cursor: … !important }` rule below would beat
    // the mock's own affordance cursors (pointer over a button, text over an
    // input) and the canvas would stop reading as alive. Clear the forced rule
    // and let the body/native cursors win.
    if (tool === 'browse') {
      document.body.style.cursor = '';
      styleEl.textContent = '';
      if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        try {
          window.parent.postMessage({ dgn: 'tool-cursor', tool }, '*');
        } catch {
          /* cross-origin parent rejected */
        }
      }
      return () => {
        document.body.style.cursor = prev;
      };
    }
    document.body.style.cursor = desc.cursor;
    // Truly GLOBAL inside the canvas document — `*` so it covers the empty grid
    // host, `.dc-world`, every artboard + its content, AND the floating chrome
    // (minimap, toolbar). The earlier `.dc-world`-scoped rule left the empty
    // canvas / minimap on their own cursors; the brief is "prostě všude". (Mirrors
    // the outer-shell `*` rule so both documents are uniformly covered.)
    styleEl.textContent = `* { cursor: ${desc.cursor} !important; }`;
    // Phase 24 — broadcast the active tool TOKEN to the OUTER app shell (this
    // hook runs in the canvas iframe) so the shell shows the same custom cursor
    // across the whole maude UI (sidebar / top bar). We send the tool *id*, NOT
    // the cursor string: the shell resolves it against its own trusted
    // TOOL_CURSORS copy (resolveToolCursor), so an untrusted synced canvas
    // (DDR-054) can only pick a known, always-visible glyph — it can't inject an
    // invisible/displaced cursor as a clickjacking aid (phase-24 ethical-hacker
    // Finding 2; DDR-067).
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ dgn: 'tool-cursor', tool }, '*');
      } catch {
        /* cross-origin parent rejected — shell keeps its default cursor */
      }
    }
    return () => {
      document.body.style.cursor = prev;
      const el = document.getElementById('dc-tool-cursor');
      if (el) el.textContent = '';
    };
  }, [tool, tools]);

  const value = useMemo<ToolContextValue>(
    () => ({
      tool,
      setTool,
      tools,
      mode,
      setMode,
      resetTool,
      sticky,
      toggleSticky,
      clearSticky,
      shapeKind,
      setShapeKind,
    }),
    [tool, setTool, tools, mode, setMode, resetTool, sticky, toggleSticky, clearSticky, shapeKind]
  );

  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
}

/**
 * Mount a `ToolProvider` only when none exists above us. When the shell-owned
 * comment mount layer (canvas-comment-mount.tsx) already provides one,
 * `DesignCanvas` consumes that instance instead of double-mounting. The hook
 * is called unconditionally; only the returned tree branches (hook rules).
 */
export function MaybeToolProvider({
  children,
  initial,
  initialMode,
  governed,
}: {
  children: ReactNode;
  /** DDR-223 — forwarded so the comment-mount layer can pin bare DS
   *  specimens to the preview/`browse` posture (see canvas-comment-mount). */
  initial?: Tool;
  initialMode?: CanvasMode;
  /** V2-4.3b — canvas-lib's `DesignCanvas` instance (see ToolProvider). */
  governed?: boolean;
}) {
  const outer = useContext(ToolContext);
  if (outer) return <>{children}</>;
  return (
    <ToolProvider initial={initial} initialMode={initialMode} governed={governed}>
      {children}
    </ToolProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook

export function useToolMode(): ToolContextValue {
  const ctx = useContext(ToolContext);
  if (!ctx) {
    throw new Error('useToolMode must be used inside <ToolProvider>');
  }
  return ctx;
}

/**
 * Read-only variant — returns `null` when no provider mounted. Used by
 * components that can render outside a ToolProvider tree (the input
 * router's optional path).
 */
export function useToolModeOptional(): ToolContextValue | null {
  return useContext(ToolContext);
}
