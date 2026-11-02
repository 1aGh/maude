/**
 * @file       annotations/ui/lod.tsx — S4.9: the crowd, zoomed out (an-crowd)
 * @scope      apps/studio/annotations/ui/lod.tsx
 * @purpose    Below 25 % zoom a sticky is a colour block, not a card with words nobody can read: stickies
 *             draw as tiles, a section shows its count, hovering says who is in it, and a click zooms to it.
 *             "Colour first, words when legible."
 *
 *             The mosaic REPLACES the sticky and section nodes (the scene keeps drawing everything else), so
 *             200 stickies are 200 empty boxes instead of 200 cards with a filter and a text slot - the pan
 *             gate (perf.sh --fixture, 200 stickies at 20 %) is about not paying for words at that size.
 *             The zoom it reads is the PUBLISHED one (settle cadence), so a pinch never flips it mid-gesture.
 */

import { memo, type ReactNode, useState } from 'react';
import { type Stroke, strokeBBox } from '../../annotations-model.ts';
import { personKeyOf } from './visibility.ts';

/** The cut-over: strictly below this the mosaic draws. */
export const LOD_ZOOM = 0.25;
export const inMosaic = (zoom: number): boolean => zoom > 0 && zoom < LOD_ZOOM;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LodTile extends Rect {
  id: string;
  fill: string;
}
export interface LodSection extends Rect {
  id: string;
  label: string;
  /** The section's own tone (its stored colour). */
  color: string;
  count: number;
  tiles: LodTile[];
  /** Distinct people who drew a sticky in it, by chip key, first seen first. */
  people: string[];
}
export interface LodModel {
  sections: LodSection[];
  loose: LodTile[];
  /** ids the mosaic draws instead of their nodes (every sticky and section). */
  covered: Set<string>;
}

const norm = (r: Rect): Rect => ({
  x: Math.min(r.x, r.x + r.w),
  y: Math.min(r.y, r.y + r.h),
  w: Math.abs(r.w),
  h: Math.abs(r.h),
});

/** Stickies into the smallest section that holds their centre; the rest stay loose. */
export function lodModel(strokes: readonly Stroke[]): LodModel {
  const secs: LodSection[] = [];
  for (const s of strokes) {
    if (s.tool !== 'section') continue;
    secs.push({
      id: s.id,
      label: s.label,
      color: typeof s.color === 'string' && s.color ? s.color : '#8b8b94',
      ...norm(s),
      count: 0,
      tiles: [],
      people: [],
    });
  }
  const bySize = [...secs].sort((a, b) => a.w * a.h - b.w * b.h);
  const loose: LodTile[] = [];
  const covered = new Set<string>(secs.map((s) => s.id));
  for (const s of strokes) {
    if (s.tool !== 'sticky') continue;
    covered.add(s.id);
    const bb = strokeBBox(s) ?? norm(s);
    const tile: LodTile = { id: s.id, x: bb.x, y: bb.y, w: bb.w, h: bb.h, fill: s.color };
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const home = bySize.find((g) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h);
    if (!home) {
      loose.push(tile);
      continue;
    }
    home.tiles.push(tile);
    home.count += 1;
    const who = personKeyOf(s);
    if (!home.people.includes(who)) home.people.push(who);
  }
  return { sections: secs, loose, covered };
}

/** The hover card's words. */
export function lodCardWords(sec: Pick<LodSection, 'label' | 'count'>): {
  head: string;
  hint: string;
} {
  const n = sec.count;
  return {
    head: `${sec.label || 'Section'} · ${n} ${n === 1 ? 'sticky' : 'stickies'}`,
    hint: 'Click to zoom to it',
  };
}

/** The box the click zooms to: the thing, with room around it. */
export function zoomTarget(r: Rect, pad = 48): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

const FACES = 4;

function personLabel(key: string): string {
  if (key === 'ai') return 'AI';
  if (key === 'you') return 'You';
  if (key.startsWith('h:')) return key.slice(2);
  return '?';
}

