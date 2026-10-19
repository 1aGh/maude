// client/v2/inspect/inspect-host.jsx — S3.11: the Inspect panel wired to the shell (04 Modes · md-inspect).
//
// In Preview (after a ⌘-click) and in Viewing (after a plain click) the shell shows ONE island on the right:
// the specs of the element the canvas is pointing at. Edit keeps its Inspector; Present shows nothing. The
// panel hides when the selection goes (esc clears it in the canvas).
//
// `ShellInspectPanel` collects the inputs (selection, role, canvas, handlers); `InspectPanel` draws.

import { useSyncExternalStore } from 'react';
import { modeShows } from '../../../bridge/mode-shows.ts';
import { runActionMessage } from '../../actions/shell-key-handlers.js';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { advancedAccess } from '../inspector/advanced.jsx';
import { capsFor } from '../shell/canvas-mode.js';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { inspectOpensOnSelect } from './inspect-model.js';
import { InspectPanel } from './inspect-panel.jsx';

/** The one element a selection stands for, or null (none, several, or a bare artboard). */
export function inspectedElement(selected) {
  const el = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
  return el && el.id ? el : null;
}

export function ShellInspectPanel() {
  const {
    shellCore: { activePath, cfg, iframesRef, layersTree, selected, setExportDialog, viewerMode },
  } = useShellStore();
  const snap = useSyncExternalStore(shellMode.subscribe, shellMode.get, shellMode.get);
  const el = inspectedElement(selected);
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  if (!canvasOpen || !el || !modeShows(snap.mode, 'inspect-panel')) return null;
  if (!inspectOpensOnSelect({ mode: snap.mode, hasId: !!el.id, inspected: !!el.inspected }))
    return null;
  const access = advancedAccess(cfg, undefined);
  // The shell's caps are the truth for Edit: a role with the edit cap, nothing else.
  const canEdit = capsFor({ canEdit: !viewerMode, role: cfg?.cloud?.role }).edit && access.canEdit;
  return (
    <InspectPanel
      selected={el}
      layersTree={layersTree}
      canvasFile={activePath}
      access={{ ...access, canEdit }}
      onExport={(ask) => setExportDialog?.(ask)}
      onEdit={() =>
        iframesRef.current
          ?.get(activePath)
          ?.contentWindow?.postMessage(runActionMessage('inspect.edit'), '*')
      }
    />
  );
}
