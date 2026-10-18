// client/v2/preview/preview-chrome-host.jsx — S3.9: Preview's chrome, wired to the shell (04 md-motion).
//
// In Preview the shell shows two small islands and nothing else of its own: the PreviewBar (top centre —
// which canvas, what esc does) and the ZoomOnly readout (bottom left). The folded pill, the folded panels
// and the compact Share cluster are the mode's other half; they follow the same store. Edit, Viewing and
// Present show neither.
//
// `PreviewChrome` is the pure render (mode + caps + names in, islands out); `ShellPreviewChrome` collects
// the inputs from the shell and holds the islands on screen for the exit fade (the same frames in reverse).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { basename, displayName } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { capsFor } from '../shell/canvas-mode.js';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { PreviewBar, previewHint } from './preview-bar.jsx';
import { useViewportZoom, ZoomOnly } from './zoom-only.jsx';

/** The two islands, in Preview only. `state` is `in` while entering/showing, `out` for the exit fade. */
export function PreviewChrome({ mode, caps, name, zoom, back, onBack, state = 'in' }) {
  if (mode !== 'preview') return null;
  return (
    <>
      <PreviewBar name={name} hint={previewHint(caps)} back={back} onBack={onBack} state={state} />
      <ZoomOnly zoom={zoom} state={state} />
    </>
  );
}

/** Shell mode as a boolean, from the one store. */
export function usePreviewMode() {
  const snap = useSyncExternalStore(shellMode.subscribe, shellMode.get, shellMode.get);
  return snap.mode === 'preview';
}

/** Keeps the islands mounted for `ms` after `on` goes false, so they can fade out. */
function useExitHold(on, ms) {
  const [hold, setHold] = useState(false);
  const prev = useRef(on);
  useEffect(() => {
    const wasOn = prev.current;
    prev.current = on;
    if (on) {
      setHold(false);
      return undefined;
    }
    if (!wasOn) return undefined;
    setHold(true);
    const t = setTimeout(() => setHold(false), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return hold && !on;
}

/** `--dur-panel`, read off the root (1 ms under reduced motion — the token collapses). */
function panelMs() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-panel').trim();
    const m = /^([\d.]+)(ms|s)$/.exec(raw);
    if (m) return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  } catch {
    /* no computed style */
  }
  return 220;
}

export function ShellPreviewChrome() {
  const {
    shellCore: { activePath, cfg, iframesRef, viewerMode },
  } = useShellStore();
  const previewing = usePreviewMode();
  const leaving = useExitHold(previewing, panelMs());
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const live = useRef({});
  live.current = { activePath, iframesRef };
  const zoom = useViewportZoom({
    canvasOrigin: cfg?.canvasOrigin || window.location.origin,
    activeWin: () => {
      const p = live.current.activePath;
      return p && p !== SYSTEM_TAB
        ? (live.current.iframesRef.current?.get(p)?.contentWindow ?? null)
        : null;
    },
  });
  if (!canvasOpen || (!previewing && !leaving)) return null;
  const caps = capsFor({ canEdit: !viewerMode, role: cfg?.cloud?.role });
  return (
    <PreviewChrome
      mode="preview"
      caps={caps}
      name={displayName(basename(activePath))}
      zoom={zoom}
      state={previewing ? 'in' : 'out'}
    />
  );
}
