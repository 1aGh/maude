// shell/viewport.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useRef, useState } from 'react';
import { canvasUrl } from '../canvas-url.js';
import { MDCC_VERSION, SYSTEM_TAB } from './constants.js';
import { FilePreview, sanitizeDisplayText } from '../panels/file-preview.jsx';
import { basename, previewKind } from './util.js';
import { Kbd } from './icons.jsx';
import { isNativeApp } from '../github.js';
import { SystemView } from '../system/system-view.jsx';

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
  const stableSrc = (path) => {
    const bare = canvasUrl(path, { ...cfg, canvasToken: undefined });
    const key = `${path}#${canvasReloadNonce}|${bare}`;
    let entry = srcCache.current.get(key);
    if (!entry) {
      entry = { path, src: canvasUrl(path, cfg) };
      srcCache.current.set(key, entry);
    }
    return entry.src;
  };
  // One observable word for "what is the canvas pane actually doing" — the
  // top-frame signal the #115 E2E scenario waits on, and the only place these
  // three states are named together. `ready` is `dgn:'loaded'`-backed, so it
  // cannot be faked by a timer expiring (which is exactly how the bug used to
  // look successful: skeleton gone, pane white).
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
        <div className="st-empty">
          <div className="st-empty-brand">
            <span className="st-brand-mark">
              <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true"><path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" /></svg>
            </span>
            <span className="st-empty-wm">maude</span>
            <span className="st-empty-sub st-mono">
              CANVAS · {(project || 'MAUDE').toUpperCase()} / v{MDCC_VERSION} /
              localhost:{typeof window !== 'undefined' ? window.location.port : '4399'}
            </span>
          </div>
          <div className="st-empty-title">Nothing open yet</div>
          <div className="st-empty-body">
            ← Pick a screen from the list on the left, or open <strong>Design system</strong> above
            it to see your colors, type, and components.
            <br />
            <br />
            <strong>To select something on the canvas:</strong> hold <Kbd>⌘</Kbd> and hover to
            preview an element, click to select it — <Kbd>⌘⇧</Kbd>+click selects more than one.
            Right-click for more options.
            {isNativeApp() ? (
              <>
                <br />
                <br />
                Claude can see whatever's selected when you ask for a change in the Assistant
                panel, so pointing is often faster than describing it.
              </>
            ) : null}
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
        return (
          <iframe
            // The nonce is part of the key ONLY so the #115 Retry can force a
            // remount; it is otherwise constant, so normal switching keys on the
            // path exactly as before.
            key={`${t.path}#${canvasReloadNonce}`}
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
      {loadingPath && loadingPath === activePath && (
        // DS skeletons recipe — calm .skel pulse while the canvas-shell compiles
        // the TSX. Cleared by the iframe's dgn:'loaded' message (or the onLoad
        // fallback timer for legacy .html canvases that never post it).
        <CanvasLoading key={loadingPath} path={loadingPath} cloud={!!cfg?.cloud} />
      )}
      {canvasError && canvasError.path === activePath && (
        // issue #115 — what the blank pane used to be. Names which of the two
        // failures happened and offers the recovery that used to require
        // quitting the app (or knowing that switching projects and back
        // re-reads /_config).
        <div className="st-canvas-error" role="alert" data-testid="canvas-load-error">
          <div className="st-canvas-error-card">
            <div className="st-canvas-error-title">
              {canvasError.kind === 'server'
                ? "Maude's server isn't responding"
                : "This canvas didn't finish loading"}
            </div>
            <div className="st-canvas-error-body">
              {canvasError.kind === 'server' ? (
                <>
                  The canvas couldn't be reached. This usually means Maude's
                  server restarted underneath this window — your files on disk
                  are untouched.
                </>
              ) : (
                <>
                  The server is up, but{' '}
                  <code>{sanitizeDisplayText(basename(canvasError.path))}</code>{' '}
                  never finished compiling. Its own error, if it has one, is in
                  the canvas frame.
                </>
              )}
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
        </div>
      )}
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
    <div className="st-canvas-loading" role="status" aria-live="polite" data-testid="canvas-loading">
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
