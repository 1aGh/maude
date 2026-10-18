// client/v2/shell/share-cluster-host.jsx — V2-4.3a: the Share cluster wired to today's shell.
//
// Collects the cluster's inputs from the sources that exist today and hands them to the presentational
// <ShareCluster> through the pure model in save-status.js:
//   · status word   ← syncPresentation(syncStatus) (the status bar's own rule) + hub `queuedOps` +
//                     GET /_api/outbox `content.pending` (V2-2.16) + navigator.onLine + link state
//   · faces         ← the local user (gitUser) and Claude while it edits (the menubar's presence)
//   · comments      ← the open-comments count the status bar shows
//   · Exports       ← the export center's jobs (shown once any exists; ring = running jobs' progress)
//   · Share         ← `share.open` through the shell's runner (today's share dialog)
//   · access words  ← `cfg.readOnly` + `readOnlyReason` + the cloud role
// Retry runs the Sync panel's own Resync (`POST /_api/sync/resync`) — the one retry path that exists.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { syncPresentation } from '../../../sync/presentation.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { shellToast } from '../../shell/util.js';
import { indexMeta } from '../canvases/tree-model.js';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { menuRunner } from './menu-runner.js';
import { ModeSwitch } from './mode-switch.jsx';
import { menuCtx } from './project-menu-model.js';
import { accessStatus, exportsRing, facesOf, outboxPending, saveStatus } from './save-status.js';
import { ShareCluster } from './share-cluster.jsx';
import { AccountChip } from './account-card.jsx';
import { accountCard, accountChip } from './account-card-model.js';
import { presentFromLabel } from './present-from-label.js';
import { useAccount } from './use-account.js';
import { useCanvasModeLane } from './use-canvas-mode-lane.js';
import { usePanelLayout } from './use-panel-layout.js';
import { isNativeApp } from '../../github.js';

const subscribeOnline = (fn) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};
const onlineNow = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** Edits still waiting to leave this Mac, from the outbox' content lane. Re-read when the hub status
 *  changes and on a slow tick while the project is linked and the window is showing. */
