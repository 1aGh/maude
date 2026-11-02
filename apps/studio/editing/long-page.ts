// editing/long-page.ts — S2.8 (artboard ed-edge-huge): measuring the tall pages on a canvas. One DOM pass shared by
// the sticky name and the contextual minimap. Read-only: it never writes to the canvas.

import {
  isLongPage,
  type PageSection,
  type SectionNode,
  sectionsOf,
  visibleRange,
} from './artboard-resize.ts';

export interface LongPage {
  id: string;
  name: string;
  /** world px: the design surface */
  w: number;
  h: number;
  /** screen px per world px */
  zoom: number;
  /** the frame's own label on screen */
  label: { left: number; top: number; height: number };
  /** the design surface on screen */
  body: { left: number; top: number; right: number; bottom: number };
  /** the slice of the page the window shows, in page px; null = none of it */
  visible: { from: number; to: number } | null;
}

/** The name the minimap gives a top-level child: its design name, label, first heading, id, or tag. */
export function sectionName(el: Element): string {
  const named = el.getAttribute('data-dc-element') || el.getAttribute('aria-label');
  if (named) return named;
  const heading = el.querySelector('h1, h2, h3, h4')?.textContent?.replace(/\s+/g, ' ').trim();
  if (heading) return heading.length > 28 ? `${heading.slice(0, 27)}…` : heading;
  return el.getAttribute('data-cd-id') || el.id || el.tagName.toLowerCase();
}

/** Every artboard in `doc` whose design surface is a long page, with where it is on screen. */
export function measureLongPages(doc: Document, win: Window = window): LongPage[] {
  const out: LongPage[] = [];
  for (const article of Array.from(doc.querySelectorAll<HTMLElement>('[data-dc-screen]'))) {
    const body = article.querySelector<HTMLElement>(':scope > .dc-artboard-body');
    if (!body || !isLongPage(body.offsetHeight) || !body.offsetWidth) continue;
    const br = body.getBoundingClientRect();
    const zoom = br.width / body.offsetWidth || 1;
    const labelEl = article.querySelector<HTMLElement>(':scope > .dc-artboard-label');
    const lr = labelEl?.getBoundingClientRect();
    const labelText = (labelEl?.textContent ?? '').replace(/\s+/g, ' ').trim();
    out.push({
      id: article.getAttribute('data-dc-screen') ?? '',
      name:
        labelText.replace(/\d+ × \d+$/, '').trim() ||
        (article.getAttribute('data-dc-screen') ?? ''),
      w: body.offsetWidth,
      h: body.offsetHeight,
      zoom,
      label: { left: lr?.left ?? br.left, top: lr?.top ?? br.top, height: lr?.height ?? 20 },
      body: { left: br.left, top: br.top, right: br.right, bottom: br.bottom },
      visible: visibleRange(br.top, zoom, win.innerHeight, body.offsetHeight),
    });
  }
  return out;
}

/** The page the window is inside: the long page showing the most of the window; null when none shows. */
export function pageInView(pages: readonly LongPage[]): LongPage | null {
  let best: LongPage | null = null;
  let bestSpan = 0;
  for (const p of pages) {
    const span = p.visible ? (p.visible.to - p.visible.from) * p.zoom : 0;
    if (span > bestSpan) {
      best = p;
      bestSpan = span;
    }
  }
  return best;
}

/** A page's sections: its top-level children with a real height, named, in page order (page px). */
export function pageSections(doc: Document, id: string): PageSection[] {
  let body: HTMLElement | null = null;
  try {
    body = doc.querySelector<HTMLElement>(
      `[data-dc-screen="${CSS.escape(id)}"] > .dc-artboard-body`
    );
  } catch {
    return [];
  }
  if (!body || !body.offsetWidth) return [];
  const br = body.getBoundingClientRect();
  const zoom = br.width / body.offsetWidth || 1;
  const nodes: SectionNode[] = Array.from(body.children).map((c) => {
    const r = c.getBoundingClientRect();
    const cs = body.ownerDocument.defaultView?.getComputedStyle(c);
    return {
      name: sectionName(c),
      top: (r.top - br.top) / zoom,
      height: r.height / zoom,
      hidden: cs?.display === 'none' || c.hasAttribute('data-cd-hidden'),
    };
  });
  return sectionsOf(nodes);
}
