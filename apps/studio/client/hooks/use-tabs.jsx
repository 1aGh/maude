// hooks/use-tabs.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS_EXT_RE, SYSTEM_TAB } from '../shell/constants.js';
import { remapDirPrefix, revealPath } from '../tree-expansion.js';
import { buildShareLinks, normalizeOpenPath, readOpenParam, withOpenParam } from '../share-link.js';
import { basename, displayName, previewKind, shellToast } from '../shell/util.js';
import { notify } from '../../notifications.tsx';
import { isNativeApp } from '../github.js';

export function useTabs({
  groups,
  treeLoaded,
  addressMode,
  previousAddressPath,
  project,
  tabs,
  setTabs,
  activePath,
  setActivePath,
  previewPath,
  setPreviewPath,
  onPreview,
  setSelected,
  cloudLinkedHub,
  localProjectName,
  systemData,
  setLoadingPath,
  setCanvasError,
  setCanvasReloadNonce,
  setLoadedPath,
  cfg,
  loadServerConfig,
  setFocusedCommentId,
  updateTreeExp,
  setShareDialog,
  setTimelineOpen,
  timelineArtboardId,
  iframesRef,
  pushTlUndo,
  askText,
  loadTree,
  loadSystemData,
  canvasListChangeRef,
  wsSend,
}) {
  // ----- Tab management (single-canvas) -----
  // Single-canvas model: opening a file REPLACES the active one (no tab strip).
  // The `tabs` state stays as a 0-or-1 array so the rest of the plumbing
  // (iframesRef, comments push, WS `tabs` message) doesn't need refactoring.
  // ARTBOARDS slot in the menubar reads `tabs.length` and reports 0 or 1.
  // `reveal: false` for opens the USER didn't just ask for (URL restore on
  // boot, the cloud first-canvas auto-open): nothing expands itself on launch
  // (#124). Every other open reveals the canvas's row in the Files tree.
  const openTab = useCallback(
    (path, { reveal = true } = {}) => {
      if (reveal && path && path !== SYSTEM_TAB)
        updateTreeExp((st) => revealPath(st, groups, path));
      addressMode.current = 'push';
      setFocusedCommentId(null);
      setPreviewPath(null);
      // The same path keeps its mounted iframe. It will not emit a new loaded
      // event, so keep its current loading/error state until an actual retry.
      if (path === activePath) return;
      setTabs((prev) => {
        // Drop the previously-open iframe so we don't leak DOM nodes.
        for (const t of prev) if (t.path !== path) iframesRef.current.delete(t.path);
        return [{ path }];
      });
      setActivePath(path);
      setCanvasError(null);
      setLoadedPath(null);
      // Canvas-compile skeleton — cleared by the iframe's dgn:'loaded' message,
      // the onLoad fallback timer (legacy .html), or a hard 15s cap.
      if (path !== SYSTEM_TAB) setLoadingPath(path);
    },
    [activePath, groups, updateTreeExp]
  );

  // Resolve URL identities against the loaded tree, including non-canvas previews.
  const openLinkedFile = useCallback(
    (rel, mode = 'push') => {
      const path = groups
        .flatMap((g) => g.paths || [])
        .find((p) => normalizeOpenPath(p, cfg.designRel) === rel);
      if (path && CANVAS_EXT_RE.test(path)) openTab(path, { reveal: false });
      else if (path && previewKind(basename(path))) onPreview(path);
      else {
        setTabs([]);
        setActivePath(null);
        setPreviewPath(null);
        notify({
          title: 'Not here yet',
          description: `${rel} is not in this project (not synced yet?)`,
          kind: 'info',
        });
      }
      addressMode.current = mode;
    },
    [groups, cfg.designRel, openTab, onPreview]
  );

  const addressBooted = useRef(false);
  useEffect(() => {
    if (!treeLoaded || cfg.cloud === undefined || addressBooted.current) return;
    addressBooted.current = true;
    const rel = readOpenParam(location, cfg.designRel);
    if (rel) openLinkedFile(rel, 'none');
  }, [treeLoaded, cfg.cloud, cfg.designRel, openLinkedFile]);

  useEffect(() => {
    if (!treeLoaded || cfg.cloud === undefined) return;
    const navigate = () => {
      const rel = readOpenParam(location, cfg.designRel);
      if (rel) openLinkedFile(rel, 'none');
      else {
        addressMode.current = 'none';
        setTabs([]);
        setActivePath(null);
        setPreviewPath(null);
      }
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, [treeLoaded, cfg.cloud, cfg.designRel, openLinkedFile]);

  useEffect(() => {
    const visible = previewPath || (activePath === SYSTEM_TAB ? null : activePath);
    if (visible === previousAddressPath.current) return;
    previousAddressPath.current = visible;
    const rel = normalizeOpenPath(visible, cfg.designRel);
    if (addressMode.current !== 'none' && readOpenParam(location, cfg.designRel) !== rel) {
      history[rel ? 'pushState' : 'replaceState'](
        rel ? { open: rel } : null,
        '',
        withOpenParam(location, rel)
      );
    }
    addressMode.current = 'push';
  }, [activePath, previewPath, cfg.designRel]);

  const sharePath = previewPath || (activePath === SYSTEM_TAB ? null : activePath);
  const shareShell = cfg.cloud ? 'cloud' : isNativeApp() ? 'native' : 'local';
  const shareLinksFor = (path) =>
    buildShareLinks({
      rel: normalizeOpenPath(path, cfg.designRel),
      shell: shareShell,
      location,
      linkedHubUrl: cloudLinkedHub?.url,
      project: cfg.cloud ? project : localProjectName,
      localUrl: location.origin,
    });
  const showShare = (path = sharePath) => {
    const rel = normalizeOpenPath(path, cfg.designRel);
    if (rel) setShareDialog({ path, rel, label: basename(path) });
  };

  // Retry from the #115 error panel: re-read /_config FIRST (the stale
  // `canvasOrigin` is the likeliest reason we are here at all), then remount the
  // iframe via the nonce so it navigates against the corrected origin.
  const retryCanvasLoad = useCallback(
    (path) => {
      setCanvasError(null);
      setLoadedPath(null);
      loadServerConfig();
      setCanvasReloadNonce((n) => n + 1);
      if (path && path !== SYSTEM_TAB) setLoadingPath(path);
    },
    [loadServerConfig]
  );

  /**
   * First open lands on a rendered canvas — Cloud Phase 27 C3.
   *
   * A desktop user chose this project, installed the app and knows what is in
   * it; the empty state is a helpful "pick a screen". A teammate following a
   * link has done none of that, and an empty pane with an arrow pointing at a
   * list is the browser saying "the thing you came for is somewhere else".
   *
   * CLOUD ONLY, and once. The desktop's empty state is deliberately unchanged —
   * it earns its keep there (the ⌘-hover lesson, quick setup) — and re-opening
   * a canvas the person deliberately closed would be a UI arguing with them.
   */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    if (!cfg.cloud) return; // desktop / unknown-yet
    if (new URLSearchParams(location.search).has('open')) {
      autoOpened.current = true;
      return;
    }
    if (tabs.length > 0) return;
    if (!groups.length) return; // tree not loaded
    // The first canvas that is somebody's WORK — a design-system specimen is a
    // rendered canvas too, and not what a teammate followed a link to see.
    let first = null;
    for (const g of groups) {
      for (const p of g.paths || []) {
        if (!CANVAS_EXT_RE.test(p)) continue;
        if (/(^|\/)system\//.test(p)) continue;
        first = p;
        break;
      }
      if (first) break;
    }
    if (!first) return;
    autoOpened.current = true;
    openTab(first, { reveal: false });
  }, [cfg.cloud, groups, tabs.length, openTab]);

  const openSystem = useCallback(
    (dsName) => {
      // DsFolderRow passes the clicked DS name → scope the System view to it so
      // each folder shows its own tokens + previews. The no-arg callers (menubar,
      // keyboard reopen) only load default data on first open.
      const ds = typeof dsName === 'string' ? dsName : undefined;
      if (ds) loadSystemData(ds);
      else if (!systemData) loadSystemData();
      openTab(SYSTEM_TAB);
    },
    [systemData, loadSystemData, openTab]
  );

  useEffect(() => {
    wsSend({ type: 'tabs', tabs: tabs.map((t) => t.path).filter((p) => p !== SYSTEM_TAB) });
  }, [tabs]);

  useEffect(() => {
    if (activePath && activePath !== SYSTEM_TAB) wsSend({ type: 'active', file: activePath });
    else if (activePath === SYSTEM_TAB) wsSend({ type: 'active', file: '' });
    else wsSend({ type: 'active', file: '' });
  }, [activePath]);

  const closeTab = useCallback(
    (path) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === path);
        if (idx < 0) return prev;
        const next = prev.filter((t) => t.path !== path);
        if (path === activePath) {
          if (next.length === 0) setActivePath(null);
          else setActivePath(next[Math.max(0, idx - 1)].path);
        }
        return next;
      });
      iframesRef.current.delete(path);
      setLoadingPath((p) => (p === path ? null : p));
    },
    [activePath]
  );

  // The socket stays connected while this ref follows the current config and
  // active tab. Structural events apply to local and remote users alike.
  canvasListChangeRef.current = (change) => {
    if (!change?.rel) return;
    const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
    const file = `${designRel}/${change.rel}`;
    if (change.action === 'removed') {
      closeTab(file);
    } else if (change.action === 'moved' && change.fromRel) {
      const fromFile = `${designRel}/${change.fromRel}`;
      setTabs((prev) => prev.map((t) => (t.path === fromFile ? { ...t, path: file } : t)));
      setActivePath((prev) => (prev === fromFile ? file : prev));
      setLoadingPath((prev) => (prev === fromFile ? null : prev));
      iframesRef.current.delete(fromFile);
    }
  };

  const reloadActive = useCallback(() => {
    if (!activePath || activePath === SYSTEM_TAB) {
      if (activePath === SYSTEM_TAB) loadSystemData();
      return;
    }
    const el = iframesRef.current.get(activePath);
    if (el) el.src = el.src;
  }, [activePath, loadSystemData]);

  const reloadTree = useCallback(() => loadTree(), [loadTree]);

  // User-facing tree refresh with a visible spin. The header button and ⌘⇧R call
  // this so the reload icon spins for at least one beat — even when /_index-data
  // returns instantly — so the action registers visually ("something is
  // happening"). The min-duration race keeps the spin from flashing for one
  // frame on a fast read; the ref guard ignores re-entrant clicks. The passive
  // focus backstop below uses the plain reloadTree (no icon to animate).
  const [treeRefreshing, setTreeRefreshing] = useState(false);
  const treeRefreshingRef = useRef(false);
  const refreshTree = useCallback(async () => {
    if (treeRefreshingRef.current) return;
    treeRefreshingRef.current = true;
    setTreeRefreshing(true);
    try {
      await Promise.all([loadTree(), new Promise((r) => setTimeout(r, 550))]);
    } finally {
      treeRefreshingRef.current = false;
      setTreeRefreshing(false);
    }
  }, [loadTree]);

  // Backstop for the desktop sidecar: re-list the tree whenever the window
  // regains focus. The fs-watch → canvas-list-update auto-refresh can drop
  // events in a `bun --compile` standalone binary (recursive fs.watch is
  // unreliable there) and across a sidecar respawn / WS reconnect, leaving a
  // stale tree after a canvas was created from the ACP chat or a terminal.
  // `/_index-data` is a cheap read and people tab away to the agent and back, so
  // this turns "switch projects to force a refresh" into "just come back to the
  // window". Debounced so a rapid blur/focus burst coalesces to one re-read.
  useEffect(() => {
    let t = null;
    const onFocus = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        reloadTree();
      }, 150);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      if (t) clearTimeout(t);
    };
  }, [reloadTree]);

  // Phase 22 — create a blank brief board from the tree header. POSTs to the
  // main-origin-only /_api/canvas (the untrusted canvas iframe can't reach it),
  // then refreshes the tree and opens the new board so it's immediately the
  // active canvas to annotate. Returns {ok} | {ok:false,error} so the Sidebar
  // can surface a validation/duplicate message inline.
  const createBoard = useCallback(
    async (name) => {
      try {
        const r = await fetch('/_api/canvas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, kind: 'brief-board' }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) return { ok: false, error: j.error || `create failed (${r.status})` };
        await loadTree();
        openTab(j.file);
        return { ok: true, file: j.file };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'network error' };
      }
    },
    [loadTree, openTab]
  );

  // Task 20 (enhanced-video-editing) — greenfield "New video": an EMPTY
  // video-comp canvas (drop-first cut building). Dimensions/fps are
  // user-settable (presets 1920×1080 / 1080×1920 / 1080×1080 or custom WxH).
  const createVideo = useCallback(async () => {
    const name = await askText('New video name');
    if (!name) return;
    const dims =
      (await askText(
        'Size — 1920x1080 (landscape), 1080x1920 (portrait), 1080x1080 (square), or custom WxH',
        '1920x1080'
      )) || '1920x1080';
    const m = dims.toLowerCase().match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/);
    const width = m ? Number(m[1]) : 1920;
    const height = m ? Number(m[2]) : 1080;
    const fps = Math.max(1, Math.min(60, Number(await askText('Frames per second', '30')) || 30));
    try {
      const r = await fetch('/_api/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind: 'video-comp', clips: [], fps, width, height }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        shellToast(`New video failed: ${j.error || `error ${r.status}`}`);
        return;
      }
      await loadTree();
      openTab(j.file);
      setTimelineOpen(true);
      shellToast('New video created — drop clips on the timeline to start the cut.', true);
    } catch (e) {
      shellToast(`New video failed: ${e instanceof Error ? e.message : 'network error'}`);
    }
  }, [loadTree, openTab, askText]);

  // DDR-150 P4 Task 12 — one-click "udělej z toho video". Reads the ACTIVE
  // canvas's annotation sidecar (main-origin — no cross-origin round-trip),
  // gathers every dropped media-reference chip's src in document order, and POSTs
  // an assembled video-comp (kind: 'video-comp') → opens the new, immediately
  // hand-editable comp. Durations default server-side to fps*3 (the user trims on
  // the Timeline); client-side <video>.duration probing is a documented tightening.
  const assembleVideo = useCallback(async () => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    try {
      const ar = await fetch(`/_api/annotations?file=${encodeURIComponent(activePath)}`);
      const svg = ar.ok ? await ar.text() : '';
      const clips = [];
      if (svg) {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        for (const g of doc.querySelectorAll('[data-tool="mediaref"]')) {
          const src = g.getAttribute('data-src');
          if (!src) continue;
          clips.push({
            src,
            mediaKind: g.getAttribute('data-media-kind') === 'audio' ? 'audio' : 'video',
          });
        }
      }
      if (clips.length === 0) {
        window.alert(
          'Drop video/audio clips on the canvas first, then assemble them into a video.'
        );
        return;
      }
      const baseName = displayName(basename(activePath)).replace(/\.tsx$/i, '');
      const name = `${baseName} Video`;
      const r = await fetch('/_api/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind: 'video-comp', clips }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        window.alert(`Assemble failed: ${j.error || `error ${r.status}`}`);
        return;
      }
      await loadTree();
      openTab(j.file);
    } catch (e) {
      window.alert(`Assemble failed: ${e instanceof Error ? e.message : 'network error'}`);
    }
  }, [activePath, loadTree, openTab]);

  // DDR-150 dogfood #5 — shared replace-media flow, PICKER-FIRST. The <input
  // type=file> is created + clicked SYNCHRONOUSLY inside the caller's click
  // gesture (browsers revoke transient user-activation after any await, which is
  // why the old fetch-then-click never opened the dialog). The comp-clips lookup
  // + upload + src patch all happen in the change handler, where no activation
  // is needed. `resolveCdId(cc)` maps the fresh enumerator payload to the target
  // media target (sequence clip via cd-id, audio bed via cd-id, or a showreel
  // array-fed src via mediaArrayRef → /_api/edit-array-src). `resolveTarget(cc)`
  // returns { cdId } | { arrayRef } | null.
  const replaceMediaViaPicker = useCallback(
    ({ accept, resolveTarget }) => {
      const canvas = activePath;
      const artboardId = timelineArtboardId || undefined;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      // OFF-SCREEN, not display:none — the native desktop app (Tauri WKWebView)
      // will NOT present the file panel for a `display:none` input (it must be
      // laid out). Off-screen + transparent works in both WKWebView and browsers
      // (dogfood: "replace ... nefunguje ale v desktop app"). Guard against a
      // cancelled dialog leaking the node with a one-shot focus cleanup.
      input.style.cssText =
        'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(input);
      const cleanup = () => {
        if (input.isConnected) input.remove();
      };
      // If the user cancels the panel, `change` never fires — reclaim the node
      // when focus returns to the window (fires on both pick and cancel).
      window.addEventListener('focus', () => setTimeout(cleanup, 300), { once: true });
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        cleanup();
        if (!file) return;
        const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
        fetch(ccUrl)
          .then((r) => r.json().catch(() => ({})))
          .then((cc) => {
            const target = resolveTarget(cc);
            if (!target) {
              shellToast('No replaceable media here (its src is computed) — edit via chat.');
              return null;
            }
            return fetch('/_api/asset', {
              method: 'POST',
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
              body: file,
            })
              .then((r) => r.json().catch(() => ({})))
              .then((up) => {
                if (!up?.path) {
                  shellToast(`Upload failed: ${up?.error || 'unknown error'}`);
                  return null;
                }
                if (target.arrayRef) {
                  // Showreel pattern: the src lives in an array literal.
                  return fetch('/_api/edit-array-src', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      canvas,
                      arrayName: target.arrayRef.arrayName,
                      index: target.arrayRef.index,
                      field: target.arrayRef.field,
                      value: up.path,
                    }),
                  });
                }
                return fetch('/_api/edit-attr', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ canvas, id: target.cdId, attr: 'src', value: up.path }),
                });
              });
          })
          .then((r) => (r ? r.json() : null))
          .then((j) => {
            if (j && !j.ok) shellToast(`Replace refused: ${j.error || 'failed'}`);
            else if (j && j.ok) {
              shellToast('Media replaced.', true);
              if (j.seq != null) pushTlUndo(canvas, j.seq, 'replace media');
            }
          })
          .catch(() => shellToast('Replace failed: network error'));
      });
      input.click();
    },
    [activePath, timelineArtboardId, pushTlUndo]
  );

  // Phase 22 — soft-delete a canvas from the file tree. Confirms (destructive),
  // DELETEs to the main-origin-only endpoint, refreshes the tree, and resets the
  // active tab if the deleted canvas was open. The server moves the whole sidecar
  // set to .design/_trash/ — recoverable locally.
  const deleteBoard = useCallback(
    async (filePath, label) => {
      const ok = window.confirm(
        `Move “${label}” to trash?\n\nIts annotations, history and comments move with it. ` +
          `You can restore it from .design/_trash/.`
      );
      if (!ok) return;
      try {
        const r = await fetch(`/_api/canvas?file=${encodeURIComponent(filePath)}`, {
          method: 'DELETE',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          window.alert(`Could not delete: ${j.error || `error ${r.status}`}`);
          return;
        }
        await loadTree();
        if (activePath === filePath) {
          setTabs([]);
          setActivePath(null);
        }
      } catch (e) {
        window.alert(`Delete failed: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [loadTree, activePath]
  );

  // feature-file-tree-drag-drop-folders (Task 8/10) — drag-drop AND the
  // context-menu "Move to…" both funnel through this one function. POSTs the
  // main-origin-only /_api/fs-move, then (only AFTER the server ack — no
  // optimistic UI, per rca/issue-canvas-hmr-optimistic-update-consistency)
  // reloads the tree and retargets any open tab / the active path so a
  // dragged-and-open canvas doesn't go dead. Toasts with an inverse-move
  // Undo. Named function expression so the Undo click can call itself.
  const moveCanvasReq = useCallback(
    async function moveCanvasReq(fromPath, toDir) {
      try {
        const r = await fetch('/_api/fs-move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: fromPath, toDir }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          shellToast(`Could not move: ${j.error || `error ${r.status}`}`);
          return { ok: false, error: j.error };
        }
        const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(
          /^\/+|\/+$/g,
          ''
        );
        const fromFile = `${designRel}/${j.fromRel}`;
        const toFile = `${designRel}/${j.toRel}`;
        // #124 — a moved folder keeps its (and its subfolders') open state, and
        // the destination opens so the moved row is visible.
        updateTreeExp((st) => revealPath(remapDirPrefix(st, fromFile, toFile), groups, toFile));
        await loadTree();
        setTabs((prev) => prev.map((t) => (t.path === fromFile ? { path: toFile } : t)));
        setActivePath((prev) => (prev === fromFile ? toFile : prev));
        const fromDir = fromFile.split('/').slice(0, -1).join('/');
        shellToast(`Moved to ${j.toRel.split('/').slice(0, -1).join('/') || '.'}`, true, {
          label: 'Undo',
          onClick: () => {
            moveCanvasReq(toFile, fromDir);
          },
        });
        return { ok: true };
      } catch (e) {
        shellToast(`Move failed: ${e instanceof Error ? e.message : 'network error'}`);
        return { ok: false, error: 'network error' };
      }
    },
    [loadTree, cfg, groups, updateTreeExp]
  );

  // feature-file-tree-drag-drop-folders (Task 4/9/12) — create a folder under
  // `parentDir`. Two callers: the sidebar header composer (name from its own
  // input state) and the tree-row context menu's "New folder here" (name via
  // `window.prompt` — a native, fully keyboard/screen-reader-operable input,
  // so that path doesn't need its own inline composer instance).
  const newFolderReq = useCallback(
    async (parentDir, name) => {
      try {
        const r = await fetch('/_api/fs-mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parent: parentDir, name }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          const error = j.error || `error ${r.status}`;
          shellToast(`Could not create folder: ${error}`);
          return { ok: false, error };
        }
        // #124 — open the parent so the new folder is visible (it starts closed).
        updateTreeExp((st) => revealPath(st, groups, parentDir, { includeSelf: true }));
        await loadTree();
        return { ok: true, dir: j.dir };
      } catch (e) {
        const error = e instanceof Error ? e.message : 'network error';
        shellToast(`Create folder failed: ${error}`);
        return { ok: false, error };
      }
    },
    [loadTree, groups, updateTreeExp]
  );

  // feature-file-tree-drag-drop-folders (dogfood follow-up) — delete a
  // folder from the tree-row context menu. Reuses DELETE /_api/canvas (the
  // route now auto-detects a non-.tsx target as a folder delete); every
  // canvas inside is trashed the same recoverable way as a single-canvas
  // delete (`.design/_trash/<stamp>__<slug>/`).
  const deleteFolderReq = useCallback(
    async (dirPath, label) => {
      const ok = window.confirm(
        `Delete folder "${label}"?\n\nEvery canvas inside moves to trash (recoverable from .design/_trash/); ` +
          `any empty subfolders are removed.`
      );
      if (!ok) return;
      try {
        const r = await fetch(`/_api/canvas?file=${encodeURIComponent(dirPath)}`, {
          method: 'DELETE',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          shellToast(`Could not delete folder: ${j.error || `error ${r.status}`}`);
          return;
        }
        await loadTree();
      } catch (e) {
        shellToast(`Delete folder failed: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [loadTree]
  );

  // Plan T17 — rename a folder: a move to a new name in the same parent (one
  // dir.move action in accepted mode, carrying every canvas inside).
  const renameFolderReq = useCallback(
    async (dirPath, name) => {
      const parent = dirPath.split('/').slice(0, -1).join('/');
      try {
        const r = await fetch('/_api/fs-move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: dirPath, toDir: parent, toName: name }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          shellToast(`Could not rename folder: ${j.error || `error ${r.status}`}`);
          return;
        }
        // #124 — the renamed folder keeps its open state (and its subfolders').
        const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(
          /^\/+|\/+$/g,
          ''
        );
        const toDir = typeof j.toRel === 'string' ? `${designRel}/${j.toRel}` : `${parent}/${name}`;
        updateTreeExp((st) => remapDirPrefix(st, dirPath, toDir));
        await loadTree();
      } catch (e) {
        shellToast(`Rename failed: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [loadTree, cfg, updateTreeExp]
  );

  // Plan T25/L04 — rename a canvas in place (its sidecars follow; an open tab
  // follows the new path) and duplicate one beside itself.
  const renameCanvasReq = useCallback(
    async (filePath, name) => {
      try {
        const r = await fetch('/_api/fs-move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: filePath, toName: name }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          shellToast(`Could not rename: ${j.error || `error ${r.status}`}`);
          return;
        }
        const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(
          /^\/+|\/+$/g,
          ''
        );
        const fromFile = `${designRel}/${j.fromRel}`;
        const toFile = `${designRel}/${j.toRel}`;
        await loadTree();
        setTabs((prev) => prev.map((t) => (t.path === fromFile ? { path: toFile } : t)));
        setActivePath((prev) => (prev === fromFile ? toFile : prev));
      } catch (e) {
        shellToast(`Rename failed: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [loadTree, cfg]
  );
  const duplicateCanvasReq = useCallback(
    async (filePath) => {
      try {
        const r = await fetch('/_api/canvas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duplicateOf: filePath }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          shellToast(`Could not duplicate: ${j.error || `error ${r.status}`}`);
          return;
        }
        await loadTree();
        shellToast(
          `Duplicated as ${j.rel
            .split('/')
            .pop()
            .replace(/\.tsx$/i, '')}`,
          true
        );
      } catch (e) {
        shellToast(`Duplicate failed: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [loadTree]
  );

  const deleteFileReq = useCallback(
    async (filePath, name) => {
      if (!window.confirm(`Move “${name}” to trash?\n\nYou can restore it from .design/_trash/.`))
        return;
      try {
        const r = await fetch(`/_api/canvas?file=${encodeURIComponent(filePath)}`, {
          method: 'DELETE',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          shellToast(`Could not delete: ${j.error || `error ${r.status}`}`);
          return;
        }
        await loadTree();
      } catch (e) {
        shellToast(`Delete failed: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [loadTree]
  );

  const clearSelected = useCallback(() => {
    wsSend({ type: 'clear-select' });
    setSelected(null);
    if (activePath && activePath !== SYSTEM_TAB) {
      const el = iframesRef.current.get(activePath);
      if (el && el.contentWindow) {
        try {
          el.contentWindow.postMessage({ dgn: 'force-clear' }, '*');
        } catch {}
      }
    }
  }, [activePath]);
  return {
    assembleVideo,
    clearSelected,
    closeTab,
    createBoard,
    createVideo,
    deleteBoard,
    deleteFileReq,
    deleteFolderReq,
    duplicateCanvasReq,
    moveCanvasReq,
    newFolderReq,
    openLinkedFile,
    openSystem,
    openTab,
    refreshTree,
    reloadActive,
    renameCanvasReq,
    renameFolderReq,
    replaceMediaViaPicker,
    retryCanvasLoad,
    shareLinksFor,
    sharePath,
    shareShell,
    showShare,
    treeRefreshing,
  };
}
