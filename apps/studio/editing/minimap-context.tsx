// editing/minimap-context.tsx — S2.8 (artboard ed-edge-huge): "a minimap appears while you work in it — click a
// section there to jump." The contextual minimap of a long page: the page as a strip of its sections, the part the
// window shows as a band, and the sections as a list. It appears only while the window is inside a page that is
// taller than the window (≥ 3000 px) and goes when the whole page is in view, so a normal canvas never sees it.
//
// A click on a section (list row or strip) pans the canvas so that section's top sits at the window's top, at the
// zoom you were at. "You're looking at 1727–5636 of 6000." is the same sentence the inspector's artboard shows.

import { type ReactNode, useEffect, useState } from 'react';

import { getLiveViewport, useViewportControllerContext } from '../canvas-lib.tsx';
import { jumpTarget, type PageSection, sectionAt, visibleSentence } from './artboard-resize.ts';
import { type LongPage, measureLongPages, pageInView, pageSections } from './long-page.ts';

export interface MiniModel {
  id: string;
  name: string;
  total: number;
  from: number;
  to: number;
  sections: PageSection[];
  /** the section the window's middle is over */
  lit: string | null;
}

/** The minimap's content, or null when it should not show (the whole page is in view, or no long page is). */
export function planMinimap(
  pages: readonly LongPage[],
  sectionsFor: (id: string) => PageSection[]
): MiniModel | null {
  const p = pageInView(pages);
  if (!p?.visible) return null;
  const { from, to } = p.visible;
  if (from <= 0 && to >= p.h) return null; // the whole page is on screen: nothing to navigate
  const sections = sectionsFor(p.id);
  const mid = sectionAt(sections, (from + to) / 2);
  return { id: p.id, name: p.name, total: p.h, from, to, sections, lit: mid?.name ?? null };
}

/** The strip is this tall; sections and the band are scaled into it. */
export const STRIP_H = 240;

const CSS_TEXT = `
.ed-mini {
  position: fixed;
  left: 16px;
  bottom: 72px;
  z-index: 10;
  width: 220px;
  padding: 10px;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--maude-chrome-bg-1);
  color: var(--maude-chrome-fg-0);
  border: 1px solid var(--maude-chrome-border);
  box-shadow: 0 4px 16px var(--maude-chrome-shadow);
  font: 500 11px/16px var(--maude-chrome-font-mono);
}
.ed-mini-t { margin: 0 0 8px; font-weight: 600; color: var(--maude-chrome-fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-mini-b { display: flex; gap: 12px; }
.ed-mini-page { position: relative; display: block; width: 58px; height: ${STRIP_H}px; flex: none; overflow: hidden; border-radius: 3px; background: var(--maude-chrome-bg-2); cursor: pointer; }
.ed-mini-page i { position: absolute; left: 5px; right: 5px; display: block; margin-top: 1px; border-radius: 2px; background: var(--maude-chrome-fg-1); opacity: 0.55; }
.ed-mini-page i[data-on] { background: var(--maude-hud-accent); opacity: 0.7; }
.ed-mini-page b { position: absolute; left: 0; right: 0; display: block; border-radius: 2px; background: var(--maude-hud-accent-tint); box-shadow: inset 0 0 0 1.5px var(--maude-hud-accent); pointer-events: none; }
.ed-mini-list { display: flex; flex-direction: column; flex: 1; min-width: 0; max-height: ${STRIP_H}px; overflow-y: auto; }
.ed-mini-list button { appearance: none; display: flex; align-items: center; height: 24px; flex: none; padding: 0 6px; border: 0; border-radius: 4px; background: none; color: var(--maude-chrome-fg-1); font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-mini-list button:hover { background: var(--maude-chrome-bg-2); }
.ed-mini-list button:focus-visible { outline: 2px solid var(--maude-hud-accent); outline-offset: -2px; }
.ed-mini-list button[data-on] { background: var(--maude-hud-accent-tint); color: var(--maude-hud-accent); font-weight: 600; }
.ed-mini-sentence { margin: 8px 0 0; color: var(--maude-chrome-fg-1); font-weight: 400; }
`;

/** Polls the canvas ~5×/s; draws the island only while there is a long page to navigate. */
export function MinimapContext({ pollMs = 200 }: { pollMs?: number }): ReactNode {
  const controller = useViewportControllerContext();
  const [model, setModel] = useState<MiniModel | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const run = () => {
      if (document.hidden) return;
      const next = planMinimap(measureLongPages(document), (id) => pageSections(document, id));
      setModel((prev) =>
        prev &&
        next &&
        prev.id === next.id &&
        prev.from === next.from &&
        prev.to === next.to &&
        prev.lit === next.lit &&
        prev.sections.length === next.sections.length
          ? prev
          : next
      );
    };
    run();
    const t = setInterval(run, pollMs);
    return () => clearInterval(t);
  }, [pollMs]);

  if (!model) return null;
  const k = STRIP_H / model.total;

  const jump = (y: number) => {
    if (!controller) return;
    const article = document.querySelector<HTMLElement>(
      `[data-dc-screen="${CSS.escape(model.id)}"]`
    );
    const bodyTopWorld = Number.parseFloat(article?.style.top ?? '') || 0;
    // the frame's label sits above the surface: the surface starts at the body's offset inside the frame
    const body = article?.querySelector<HTMLElement>(':scope > .dc-artboard-body');
    const surfaceTop = bodyTopWorld + (body?.offsetTop ?? 0) + (article?.clientTop ?? 0);
    controller.animateTo(jumpTarget(getLiveViewport() ?? controller.viewport, surfaceTop, y), 220);
  };

  return (
    <>
      <style>{CSS_TEXT}</style>
      <nav className="ed-mini" data-testid="ed-minimap" aria-label={`Sections of ${model.name}`}>
        <p className="ed-mini-t">{model.name}</p>
        <div className="ed-mini-b">
          <span
            className="ed-mini-page"
            data-testid="ed-minimap-strip"
            aria-hidden="true"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              jump(Math.max(0, Math.min(model.total, (e.clientY - r.top) / k)));
            }}
          >
            {model.sections.map((s) => (
              <i
                key={`${s.name}:${s.y}`}
                data-on={s.name === model.lit ? 'true' : undefined}
                style={{ top: s.y * k, height: Math.max(2, s.h * k - 2) }}
              />
            ))}
            <b
              data-testid="ed-minimap-band"
              style={{ top: model.from * k, height: Math.max(3, (model.to - model.from) * k) }}
            />
          </span>
          <span className="ed-mini-list">
            {model.sections.map((s) => (
              <button
                key={`${s.name}:${s.y}`}
                type="button"
                data-testid="ed-minimap-section"
                data-on={s.name === model.lit ? 'true' : undefined}
                onClick={() => jump(s.y)}
              >
                {s.name}
              </button>
            ))}
          </span>
        </div>
        <p className="ed-mini-sentence" data-testid="ed-minimap-sentence">
          {visibleSentence(model.from, model.to, model.total)}
        </p>
      </nav>
    </>
  );
}
