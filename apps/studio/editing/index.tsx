// editing/index.tsx — THE editing mount (S2.1; decision maude/v2-S2-editing-mount).
//
// canvas-shell.tsx mounts `<EditingLayer />` once, inside CanvasRouter's providers. Each S2 slice
// adds its own `editing/<area>.tsx` and ONE line below (append-only), so slices add files, not hunks
// in canvas-shell.tsx. The layer also answers the shell's `run-action` for the editing actions that
// have no chord to replay (⌘K / menus): `object.enter`, `object.step-out`.

import { useEffect, useRef } from 'react';

import { canvasModeStore, canvasSingleKeys } from '../bridge/canvas-mode-store.ts';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { isEditableTarget } from '../input-router.tsx';
import { isEmbedCanvas, isReadOnlyCanvas } from '../read-only-mode.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { ArtboardHandles } from './artboard-handles.tsx';
import { EmptyArtboardReporter } from './empty-reporter.tsx';
import { LockBadge } from './lock-badge.tsx';
import { MinimapContext } from './minimap-context.tsx';
import { NudgeReadout } from './nudge.tsx';
import { useObjectOps } from './object-actions.ts';
import { resolveObjectKey } from './object-keys.ts';
import { isObjectOpAction, layerParams, OBJECT_OP_ACTIONS, refsOf } from './object-ops.ts';
import { EditingSelection, enterSelection, stepOut } from './selection.tsx';
import { StickyName } from './sticky-name.tsx';

/** S2.8 — the shell asks the canvas to pin an artboard's theme; canvas-shell listens (it owns the pins). */
export const SET_ARTBOARD_THEME_EVENT = 'maude:set-artboard-theme';

/** Registry ids this layer runs when the shell asks (`dgn:'run-action'`). */
export const EDITING_ACTIONS = ['object.enter', 'object.step-out', ...OBJECT_OP_ACTIONS] as const;

export function EditingLayer() {
  const selSet = useSelectionSet();
  const ops = useObjectOps();
  const opsRef = useRef(ops);
  opsRef.current = ops;
  const tool = useToolModeOptional()?.tool;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const selRef = useRef(selSet.selected);
  selRef.current = selSet.selected;
  // the long-page helpers are Edit chrome: Preview, Present and an embedded view show the page, not its minimap
  const toolMode = useToolModeOptional();
  const editChrome = (!toolMode || toolMode.mode === 'edit') && !isEmbedCanvas();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'run-action')
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'run-action') return;
      if (isObjectOpAction(m.id)) {
        // a Layers row names its own target (and the value) in `params`; a chord / menu / ⌘K uses the selection
        if (!isReadOnlyCanvas()) {
          const { refs, params } = layerParams(m.params);
          void opsRef.current.run(m.id, refs, params);
        }
      } else if (m.id === 'object.step-out') {
        if (!stepOut(selSet)) selSet.clear();
      } else if (m.id === 'artboard.set-theme') {
        // S2.8 — Inspector › Advanced › Theme; canvas-shell owns the pin (the artboard menu's Theme submenu)
        const p = m.params as { artboard?: unknown; mode?: unknown } | undefined;
        if (typeof p?.artboard === 'string' && typeof p.mode === 'string')
          window.dispatchEvent(
            new CustomEvent(SET_ARTBOARD_THEME_EVENT, {
              detail: { artboard: p.artboard, mode: p.mode },
            })
          );
      } else if (m.id === 'object.enter') {
        const one = selSet.selected.length === 1 ? selSet.selected[0] : null;
        const next = one ? enterSelection(document, one) : null;
        if (next) selSet.replace(next);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selSet]);

  // S2.6 — the object chords (⌥⌘G ⇧⌘G ⌘] ] [ ⌘[ ⇧⌘L), resolved through the registry in Edit mode.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isReadOnlyCanvas() || toolRef.current === 'browse') return;
      const governed = canvasModeStore(window).get().mode;
      const action = resolveObjectKey(e, {
        typing: isEditableTarget(e.target),
        mode: governed ?? 'edit',
        selection: refsOf(selRef.current).length > 0 ? 'object' : 'none',
        singleKeys: canvasSingleKeys(),
      });
      if (!action) return;
      e.preventDefault();
      void opsRef.current.run(action);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* S2.1 — dashed parent outline + name tag; refs / crumbs / kind on select-set */}
      <EditingSelection />
      {/* S2.6 — a locked object says so; the arrows say where they put things */}
      <LockBadge readOnly={isReadOnlyCanvas()} />
      <NudgeReadout readOnly={isReadOnlyCanvas()} />
      {/* S2.8 — artboard: eight handles + preset ruler, a tall page's sticky name, the contextual minimap */}
      {/* S11.2 — tells the shell what is empty: the artboard count and the selected empty artboard */}
      <EmptyArtboardReporter />
      <ArtboardHandles />
      {editChrome ? <StickyName /> : null}
      {editChrome ? <MinimapContext /> : null}
    </>
  );
}
