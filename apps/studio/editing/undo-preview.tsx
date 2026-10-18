// editing/undo-preview.tsx — S2.20: pointing at an Undo history row lights what it would undo
// (14 `ed-edge-undo`: the area outlined, tagged "Would undo · 14 changes").
//
// The shell owns the history (client/v2/undo/undo-history.jsx) and sends
// `{ dgn: 'undo-preview', artboards, tag }` to the ACTIVE canvas only, from window.parent
// (`acceptFromShell`, gate parent). An empty list clears it. This draws outlines over the named
// artboards (`[data-dc-screen="<id>"]`), follows them while the camera moves, and never writes.

import { useEffect, useRef, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';

type Lit = { id: string; left: number; top: number; width: number; height: number };

const CSS_TEXT = `
.ed-undo-outline {
  position: fixed;
  pointer-events: none;
  z-index: 5;
  box-sizing: border-box;
  border: 2px solid var(--maude-hud-accent);
  border-radius: 3px;
}
.ed-undo-tag {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
  font: 500 11px/16px var(--maude-chrome-font-mono);
  white-space: nowrap;
  transform: translateY(calc(-100% - 4px));
}
`;

/** The artboards' viewport boxes (missing ids are skipped). */
export function litRects(doc: Document, ids: readonly string[]): Lit[] {
  const out: Lit[] = [];
  for (const id of ids) {
    const el = doc.querySelector(`[data-dc-screen="${CSS.escape(id)}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out.push({ id, left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return out;
}

export function UndoPreview() {
  const [want, setWant] = useState<{ artboards: string[]; tag: string | null } | null>(null);
  const [lit, setLit] = useState<Lit[]>([]);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (
        e.source !== window.parent ||
        (e.data as { dgn?: unknown } | null)?.dgn !== 'undo-preview'
      )
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'undo-preview') return;
      setWant(m.artboards.length ? { artboards: m.artboards.slice(0, 200), tag: m.tag } : null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Follow the artboards while lit (pan / zoom move them); stop when cleared.
  useEffect(() => {
    if (!want) {
      setLit([]);
      return;
    }
    let last = '';
    const tick = () => {
      const next = litRects(document, want.artboards);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setLit(next); // only when a box moved — a still camera re-renders nothing
      }
      raf.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [want]);

  if (!want || lit.length === 0) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      {lit.map((r, i) => (
        <div
          key={r.id}
          className="ed-undo-outline"
          data-testid="edit-undo-preview"
          data-artboard={r.id}
          aria-hidden="true"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        >
          {i === 0 && want.tag ? (
            <span
              className="ed-undo-tag"
              data-testid="edit-undo-preview-tag"
              style={{ left: r.left, top: r.top }}
            >
              {want.tag}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}
