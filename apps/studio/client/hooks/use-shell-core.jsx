// hooks/use-shell-core.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifyDesktop, readBoolStore, readInitialTheme, readJsonStore, shellToast } from '../shell/util.js';
import { DOCK_PANELS, PANEL_SIDES_DEFAULTS, usePanelSize } from '../shell/dock.jsx';
import { ANNOT_STORE, ATTENTION_NOTIFY_COOLDOWN_MS, COLLAB_TOUR_STORE, CP_MODE_STORE, LAYERS_MODE_STORE, MDCC_VERSION, MINIMAP_STORE, PANEL_SIDES_STORE, SHOW_HIDDEN_STORE, SIDEBAR_STORE, USAGE_TOUR_STORE, ZOOMCTL_STORE, isModuleCanvasPath } from '../shell/constants.js';
import { useTreeExpansion } from '../tree-expansion.js';
import { appIsFirstRun, isNativeApp, onMenuReportBug, onUpdateReady } from '../github.js';
import { useSetupReadiness } from '../panels/SetupChecklist.jsx';
import { activeComp, resolveCompTarget } from '../panels/timeline-comp-target.js';
import { useWhatsNew } from '../whats-new.jsx';
import { useExportCenter } from '../export-center.jsx';
import { canvasTokenRefreshDelay, setLiveCanvasToken, withCanvasToken } from '../canvas-url.js';

