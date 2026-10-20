// editing/index.tsx — THE editing mount (S2.1; decision maude/v2-S2-editing-mount).
//
// canvas-shell.tsx mounts `<EditingLayer />` once, inside CanvasRouter's providers. Each S2 slice
// adds its own `editing/<area>.tsx` and ONE line below (append-only), so slices add files, not hunks
// in canvas-shell.tsx. The layer also answers the shell's `run-action` for the editing actions that
// have no chord to replay (⌘K / menus): `object.enter`, `object.step-out`.

import { useEffect, useRef } from 'react';

import { canvasModeStore, canvasSingleKeys } from '../bridge/canvas-mode-store.ts';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { showCanvasToast } from '../canvas-notifications.tsx';
import { resolveSelectionEl } from '../dom-selection.ts';
import { isEditableTarget } from '../input-router.tsx';
import { isEmbedCanvas, isReadOnlyCanvas } from '../read-only-mode.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { AiScopeOutline } from './ai-scope-outline.tsx';
import { AlignBar } from './align-bar.tsx';
import { ArtboardAnchorReporter } from './anchor-reporter.tsx';
import { AriaLive } from './aria-live.tsx';
import { ARRANGE_ACTIONS, TIDY_ACTION } from './arrange.ts';
import { ARTBOARD_ACTIONS, ArtboardCommands } from './artboard-commands.tsx';
import { ArtboardGuides } from './artboard-guides.tsx';
import { ArtboardHandles } from './artboard-handles.tsx';
import { ASK_SELECTION_ACTION, AskBubble } from './ask-bubble.tsx';
import { CornerDots } from './corner-dots.tsx';
import { CROP_ACTION, CropMode } from './crop-mode.tsx';
import { DrawTools } from './draw-tools.tsx';
import { DropChip } from './drop-chip.tsx';
import { EmptyArtboardReporter } from './empty-reporter.tsx';
import { FinderDrop } from './finder-drop.tsx';
import { KeyboardLayer, useKeyboardModality } from './focus-model.tsx';
import { GapBands } from './gap-bands.tsx';
import { HoldRings } from './hold-rings.tsx';
import { ImageDrop } from './image-drop.tsx';
import {
  INSTANCE_ACTIONS,
  instanceOpDeps,
  instanceParams,
  isInstanceAction,
  runInstanceAction,
} from './instance-actions.ts';
import {
  CONSTRAIN_ACTION,
  isConstrainAction,
  isLayoutAction,
  LAYOUT_ACTIONS,
  reorderKeyAction,
  runConstrainAction,
  runLayoutAction,
} from './layout-actions.ts';
import { LockBadge } from './lock-badge.tsx';
import { MinimapContext } from './minimap-context.tsx';
import { NudgeReadout } from './nudge.tsx';
import { useObjectOps } from './object-actions.ts';
import { resolveObjectKey } from './object-keys.ts';
import { isObjectOpAction, layerParams, OBJECT_OP_ACTIONS, refsOf } from './object-ops.ts';
import { PasteBar } from './paste-bar.tsx';
import { PEN_ACTIONS, PenLayer } from './pen/index.tsx';
import { PinGuides } from './place-freely.tsx';
import { PlaceGhost } from './place-ghost.tsx';
import { layoutOpsDeps, ReorderSlot } from './reorder-slot.tsx';
import { RotateHandle } from './rotate-handle.tsx';
import { EditingSelection, enterSelection, stampedParent, stepOut } from './selection.tsx';
import { INSERT_PRESET_ACTION, SizeGhost } from './size-ghost.tsx';
import { StickyName } from './sticky-name.tsx';
import { OrderBadges } from './tab-order.tsx';
import {
  isTextAction,
  runTextAction,
  TEXT_ACTIONS,
  textOpDeps,
  textParams,
} from './text-actions.ts';
import { TextInPlace } from './text-in-place.tsx';
import { TidyPreview } from './tidy-preview.tsx';
import { TokenRuler } from './token-ruler.tsx';
import { UndoPreview } from './undo-preview.tsx';

/** S2.8 — the shell asks the canvas to pin an artboard's theme; canvas-shell listens (it owns the pins). */
export const SET_ARTBOARD_THEME_EVENT = 'maude:set-artboard-theme';

