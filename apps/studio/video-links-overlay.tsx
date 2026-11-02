/**
 * @file       video-links-overlay.tsx — S7.13 (07 ve-formats).
 * @scope      apps/studio/video-links-overlay.tsx
 * @purpose    The marks that say "these videos are one edit": a link glyph in the gap between linked video artboards, and
 *             "Unlinked copy — its own cut" under an artboard that was forked from another's cut.
 *
 * Both are DERIVED, never stored (S7-slices Q4): artboards whose `<VideoComp component={X}>` mount the same component
 * share a cut, and a fork is the component `<X>Unlinked[N]` (video/link-groups.ts — the server's Formats list uses the
 * same rule). The layer reads the comps the videos registered (`window.__maudeVideoComps`) and the artboard rects the
 * canvas already holds; nothing is told to it and nothing is posted.
 *
 * Geometry: a WORLD-coordinate layer inside `.dc-world` (one line in canvas-lib.tsx's DesignCanvasInner, beside the
 * ghosts layer), so pan and zoom carry the marks. Each mark counter-scales by the viewport zoom, so a glyph is the same
 * size on screen at any zoom (the canvas draws it at 22 %). Decorative: `aria-hidden`, `pointer-events: none`, and the one
 * class every exporter hides and Present never paints (`.dc-artboard-guides`) — they are canvas chrome, never exported.
 */

import { useSyncExternalStore } from 'react';

import { useArtboardsContext } from './canvas-lib.tsx';
import { type LinkGroup, linkGroups, unlinkedBase } from './video/link-groups.ts';

export interface PillRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A link glyph's place: the centre of the gap between two artboards, in world px. */
export interface LinkPill {
  from: string;
  to: string;
  x: number;
  y: number;
  /** the gap it sits in, along the line between the two (a glyph never needs more room than it has) */
  gap: number;
}

/**
 * Spokes from the first artboard of a group to each of the others (document order — "this one" first), each pill at the
 * middle of the gap between the two boards. Boards that overlap on one axis are joined across the gap on the other;
 * diagonal neighbours are joined at the middle of the line between their centres.
 */
export function linkPills(
  groups: ReadonlyArray<{ ids: string[] }>,
  rects: ReadonlyArray<PillRect>
): LinkPill[] {
  const by = new Map(rects.map((r) => [r.id, r]));
  const out: LinkPill[] = [];
  for (const g of groups) {
    const hub = by.get(g.ids[0] as string);
    if (!hub) continue;
    for (const id of g.ids.slice(1)) {
      const r = by.get(id);
      if (!r) continue;
      const hx = [hub.x, hub.x + hub.w] as const;
      const rx = [r.x, r.x + r.w] as const;
      const hy = [hub.y, hub.y + hub.h] as const;
      const ry = [r.y, r.y + r.h] as const;
      const overlapY = Math.min(hy[1], ry[1]) - Math.max(hy[0], ry[0]);
      const overlapX = Math.min(hx[1], rx[1]) - Math.max(hx[0], rx[0]);
      if (overlapY > 0) {
        const left = hub.x < r.x ? hub : r;
        const right = left === hub ? r : hub;
        const gap = right.x - (left.x + left.w);
        out.push({
          from: hub.id,
          to: r.id,
          x: left.x + left.w + gap / 2,
          y: Math.max(hy[0], ry[0]) + overlapY / 2,
          gap,
        });
      } else if (overlapX > 0) {
        const top = hub.y < r.y ? hub : r;
        const bottom = top === hub ? r : hub;
        const gap = bottom.y - (top.y + top.h);
        out.push({
          from: hub.id,
          to: r.id,
          x: Math.max(hx[0], rx[0]) + overlapX / 2,
          y: top.y + top.h + gap / 2,
          gap,
        });
      } else {
        out.push({
          from: hub.id,
          to: r.id,
          x: (hub.x + hub.w / 2 + r.x + r.w / 2) / 2,
          y: (hub.y + hub.h / 2 + r.y + r.h / 2) / 2,
          gap: 0,
        });
      }
    }
  }
  return out;
}

/** The artboards that are forks of another artboard's cut: their id, and the comp they were forked from. */
export function unlinkedCopies(
  items: ReadonlyArray<{ id: string; name: string | null }>
): Array<{ id: string; of: string }> {
  const names = new Set(items.map((i) => i.name).filter((n): n is string => !!n));
  const out: Array<{ id: string; of: string }> = [];
  for (const it of items) {
    const base = unlinkedBase(it.name);
    if (base && names.has(base)) out.push({ id: it.id, of: base });
  }
  return out;
}

// ── the registry the videos announce themselves in ───────────────────────────────────────────────────────────
interface CompEntryLike {
  artboardId: string | null;
  component: unknown;
}
interface PlayheadHubLike {
  listeners: Set<() => void>;
}
const HUB_KEY = Symbol.for('maude.playhead.v1');

function registry(): Map<string, CompEntryLike> | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { __maudeVideoComps?: Map<string, CompEntryLike> }).__maudeVideoComps ??
    null
  );
}

