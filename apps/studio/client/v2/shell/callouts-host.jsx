// client/v2/shell/callouts-host.jsx — V2-4.8b: the callout stack wired to today's shell.
//
// Reads the shell store (sync payload, staged update, repo-changed flag, cloud role) and hands them to
// the pure model. S11.17 adds the crash line (the desktop shell's `app://crashed`, heard once on mount)
// and the full-disk hold (recovery-store.js). The actions:
//   · Report a bug…  → Help › Report a bug… with the crash logs ticked
//   · Show in Finder → the project's design folder, selected in Finder (desktop only, S11.16 door)
//   · Details      → Menu › Diagnostics › Sync (today's Sync panel, whole)
//   · Restart now  → the desktop shell's own restart-to-update
//   · Reload       → reload the page (re-reads the repo)
//   · Got it       → remembered per role on this browser (`maude-cloud-role-seen:<role>`)
//   · Try now      → the same restart as Menu › Diagnostics › Advanced › Resync now (S11.15, sync-stuck)
// A close (×) hides one callout until its event changes: the key carries the event (a new conflict, a
// changed rejected count), so the next one comes back. Closing the update callout is "Later" (the next
// focus / 4 h check re-stages it); closing the repo notice clears the flag, as the strip's Dismiss did.
// No tour is offered here (02: "no wizard, no card, no tour"): the tours run from Menu › Help › Take the tour.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { restartToUpdate } from '../../github.js';
import { FormatGateBanner } from '../../shell/banners.jsx';
import { useShellStore } from '../../stores/shell-store.jsx';
import { openDiagnostics } from '../diagnostics/diagnostics-bus.js';
import { requestResync } from '../diagnostics/sync-actions.js';
import { calloutStack, roleSeenKey } from './callouts-model.js';
import { CalloutStack } from './callouts.jsx';
import { menuRunner } from './menu-runner.js';
import { nativeDoors } from './native-doors.js';
import { setReportEntry, useCrashNotice, useDiskHold } from './recovery-store.js';

function roleSeen(role) {
  try {
    return localStorage.getItem(roleSeenKey(role)) === '1';
  } catch {
    return false; // private mode / storage off — showing it twice beats never
  }
}

export function ShellCallouts() {
  const {
    shellCore: { cfg, gitLifecycle, setGitLifecycle, setUpdateReady, syncStatus, updateReady },
  } = useShellStore();
  const [dismissed, setDismissed] = useState(() => new Set());
  const [busyKey, setBusyKey] = useState(null);
  // The "wait" callout counts down to the next try; nothing else on this stack needs a clock.
  const waiting = !!syncStatus?.files?.rateLimited;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!waiting) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [waiting]);
  const crashed = useCrashNotice();
  const disk = useDiskHold();
  const doors = useMemo(() => nativeDoors(), []);

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
        crashed,
        disk,
        native: doors.available,
        dismissed,
        now,
      }),
    [
      crashed,
      disk,
      doors.available,
      syncStatus,
      updateReady,
      gitLifecycle,
      cfg?.cloud,
      dismissed,
      now,
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
        case 'report-bug':
          setReportEntry('crash');
          menuRunner.run('help.report-bug');
          break;
        case 'show-in-finder':
          void doors.revealPath(cfg?.designRel || '.design');
          break;
        case 'restart':
          setBusyKey(item.key);
          restartToUpdate().catch(() => setBusyKey(null));
          break;
        case 'try-now':
          setBusyKey(item.key);
          requestResync().finally(() => setBusyKey(null));
          break;
        case 'reload':
          try {
            window.location.reload();
          } catch {}
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
    [cfg?.cloud?.role, cfg?.designRel, doors, hide]
  );

  const onDismiss = useCallback(
    (item) => {
      if (item.kind === 'update') setUpdateReady(null);
      else if (item.kind === 'repo-changed') setGitLifecycle(null);
      else hide(item.key);
    },
    [hide, setGitLifecycle, setUpdateReady]
  );

  return (
    <CalloutStack items={items} onAction={onAction} onDismiss={onDismiss} busyKey={busyKey}>
      <FormatGateBanner />
    </CalloutStack>
  );
}
