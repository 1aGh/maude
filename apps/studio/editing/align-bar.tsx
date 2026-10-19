// editing/align-bar.tsx — the align bar (S2.7, artboard ed-obj-multi; D7).
//
// A small bar above a multi-selection: "3 objects" · align left / centre / right / top / middle /
// bottom · distribute horizontally / vertically. It replaces v1's ContextualToolbar for what it did
// to several elements (align / distribute; its copy / inspect / comment rows live in the object
// menu's Advanced ▸, S2.6) and serves artboards the same way (4 artboards) — plus Tidy up (S2.9):
// one row, even gaps, on the lowest board's line; the pointer on the button shows dashed outlines of
// the result (tidy-preview.tsx) and nothing moves until the click. Tidy is also the registry's
// `artboard.tidy` (⌘K). It replaces v1's MultiArtboardToolbar (deleted in S2.9).
//
// Objects go through the `align.*` / `distribute.*` edit-ops (the canvas measures, the writer
// moves); artboards go through `DragStateBus.commitPositions`, so annotations ride along. After an
// align a guide in the guide colour marks the edge the objects now share, with its place in the
// artboard ("X 64"). The same actions run from ⌘K (`run-action`).
//
// v1 testids re-emitted: `.dc-elem-ctx-tb` + `[data-on]` on the bar over objects,
// `.dc-multi-artboard-tb` on the bar over artboards.

import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { useArtboardsContext, useDragStateContext } from '../canvas-lib.tsx';
import { showCanvasToast } from '../canvas-notifications.tsx';
import { isElementDragActive } from '../drag-state.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import {
  ARRANGE,
  type ArrangeAction,
  alignGuide,
  arrangeArtboards,
  type BarModel,
  type BoardRect,
  barModel,
  type Guide,
  isArrangeAction,
  measureTargets,
  minimumFor,
  NOT_ENOUGH_LINE,
  objectTargets,
  runArrange,
  TIDY_ACTION,
  TIDY_TIP,
  tidyBoards,
  tidyPreviewRects,
  worldScaleOf,
} from './arrange.ts';
import { tidyPreviewStore } from './tidy-preview.tsx';

const GUIDE = 'var(--guide, var(--guide-magenta, oklch(62% 0.28 350)))';

const CSS_TEXT = `
.ed-align-bar {
  position: fixed; z-index: 6; display: none; align-items: center; gap: 2px; padding: 4px;
  background: var(--maude-chrome-bg-0, #fff);
  border: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.12)); border-radius: 10px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, rgba(0,0,0,0.12));
  font: 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace);
  color: var(--maude-chrome-fg-0, #1a1a1a); user-select: none; white-space: nowrap;
  opacity: 0; transition: opacity var(--dur-fast, 100ms) var(--ease-out, ease-out);
}
.ed-align-bar[data-on="true"] { opacity: 1; }
.ed-align-n { padding: 0 8px 0 6px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ed-align-div { width: 1px; align-self: stretch; margin: 0 4px; background: var(--maude-chrome-border, rgba(0,0,0,0.12)); }
.ed-align-b {
  position: relative; appearance: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: inherit; cursor: pointer;
}
.ed-align-b:hover:not(:disabled) { background: color-mix(in oklab, var(--maude-hud-accent) 10%, transparent); color: var(--maude-hud-accent); }
.ed-align-tidy { width: auto; padding: 0 10px; font: 600 11px/16px inherit; letter-spacing: 0; }
.ed-align-b:focus-visible { outline: 2px solid var(--maude-hud-accent); outline-offset: 1px; }
.ed-align-b:disabled { cursor: default; opacity: 0.4; }
.ed-align-b[data-tip]:hover::after, .ed-align-b[data-tip]:focus-visible::after {
  content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%);
  padding: 2px 6px; border-radius: 4px; pointer-events: none; z-index: 1;
  background: var(--maude-chrome-fg-0, #1a1a1a); color: var(--maude-chrome-bg-0, #fff);
}
.ed-guide-line { position: fixed; z-index: 5; pointer-events: none; background: ${GUIDE}; }
.ed-guide-chip {
  position: fixed; z-index: 6; pointer-events: none; padding: 0 5px; border-radius: 3px;
  background: ${GUIDE}; color: var(--maude-hud-accent-fg, #fff);
  font: 500 10px/14px var(--maude-chrome-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) { .ed-align-bar { transition-duration: 1ms; } }
`;

