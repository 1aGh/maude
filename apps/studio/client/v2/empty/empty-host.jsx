// client/v2/empty/empty-host.jsx — S11.2: the empty canvas and the empty-artboard hint, wired to today's shell.
//
// Reads what the shell already has (active canvas, role, mode, online, the iframe) plus the two facts only the
// canvas knows (`artboards {count}`, `artboard-empty`), and draws, over the canvas pane:
//   · <EmptyCanvas> when the open canvas has no artboards (Edit mode, a role that can edit, centred above the
//     toolbar) — three variants from the readiness state;
//   · <ArtboardHint> on the selected artboard when it is empty (leaves on the first layer);
//   · the S5 ConnectSheet, once, when Ask AI is pressed with no Claude account.
// Can view / Can comment get none of it (no create affordance). Ask AI opens the chat and PRE-FILLS; it never
// sends. The registry action `ai.ask-fill-artboard` (⌘K) runs the same ask for the hint's board (fill-ask.js).

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isNativeApp } from '../../github.js';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { connectClaude } from '../ai/connect-flow.js';
import { getPaletteEnv } from '../search/search-env.js';
import { menuRunner } from '../shell/menu-runner.js';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { ArtboardHint, HINT_SIZE } from './artboard-hint.jsx';
import { EmptyCanvas, EmptyConnect } from './empty-canvas.jsx';
import { emptyHintStore } from './empty-hint-store.js';
import { bindFillAsk } from './fill-ask.js';
import {
  createAskFlow,
  emptyCanvasModel,
  fillPrompt,
  hintPlacement,
  useClaudeState,
  useEmptyLane,
  useOnline,
} from './use-empty-canvas.js';

const modeNow = () => shellMode.get().mode;

export function EmptyHost() {
  const {
    shellCore: { activePath, cfg, iframesRef, viewerMode },
  } = useShellStore();
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const mode = useSyncExternalStore(shellMode.subscribe, modeNow, modeNow);
  const online = useOnline();
  const canEdit = !viewerMode;
  const native = isNativeApp();
  const canAsk = native && canEdit;
  const [claude, rereadClaude] = useClaudeState(canAsk && canvasOpen);
  const { lane, count, hint } = useEmptyLane({
    activePath,
    iframesRef,
    canvasOrigin: cfg?.canvasOrigin,
  });

  const model = canvasOpen
    ? emptyCanvasModel({ count, mode, canEdit, online, claude, canAsk })
    : null;

  // the Layers tab names the board in its own words
  useEffect(() => {
    emptyHintStore.set(hint ? { artboardId: hint.artboardId, label: hint.label } : null);
  }, [hint]);

  // a closed canvas is forgotten
  useEffect(() => () => lane.forget(activePath), [lane, activePath]);

  // ── the ask ──
  const [sheet, setSheet] = useState(null); // null | { phase, error }
  const abortRef = useRef(null);
  const openChat = useCallback(() => getPaletteEnv().askAI(''), []);
  const flowRef = useRef(null);
  if (!flowRef.current)
    flowRef.current = createAskFlow({
      openChat: () => openChat(),
      prefill: (text) => getPaletteEnv().askAI(text),
      openConnect: () => setSheet({ phase: 'idle', error: null }),
    });
  const flow = flowRef.current;

  const onConnect = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setSheet({ phase: 'installing', error: null });
    const r = await connectClaude({
      signal: ctl.signal,
      onPhase: (phase) => setSheet((s) => (s ? { ...s, phase } : s)),
    });
    if (ctl.signal.aborted) return;
    if (r.ok) {
      setSheet(null);
      rereadClaude();
      openChat();
    } else {
      setSheet({ phase: 'idle', error: r.reason || 'That did not work.' });
    }
  }, [openChat, rereadClaude]);
  const onCancelConnect = useCallback(() => {
    abortRef.current?.abort();
    setSheet(null);
    openChat(); // the chat is still where the prompt gets written
  }, [openChat]);

  const askCanvas = useCallback(() => {
    flow.ask(model);
  }, [flow, model]);
  const askFill = useCallback(
    (h) => {
      flow.ask(model ?? { variant: 'ready' }, fillPrompt({ label: h.label, from: h.from }));
    },
    [flow, model]
  );

  // ⌘K "Ask AI to fill this artboard": the hint's board when one is up, else just the chat
  const hintRef = useRef(hint);
  hintRef.current = hint;
  useEffect(
    () =>
      bindFillAsk(() => {
        const h = hintRef.current;
        if (h) askFill(h);
        else openChat();
        return true;
      }),
    [askFill, openChat]
  );

  // ── where things go: over the canvas pane ──
  const frame = canvasOpen ? iframesRef?.current?.get(activePath) : null;
  const box = frame?.getBoundingClientRect?.() ?? null;
  const placement = useMemo(
    () =>
      hint && box
        ? hintPlacement(
            { left: box.left, top: box.top },
            hint.rect,
            { w: window.innerWidth, h: window.innerHeight },
            HINT_SIZE
          )
        : null,
    // biome-ignore lint/correctness/useExhaustiveDependencies: box is read fresh from the DOM each render
    [hint, box?.left, box?.top]
  );

  const showHint = !!hint && !!placement && canEdit && mode === 'edit' && !model;
  if (!model && !showHint && !sheet) return null;
  return (
    <>
      {model ? (
        // the canvas is the whole window body (V2-4.1): the block centres on the window, above the toolbar
        <div className="es-host">
          <EmptyCanvas
            model={model}
            onAsk={askCanvas}
            onNewArtboard={() => menuRunner.run('artboard.new-desktop')}
          />
        </div>
      ) : null}
      {showHint ? (
        <ArtboardHint hint={hint} placement={placement} canAsk={canAsk} onAsk={askFill} />
      ) : null}
      {sheet ? (
        <EmptyConnect
          phase={sheet.phase}
          error={sheet.error}
          onConnect={onConnect}
          onCancel={onCancelConnect}
        />
      ) : null}
    </>
  );
}
