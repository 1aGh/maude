// client/v2/create/intent-host.jsx — S6.3: mounts the intent consumer in a project window (desktop app only).
//
// Starts when the window knows what it needs to act — the tree is loaded and the hub/role config has answered
// (the same moment `shell://navigate` starts listening, hooks/use-tabs.jsx) — and stops with the window. Renders
// nothing. The role is read live at the moment the intent runs: a Can view / Can comment session refuses with the
// shell's one denial line.

import { useEffect, useRef } from 'react';
import { invoke, isNativeApp, listenHere } from '../../github.js';
import { shellToast } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { menuRunner } from '../shell/menu-runner.js';
import { ROLE_DENIAL } from '../shell/use-canvas-mode-lane.js';
import { runIntent, startIntentConsumer } from './take-intent.js';

export function IntentHost() {
  const {
    shellCore: { cfg, treeLoaded, viewerMode },
  } = useShellStore();
  const live = useRef({ viewerMode });
  live.current = { viewerMode };
  const ready = !!treeLoaded && cfg?.cloud !== undefined && isNativeApp();

  useEffect(() => {
    if (!ready) return undefined;
    return startIntentConsumer({
      invoke,
      listen: listenHere,
      run: (raw) =>
        runIntent(raw, {
          canEdit: () => !live.current.viewerMode,
          roleDenial: ROLE_DENIAL,
          toast: shellToast,
          runAction: (id) => menuRunner.run(id),
        }),
    });
  }, [ready]);

  return null;
}
