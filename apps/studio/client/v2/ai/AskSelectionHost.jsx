// client/v2/ai/AskSelectionHost.jsx — S2.19 (14 Editing `ed-edge-ask`): ⌘/ on a selection, in place.
//
// Over the canvas pane, under the selected elements: a bubble with the scope chip ("◆ 3 elements"), a field and
// send. ↵ hands the words to the AI chat's composer with an `elements` scope (ask-selection.js → Composer.jsx) —
// the same send as a typed ask: every gate, one run, one undo step. The bubble then shows what was asked while
// the AI works, with "One step — ⌘Z undoes all of it · the rest of the page stays yours", and follows the
// canvas's AI outline until the run is over.
//
// The shell draws it, not the canvas: a canvas is untrusted (DDR-054) and must never carry — or hear — a prompt.
// The AI chat itself stays folded; its icon wears the busy dot while the run works (FoldNeeds / S5.13).

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { isNativeApp } from '../../github.js';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { BUBBLE_SIZE, bubblePlacement, sendAskSelection } from './ask-selection.js';
import { createAskSelectionLane } from './ask-selection-lane.js';
import { Spark } from './icons.jsx';
import { scopeLabel, scopeTitle } from './scope.js';

/** The words (CONTRACT §3 voice). */
export const ASK_SELECTION_WORDS = Object.freeze({
  placeholder: 'Ask AI…',
  hint: 'One step — ⌘Z undoes all of it · the rest of the page stays yours',
  label: 'Ask AI about the selection',
  send: 'Ask AI',
});

const modeNow = () => shellMode.get().mode;

export function AskSelectionHost() {
  const {
    shellCore: { activePath, cfg, iframesRef, viewerMode },
  } = useShellStore();
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const mode = useSyncExternalStore(shellMode.subscribe, modeNow, modeNow);
  const live = useRef({});
  live.current = { activePath, iframesRef, canvasOrigin: cfg?.canvasOrigin };
  const laneRef = useRef(null);
  if (!laneRef.current)
    laneRef.current = createAskSelectionLane({
      canvasOrigin: () => live.current.canvasOrigin || window.location.origin,
      activePath: () => live.current.activePath,
      frameOf: (p) => live.current.iframesRef?.current?.get(p),
    });
  const lane = laneRef.current;
  const state = useSyncExternalStore(lane.subscribe, lane.get, lane.get);

  useEffect(() => {
    window.addEventListener('message', lane.onMessage);
    return () => window.removeEventListener('message', lane.onMessage);
  }, [lane]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching canvases is the trigger
  useEffect(() => {
    lane.switched();
  }, [lane, activePath]);
  // an asked bubble whose outline never came gives up
  useEffect(() => {
    if (state.phase !== 'asked') return undefined;
    const id = setInterval(() => lane.tick(), 1000);
    return () => clearInterval(id);
  }, [lane, state.phase]);

  const refocusCanvas = useCallback(() => {
    try {
      live.current.iframesRef?.current?.get(live.current.activePath)?.focus?.();
    } catch {
      /* gone */
    }
  }, []);

  const frame = canvasOpen ? iframesRef?.current?.get(activePath) : null;
  const box = frame?.getBoundingClientRect?.() ?? null;
  const placement = useMemo(
    () =>
      state.phase !== 'closed' && box
        ? bubblePlacement(
            { left: box.left, top: box.top },
            state.rect,
            { w: window.innerWidth, h: window.innerHeight },
            BUBBLE_SIZE
          )
        : null,
    // biome-ignore lint/correctness/useExhaustiveDependencies: box is read fresh from the DOM each render
    [state.phase, state.rect, box?.left, box?.top]
  );

  const canAsk = isNativeApp() && !viewerMode && mode === 'edit' && canvasOpen;
  if (state.phase === 'closed' || !placement || !canAsk) return null;

  if (state.phase === 'asked')
    return (
      <div
        className="as-asked"
        data-testid="ask-selection-asked"
        style={{ left: placement.left, top: placement.top }}
      >
        <div className="as-bubble as-bubble--asked">
          <span className="as-spark" aria-hidden="true">
            <Spark size={12} />
          </span>
          <span className="as-text" data-testid="ask-selection-text">
            {state.text}
          </span>
          <kbd className="as-kbd">⌘/</kbd>
        </div>
        <p className="as-hint" data-testid="ask-selection-hint">
          {ASK_SELECTION_WORDS.hint}
        </p>
      </div>
    );

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      lane.close();
      refocusCanvas();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      const text = e.currentTarget.value;
      if (sendAskSelection({ text, scope: state.scope })) {
        lane.submit(text);
        refocusCanvas();
      }
    }
  };
  const submit = (input) => {
    const text = input?.value ?? '';
    if (sendAskSelection({ text, scope: state.scope })) {
      lane.submit(text);
      refocusCanvas();
    }
  };

  return (
    <form
      className="as-bubble"
      data-testid="ask-selection-bubble"
      aria-label={ASK_SELECTION_WORDS.label}
      style={{ left: placement.left, top: placement.top, width: BUBBLE_SIZE.w }}
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget.elements.namedItem('ask'));
      }}
    >
      <span className="as-chip" title={scopeTitle(state.scope)} data-testid="ask-selection-chip">
        <span aria-hidden="true">◆</span> {scopeLabel(state.scope)}
      </span>
      <input
        name="ask"
        className="as-input"
        data-testid="ask-selection-input"
        placeholder={ASK_SELECTION_WORDS.placeholder}
        aria-label={ASK_SELECTION_WORDS.label}
        maxLength={2000}
        // biome-ignore lint/a11y/noAutofocus: the person just pressed ⌘/ to type here
        autoFocus
        autoComplete="off"
        onKeyDown={onKeyDown}
      />
      <button
        type="submit"
        className="as-send"
        data-testid="ask-selection-send"
        aria-label={ASK_SELECTION_WORDS.send}
      >
        <Spark size={12} />
      </button>
    </form>
  );
}