/** Registry ids this layer runs when the shell asks (`dgn:'run-action'`). */
export const EDITING_ACTIONS = [
  'object.enter',
  'object.step-out',
  ...OBJECT_OP_ACTIONS,
  // S2.7 — run by align-bar.tsx / rotate-handle.tsx (each listens for its own run-action ids)
  ...ARRANGE_ACTIONS,
  'object.rotate',
  // S2.11 — Place freely, move earlier / later, convert children to absolute position
  ...LAYOUT_ACTIONS,
  // S2.11b — the Position row's pins: one object.constrain with the measured box
  CONSTRAIN_ACTION,
  // S2.12 — text: language, case, style (use / reset / detach); `text.set` is the caret's commit
  ...TEXT_ACTIONS,
  // S2.17 — an instance: swap its variant / component, Reset, Detach (the inspector's blocks, ⌘K)
  ...INSTANCE_ACTIONS,
  // S2.9 — Tidy up over 2+ artboards (run by align-bar.tsx)
  TIDY_ACTION,
  // S2.10 — ⌘D / Duplicate at another width / Rename / Reset position (run by artboard-commands.tsx)
  ...ARTBOARD_ACTIONS,
  // S2.14 — Combine shapes (run by pen/index.tsx)
  ...PEN_ACTIONS,
  // S2.15 — Crop: with params it is the op (the inspector's Fit / Zoom), without it opens crop mode (crop-mode.tsx)
  CROP_ACTION,
  // S2.19 — ⌘/ on a selection (run by ask-bubble.tsx, which listens for its own run-action id)
  ASK_SELECTION_ACTION,
  // S7.20 — a size-picker pick, ⌘K / Edit › Advanced ▸ New artboard › Video (run by size-ghost.tsx)
  INSERT_PRESET_ACTION,
] as const;

