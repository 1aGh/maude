/**
 * @file       canvas-comment-mount.tsx — shell-owned comment layer + mountCanvas
 * @scope      apps/studio/canvas-comment-mount.tsx
 * @purpose    The canvas mount harness (`_shell.html`) calls `mountCanvas`
 *             instead of rendering the canvas default-export raw. mountCanvas
 *             wraps ANY default export — a `DesignCanvas` UI canvas OR a bare
 *             DS specimen — in a LITE comment provider tree so the in-place
 *             comment tool works on every mounted surface.
 *
 * Why a single shell-owned layer (DDR — see plan §"Key decision"):
 *   - Comments used to be mounted only by `DesignCanvas` (ToolProvider +
 *     SelectionSetProvider + CommentsOverlay + the onDropComment router
 *     branch). Bare specimens (`system/<ds>/preview/*.tsx`) never render
 *     DesignCanvas, so they had no comment tool at all.
 *   - Hoisting the comment subsystem here makes it universal. `DesignCanvas`
 *     becomes a CONSUMER of the shell-provided ToolProvider / SelectionSet /
 *     CommentsOverlay (via MaybeToolProvider / MaybeSelectionSetProvider and
 *     by dropping its own <CommentsOverlay/>).
 *
 * Coexistence with the UI-canvas router: this layer's input router is an
 * ANCESTOR capture-listener over the canvas. On a UI canvas, `CanvasShell`
 * still runs its OWN router (hover / select / context-menu / undo). To avoid
 * swallowing those gestures, this router passes a narrow `claimableActions`
 * allowlist — `drop-comment` / `tool` / `escape` / `hover`. `hover` never
 * preventDefaults so the inner router's halo is unaffected; everything else
 * (select / context-menu / undo) propagates untouched to the inner router.
 */

import {
  Component,
  type ComponentType,
  createElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';

import { CommentsOverlay } from './comments-overlay.tsx';
import { deriveFile, hoverTargetToSelection } from './dom-selection.ts';
import {
  type HoverTarget,
  isOverlayTarget,
  type RouterAction,
  resolveHoverTarget,
  useInputRouter,
} from './input-router.tsx';
import { ElementResizeOverlay } from './use-element-resize.tsx';
import {
  MaybeSelectionSetProvider,
  type Selection,
  useSelectionSet,
} from './use-selection-set.tsx';
import { MaybeToolProvider, useToolMode } from './use-tool-mode.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 24 — the comment-mode cursor (and every other tool cursor) is owned
// SOLELY by use-tool-mode.tsx, whose `* { cursor: <Kenney glyph> !important }`
// rule is injected by the ToolProvider this layer mounts (MaybeToolProvider) —
// so it covers bare DS specimens too. The old `[data-mc-host]…`/`body[…]`
// comment-cursor rule used to live here, but its higher specificity shadowed
// the unified Kenney cursor on UI canvases (comment-mount stamps
// `data-active-tool` on <body>, so `body[data-active-tool="comment"] *` matched
// there as well). Removed so the single source of truth wins. See DDR-067.

// ─────────────────────────────────────────────────────────────────────────────
// CommentHost — owns the lite comment subsystem: the input router (comment-
// scoped), the single CommentsOverlay, the comment-mode cursor attribute, and
// the parent `dgn:'tool-set'` listener (so the outer menubar comment toggle
// reaches the iframe).

// Only these action kinds are claimed by the mount-layer router; the rest
// propagate to a UI canvas's own router. `tool` + `escape` are also handled by
// the inner router on UI canvases — idempotent (same shared provider). `hover`
// is dispatched too (it never preventDefaults, so the inner router's own hover
// halo on a UI canvas is unaffected) — we only PAINT the mount-layer preview
// halo on a bare specimen, where there is no inner CanvasShell halo.
const COMMENT_CLAIMS: ReadonlySet<RouterAction['kind']> = new Set<RouterAction['kind']>([
  'drop-comment',
  'tool',
  'escape',
  'hover',
]);

// True when no DesignCanvas/CanvasShell is mounted on this surface — i.e. a
// bare DS specimen. On a UI canvas (`.dc-canvas` present) the inner shell owns
// hover-halo painting + `resolveHoverTarget` element anchoring, so the lite
// layer defers to it.
export function isBareSpecimen(): boolean {
  return typeof document !== 'undefined' && !document.querySelector('.dc-canvas');
}

// Deepest non-chrome element under a point — the comment anchor for a bare
// specimen (specimens aren't stamped with `data-cd-id` and have no
// `.dc-artboard-body`, so `resolveHoverTarget` returns null for them).
function pickSpecimenEl(clientX: number, clientY: number): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!hit) return null;
  // Never anchor to comment chrome, the selection/resize overlay, or the root.
  if (
    hit.closest(
      '.cm-composer, .cm-thread, .cm-mention-popup, .cm-pin, [data-mc-hover-halo], [data-mc-selection-halo], .dc-el-resize-handle'
    )
  ) {
    return null;
  }
  const tag = hit.tagName;
  if (tag === 'HTML' || tag === 'BODY') return null;
  return hit;
}

