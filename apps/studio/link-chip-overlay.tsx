// link-chip-overlay.tsx — the link chip (S3.10a; S3-links-format §5 "Chip", canvas md-edit).
//
// In Edit, while exactly ONE element is selected and it carries `data-cd-link`, a small read-only chip sits
// at its top-right and says where a click goes: "Go to Pricing" · "Go to Desktop" · "Opens cal.com/studio".
// The words come from the attribute (`parseLinkTarget` + `linkLabel`) and the artboard labels the canvas
// already has in its DOM. It never fetches (the inspector's On click row asks `/_api/links` for the real
// state), never writes, never takes the pointer. Preview, Viewing and Present never show it.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import { linkLabel, parseLinkTarget } from './bridge/link-target.ts';
import { resolveSelectionEl } from './dom-selection.ts';
import { type Selection, useSelectionSet } from './use-selection-set.tsx';

const LINK_ATTR = 'data-cd-link';

/** What the chip says for a `data-cd-link` value, or null when there is nothing to say (no link, or one the
 *  grammar refuses: an invalid value is never read out as a place). `artboardLabel` is the canvas's own name
 *  for an artboard id. */
export function linkChipWords(
  raw: string | null | undefined,
  artboardLabel?: (id: string) => string | undefined
): string | null {
  const t = parseLinkTarget(raw);
  if (!t) return null;
  return linkLabel(t, t.kind === 'artboard' ? { artboard: artboardLabel?.(t.artboard) } : {});
}

/** The visible label of an artboard in this document (its header text), or undefined. */
export function artboardLabelIn(doc: Document, id: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return undefined; // the id grammar: safe in a selector
  const head = doc.querySelector(`[data-dc-screen="${id}"] .dc-artboard-label`);
  const text = head?.textContent?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

/** The element and raw link when the selection is exactly one element that carries `data-cd-link`. */
export function linkedSelection(
  doc: Document,
  selected: readonly Selection[]
): { el: Element; raw: string } | null {
  if (selected.length !== 1 || !selected[0]) return null;
  const el = resolveSelectionEl(doc, selected[0]);
  const raw = el?.getAttribute(LINK_ATTR);
  return el && raw ? { el, raw } : null;
}

const CSS_TEXT = `
.ed-linkchip {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
  font: 500 11px/16px var(--maude-chrome-font-mono);
  transform: translate(-100%, calc(-100% - 4px));
}
`;

/** Edit, or an ungoverned canvas (no shell yet): the only places the chip may show. */
function useEditing(): boolean {
  const store = typeof window === 'undefined' ? null : canvasModeStore(window);
  const mode = useSyncExternalStore(
    (cb) => (store ? store.subscribe(cb) : () => {}),
    () => store?.get().mode ?? null,
    () => null
  );
  return mode === null || mode === 'edit';
}

export function LinkChipOverlay() {
  const { selected } = useSelectionSet();
  const editing = useEditing();
  const [chip, setChip] = useState<{ words: string; left: number; top: number } | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!editing || selected.length !== 1 || typeof document === 'undefined') {
      setChip(null);
      return;
    }
    // Follow the element every frame (pan, zoom, drag), as the selection halos do; setState only on change.
    const tick = () => {
      const hit = linkedSelection(document, selected);
      const words = hit ? linkChipWords(hit.raw, (id) => artboardLabelIn(document, id)) : null;
      if (!hit || !words) {
        setChip((c) => (c ? null : c));
      } else {
        const r = hit.el.getBoundingClientRect();
        const left = Math.round(r.right);
        const top = Math.round(r.top);
        setChip((c) =>
          c && c.words === words && c.left === left && c.top === top ? c : { words, left, top }
        );
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [editing, selected]);

  if (!chip || !editing) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <span
        className="ed-linkchip"
        data-testid="edit-link-chip"
        role="status"
        style={{ left: chip.left, top: chip.top }}
      >
        {chip.words}
      </span>
    </>
  );
}
