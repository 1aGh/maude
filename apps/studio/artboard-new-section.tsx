/**
 * @file       artboard-new-section.tsx — V2-8.5 c7 (08 ak-web-hug).
 * @scope      apps/studio/artboard-new-section.tsx
 * @purpose    "Add a section; the page gets longer": next to the "+ 373 px" tag the board frames the section that
 *             just arrived and names it ("Rozpis zápasů · new section"). The canvas knows it from the page itself:
 *             each time a hugging page's height changes it compares the children of the page's layout container with
 *             the ones it saw before; a child that was not there is the new section. A mark on the canvas, never part
 *             of the design: `.dc-artboard-guides` (every exporter hides it), outside `.dc-artboard`, aria-hidden,
 *             pointer-events none, gone with the growth tag.
 */

import { useEffect, useRef, useState } from 'react';
import { readGrowthMemory, sectionSigs, writeGrowthMemory } from './artboard-growth-memory.ts';
import { GROWTH_MS } from './artboard-growth-tag.tsx';
import { displayLayerName, snippetOf } from './layer-name.ts';

/**
 * Does this child take its place in the page's flow? A picture placed ON the page (`position: absolute`) is not a
 * section: the page does not get longer for it, so it is never "new section" (14 ed-edge-paste).
 */
export function inFlow(el: Element): boolean {
  const own = (el as HTMLElement).style?.position ?? '';
  let pos = own;
  if (!pos && typeof getComputedStyle === 'function') {
    try {
      pos = getComputedStyle(el).position;
    } catch {
      pos = '';
    }
  }
  return pos !== 'absolute' && pos !== 'fixed';
}

/** The children that make up the page: those in its flow. */
export const flowChildren = (el: Element): Element[] => Array.from(el.children).filter(inFlow);

/** The container whose children are the page's sections: down through single-child wrappers (`<main>`, a page div). */
export function sectionHost(body: Element | null): Element | null {
  let host: Element | null = body;
  for (let i = 0; i < 6 && host && flowChildren(host).length === 1; i++) {
    host = flowChildren(host)[0] ?? null;
  }
  return host && flowChildren(host).length > 1 ? host : null;
}

/** The children that were not there last time (empty on the first look: that is the baseline). */
export function freshChildren<T>(seen: ReadonlySet<T> | null, kids: readonly T[]): T[] {
  if (!seen || seen.size === 0) return [];
  return kids.filter((k) => !seen.has(k));
}

/** What the new section is called: its authored name, its aria-label, its first heading, then the plain word. */
export function sectionName(el: Element): string {
  const dc = el.getAttribute('data-dc-element');
  if (dc) {
    return dc
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  const aria = el.getAttribute('aria-label');
  if (aria) return snippetOf(aria);
  const heading = el.querySelector('h1,h2,h3,h4,h5,h6')?.textContent;
  if (heading && heading.trim()) return snippetOf(heading);
  return displayLayerName({ tag: el.tagName, role: el.getAttribute('role'), text: null });
}

export interface NewSection {
  name: string;
  /** relative to the artboard's design surface, in world px */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The new section of a hugging page, for `GROWTH_MS` after the page grew. */
export function useNewSection(
  bodyRef: { current: HTMLElement | null },
  active: boolean,
  height: number,
  memoryKey?: string
): NewSection | null {
  // what the sections looked like at the last look: from the frame's memory on a reload, else the first look here
  const seen = useRef<Set<string> | null>(
    (() => {
      const m = readGrowthMemory(memoryKey);
      return m && m.sigs.length ? new Set(m.sigs) : null;
    })()
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mark, setMark] = useState<NewSection | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `height` is the "the page changed" signal
  useEffect(() => {
    const body = bodyRef.current;
    if (!active || !body) {
      seen.current = null;
      setMark(null);
      return;
    }
    const host = sectionHost(body);
    const kids = host ? flowChildren(host) : [];
    const sigs = sectionSigs(kids);
    // the page has not drawn its sections yet (a reload's first pass): keep what was remembered as the baseline
    if (!sigs.length) return;
    const fresh = freshChildren(seen.current, sigs);
    seen.current = new Set(sigs);
    if (sigs.length) writeGrowthMemory(memoryKey, { sigs });
    const at = fresh.length ? sigs.indexOf(fresh[0] as string) : -1;
    const el = at >= 0 ? kids[at] : undefined;
    if (!el) return;
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const k = body.offsetWidth > 0 && b.width > 0 ? b.width / body.offsetWidth : 1;
    if (timer.current) clearTimeout(timer.current);
    setMark({
      name: sectionName(el),
      x: (r.left - b.left) / k,
      y: (r.top - b.top) / k,
      w: r.width / k,
      h: r.height / k,
    });
    timer.current = setTimeout(() => setMark(null), GROWTH_MS);
  }, [active, height, bodyRef, memoryKey]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return mark;
}

const ACCENT = 'var(--accent, oklch(58% 0.19 255))';
const ACCENT_FG = 'var(--accent-fg, #fff)';
const ZOOM = 'var(--dc-zoom, 1)';

/** The frame + its name, in world coordinates (`x`, `y` = the design surface's origin). */
export function ArtboardNewSection({
  x,
  y,
  section,
}: {
  x: number;
  y: number;
  section: NewSection | null;
}) {
  if (!section) return null;
  return (
    <div
      className="dc-artboard-guides dc-new-section"
      data-testid="artboard-new-section"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: x + section.x,
        top: y + section.y,
        width: section.w,
        height: section.h,
        boxSizing: 'border-box',
        border: `calc(2px / ${ZOOM}) solid ${ACCENT}`,
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: `calc(-2px / ${ZOOM})`,
          top: 0,
          padding: '0 6px',
          borderRadius: '3px 3px 0 0',
          background: ACCENT,
          color: ACCENT_FG,
          font: '600 12px/18px system-ui, -apple-system, sans-serif',
          whiteSpace: 'nowrap',
          transformOrigin: '0 0',
          transform: `scale(calc(1 / ${ZOOM})) translateY(-100%)`,
        }}
      >
        {section.name} · new section
      </span>
    </div>
  );
}
ArtboardNewSection.displayName = 'ArtboardNewSection';
