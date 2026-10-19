// editing/ai-scope-outline.tsx — the AI outline over a ⌘/ ask (S2.19; artboard `ed-edge-ask`).
//
// While an AI run works on the elements a person ASKED about, ONE spark-dashed outline sits around the whole
// selection (not the page) with a neutral tag — "AI is working on 3 elements" — and a skeleton line where each
// element's change will land. The rest of the page is the person's: nothing here blocks it.
//
// The rows are the shell's `ai-holds` with `scope: true` (v2/ai/runs-model.js `holdsFor`): a fixed tag from the
// run's state and a count, never the prompt (DDR-054). HoldRings (hold-rings.tsx) draws the other rows and
// skips these. While the outline is up it tells the shell where it is (`ask-selection-rect`) so the asked
// bubble follows pan and zoom; when it goes, it says `null` once.

import { useEffect, useRef, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { unionRect } from './ask-bubble.tsx';

export interface ScopeRow {
  artboard: string;
  element: string;
  occurrence?: number;
  tag: string;
  mine: boolean;
  scope?: boolean;
}

/** The rows a ⌘/ ask holds, and the one tag they share. */
export function scopeRowsOf(holds: readonly ScopeRow[]): { rows: ScopeRow[]; tag: string } {
  const rows = holds.filter((h) => h.scope);
  return { rows, tag: rows[0]?.tag ?? '' };
}

function elementOf(doc: Document, r: ScopeRow): Element | null {
  try {
    const screen = doc.querySelector(`[data-dc-screen="${CSS.escape(r.artboard)}"]`);
    const all = screen?.querySelectorAll(`[data-cd-id="${CSS.escape(r.element)}"]`);
    return all?.[r.occurrence ?? 0] ?? all?.[0] ?? null;
  } catch {
    return null;
  }
}

const PAD = 8;

/** Where the outline is now (`null`: gone). A literal `{ dgn }` so the bridge inventory sees this send site. */
function tellShell(rect: { x: number; y: number; w: number; h: number } | null): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage({ dgn: 'ask-selection-rect', rect }, '*');
  } catch {
    /* detached */
  }
}

const CSS_TEXT = `
.ed-ai-scope-layer { --ed-scope-spark: oklch(0.66 0.2 36); --ed-scope-spark-fg: oklch(0.99 0.004 36); }
@media (prefers-color-scheme: dark) { .ed-ai-scope-layer { --ed-scope-spark: oklch(0.7 0.185 38); --ed-scope-spark-fg: oklch(0.2 0.03 36); } }
.ed-ai-scope, .ed-ai-skel { position: fixed; pointer-events: none; box-sizing: border-box; display: none; }
.ed-ai-scope { z-index: 5; border: 1.5px dashed var(--ed-scope-spark); border-radius: 6px; }
.ed-ai-scope-tag {
  position: absolute; right: -2px; bottom: calc(100% + 3px); display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 6px; border-radius: 3px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
  background: var(--ed-scope-spark); color: var(--ed-scope-spark-fg); font: 600 11px/16px system-ui, -apple-system, sans-serif;
}
.ed-ai-skel { z-index: 4; display: block; height: 8px; border-radius: 4px; background: var(--ed-scope-spark, oklch(0.66 0.2 36)); opacity: 0.22; animation: ed-ai-skel var(--dur-slow, 1200ms) ease-in-out infinite alternate; }
@keyframes ed-ai-skel { from { opacity: 0.12; } to { opacity: 0.32; } }
@media (prefers-reduced-motion: reduce) { .ed-ai-skel { animation-duration: 1ms; } }
`;

export function AiScopeOutline(): null | React.JSX.Element {
  const [rows, setRows] = useState<ScopeRow[]>([]);
  const [tag, setTag] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const told = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: unknown } | null)?.dgn !== 'ai-holds') return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'ai-holds') return;
      const next = scopeRowsOf(m.holds);
      setRows(next.rows);
      setTag(next.tag);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // follow the elements through pan / zoom / re-render; tell the shell where the outline is
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (!rows.length) {
      if (told.current !== null && told.current !== 'null') {
        told.current = 'null';
        tellShell(null);
      }
      return;
    }
    let raf: number | null = null;
    const tick = () => {
      const root = rootRef.current;
      const els = rows.map((r) => elementOf(document, r));
      const rects = els.flatMap((el) => (el?.isConnected ? [el.getBoundingClientRect()] : []));
      const box = unionRect(rects);
      if (root) {
        const out = root.querySelector<HTMLElement>('.ed-ai-scope');
        if (out) {
          if (!box) out.style.display = 'none';
          else {
            out.style.display = 'block';
            out.style.left = `${box.x - PAD}px`;
            out.style.top = `${box.y - PAD}px`;
            out.style.width = `${box.w + PAD * 2}px`;
            out.style.height = `${box.h + PAD * 2}px`;
          }
        }
        const skels = Array.from(root.querySelectorAll<HTMLElement>('.ed-ai-skel'));
        skels.forEach((s, i) => {
          const el = els[i];
          const r = el?.isConnected ? el.getBoundingClientRect() : null;
          if (!r || r.width < 24 || r.height < 24) {
            s.style.display = 'none';
            return;
          }
          s.style.display = 'block';
          s.style.left = `${Math.round(r.left + 16)}px`;
          s.style.top = `${Math.round(r.bottom - 24)}px`;
          s.style.width = `${Math.round(Math.min(r.width * 0.4, 160))}px`;
        });
      }
      const key = box ? `${box.x},${box.y},${box.w},${box.h}` : 'null';
      if (key !== told.current) {
        told.current = key;
        tellShell(box);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [rows]);

  if (!rows.length) return null;
  return (
    <div ref={rootRef} className="ed-ai-scope-layer" aria-hidden="true">
      <style>{CSS_TEXT}</style>
      <div className="ed-ai-scope" data-testid="edit-ai-scope">
        <span className="ed-ai-scope-tag">
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"
              fill="currentColor"
            />
          </svg>
          {tag}
        </span>
      </div>
      {rows.map((r) => (
        <div
          key={`${r.artboard}-${r.element}-${r.occurrence ?? 0}`}
          className="ed-ai-skel"
          data-testid="edit-ai-scope-skeleton"
        />
      ))}
    </div>
  );
}