// feature-element-editing-robustness Stage E — the SELECT anchor for a bare
// specimen. Generalizes `pickSpecimenEl` (the comment anchor) by climbing to the
// hit element's own `data-cd-id`, else its nearest stamped ancestor — every JSX
// element the pipeline stamps unconditionally (canvas-pipeline.ts), so a
// specimen element always resolves to a cd-id the Inspector's `edit-css`/
// `edit-attr` can target. Falls back to the bare hit when (defensively) nothing
// is stamped, in which case the selection degrades to a `cssPath` selector.
export function pickSpecimenSelectEl(clientX: number, clientY: number): HTMLElement | null {
  const hit = pickSpecimenEl(clientX, clientY);
  if (!hit) return null;
  const stamped = hit.closest('[data-cd-id]') as HTMLElement | null;
  return stamped ?? hit;
}

function CommentHost({ children, file }: { children: ReactNode; file: string | undefined }) {
  const { tool, setTool } = useToolMode();
  const selSet = useSelectionSet();
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Hover-preview halo target (bare specimens only — see isBareSpecimen).
  const [hoverEl, setHoverEl] = useState<HTMLElement | null>(null);

  // Latest tool for the router (read at event time, not captured).
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const getActiveTool = useMemo(() => () => toolRef.current, []);

  // Drop the preview halo whenever we leave comment mode.
  useEffect(() => {
    if (tool !== 'comment') setHoverEl(null);
  }, [tool]);

  // feature-element-editing-robustness Stage E — element SELECT on a bare
  // specimen. `selectedEl` drives the selection halo; `isSpecimen` gates the
  // resize overlay so it mounts on specimens ONLY (a UI canvas already mounts
  // its own inside CanvasShell — mounting a second here would double the handles).
  const [selectedEl, setSelectedEl] = useState<HTMLElement | null>(null);
  const [isSpecimen, setIsSpecimen] = useState(false);
  useEffect(() => {
    // The inner DesignCanvas (`.dc-canvas`) mounts a beat after this layer, so
    // re-check on the next frame + a short timeout before deciding.
    const check = () => setIsSpecimen(isBareSpecimen());
    check();
    const raf = requestAnimationFrame(check);
    const t = setTimeout(check, 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);

  // Specimen select — a capture-phase Cmd/Ctrl-click. Self-gated on
  // `isBareSpecimen()` at event time: a UI canvas has its own CanvasShell select
  // router (specimens have none), so this is the ONLY select handler on a
  // specimen and a pure no-op on a UI canvas — no double-handling, no need to
  // touch the shared COMMENT_CLAIMS (which would preventDefault a UI canvas's
  // own select). `selSet.replace` posts `dgn:'select-set'` to the parent shell,
  // so the Inspector opens (Stage C) + edits persist via `edit-css` (Stage E3).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.metaKey || e.ctrlKey)) return; // select gesture only
      if (!isBareSpecimen()) return; // UI canvas → CanvasShell owns select
      if (isOverlayTarget(e.target)) return; // comment chrome owns its clicks
      const el = pickSpecimenSelectEl(e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const cdId = el.getAttribute('data-cd-id');
      const sel = hoverTargetToSelection({ el, cdId, artboardId: null } as HoverTarget);
      if (e.shiftKey) selSet.add(sel);
      else selSet.replace(sel);
      setSelectedEl(el);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [selSet]);

  // Drop the selection halo when the selection clears (Esc / parent force-clear).
  useEffect(() => {
    if (selSet.selected.length === 0) setSelectedEl(null);
  }, [selSet.selected]);

  // Reflect the active tool onto the host (and body, since the host is
  // display:contents and can't carry a paintable cursor). Comment-mode CSS
  // keys off `[data-active-tool="comment"]`.
  useEffect(() => {
    const host = hostRef.current;
    if (host) host.setAttribute('data-active-tool', tool);
    if (typeof document !== 'undefined' && document.body) {
      document.body.setAttribute('data-active-tool', tool);
    }
    return () => {
      host?.removeAttribute('data-active-tool');
    };
  }, [tool]);

  // Parent `dgn:'tool-set'` — the outer dev-server menubar posts this when the
  // user toggles the comment tool. Mirrors canvas-shell's listener so the
  // toggle reaches bare specimens too (which have no inner shell listener).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { dgn?: string; tool?: string } | null;
      if (!m || typeof m !== 'object' || m.dgn !== 'tool-set') return;
      if (typeof m.tool === 'string') setTool(m.tool as never);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setTool]);

  useInputRouter({
    hostRef,
    getActiveTool,
    claimableActions: COMMENT_CLAIMS,
    callbacks: {
      onHover: ({ clientX, clientY }) => {
        // Paint a preview halo only on bare specimens; a UI canvas's own
        // CanvasShell HoverHalo owns the comment-mode preview there.
        if (toolRef.current !== 'comment' || !isBareSpecimen()) {
          setHoverEl(null);
          return;
        }
        const el = pickSpecimenEl(clientX, clientY);
        setHoverEl((prev) => (prev === el ? prev : el));
      },
      onTool: ({ tool: t }) => setTool(t),
      onEscape: () => {
        if (toolRef.current !== 'move') setTool('move');
        setHoverEl(null);
        selSet.clear();
        if (typeof window !== 'undefined') {
          try {
            window.parent.postMessage({ dgn: 'force-clear' }, '*');
          } catch {
            /* parent detached */
          }
        }
      },
      onDropComment: ({ clientX, clientY }) => dropComment(clientX, clientY, selSet, file),
    },
  });

  // `display: contents` keeps the specimen's own flex/grid layout byte-
  // identical — the host box contributes nothing to layout. The fixed-position
  // CommentsOverlay renders fine as a child regardless.
  return (
    <div data-mc-host ref={hostRef} style={{ display: 'contents' }}>
      {children}
      {hoverEl ? <MountHoverHalo el={hoverEl} /> : null}
      {selectedEl ? <MountSelectionHalo el={selectedEl} /> : null}
      {isSpecimen ? <ElementResizeOverlay /> : null}
      <CommentsOverlay />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MountSelectionHalo — Stage E. A steadier accent outline around the SELECTED
// specimen element (vs the lighter hover halo). rAF-follows the element's screen
// box; inline-styled (a bare specimen doesn't load canvas-lib's HALO_CSS).

function MountSelectionHalo({ el }: { el: HTMLElement }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement>(el);
  targetRef.current = el;
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      rafRef.current = null;
      const div = ref.current;
      const t = targetRef.current;
      if (div && t?.isConnected) {
        const r = t.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          div.style.display = 'none';
        } else {
          div.style.display = 'block';
          div.style.left = `${Math.round(r.left)}px`;
          div.style.top = `${Math.round(r.top)}px`;
          div.style.width = `${Math.round(r.width)}px`;
          div.style.height = `${Math.round(r.height)}px`;
        }
      } else if (div) {
        div.style.display = 'none';
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-mc-selection-halo=""
      style={{
        position: 'fixed',
        display: 'none',
        pointerEvents: 'none',
        zIndex: 2147483645,
        border: '1.5px solid var(--maude-hud-accent, oklch(0.680 0.180 268))',
        borderRadius: '3px',
        boxSizing: 'border-box',
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MountHoverHalo — fixed-position outline tracking the hovered element's screen
// bounds via rAF. Inline-styled (no dependency on canvas-lib's HALO_CSS, which
// a bare specimen doesn't load). Mirrors canvas-shell's HoverHalo visually.

function MountHoverHalo({ el }: { el: HTMLElement }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement>(el);
  targetRef.current = el;
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      rafRef.current = null;
      const div = ref.current;
      const t = targetRef.current;
      if (div && t?.isConnected) {
        const r = t.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          div.style.display = 'none';
        } else {
          div.style.display = 'block';
          div.style.left = `${Math.round(r.left)}px`;
          div.style.top = `${Math.round(r.top)}px`;
          div.style.width = `${Math.round(r.width)}px`;
          div.style.height = `${Math.round(r.height)}px`;
        }
      } else if (div) {
        div.style.display = 'none';
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-mc-hover-halo=""
      style={{
        position: 'fixed',
        display: 'none',
        pointerEvents: 'none',
        zIndex: 2147483646,
        border: '2px solid var(--maude-hud-accent, #d63b1f)',
        borderRadius: '3px',
        boxSizing: 'border-box',
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Comment drop — generic path lifted from canvas-shell's onDropComment. Works
// with or without artboards: deep/shallow resolveHoverTarget → elementsFromPoint
// data-cd-id climb → floating fallback. Dispatches `cm:open-composer` for the
// in-iframe overlay + posts `comment-compose` to the parent for legacy mocks.

function dropComment(
  clientX: number,
  clientY: number,
  selSet: { replace: (s: Selection) => void },
  file: string | undefined
): void {
  if (typeof document === 'undefined') return;
  let target = resolveHoverTarget(document, clientX, clientY, { deep: true });
  if (!target) target = resolveHoverTarget(document, clientX, clientY, { deep: false });
  // UI-canvas recovery — when both passes bail on a `pointer-events: none`
  // decoration, enumerate the stack and climb the first `data-cd-id` ancestor
  // inside an artboard body. Skipped on bare specimens, which instead anchor to
  // the exact hovered element below (so the pin matches the hover preview halo).
  if (!target && !isBareSpecimen() && typeof document.elementsFromPoint === 'function') {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const candidate of stack) {
      const stamped = (candidate as Element).closest?.('[data-cd-id]') as HTMLElement | null;
      if (!stamped) continue;
      if (!stamped.closest('.dc-artboard-body')) continue;
      const artboardEl = stamped.closest('[data-dc-screen]');
      target = {
        el: stamped,
        cdId: stamped.getAttribute('data-cd-id'),
        artboardId: artboardEl?.getAttribute('data-dc-screen') ?? null,
      };
      break;
    }
  }

  // Bare-specimen anchor — specimens have no `.dc-artboard-body`, so
  // resolveHoverTarget bails. Anchor to the EXACT element under the cursor (the
  // same one pickSpecimenEl highlights for the hover preview), via its own
  // data-cd-id when stamped, else a cssPath selector — so the dropped pin lands
  // on the previewed element instead of floating.
  if (!target && isBareSpecimen()) {
    const el = pickSpecimenEl(clientX, clientY);
    if (el) target = { el, cdId: el.getAttribute('data-cd-id'), artboardId: null };
  }

  if (!target) {
    // Floating comment — no element anchor, just the click point (e.g. a click
    // on empty canvas/specimen dead space). The overlay renders a pin at the
    // stored bounds.
    const floatingSel: Selection = {
      file,
      id: undefined,
      selector: '',
      artboardId: null,
      tag: '',
      classes: '',
      text: '',
      dom_path: [],
      bounds: { x: clientX - 12, y: clientY - 12, w: 24, h: 24 },
      html: '',
    };
    openComposer(floatingSel, clientX, clientY);
    return;
  }

  const sel = hoverTargetToSelection(target, file);
  selSet.replace(sel);
  openComposer(sel, clientX, clientY);
}

function openComposer(selection: Selection, clientX: number, clientY: number): void {
  if (typeof document !== 'undefined') {
    try {
      document.dispatchEvent(
        new CustomEvent('cm:open-composer', { detail: { selection, clientX, clientY } })
      );
    } catch {
      /* CustomEvent absent — fall through to parent path */
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.parent.postMessage({ dgn: 'comment-compose', selection }, '*');
    } catch {
      /* parent detached */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mountCanvas — the shell harness entry. Renders the canvas wrapped in the lite
// comment tree, or bare when comments are disabled (gallery thumbnails pass
// `commentsEnabled: false` via `?comments=0`).

export interface MountCanvasOptions {
  rootEl: HTMLElement;
  /** Canvas file key (designRel-prefixed). Defaults to `deriveFile()`. */
  file?: string;
  /** When false, the comment layer is skipped — the canvas renders raw. */
  commentsEnabled: boolean;
}

// The lite provider tree wrapping a canvas component (tool + selection +
// comment layer). Pulled out so both the live render and the error-fallback
// render build the identical envelope.
//
// NB: the CanvasActivityProvider (Phase 13 / DDR-029) is NOT mounted here — it
// lives inside `DesignCanvas` (canvas-lib). comment-mount.js and canvas-lib are
// SEPARATE bundles, so a context provided here would be a different instance
// from the one DCArtboard (canvas-lib) consumes. Same reasoning the real
// ToolProvider lives in DesignCanvas, not in this layer's MaybeToolProvider.
function buildCanvasTree(Canvas: ComponentType, file: string | undefined): ReactNode {
  // DDR-223 — this layer's provider instance keeps the DDR-187 posture:
  // bare DS specimens stay ALIVE with native cursors (there is no palette,
  // no editing, nothing to boot into edit for). On a UI canvas the inner
  // canvas-lib ToolProvider (a separate bundle, separate context) owns the
  // real boot posture (edit/`move`); this ancestor instance only carries the
  // comment tool + claim layer and converges on the first tool keydown.
  return (
    <MaybeToolProvider initial="browse">
      <MaybeSelectionSetProvider>
        <CommentHost file={file}>
          <Canvas />
        </CommentHost>
      </MaybeSelectionSetProvider>
    </MaybeToolProvider>
  );
}

export function mountCanvas(Canvas: ComponentType, opts: MountCanvasOptions): void {
  const root = createRoot(opts.rootEl);
  if (!opts.commentsEnabled) {
    root.render(createElement(Canvas));
    return;
  }
  const file = opts.file ?? deriveFile();
  root.render(createElement(CanvasHmrRuntime, { initialCanvas: Canvas, file }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 13.1 / DDR-077 — HMR error resilience during agent editing.
//
// When an agent (`/design:edit` / `/design:new`) live-edits a canvas, a
// half-saved file (missing import, undefined symbol, transpile error) used to
// blank the canvas to white: the shell did `location.reload()` straight into the
// broken module. The shell now soft-reloads (import-before-swap, see
// `templates/_shell.html`) so a build/import error never tears down the good
// render. This runtime closes the remaining gap — a *render-time* throw — by
// keeping the last good canvas mounted via an error boundary and surfacing a
// "holding last good" toast instead of a white screen. Strictly gated by the
// shell on agent-active; manual edits keep the plain reload (so this is inert
// for solo hand-editing). The runtime exposes its swap/hold API on
// `window.__maudeCanvasRuntime` (the same window-handshake style the shell
// already uses for `__canvas_rel__` etc.).

export interface CanvasRuntimeApi {
  /** Swap in a freshly-imported canvas module's default export (success path). */
  remount: (next: ComponentType) => void;
  /** Show/hide the "holding last good" toast (build-error path from the shell). */
  setHolding: (on: boolean, message?: string) => void;
}

const RUNTIME_KEY = '__maudeCanvasRuntime';

/**
 * Fires `onOk` only when its subtree COMMITS — i.e. renders without throwing. A
 * render-time throw in the canvas unwinds to the boundary before this commits,
 * so `onOk` never runs and `lastGood` is not advanced to a broken module.
 */
function OkSignal({
  Canvas,
  file,
  onOk,
}: {
  Canvas: ComponentType;
  file: string | undefined;
  onOk: () => void;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once per mount (key=attempt remounts this).
  useEffect(() => {
    onOk();
  }, []);
  return buildCanvasTree(Canvas, file);
}

export class CanvasErrorBoundary extends Component<
  {
    attempt: number;
    onError: () => void;
    fallback: () => ReactNode;
    children: ReactNode;
  },
  { hasError: boolean }
> {
  override state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  override componentDidCatch(): void {
    this.props.onError();
  }
  override componentDidUpdate(prev: { attempt: number }): void {
    // A new canvas (new attempt) arrived → clear the error and try rendering it.
    if (prev.attempt !== this.props.attempt && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  override render(): ReactNode {
    if (this.state.hasError) return this.props.fallback();
    return this.props.children;
  }
}

function HmrHoldingToast({ message }: { message?: string }): ReactNode {
  return createElement(
    'div',
    {
      className: 'dc-hmr-holding',
      role: 'status',
      'aria-live': 'polite',
      title: message ? `Holding last working render — ${message}` : 'Holding last working render',
    },
    '⏸ build error — držím poslední funkční verzi'
  );
}

function CanvasHmrRuntime({
  initialCanvas,
  file,
}: {
  initialCanvas: ComponentType;
  file: string | undefined;
}): ReactNode {
  const [{ canvas, attempt }, setCanvasState] = useState({ canvas: initialCanvas, attempt: 0 });
  const [holding, setHoldingState] = useState<{ on: boolean; message?: string }>({ on: false });
  const lastGood = useRef<ComponentType | null>(null);
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  // Publish the runtime API for the shell HMR client.
  useEffect(() => {
    const api: CanvasRuntimeApi = {
      remount: (next) => setCanvasState((s) => ({ canvas: next, attempt: s.attempt + 1 })),
      setHolding: (on, message) => setHoldingState(on ? { on: true, message } : { on: false }),
    };
    (window as unknown as Record<string, unknown>)[RUNTIME_KEY] = api;
    return () => {
      (window as unknown as Record<string, unknown>)[RUNTIME_KEY] = undefined;
    };
  }, []);

  const handleOk = useCallback(() => {
    lastGood.current = canvasRef.current;
    // The new canvas rendered clean → drop any holding state.
    setHoldingState((h) => (h.on ? { on: false } : h));
    // A soft replacement keeps the iframe document, so inspect.ts does not
    // repeat its initial loaded handshake. Re-announce only AFTER the new
    // subtree commits: the shell then reselects the current element and reads
    // fresh attributes/styles instead of retaining the pre-restore inspector.
    // Failed renders keep the last good tree and must not claim a new load.
    if (attempt > 0 && file) {
      try {
        window.parent.postMessage({ dgn: 'loaded', file }, '*');
      } catch {
        // The parent can detach while an imported canvas is committing.
      }
    }
  }, [attempt, file]);

  const handleError = useCallback(() => {
    setHoldingState({ on: true, message: 'render error' });
  }, []);

  const fallback = useCallback((): ReactNode => {
    const LG = lastGood.current;
    return LG ? buildCanvasTree(LG, file) : null;
  }, [file]);

  return (
    <>
      <CanvasErrorBoundary attempt={attempt} onError={handleError} fallback={fallback}>
        {/* key=attempt → each soft-reload remounts a fresh subtree (and resets the
            boundary's child), matching the clean-slate semantics of a full reload. */}
        <OkSignal key={attempt} Canvas={canvas} file={file} onOk={handleOk} />
      </CanvasErrorBoundary>
      {holding.on ? <HmrHoldingToast message={holding.message} /> : null}
    </>
  );
}
