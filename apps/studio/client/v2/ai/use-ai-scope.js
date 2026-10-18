// client/v2/ai/use-ai-scope.js — S5.8: the composer's scope, as one hook per chat.
//
// It replaces ChatPanel's `chatCtx` / `ctxDismissed` pair. One `buildChatContext` result still drives BOTH
// the chip and the frozen block (`contextRef` is what the adapter reads at send — freeze = read-once), so
// what the chip says is what rides (DDR-140). The person's choice lives only until the selection, the
// canvas or the panel changes — then the chip follows the selection again ("⌘/ always attaches what is
// selected now").

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildChatContext } from '../../panels/chat-context.js';
import { autoScope, resolveScope, scopeForPrompt, selectedArtboardIds } from './scope.js';

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
        const boards = Array.isArray(meta?.artboards) ? meta.artboards : [];
        setList(
          boards
            .filter((a) => a && typeof a.id === 'string' && a.id)
            .map((a) => ({
              id: a.id,
              label: typeof a.label === 'string' && a.label.trim() ? a.label : a.id,
            }))
        );
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
  const auto = useMemo(
    () => autoScope({ selected, canvas: activeCanvas }),
    [selected, activeCanvas]
  );
  const scope = resolveScope(choice, auto);

  // The selection, the canvas or the panel changed → follow the selection again.
  useEffect(() => {
    setChoice(null);
  }, [activeCanvas, selected]);
  useEffect(() => {
    if (!panelHidden) setChoice(null);
  }, [panelHidden]);

  const chatCtx = useMemo(() => {
    if (scope.kind === 'none') return null;
    return buildChatContext({
      canvas: activeCanvas,
      // A scope the person picked replaces the selection: its element locators do not ride.
      selected: choice ? null : selected,
      scope: scopeForPrompt(scope, artboards),
    });
  }, [activeCanvas, selected, choice, scope, artboards]);

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
