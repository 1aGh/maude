// editing/size-ghost.tsx — S7.20: the F size picker's canvas half (08 `ak-picker`, `ak-picker-full`).
//
//   F armed, no artboard selected   → `tool-panel-open {panel:'sizes'}` to the shell, which draws the picker above
//                                     the toolbar (draw-tools.tsx `onFrameToolArmed`, S7-slices Q9)
//   shell `size-ghost {preset}`     → a dashed outline "FB event cover 1920 × 1005" where the artboard would land
//                                     (`{preset:null}`: the pointer left the tiles — it goes)
//   shell `run-action artboard.insert-preset {presetId, custom?}`
//                                   → ONE `artboard.insert-preset` edit-op at the ghost's place (or a free place
//                                     in view when no ghost was shown: ⌘K, Edit › Advanced ▸ New artboard › Video),
//                                     the new artboard selected, the tool back on Select, then `size-place`
//                                     (canvas → shell) so the picker's Recent chips learn the pick
//
// The write is the op's (`edit-ops/insert-preset.ts`); this file only measures where. A drag on empty canvas is
// still S2.13's: the picker closes (focus moves into the canvas) and `artboard.draw` makes a Fixed size artboard.
// Read-only canvases do nothing here (the server refuses anyway).

import { useEffect, useRef, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { DsIcon } from '../canvas-ds-icons.tsx';
import { getLiveViewport } from '../canvas-lib.tsx';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { Tool } from '../input-router.tsx';
import { customSpec, presetById } from '../kinds/presets.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { holdHoverFocus } from '../toolbars/tool-panel.ts';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { selectWhenRendered as selectArtboardsWhenRendered } from './artboard-actions.ts';
import { onFrameToolArmed } from './draw-tools.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';

export const INSERT_PRESET_ACTION = 'artboard.insert-preset' as const;

/** Space kept between the ghost and any artboard, world px. */
export const GHOST_GAP = 40;

export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: WorldRect, b: WorldRect, gap: number): boolean =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/**
 * Where a new artboard of `size` lands. Pure.
 *
 * With an artboard-free canvas it is centred in what the person sees. Otherwise the first free spot INSIDE the
 * visible area (no artboard within `gap`), nearest the middle of the view; and when the view has no room — it is
 * zoomed in, or the artboard is bigger than the window — beside the last artboard of the first row, one gap past
 * its right edge, so it never lands on top of anything and is a short pan away.
 */
