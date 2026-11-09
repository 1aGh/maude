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
// Retry runs the Sync panel's own Resync (`POST /_api/sync/resync`); while a full disk holds writes
// (S11.17, recovery-store.js) it tries the held writes instead, and Show in Finder opens the design folder.
// While a held source conflict waits (the `source-conflict-<slug>` notices on syncStatus) the word is Not
// saved and Compare runs `sync.compare` — Sync details at that conflict — and a one-time toast says
// "<canvas> differs from the project" with the same Compare (held-conflict.js; p8-held-conflict-status).

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { syncPresentation } from '../../../sync/presentation.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { shellToast } from '../../shell/util.js';
import { notify } from '../../../notifications.tsx';
import { AccessHost } from '../access/access-host.jsx';
import {
  editsInAppOnly,
  getTrashedOpen,
  sessionRole,
  subscribeTrashedOpen,
} from '../access/access-client.js';
import { indexMeta } from '../canvases/tree-model.js';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { usePresenceHost } from '../presence/use-presence-host.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { askToEdit } from './ask-to-edit.js';
import { setExportPeople } from '../export/use-export-spec.js';
import { requestShareFocus } from '../share/share-model.js';
import { menuRunner } from './menu-runner.js';
import { ModeSwitch } from './mode-switch.jsx';
import { menuCtx } from './project-menu-model.js';
import { nativeDoors } from './native-doors.js';
import { useDiskHold } from './recovery-store.js';
import { accessStatus, exportsRing, facesOf, outboxPending, saveStatus } from './save-status.js';
import { useHeldConflictToast } from './held-conflict.js';
import {
  canvasNamesBySlug,
  heldConflicts,
} from '../diagnostics/sync-details/sync-details-model.js';
import { ShareCluster } from './share-cluster.jsx';
import { presentFromLabel } from './present-from-label.js';
import { copyPresentationLink, copyRowState } from '../present/copy-link.js';
import { normalizeOpenPath } from '../../share-link.js';
import { useAccount } from './use-account.js';
import { useCanvasModeLane } from './use-canvas-mode-lane.js';
import { usePanelLayout } from './use-panel-layout.js';
import { invoke as shellInvoke, isNativeApp, openTeamServerSignIn } from '../../github.js';
import {
  chosenDisplay,
  presenterAvailable,
  usePresenterDisplays,
} from '../present/presenter-store.js';
import { servedFetch } from './served-routes.js';
import { CLOUD_CHANGED_EVENT } from '../../panels/CloudBar.jsx';
import { GitHubSignInSheet, useGitHubSignInHost } from './github-signin-host.jsx';
import {
  AccountChip,
  ProjectAccountMenu,
  ProjectAccountPopover,
  SwitchSheet,
} from './project-account-card.jsx';
import { accountFace, accountMenu, switchList, switchSheet } from './project-account-model.js';
import { ACCOUNT_MENU_EVENT } from './project-account-bus.js';
import { useSignInToast } from './project-account-toast.js';
import { connectionState, connectionWords } from './connection-state.js';
import { runTeamSwitch } from './team-switch.js';

/** 2.0.5 W4 — the team server sign-in's recorded account (`GET /_api/connections/hub`, Settings' own read). */
function useHubAccount(enabled, url) {
  const [account, setAccount] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `url` re-reads when the folder's link moves
  useEffect(() => {
    if (!enabled) {
      setAccount(null);
      return undefined;
    }
    let live = true;
    fetch('/_api/connections/hub')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live) setAccount(typeof j?.hub?.account === 'string' ? j.hub.account : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, url]);
  return account;
}

