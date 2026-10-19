// client/v2/ai/use-ai-scope.js — S5.8: the composer's scope, as one hook per chat.
//
// It replaces ChatPanel's `chatCtx` / `ctxDismissed` pair. One `buildChatContext` result still drives BOTH
// the chip and the frozen block (`contextRef` is what the adapter reads at send — freeze = read-once), so
// what the chip says is what rides (DDR-140). The person's choice lives only until the selection, the
// canvas or the panel changes — then the chip follows the selection again ("⌘/ always attaches what is
// selected now").

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildChatContext } from '../../panels/chat-context.js';
import {
  annotationScopeOf,
  annotationSelectionVersion,
  subscribeAnnotationSelection,
} from '../annotations/annotation-asks.js';
import {
  annotationsScope,
  autoScope,
  resolveScope,
  scopeForPrompt,
  selectedArtboardIds,
  selectionKey,
} from './scope.js';

/**
 * S5.17 G2 — the artboards a `.meta.json` names, `{ id, label }[]`. Real sidecars carry them in
 * `sections[].artboards` (the canvas's own sections) or, older ones, at the top level `artboards`; the
 * label is the name a person knows ("Pricing"), the id only when the sidecar has none. Pure.
 */
export function artboardsFromMeta(meta) {
  const fromSections = Array.isArray(meta?.sections)
    ? meta.sections.flatMap((s) => (Array.isArray(s?.artboards) ? s.artboards : []))
    : [];
  const boards = fromSections.length
    ? fromSections
    : Array.isArray(meta?.artboards)
      ? meta.artboards
      : [];
  const seen = new Set();
  const out = [];
  for (const a of boards) {
    if (!a || typeof a.id !== 'string' || !a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ id: a.id, label: typeof a.label === 'string' && a.label.trim() ? a.label : a.id });
  }
  return out;
}

/** The canvas's artboards `{ id, label }[]`, from its `.meta.json` sidecar. Re-read when the selection names one it lacks. */
export function useCanvasArtboards(canvas, wantedIds = []) {
  const [list, setList] = useState([]);
  const [tick, setTick] = useState(0);
  const wanted = wantedIds.join('\u0001');
  const seen = useRef('');

  useEffect(() => {
    if (!canvas) {
      setList([]);
      return undefined;
    }
    let off = false;
    fetch(`/_api/canvas-meta?file=${encodeURIComponent(canvas)}`)
      .then((r) => r.json())
      .then((meta) => {
        if (off) return;
        setList(artboardsFromMeta(meta));
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [canvas, tick]);

  // A selection that names an artboard the list lacks (just added): read the sidecar once more.
  useEffect(() => {
    if (!wanted || wanted === seen.current) return;
    if (wanted.split('\u0001').some((id) => !list.some((a) => a.id === id))) {
      seen.current = wanted;
      setTick((t) => t + 1);
    }
  }, [wanted, list]);

  return list;
}

/**
 * @param {object} i
 * @param {string|null} i.activeCanvas
 * @param {object|object[]|null} i.selected
 * @param {boolean} i.panelHidden — the AI chat panel is folded; showing it again re-attaches the selection
 * @param {string|null} [i.viewArtboardId] — the artboard in view (the menu's second row)
 */
export function useAiScope({ activeCanvas, selected, panelHidden = false, viewArtboardId = null }) {
  const [choice, setChoice] = useState(null);
  const selectedIds = useMemo(
    () => selectedArtboardIds(selected, activeCanvas),
    [selected, activeCanvas]
  );
  const artboards = useCanvasArtboards(activeCanvas, selectedIds);
  // S4.15 — stickies / arrows selected in Preview (`annotation-selection`): the chip follows them while they
  // are selected. Annotation and element selections are exclusive (Preview vs Edit), so whichever is non-empty.
  const annVersion = useSyncExternalStore(
    subscribeAnnotationSelection,
    annotationSelectionVersion,
    annotationSelectionVersion
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: annVersion is the store's snapshot id
  const annScope = useMemo(
    () => annotationsScope(activeCanvas ? (annotationScopeOf(activeCanvas) ?? {}) : {}),
    [activeCanvas, annVersion]
  );
  const auto = useMemo(
    () => annScope ?? autoScope({ selected, canvas: activeCanvas }),
    [annScope, selected, activeCanvas]
  );
  const scope = resolveScope(choice, auto);

  // The selection, the canvas or the panel changed → follow the selection again. The SELECTION is compared by
  // what it is, not by array identity: the same selection announced again must not undo the person's pick (G11).
  const selKey = `${selectionKey(selected)}\u0003${annScope ? annScope.ids.join(',') : ''}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reset runs on the selection's content (selKey) and the canvas, not on a re-announced array
  useEffect(() => {
    setChoice(null);
  }, [activeCanvas, selKey]);
  useEffect(() => {
    if (!panelHidden) setChoice(null);
  }, [panelHidden]);

  const chatCtx = useMemo(() => {
    if (scope.kind === 'none') return null;
    return buildChatContext({
      canvas: activeCanvas,
      // A scope the person picked replaces the selection: its element locators do not ride — except a ⌘/ ask on
      // a selection (S2.19), whose scope carries the locators of exactly the elements it names.
      selected: choice
        ? choice.kind === 'elements'
          ? choice.selected
          : null
        : annScope
          ? null // the stickies ride as ids in the scope line; no element locators
          : selected,
      scope: scopeForPrompt(scope, artboards),
    });
  }, [activeCanvas, selected, choice, scope, artboards, annScope]);

  // What the adapter freezes at send.
  const contextRef = useRef(null);
  contextRef.current = chatCtx;

  const choose = useCallback((next) => setChoice(next), []);
  const remove = useCallback(() => setChoice({ kind: 'none' }), []);

  return {
    scope,
    artboards,
    activeArtboardId: viewArtboardId ?? selectedIds[0] ?? null,
    chatCtx,
    stale: !!chatCtx?.stale,
    contextRef,
    choose,
    remove,
  };
}
