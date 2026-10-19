// editing/paste-bar.tsx — a copy from Figma arrives as Figma's exact picture, with a bar under it (S2.15; artboard ed-edge-paste).
//
//   Paste     ⌘V with a Figma copy on the clipboard (editing/figma-paste.ts recognises it) is claimed here, ahead of the
//             annotation layer's media intake, so Figma's HTML never lands as text. If the clipboard also holds a picture
//             (Copy as PNG, ⇧⌘C) it is imported through the asset import and placed with `image.place` — one edit-op, one
//             undo step — carrying `data-source="figma"` (+ the frame's name when Figma says it).
//   The bar   "Pasted from Figma as an image of “Hero / v3”." under the picture. "Make editable" is NOT offered until
//             S8.17's Figma import lands (`MAKE_EDITABLE_READY`, below): it would promise layers nobody can build yet.
//   No picture   Figma sent layers and no picture: nothing is pasted, the bar says so and offers "Paste as picture", which
//             asks the clipboard again for an image (a permission the page may not have — then it says what to do).
//
// Never claims text stays editable on import (CONTRACT: figma-arrives-as-an-exact-picture). Esc or any other selection
// closes the bar.

import { useCallback, useEffect, useRef, useState } from 'react';

import { uploadAsset } from '../asset-upload.ts';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { ElementRef } from '../edit-ops/types.ts';
import { isEditableTarget } from '../input-router.tsx';
import { isEmbedCanvas, isReadOnlyCanvas } from '../read-only-mode.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { elementOfRef } from './crop-mode.tsx';
import type { EditOpAsk } from './edit-op.ts';
import {
  AS_PICTURE_VERB,
  COPY_AS_PNG_LINE,
  type FigmaPaste,
  NO_PICTURE_LINE,
  parseFigmaPaste,
  pastedLine,
} from './figma-paste.ts';
import { PLACE_ACTION, runDrop } from './image-drop.tsx';
import { selectWhenRendered } from './object-actions.ts';
import { refsOf } from './object-ops.ts';

/**
 * Make editable converts one pasted frame into layers. It needs S8.17 (`/_api/figma/*`, Figma Dev Mode on a paid seat),
 * which is not built yet, so the bar offers only "Paste as picture". S8.17 flips this with the registry action
 * `figma.make-editable` becoming visible; the button below then runs it.
 */
export const MAKE_EDITABLE_READY = false;

export const OUTSIDE_LINE = 'Click inside an artboard to paste there.';

/** The first picture a clipboard holds as a file or an item. */
export function imageFromClipboard(cd: DataTransfer | null | undefined): File | null {
  if (!cd) return null;
  for (const f of Array.from(cd.files ?? [])) if (f.type.startsWith('image/')) return f;
  for (const it of Array.from(cd.items ?? [])) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

export interface PasteTarget {
  targets: ElementRef[];
  artboard: string | null;
}

/** Where a pasted picture goes: the selected frame, the selected artboard, or the artboard under the middle of the view. */
export function pasteTarget(
  selected: readonly Selection[],
  doc: Document = document
): PasteTarget | null {
  if (selected.length === 1) {
    const ref = refsOf(selected)[0];
    if (ref) {
      // a picture cannot hold one: it goes to its artboard
      const el = elementOfRef(ref, doc);
      return el?.tagName === 'IMG'
        ? { targets: [], artboard: ref.artboard }
        : { targets: [ref], artboard: ref.artboard };
    }
    const board = (selected[0] as Selection).artboardId;
    if (board) return { targets: [], artboard: board };
  }
  const hit = doc.elementsFromPoint?.(window.innerWidth / 2, window.innerHeight / 2) ?? [];
  for (const h of hit) {
    const a = h.closest?.('[data-dc-screen]')?.getAttribute('data-dc-screen');
    if (a) return { targets: [], artboard: a };
  }
  const first = doc.querySelector('[data-dc-screen]')?.getAttribute('data-dc-screen');
  return first ? { targets: [], artboard: first } : null;
}

/** The `image.place` ask for a pasted picture. */
export function askForPaste(
  asset: string,
  paste: FigmaPaste,
  target: PasteTarget,
  natural: { w: number; h: number } | null
): EditOpAsk {
  const params: Record<string, unknown> = {
    asset,
    mode: 'loose',
    from: paste.name ? { name: paste.name } : {},
  };
  if (target.artboard) params.artboard = target.artboard;
  if (natural) params.natural = natural;
  return { op: PLACE_ACTION, targets: target.targets, params };
}

async function naturalSizeOf(file: Blob): Promise<{ w: number; h: number } | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null;
    const bmp = await createImageBitmap(file);
    const out = { w: bmp.width, h: bmp.height };
    bmp.close?.();
    return out.w > 0 && out.h > 0 ? out : null;
  } catch {
    return null;
  }
}