export const LOD_CSS = `
.dc-annot-lod { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.dc-annot-lod[data-quiet] { opacity: 0.45; }
.dc-annot-lod [data-lod] { position: absolute; box-sizing: border-box; pointer-events: none; }
.dc-annot-lod[data-live] [data-lod="section"] { pointer-events: auto; cursor: zoom-in; }
.dc-annot-lod [data-lod="tile"] { border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.14); }
.dc-annot-lod button[data-lod="section"] { padding: 0; border: 0; font: inherit; }
.dc-annot-lod [data-lod="section"] { border-radius: 10px; }
.dc-annot-lod [data-lod="section"][data-hover] { box-shadow: inset 0 0 0 2px var(--maude-hud-accent, oklch(0.53 0.175 238)) !important; }
.dc-annot-lod [data-lod="count"] { color: var(--maude-hud-object-ink, #1a1a1a); font: 600 14px/1.3 system-ui, sans-serif;
  padding: 4px 9px; border-radius: 6px; white-space: nowrap; transform-origin: 0 100%; font-variant-numeric: tabular-nums; }
.dc-annot-lod [data-lod="card"] { z-index: 15; width: 220px; padding: 10px 12px; border-radius: 10px;
  background: var(--maude-chrome-bg-0, #fff); color: var(--maude-chrome-fg-0, #1a1a1a);
  box-shadow: 0 8px 24px rgba(0,0,0,0.22), inset 0 0 0 0.5px rgba(0,0,0,0.12);
  font: 12px/1.35 system-ui, sans-serif; transform-origin: 0 0; }
.dc-annot-lod [data-lod="card"] b { font-weight: 600; }
.dc-annot-lod [data-lod="card"] .lod-faces { display: flex; gap: 2px; margin: 4px 0; align-items: center; }
.dc-annot-lod [data-lod="card"] .lod-face { width: 20px; height: 20px; border-radius: 50%; background: #d8d8d4;
  color: #2a2a28; font-size: 10px; display: inline-grid; place-items: center; }
.dc-annot-lod [data-lod="card"] .lod-k { color: var(--maude-hud-accent, oklch(0.53 0.175 238)); font-size: 11px; }
@media (prefers-reduced-motion: no-preference) {
  .dc-annot-lod [data-lod="section"] { transition: box-shadow var(--dur-fast, 120ms); }
}
`;

function Tile({ t }: { t: LodTile }): ReactNode {
  return (
    <span
      data-lod="tile"
      data-id={t.id}
      style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: t.fill }}
    />
  );
}

function LodMosaicImpl({
  model,
  zoom,
  quiet,
  onZoomTo,
}: {
  model: LodModel;
  /** Published zoom: the count labels and the card hold a constant screen size. */
  zoom: number;
  /** Edit: faded and click-through. */
  quiet: boolean;
  onZoomTo: (target: Rect) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const k = 1 / (zoom || 1);
  const live = !quiet;
  const sec = hover ? model.sections.find((s) => s.id === hover) : null;
  return (
    <div
      className="dc-annot-lod"
      data-testid="annotations-lod"
      data-mosaic="1"
      {...(live ? { 'data-live': '1' } : { 'data-quiet': '1' })}
    >
      {model.sections.map((s) => (
        <span key={s.id}>
          <button
            type="button"
            data-lod="section"
            disabled={!live}
            aria-label={`${lodCardWords(s).head}. ${lodCardWords(s).hint}`}
            onFocus={live ? () => setHover(s.id) : undefined}
            onBlur={live ? () => setHover((h) => (h === s.id ? null : h)) : undefined}
            data-id={s.id}
            data-count={s.count}
            {...(hover === s.id ? { 'data-hover': '1' } : {})}
            style={{
              left: s.x,
              top: s.y,
              width: s.w,
              height: s.h,
              // 15 an-crowd: the block is the section's own tone, washed (the full-size body is 7 % of it, ringed at 45 %)
              background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
              boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${s.color} 45%, transparent)`,
            }}
            onPointerEnter={live ? () => setHover(s.id) : undefined}
            onPointerLeave={live ? () => setHover((h) => (h === s.id ? null : h)) : undefined}
            onClick={live ? () => onZoomTo(zoomTarget(s)) : undefined}
          />
          {s.tiles.map((t) => (
            <Tile key={t.id} t={t} />
          ))}
          <span
            data-lod="count"
            data-testid="annotations-lod-count"
            style={{
              left: s.x + 8 * k,
              top: s.y - 6 * k,
              background: s.color,
              transform: `translateY(-100%) scale(${k})`,
            }}
          >
            {s.label ? `${s.label} ${s.count}` : s.count}
          </span>
        </span>
      ))}
      {model.loose.map((t) => (
        <Tile key={t.id} t={t} />
      ))}
      {live && sec ? (
        <div
          data-lod="card"
          data-testid="annotations-lod-card"
          style={{ left: sec.x + sec.w / 2, top: sec.y + sec.h / 2, transform: `scale(${k})` }}
        >
          <b>{lodCardWords(sec).head}</b>
          <div className="lod-faces">
            {sec.people.slice(0, FACES).map((p) => (
              <span key={p} className="lod-face" title={personLabel(p)}>
                {personLabel(p).slice(0, 1).toUpperCase()}
              </span>
            ))}
            {sec.people.length > FACES ? <span>+ {sec.people.length - FACES} people</span> : null}
          </div>
          <span className="lod-k">{lodCardWords(sec).hint}</span>
        </div>
      ) : null}
    </div>
  );
}

export const LodMosaic = memo(LodMosaicImpl);