const GLYPH: Record<ArrangeAction, ReactElement> = {
  'align.left': (
    <>
      <line x1="1" y1="1" x2="1" y2="15" />
      <rect x="3" y="3" width="8" height="3.5" />
      <rect x="3" y="9.5" width="11" height="3.5" />
    </>
  ),
  'align.hcentre': (
    <>
      <line x1="8" y1="1" x2="8" y2="15" />
      <rect x="4" y="3" width="8" height="3.5" />
      <rect x="2.5" y="9.5" width="11" height="3.5" />
    </>
  ),
  'align.right': (
    <>
      <line x1="15" y1="1" x2="15" y2="15" />
      <rect x="5" y="3" width="8" height="3.5" />
      <rect x="2" y="9.5" width="11" height="3.5" />
    </>
  ),
  'align.top': (
    <>
      <line x1="1" y1="1" x2="15" y2="1" />
      <rect x="3" y="3" width="3.5" height="8" />
      <rect x="9.5" y="3" width="3.5" height="11" />
    </>
  ),
  'align.vmiddle': (
    <>
      <line x1="1" y1="8" x2="15" y2="8" />
      <rect x="3" y="4" width="3.5" height="8" />
      <rect x="9.5" y="2.5" width="3.5" height="11" />
    </>
  ),
  'align.bottom': (
    <>
      <line x1="1" y1="15" x2="15" y2="15" />
      <rect x="3" y="5" width="3.5" height="8" />
      <rect x="9.5" y="2" width="3.5" height="11" />
    </>
  ),
  'distribute.h': (
    <>
      <line x1="1" y1="1" x2="1" y2="15" />
      <line x1="15" y1="1" x2="15" y2="15" />
      <rect x="6.25" y="4" width="3.5" height="8" />
    </>
  ),
  'distribute.v': (
    <>
      <line x1="1" y1="1" x2="15" y2="1" />
      <line x1="1" y1="15" x2="15" y2="15" />
      <rect x="4" y="6.25" width="8" height="3.5" />
    </>
  ),
};

const ID_SUFFIX: Record<ArrangeAction, string> = {
  'align.left': 'edit-align-left',
  'align.hcentre': 'edit-align-hcentre',
  'align.right': 'edit-align-right',
  'align.top': 'edit-align-top',
  'align.vmiddle': 'edit-align-vmiddle',
  'align.bottom': 'edit-align-bottom',
  'distribute.h': 'edit-distribute-h',
  'distribute.v': 'edit-distribute-v',
};

const GROUPS: ArrangeAction[][] = [
  ['align.left', 'align.hcentre', 'align.right', 'align.top', 'align.vmiddle', 'align.bottom'],
  ['distribute.h', 'distribute.v'],
];

// ── the presentational bar (no hooks on the canvas: renders anywhere, tests without layout) ────