const CSS_TEXT = `
.ed-pastebar {
  position: fixed;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-radius: 10px;
  background: var(--bg-3, #222);
  color: var(--fg-0, #fff);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  font: 500 12px/16px var(--maude-chrome-font, system-ui, sans-serif);
  white-space: nowrap;
}
.ed-pastebar button {
  font: inherit;
  padding: 3px 10px;
  border: 0;
  border-radius: 7px;
  background: var(--maude-hud-accent, #4a7bff);
  color: var(--maude-hud-accent-fg, #fff);
  cursor: pointer;
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-pastebar-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-pastebar-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

type Bar =
  | { kind: 'placed'; line: string; ref: ElementRef }
  | { kind: 'layers'; paste: FigmaPaste };

export function PasteBar({ readOnly }: { readOnly?: boolean }) {
  ensureStyles();
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const tm = useToolModeOptional();
  const live = useRef({ selSet, undo });
  live.current = { selSet, undo };
  const [bar, setBar] = useState<Bar | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const editChrome = (!tm || tm.mode === 'edit') && !isEmbedCanvas();

  const place = useCallback(async (file: Blob, paste: FigmaPaste) => {
    const target = pasteTarget(live.current.selSet.selected);
    if (!target) return void showCanvasToast(OUTSIDE_LINE, 'info');
    const up = await uploadAsset(file);
    if (!('path' in up)) {
      showCanvasToast(
        `Nothing pasted — ${up.error || 'that picture could not be brought in'}.`,
        'error'
      );
      return;
    }
    const natural = await naturalSizeOf(file);
    const result = await runDrop(askForPaste(up.path, paste, target, natural), {
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => live.current.undo?.record(rec),
      select: (refs) => selectWhenRendered(refs, (s) => live.current.selSet.replace(s)),
    });
    const made = result.ok ? result.created?.[0] : undefined;
    if (made) setBar({ kind: 'placed', line: pastedLine(paste.name), ref: made });
  }, []);

  // the paste itself — claimed ahead of the media intake and the board's own paste
  useEffect(() => {
    if (typeof document === 'undefined' || readOnly || !editChrome) return undefined;
    const onPaste = (e: ClipboardEvent) => {
      if (isReadOnlyCanvas() || isEditableTarget(e.target)) return;
      const paste = parseFigmaPaste(e.clipboardData?.getData('text/html'));
      if (!paste) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const file = imageFromClipboard(e.clipboardData);
      if (file) void place(file, paste);
      else setBar({ kind: 'layers', paste });
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [readOnly, editChrome, place]);

  const asPicture = useCallback(
    async (paste: FigmaPaste) => {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            setBar(null);
            return void (await place(blob, paste));
          }
        }
      } catch {
        /* no permission, or no clipboard API in this frame — say what to do below */
      }
      showCanvasToast(COPY_AS_PNG_LINE, 'info');
    },
    [place]
  );

  // esc closes it; so does selecting something else
  const placedRef = bar?.kind === 'placed' ? bar.ref : null;
  useEffect(() => {
    if (!bar) return undefined;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBar(null);
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [bar]);
  const selectedKey = JSON.stringify(refsOf(selSet.selected));
  useEffect(() => {
    if (!placedRef) return;
    const mine = JSON.stringify([placedRef]);
    if (selectedKey !== mine && selectedKey !== '[]') setBar(null);
  }, [placedRef, selectedKey]);

  // under the picture, following it while the view moves
  useEffect(() => {
    if (!placedRef) {
      setAt(null);
      return undefined;
    }
    let raf = 0;
    const tick = () => {
      const el = elementOfRef(placedRef);
      if (el) {
        const r = el.getBoundingClientRect();
        setAt((a) =>
          a && a.left === r.left && a.top === r.bottom + 14
            ? a
            : { left: r.left, top: r.bottom + 14 }
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [placedRef]);

  if (!bar) return null;
  if (bar.kind === 'layers') {
    return (
      <div
        className="ed-pastebar"
        data-testid="edit-paste-bar"
        data-state="layers"
        role="status"
        style={{ left: '50%', bottom: 96, transform: 'translateX(-50%)' }}
      >
        <span>{NO_PICTURE_LINE}</span>
        <button
          type="button"
          data-testid="edit-paste-as-picture"
          onClick={() => void asPicture(bar.paste)}
        >
          {AS_PICTURE_VERB}
        </button>
      </div>
    );
  }
  if (!at) return null;
  return (
    <div
      className="ed-pastebar"
      data-testid="edit-paste-bar"
      data-state="placed"
      role="status"
      style={{ left: at.left, top: at.top }}
    >
      <span>{bar.line}</span>
      {MAKE_EDITABLE_READY ? (
        <button type="button" data-testid="edit-paste-make-editable">
          Make editable
        </button>
      ) : null}
    </div>
  );
}