/** `{ ok, status, json }` of a same-origin JSON call (team-switch.js's `api`). */
async function jsonFetch(path, init) {
  try {
    const r = await fetch(path, init);
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

// 2.1.1 T2 — the save word beside the chip says the connection state in words (canvas 17 · ac-states):
// the two sign-in states, a server that does not answer, and this Mac offline. Its actions stay the
// status's own (the word opens Diagnostics › Sync).
const CONNECTION_WORDS = new Set(['signin-missing', 'signin-rejected', 'unreachable', 'offline']);
function withConnection(status, conn) {
  if (!conn || !CONNECTION_WORDS.has(conn.state)) return status;
  if (status?.kind === 'not-saved' && (status.conflict || status.detail)) return status;
  const w = connectionWords(conn);
  return { ...status, word: w.word, icon: w.icon, tone: w.tone, connection: conn.state };
}

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
      servedFetch('/_api/outbox')
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
      groups,
      iframesRef,
      project,
      selected,
      syncStatus,
      tabs: openTabs,
      viewerMode,
    },
    keyboardShortcuts: { totalOpen },
    tabs: { openTab, shareLinksFor },
    paletteAndPanels: { rightActive, activeOpenComments },
    // S9.22b — the unread @mention count (useCommentsShell); a shell without it keeps the open count
    comments,
  } = useShellStore();
  const { hidden: panelsHidden, userHidden: panelsUserHidden, pinned } = usePanelLayout();
  const online = useSyncExternalStore(subscribeOnline, onlineNow, () => true);
  // S9.21b — the open canvas went to the trash: Viewing, no toolbar (the server refuses its writes anyway).
  const trashedOpen = useSyncExternalStore(subscribeTrashedOpen, getTrashedOpen, () => null);

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
  // p8-e2e-rolefix — the role on the OPEN canvas, as the server resolved it (`/_config.access`): a desktop has
  // no `cloud.role`, and without it every read-only session read "Can comment" (a Can view invitee included).
  const role = sessionRole(cfg, activePath ? normalizeOpenPath(activePath, cfg?.designRel) : null);
  // p8-cloud-canvas-only-viewing — Can edit by role, Viewing in this browser frame (the frame is read-only).
  const appOnly =
    roleLimited &&
    editsInAppOnly(cfg, activePath ? normalizeOpenPath(activePath, cfg?.designRel) : null);
  const access = accessStatus({ canEdit: !roleLimited, role, appOnly });
  // S11.17 — a full disk holds writes: Not saved + "This Mac is out of space — …" until they land.
  const disk = useDiskHold();
  const doors = useMemo(() => nativeDoors(), []);
  // p8-held-conflict-status — a held source conflict: this Mac's canvas is not the project's (Not saved · Compare)
  const held = useMemo(() => heldConflicts(syncStatus), [syncStatus]);
  const compare = useCallback((slug) => menuRunner.run('sync.compare', { slug }), []);
  const conflictNames = useMemo(() => canvasNamesBySlug(groups), [groups]);
  useHeldConflictToast({ held, names: conflictNames, onCompare: compare, toast: notify });
  const status = saveStatus({
    linked,
    cloud: !!cfg?.cloud,
    online,
    phase,
    pending,
    writeFailed: disk.full ? { kind: 'disk-full' } : null,
    held: held.map((c) => c.slug),
  });
  // Show in Finder is the desktop app's door (S11.16); a browser tab has no Finder.
  const shown = doors.available
    ? { ...status }
    : { ...status, actions: status.actions.filter((a) => a.id !== 'show-in-finder') };
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
    canEdit: !viewerMode && !trashedOpen,
    role,
  });
  const faces = useMemo(
    () => facesOf({ you: gitUser, agentActive, peers: lane.peers, max: 40 }),
    [gitUser, agentActive, lane.peers]
  );
  // S8.2 — the Export sheet's one-time "Copy link" line needs to know who else is here (names only).
  useEffect(() => setExportPeople(lane.peers.map((p) => p?.name)), [lane.peers]);
  const ex = useMemo(() => exportsRing(exportCenter?.jobs), [exportCenter?.jobs]);
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const ctx = useMemo(
    () =>
      menuCtx({
        native: isNativeApp(),
        readOnly: !!viewerMode,
        observer: role === 'observer',
        canvasOpen,
        pagesView: lane.pages,
      }),
    [viewerMode, canvasOpen, role, lane.pages]
  );

  // S3.2a — the first Present row names the artboard a click would start from: the labels come from the
  // project index (the Canvases panel reads the same one), the choice from the selection / the view.
  const indexSnapshot = useCanvasIndex({ stamp: activePath });
  const boards = useMemo(
    () => indexMeta(indexSnapshot, cfg?.designRel).get(activePath)?.boards ?? null,
    [indexSnapshot, cfg?.designRel, activePath]
  );
  // S3.6b — Present ⌄ › "Presenter view on another display ✓ (<name>)": a row only where the desktop app
  // reports another display (the same read keeps the list current).
  const pv = usePresenterDisplays();
  const presenterView = presenterAvailable(pv)
    ? { name: chosenDisplay(pv)?.name ?? '', on: pv.wanted }
    : null;
  // S3.14 (G3) — Present ⌄ › Copy presentation link: enabled on a cloud link + the network (the registry's
  // `present.copy-link` enabled rule, S3.8), greyed with the reason otherwise.
  const copyLink = useMemo(
    () => copyRowState({ cloud: !!cfg?.cloud || !!cloudLinkedHub?.url, online }),
    [cfg?.cloud, cloudLinkedHub?.url, online]
  );
  // The row's click: the same copy `present.copy-link` runs from ⌘K (use-palette-and-panels.jsx), here against
  // the active canvas — the menu runner has no handler for it.
  const copyPresentation = useCallback(
    () =>
      copyPresentationLink({
        rel: normalizeOpenPath(activePath, cfg?.designRel),
        webLink: shareLinksFor?.(activePath)?.web,
        online,
        writeText: (t) => navigator.clipboard.writeText(t),
        notify: ({ title, kind }) => shellToast(title, kind === 'success'),
      }),
    [activePath, cfg?.designRel, shareLinksFor, online]
  );
  const fromLabel = useMemo(
    () => presentFromLabel({ selected, inView: canvasActiveArtboard, boards }),
    [selected, canvasActiveArtboard, boards]
  );

  // 2.1.1 T2/T4 (canvas 17 Accounts and Connections) — the account chip: its face says the kind (a
  // Maude Cloud circle, your server's tile, this Mac's laptop) with at most one badge from the
  // connection state; it and your own face open THIS project's account menu. A cloud tab's account is
  // the hub's (no chip); a browser tab on this Mac shows the facts and no Mac account.
  const native = isNativeApp();
  const acct = useAccount(!cfg?.cloud);
  const projectName = cfg?.cloud?.projectName || project;
  const gh = useGitHubSignInHost();
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctView, setAcctView] = useState('menu');
  const [pick, setPick] = useState(null); // { row, sheet } — the Switch account row being confirmed
  const [using, setUsing] = useState(false);
  const closeAcct = useCallback(() => {
    setAcctOpen(false);
    setAcctView('menu');
    setPick(null);
  }, []);
  // the account's own read once it answered (it follows a sign-out), the shell's link until then
  const linkHub = acct.linkedHub !== undefined ? acct.linkedHub : (cloudLinkedHub ?? null);
  const hubAccount = useHubAccount(!cfg?.cloud && !!linkHub?.credentialed, linkHub?.url);
  const conn = useMemo(
    () =>
      cfg?.cloud
        ? null
        : connectionState({
            linkedHub: linkHub,
            cloudUrl: acct.cloudUrl,
            syncStatus,
            phase,
            pending,
            online,
          }),
    [cfg?.cloud, linkHub, acct.cloudUrl, syncStatus, phase, pending, online]
  );
  const face = useMemo(
    () =>
      conn
        ? accountFace({
            conn,
            profile: cfg?.profile,
            cloudConnected: acct.connected,
            cloudEmail: acct.email,
          })
        : null,
    [conn, cfg?.profile, acct.connected, acct.email]
  );
  const menu = useMemo(
    () =>
      accountMenu({
        native,
        cloudTab: cfg?.cloud ?? null,
        project: projectName,
        conn,
        face,
        place: acct.place,
        hubAccount,
        pending,
        lastSyncAt: syncStatus?.lastSyncAt ?? null,
      }),
    [native, cfg?.cloud, projectName, conn, face, acct.place, hubAccount, pending, syncStatus]
  );
  const list = useMemo(
    () =>
      native && !cfg?.cloud
        ? switchList({ accounts: acct.accounts, profile: cfg?.profile, cloudEmail: acct.email })
        : null,
    [native, cfg?.cloud, acct.accounts, cfg?.profile, acct.email]
  );
  // `account.switch` (⌘K, the tab menu) opens the menu on its Switch account list
  useEffect(() => {
    const on = (e) => {
      setPick(null);
      setAcctView(e?.detail?.view === 'switch' ? 'switch' : 'menu');
      setAcctOpen(true);
    };
    window.addEventListener(ACCOUNT_MENU_EVENT, on);
    return () => window.removeEventListener(ACCOUNT_MENU_EVENT, on);
  }, []);
  // 2.0.5 W4b — a team server's sign-in: `team_sign_in_prepare` first (bind-on-sign-in for a hub), then
  // the server's own page with the folder's linked address. Words come back as one toast.
  const hubSignIn = useCallback(
    async (url) => {
      const r = await runTeamSwitch({
        url,
        native,
        invoke: shellInvoke,
        api: jsonFetch,
        openPage: openTeamServerSignIn,
        wait: (ms) => new Promise((res) => setTimeout(res, ms)),
      });
      if (r.cancelled) return;
      if (r.message) shellToast(r.message, true);
      else if (r.error) shellToast(r.error);
      if (r.ok && !r.moved)
        window.dispatchEvent(
          new CustomEvent(CLOUD_CHANGED_EVENT, { detail: { from: 'account-card' } })
        );
    },
    [native]
  );
  // The broken sign-in's one button (menu, toast): your server's own sign-in page with the address the
  // folder already names — never typed again; a Maude Cloud project signs in where Maude Cloud does.
  const fixSignIn = useCallback(
    (fix) => {
      closeAcct();
      if (fix?.path === 'hub-signin') void hubSignIn(fix.url);
      else menuRunner.run('settings.open', { tab: 'connections' });
    },
    [closeAcct, hubSignIn]
  );
  useSignInToast({
    conn,
    project: projectName,
    onFix: () => fixSignIn(menu.fix),
    toast: notify,
    enabled: !cfg?.cloud,
  });
  const confirmUse = useCallback(async () => {
    const row = pick?.row;
    if (!row) return;
    setUsing(true);
    try {
      const rebound = await shellInvoke('project_use_account', { id: row.id });
      if (rebound)
        shellToast(
          `${projectName || 'This project'} now uses ${row.kind === 'local' ? 'no account' : row.title}. Reopening it…`,
          true
        );
      closeAcct();
    } catch (e) {
      shellToast(String(e?.message || e || 'Could not switch accounts. Nothing changed.'));
    } finally {
      setUsing(false);
    }
  }, [pick, projectName, closeAcct]);
  // S9.23 — the faces' menu and people list: where people are, Follow / Go to / Bring everyone here.
  const presence = usePresenceHost({
    lane,
    boards,
    activePath,
    canSummon: !viewerMode && lane.caps.edit,
    commentsOpen: !!commentsPanelOpen,
  });

  const retry = useCallback(async () => {
    if (disk.full) {
      menuRunner.run('save.retry-held'); // S11.17 — the held writes, through the registry
      return;
    }
    try {
      const res = await fetch('/_api/sync/resync', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok)
        shellToast(json.detail || 'Could not retry. Open the Sync panel for details.');
    } catch {
      shellToast('Maude could not reach the sync service.');
    }
  }, [disk.full]);

  const designRel = cfg?.designRel || '.design';
  const openTrashed = useCallback(
    (rel) => openTab?.(`${designRel.replace(/\/+$/, '')}/${rel}`),
    [openTab, designRel]
  );

  return (
    <>
      <ShareCluster
        cloud={!!cfg?.cloud}
        accountSlot={
          <>
            <span className="sh-pa-anchor">
              <ProjectAccountPopover open={acctOpen} onClose={closeAcct}>
                {pick ? (
                  <SwitchSheet
                    sheet={pick.sheet}
                    busy={using}
                    onCancel={() => setPick(null)}
                    onConfirm={confirmUse}
                  />
                ) : (
                  <ProjectAccountMenu
                    menu={menu}
                    face={face}
                    list={list}
                    view={acctView}
                    onView={setAcctView}
                    onFix={fixSignIn}
                    onPick={(row) =>
                      setPick({
                        row,
                        sheet: switchSheet({ row, project: projectName, place: acct.place, conn }),
                      })
                    }
                    onAction={(id, params) => {
                      closeAcct();
                      if (id === 'show-in-finder')
                        void doors.revealPath(cfg?.designRel || '.design');
                      else if (id === 'retry') retry();
                      else if (id === 'review-link') {
                        // 2.1.1 T8 — an address the repo names: the Share sheet's Connect row, the one
                        // consent step; never a sign-in with that address filled in
                        requestShareFocus('connect');
                        menuRunner.run('share.open');
                      } else menuRunner.run(id, params);
                    }}
                  />
                )}
              </ProjectAccountPopover>
            </span>
            {native && face ? (
              <AccountChip
                face={face}
                accountId={cfg?.profile?.id || 'default'}
                onOpen={() => {
                  setAcctView('menu');
                  setPick(null);
                  setAcctOpen((o) => !o);
                }}
                opened={acctOpen}
              />
            ) : null}
          </>
        }
        onAccount={() => setAcctOpen((o) => !o)}
        accountOpen={acctOpen}
        faces={faces}
        onFollow={lane.follow}
        presence={presence}
        status={withConnection(shown, conn)}
        access={access}
        commentsCount={comments ? Number(comments.unreadCount) || 0 : Number(totalOpen) || 0}
        commentsCountKind={comments ? 'unread' : 'open'}
        commentsOpen={!!commentsPanelOpen}
        // P8 C3 (10 S1) - the Comments icon is drawn only when this canvas has comments (open ones, or an
        // unread mention), or while the panel is open so it can be closed from the same place.
        commentsShown={
          Number(activeOpenComments) > 0 ||
          (comments ? Number(comments.unreadCount) > 0 : Number(totalOpen) > 0) ||
          !!commentsPanelOpen
        }
        exports={ex}
        exportsOpen={!!exportCenter?.panelOpen}
        // P8 C3 (04 X1) - pressed = the PERSON hid the panels; Preview's fold is the mode's and is not a state of
        // this button (04 draws it unpressed in every Preview frame)
        panelsHidden={panelsUserHidden}
        canShare={canvasOpen}
        ctx={ctx}
        run={(id) => menuRunner.run(id)}
        onStatusAction={(id) => {
          if (id === 'retry') retry();
          else if (id === 'compare') compare(status.conflict);
          else if (id === 'show-in-finder') void doors.revealPath(cfg?.designRel || '.design');
        }}
        // S3.12 — Viewing's one way out. The flow is S9.21's (outbox kind `share.ask-to-edit`): the button runs
        // that registry action the day it exists; until then it says what to do, as the menubar does.
        onAskToEdit={() => askToEdit((id) => menuRunner.run(id), shellToast)}
        docked={pinned && !panelsHidden && !!rightActive}
        mode={lane.mode}
        present={lane.presentSpec}
        modeSlot={
          <ModeSwitch
            mode={lane.mode}
            caps={lane.caps}
            onSelect={lane.select}
            // S3.5 — Order and notes… is a registry action (minRole edit), not a way into Present.
            onPresent={(kind) =>
              kind === 'order-notes'
                ? menuRunner.run('present.order-notes')
                : kind === 'copy-link'
                  ? copyPresentation()
                  : lane.present(kind)
            }
            copyLink={copyLink}
            presentFromLabel={fromLabel}
            presenterView={presenterView}
            onPresenterView={() => menuRunner.run('present.presenter-view')}
            canPresent={canvasOpen}
            pages={lane.pages}
          />
        }
      />
      {/* S9.21b — the access states: Ask to edit's tip, the request toast, access ended / link off, trashed while open. */}
      <AccessHost
        activePath={activePath}
        designRel={designRel}
        tabs={openTabs}
        project={projectName}
        canEdit={!viewerMode}
        role={role}
        appOnly={appOnly}
        toast={notify}
        run={(id) => menuRunner.run(id)}
        onOpenTab={openTrashed}
      />
      <GitHubSignInSheet gh={gh} />
    </>
  );
}
