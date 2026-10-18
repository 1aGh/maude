// client/v2/history/history-host.jsx — S1.14: Version history wired to the shell (the mode store's Viewing hold).
//
//   VersionHistoryHost   the panel, bound to `shellMode`: a row click holds Viewing, Restore / esc release it
//   ViewBarHost          the Viewing bar (always mounted; renders nothing outside Viewing) + the hold's
//                        housekeeping: another canvas in front, or a canvas that is gone, ends it
//   useViewing()         the hold (`{ path, at, title, when, who }` or null) — the Viewport frames it, the dock
//                        locks the AI chat island while it lasts ("no tools, AI or locks")
//   Compare (S1.15)      rides on the hold: the panel starts it (the selected row is A, Now is B), the Viewport
//                        draws it (compare-view.jsx `CompareHost`); leaving the hold ends it

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { compareStore, useCompare } from './compare-store.js';
import { VersionHistoryPanel } from './history-panel.jsx';
import { viewingWords } from './use-versions.js';
import { ViewBar } from './view-bar.jsx';

const getViewing = () => shellMode.get().viewing;

export function useViewing() {
  return useSyncExternalStore(shellMode.subscribe, getViewing, getViewing);
}

const leave = () => {
  compareStore.stop();
  shellMode.leaveViewing();
};

export function ViewBarHost({ activePath }) {
  const viewing = useViewing();
  useEffect(() => {
    if (viewing && viewing.path !== activePath) leave();
  }, [viewing, activePath]);
  return <ViewBar viewing={viewing} onLeave={leave} />;
}

/** @param p VersionHistoryPanel's props minus the hold; `refreshKey` is what the shell knows moved. */
export function VersionHistoryHost({ refreshKey = 0, onChanged, ...rest }) {
  const viewing = useViewing();
  const compare = useCompare();
  const [bump, setBump] = useState(0);
  const changed = useCallback(
    (res) => {
      setBump((n) => n + 1);
      onChanged?.(res);
    },
    [onChanged]
  );
  return (
    <VersionHistoryPanel
      {...rest}
      viewing={viewing}
      refreshKey={`${refreshKey}:${bump}`}
      onView={(words) => shellMode.view(words)}
      onLeaveViewing={leave}
      onChanged={changed}
      compare={compare}
      onCompare={(row) => compareStore.start({ path: rest.path, a: viewingWords(row) })}
      onPickB={(words) => compareStore.setB(words)}
      onStopCompare={() => compareStore.stop()}
      onRows={(rows) => compareStore.setRows(rows)}
    />
  );
}