/** The reading-order badges, drawn while the keyboard is the last thing used. */
function KeyboardBadges() {
  return <OrderBadges active={useKeyboardModality()} />;
}

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
  // S2.11 — the layout ops' toast + undo record (reorder-slot.tsx holds them for ReorderDrag too)
  const undo = useUndoStackOptional();
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    layoutOpsDeps.current = {
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => undoRef.current?.record(rec),
    };
    // S2.12 — the text actions toast the same way and push the same undo record
    textOpDeps.current = {
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => undoRef.current?.record(rec),
    };
    // S2.17 — and the instance actions
    instanceOpDeps.current = {
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => undoRef.current?.record(rec),
    };
  }, []);
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
      } else if (isLayoutAction(m.id)) {
        // S2.11 — a Layers row names its own target in `params.targets`; otherwise the selection
        if (!isReadOnlyCanvas()) {
          const { refs } = layerParams(m.params);
          void runLayoutAction(m.id, selRef.current, refs);
        }
      } else if (isTextAction(m.id)) {
        // S2.12 — the Type section / ⌘K; a Layers-less ask names its target in `params.targets`
        if (!isReadOnlyCanvas()) {
          const { refs, params } = textParams(m.params);
          void runTextAction(m.id, selRef.current, refs, params, textOpDeps.current);
        }
      } else if (isInstanceAction(m.id)) {
        // S2.17 — the Component / Content / Main component blocks; the one selected instance
        if (!isReadOnlyCanvas()) {
          const { refs, params } = instanceParams(m.params);
          void runInstanceAction(m.id, selRef.current, refs, params, instanceOpDeps.current);
        }
      } else if (isConstrainAction(m.id)) {
        if (!isReadOnlyCanvas()) void runConstrainAction(m.params, selRef.current);
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

  // S2.11 — ← → (↑ ↓ in a column) move an object earlier / later in its auto layout. A bare arrow
  // on a flex child; v1's nudge ignores a child that sits in a layout, so the two never both act.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isReadOnlyCanvas() || toolRef.current === 'browse') return;
      if (isEditableTarget(e.target)) return;
      if (canvasModeStore(window).get().mode === 'preview') return;
      const sel = selRef.current;
      const one = sel.length === 1 ? sel[0] : null;
      if (!one?.id) return;
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      const parent = el ? stampedParent(el) : null;
      if (!el || !parent) return;
      const pcs = getComputedStyle(parent);
      const action = reorderKeyAction(
        e.key,
        { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey },
        { display: pcs.display, flexDirection: pcs.flexDirection },
        getComputedStyle(el).position
      );
      if (!action) return;
      e.preventDefault();
      void runLayoutAction(action, sel);
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
      {/* S2.7 — the align bar over a multi-selection, the rotate handle at its corner */}
      <AlignBar readOnly={isReadOnlyCanvas()} />
      <RotateHandle readOnly={isReadOnlyCanvas()} />
      {/* S2.11 — the gap / padding bands of an auto layout, the token ruler a gap drag shows, the
          slot a reordered card opens, and the pin guides of a freely placed object */}
      <GapBands readOnly={isReadOnlyCanvas()} />
      <TokenRuler />
      <ReorderSlot />
      <PinGuides readOnly={isReadOnlyCanvas()} />
      {/* S2.12 — the edit-tone ring around the text being typed, the Czech ties under it */}
      <TextInPlace readOnly={isReadOnlyCanvas()} />
      {/* S2.13 — the Frame / Shape / More tools' drag, and the dot inside each corner of a selected shape */}
      <DrawTools readOnly={isReadOnlyCanvas()} />
      {/* S7.20 — F over empty canvas opens the size picker (shell); its hover outline, its pick */}
      <SizeGhost readOnly={isReadOnlyCanvas()} />
      <CornerDots readOnly={isReadOnlyCanvas()} />
      {/* S2.14 — the Pen (P), double-click a path to edit its points, Combine shapes */}
      <PenLayer readOnly={isReadOnlyCanvas()} />
      {/* S2.16 — a component picked in the shell (⇧I) follows the pointer until a click places it */}
      <PlaceGhost readOnly={isReadOnlyCanvas()} />
      {/* S2.15 — a tile dropped on a frame, crop mode (double-click a picture), and the bar under a Figma paste */}
      <ImageDrop readOnly={isReadOnlyCanvas()} />
      {/* S8.14 — photos dragged from Finder onto an artboard: the hint, the import, ONE image.place, selected at once */}
      <FinderDrop readOnly={isReadOnlyCanvas()} />
      <CropMode readOnly={isReadOnlyCanvas()} />
      {editChrome ? <PasteBar readOnly={isReadOnlyCanvas()} /> : null}
      {/* S2.20 — an Undo history row lights what it would undo */}
      <UndoPreview />
      {/* S2.9 — one artboard in the air: soft guide, equal-gap chips, the position bubble; Tidy's dashed preview */}
      <ArtboardGuides readOnly={isReadOnlyCanvas()} />
      <TidyPreview />
      {/* S2.10 — ⌘D, ⌥-drag copy, Duplicate at another width, Custom width…, Rename, Reset position */}
      <ArtboardCommands readOnly={isReadOnlyCanvas()} />
      {/* S2.8 — artboard: eight handles + preset ruler, a tall page's sticky name, the contextual minimap */}
      {/* S11.2 — tells the shell what is empty: the artboard count and the selected empty artboard */}
      <EmptyArtboardReporter />
      {/* S7.7 — tells the shell which artboard is selected and where: the timeline island rises from a video */}
      <ArtboardAnchorReporter />
      {/* S7.9 — footage in flight over the window: the followed video wears "Or drop here — adds at the end" */}
      {isReadOnlyCanvas() ? null : <DropChip />}
      <ArtboardHandles />
      {editChrome ? <StickyName /> : null}
      {editChrome ? <MinimapContext /> : null}
      {/* S2.18 — people's soft locks (rings) + AI holds (spark outline); this person's own hold */}
      <HoldRings />
      {/* S2.19 — ⌘/ on a selection: the canvas says what and where; one AI outline follows the ask */}
      <AskBubble readOnly={isReadOnlyCanvas()} />
      <AiScopeOutline />
      {/* S2.21 — tab / ⇧tab in reading order, F6 out to the panels, R·T·F then ↵; the focus ring, the order
          badges while the keyboard walks, and what VoiceOver hears */}
      <KeyboardLayer readOnly={isReadOnlyCanvas()} />
      <KeyboardBadges />
      <AriaLive />
    </>
  );
}
