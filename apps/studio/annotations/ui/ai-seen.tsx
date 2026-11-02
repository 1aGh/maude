// annotations/ui/ai-seen.tsx — S4.15 (15 Annotations `an-ai-read`): "AI outlines what the stickies mean".
//
// While the AI chat's "Make these changes" card is the latest message, the shell posts `ai-seen { targets }`
// (s2c) and this draws a dashed spark outline round each target with a tag ("✦ The hero picture"). The
// outline goes when the card is answered or the chat moves on: the shell sends `[]`.
//
// The tag is built by the SHELL from the ref alone (the element's name); the agent's answer never reaches this
// side — the canvas is the untrusted one (DDR-054, decision v2-lead-neutral-ai-ring-tags). A target that does
// not resolve on this canvas draws nothing. Decorative: aria-hidden, no pointer events, follows pan / zoom.
//
// `ref`: `ab:<artboard>` (the whole artboard) | `el:<artboard>/<id>` (an element, by data-cd-id).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { acceptFromShell } from '../../bridge/dgn-protocol.ts';

export interface SeenTarget {
  ref: string;
  tag: string;
}

/** The DOM node a target ref means, or null when this canvas has no such artboard / element. */
export function seenElementOf(doc: Document, ref: string): Element | null {
  try {
    const ab = /^ab:(.+)$/.exec(ref);
    if (ab) return doc.querySelector(`[data-dc-screen="${CSS.escape(ab[1])}"]`);
    const el = /^el:([^/]+)\/(.+)$/.exec(ref);
    if (!el) return null;
    const screen = doc.querySelector(`[data-dc-screen="${CSS.escape(el[1])}"]`);
    return screen?.querySelector(`[data-cd-id="${CSS.escape(el[2])}"]`) ?? null;
  } catch {
    return null;
  }
}

const PAD = 6;

export const AI_SEEN_CSS = `
.dc-ai-seen-layer { --dc-seen-spark: oklch(0.66 0.2 36); --dc-seen-fg: oklch(0.2 0.03 36); }
@media (prefers-color-scheme: dark) { .dc-ai-seen-layer { --dc-seen-spark: oklch(0.7 0.185 38); } }
.dc-ai-seen { position: fixed; z-index: 6; display: none; box-sizing: border-box; pointer-events: none; border-radius: 6px;
  outline: 1.5px dashed var(--dc-seen-spark); }
.dc-ai-seen-tag { position: absolute; right: 0; top: calc(100% + 6px); display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 999px; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;
  background: var(--dc-seen-spark); color: var(--dc-seen-fg); font: 600 11px/16px ui-rounded, system-ui, -apple-system, sans-serif; }
`;

export function AiSeenRings(): null | React.JSX.Element {
  const [targets, setTargets] = useState<SeenTarget[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: unknown } | null)?.dgn !== 'ai-seen') return;
      const m = acceptFromShell(e, window);
      if (m?.dgn === 'ai-seen') setTargets(m.targets);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // follow the targets through pan / zoom / re-render
  useEffect(() => {
    if (!targets.length || typeof document === 'undefined') return;
    let raf: number | null = null;
    const tick = () => {
      const root = rootRef.current;
      if (root) {
        const rings = Array.from(root.querySelectorAll<HTMLElement>('.dc-ai-seen'));
        rings.forEach((ring, i) => {
          const el = targets[i] ? seenElementOf(document, targets[i].ref) : null;
          const r = el?.isConnected ? el.getBoundingClientRect() : null;
          if (!r || (r.width === 0 && r.height === 0)) {
            ring.style.display = 'none';
            return;
          }
          ring.style.display = 'block';
          ring.style.left = `${Math.round(r.left - PAD)}px`;
          ring.style.top = `${Math.round(r.top - PAD)}px`;
          ring.style.width = `${Math.round(r.width + PAD * 2)}px`;
          ring.style.height = `${Math.round(r.height + PAD * 2)}px`;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [targets]);

  if (!targets.length || typeof document === 'undefined') return null;
  // Fixed positions need an untransformed parent: the world is zoomed, so the rings live on <body>.
  return createPortal(
    <div ref={rootRef} className="dc-ai-seen-layer" aria-hidden="true" data-testid="ai-seen">
      <style>{AI_SEEN_CSS}</style>
      {targets.map((t) => (
        <div key={t.ref} className="dc-ai-seen" data-testid="ai-seen-ring">
          {t.tag ? (
            <span className="dc-ai-seen-tag">
              <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"
                  fill="currentColor"
                />
              </svg>
              {t.tag}
            </span>
          ) : null}
        </div>
      ))}
    </div>,
    document.body
  );
}