export function placeGhost(
  size: { w: number; h: number },
  boards: readonly WorldRect[],
  view: WorldRect | null,
  gap = GHOST_GAP
): { x: number; y: number } {
  const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  if (boards.length === 0) {
    return view
      ? round({ x: view.x + (view.w - size.w) / 2, y: view.y + (view.h - size.h) / 2 })
      : { x: 0, y: 0 };
  }
  if (view && size.w <= view.w && size.h <= view.h) {
    const stepX = Math.max(gap, view.w / 48);
    const stepY = Math.max(gap, view.h / 48);
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    let best: { x: number; y: number; d: number } | null = null;
    for (let y = view.y; y + size.h <= view.y + view.h; y += stepY) {
      for (let x = view.x; x + size.w <= view.x + view.w; x += stepX) {
        const r = { x, y, w: size.w, h: size.h };
        if (boards.some((b) => overlaps(r, b, gap))) continue;
        const d = (x + size.w / 2 - cx) ** 2 + (y + size.h / 2 - cy) ** 2;
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (best) return round(best);
  }
  const top = Math.min(...boards.map((b) => b.y));
  const row = boards.filter((b) => b.y < top + 1);
  const right = Math.max(...row.map((b) => b.x + b.w), ...boards.map((b) => b.x + b.w));
  return round({ x: right + gap * 2, y: top });
}

/** Every artboard's design surface in world px, from the DOM and the live camera (canvas-lib's own math). */
export function boardsInWorld(
  doc: Document,
  vp: { x: number; y: number; zoom: number }
): WorldRect[] {
  const host = doc.querySelector('.dc-canvas') as HTMLElement | null;
  if (!host) return [];
  const hr = host.getBoundingClientRect();
  const z = vp.zoom || 1;
  const out: WorldRect[] = [];
  for (const el of Array.from(doc.querySelectorAll('[data-dc-screen]'))) {
    const body = Array.from(el.children).find((c) => c.classList.contains('dc-artboard-body'));
    const r = ((body as HTMLElement | undefined) ?? (el as HTMLElement)).getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({
      x: (r.left - hr.left - vp.x) / z,
      y: (r.top - hr.top - vp.y) / z,
      w: r.width / z,
      h: r.height / z,
    });
  }
  return out;
}

/** The part of the world the window shows, in world px. */
export function viewInWorld(
  doc: Document,
  vp: { x: number; y: number; zoom: number }
): WorldRect | null {
  const host = doc.querySelector('.dc-canvas') as HTMLElement | null;
  if (!host) return null;
  const hr = host.getBoundingClientRect();
  const z = vp.zoom || 1;
  if (hr.width <= 0 || hr.height <= 0) return null;
  return { x: -vp.x / z, y: -vp.y / z, w: hr.width / z, h: hr.height / z };
}

/**
 * What F asks of the shell when it is armed: the size picker above the toolbar — only with NO artboard selected (with
 * one selected F draws a frame inside it, S2.13), never on a read-only canvas, and only inside a shell (an embedded
 * canvas has no parent to draw it).
 */
export function sizesPanelRequest(info: {
  hasArtboardSelection: boolean;
  readOnly: boolean;
  framed?: boolean;
}): { dgn: 'tool-panel-open'; panel: 'sizes'; anchor: null } | null {
  if (info.hasArtboardSelection || info.readOnly || info.framed === false) return null;
  return { dgn: 'tool-panel-open', panel: 'sizes', anchor: null };
}

/** The size a pick lands at, from the one catalogue — null when the request names nothing real. */
export function sizeOfRequest(presetId: unknown, custom: unknown): { w: number; h: number } | null {
  if (typeof presetId !== 'string') return null;
  if (presetId === 'print-custom') {
    const c = (custom ?? {}) as Record<string, unknown>;
    const r = customSpec({
      widthMm: Number(c.widthMm),
      heightMm: Number(c.heightMm),
      ...(c.bleedMm === undefined ? {} : { bleedMm: Number(c.bleedMm) }),
    });
    return r.ok ? { w: r.spec.width, h: r.spec.height } : null;
  }
  const p = presetById(presetId);
  return p ? { w: p.widthPx, h: p.heightPx } : null;
}

const CSS_TEXT = `
.ed-size-ghost {
  position: fixed; z-index: 5; pointer-events: none; box-sizing: border-box;
  border: 1.5px dashed var(--maude-hud-accent);
  background: var(--maude-hud-accent-tint, color-mix(in oklab, var(--maude-hud-accent) 10%, transparent));
  border-radius: var(--maude-hud-radius-xs, 3px);
}
.ed-size-ghost-name {
  position: absolute; left: -2px; bottom: calc(100% + 4px);
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: var(--maude-hud-radius-xs, 3px); white-space: nowrap;
  background: var(--maude-hud-accent); color: var(--maude-hud-accent-fg);
  font: 600 11px/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
}
.ed-size-ghost-size { font-weight: 400; font-variant-numeric: tabular-nums; opacity: 0.86; margin-left: 6px; }
`;

interface Ghost {
  presetId: string;
  label: string;
  sizeText: string;
  w: number;
  h: number;
  at: { x: number; y: number };
}

export function SizeGhost({ readOnly = false }: { readOnly?: boolean }) {
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const tm = useToolModeOptional();
  const live = useRef({ selSet, undo, tm, readOnly });
  live.current = { selSet, undo, tm, readOnly };
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  ghostRef.current = ghost;
  const [, tick] = useState(0);

  // F armed with no artboard selected → the shell opens the picker above the toolbar
  useEffect(
    () =>
      onFrameToolArmed(({ hasArtboardSelection }) => {
        const ask = sizesPanelRequest({
          hasArtboardSelection,
          readOnly: live.current.readOnly || isReadOnlyCanvas(),
          framed: window.parent !== window,
        });
        if (!ask) return;
        try {
          holdHoverFocus(); // r1 #11: the picker is drawn over the canvas; hover must not blur it shut
          window.parent.postMessage(ask, '*');
        } catch {
          /* detached */
        }
      }),
    []
  );

  // the shell's hover, and the pick
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const where = (size: { w: number; h: number }) => {
      const vp = getLiveViewport() ?? { x: 0, y: 0, zoom: 1 };
      return placeGhost(size, boardsInWorld(document, vp), viewInWorld(document, vp));
    };
    const onMessage = (e: MessageEvent) => {
      const t = (e.data as { dgn?: unknown } | null)?.dgn;
      if (e.source !== window.parent || (t !== 'size-ghost' && t !== 'run-action')) return;
      const m = acceptFromShell(e, window);
      if (!m || live.current.readOnly || isReadOnlyCanvas()) return;
      if (m.dgn === 'size-ghost') {
        const p = m.preset;
        if (!p) return setGhost(null);
        const size = { w: p.w, h: p.h };
        setGhost({
          presetId: p.id,
          label: p.label,
          sizeText: p.sizeText,
          ...size,
          at: where(size),
        });
        return;
      }
      if (m.dgn !== 'run-action' || m.id !== INSERT_PRESET_ACTION) return;
      const params = (m.params ?? {}) as { presetId?: unknown; custom?: unknown };
      const size = sizeOfRequest(params.presetId, params.custom);
      if (!size) {
        showCanvasToast('That size is not one of the presets.', 'error');
        return;
      }
      const g = ghostRef.current;
      const at = g && g.presetId === params.presetId ? g.at : where(size);
      setGhost(null);
      void place(String(params.presetId), params.custom, at, {
        record: (rec) => live.current.undo?.record(rec),
        select: (ids) => selectArtboardsWhenRendered(ids, (s) => live.current.selSet.replace(s)),
        done: () => live.current.tm?.setTool('move' as Tool),
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // the ghost follows the camera while it is up
  useEffect(() => {
    if (!ghost) return undefined;
    let raf = 0;
    let key = '';
    const loop = () => {
      const vp = getLiveViewport();
      const k = vp ? `${vp.x}|${vp.y}|${vp.zoom}` : '';
      if (k !== key) {
        key = k;
        tick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ghost]);

  if (!ghost || typeof document === 'undefined') return null;
  const vp = getLiveViewport() ?? { x: 0, y: 0, zoom: 1 };
  const host = document.querySelector('.dc-canvas') as HTMLElement | null;
  const hr = host?.getBoundingClientRect();
  const z = vp.zoom || 1;
  const left = (hr?.left ?? 0) + vp.x + ghost.at.x * z;
  const top = (hr?.top ?? 0) + vp.y + ghost.at.y * z;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <div
        className="ed-size-ghost"
        data-testid="edit-size-ghost"
        aria-hidden="true"
        style={{ left, top, width: ghost.w * z, height: ghost.h * z }}
      >
        <span className="ed-size-ghost-name" data-testid="edit-size-ghost-name">
          <DsIcon name={presetById(ghost.presetId)?.kind ?? 'digital'} size={11} />
          {ghost.label}
          <span className="ed-size-ghost-size">{ghost.sizeText}</span>
        </span>
      </div>
    </>
  );
}

interface PlaceDeps {
  run?: (ask: EditOpAsk) => ReturnType<typeof runEditOp>;
  toast?: (m: string, kind?: 'info' | 'error') => void;
  record?: (rec: NonNullable<ReturnType<typeof editOpRecord>>) => void;
  select?: (ids: string[]) => void;
  done?: () => void;
  post?: (msg: Record<string, unknown>) => void;
}

/** ONE `artboard.insert-preset` at `at`: select it, record the undo step, tell the shell. Resolves true when it landed. */
export async function place(
  presetId: string,
  custom: unknown,
  at: { x: number; y: number },
  deps: PlaceDeps = {}
): Promise<boolean> {
  const toast = deps.toast ?? ((m, k) => showCanvasToast(m, k === 'error' ? 'error' : 'info'));
  const params: Record<string, unknown> = { presetId, at };
  if (custom && typeof custom === 'object') params.custom = custom;
  const r = await (deps.run ?? runEditOp)({ op: INSERT_PRESET_ACTION, targets: [], params });
  if (!r.ok) {
    toast(r.message || 'That did not go through.', 'error');
    return false;
  }
  const label = String((r.detail as { label?: unknown } | undefined)?.label ?? 'artboard');
  if (r.actionId === null && r.writeId) {
    const rec = editOpRecord(r.writeId, `Added ${label}`);
    if (rec) deps.record?.(rec);
  }
  if (r.created?.length) deps.select?.(r.created.map((c) => c.artboard));
  deps.done?.();
  const post =
    deps.post ??
    ((msg: Record<string, unknown>) => {
      if (typeof window !== 'undefined' && window.parent !== window)
        window.parent.postMessage(msg, '*');
    });
  post({ dgn: 'size-place', presetId, world: at });
  return true;
}
