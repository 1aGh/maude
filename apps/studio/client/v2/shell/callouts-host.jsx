// client/v2/shell/callouts-host.jsx — V2-4.8b: the callout stack wired to today's shell.
//
// Reads the shell store (sync payload, staged update, repo-changed flag, cloud role) and hands them to
// the pure model. The four actions:
//   · Details      → Menu › Diagnostics › Sync (today's Sync panel, whole)
//   · Restart now  → the desktop shell's own restart-to-update
//   · Reload       → reload the page (re-reads the repo)
//   · Got it       → remembered per role on this browser (`maude-cloud-role-seen:<role>`)
// A close (×) hides one callout until its event changes: the key carries the event (a new conflict, a
// changed rejected count), so the next one comes back. Closing the update callout is "Later" (the next
// focus / 4 h check re-stages it); closing the repo notice clears the flag, as the strip's Dismiss did.

import { useCallback, useMemo, useState } from 'react';
import { restartToUpdate } from '../../github.js';
import { FormatGateBanner } from '../../shell/banners.jsx';
import { useShellStore } from '../../stores/shell-store.jsx';
import { COLLAB_TOUR } from '../../tour/collab-tour.js';
import { USAGE_TOUR } from '../../tour/usage-tour.js';
import { openDiagnostics } from '../diagnostics/diagnostics-bus.js';
import { calloutStack, roleSeenKey } from './callouts-model.js';
import { CalloutStack } from './callouts.jsx';

function roleSeen(role) {
  try {
    return localStorage.getItem(roleSeenKey(role)) === '1';
  } catch {
    return false; // private mode / storage off — showing it twice beats never
  }
}

export function ShellCallouts() {
  const {
    shellCore: {
      cfg,
      collabNudge,
      gitLifecycle,
      markCollabSeen,
      markUsageSeen,
      setGitLifecycle,
      setUpdateReady,
      startTour,
      syncStatus,
      tourSteps,
      updateReady,
      usageNudge,
    },
  } = useShellStore();
  const [dismissed, setDismissed] = useState(() => new Set());
  const [busyKey, setBusyKey] = useState(null);

  // Read at render, not seeded into state: `cfg.cloud` is undefined until `/_config` lands, and a
  // state initializer would decide before there is a role (the v1 banner never appeared that way).
  const items = useMemo(
    () =>
      calloutStack({
        syncStatus,
        updateReady,
        gitLifecycle,
        cloud: cfg?.cloud,
        roleSeen,
        tour: { usage: !!usageNudge, collab: !!collabNudge, running: !!tourSteps },
        dismissed,
      }),
    [
      syncStatus,
      updateReady,
      gitLifecycle,
      cfg?.cloud,
      usageNudge,
      collabNudge,
      tourSteps,
      dismissed,
    ]
  );

  const hide = useCallback(
    (key) =>
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      }),
    []
  );

  const onAction = useCallback(
    (item) => {
      switch (item.action?.id) {
        case 'details':
          openDiagnostics('sync');
          break;
        case 'restart':
          setBusyKey(item.key);
          restartToUpdate().catch(() => setBusyKey(null));
          break;
        case 'reload':
          try {
            window.location.reload();
          } catch {}
          break;
        case 'tour-usage':
          markUsageSeen?.();
          startTour?.(USAGE_TOUR);
          break;
        case 'tour-collab':
          markCollabSeen?.();
          startTour?.(COLLAB_TOUR);
          break;
        case 'got-it': {
          const role = cfg?.cloud?.role;
          try {
            if (role) localStorage.setItem(roleSeenKey(role), '1');
          } catch {}
          hide(item.key);
          break;
        }
        default:
          break;
      }
    },
    [cfg?.cloud?.role, hide, markUsageSeen, markCollabSeen, startTour]
  );

  const onDismiss = useCallback(
    (item) => {
      if (item.kind === 'update') setUpdateReady(null);
      else if (item.kind === 'repo-changed') setGitLifecycle(null);
      else if (item.kind === 'tour-usage') markUsageSeen?.();
      else if (item.kind === 'tour-collab') markCollabSeen?.();
      else hide(item.key);
    },
    [hide, setGitLifecycle, setUpdateReady, markUsageSeen, markCollabSeen]
  );

  return (
    <CalloutStack items={items} onAction={onAction} onDismiss={onDismiss} busyKey={busyKey}>
      <FormatGateBanner />
    </CalloutStack>
  );
}
