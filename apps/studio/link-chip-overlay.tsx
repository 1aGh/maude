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
import { modeShows } from './bridge/mode-shows.ts';
import { DsIcon } from './canvas-ds-icons.tsx';
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

/** The chip's height (04 `.md-linkchip`: a 26 px pill) and its distance from the element's right edge. */
const CHIP_H = 26;
const CHIP_GAP = 14;

const CSS_TEXT = `
.ed-linkchip {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  max-width: 280px;
  padding: 0 12px 0 8px;
  border-radius: 999px;
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
  font: 600 var(--maude-hud-type-xs, 11px)/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  white-space: nowrap;
}
.ed-linkchip > span { overflow: hidden; text-overflow: ellipsis; }
.ed-linkchip > svg { flex: none; }
/* 04 .md-link--h: the dashed run from the element to its chip */
.ed-linkline {
  position: fixed;
  pointer-events: none;
  z-index: 5;
  height: 0;
  border-top: 1.5px dashed var(--maude-hud-accent);
}
`;

/**
 * S3.15 (md-edit) — where the chip sits: to the RIGHT of the selection, centred on it, joined by a dashed
 * link (the canvas draws it so). The selection's name/size tag lives above the top edge, so the chip's old
 * place (right-aligned above the corner) landed on it by up to 53 px.
 */
export function linkChipPosition(r: { right: number; top: number; height: number }): {
  left: number;
  top: number;
} {
  return {
    left: Math.round(r.right + CHIP_GAP),
    top: Math.round(r.top + r.height / 2 - CHIP_H / 2),
  };
}

/** Edit, or an ungoverned canvas (no shell yet): the only places the chip may show. */
function useEditing(): boolean {
  const store = typeof window === 'undefined' ? null : canvasModeStore(window);
  const mode = useSyncExternalStore(
    (cb) => (store ? store.subscribe(cb) : () => {}),
    () => store?.get().mode ?? null,
    () => null
  );
  return modeShows(mode, 'object-tools');
}

export function LinkChipOverlay() {
  const { selected } = useSelectionSet();
  const editing = useEditing();
  const [chip, setChip] = useState<{
    words: string;
    left: number;
    top: number;
    from: number;
  } | null>(null);
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
        const { left, top } = linkChipPosition(r);
        const from = Math.round(r.right);
        setChip((c) =>
          c && c.words === words && c.left === left && c.top === top && c.from === from
            ? c
            : { words, left, top, from }
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
        className="ed-linkline"
        aria-hidden="true"
        style={{
          left: chip.from,
          top: chip.top + CHIP_H / 2,
          width: Math.max(0, chip.left - chip.from),
        }}
      />
      <span
        className="ed-linkchip"
        data-testid="edit-link-chip"
        role="status"
        style={{ left: chip.left, top: chip.top }}
      >
        <DsIcon name="link" size={13} />
        <span>{chip.words}</span>
      </span>
    </>
  );
}
