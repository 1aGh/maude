/**
 * @file       inspect-overlay.tsx — S3.11 (04 Modes · md-inspect)
 * @scope      apps/studio/inspect-overlay.tsx
 * @purpose    The canvas half of Inspect: when the selection is an inspection (`inspectsSelection`: Preview
 *             or Viewing, or the `inspect` tool on a free canvas) —
 *               · the outline loses its corner ticks (a read, not a grab: no handles);
 *               · a size tag ("150 × 48", world px) follows the outline, as in the canvas's `.md-osel`;
 *               · ↵ asks the shell for Edit (`mode-request {mode:'edit', cause:'inspect'}`) with the same
 *                 element still selected — registry `inspect.edit`. Only a role that can edit asks; in
 *                 Viewing there is no Edit to go to, so ↵ does nothing.
 *             Read-only: nothing here writes, no undo, no write-surface implications. Mirrors
 *             `measure-overlay.tsx`'s scaffold (persistent DOM, rAF follow, no React render per frame).
 */

import { useEffect, useRef } from 'react';
import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import { modeShows } from './bridge/mode-shows.ts';
import { useArtboardsContext } from './canvas-lib.tsx';
import { resolveSelectionEl, shortText } from './dom-selection.ts';
import { isEditableTarget } from './input-router.tsx';
import { inspectsSelection, type Neighbour, neighbourOf } from './inspect-canvas.ts';
import { useCanvasKeys } from './use-canvas-keys.ts';
import { useGovernedMode } from './use-governed-mode.ts';
import { useSelectionSet } from './use-selection-set.tsx';
import { useToolModeOptional } from './use-tool-mode.tsx';

const INSPECT_CSS = `
body[data-maude-inspect="true"] .dc-cv-halo--selected .tick { display: none; }
.dc-cv-inspect-tag {
  position: fixed;
  z-index: 7;
  pointer-events: none;
  transform: translateY(6px);
  font-family: var(--maude-chrome-font-body, system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 2px;
  white-space: nowrap;
  background: var(--maude-hud-accent, #0d99ff);
  color: #ffffff;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.dc-cv-inspect-tag[data-on="true"] { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .dc-cv-inspect-tag { transition-duration: 1ms; }
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('dc-cv-inspect-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-cv-inspect-css';
  s.textContent = INSPECT_CSS;
  document.head.appendChild(s);
}

/** ↵ in an inspection: ask the shell for Edit. Pure over the stores it is handed, so a test can call it. */
export function askEditFromInspect(win: Window = window): boolean {
  const snap = canvasModeStore(win).get();
  if (!snap.mode || !modeShows(snap.mode, 'inspect-panel')) return false;
  if (!snap.caps?.edit) return false; // Viewing / Can comment: there is no Edit to go to
  if (!canvasModeStore(win).claimRequest('edit|inspect')) return true;
  try {
    win.parent?.postMessage({ dgn: 'mode-request', mode: 'edit', cause: 'inspect' }, '*');
  } catch {
    /* detached */
  }
  return true;
}

const NAME_MAX = 24;
const nameOf = (el: Element): string =>
  el.getAttribute('data-dc-element')?.trim() ||
  shortText(el, NAME_MAX) ||
  el.getAttribute('data-cd-id') ||
  el.tagName.toLowerCase();

/** The nearest sibling of `el` and the gap to it, in world px — measured for the panel's "Gap to <name>". */
export function measureNeighbour(el: Element | null | undefined): Neighbour | null {
  const parent = el?.parentElement;
  if (!el || !parent) return null;
  const box = (e: Element) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const others = Array.from(parent.children)
    .filter((c) => c !== el && c.getBoundingClientRect().width > 0)
    .map((c) => ({ name: nameOf(c), rect: box(c) }));
  const zoom =
    (window as unknown as { __maudeViewport?: () => { zoom?: number } | null }).__maudeViewport?.()
      ?.zoom || 1;
  return neighbourOf(box(el), others, zoom);
}

export function InspectOverlay() {
  ensureStyles();
  const mode = useGovernedMode();
  const tool = useToolModeOptional()?.tool ?? 'move';
  const { selected } = useSelectionSet();
  const world = useArtboardsContext();
  const tagRef = useRef<HTMLDivElement | null>(null);
  const inspecting = inspectsSelection(mode, tool);
  const one = inspecting && selected.length === 1 ? selected[0] : null;
  const zoom = world?.viewport?.zoom || 1;
  const oneRef = useRef(one);
  oneRef.current = one;

  // the outline's ticks go while an inspection is on
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (inspecting) document.body.setAttribute('data-maude-inspect', 'true');
    else document.body.removeAttribute('data-maude-inspect');
    return () => document.body.removeAttribute('data-maude-inspect');
  }, [inspecting]);

  // the size tag follows the selected element
  useEffect(() => {
    const tag = tagRef.current;
    if (!tag) return undefined;
    if (!one) {
      tag.dataset.on = 'false';
      return undefined;
    }
    let alive = true;
    let raf: number | null = null;
    const tick = () => {
      raf = null;
      if (!alive) return;
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      if (el && r && (r.width > 0 || r.height > 0)) {
        tag.textContent = `${Math.round(r.width / zoom)} × ${Math.round(r.height / zoom)}`;
        tag.style.left = `${Math.round(r.left)}px`;
        tag.style.top = `${Math.round(r.bottom)}px`;
        tag.dataset.on = 'true';
      } else {
        tag.dataset.on = 'false';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [one, zoom]);

  // registry `inspect.edit` (↵): the binding is keyed to Preview/Viewing; the selection check is ours
  useCanvasKeys(
    {
      'inspect.edit': (e) => {
        if (!one || isEditableTarget(e.target)) return;
        // a focused control inside the design takes its own ↵ (a live Preview button)
        const t = e.target as Element | null;
        if (t?.closest?.('button, a[href], summary, [role="button"]')) return;
        if (askEditFromInspect()) e.preventDefault();
      },
    },
    { target: 'document', capture: true, selection: () => (oneRef.current ? 'object' : 'none') }
  );

  return <div ref={tagRef} className="dc-cv-inspect-tag" aria-hidden="true" data-on="false" />;
}