const fnIds = new WeakMap<object, number>();
let nextFn = 1;
const keyOf = (c: unknown): string => {
  if (typeof c !== 'function' && (typeof c !== 'object' || c === null)) return String(c);
  let n = fnIds.get(c as object);
  if (!n) {
    n = nextFn++;
    fnIds.set(c as object, n);
  }
  return `f${n}`;
};

/** One line per video artboard: `artboard \t comp key \t comp name` — what the layer draws from, as a stable string. */
function snapshot(): string {
  const reg = registry();
  if (!reg) return '';
  const rows: string[] = [];
  for (const e of reg.values()) {
    if (!e.artboardId) continue;
    const name = typeof e.component === 'function' ? (e.component as { name?: string }).name : '';
    rows.push(`${e.artboardId}\t${keyOf(e.component)}\t${name ?? ''}`);
  }
  return rows.sort().join('\n');
}

function subscribe(fn: () => void): () => void {
  // The video registers (and unregisters) through the playhead hub's emit; the hub lives on `window` because the
  // canvas bundle and the shell bundle can be two copies of video-comp. No hub yet = nothing mounted yet.
  const w =
    typeof window === 'undefined'
      ? null
      : (window as unknown as Record<symbol, PlayheadHubLike | undefined>);
  const hub = w?.[HUB_KEY];
  if (!hub) {
    const t = setInterval(fn, 500);
    return () => clearInterval(t);
  }
  hub.listeners.add(fn);
  return () => void hub.listeners.delete(fn);
}

const CSS = `
.dc-vlinks { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
.dc-vlink, .dc-vunlinked {
  position: absolute; pointer-events: none; display: flex; align-items: center; justify-content: center;
  border-radius: 999px; background: oklch(0.99 0.004 250); color: oklch(0.38 0.012 250);
  box-shadow: 0 1px 3px oklch(0.2 0.01 250 / 0.25), inset 0 0 0 0.5px oklch(0.6 0.012 250);
  font: 500 11px/20px system-ui, sans-serif; white-space: nowrap;
}
.dc-vlink { width: 20px; height: 20px; }
.dc-vunlinked { gap: 4px; padding: 0 8px; height: 20px; }
:root[data-maude-theme="dark"] .dc-vlink, :root[data-maude-theme="dark"] .dc-vunlinked {
  background: oklch(0.24 0.01 250); color: oklch(0.86 0.01 250); box-shadow: 0 1px 3px oklch(0 0 0 / 0.5), inset 0 0 0 0.5px oklch(0.5 0.012 250);
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('dc-vlinks-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-vlinks-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const GLYPH =
  'M6.8 9.2l2.4-2.4M5.6 7.4L4.2 8.8a2.5 2.5 0 0 0 3.5 3.5l1.4-1.4M10.4 8.6l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L6.9 5.1';
const GLYPH_OFF =
  'M5.6 7.4L4.2 8.8a2.5 2.5 0 0 0 3.5 3.5l1.4-1.4M10.4 8.6l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L6.9 5.1M2.5 2.5l11 11';

function Glyph({ off = false }: { off?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={off ? GLYPH_OFF : GLYPH} />
    </svg>
  );
}

export function VideoLinksLayer() {
  ensureStyles();
  const ctx = useArtboardsContext();
  const snap = useSyncExternalStore(subscribe, snapshot, () => '');
  if (!ctx || !snap) return null;
  const items = snap.split('\n').map((line) => {
    const [id, comp, name] = line.split('\t');
    return { id: id as string, comp: comp as string, name: name || null };
  });
  const groups: LinkGroup[] = linkGroups(items);
  const pills = linkPills(groups, ctx.artboards);
  const copies = unlinkedCopies(items);
  if (pills.length === 0 && copies.length === 0) return null;
  const k = 1 / (ctx.viewport?.zoom || 1);
  return (
    <div className="dc-artboard-guides dc-vlinks" aria-hidden="true" data-testid="video-links">
      {pills.map((p) => (
        <span
          key={`${p.from}>${p.to}`}
          className="dc-vlink"
          data-testid={`video-link-${p.from}-${p.to}`}
          style={{
            left: p.x - 10,
            top: p.y - 10,
            transform: `scale(${k})`,
            transformOrigin: '50% 50%',
          }}
        >
          <Glyph />
        </span>
      ))}
      {copies.map((c) => {
        const r = ctx.artboards.find((a) => a.id === c.id);
        if (!r) return null;
        return (
          <span
            key={c.id}
            className="dc-vunlinked"
            data-testid={`video-unlinked-${c.id}`}
            style={{
              left: r.x,
              top: r.y + r.h + 8 * k,
              transform: `scale(${k})`,
              transformOrigin: '0 0',
            }}
          >
            <Glyph off />
            Unlinked copy — its own cut
          </span>
        );
      })}
    </div>
  );
}
VideoLinksLayer.displayName = 'VideoLinksLayer';