export function AlignBarView({
  model,
  onAction,
  onTidy,
  onTidyPreview,
  barRef,
}: {
  model: BarModel;
  onAction: (a: ArrangeAction) => void;
  /** artboards only: the "Tidy up" button's click */
  onTidy?: () => void;
  /** artboards only: the pointer / focus on (true) or off (false) the Tidy button — the dashed preview */
  onTidyPreview?: (on: boolean) => void;
  barRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={barRef}
      className={`ed-align-bar ${model.kind === 'objects' ? 'dc-elem-ctx-tb' : 'dc-multi-artboard-tb'}`}
      data-testid="edit-align-bar"
      data-kind={model.kind}
      role="toolbar"
      aria-label={`Align ${model.label}`}
    >
      <span className="ed-align-n" data-testid="edit-align-count">
        {model.label}
      </span>
      {GROUPS.map((group) => (
        <span key={group[0]} style={{ display: 'contents' }}>
          <span className="ed-align-div" aria-hidden="true" />
          {group.map((a) => {
            const short = model.count < minimumFor(a);
            const tip = short ? NOT_ENOUGH_LINE : (ARRANGE[a]?.label ?? a);
            return (
              <button
                key={a}
                type="button"
                className="ed-align-b"
                data-testid={ID_SUFFIX[a]}
                data-tip={tip}
                aria-label={ARRANGE[a]?.label}
                disabled={short}
                onClick={() => onAction(a)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="1"
                  aria-hidden="true"
                >
                  {GLYPH[a]}
                </svg>
              </button>
            );
          })}
        </span>
      ))}
      {model.kind === 'artboards' ? (
        <span style={{ display: 'contents' }}>
          <span className="ed-align-div" aria-hidden="true" />
          <button
            type="button"
            className="ed-align-b ed-align-tidy"
            data-testid="edit-tidy"
            data-tip={TIDY_TIP}
            onClick={() => onTidy?.()}
            onPointerEnter={() => onTidyPreview?.(true)}
            onPointerLeave={() => onTidyPreview?.(false)}
            onFocus={() => onTidyPreview?.(true)}
            onBlur={() => onTidyPreview?.(false)}
          >
            Tidy up
          </button>
        </span>
      ) : null}
    </div>
  );
}

// ── the canvas bar ────────────────────────────────────────────────────────────────────────────

/**
 * Where the bar sits: above the selection, as 14 Editing draws it; below when the selection is too near the top for
 * that and there is room under it; otherwise at the top of the window, under the chrome. Always on screen — a group that
 * fills the window used to put the bar under the selection, off the bottom edge (S2.V2 ed-ab-tidy).
 */
export function barPlacement(
  box: { l: number; t: number; r: number; b: number },
  bar: { w: number; h: number },
  view: { w: number; h: number }
): { left: number; top: number } {
  const MARGIN = 8;
  const CHROME = 60;
  const GAP = 14;
  const left = Math.max(
    MARGIN,
    Math.min(Math.round((box.l + box.r) / 2 - bar.w / 2), view.w - bar.w - MARGIN)
  );
  const above = box.t - bar.h - GAP;
  if (above >= CHROME) return { left, top: Math.round(above) };
  const below = box.b + GAP;
  if (below + bar.h <= view.h - MARGIN) return { left, top: Math.round(below) };
  return { left, top: CHROME };
}

function boxOf(els: Element[]): { l: number; t: number; r: number; b: number } | null {
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
}

const GUIDE_MS = 1800;

export function AlignBar({ readOnly = false }: { readOnly?: boolean }) {
  const { selected } = useSelectionSet();
  const world = useArtboardsContext();
  const bus = useDragStateContext();
  const undo = useUndoStackOptional();
  const model = useMemo(() => (readOnly ? null : barModel(selected)), [readOnly, selected]);
  const bar = useRef<HTMLDivElement | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const guideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ selected, world, bus, undo, model });
  live.current = { selected, world, bus, undo, model };

  const run = useCallback((action: ArrangeAction) => {
    const { selected: sel, world: w, bus: b, undo: u, model: m } = live.current;
    if (!m || sel.length < minimumFor(action)) {
      showCanvasToast(
        minimumFor(action) === 3 ? NOT_ENOUGH_LINE : 'Select two or more to align them.',
        'info'
      );
      return;
    }
    if (m.kind === 'artboards') {
      const ids = new Set(sel.filter((s) => !s.id && s.artboardId).map((s) => s.artboardId));
      const rects: BoardRect[] = (w?.artboards ?? []).filter((r) => ids.has(r.id));
      if (b) arrangeArtboards(action, rects, b);
      return;
    }
    const targets = objectTargets(sel, document);
    const measured = measureTargets(targets);
    if (!measured.ok) {
      showCanvasToast(measured.message, 'info');
      return;
    }
    const shots = targets.map((t) => t.el.getBoundingClientRect());
    const first = targets[0]?.el;
    const body = first?.closest('.dc-artboard-body')?.getBoundingClientRect();
    const g = first
      ? alignGuide(
          action,
          shots.map((q) => ({ left: q.left, top: q.top, right: q.right, bottom: q.bottom })),
          worldScaleOf(first),
          {
            left: body?.left ?? 0,
            top: body?.top ?? 0,
          }
        )
      : null;
    void runArrange(
      action,
      targets.map((t) => t.ref),
      measured.items,
      {
        toast: (msg, k) => showCanvasToast(msg, k === 'error' ? 'error' : 'info'),
        record: (rec) => u.record(rec),
      }
    ).then((r) => {
      if (!r?.ok || !g) return;
      setGuide(g);
      if (guideTimer.current) clearTimeout(guideTimer.current);
      guideTimer.current = setTimeout(() => setGuide(null), GUIDE_MS);
    });
  }, []);

  // the selected artboards' rects (world px); the same set Align uses
  const selectedBoards = useCallback((): BoardRect[] => {
    const { selected: sel, world: w } = live.current;
    const ids = new Set(sel.filter((s) => !s.id && s.artboardId).map((s) => s.artboardId));
    return (w?.artboards ?? []).filter((r) => ids.has(r.id));
  }, []);

  const tidy = useCallback(() => {
    tidyPreviewStore.set(null);
    const { bus: b, model: m } = live.current;
    if (!b || m?.kind !== 'artboards') return;
    if (!tidyBoards(selectedBoards(), b)) showCanvasToast('Already in a tidy row.', 'info');
  }, [selectedBoards]);

  const previewTidy = useCallback(
    (on: boolean) => tidyPreviewStore.set(on ? tidyPreviewRects(selectedBoards()) : null),
    [selectedBoards]
  );

  useEffect(
    () => () => {
      if (guideTimer.current) clearTimeout(guideTimer.current);
      tidyPreviewStore.set(null);
    },
    []
  );

  // ⌘K and the menus run the same actions through the shell's run-action
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'run-action')
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'run-action' || isReadOnlyCanvas()) return;
      if (isArrangeAction(m.id)) run(m.id);
      else if (m.id === TIDY_ACTION) tidy();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [run, tidy]);

  // sit above the selection, flipping below near the top edge, following pan / zoom
  const kind = model?.kind ?? null;
  useEffect(() => {
    const div = bar.current;
    if (!div || !kind) return;
    let raf = 0;
    const hide = () => {
      div.style.display = 'none';
      div.setAttribute('data-on', 'false');
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { selected: sel } = live.current;
      const els: Element[] =
        kind === 'artboards'
          ? sel
              .filter((s) => !s.id && s.artboardId)
              .map((s) =>
                document.querySelector(`[data-dc-screen="${CSS.escape(String(s.artboardId))}"]`)
              )
              .filter((n): n is Element => !!n)
          : objectTargets(sel, document).map((t) => t.el);
      const mode = canvasModeStore(window).get().mode;
      const box = (mode ?? 'edit') === 'edit' && !isElementDragActive() ? boxOf(els) : null;
      if (!box) return hide();
      div.style.display = 'flex';
      const at = barPlacement(
        box,
        { w: div.offsetWidth || 0, h: div.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight }
      );
      div.style.left = `${at.left}px`;
      div.style.top = `${at.top}px`;
      div.setAttribute('data-on', 'true');
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [kind]);

  if (!model) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <AlignBarView
        model={model}
        onAction={run}
        onTidy={tidy}
        onTidyPreview={previewTidy}
        barRef={bar}
      />
      {guide ? (
        <div aria-hidden="true" data-testid="edit-align-guide">
          <span
            className="ed-guide-line"
            style={
              guide.axis === 'x'
                ? {
                    left: guide.at,
                    top: guide.from,
                    width: 1,
                    height: Math.max(1, guide.to - guide.from),
                  }
                : {
                    left: guide.from,
                    top: guide.at,
                    width: Math.max(1, guide.to - guide.from),
                    height: 1,
                  }
            }
          />
          <span
            className="ed-guide-chip"
            data-testid="edit-align-chip"
            style={
              guide.axis === 'x'
                ? { left: guide.at + 4, top: guide.to + 4 }
                : { left: guide.to + 4, top: guide.at + 4 }
            }
          >
            {guide.chip}
          </span>
        </div>
      ) : null}
    </>
  );
}