export function useShellCore({}) {
  const [groups, setGroups] = useState([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  // Failed /_index-data attempts since the last success — the tree's loading
  // state says "still trying" instead of sitting blank (the loader retries).
  const [treeLoadFailures, setTreeLoadFailures] = useState(0);
  const addressMode = useRef('push');
  const previousAddressPath = useRef(null);
  const [project, setProject] = useState('Design');
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState(null);
  // feature-studio-file-preview — deliberately separate from `tabs`/
  // `activePath`: a previewed file was never a canvas, so it must never
  // trigger the WS `active`/`tabs` broadcasts, the compile-skeleton loading
  // state, or iframe registration that openTab()/openSystem() drive.
  const [previewPath, setPreviewPath] = useState(null);
  const onPreview = useCallback((path) => {
    addressMode.current = 'push';
    setPreviewPath(path);
  }, []);
  const [selected, setSelected] = useState(null);
  // Phase 12.3 — latest selection, readable from the (stale-closure) onMessage
  // handler so an HMR reload (triggered by a CSS/attr edit) can re-select the
  // same element and restore the in-canvas halo the remount dropped.
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Stage H (INV-3) — resolve the edit-scope (local vs shared component instance)
  // for the current single selection so the Inspector can show whether an edit
  // stays here or changes N places. Read-only GET, debounced by the selection id;
  // aborts a stale in-flight fetch when the selection changes. Fetched with
  // rendered=1 (source-usage-driven; the .map() refinement is a follow-up).
  const [editScope, setEditScope] = useState(null);
  useEffect(() => {
    const one = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
    const id = one && typeof one.id === 'string' ? one.id : null;
    if (!id || !activePath) {
      setEditScope(null);
      return;
    }
    const ac = new AbortController();
    const q = new URLSearchParams({ canvas: activePath, id });
    fetch(`/_api/edit-scope?${q}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) setEditScope(j);
      })
      .catch(() => {
        /* aborted / offline — leave the last verdict, the badge just won't show */
      });
    return () => ac.abort();
  }, [selected, activePath]);
  // feature-acp-context-hardening — halo re-apply retry ladder. A single
  // select-by-id post races the fresh iframe: dgn:'loaded' fires from the
  // inline inspector script at HTML-parse time, BEFORE the React canvas-shell
  // mounts its message listener (module fetch + mount takes 100ms–seconds), so
  // a one-shot post silently evaporates and the restored selection never gets
  // its halo back. Re-post on a fixed ladder; each attempt aborts when the
  // user meanwhile selected something else. select-by-id is idempotent
  // (replace-same → select-set echo → ws guard sees same id → no re-schedule),
  // so the ladder can't loop.
  // feature-4 dogfood fix — timestamp of the last LOCAL selection change sent
  // over WS. The ws 'selected' broadcast is both (a) our own echo and (b) a
  // genuine cross-canvas restore; within this window it's always (a) and must
  // not overwrite fresher local state (multi-select / drill races).
  const lastLocalSelectAtRef = useRef(0);
  const haloRestoreTimersRef = useRef([]);
  const scheduleHaloRestore = useCallback((one) => {
    if (!one?.id || !one.file) return;
    for (const t of haloRestoreTimersRef.current) clearTimeout(t);
    haloRestoreTimersRef.current = [50, 450, 1200, 2500, 5000].map((delay) =>
      setTimeout(() => {
        const cur = selectedRef.current;
        const c1 = Array.isArray(cur) ? cur[0] : cur;
        if (!c1 || c1.id !== one.id || c1.file !== one.file) return; // superseded
        const frame = iframesRef.current.get(one.file);
        if (!frame?.contentWindow) return;
        try {
          frame.contentWindow.postMessage(
            {
              dgn: 'select-by-id',
              id: one.id,
              artboardId: one.artboardId ?? null,
              index: one.index ?? 0,
            },
            '*'
          );
        } catch {}
      }, delay)
    );
  }, []);
  // Dogfood follow-up — the ArtboardKnobs panel (Kind/Print/Style/Hug/W-H)
  // writes via structuralWrite, which never refreshed the Inspector's OWN
  // `attrs` snapshot afterward: the artboard itself re-rendered correctly
  // (new kind, new size) but the Inspector kept showing the PRE-edit values
  // (e.g. "Digital" right after picking "Print") until the user manually
  // re-clicked the artboard. Mirrors scheduleHaloRestore's retry ladder
  // (the HMR reload lands async, so a single immediate post races it) but
  // for a bare ARTBOARD selection (no data-cd-id to key off of — compares
  // by artboardId instead of id).
  const artboardResyncTimersRef = useRef([]);
  const scheduleArtboardResync = useCallback((artboardId, file) => {
    if (!artboardId || !file) return;
    for (const t of artboardResyncTimersRef.current) clearTimeout(t);
    artboardResyncTimersRef.current = [50, 450, 1200, 2500, 5000].map((delay) =>
      setTimeout(() => {
        const cur = selectedRef.current;
        const c1 = Array.isArray(cur) ? cur[0] : cur;
        if (!c1 || c1.artboardId !== artboardId || c1.file !== file) return; // superseded
        const frame = iframesRef.current.get(file);
        if (!frame?.contentWindow) return;
        try {
          frame.contentWindow.postMessage({ dgn: 'select-by-id', artboardId }, '*');
        } catch {}
      }, delay)
    );
  }, []);
  // Phase 12.1 (DDR-138) — after a reorder writes source, the HMR reload remounts
  // the canvas and the positional data-cd-id of the moved element (and everything
  // after it) renumbers. Stash the re-settle target { file, movedId, artboardId }
  // so the dgn:'loaded' handler re-selects the moved element by its NEW id.
  const pendingReorderRef = useRef(null);
  // The last layers tree the canvas posted, and its id signature. A duplicate
  // or insert renumbers every later positional id, so the copy's NEW id already
  // names another element (the next sibling) in the pre-write tree: settling
  // on the first tree that merely contains it selected the wrong node. The
  // pending entry records the signature at request time and waits for a tree
  // that differs from it.
  const lastLayersTreeRef = useRef(null);
  const settlePendingSelectionRef = useRef(null);
  settlePendingSelectionRef.current = (tree, sig, artboardId) => {
    const pend = pendingReorderRef.current;
    if (!pend || !pend.movedId) return;
    if (pend.staleSig != null && sig === pend.staleSig) return; // still the pre-write DOM
    const has = (function find(nodes) {
      return (nodes || []).some((n) => n.id === pend.movedId || find(n.children));
    })(tree);
    if (!has) return;
    pendingReorderRef.current = null;
    const win = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
    if (win) {
      try {
        win.postMessage({ dgn: 'select-by-id', id: pend.movedId, artboardId, index: 0 }, '*');
      } catch {}
    }
  };
  // Latest `reorderLayer` (defined far below), read from the stale-closure
  // onMessage handler when the in-canvas grip posts dgn:'reorder-request'
  // (same freshness idiom as selectedRef; avoids a render-time TDZ on the
  // later useCallback).
  const reorderLayerRef = useRef(null);
  // Same freshness idiom for `repositionElement` (defined far below), read
  // when the in-canvas drag posts dgn:'reposition-request' — the coordinate-
  // mode commit for out-of-flow (position:absolute/fixed) elements.
  const repositionElementRef = useRef(null);
  // feature-element-editing-robustness Stage D — sibling ref for `resizeElement`
  // (defined far below), read when the in-canvas resize overlay posts
  // dgn:'resize-request' on pointer-up. Same origin-split as reposition.
  const resizeElementRef = useRef(null);
  // Phase 12.1 — true between a layers-panel reorder and the fresh layers-tree
  // landing. A reorder churns positional data-cd-ids, so a rapid 2nd drag would
  // target stale ids; the Layers tree gates new drags on this until the rebuilt
  // tree (with correct ids) arrives. Cleared by the layers-tree message.
  const layersBusyRef = useRef(false);
  const layersBusyTimerRef = useRef(null);
  // Phase 12 Task 4 — Layers tree for the active artboard (posted by canvas-shell).
  const [layersTree, setLayersTree] = useState(null);
  // feature-4 T7a — Layers-panel component map ({ [cdId]: { component, root,
  // usages } }) for purple instance rows. Fetched from the read-only main-origin
  // /_api/component-map on canvas/tree changes, throttled: the map only changes
  // when SOURCE changes, but the tree re-posts on any DOM churn (drag reflows) —
  // don't re-parse the canvas for those.
  const [componentMap, setComponentMap] = useState(null);
  const componentMapAtRef = useRef({ canvas: null, at: 0 });
  useEffect(() => {
    if (!activePath || !layersTree) return;
    const now = Date.now();
    const last = componentMapAtRef.current;
    if (last.canvas === activePath && now - last.at < 1500) return;
    componentMapAtRef.current = { canvas: activePath, at: now };
    fetch(`/_api/component-map?canvas=${encodeURIComponent(activePath)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && j.map && typeof j.map === 'object') setComponentMap(j.map);
        else setComponentMap(null);
      })
      .catch(() => setComponentMap(null));
  }, [activePath, layersTree]);
  const [wsConnected, setWsConnected] = useState(false);
  // Phase 8 Task 7 — git lifecycle reload prompt. Server has already flushed
  // every dirty Y.Doc to disk by the time this state populates, so accepting
  // the reload is data-loss-safe (DDR-051 §3).
  const [gitLifecycle, setGitLifecycle] = useState(null);
  // Phase 9 Task 8 — hub-down offline mode banner. Driven by the 'sync:status'
  // WS message the linked-mode sync runtime emits. null in solo mode.
  const [syncStatus, setSyncStatus] = useState(null);
  // feature-large-project-seed — the NATIVE half of seed progress.
  //
  // A seed against a large project is minutes to hours of work, and the target
  // user (DDR-177) never opens a terminal. The Sync panel is the detail view;
  // this is what reaches them when the panel is not on screen: the window
  // title while it runs, and ONE notification per phase transition.
  //
  // Per TRANSITION, never per file. A 2 961-file seed must produce two
  // notifications, not 2 961 — `send_notification` throttles on the Rust side
  // too, but a client that leans on that is a client that would spam a plain
  // browser tab through the Web fallback.
  const seedPhaseRef = useRef(null);
  useEffect(() => {
    const p = syncStatus?.files?.progress;
    if (!p) return;
    const prev = seedPhaseRef.current;
    seedPhaseRef.current = p.phase;
    if (prev === null || prev === p.phase) return;
    if (p.phase === 'converged' && (prev === 'seeding' || prev === 'paused')) {
      notifyDesktop('Project synced', `${p.delivered} files are up to date.`);
    } else if (p.phase === 'blocked') {
      const total = (p.blocked ?? []).reduce((n, b) => n + b.count, 0);
      notifyDesktop(
        'Sync needs a decision',
        `${total} file${total === 1 ? '' : 's'} could not be sent. Open the Sync panel for the reason.`
      );
    }
  }, [syncStatus?.files?.progress]);
  // The title carries the count while a seed runs, and is restored afterwards —
  // it is the one surface visible without opening anything.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const p = syncStatus?.files?.progress;
    const base = document.title.replace(/\s+—\s+syncing\s+\d+\/\d+$/, '');
    if (p && (p.phase === 'seeding' || p.phase === 'paused') && p.tracked > 0) {
      document.title = `${base} — syncing ${p.delivered}/${p.tracked}`;
    } else {
      document.title = base;
    }
    return undefined;
  }, [syncStatus?.files?.progress]);
  // DDR-218 — the folder's cloud link ({url, credentialed} | null), lifted from
  // CloudBar (status resolve / attach / detach). Gates the GitPanel's
  // cloud-managed posture; linked-but-uncredentialed keeps the full panel.
  const [cloudLinkedHub, setCloudLinkedHub] = useState(null);
  const [localProjectName, setLocalProjectName] = useState(null);
  // Phase 27 (E2) — in-UI git layer. `gitStatus` is the live dirty-state the
  // server broadcasts on `git-status`; `changesOpen` toggles the Changes panel;
  // `diffTarget` opens the before/after DiffView ({ file, conflict }).
  const [gitStatus, setGitStatus] = useState(null);
  // Phase 28 (E3) — remote ahead/behind ("Get latest" nudge). Kept in its OWN
  // slice, NOT folded into `gitStatus`, because the `git-status` WS broadcast
  // (line ~5791) replaces `gitStatus` on every dirty-state change and carries
  // only LOCAL status — merging remote-ahead into it would be clobbered on the
  // next keystroke. The probe is a real network `git fetch` (server-side, token
  // from the keychain bridge), so it runs on a slow cadence — mount, a periodic
  // tick, and after each git action — never on the per-edit WS path.
  const [remoteSync, setRemoteSync] = useState(null); // { remoteAhead, behind } | null
  const [changesOpen, setChangesOpen] = useState(false);
  // feature-sync-progress-modal — the per-file Sync panel; toggled from the
  // status-bar HUB SYNC chip. Only available while `syncStatus` is non-null
  // (a linked project), mirroring how `changes` gates on `gitStatus.repo`.
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [diffTarget, setDiffTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [systemData, setSystemData] = useState(null);
  // Canvas-compile skeleton (single-canvas model → one path at a time).
  const [loadingPath, setLoadingPath] = useState(null);
  const loadFallbackTimer = useRef(null);
  // issue #115 — a canvas that never reported `loaded`. `{ path, kind }`, where
  // kind is 'server' (the canvas origin did not answer /_health — a dead or
  // respawned sidecar) or 'compile' (the origin is up, the canvas itself never
  // mounted). Rendered instead of the blank pane the cap used to leave behind.
  const [canvasError, setCanvasError] = useState(null);
  // Bumped by the error panel's Retry. Folded into the iframe `key` so a retry
  // REMOUNTS the frame — re-setting `src` to the identical URL would not
  // re-navigate, and after a respawn the URL is identical in every case except
  // the port that `loadServerConfig()` is about to correct.
  const [canvasReloadNonce, setCanvasReloadNonce] = useState(0);
  // The canvas whose SHELL DOCUMENT has actually loaded, per its `dgn:'loaded'`
  // post. Distinct from `!loadingPath`, which the 2.5 s onLoad fallback and the
  // 15 s cap also clear — this one only ever means "the shell ran". That makes
  // it the honest signal for `data-canvas-state` below, and the one the #115 E2E
  // scenario asserts: the shell's inline script posts it whether or not the
  // canvas TSX went on to build, so it isolates "the origin was reachable" from
  // "the canvas compiled" — exactly the axis #115 is about.
  const [loadedPath, setLoadedPath] = useState(null);
  // Resizable side panels (DS components-resize-panels) + the active drag side.
  const sbSize = usePanelSize('maude-sb-w', { min: 200, max: 420, def: 252 });
  const rpSize = usePanelSize('maude-rp-w', { min: 260, max: 480, def: 304 });
  const [dragSide, setDragSide] = useState(null); // 'sb' | 'rp' | null
  const bodyRef = useRef(null);

  // Pointer drag for the panel grips — window listeners while dragging (the
  // grip also pointer-captures, and `.st-body.is-resizing iframe` drops pointer
  // events so the canvas iframe can't swallow the move stream mid-drag).
  useEffect(() => {
    if (!dragSide) return;
    const onMove = (e) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (dragSide === 'sb') sbSize.setW(e.clientX - rect.left);
      else rpSize.setW(rect.right - e.clientX);
    };
    const onUp = () => setDragSide(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragSide, sbSize.setW, rpSize.setW]);

  // Loading-skeleton lifecycle: dgn:'loaded' clears it instantly (TSX canvases);
  // the iframe load event arms a short fallback for legacy .html canvases that
  // never post it; a hard cap guards against a canvas that dies mid-compile.
  const onIframeLoad = useCallback((path) => {
    // A module canvas reports its own render; the iframe `load` event fires
    // long before it has drawn anything, so a timer here would only bring
    // back the white pane.
    if (isModuleCanvasPath(path)) return;
    clearTimeout(loadFallbackTimer.current);
    loadFallbackTimer.current = setTimeout(() => {
      setLoadingPath((p) => (p === path ? null : p));
    }, 2500);
  }, []);
  // Loaded at boot from /_config and re-fetched on the server's
  // `config-updated` push (config.json hot-reload — /design:setup-ds rewrites
  // it mid-session) — informs canvasUrl() so TSX iframes can pass the right
  // ?designRel + ?tokens query to the canvas mount shell.
  // `cloud` is deliberately TRI-STATE, and the third state is the useful one:
  //   undefined — `/_config` has not answered yet; which shell this is is
  //               UNKNOWN, and anything that would behave differently in the
  //               two shells must wait rather than assume the desktop.
  //   null      — desktop or plain local browser.
  //   object    — a cloud tab (`{ dashboardUrl?, projectName, user, role }`).
  //
  // Collapsing unknown into "not cloud" is what made the cloud studio open with
  // two console 404s every time: the sign-in bar and the export centre mounted
  // for one frame, each fired the request its shell exists to refuse, and then
  // unmounted. Nothing was broken and everything looked broken.
  const [cfg, setCfg] = useState({ designRel: '.design', cloud: undefined });
  // THE CAP MUST NOT CLEAR TO WHITE — issue #115. This used to be a bare
  // `setLoadingPath(null)`, which is the most useless thing it could do: when
  // the canvas origin is unreachable the shell HTML never loads, so the shell's
  // own `#canvas-mount-error` surface (templates/_shell.html) does not exist to
  // report anything, and dropping the skeleton left a blank pane with no error,
  // no reason and no way back inside the app. Probe the canvas origin to tell
  // the two failures apart — a dead server (the #115 stale-origin case, and any
  // sidecar crash) versus a canvas that genuinely never finished compiling —
  // and hand the user the recovery in both cases.
  //
  // DECLARED AFTER `cfg`, ON PURPOSE — the same rule the block below states for
  // the git flags, and this effect is what taught us it is not decorative. Its
  // dependency array reads `cfg?.canvasOrigin`, and A DEPENDENCY ARRAY IS
  // EVALUATED DURING RENDER: sitting above the `useState` above, it hit `cfg` in
  // its temporal dead zone, so `App` threw `Cannot access 'cfg' before
  // initialization` on its very first render and the WHOLE STUDIO mounted
  // nothing — a white page for every user, not only the desktop shell the fix
  // was written for. It reached the branch because the PR carried a merge
  // conflict, which stops GitHub from building a merge ref, which means the
  // client-boot gate never ran on it (issue #112 close-out).
  // Once the shell has said `loaded` the origin is demonstrably up and the
  // wait is the canvas building — on a cold cloud canvas that can outlast 15 s
  // without anything being wrong, so the cap stretches instead of calling it a
  // failure. The shell reports a real build error itself (`canvas-failed`).
  const shellAlive = !!loadingPath && loadedPath === loadingPath;
  useEffect(() => {
    if (!loadingPath) return;
    const path = loadingPath;
    const cap = setTimeout(async () => {
      let kind = 'compile';
      try {
        const r = await fetch(`${cfg?.canvasOrigin || ''}/_health`, {
          cache: 'no-store',
        });
        if (!r.ok) kind = 'server';
      } catch {
        kind = 'server';
      }
      setCanvasError({ path, kind });
      setLoadingPath((p) => (p === path ? null : p));
    }, shellAlive ? 60000 : 15000);
    return () => clearTimeout(cap);
  }, [loadingPath, shellAlive, cfg?.canvasOrigin]);
  // WHO IS SAVING THIS PROJECT — one expression, read by every surface that
  // would otherwise offer to save it, poll for it, or badge it (DDR-218, widened
  // by feature-cloud-managed-git-posture).
  //
  // These two flags were previously derived at the GitPanel call site alone, so
  // the panel withdrew correctly while the toolbar menu and the status-bar chip
  // kept rendering a raw dirty count from `gitStatus.files.length` — the very
  // "lie about work that is already saved" the withdrawal exists to delete. The
  // count is the claim, wherever it is drawn; hoisting the rule here is what
  // keeps a third surface from re-introducing it.
  //
  // DECLARED HERE, AT THE TOP, ON PURPOSE. Every local-git POLL below is gated
  // on it, and a dependency array evaluates during render — a `const` further
  // down would be in its temporal dead zone at the first `useEffect` that names
  // it. The same hazard the remote-sync effect's own comment records.
  //
  // PRESENTATION, NOT A CONTROL — unchanged from DDR-218. `.git` is untouched:
  // no hook is installed, no config is written, a terminal `git status` /
  // `git commit` behaves exactly as before, the local `/_api/git/*` routes keep
  // exactly their old gates, and `git/watch.ts` still flushes a terminal
  // `git checkout` into Yjs (DDR-051). What stops is MAUDE's own local git
  // activity — the polls and the surfaces that describe a repo nobody is
  // editing through. Disconnect restores every one of them live.
  const cellManaged = !!cfg.cloud;
  const cloudManaged = !cfg.cloud && !!cloudLinkedHub?.credentialed;
  const savingIsManaged = cellManaged || cloudManaged;
  // The raw truth stays available for surfaces that legitimately need it (the
  // panel's own file list); only the COUNT — the thing that reads as a to-do —
  // is withheld when this project's saving is somebody else's job.
  const unsavedCount = savingIsManaged ? 0 : gitStatus?.files?.length || 0;
  // The posture, readable from callbacks that must NOT re-subscribe when it
  // flips: the WS handler is installed once for the socket's lifetime, and the
  // two git-status refreshers are `useCallback([])`s a dozen call sites depend
  // on being stable. A ref is how they read a live value without becoming a
  // reason to tear the socket down.
  const savingIsManagedRef = useRef(savingIsManaged);
  savingIsManagedRef.current = savingIsManaged;
  // Cloud Phase 25 C2 — viewer role, known at boot from /_config. Every
  // editing affordance in the shell gates on this (absent, not hidden).
  const viewerMode = !!cfg.readOnly;
  const loadServerConfig = useCallback(() => {
    fetch('/_config')
      .then((r) => r.json())
      .then((data) => {
        const designRel = (data.designRoot || '.design').replace(/^\/+|\/+$/g, '');
        // Functional merge — the `/_config` and `/_index-data` fetches race, and
        // the latter contributes `canvasDesignSystems` (DDR-093). A full-replace
        // here would clobber that map if it resolved second.
        setCfg((prev) => ({
          ...prev,
          designRel,
          tokensCssRel: data.tokensCssRel,
          // Pass through designSystems so canvasUrl can resolve the right
          // tokens/components paths per-DS. Top-level tokensCssRel is the
          // legacy default; designSystems[0].tokensCssRel is the project's
          // authoritative value (post DS-bootstrap).
          designSystems: data.designSystems,
          // T2 (9.1-A) — segregated canvas-content origin. canvasUrl() prepends
          // it so iframes load cross-origin (hub-pushed JSX is then walled off
          // from the main origin's /_api). Absent on older servers → relative
          // URL fallback keeps same-origin behavior.
          canvasOrigin: data.canvasOrigin,
          // Cloud Phase 25 C2 — the linked hub vouched a `viewer` role at
          // sign-in. Known at BOOT (before anything draws), so editing
          // affordances are ABSENT rather than shown-then-refused. This flag
          // decides what the UI offers; the cell (C1) and the dev-server's
          // read-only gate (http.ts) are what actually stop a write.
          readOnly: !!data.readOnly,
          // V2-1.12 §5.6 — the project's file format, the gate when this build
          // does not edit it ({ projectFormat, supported, source } | null), and
          // why `readOnly` holds: 'role' | 'format' | null. FormatGateBanner
          // (V2-2.18 P1) and the v2 "Update project" dialog read these.
          formatVersion: data.formatVersion ?? 1,
          formatGate: data.formatGate ?? null,
          readOnlyReason: data.readOnlyReason ?? null,
          // Cloud Phase 27 (DDR-209) — the capability that opens the cookieless
          // canvas origin. `canvasUrl()` appends it to every iframe URL. Absent
          // on a desktop, where the canvas origin is loopback and needs none.
          //
          // NOTE FOR WHOEVER ADDS THE NEXT FIELD: this is an explicit
          // projection, not a spread of `data`. A field the server starts
          // returning does NOT arrive here until it is named — which is how
          // both of these went missing and the cloud studio rendered without
          // its chrome and with every canvas iframe unauthenticated.
          canvasToken: data.canvasToken,
          // Which release this server is — rendered as the status-bar chip.
          // Undefined on a server too old to report it, which is why the chip
          // renders conditionally rather than printing `vundefined`.
          version: data.version,
          // C2/C4 — `{ dashboardUrl?, projectName, user, role }` when this is a
          // cloud tab. Its presence is what tells the shared client it is in a
          // browser tab on somebody else's machine; `user`/`role` are what let
          // it say WHICH account that tab is, and offer the way out.
          cloud: data.cloud ?? null,
          // feature-cloud-export-render-workers — `local` | `remote` | `none`.
          // Which export formats this server can actually produce; the export
          // dialogs gate on it. Absent on older servers → undefined, treated
          // as `local` (the pre-lane behavior) everywhere it is read.
          exportLane: data.exportLane,
          // DDR-247 — the apps allowed to frame this studio. Read by the
          // `?embed=1` root (embed-view.jsx), which never mounts <App>; named
          // here so the projection stays total (config-projection.test.ts).
          embedOrigins: data.embedOrigins,
        }));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadServerConfig();
  }, [loadServerConfig]);
  // Backfill the sync banner on mount from /_sync-status. The 'sync:status' WS
  // broadcast is one-shot for the zero-syncable case (DDR-060 / 9.1-D), so a
  // tab that connects after boot would otherwise miss it. {linked:false} (solo)
  // leaves the banner null.
  useEffect(() => {
    let cancelled = false;
    fetch('/_sync-status')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data || data.linked === false) return;
        setSyncStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Phase 27 (E2) — seed the git dirty-state on mount; live updates arrive over
  // the `git-status` WS broadcast (Task 5). Solo/non-git projects → repo:false.
  //
  // NOT WHILE SOMEBODY ELSE IS COMMITTING. In cloud-managed posture this asks
  // about a repo the user is not editing through, and every answer it brings
  // back is drawn somewhere as a claim about their work. Reactive on
  // `savingIsManaged`, not mount-only, so Disconnect resumes it live and
  // Connect stops it live — the requirement `git-cloud-posture.test.ts`
  // already pins for the panel.
  useEffect(() => {
    if (savingIsManaged) {
      // Drop what the local repo last said, too. A stale `gitStatus` left
      // standing keeps the tree's M/A/D badges lit after the posture changed.
      setGitStatus(null);
      return undefined;
    }
    let cancelled = false;
    fetch('/_api/git/status')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data) setGitStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savingIsManaged]);
  const [commentsByFile, setCommentsByFile] = useState({}); // { file: [Comment] }
  // Phase 6 — the in-iframe composer owns drafting; the shell no longer holds
  // a `draft` state. Mutations route through postMessage → WS instead.
  const [focusedCommentId, setFocusedCommentId] = useState(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [commentsFilter, setCommentsFilter] = useState('open'); // 'all' | 'open' | 'resolved'
  const [theme, setTheme] = useState(readInitialTheme);
  // DDR-171 — CSS-panel vocabulary mode ('advanced' | 'designer'), App-owned so
  // the in-panel corner toggle (CssKnobs) and Settings → Appearance share one
  // source of truth; persisted to `maude-cp-mode` (same pattern as `theme`).
  const [cpMode, setCpMode] = useState(() => {
    const m = readJsonStore(CP_MODE_STORE, 'advanced');
    return m === 'designer' ? 'designer' : 'advanced';
  });
  useEffect(() => {
    try {
      localStorage.setItem(CP_MODE_STORE, JSON.stringify(cpMode));
    } catch {}
  }, [cpMode]);
  const [openMenu, setOpenMenu] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => readBoolStore(SIDEBAR_STORE, true));
  const [showHidden, setShowHidden] = useState(() => readBoolStore(SHOW_HIDDEN_STORE, false));
  // Issue #124 — folder + section disclosure of the Files panel, remembered
  // per project on disk (tree-expansion.js). Absent ⇒ closed.
  const treeExp = useTreeExpansion();
  const updateTreeExp = treeExp.update;
  const sectionsExpanded = treeExp.state.sections;
  const [helpOpen, setHelpOpen] = useState(false);
  const [reportBugOpen, setReportBugOpen] = useState(false);

  // Native Help ▸ Report a Bug… (menu.rs emits `menu://report-bug`) — same
  // lane as IdentityBar's File ▸ New Project… subscription.
  useEffect(() => {
    if (!isNativeApp()) return;
    const p = onMenuReportBug(() => setReportBugOpen(true));
    return () => {
      p.then((un) => un()).catch(() => {});
    };
  }, []);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [brandUploadOpen, setBrandUploadOpen] = useState(false);
  const [figmaImportOpen, setFigmaImportOpen] = useState(false);
  // DDR-166 plan, Phase 2 (T7) — the persistent "Setup" affordance in the empty
  // canvas state (below) only renders while the project's own setup (design
  // system / first canvas / brand assets) is incomplete; native-only concern.
  const { report: setupReadiness } = useSetupReadiness(isNativeApp());
  // ? cheat-sheet (DS components-shortcuts-overlay) — separate from the deep
  // Help modal (F1), which keeps commands & flows.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // T5/T6 (Plan C) — shell-level export/handoff dialog + inspector panel state.
  // The palette (T4) drives them; the dialog (T5) + panel (T6) consume them.
  const [shareDialog, setShareDialog] = useState(null);
  const [exportDialog, setExportDialog] = useState(null); // null | { mode: 'export'|'handoff', scope? }
  // feature-ai-media-generation (DDR-16x) — BYOK provider-key Settings modal +
  // the AI generate action.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // feature-configurable-panel-docking — Layers as its own openable panel (when
  // layersMode==='separate'), plus the per-panel side map + layers mode. All
  // three hydrate from disk (/_api/ui-prefs) on mount and persist on change,
  // mirroring the view-pref pattern.
  const [layersOpen, setLayersOpen] = useState(false);
  const [panelSide, setPanelSide] = useState(() =>
    readJsonStore(PANEL_SIDES_STORE, PANEL_SIDES_DEFAULTS)
  );
  const [layersMode, setLayersMode] = useState(() => {
    try {
      const v = localStorage.getItem(LAYERS_MODE_STORE);
      if (v === 'separate' || v === 'in-inspector') return v;
    } catch {}
    return 'separate';
  });
  // DDR-148 — Timeline panel (right dock) for scrubbing a video-comp. `activeComps`
  // is populated from the iframe's `timeline-comps` announce; `timelineFrame` from
  // its live `timeline-frame`. Empty comps ⇒ the panel shows its empty state.
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [activeComps, setActiveComps] = useState([]);
  const [timelineFrame, setTimelineFrame] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  // Default off — looping is an explicit opt-in per session, not a surprise
  // once the user presses Play (rca/issue-video-artboard-loop-defaults-on).
  const [timelineLoop, setTimelineLoop] = useState(false);
  const [timelineMuted, setTimelineMuted] = useState(false);
  const [timelineVolume, setTimelineVolume] = useState(1);
  const [timelineHeight, setTimelineHeight] = useState(216);
  // The artboard nearest the viewport centre (reported by canvas-lib on pan) —
  // the Timeline follows THIS, so it redraws as you move across the canvas.
  const [canvasActiveArtboard, setCanvasActiveArtboard] = useState(null);
  // DDR-148 — parsed sequence/keyframe rows for the Timeline (from raw .tsx).
  const [timelineSequences, setTimelineSequences] = useState([]);
  const [timelineAudio, setTimelineAudio] = useState([]);
  // Task 5 — seam transitions between series beats ({ afterIndex, dur }).
  const [timelineTransitions, setTimelineTransitions] = useState([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  // rca/issue-video-artboard-frame-reset-on-edit — last known playhead, read
  // from the `timeline-comps` handler below (which fires on every comp
  // (re)mount, incl. a ⌘R hard iframe reload) to re-seed the fresh Player
  // instance. A ref, not state, so the handler always sees the latest value
  // without pulling `timelineFrame` into that big message-listener's deps.
  const timelineFrameRef = useRef(0);
  useEffect(() => {
    timelineFrameRef.current = timelineFrame;
  }, [timelineFrame]);
  // The DCArtboard id the timeline scoped to (from parseCompTimeline). Used for
  // /_api/comp-clips + every clip op so the enumerator targets the SAME comp the
  // rows came from — `timelineCompId` is the Player's `videocomp-N` id, which
  // never matches a DCArtboard id and made the enumerator fall back to the wrong
  // comp on a multi-comp canvas (the showreel badge/replace/op mis-scope).
  const [timelineArtboardId, setTimelineArtboardId] = useState(null);
  const timelineArtboardIdRef = useRef(null);
  useEffect(() => {
    timelineArtboardIdRef.current = timelineArtboardId;
  }, [timelineArtboardId]);
  // On a multi-comp canvas the Timeline drives ONE comp: the one mounted in the
  // artboard whose rows the panel is drawing. Resolved by artboard identity
  // (announced by video-comp.tsx), NOT by duration — two comps of equal length
  // made the old duration match return the first artboard's Player, so scrub +
  // playback moved a comp the user wasn't even looking at (issue #75).
  const timelineCompId = useMemo(
    () =>
      resolveCompTarget(activeComps, {
        // Both signals, in confidence order: the artboard the ROW PARSER scoped
        // to (lexical, from the .tsx) then the viewport-active one canvas-lib
        // reports on pan (structural). See resolveCompTarget — when the two
        // disagree, the one that names a comp actually mounted there wins.
        artboardId: [timelineArtboardId, canvasActiveArtboard],
        total: timelineTotal,
      }),
    [activeComps, timelineArtboardId, canvasActiveArtboard, timelineTotal]
  );
  const timelineCompIdRef = useRef(null);
  useEffect(() => {
    timelineCompIdRef.current = timelineCompId;
  }, [timelineCompId]);
  // Frame math (drop position, split, overlay insert) must use the timebase of
  // the comp the Timeline is actually on — `activeComps[0].fps` silently used
  // the first artboard's (issue #75).
  const timelineFps = useMemo(
    () => activeComp(activeComps, timelineCompId)?.fps || 30,
    [activeComps, timelineCompId]
  );
  // feature-enhanced-video-editing (Task 3) — the timeline's single-select model.
  // Holds the selected clip's stableId (NOT a row index — DDR-150), so the
  // selection survives comp-clips refetches, reorders, and external file edits.
  const [timelineSelectedClip, setTimelineSelectedClip] = useState(null);
  // Task 8 — bumped after a concurrent-edit refusal so the source + comp-clips
  // effects refetch ("Timeline changed — reloaded, try again").
  const [timelineRefresh, setTimelineRefresh] = useState(0);
  const timelineOpFailed = useCallback((prefix, msg) => {
    if (/concurrent edit|changed since it was read/i.test(msg || '')) {
      shellToast('Timeline changed — reloaded, try again.');
      setTimelineRefresh((n) => n + 1);
    } else {
      shellToast(`${prefix}: ${msg || 'failed'}`);
    }
  }, []);
  // Phase 31 (DDR-123) — the native ACP chat sidepanel (right dock, native-only).
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantUnseen, setAssistantUnseen] = useState(false);
  const assistantOpenRef = useRef(assistantOpen);
  useEffect(() => {
    assistantOpenRef.current = assistantOpen;
    if (assistantOpen) {
      setAssistantUnseen(false); // opening clears the unseen badge
      // Ask for notification permission on a real user gesture (panel open).
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      } catch {
        /* notifications unavailable */
      }
    }
  }, [assistantOpen]);
  // ChatPanel owns one connection PER CHAT (so chats run in parallel in the
  // background) and reports up here: `onBusyChange` for the menubar pulse, and
  // `onFinished` when any chat's turn ends — badge + notify if you weren't looking.
  const handleAssistantFinished = useCallback(() => {
    if (!assistantOpenRef.current || document.hidden) {
      setAssistantUnseen(true);
      notifyDesktop('Claude finished', 'Your assistant turn is ready in Maude.');
    }
  }, []);
  // DDR-185 — same "you weren't looking" gate as handleAssistantFinished
  // above, fired instead when a chat is PAUSED waiting on the user (a
  // permission prompt or an AskUserQuestion/elicitation form), not just when
  // a turn completes. A stalled turn otherwise gives no signal at all if the
  // window isn't focused. Distinct copy so it doesn't read as "done".
  //
  // Security-review addendum (Finding G): DDR-179/180 already cap concurrent
  // pending requests at 10 permissions + 5 elicitations, so a single
  // adversarial turn can legitimately queue up to 15 DISTINCT approval
  // decisions — each one now fires a real OS Notification, which is exactly
  // the burst that manufactures the "rapid Enter-mashing" precondition
  // DDR-179's own addendum already treats as a security-relevant habituation
  // risk. The in-app badge (setAssistantUnseen) still reflects EVERY new
  // request instantly — only the OS notification itself is rate-limited, so
  // a burst reads as one attention-getting ping, not fifteen.
  const lastAttentionNotifyRef = useRef(0);
  const handleAssistantAttention = useCallback(() => {
    if (!assistantOpenRef.current || document.hidden) {
      setAssistantUnseen(true);
      const now = Date.now();
      if (now - lastAttentionNotifyRef.current < ATTENTION_NOTIFY_COOLDOWN_MS) return;
      lastAttentionNotifyRef.current = now;
      notifyDesktop('Maude needs your input', 'Claude is waiting on an approval or a question in Maude.');
    }
  }, []);
  // Inspector tab is lifted so View ▸ Layers can open the panel ON the Layers
  // tab (the menu item sat disabled as "Phase 12" long after the tab shipped).
  const [inspectorTab, setInspectorTab] = useState('inspect');
  // feature-photo-editor (Task 13) — the annotation-image Photo-tab target,
  // threaded up from the annotation layer's "Edit Photo…" (the annotation model
  // has no DOM selection to ride, unlike an artboard `<img>`). `{ asset, strokeId }`
  // or null. Cleared whenever a normal DOM selection arrives so the two never
  // fight over the panel. The shell-side photo undo stack lives alongside it.
  const [photoSel, setPhotoSel] = useState(null);
  const photoUndoRef = useRef({ undo: [], redo: [] });
  // Bumped by the Cmd+Z/Cmd+Shift+Z photo-undo handler below so the mounted
  // PhotoKnobs (keyed on `asset:photoRev`) remounts and re-fetches the sidecar
  // it just PUT, instead of drifting from its own stale local `edit` state.
  const [photoRev, setPhotoRev] = useState(0);
  // feature-element-editing-robustness Stage C — auto-open the Inspector on the
  // CSS tab when a fresh single selection arrives AND no right panel is already
  // open. Preference-backed (default ON); disable it in the View menu. Refs keep
  // the postMessage selection listener stale-closure-safe.
  const [autoOpenInspector, setAutoOpenInspector] = useState(() => {
    try {
      return localStorage.getItem('maude-auto-open-inspector') !== '0';
    } catch {
      return true;
    }
  });
  const autoOpenInspectorRef = useRef(autoOpenInspector);
  useEffect(() => {
    autoOpenInspectorRef.current = autoOpenInspector;
    try {
      localStorage.setItem('maude-auto-open-inspector', autoOpenInspector ? '1' : '0');
    } catch {
      /* private mode / storage disabled */
    }
  }, [autoOpenInspector]);
  // Whether ANY right-dock panel is open — the auto-open guard reads this ref so
  // it never steals focus from an already-open panel (the user's explicit rule).
  const anyRightPanelOpenRef = useRef(false);
  useEffect(() => {
    anyRightPanelOpenRef.current =
      inspectorOpen || commentsPanelOpen || changesOpen || syncPanelOpen || assistantOpen;
  }, [inspectorOpen, commentsPanelOpen, changesOpen, syncPanelOpen, assistantOpen]);
  // The right dock holds exactly ONE panel (Changes / Inspector / Comments) at
  // a time — opening any panel REPLACES whatever was there. These two helpers
  // are the single source of that invariant; every open/toggle path routes
  // through them. (Before, the three booleans were flipped independently across
  // ~13 call sites and only some closed their siblings, so a panel opened via a
  // path that left a sibling `true` rendered *behind* it under the fixed
  // precedence — looking like the new panel "overlapped" the old one.)
  // feature-configurable-panel-docking — generic, SIDE-AWARE panel management.
  // A slot (left/right) shows one panel at a time, so opening a panel closes any
  // OTHER open panel ON THE SAME SIDE (panels on the other side are independent).
  // A live ref carries the current open + side maps so the callbacks stay stable
  // yet never act on stale state. (The Timeline is a BOTTOM dock, DDR-148, and is
  // NOT part of either slot's mutual-exclusion.)
  const panelStateRef = useRef({ open: {}, side: PANEL_SIDES_DEFAULTS });
  panelStateRef.current = {
    open: {
      tree: sidebarOpen,
      layers: layersOpen,
      inspector: inspectorOpen,
      comments: commentsPanelOpen,
      changes: changesOpen,
      sync: syncPanelOpen,
      assistant: assistantOpen,
    },
    side: panelSide,
  };
  const setPanelOpen = useCallback((id, val) => {
    if (id === 'tree') setSidebarOpen(val);
    else if (id === 'layers') setLayersOpen(val);
    else if (id === 'inspector') setInspectorOpen(val);
    else if (id === 'comments') setCommentsPanelOpen(val);
    else if (id === 'changes') setChangesOpen(val);
    else if (id === 'sync') setSyncPanelOpen(val);
    else if (id === 'assistant') setAssistantOpen(val);
  }, []);
  const sideOf = useCallback(
    (id) => panelStateRef.current.side?.[id] || PANEL_SIDES_DEFAULTS[id],
    []
  );
  const openPanelExclusive = useCallback(
    (id) => {
      const side = sideOf(id);
      setPanelOpen(id, true);
      for (const p of DOCK_PANELS) {
        if (p.id !== id && sideOf(p.id) === side) setPanelOpen(p.id, false);
      }
    },
    [setPanelOpen, sideOf]
  );
  const togglePanel = useCallback(
    (id) => {
      if (panelStateRef.current.open?.[id]) setPanelOpen(id, false);
      else openPanelExclusive(id);
    },
    [openPanelExclusive, setPanelOpen]
  );
  // Legacy name kept for the many call sites; now side-aware (opens `which` and
  // closes only same-side siblings, so a panel moved to the left is unaffected).
  const openRightPanel = openPanelExclusive;
  const toggleRightPanel = togglePanel;
  // feature-element-editing-robustness Stage C (Task C1) — open the Inspector on
  // the CSS tab for a fresh SINGLE selection, but only when nothing is already
  // docked on the right (never override an open Layers/Inspect/Comments panel)
  // and only when the preference is on. Idempotent: once the inspector is open,
  // the `anyRightPanelOpen` guard stops it re-firing on the next selection.
  const maybeAutoOpenInspectorOnSelect = useCallback(
    (sel) => {
      if (!autoOpenInspectorRef.current) return;
      if (viewerMode) return; // Cloud Phase 25 C2 — inspector is edit chrome
      if (!sel || !sel.id) return; // need a stable element id to inspect
      if (anyRightPanelOpenRef.current) return; // don't steal from an open panel
      openRightPanel('inspector');
      setInspectorTab('css');
    },
    [openRightPanel, viewerMode]
  );
  // DDR-148 — the Timeline is a BOTTOM dock, independent of the right rail: it
  // toggles on its own and coexists with Inspector/Changes/Comments/Chat.
  const toggleTimeline = useCallback(() => setTimelineOpen((v) => !v), []);
  const whatsNew = useWhatsNew(MDCC_VERSION);
  // Same tri-state rule as the sign-in bar: hydrating before the shell is
  // known 404s every boot. On desktop (`cloud === null`) the export queue is
  // the LOCAL job runner, always on. In a cloud tab it hydrates only when the
  // cell actually holds a jobs lane (`exportLane === 'remote'`) — a cell
  // without a render service still refuses `/_api/export-jobs` outright
  // (DDR-209 D1 posture, now lane-scoped by feature-cloud-export-render-workers).
  const exportCenter = useExportCenter({
    enabled: cfg.cloud === null || cfg.exportLane === 'remote',
  });
  // Phase 29 (E4) — first-run onboarding wizard. The native shell boots a minimal
  // "welcome" project on first launch; we ask it whether this is a first run and, if
  // so, show the wizard OVER the (empty) canvas browser. Completing any door switches
  // the sidecar to a real project (the webview reloads → first-run is then false).
  const [firstRun, setFirstRun] = useState(false);
  // Offer the collab "rychlý kurz" once, AFTER onboarding (native app, not first run,
  // not yet seen). A returning user who already took it isn't re-nudged.
  const [collabNudge, setCollabNudge] = useState(false);
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let alive = true;
    appIsFirstRun()
      .then((v) => {
        if (!alive) return;
        setFirstRun(!!v);
        if (!v && !readBoolStore(COLLAB_TOUR_STORE, false)) setCollabNudge(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const markCollabSeen = useCallback(() => {
    setCollabNudge(false);
    try {
      localStorage.setItem(COLLAB_TOUR_STORE, '1');
    } catch {}
  }, []);
  // Phase 32 (Task 1) — auto-update. The native shell downloads + stages a newer
  // build in the background and emits `update-ready`; we surface a non-blocking
  // banner. Native-only (the web studio is updated by its own deploy).
  const [updateReady, setUpdateReady] = useState(null);
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let un;
    onUpdateReady((p) => setUpdateReady(p && typeof p === 'object' ? p : {}))
      .then((fn) => {
        un = fn;
      })
      .catch(() => {});
    return () => {
      try {
        un?.();
      } catch {}
    };
  }, []);
  const [tourSteps, setTourSteps] = useState(null);
  const [usageNudge, setUsageNudge] = useState(() => !readBoolStore(USAGE_TOUR_STORE, false));
  const startTour = useCallback((steps) => {
    setTourSteps(Array.isArray(steps) && steps.length ? steps : null);
  }, []);
  // Guided-tour bus — the overlay calls setup() before each step to put the shell
  // into the state the step spotlights: open a canvas, open the Inspector, switch
  // its tab. The canvas iframe is cross-origin (DDR-054) so the tour can't select
  // an element for the user; requireSelection steps instead wait for a real
  // ⌘-click. Plain object (the overlay refs it), so per-render churn is harmless.
  const tourBus = {
    setup: (step) => {
      if (!step) return;
      if ((step.canvas || step.requireSelection) && tabs.length === 0) {
        openPanelExclusive('tree');
        setTimeout(() => {
          try {
            document.querySelector('.st-sidebar [data-testid^="canvas-row-"]')?.click();
          } catch {}
        }, 80);
      }
      if (step.inspector || step.tab || step.requireSelection) openRightPanel('inspector');
      if (step.tab) setInspectorTab(step.tab);
      // Phase 29 (E4) collab tour — open the Changes panel so the Save / Publish /
      // Get-latest controls the action steps spotlight actually exist to anchor on.
      if (step.changes) openRightPanel('changes');
    },
  };
  const markUsageSeen = useCallback(() => {
    setUsageNudge(false);
    try {
      localStorage.setItem(USAGE_TOUR_STORE, '1');
    } catch {}
  }, []);
  const [annotationsVisible, setAnnotationsVisible] = useState(() =>
    readBoolStore(ANNOT_STORE, true)
  );
  // feature-unified-settings-modal — gate the disk-write effect until the boot
  // GET /_api/ui-prefs has reconciled (disk-wins), so we never clobber a stored
  // pref with the localStorage/default value on the first render.
  const [uiPrefsHydrated, setUiPrefsHydrated] = useState(false);
  // Canvas-chrome visibility (View menu). minimap + zoom-controls are
  // persistent prefs broadcast to every open canvas iframe; presentMode is a
  // non-destructive "hide ALL chrome + shell, artboards only" overlay with an
  // Esc / floating-pill escape hatch back to the chrome.
  const [minimapVisible, setMinimapVisible] = useState(() => readBoolStore(MINIMAP_STORE, false));
  const [zoomCtlVisible, setZoomCtlVisible] = useState(() => readBoolStore(ZOOMCTL_STORE, false));
  const [presentMode, setPresentMode] = useState(false);
  // feature-2-print-artboards T3 — "Show print guides". Per-CANVAS persisted
  // (view.json `overlays.print`, via /_api/canvas-meta), not a global
  // localStorage pref like minimap/zoomctl — mirrors the foundation's
  // `overlays.guides` lane. Re-read whenever the active canvas changes (see
  // the activeArtboards effect below); sent only to the active iframe.
  const [printGuidesVisible, setPrintGuidesVisible] = useState(false);
  // P2/P3 (Plan C) — top-bar live state. (Zoom lives in the canvas toolbar pill,
  // so the top bar no longer mirrors it.)
  //   activeArtboards — real artboard count of the open canvas, read from its
  //                   `<canvas>.meta.json` sidecar (shell-side, no iframe dep).
  //   gitUser       — local user (name/initials) for the menubar presence avatar.
  //   agentActive   — transient flag set on `ai-activity`, cleared after idle, so
  //                   the menubar shows a live agent avatar while Claude edits.
  const [activeArtboards, setActiveArtboards] = useState(0);
  const [gitUser, setGitUser] = useState(null);
  const [agentActive, setAgentActive] = useState(false);
  const agentIdleRef = useRef(null);
  const wsRef = useRef(null);
  const iframesRef = useRef(new Map());

  // THE CANVAS CAPABILITY OUTLIVES NO TAB (cloud only). It expires 15 minutes
  // after the proxy minted it (render-token.mjs) and cannot be revoked, so it
  // stays short — which left every cloud tab open longer than that with
  // canvases that stopped updating: a teammate's edit re-imports the canvas
  // module, and the canvas origin answered 401. Re-mint it well inside the
  // lifetime (every `/_config` answer carries a fresh one), hand it to each
  // open canvas, and let new frames be built with it. On waking a tab that
  // slept past the cadence, do it at once. Desktops have no capability and
  // never start the timer.
  useEffect(() => {
    if (!cfg?.canvasToken) return undefined;
    let stopped = false;
    let timer = null;
    let dueAt = 0;
    const schedule = (token) => {
      clearTimeout(timer);
      const delay = canvasTokenRefreshDelay(token);
      dueAt = Date.now() + delay;
      timer = setTimeout(refresh, delay);
    };
    async function refresh() {
      let token = null;
      try {
        const res = await fetch('/_config', { cache: 'no-store', credentials: 'same-origin' });
        if (res.ok) token = (await res.json())?.canvasToken;
      } catch {
        /* retried below; the current capability may still be valid */
      }
      if (stopped) return;
      if (typeof token !== 'string' || !token) {
        clearTimeout(timer);
        dueAt = Date.now() + 30_000;
        timer = setTimeout(refresh, 30_000);
        return;
      }
      setLiveCanvasToken(token);
      // To the canvas origin only, never '*': a frame the canvas content
      // navigated elsewhere must not be handed the capability.
      const target = canvasTarget();
      if (target) {
        for (const el of iframesRef.current.values()) {
          try {
            el.contentWindow?.postMessage({ dgn: 'canvas-cap', t: token }, target);
          } catch {}
        }
      }
      schedule(token);
      return token;
    }
    function canvasTarget() {
      try {
        return new URL(cfg.canvasOrigin, location.href).origin;
      } catch {
        return null;
      }
    }
    // A FRAME WHOSE OWN DOCUMENT WAS REFUSED AS EXPIRED. The re-mint above
    // reaches a running canvas's fetches, but not a frame that re-navigates
    // itself (a hard reload, a laptop that slept past the cadence): that load
    // carries the URL it was built with, and the canvas origin answers with a
    // small page that asks us for a fresh capability (hub studio-proxy). Mint
    // one and point just that frame at it — no "reload the project".
    let reviving = false;
    async function onExpired(e) {
      if (e.data?.dgn !== 'canvas-expired' || e.origin !== canvasTarget() || reviving) return;
      reviving = true;
      try {
        const token = await refresh();
        if (!token) return;
        for (const el of iframesRef.current.values()) {
          if (el.contentWindow === e.source) el.src = withCanvasToken(el.src, token);
        }
      } finally {
        reviving = false;
      }
    }
    window.addEventListener('message', onExpired);
    schedule(cfg.canvasToken);
    // A background tab's timers are throttled; one woken past its due time
    // re-mints at once rather than on the throttled tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= dueAt) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('message', onExpired);
    };
  }, [cfg?.canvasToken, cfg?.canvasOrigin]);

  // Phase 5.1 — postMessage bridge from menubar dropdowns to the canvas iframe.
  // The canvas-shell listens for these `dgn:*` messages and dispatches into the
  // matching local provider (annotations visibility / both selection stores /
  // tool mode). Mirrors the existing `force-clear` / `select-clear` channel.
  const postToActiveCanvas = useCallback(
    (payload) => {
      const el = activePath ? iframesRef.current.get(activePath) : null;
      if (!el || !el.contentWindow) return;
      try {
        el.contentWindow.postMessage(payload, '*');
      } catch {}
    },
    [activePath]
  );

  // DDR-231 (hybrid export lanes) — ask the active canvas iframe to capture
  // its own artboards (canvas-lib's useExportCaptureBridge) and hand back the
  // blobs. The shell can't reach the cross-origin canvas DOM, and the sandbox
  // omits allow-downloads, so this is the division of labour: the CANVAS
  // captures (it renders the pixels), the SHELL downloads. Resolves with
  // [{ name, type, blob }]; rejects on canvas error or timeout.
  const browserCaptureSeq = useRef(0);
  const captureFromCanvas = useCallback(
    ({ format, artboardIds = null, scale = 1, onProgress, timeoutMs = 120_000 }) =>
      new Promise((resolve, reject) => {
        const el = activePath ? iframesRef.current.get(activePath) : null;
        if (!el || !el.contentWindow) {
          reject(new Error('no active canvas to capture'));
          return;
        }
        const cw = el.contentWindow;
        browserCaptureSeq.current += 1;
        const id = `cap-${Date.now().toString(36)}-${browserCaptureSeq.current}`;
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMsg);
          clearTimeout(timer);
          fn(arg);
        };
        const onMsg = (e) => {
          // Only answers from the iframe we asked — a message with a matching
          // id from any other window is ignored.
          if (e.source !== cw) return;
          const m = e.data;
          if (!m || m.id !== id) return;
          if (m.dgn === 'export-capture-progress') onProgress?.(m.current, m.total);
          else if (m.dgn === 'export-capture-done')
            finish(resolve, Array.isArray(m.items) ? m.items : []);
          else if (m.dgn === 'export-capture-error')
            finish(reject, new Error(m.message || 'capture failed'));
        };
        const timer = setTimeout(
          () => finish(reject, new Error('capture timed out — the canvas did not answer')),
          timeoutMs
        );
        window.addEventListener('message', onMsg);
        try {
          cw.postMessage({ dgn: 'export-capture', id, format, artboardIds, scale }, '*');
        } catch (err) {
          finish(reject, err);
        }
      }),
    [activePath]
  );
  return {
    activeArtboards, activeComps, activePath, addressMode, agentActive, agentIdleRef,
    annotationsVisible, assistantBusy, assistantOpen, assistantUnseen, autoOpenInspector, bodyRef,
    brandUploadOpen, canvasActiveArtboard, canvasError, canvasReloadNonce, captureFromCanvas,
    cellManaged, cfg, changesOpen, cloudLinkedHub, cloudManaged, collabNudge, commentsByFile,
    commentsFilter, commentsPanelOpen, componentMap, cpMode, diffTarget, dragSide, editScope,
    exportCenter, exportDialog, figmaImportOpen, firstRun, focusedCommentId, generateOpen,
    gitLifecycle, gitStatus, gitUser, groups, handleAssistantAttention, handleAssistantFinished,
    helpOpen, iframesRef, inspectorOpen, inspectorTab, introOpen, lastLayersTreeRef,
    lastLocalSelectAtRef, layersBusyRef, layersBusyTimerRef, layersMode, layersOpen, layersTree,
    loadServerConfig, loadedPath, loadingPath, localProjectName, markCollabSeen, markUsageSeen,
    maybeAutoOpenInspectorOnSelect, minimapVisible, onIframeLoad, onPreview, openMenu,
    openPanelExclusive, openRightPanel, paletteOpen, panelSide, pendingReorderRef, photoRev,
    photoSel, photoUndoRef, postToActiveCanvas, presentMode, previewPath, previousAddressPath,
    printGuidesVisible, project, quickSetupOpen, readinessOpen, remoteSync, reorderLayerRef,
    reportBugOpen, repositionElementRef, resizeElementRef, rpSize, savingIsManaged,
    savingIsManagedRef, sbSize, scheduleArtboardResync, scheduleHaloRestore, search,
    sectionsExpanded, selected, selectedRef, setActiveArtboards, setActiveComps, setActivePath,
    setAgentActive, setAnnotationsVisible, setAssistantBusy, setAssistantOpen, setAutoOpenInspector,
    setBrandUploadOpen, setCanvasActiveArtboard, setCanvasError, setCanvasReloadNonce, setCfg,
    setChangesOpen, setCloudLinkedHub, setCommentsByFile, setCommentsFilter, setCpMode,
    setDiffTarget, setDragSide, setExportDialog, setFigmaImportOpen, setFocusedCommentId,
    setGenerateOpen, setGitLifecycle, setGitStatus, setGitUser, setGroups, setHelpOpen,
    setInspectorOpen, setInspectorTab, setIntroOpen, setLayersMode, setLayersOpen, setLayersTree,
    setLoadedPath, setLoadingPath, setLocalProjectName, setMinimapVisible, setOpenMenu,
    setPaletteOpen, setPanelSide, setPhotoRev, setPhotoSel, setPresentMode, setPreviewPath,
    setPrintGuidesVisible, setProject, setQuickSetupOpen, setReadinessOpen, setRemoteSync,
    setReportBugOpen, setSearch, setSelected, setSettingsOpen, setShareDialog, setShortcutsOpen,
    setShowHidden, setSyncPanelOpen, setSyncStatus, setSystemData, setTabs, setTheme,
    setTimelineArtboardId, setTimelineAudio, setTimelineFrame, setTimelineHeight, setTimelineLoop,
    setTimelineMuted, setTimelineOpen, setTimelinePlaying, setTimelineSelectedClip,
    setTimelineSequences, setTimelineTotal, setTimelineTransitions, setTimelineVolume, setTourSteps,
    setTreeLoadFailures, setTreeLoaded, setUiPrefsHydrated, setUpdateReady, setWsConnected,
    setZoomCtlVisible, settingsOpen, settlePendingSelectionRef, setupReadiness, shareDialog,
    shortcutsOpen, showHidden, sidebarOpen, startTour, syncPanelOpen, syncStatus, systemData, tabs,
    theme, timelineArtboardId, timelineArtboardIdRef, timelineAudio, timelineCompId,
    timelineCompIdRef, timelineFps, timelineFrame, timelineFrameRef, timelineHeight, timelineLoop,
    timelineMuted, timelineOpFailed, timelineOpen, timelinePlaying, timelineRefresh,
    timelineSelectedClip, timelineSequences, timelineTotal, timelineTransitions, timelineVolume,
    togglePanel, toggleRightPanel, toggleTimeline, tourBus, tourSteps, treeExp, treeLoadFailures,
    treeLoaded, uiPrefsHydrated, unsavedCount, updateReady, updateTreeExp, usageNudge, viewerMode,
    whatsNew, wsConnected, wsRef, zoomCtlVisible
  };
}
