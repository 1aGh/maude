// shell/viewport.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { canvasFrameCfg, canvasUrl } from '../canvas-url.js';
import { CompareHost } from '../v2/history/compare-view.jsx';
import { useViewing } from '../v2/history/history-host.jsx';
import { SYSTEM_TAB } from './constants.js';
import { FilePreview, sanitizeDisplayText } from '../panels/file-preview.jsx';
import { basename, previewKind, shellToast } from './util.js';
import { SystemView } from '../system/system-view.jsx';
import { isNativeApp } from '../github.js';
import { exportSelectionFor } from '../selection-scope.js';
import { ShellStoreContext } from '../stores/shell-store.jsx';
import { subscribeViewCode } from '../v2/code/code-bus.js';
import { CanvasLoadFailure } from '../v2/code/canvas-error-card.jsx';
import { CodeView, mayViewCode } from '../v2/code/code-view.jsx';
import { dispatchCanvasOp } from '../v2/left-panel/left-panel-bus.js';
import { nativeDoors } from '../v2/shell/native-doors.js';
import { EmptyProjectSlot } from '../v2/create/empty-project.jsx';
import { ArrivingCanvas, NotLocalCanvas, useCanvasAvailability } from '../v2/empty/not-local.jsx';

export function Viewport({
  tabs,
  activePath,
  registerIframe,
  systemData,
  onOpenFromSystem,
  onSelectDs,
  project,
  cfg,
  loadingPath,
  onIframeLoad,
  canvasError,
  canvasReloadNonce,
  onRetryCanvasLoad,
  loadedPath,
  showQuickSetup,
  onStartQuickSetup,
  previewPath,
}) {
  // feature-studio-file-preview (a11y fix) — a11y-auditor found the preview
  // overlay gave keyboard/AT users no signal anything happened: the click
  // stayed on the (unrelated) tree row, nothing was announced, and the
  // scrollable region itself wasn't in the tab order. Moving focus onto the
  // region on open covers all three: it's a real focus change (AT announces
  // the new `role="region"` + its label), and a focused element with
  // `overflow: auto` is keyboard-scrollable (arrow/Page keys) without a
  // separate tabIndex fix.
  const previewRef = useRef(null);
  useEffect(() => {
    if (previewPath) previewRef.current?.focus();
  }, [previewPath]);

  // S11.7 — View code (⌘K / the Canvases row menu): the open canvas's TSX, read-only, with the selected
  // artboard's lines marked. The request waits in code-bus.js until this mounts; a code view of one
  // canvas follows the open canvas when the tab changes. Can view is never offered it (the server
  // refuses the source to them too). The shell store is read optionally so a bare Viewport still renders.
  const shell = useContext(ShellStoreContext)?.shellCore;
  const role = cfg?.cloud?.role;
  const [codeReq, setCodeReq] = useState(null);
  useEffect(
    () =>
      subscribeViewCode((r) => {
        if (mayViewCode(role)) setCodeReq(r);
      }),
    [role]
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a tab change re-points the code view at the open canvas
  useEffect(() => {
    setCodeReq((c) => (c ? { canvas: null } : c));
  }, [activePath]);
  const codeCanvas = codeReq ? (codeReq.canvas ?? activePath) : null;
  const codeShown = !!codeCanvas && /\.tsx$/i.test(codeCanvas) && mayViewCode(role);
  const doors = useMemo(() => nativeDoors(), []);
  const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  const codeArtboard = shell
    ? exportSelectionFor(shell.selected, activePath, shell.canvasActiveArtboard).activeArtboardId
    : null;
  // An open canvas keeps the URL it was opened with. The capability in it is
  // re-minted on a timer (canvas-url.js); letting that change the `src` of a
  // live iframe would reload every open canvas every few minutes. The fresh
  // capability reaches an open canvas by message instead, and a frame that is
  // (re)created — a new tab, a Retry, a config change — is built with it.
  // Only while the frame is open: a closed tab reopened later is a new frame
  // and must not inherit a capability that may have expired meanwhile.
  const srcCache = useRef(new Map());
  const openPaths = new Set(tabs.map((t) => t.path));
  for (const [key, entry] of srcCache.current) {
    if (!openPaths.has(entry.path)) srcCache.current.delete(key);
  }
  // S1.14 — Version history's Viewing: the held canvas is framed at that version (`?sha=`, read-only);
  // the frame is a different document, so it remounts (below) and comes back at now when the hold ends.
  const viewing = useViewing();
  const stableSrc = (path) => {
    const opts = viewing?.path === path ? { viewing: viewing.at } : undefined;
    // A frame that changes between now and a past version is a new frame: the entry it comes back to is
    // built afresh, so it carries the capability that is live THEN, not the one of the first open.
    for (const [k, e] of srcCache.current)
      if (e.path === path && !!e.viewing !== !!opts) srcCache.current.delete(k);
    // A head that moves is a swap at the next look (v2/ds/use-ds-frames.js), not a new frame:
    // `canvasFrameCfg` leaves the head out of the identity.
    const bare = canvasUrl(path, canvasFrameCfg(cfg), opts);
    const key = `${path}#${canvasReloadNonce}|${bare}`;
    let entry = srcCache.current.get(key);
    if (!entry) {
      entry = { path, src: canvasUrl(path, cfg, opts), viewing: !!opts };
      srcCache.current.set(key, entry);
    }
    return entry.src;
  };
  // One observable word for "what is the canvas pane actually doing" — the
  // top-frame signal the #115 E2E scenario waits on, and the only place these
  // three states are named together. `ready` is `dgn:'loaded'`-backed, so it
  // cannot be faked by a timer expiring (which is exactly how the bug used to
  // look successful: skeleton gone, pane white).
  // S11.4 (05 es-offline-uncached) — the open canvas is asked once per open (and per Retry): offline and
  // never downloaded, the tab shows the card INSTEAD of the frame. No frame = no toolbar and no zoom (both
  // live in the canvas runtime), and no loading card waiting on a frame that will never load.
  const canvasTab = activePath && activePath !== SYSTEM_TAB ? activePath : null;
  const availability = useCanvasAvailability(canvasTab, { stamp: canvasReloadNonce });
  const notLocal = !!canvasTab && availability === 'not-local';
  // Still coming down (Q13 fallback): the "<name> is on its way." card, same stand-in for the frame.
  const arriving = !!canvasTab && availability === 'arriving';
  const canvasState =
    canvasError && canvasError.path === activePath
      ? 'error'
      : activePath && activePath !== SYSTEM_TAB && loadedPath === activePath
        ? 'ready'
        : loadingPath && loadingPath === activePath
          ? 'loading'
          : 'idle';
  return (
    <div className="viewport st-stage" data-tour="viewport" data-canvas-state={canvasState}>
      {previewPath && (
        // feature-studio-file-preview — an overlay, not a tab: the canvas
        // iframe (if any) stays mounted underneath so switching back to it
        // is instant and never remounts. previewPath is intentionally never
        // written into `tabs`/`activePath` (see App()'s onPreview).
        <div
          ref={previewRef}
          className="st-file-preview-overlay"
          role="region"
          aria-label={`Preview: ${sanitizeDisplayText(basename(previewPath))}`}
          tabIndex={0}
        >
          <FilePreview path={previewPath} kind={previewKind(basename(previewPath))} />
        </div>
      )}
      {tabs.length === 0 && !previewPath && (
        // S6.2 (shared): a project with 0 canvases shows the 05 es-project-new card; any other
        // no-tab state keeps the placeholder below as the slot's fallback.
        <EmptyProjectSlot>
          <div className="st-empty">
            <div className="st-empty-title">No canvas open</div>
            <div className="st-empty-body">
              Open a canvas from the Canvases panel, or start a new one.
            </div>
            {showQuickSetup && (
              <button
                type="button"
                data-testid="st-empty-start-quick-setup"
                className="btn btn--primary st-empty-quick-setup"
                onClick={onStartQuickSetup}
              >
                Start quick setup
              </button>
            )}
          </div>
        </EmptyProjectSlot>
      )}
      {tabs.map((t) => {
        if (t.path === SYSTEM_TAB) {
          return (
            <div key={t.path} className={'system-view' + (t.path === activePath ? ' active' : '')}>
              <SystemView
                data={systemData}
                onOpen={onOpenFromSystem}
                cfg={cfg}
                onSelectDs={onSelectDs}
              />
            </div>
          );
        }
        if (notLocal && t.path === activePath)
          return (
            <div key={`${t.path}#not-local`} className="st-not-local active">
              <NotLocalCanvas name={basename(t.path).replace(/\.(tsx|html)$/i, '')} />
            </div>
          );
        if (arriving && t.path === activePath)
          return (
            <div key={`${t.path}#arriving`} className="st-not-local active">
              <ArrivingCanvas name={basename(t.path).replace(/\.(tsx|html)$/i, '')} />
            </div>
          );
        return (
          <iframe
            // The nonce is part of the key ONLY so the #115 Retry can force a
            // remount; it is otherwise constant, so normal switching keys on the
            // path exactly as before.
            key={`${t.path}#${canvasReloadNonce}${viewing?.path === t.path ? `@${viewing.at}` : ''}`}
            ref={(el) => registerIframe(t.path, el)}
            src={stableSrc(t.path)}
            title={`Canvas: ${t.path}`}
            className={t.path === activePath ? 'active' : ''}
            data-path={t.path}
            data-testid={t.path === activePath ? 'canvas-frame' : undefined}
            onLoad={() => onIframeLoad?.(t.path)}
            // T2 (9.1-A) — only sandbox + delegate clipboard when the canvas is
            // served cross-origin (canvasOrigin present = the split is on). In
            // the default same-origin mode these attrs are omitted so behavior
            // is identical to pre-9.1. allow-same-origin gives the cross-origin
            // frame its OWN origin (own WS/fetch/storage), NOT the parent's.
            {...(cfg?.canvasOrigin
              ? { sandbox: 'allow-scripts allow-same-origin', allow: 'clipboard-write' }
              : {})}
          />
        );
      })}
      {codeShown && (
        <CodeView
          key={codeCanvas}
          canvas={codeCanvas}
          designRel={designRel}
          artboardId={codeArtboard}
          doors={doors}
          stamp={canvasReloadNonce}
          onClose={() => setCodeReq(null)}
        />
      )}
      {loadingPath && loadingPath === activePath && !notLocal && !arriving && (
        // DS skeletons recipe — calm .skel pulse while the canvas-shell compiles
        // the TSX. Cleared by the iframe's dgn:'loaded' message (or the onLoad
        // fallback timer for legacy .html canvases that never post it).
        <CanvasLoading key={loadingPath} path={loadingPath} cloud={!!cfg?.cloud} />
      )}
      {canvasError && canvasError.path === activePath && !notLocal && !arriving && (
        // issue #115 — what the blank pane used to be. Names which of the two
        // failures happened and offers the recovery that used to require
        // quitting the app (or knowing that switching projects and back
        // re-reads /_config).
        <div
          className={`st-canvas-error${canvasError.kind === 'server' ? '' : ' st-canvas-error--v2'}`}
          role="alert"
          data-testid="canvas-load-error"
        >
          {canvasError.kind === 'server' ? (
            <div className="st-canvas-error-card">
              <div className="st-canvas-error-title">Maude's server isn't responding</div>
              <div className="st-canvas-error-body">
                The canvas couldn't be reached. This usually means Maude's server restarted
                underneath this window — your files on disk are untouched.
              </div>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="canvas-load-retry"
                onClick={() => onRetryCanvasLoad?.(canvasError.path)}
              >
                Reload canvas
              </button>
            </div>
          ) : (
            // S11.7 — "<Canvas> can't be drawn right now." + Ask AI to fix it. The error, the line and the
            // way back sit under Show details; `canvas-load-retry` lives there as "Reload canvas".
            <CanvasLoadFailure
              key={canvasError.path}
              canvas={canvasError.path}
              designRel={designRel}
              doors={doors}
              canEdit={!cfg?.readOnly}
              askAiAvailable={isNativeApp() && !cfg?.readOnly}
              onAskAi={(text) => dispatchCanvasOp('ask-ai-fix', canvasError.path, text)}
              onReload={() => onRetryCanvasLoad?.(canvasError.path)}
              onNotify={(msg, ok) => shellToast(msg, ok)}
            />
          )}
        </div>
      )}
      {/* S1.15 — Compare two versions: over the canvas while a Compare rides on the Viewing hold */}
      <CompareHost cfg={cfg} />
    </div>
  );
}

// The canvas loading screen. OPAQUE on purpose: until the canvas reports
// `canvas-rendered` the frame underneath is the bare shell — a white page,
// and on a canvas with comments, pins floating over nothing — which reads as
// "something broke". The card fades in after a beat so a warm canvas that
// renders in a few hundred ms never flashes it; the hint after a few seconds
// says why a cold canvas is slow instead of leaving the user to wonder.
export function CanvasLoading({ path, cloud }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const name = sanitizeDisplayText(basename(path || '').replace(/\.(tsx|jsx|html?)$/i, ''));
  return (
    <div
      className="st-canvas-loading"
      role="status"
      aria-live="polite"
      data-testid="canvas-loading"
    >
      <div className="st-skel-card">
        <div className="st-canvas-loading-head">
          <span className="st-canvas-loading-spinner" aria-hidden="true" />
          <span className="st-canvas-loading-title">Opening {name}…</span>
        </div>
        <span className="skel st-skel-thumb" aria-hidden="true" />
        <span className="skel st-skel-line" style={{ width: '72%' }} aria-hidden="true" />
        <span className="skel st-skel-line" style={{ width: '46%' }} aria-hidden="true" />
        <div className={'st-canvas-loading-hint' + (slow ? ' is-shown' : '')}>
          {cloud
            ? 'Still working — the first open of a canvas fetches its images and fonts from cloud storage. It is quicker next time.'
            : 'Still working — large canvases take a moment to build.'}
        </div>
      </div>
    </div>
  );
}
