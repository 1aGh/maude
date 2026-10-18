// client/v2/present/present-chrome-host.jsx — S3.2b: the Present chrome, wired to today's shell.
//
// While the shell is presenting (DDR-117 hides everything else), this is the only chrome there is:
//   Present · Artboards   → <PresentControls> (‹ 3 / 14 › · label · esc to leave)
//   Present the canvas    → <CanvasPill> (Presenting the canvas · 21% · esc to leave)
// It replaces the v1 `st-present-exit` button in app.jsx. The mode, the position and the Present spec
// come from the ONE store (shellMode, D1); the counter is the canvas's own `present-position` echo, the
// label is the presented artboard's name from the project index (the Canvases panel reads the same one).

import { useMemo, useSyncExternalStore } from 'react';
import { useShellStore } from '../../stores/shell-store.jsx';
import { indexMeta } from '../canvases/tree-model.js';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { presentStep, shellMode } from '../shell/use-canvas-mode-lane.js';
import { CanvasPill } from './canvas-pill.jsx';
import { labelOf } from './present-controls-model.js';
import { PresentControls } from './present-controls.jsx';
import { PresenterViewButton } from './presenter-button.jsx';
import { presenterAvailable, presenterOn, usePresenterDisplays } from './presenter-store.js';
import { usePresentZoomValue } from './present-zoom-store.js';

export function ShellPresentChrome() {
  const {
    shellCore: { activePath, cfg },
    photoAndTimeline: { exitPresent },
  } = useShellStore();
  const snap = useSyncExternalStore(shellMode.subscribe, shellMode.get, shellMode.get);
  const zoom = usePresentZoomValue();
  const pv = usePresenterDisplays();

  const indexSnapshot = useCanvasIndex({ stamp: activePath });
  const boards = useMemo(
    () => indexMeta(indexSnapshot, cfg?.designRel).get(activePath)?.boards ?? null,
    [indexSnapshot, cfg?.designRel, activePath]
  );
  const label = useMemo(() => labelOf(snap.position, boards), [snap.position, boards]);

  if (snap.mode !== 'present') return null;
  if (snap.present?.kind === 'canvas') return <CanvasPill zoom={zoom} onLeave={exitPresent} />;
  // S3.6b: with presenter view up, the Mac shows its own screen (presenter-host.jsx) with its own Previous /
  // Next / End — these controls would only sit on top of it.
  if (presenterOn(pv)) return null;
  return (
    <PresentControls
      position={snap.position}
      label={label}
      onStep={presentStep}
      onLeave={exitPresent}
      // The two slots other slices fill (present-controls.jsx lists them):
      //   transport      — S3.3: <PresentTransport /> (media pause · time · sound)
      //   presenterView  — S3.6b: <PresenterViewButton /> (desktop, another display; else no slot at all)
      transport={null}
      presenterView={presenterAvailable(pv) ? <PresenterViewButton /> : null}
    />
  );
}
