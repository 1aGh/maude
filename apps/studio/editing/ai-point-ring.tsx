// editing/ai-point-ring.tsx — S5.19 G3 (03 AI Chat `ai-question`): "AI points at the spot it means with a small
// spark ring, gone when you click". An AI question about an element is answered in the chat; the canvas does
// not change, so the ring is the only mark the answer leaves on the page.
//
// The rows are the shell's `ai-holds` with `point: true` (v2/ai/runs-model.js `pointsFor`): the element it was
// asked about and a tag that is that element's NAME only — never a word of the prompt or of the answer, the
// canvas being the untrusted side (DDR-054, decision v2-lead-neutral-ai-ring-tags). HoldRings (hold-rings.tsx)
// and the scope outline (ai-scope-outline.tsx) skip these rows.
//
// A click anywhere on the canvas puts the ring away; it comes back only if the shell sends a different spot.
// Decorative: aria-hidden, pointer-events none.

import { useEffect, useRef, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';

export interface PointRow {
  artboard: string;
  element: string;
  occurrence?: number;
  tag: string;
  point?: boolean;
}

/** The rows that are spots the AI points at. */
export const pointRowsOf = (holds: readonly PointRow[]): PointRow[] => holds.filter((h) => h.point);

const rowKey = (r: PointRow) => `${r.artboard}\u0000${r.element}\u0000${r.occurrence ?? 0}`;

function elementOf(doc: Document, r: PointRow): Element | null {
  try {
    const screen = doc.querySelector(`[data-dc-screen="${CSS.escape(r.artboard)}"]`);
    const all = screen?.querySelectorAll(`[data-cd-id="${CSS.escape(r.element)}"]`);
    return all?.[r.occurrence ?? 0] ?? all?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * 03 `ai-question` — the chip on the ring says what the spot IS, not its id: a text spot on a print artboard reads
 * its own size in points ("9 pt", 1 pt = 4/3 px), the unit print speaks. Anything else (a digital artboard, a spot
 * with no text of its own, an element not on screen) keeps the shell's tag — the spot's NAME. Read from the
 * element itself on this side; nothing the person asked or the agent answered is involved (DDR-054).
 */
export function pointChipText(el: Element | null, name: string): string {
  try {
    if (!el) return name;
    const kind = el.closest('[data-dc-kind]')?.getAttribute('data-dc-kind');
    const hasText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== ''
    );
    if (kind !== 'print' || !hasText) return name;
    const px = Number.parseFloat(el.ownerDocument.defaultView?.getComputedStyle(el).fontSize ?? '');
    if (!Number.isFinite(px) || px <= 0) return name;
    return `${Math.round(px * 0.75)} pt`;
  } catch {
    return name;
  }
}

const PAD = 3;

const CSS_TEXT = `
.ed-ai-point-layer { --ed-point-spark: oklch(0.66 0.2 36); --ed-point-muted: oklch(0.66 0.2 36 / 0.12); --ed-point-fg: oklch(0.2 0.03 36); }
@media (prefers-color-scheme: dark) { .ed-ai-point-layer { --ed-point-spark: oklch(0.7 0.185 38); --ed-point-muted: oklch(0.7 0.185 38 / 0.18); } }
.ed-ai-point { position: fixed; z-index: 6; display: none; box-sizing: border-box; pointer-events: none; border-radius: 4px;
  border: 1.5px solid var(--ed-point-spark); box-shadow: 0 0 0 3px var(--ed-point-muted); }
.ed-ai-point-tag { position: absolute; left: calc(100% + 4px); top: 50%; translate: 0 -50%; display: inline-flex; align-items: center; gap: 2px;
  padding: 1px 6px 1px 4px; border-radius: 999px; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis;
  background: var(--ed-point-spark); color: var(--ed-point-fg); font: 600 11px/16px ui-rounded, system-ui, -apple-system, sans-serif; }
`;

export function AiPointRings(): null | React.JSX.Element {
  const [rows, setRows] = useState<PointRow[]>([]);
  const [away, setAway] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const shownKey = rows.map(rowKey).join('|');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: unknown } | null)?.dgn !== 'ai-holds') return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'ai-holds') return;
      const next = pointRowsOf(m.holds as PointRow[]);
      setRows(next);
      // a different spot is news again; the same one stays put away
      setAway((a) => (a === next.map(rowKey).join('|') ? a : null));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // gone when you click
  useEffect(() => {
    if (!rows.length || typeof window === 'undefined') return;
    const onDown = () => setAway(shownKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [rows.length, shownKey]);

  const visible = rows.length > 0 && away !== shownKey;

  // follow the elements through pan / zoom / re-render
  useEffect(() => {
    if (!visible || typeof document === 'undefined') return;
    let raf: number | null = null;
    const tick = () => {
      const root = rootRef.current;
      if (root) {
        const rings = Array.from(root.querySelectorAll<HTMLElement>('.ed-ai-point'));
        rings.forEach((ring, i) => {
          const el = rows[i] ? elementOf(document, rows[i]) : null;
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
  }, [visible, rows]);

  if (!visible) return null;
  const chips = rows.map((r) => (r.tag ? pointChipText(elementOf(document, r), r.tag) : ''));
  return (
    <div ref={rootRef} className="ed-ai-point-layer" aria-hidden="true">
      <style>{CSS_TEXT}</style>
      {rows.map((r, i) => (
        <div key={rowKey(r)} className="ed-ai-point" data-testid="edit-ai-point">
          {chips[i] ? (
            <span className="ed-ai-point-tag">
              <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"
                  fill="currentColor"
                />
              </svg>
              {chips[i]}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