function useOutboxPending(enabled, nudge) {
  const [pending, setPending] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nudge` re-reads when the hub status moves
  useEffect(() => {
    if (!enabled) {
      setPending(0);
      return undefined;
    }
    let live = true;
    const read = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/_api/outbox')
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => {
          if (live) setPending(outboxPending(v));
        })
        .catch(() => {});
    };
    read();
    const t = setInterval(read, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [enabled, nudge]);
  return pending;
}

export function ShellShareCluster() {
  const {
    shellCore: {
      activePath,
      agentActive,
      canvasActiveArtboard,
      cfg,
      cloudLinkedHub,
      commentsPanelOpen,
      exportCenter,
      gitUser,
      iframesRef,
      project,
      selected,
      syncStatus,
      viewerMode,
    },
    keyboardShortcuts: { totalOpen },
    paletteAndPanels: { rightActive },
  } = useShellStore();
  const { hidden: panelsHidden, pinned } = usePanelLayout();
  const online = useSyncExternalStore(subscribeOnline, onlineNow, () => true);

  const linked =
    !!cfg?.cloud || !!cloudLinkedHub?.credentialed || (!!syncStatus && syncStatus.linked !== false);
  const presentation = useMemo(
    () => syncPresentation(syncStatus, { project: cfg?.cloud?.projectName || project }),
    [syncStatus, cfg?.cloud?.projectName, project]
  );
  const phase = presentation?.phase ?? null;
  const outbox = useOutboxPending(linked, syncStatus?.state);
  const pending = (Number(syncStatus?.queuedOps) || 0) + outbox;

  // Editing is off for two different reasons: the person's role, and a project format this build can't
  // edit. Only the first is an ACCESS question (Can view / Can comment, Ask to edit); the second keeps
  // the normal cluster.
  const roleLimited = !!viewerMode && cfg?.readOnlyReason !== 'format';
  const access = accessStatus({ canEdit: !roleLimited, role: cfg?.cloud?.role });
  const status = saveStatus({ linked, online, phase, pending, writeFailed: null });
  // "Show in Finder" has no reveal path in the shell yet (Diagnostics › Project folder, V2-4.7).
  const shown = { ...status, actions: status.actions.filter((a) => a.id !== 'show-in-finder') };
  // The status-bar chip's tooltip + short label (V2-4.8b): the sentence on hover, the label as data.
  if (presentation) {
    const names = presentation.names.length ? ` (${presentation.names.join(', ')})` : '';
    shown.title = `${presentation.title}${names}${presentation.next ? ` — ${presentation.next}` : ''}`;
    shown.syncLabel = presentation.label;
  }

  // V2-4.3b — the mode lane: the switch below sends `set-mode`; the active canvas reports its peers.
  // S3.1 — the lane's store is the one mode owner, Present included (D1).
  const lane = useCanvasModeLane({
    activePath,
    iframesRef,
    cfg,
    canEdit: !viewerMode,
    role: cfg?.cloud?.role,
  });
  const faces = useMemo(
    () => facesOf({ you: gitUser, agentActive, peers: lane.peers }),
    [gitUser, agentActive, lane.peers]
  );
  const ex = useMemo(() => exportsRing(exportCenter?.jobs), [exportCenter?.jobs]);
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const ctx = useMemo(
    () => menuCtx({ native: isNativeApp(), readOnly: !!viewerMode, canvasOpen }),
    [viewerMode, canvasOpen]
  );

  // S3.2a — the first Present row names the artboard a click would start from: the labels come from the
  // project index (the Canvases panel reads the same one), the choice from the selection / the view.
  const indexSnapshot = useCanvasIndex({ stamp: activePath });
  const boards = useMemo(
    () => indexMeta(indexSnapshot, cfg?.designRel).get(activePath)?.boards ?? null,
    [indexSnapshot, cfg?.designRel, activePath]
  );
  const fromLabel = useMemo(
    () => presentFromLabel({ selected, inView: canvasActiveArtboard, boards }),
    [selected, canvasActiveArtboard, boards]
  );

  // S1.22a — the account chip (desktop): which Mac account this project tab is bound to. A cloud tab's
  // account is the hub's, a browser tab has none: both get no chip.
  const native = isNativeApp();
  const acct = useAccount(native && !cfg?.cloud);
  const projectName = cfg?.cloud?.projectName || project;
  const chip = useMemo(
    () =>
      accountChip({
        native,
        cloud: !!cfg?.cloud,
        connected: acct.connected,
        profile: cfg?.profile,
        email: acct.email,
        accounts: acct.accounts,
      }),
    [native, cfg?.cloud, cfg?.profile, acct.connected, acct.email, acct.accounts]
  );
  const card = useMemo(
    () =>
      chip
        ? accountCard({
            project: projectName,
            profile: cfg?.profile,
            email: acct.email,
            accounts: acct.accounts,
          })
        : null,
    [chip, projectName, cfg?.profile, acct.email, acct.accounts]
  );

  const retry = useCallback(async () => {
    try {
      const res = await fetch('/_api/sync/resync', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok)
        shellToast(json.detail || 'Could not retry. Open the Sync panel for details.');
    } catch {
      shellToast('Maude could not reach the sync service.');
    }
  }, []);

  return (
    <ShareCluster
      accountSlot={
        chip ? (
          <AccountChip
            chip={chip}
            card={card}
            onSwitch={() => menuRunner.run('account.switch')}
            onSignOut={acct.signOut}
          />
        ) : null
      }
      faces={faces}
      onFollow={lane.follow}
      status={shown}
      access={access}
      commentsCount={Number(totalOpen) || 0}
      commentsOpen={!!commentsPanelOpen}
      exports={ex}
      exportsOpen={!!exportCenter?.panelOpen}
      panelsHidden={panelsHidden}
      canShare={canvasOpen}
      ctx={ctx}
      run={(id) => menuRunner.run(id)}
      onStatusAction={(id) => {
        if (id === 'retry') retry();
      }}
      // Nobody receives an "Ask to edit" yet — the request path is S9's (outbox kind
      // `share.ask-to-edit`, no sender registered). Until then it says what to do, as the menubar does.
      onAskToEdit={() => shellToast('Ask a project owner for edit access.')}
      docked={pinned && !panelsHidden && !!rightActive}
      mode={lane.mode}
      modeSlot={
        <ModeSwitch
          mode={lane.mode}
          caps={lane.caps}
          onSelect={lane.select}
          onPresent={lane.present}
          presentFromLabel={fromLabel}
          canPresent={canvasOpen}
        />
      }
    />
  );
}
